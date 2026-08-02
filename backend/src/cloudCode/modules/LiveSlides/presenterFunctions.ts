/**
 * Presenting a Live Slides session, and reading what came back ⟨CP6⟩.
 *
 * ── Locking and moving are one operation ────────────────────────────────────
 * Navigating away from an open Question closes it permanently. That is not two
 * steps the browser sequences — it is one server operation, because a browser
 * that could do the first and not the second would leave a Question that is off
 * screen and still accepting answers.
 *
 * The lock happens **before** the current Slide moves. A Student's submission
 * checks the lock and the current Slide inside its own request, so the ordering
 * decides the race: a submission that reaches the database before the lock is
 * accepted and one that arrives after is refused with `QUESTION_CLOSED`. Either
 * way the final state is the same for everybody, which is the property that
 * matters.
 *
 * ── "No Answer" is derived, never stored ────────────────────────────────────
 * Nothing writes an empty response for a Student who said nothing. A missing
 * answer is exactly that: an enrolled Student, a locked or completed Question,
 * and no `LiveResponse`. Writing rows to represent silence would make the
 * uniqueness index meaningless and turn "did not answer" into a record that
 * looks like a submission.
 */

import {CloudFunction, Route} from '@90soft/parse-server-kit';

import {requireAdmin} from '../../utils/auth/authorize';
import {BatchError, batchError} from '../Batch/errors';
import {findEnrollmentsForBatch, findStudentIdsInBatch} from '../Batch/repository';
import {batchAllowsStart, requireLive} from './access';
import {SESSION_STATUS, SLIDE_TYPE} from './constants';
import {
  AdminResponseDto,
  OptionTallyDto,
  toAdminResponseDto,
  toSessionDto,
  toSlideDto,
  tallyOptions,
} from './dto';
import {LiveSlidesError, liveSlidesError} from './errors';
import {liveLog} from './logging';
import {
  findResponsesForSession,
  findResponsesForSlide,
  findSlidesForSession,
  lockSlide,
  pointerTo,
  setSessionStatus,
} from './repository';
import {requireSession} from './adminFunctions';

/** A Student's display name for the response panel. Never their email. */
function displayName(user: Parse.User | undefined): string {
  if (!user) return '';
  const first = String(user.get('firstName') ?? '').trim();
  const last = String(user.get('lastName') ?? '').trim();
  const full = `${first} ${last}`.trim();
  return full.length > 0 ? full : '';
}

/** Everybody enrolled in the Batch, by id and display name. */
async function enrolledStudents(batchId: string): Promise<Map<string, string>> {
  const page = await findEnrollmentsForBatch(batchId, {skip: 0, limit: 1000});
  const names = new Map<string, string>();
  for (const enrollment of page.enrollments ?? []) {
    const student = enrollment.get('student') as Parse.User | undefined;
    if (student?.id) names.set(student.id, displayName(student));
  }
  return names;
}

/** The Slide being presented, resolved from the session's own pointer. */
async function currentSlideOf(
  session: Parse.Object
): Promise<{slide: Parse.Object | undefined; slides: Parse.Object[]; index: number}> {
  const slides = await findSlidesForSession(session.id);
  const currentId = (session.get('currentSlide') as Parse.Object | undefined)?.id;
  const index = slides.findIndex(slide => slide.id === currentId);
  return {slide: index >= 0 ? slides[index] : slides[0], slides, index: index >= 0 ? index : 0};
}

/**
 * How the current Slide is doing, for the presenter's panel.
 *
 * Counts are of **enrolled** Students, not of anybody who happens to have the
 * page open: the product says unanswered is calculated from the Batch roster,
 * and opening a page is not attendance.
 */
async function slideProgress(
  session: Parse.Object,
  slide: Parse.Object | undefined
): Promise<{
  responses: AdminResponseDto[];
  tally: OptionTallyDto[];
  submitted: number;
  unanswered: number;
  unansweredNames: string[];
}> {
  const empty = {responses: [], tally: [], submitted: 0, unanswered: 0, unansweredNames: []};
  if (!slide || slide.get('type') !== SLIDE_TYPE.QUESTION) return empty;

  const batch = session.get('batch') as Parse.Object;
  const roster = await enrolledStudents(batch.id as string);
  const rows = await findResponsesForSlide(session.id, slide.id);

  const answered = new Set<string>();
  const responses = rows.map(row => {
    const student = row.get('student') as Parse.User | undefined;
    if (student?.id) answered.add(student.id);
    return toAdminResponseDto(row, slide, roster.get(student?.id ?? '') ?? displayName(student));
  });

  const unansweredNames: string[] = [];
  for (const [id, name] of roster) {
    if (!answered.has(id)) unansweredNames.push(name);
  }

  return {
    responses,
    tally: tallyOptions(slide, rows),
    submitted: responses.length,
    unanswered: unansweredNames.length,
    unansweredNames,
  };
}

@Route('live-presenter')
class LivePresenterFunctions {
  /**
   * Start a Ready session.
   *
   * The Batch must be **active**: a draft Batch may be prepared but has no
   * cohort to present to, and a completed or archived one has finished.
   *
   * The `liveForBatch` sentinel is what makes "one Live session per Batch" true.
   * Two simultaneous starts both pass every check above and then one of them
   * loses the unique index — which is reported as `LIVE_SESSION_ALREADY_ACTIVE`
   * rather than as a failure, because that is exactly what happened.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Start a Live session',
      description:
        'Ready → Live. Requires an active Batch and no other Live session for ' +
        'it. Admins only.',
      tags: ['Live Slides'],
      responses: {
        '200': {description: 'The Live session DTO'},
        '400': {description: 'Not ready, or another session is already live'},
      },
    },
  })
  async startLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'startLiveSession');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);

    if (session.get('status') !== SESSION_STATUS.READY) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_READY);
    }
    if (!batchAllowsStart(batch)) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_READY);
    }

    const slides = await findSlidesForSession(session.id);
    if (slides.length === 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_READY);
    }

    const saved = await setSessionStatus(session, SESSION_STATUS.LIVE, {
      liveForBatch: pointerTo('Batch', batch.id as string),
      currentSlide: pointerTo('LiveSlide', slides[0].id),
      currentSlideIndex: 0,
      startedBy: admin,
      startedAt: new Date(),
    });

    liveLog.info('Live session started', {
      op: 'startLiveSession',
      stage: 'start',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      sessionId: saved.id,
      count: slides.length,
    });

    return toSessionDto(saved, slides, {
      batchId: batch.id as string,
      canStart: false,
      editable: false,
    });
  }

  /**
   * Everything the presenter needs right now.
   *
   * The Admin's client asks for this on a timer. It is the authoritative answer
   * to "what is on screen and who has answered", so a reconnecting presenter
   * needs no other call and no page refresh.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Get presenter state',
      description: 'The current Slide, submitted answers, and counts. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'Authoritative presenter state'}},
    },
  })
  async getPresenterState(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getPresenterState');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    const {slide, slides, index} = await currentSlideOf(session);
    const progress = await slideProgress(session, slide);

    return {
      sessionId: session.id,
      batchId: batch.id as string,
      status: session.get('status'),
      slideCount: slides.length,
      currentIndex: index,
      currentSlide: slide ? toSlideDto(slide) : undefined,
      ...progress,
    };
  }

  /** Move to the previous Slide, locking the current Question on the way out. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Previous Slide',
      description: 'Locks the current Question permanently, then moves back.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The new presenter state'}},
    },
  })
  async previousLiveSlide(req: Parse.Cloud.FunctionRequest) {
    return moveSlide(req, -1, 'previousLiveSlide');
  }

  /** Move to the next Slide, locking the current Question on the way out. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Next Slide',
      description: 'Locks the current Question permanently, then moves forward.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The new presenter state'}},
    },
  })
  async nextLiveSlide(req: Parse.Cloud.FunctionRequest) {
    return moveSlide(req, 1, 'nextLiveSlide');
  }

  /**
   * End the session.
   *
   * Locks whatever Question is open and marks the session Completed, which
   * releases the Batch's Live slot. Completed is terminal: there is no reopen,
   * and no operation anywhere accepts a response afterwards.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'End the Live session',
      description: 'Locks the current Question and completes the session. Terminal.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The completed session DTO'}},
    },
  })
  async endLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'endLiveSession');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    requireLive(session, 'endLiveSession');

    const {slide} = await currentSlideOf(session);
    if (slide) await lockSlide(slide);

    const saved = await setSessionStatus(session, SESSION_STATUS.COMPLETED, {
      // Releasing the sentinel is what frees the Batch's one Live slot.
      liveForBatch: undefined,
      completedAt: new Date(),
    });

    const slides = await findSlidesForSession(saved.id);

    liveLog.info('Live session completed', {
      op: 'endLiveSession',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      sessionId: saved.id,
    });

    return toSessionDto(saved, slides, {
      batchId: batch.id as string,
      canStart: false,
      editable: false,
    });
  }

  /** Every submitted answer for the current Slide. The live response panel. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'List live responses',
      description: 'Submitted answers for one Slide, with counts. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'Safe response DTOs'}},
    },
  })
  async listLiveResponses(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'listLiveResponses');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session} = await requireSession(params['sessionId']);
    const slides = await findSlidesForSession(session.id);

    const wanted = typeof params['slideId'] === 'string' ? params['slideId'] : '';
    const slide = wanted
      ? slides.find(item => item.id === wanted)
      : (await currentSlideOf(session)).slide;

    if (!slide) throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);

    return {slideId: slide.id, ...(await slideProgress(session, slide))};
  }
}

/**
 * The one authoritative navigation operation.
 *
 * Lock first, then move. Both happen server-side in one request, so a browser
 * cannot perform half of it — and the lock is what the Student's submission
 * check reads, so the order here is the order that decides the race.
 */
async function moveSlide(req: Parse.Cloud.FunctionRequest, offset: number, op: string) {
  const admin = await requireAdmin(req, op);
  const params = (req.params ?? {}) as Record<string, unknown>;

  const {session, batch} = await requireSession(params['sessionId']);
  requireLive(session, op);

  const {slide, slides, index} = await currentSlideOf(session);
  const target = index + offset;
  if (target < 0 || target >= slides.length) {
    // Already at an end. Answer with the current state rather than an error:
    // a disabled button that was clicked anyway is not a failure.
    const progress = await slideProgress(session, slide);
    return {
      sessionId: session.id,
      batchId: batch.id as string,
      status: session.get('status'),
      slideCount: slides.length,
      currentIndex: index,
      currentSlide: slide ? toSlideDto(slide) : undefined,
      ...progress,
    };
  }

  let locked = false;
  if (slide) locked = await lockSlide(slide);

  const next = slides[target];
  const saved = await setSessionStatus(session, SESSION_STATUS.LIVE, {
    currentSlide: pointerTo('LiveSlide', next.id),
    currentSlideIndex: target,
  });

  liveLog.info('Presenter moved', {
    op,
    stage: locked ? 'lock' : 'navigate',
    ok: true,
    userId: admin.id,
    sessionId: saved.id,
    slideId: next.id,
    count: target,
  });

  const progress = await slideProgress(saved, next);
  return {
    sessionId: saved.id,
    batchId: batch.id as string,
    status: saved.get('status'),
    slideCount: slides.length,
    currentIndex: target,
    currentSlide: toSlideDto(next),
    ...progress,
  };
}

@Route('live-results')
class LiveResultsFunctions {
  /**
   * A completed session, one row per enrolled Student.
   *
   * Everybody in the Batch appears, including Students who answered nothing —
   * that is the point of the view. Their count is zero and their missing
   * answers are derived, not stored.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Results by Student',
      description: 'One row per enrolled Student, with their answers. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'Safe per-Student results'}},
    },
  })
  async getResultsByStudent(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getResultsByStudent');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    const slides = await findSlidesForSession(session.id);
    const questions = slides.filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION);
    const byId = new Map(slides.map(slide => [slide.id, slide]));

    const roster = await enrolledStudents(batch.id as string);
    const rows = await findResponsesForSession(session.id);

    const byStudent = new Map<string, AdminResponseDto[]>();
    for (const row of rows) {
      const student = row.get('student') as Parse.User | undefined;
      if (!student?.id) continue;
      const slide = byId.get((row.get('slide') as Parse.Object | undefined)?.id ?? '');
      const list = byStudent.get(student.id) ?? [];
      list.push(toAdminResponseDto(row, slide, roster.get(student.id) ?? displayName(student)));
      byStudent.set(student.id, list);
    }

    const items = [...roster.entries()].map(([studentId, studentName]) => ({
      studentId,
      studentName,
      answered: (byStudent.get(studentId) ?? []).length,
      questionCount: questions.length,
      responses: byStudent.get(studentId) ?? [],
    }));

    return {
      sessionId: session.id,
      questionCount: questions.length,
      studentCount: roster.size,
      // A participant is somebody who submitted at least one answer, which is
      // not the same as somebody who was in the room.
      participantCount: items.filter(item => item.answered > 0).length,
      responseCount: rows.length,
      items,
    };
  }

  /** A completed session, one row per Question, with tallies for choice types. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Results by Question',
      description: 'One row per Question, with per-option counts and percentages.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'Safe per-Question results'}},
    },
  })
  async getResultsByQuestion(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getResultsByQuestion');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    const slides = await findSlidesForSession(session.id);
    const questions = slides.filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION);

    const roster = await enrolledStudents(batch.id as string);
    const rows = await findResponsesForSession(session.id);

    const bySlide = new Map<string, Parse.Object[]>();
    for (const row of rows) {
      const slideId = (row.get('slide') as Parse.Object | undefined)?.id ?? '';
      bySlide.set(slideId, [...(bySlide.get(slideId) ?? []), row]);
    }

    const items = questions.map(question => {
      const answers = bySlide.get(question.id) ?? [];
      const answered = new Set(
        answers.map(row => (row.get('student') as Parse.User | undefined)?.id ?? '')
      );
      return {
        slide: toSlideDto(question),
        submitted: answers.length,
        unanswered: Math.max(0, roster.size - answered.size),
        tally: tallyOptions(question, answers),
        responses: answers.map(row => {
          const student = row.get('student') as Parse.User | undefined;
          return toAdminResponseDto(
            row,
            question,
            roster.get(student?.id ?? '') ?? displayName(student)
          );
        }),
      };
    });

    return {sessionId: session.id, studentCount: roster.size, items};
  }
}

export {LivePresenterFunctions, LiveResultsFunctions, enrolledStudents, displayName};

/** Guard: a Batch must exist before anything above is asked about it. */
export function assertBatch(batch: Parse.Object | undefined): asserts batch is Parse.Object {
  if (!batch) throw batchError(BatchError.BATCH_NOT_FOUND);
}

/** Re-exported so the Student surface uses the same roster definition. */
export {findStudentIdsInBatch};
