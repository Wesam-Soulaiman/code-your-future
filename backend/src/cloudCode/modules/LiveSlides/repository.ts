/**
 * Reading and writing Live Slides ⟨CP6⟩.
 *
 * Every query uses the master key, because all three classes grant nobody
 * anything — authorisation happened in the operation that called in here,
 * against the caller's live roles and their enrollment. Nothing in this file
 * decides who may do what; it decides how.
 */

import {catchError} from '@90soft/parse-server-kit';

import {
  HISTORY_PAGE,
  SESSION_PAGE,
  SESSION_STATUS,
  SLIDE_COUNT,
  SLIDE_TYPE,
  SessionStatus,
} from './constants';
import {LiveSlidesError, liveSlidesError} from './errors';
import {describeFailure, liveLog} from './logging';
import {SlideOption, SlideValues} from './validation';

const SESSION_CLASS = 'LiveSlideSession';
const SLIDE_CLASS = 'LiveSlide';
const RESPONSE_CLASS = 'LiveResponse';
const BATCH_CLASS = 'Batch';
const PROFILE_CLASS = 'StudentProfile';

/** A pointer without fetching the row it points at. */
export function pointerTo(className: string, objectId: string): Parse.Object {
  const pointer = new Parse.Object(className);
  pointer.id = objectId;
  return pointer;
}

/**
 * True when a write failed because a unique index refused it.
 *
 * Mongo reports 11000; Parse maps it to 137 (DUPLICATE_VALUE) when it
 * recognises the index. Both are checked because which one arrives depends on
 * whether Parse knows the index by name.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const record = error as {code?: unknown; message?: unknown} | undefined;
  if (record?.code === 137 || record?.code === 11000) return true;
  return typeof record?.message === 'string' && record.message.includes('E11000');
}

// ═══════════════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════════════

export async function findSessionsForBatch(batchId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(SESSION_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.descending('createdAt');
  query.limit(SESSION_PAGE.maxLimit);

  const [error, sessions] = await catchError(query.find({useMasterKey: true}));
  if (error) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);
  return (sessions as Parse.Object[]) ?? [];
}

/** One session by id, with its Batch included. Does **not** authorise. */
export async function findSessionById(sessionId: unknown): Promise<Parse.Object | undefined> {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return undefined;

  const query = new Parse.Query(SESSION_CLASS);
  query.include('batch');
  query.include('currentSlide');

  const [error, session] = await catchError(query.get(sessionId.trim(), {useMasterKey: true}));
  if (error) return undefined;
  return (session as Parse.Object | undefined) ?? undefined;
}

/** The Batch's Live session, if one is running. */
export async function findLiveSessionForBatch(batchId: string): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(SESSION_CLASS);
  query.equalTo('liveForBatch', pointerTo(BATCH_CLASS, batchId));
  query.include('currentSlide');

  const [error, session] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (session as Parse.Object | undefined) ?? undefined;
}

/**
 * The session a Student should be looking at for this Batch.
 *
 * The Live one if there is one; otherwise the most recent Ready or Completed
 * one, so the page can say "starting soon" or show their own answers rather
 * than nothing at all. Draft sessions are invisible to Students — a lecture
 * being written is not a lecture.
 */
export async function findStudentVisibleSession(batchId: string): Promise<Parse.Object | undefined> {
  const live = await findLiveSessionForBatch(batchId);
  if (live) return live;

  const query = new Parse.Query(SESSION_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.containedIn('status', [SESSION_STATUS.READY, SESSION_STATUS.COMPLETED]);
  query.descending('updatedAt');
  query.include('currentSlide');

  const [error, session] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (session as Parse.Object | undefined) ?? undefined;
}

export interface NewSession {
  batchId: string;
  title: string;
  description?: string;
  sessionDate: Date;
  createdBy: Parse.User;
}

export async function createSession(input: NewSession): Promise<Parse.Object> {
  const SessionClass = Parse.Object.extend(SESSION_CLASS);
  const session = new SessionClass() as Parse.Object;

  session.set('batch', pointerTo(BATCH_CLASS, input.batchId));
  session.set('title', input.title);
  if (input.description) session.set('description', input.description);
  session.set('sessionDate', input.sessionDate);
  session.set('status', SESSION_STATUS.DRAFT);
  session.set('createdBy', input.createdBy);

  const [error, saved] = await catchError(session.save(null, {useMasterKey: true}));
  if (error || !saved) {
    liveLog.error('Creating a live session failed', {
      op: 'createSession',
      stage: 'persist',
      ok: false,
      batchId: input.batchId,
      code: LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

export async function updateSessionMetadata(
  session: Parse.Object,
  values: {title: string; description?: string; sessionDate: Date}
): Promise<Parse.Object> {
  session.set('title', values.title);
  session.set('sessionDate', values.sessionDate);
  if (values.description) session.set('description', values.description);
  else session.unset('description');

  const [error, saved] = await catchError(session.save(null, {useMasterKey: true}));
  if (error || !saved) {
    liveLog.error('Updating a live session failed', {
      op: 'updateSession',
      stage: 'persist',
      ok: false,
      sessionId: session.id,
      code: LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

/** Move a session between statuses. The caller has already checked the move. */
export async function setSessionStatus(
  session: Parse.Object,
  status: SessionStatus,
  extra: Record<string, unknown> = {}
): Promise<Parse.Object> {
  session.set('status', status);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) session.unset(key);
    else session.set(key, value);
  }

  const [error, saved] = await catchError(session.save(null, {useMasterKey: true}));
  if (error || !saved) {
    // A duplicate key here means one thing only: another session already holds
    // this Batch's Live slot. That is the guarantee working, not a fault.
    if (isDuplicateKeyError(error)) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_ALREADY_ACTIVE);
    }
    liveLog.error('Changing a live session status failed', {
      op: 'setSessionStatus',
      stage: 'persist',
      ok: false,
      sessionId: session.id,
      status,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

// ═══════════════════════════════════════════════════════════════════════════
// Slides
// ═══════════════════════════════════════════════════════════════════════════

/** Every Slide of one session, in display order. Backed by the compound index. */
export async function findSlidesForSession(sessionId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(SLIDE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));
  query.ascending('displayOrder');
  // A secondary key, so two Slides that somehow share an order still come back
  // in a stable sequence rather than whatever the storage engine felt like.
  query.addAscending('createdAt');
  query.limit(SLIDE_COUNT.max);

  const [error, slides] = await catchError(query.find({useMasterKey: true}));
  if (error) throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);
  return (slides as Parse.Object[]) ?? [];
}

/** One Slide by id. Does **not** authorise, and does not check the session. */
export async function findSlideById(slideId: unknown): Promise<Parse.Object | undefined> {
  if (typeof slideId !== 'string' || slideId.trim().length === 0) return undefined;

  const query = new Parse.Query(SLIDE_CLASS);
  const [error, slide] = await catchError(query.get(slideId.trim(), {useMasterKey: true}));
  if (error) return undefined;
  return (slide as Parse.Object | undefined) ?? undefined;
}

/** Apply a Slide's validated values, clearing what does not belong to its type. */
function applySlideValues(slide: Parse.Object, values: SlideValues): void {
  if (values.type === SLIDE_TYPE.INFORMATION) {
    slide.set('title', values.title ?? '');
    slide.set('content', values.content ?? '');
    return;
  }

  slide.set('question', values.question ?? '');
  if (values.description) slide.set('description', values.description);
  else slide.unset('description');

  slide.set('answerType', values.answerType);
  if (values.options) slide.set('options', values.options);
  else slide.unset('options');
}

export async function createSlide(
  sessionId: string,
  values: SlideValues,
  displayOrder: number
): Promise<Parse.Object> {
  const SlideClass = Parse.Object.extend(SLIDE_CLASS);
  const slide = new SlideClass() as Parse.Object;

  slide.set('session', pointerTo(SESSION_CLASS, sessionId));
  slide.set('type', values.type);
  slide.set('displayOrder', displayOrder);
  applySlideValues(slide, values);

  const [error, saved] = await catchError(slide.save(null, {useMasterKey: true}));
  if (error || !saved) {
    liveLog.error('Creating a slide failed', {
      op: 'createSlide',
      stage: 'persist',
      ok: false,
      sessionId,
      slideType: values.type,
      code: LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

export async function updateSlide(
  slide: Parse.Object,
  values: SlideValues
): Promise<Parse.Object> {
  applySlideValues(slide, values);

  const [error, saved] = await catchError(slide.save(null, {useMasterKey: true}));
  if (error || !saved) {
    liveLog.error('Updating a slide failed', {
      op: 'updateSlide',
      stage: 'persist',
      ok: false,
      slideId: slide.id,
      code: LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

export async function deleteSlideRow(slide: Parse.Object): Promise<void> {
  const [error] = await catchError(slide.destroy({useMasterKey: true}));
  if (error) throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED);
}

/**
 * Apply a new order to a session's Slides.
 *
 * The caller sends the ids it wants, in order. This re-reads what the session
 * actually has and applies positions to **that**, so a request built against a
 * stale list cannot do damage: an id that no longer exists is ignored, and a
 * Slide the caller did not mention keeps a position after the ones it did — it
 * never silently vanishes from the ordering or collides at zero.
 *
 * Positions are rewritten from 0 in one `saveAll`, so the result is the same
 * whichever order two concurrent reorders arrive in: the last writer wins
 * completely, rather than the two interleaving into a sequence neither asked
 * for.
 */
export async function applySlideOrder(
  sessionId: string,
  orderedIds: readonly string[]
): Promise<Parse.Object[]> {
  const existing = await findSlidesForSession(sessionId);
  if (existing.length === 0) return [];

  const byId = new Map(existing.map(slide => [slide.id, slide]));

  const seen = new Set<string>();
  const sequence: Parse.Object[] = [];
  for (const id of orderedIds) {
    const slide = byId.get(id);
    if (!slide || seen.has(id)) continue;
    seen.add(id);
    sequence.push(slide);
  }
  for (const slide of existing) {
    if (!seen.has(slide.id)) sequence.push(slide);
  }

  sequence.forEach((slide, index) => slide.set('displayOrder', index));

  const [error, saved] = await catchError(Parse.Object.saveAll(sequence, {useMasterKey: true}));
  if (error) {
    liveLog.error('Reordering slides failed', {
      op: 'reorderSlides',
      stage: 'reorder',
      ok: false,
      sessionId,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED);
  }
  return (saved as Parse.Object[]) ?? sequence;
}

/**
 * Close a Question for good.
 *
 * Idempotent, and deliberately so: locking runs on every navigation away, and a
 * Slide that is already locked must not be re-stamped with a later time. The
 * returned boolean says whether this call is the one that closed it.
 */
export async function lockSlide(slide: Parse.Object): Promise<boolean> {
  if (slide.get('type') !== SLIDE_TYPE.QUESTION) return false;
  if (slide.get('lockedAt')) return false;

  slide.set('lockedAt', new Date());
  const [error] = await catchError(slide.save(null, {useMasterKey: true}));
  if (error) {
    liveLog.error('Locking a question failed', {
      op: 'lockSlide',
      stage: 'lock',
      ok: false,
      slideId: slide.id,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED);
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Responses
// ═══════════════════════════════════════════════════════════════════════════

export interface NewResponse {
  sessionId: string;
  slideId: string;
  batchId: string;
  student: Parse.User;
  studentProfileId: string;
  answerType: string;
  textAnswer?: string;
  selectedOptionId?: string;
  selectedOptionIds?: string[];
}

/**
 * Store one answer, permanently.
 *
 * `submittedAt` is the **server's** clock. A client timestamp would let a late
 * answer claim to have arrived before the lock.
 *
 * A duplicate-key failure is not an error here: it means this Student already
 * answered, and their existing answer stands. The caller turns that into
 * `ALREADY_SUBMITTED` and returns what they actually submitted.
 */
export async function createResponse(
  input: NewResponse
): Promise<{created: true; response: Parse.Object} | {created: false}> {
  const ResponseClass = Parse.Object.extend(RESPONSE_CLASS);
  const response = new ResponseClass() as Parse.Object;

  response.set('session', pointerTo(SESSION_CLASS, input.sessionId));
  response.set('slide', pointerTo(SLIDE_CLASS, input.slideId));
  response.set('batch', pointerTo(BATCH_CLASS, input.batchId));
  response.set('student', input.student);
  response.set('studentProfile', pointerTo(PROFILE_CLASS, input.studentProfileId));
  response.set('answerType', input.answerType);
  response.set('submittedAt', new Date());

  if (input.textAnswer !== undefined) response.set('textAnswer', input.textAnswer);
  if (input.selectedOptionId !== undefined) response.set('selectedOptionId', input.selectedOptionId);
  if (input.selectedOptionIds !== undefined) {
    response.set('selectedOptionIds', input.selectedOptionIds);
  }

  const [error, saved] = await catchError(response.save(null, {useMasterKey: true}));
  if (error || !saved) {
    if (isDuplicateKeyError(error)) return {created: false};

    liveLog.error('Storing a response failed', {
      op: 'submitResponse',
      stage: 'submit',
      ok: false,
      sessionId: input.sessionId,
      slideId: input.slideId,
      answerType: input.answerType,
      code: LiveSlidesError.LIVE_RESPONSE_FAILED,
      ...describeFailure(error),
    });
    throw liveSlidesError(LiveSlidesError.LIVE_RESPONSE_FAILED);
  }

  return {created: true, response: saved as Parse.Object};
}

/** One Student's answer to one Slide, if they gave one. */
export async function findResponse(
  sessionId: string,
  slideId: string,
  student: Parse.User
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));
  query.equalTo('slide', pointerTo(SLIDE_CLASS, slideId));
  query.equalTo('student', student);

  const [error, response] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (response as Parse.Object | undefined) ?? undefined;
}

/** Every answer to one Slide. The Admin's live panel and by-Question results. */
export async function findResponsesForSlide(
  sessionId: string,
  slideId: string
): Promise<Parse.Object[]> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));
  query.equalTo('slide', pointerTo(SLIDE_CLASS, slideId));
  query.include('student');
  query.ascending('submittedAt');
  query.limit(SESSION_PAGE.maxLimit * 10);

  const [error, responses] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (responses as Parse.Object[]) ?? [];
}

/** Every answer in one session. Completed results, both views. */
export async function findResponsesForSession(sessionId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));
  query.include('student');
  query.ascending('submittedAt');
  query.limit(SESSION_PAGE.maxLimit * 20);

  const [error, responses] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (responses as Parse.Object[]) ?? [];
}

/** One Student's own answers within one session. */
export async function findResponsesForStudentInSession(
  sessionId: string,
  student: Parse.User
): Promise<Parse.Object[]> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));
  query.equalTo('student', student);
  query.ascending('submittedAt');
  query.limit(SLIDE_COUNT.max);

  const [error, responses] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (responses as Parse.Object[]) ?? [];
}

export interface HistoryPage {
  items: Parse.Object[];
  total: number;
}

/**
 * One profile's answers across every **completed** session, newest first.
 *
 * Completed only, deliberately: a running lecture's answers belong on the
 * presenter's panel, not in a permanent history that is still changing.
 */
export async function findHistoryForProfile(
  profileId: string,
  page: {skip: number; limit: number}
): Promise<HistoryPage> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('studentProfile', pointerTo(PROFILE_CLASS, profileId));
  query.include('slide');
  query.include(['session', 'session.batch']);
  query.descending('submittedAt');
  query.skip(page.skip);
  query.limit(page.limit);

  const [error, found] = await catchError(query.withCount().find({useMasterKey: true}));
  if (error) return {items: [], total: 0};

  const result = found as unknown as {results?: Parse.Object[]; count?: number};
  return {items: result?.results ?? [], total: result?.count ?? 0};
}

/** How many answers one session has collected. */
export async function countResponsesForSession(sessionId: string): Promise<number> {
  const query = new Parse.Query(RESPONSE_CLASS);
  query.equalTo('session', pointerTo(SESSION_CLASS, sessionId));

  const [error, count] = await catchError(query.count({useMasterKey: true}));
  if (error) return 0;
  return (count as number) ?? 0;
}

/** The Student's profile, for the pointer a response must carry. */
export async function findProfileForStudent(student: Parse.User): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(PROFILE_CLASS);
  query.equalTo('user', student);
  query.select('isComplete');

  const [error, profile] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (profile as Parse.Object | undefined) ?? undefined;
}

export {HISTORY_PAGE, SESSION_PAGE};
