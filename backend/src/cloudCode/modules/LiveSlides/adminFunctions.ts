/**
 * Building a Live Slides session ⟨CP6⟩.
 *
 * Everything an Admin does **before** the lecture: create the session, write the
 * Slides, reorder them, and mark it Ready. Presenting is `presenterFunctions`;
 * answering is `studentFunctions`. The split is by lifecycle, not by object,
 * because the rules change completely at the moment a session starts.
 *
 * ── Editing stops at Draft ──────────────────────────────────────────────────
 * Every write here calls `requireEditable` first. Once a session is Ready its
 * Slides are frozen until somebody deliberately sends it back to Draft, and once
 * it has gone Live they are frozen for good — a Student's answer must keep
 * pointing at the exact question they were asked, down to the option labels.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {rejectPrivilegedParams, requireAdmin} from '../../utils/auth/authorize';
import {BatchError, batchError} from '../Batch/errors';
import {findBatchById} from '../Batch/repository';
import {
  batchAllowsStart,
  batchIsReadOnly,
  batchOf,
  describeViewer,
  requireEditable,
} from './access';
import {
  SESSION_STATUS,
  SLIDE_COUNT,
  SLIDE_TYPE,
  SessionStatus,
  isEditableStatus,
  needsOptions,
} from './constants';
import {SessionSummaryDto, toSessionDto, toSessionSummaryDto, optionsOf} from './dto';
import {LiveSlidesError, liveSlidesError} from './errors';
import {liveLog} from './logging';
import {
  countResponsesForSession,
  createSession,
  createSlide,
  deleteSlideRow,
  findSessionById,
  findSessionsForBatch,
  findSlideById,
  findSlidesForSession,
  applySlideOrder,
  setSessionStatus,
  updateSessionMetadata,
  updateSlide,
} from './repository';
import {
  findPrivilegedLiveFields,
  parseOrderedIds,
  validateSessionMetadata,
  validateSlide,
} from './validation';

/** The Batch, or a stable not-found. Never leaks whether the id was well-formed. */
async function requireBatch(batchId: unknown): Promise<Parse.Object> {
  const id = typeof batchId === 'string' ? batchId.trim() : '';
  if (id.length === 0) throw batchError(BatchError.BATCH_NOT_FOUND);

  const [error, batch] = await catchError(findBatchById(id));
  if (error || !batch) throw batchError(BatchError.BATCH_NOT_FOUND);
  return batch as Parse.Object;
}

/** The session and its Batch, or a stable not-found. */
export async function requireSession(
  sessionId: unknown
): Promise<{session: Parse.Object; batch: Parse.Object}> {
  const session = await findSessionById(sessionId);
  if (!session) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

  const batch = batchOf(session);
  if (!batch) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

  return {session, batch};
}

/** Refuse a request that tried to set something only the server may set. */
function rejectPrivileged(params: Record<string, unknown>): void {
  const privileged = findPrivilegedLiveFields(params);
  if (privileged.length === 0) return;

  throw liveSlidesError(
    LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED,
    Object.fromEntries(privileged.map(field => [field, 'NOT_ALLOWED']))
  );
}

/**
 * Rebuild a stored Slide as validator input.
 *
 * `options` is included **only** when the answer type has them. Passing `[]` for
 * a text answer trips the "a text answer carries no options" rule, which meant
 * a session containing a single Short or Long Answer question could never be
 * marked Ready. Found by the runtime validation, not by the unit tests: those
 * called `validateSlide` with hand-written input that never had the empty array.
 *
 * `freshOptionIds` drops the ids, which is what a copy needs — an id shared with
 * the original would make a later answer ambiguous about which session's
 * question it belongs to.
 */
function slideAsInput(
  slide: Parse.Object,
  {freshOptionIds = false}: {freshOptionIds?: boolean} = {}
): Record<string, unknown> {
  if (slide.get('type') === SLIDE_TYPE.INFORMATION) {
    return {title: slide.get('title'), content: slide.get('content')};
  }

  const answerType = slide.get('answerType');
  const input: Record<string, unknown> = {
    question: slide.get('question'),
    description: slide.get('description'),
    answerType,
  };

  if (needsOptions(answerType)) {
    const options = optionsOf(slide);
    input['options'] = freshOptionIds ? options.map(option => ({text: option.text})) : options;
  }

  return input;
}

/** The counts a session summary carries, without loading every Slide twice. */
async function summarise(session: Parse.Object): Promise<SessionSummaryDto> {
  const slides = await findSlidesForSession(session.id);
  const responseCount =
    session.get('status') === SESSION_STATUS.COMPLETED
      ? await countResponsesForSession(session.id)
      : undefined;

  return toSessionSummaryDto(session, {
    slideCount: slides.length,
    questionCount: slides.filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION).length,
    responseCount,
  });
}

@Route('live-sessions')
class LiveSessionAdminFunctions {
  /** Every session of one Batch, newest first. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List Live Slides sessions',
      description: 'Every session of one Batch, newest first. Admins only.',
      tags: ['Live Slides'],
      responses: {
        '200': {description: 'Safe session summaries'},
        '404': {description: 'No such Batch, or not an Admin'},
      },
    },
  })
  async listLiveSessions(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listLiveSessions');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const sessions = await findSessionsForBatch(batch.id as string);
    const items: SessionSummaryDto[] = [];
    for (const session of sessions) items.push(await summarise(session));

    liveLog.info('Live sessions listed', {
      op: 'listLiveSessions',
      stage: 'load',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      count: items.length,
    });

    return {
      items,
      canCreate: !batchIsReadOnly(batch),
      canStart: batchAllowsStart(batch),
      readOnly: batchIsReadOnly(batch),
    };
  }

  /** One session, with every Slide. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Get one Live Slides session',
      description: 'The session and its Slides, in order. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'A safe session DTO'}, '404': {description: 'No such session'}},
    },
  })
  async getLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'getLiveSession');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    const slides = await findSlidesForSession(session.id);
    const status = session.get('status') as SessionStatus;

    return toSessionDto(session, slides, {
      batchId: batch.id as string,
      canStart: batchAllowsStart(batch) && status === SESSION_STATUS.READY,
      editable: isEditableStatus(status) && !batchIsReadOnly(batch),
      responseCount:
        status === SESSION_STATUS.COMPLETED
          ? await countResponsesForSession(session.id)
          : undefined,
    });
  }

  /** Create a Draft session. A new session always starts in Draft. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {batchId: {required: true, type: String}, title: {required: true, type: String}},
    },
    swagger: {
      summary: 'Create a Live Slides session',
      description: 'Creates a Draft session. Admins only. Refused on an archived Batch.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The new session DTO'}, '400': {description: 'Validation failed'}},
    },
  })
  async createLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'createLiveSession');
    rejectPrivilegedParams(req, 'createLiveSession');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const batch = await requireBatch(params['batchId']);
    if (batchIsReadOnly(batch)) throw batchError(BatchError.BATCH_READ_ONLY);

    const {values, errors} = validateSessionMetadata(params);
    if (Object.keys(errors).length > 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED, errors);
    }

    const session = await createSession({
      batchId: batch.id as string,
      title: values.title,
      description: values.description,
      sessionDate: values.sessionDate,
      createdBy: admin,
    });

    liveLog.info('Live session created', {
      op: 'createLiveSession',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      sessionId: session.id,
    });

    return toSessionDto(session, [], {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /** Change a Draft session's title, date, or description. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, title: {required: true, type: String}},
    },
    swagger: {
      summary: 'Update a Draft session',
      description: 'Title, date, and description. Draft only. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The updated session DTO'}},
    },
  })
  async updateLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'updateLiveSession');
    rejectPrivilegedParams(req, 'updateLiveSession');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'updateLiveSession');

    const {values, errors} = validateSessionMetadata(params);
    if (Object.keys(errors).length > 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED, errors);
    }

    const saved = await updateSessionMetadata(session, values);
    const slides = await findSlidesForSession(saved.id);

    liveLog.info('Live session updated', {
      op: 'updateLiveSession',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: saved.id,
    });

    return toSessionDto(saved, slides, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /**
   * Mark a Draft session Ready.
   *
   * Ready means "this is what will be presented", so everything is checked here
   * rather than at the moment somebody stands in front of a room: at least one
   * Slide, at least one Question, and every Slide still valid against the
   * current rules.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Mark a session Ready',
      description: 'Validates every Slide and freezes editing. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The Ready session DTO'}, '400': {description: 'Not valid'}},
    },
  })
  async markLiveSessionReady(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'markLiveSessionReady');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'markLiveSessionReady');

    const slides = await findSlidesForSession(session.id);
    if (slides.length === 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED, {
        slides: 'REQUIRED',
      });
    }

    const questions = slides.filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION);
    if (questions.length === 0) {
      // A session with no Question is a slideshow. The product is about answers.
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED, {
        questions: 'REQUIRED',
      });
    }

    // Re-validate every Slide against today's rules, not the rules that applied
    // when it was written. A Slide that no longer passes must be fixed before a
    // room of people sees it.
    for (const slide of slides) {
      const type = slide.get('type');
      const {errors} = validateSlide(slideAsInput(slide), {
        existingType: type,
        existingOptions: optionsOf(slide),
      });
      if (Object.keys(errors).length > 0) {
        throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, {
          ...errors,
          slideId: 'INVALID',
        });
      }
    }

    const saved = await setSessionStatus(session, SESSION_STATUS.READY);

    liveLog.info('Live session marked ready', {
      op: 'markLiveSessionReady',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: saved.id,
      count: slides.length,
    });

    return toSessionDto(saved, slides, {
      batchId: batch.id as string,
      canStart: batchAllowsStart(batch),
      editable: false,
    });
  }

  /** Send a Ready session back to Draft so its Slides can be changed again. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Return a Ready session to Draft',
      description: 'Reopens editing. Only from Ready. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The Draft session DTO'}},
    },
  })
  async returnLiveSessionToDraft(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'returnLiveSessionToDraft');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    if (session.get('status') !== SESSION_STATUS.READY) {
      throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_READY);
    }

    const saved = await setSessionStatus(session, SESSION_STATUS.DRAFT);
    const slides = await findSlidesForSession(saved.id);

    liveLog.info('Live session returned to draft', {
      op: 'returnLiveSessionToDraft',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: saved.id,
    });

    return toSessionDto(saved, slides, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /**
   * Copy a completed session into a new Draft.
   *
   * Metadata and Slides only. **No** responses, no locks, no timestamps, and no
   * live state — the copy is a fresh lecture that happens to ask the same
   * questions, not a second view of the one that already happened.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Duplicate a session as a Draft',
      description: 'Copies metadata and Slides. Never responses or live state.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The new Draft session DTO'}},
    },
  })
  async duplicateLiveSession(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'duplicateLiveSession');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    if (batchIsReadOnly(batch)) throw batchError(BatchError.BATCH_READ_ONLY);

    const copy = await createSession({
      batchId: batch.id as string,
      title: String(session.get('title') ?? '').slice(0, 150),
      description: session.get('description'),
      sessionDate: session.get('sessionDate') as Date,
      createdBy: admin,
    });

    const slides = await findSlidesForSession(session.id);
    const copies: Parse.Object[] = [];
    for (const [index, slide] of slides.entries()) {
      const type = slide.get('type');
      const {values} = validateSlide(slideAsInput(slide, {freshOptionIds: true}), {
        existingType: type,
      });
      copies.push(await createSlide(copy.id, values, index));
    }

    liveLog.info('Live session duplicated', {
      op: 'duplicateLiveSession',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: copy.id,
      count: copies.length,
    });

    return toSessionDto(copy, copies, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }
}

@Route('live-slides')
class LiveSlideAdminFunctions {
  /** Add one Slide to a Draft session. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, type: {required: true, type: String}},
    },
    swagger: {
      summary: 'Add a Slide',
      description: 'Information or Question. Draft only. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The session DTO with the new Slide'}},
    },
  })
  async addLiveSlide(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'addLiveSlide');
    rejectPrivilegedParams(req, 'addLiveSlide');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'addLiveSlide');

    const existing = await findSlidesForSession(session.id);
    if (existing.length >= SLIDE_COUNT.max) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, {slides: 'TOO_LONG'});
    }

    const {values, errors} = validateSlide(params);
    if (Object.keys(errors).length > 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, errors);
    }

    const slide = await createSlide(session.id, values, existing.length);

    liveLog.info('Slide added', {
      op: 'addLiveSlide',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: session.id,
      slideId: slide.id,
      slideType: values.type,
    });

    return toSessionDto(session, [...existing, slide], {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /** Change one Slide's own fields. Its type never changes. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, slideId: {required: true, type: String}},
    },
    swagger: {
      summary: 'Update a Slide',
      description: 'Draft only. The Slide type cannot change. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The session DTO'}},
    },
  })
  async updateLiveSlide(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'updateLiveSlide');
    rejectPrivilegedParams(req, 'updateLiveSlide');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'updateLiveSlide');

    const slide = await findSlideById(params['slideId']);
    if (!slide || (slide.get('session') as Parse.Object | undefined)?.id !== session.id) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);
    }

    const {values, errors} = validateSlide(params, {
      existingType: slide.get('type'),
      existingOptions: optionsOf(slide),
    });
    if (Object.keys(errors).length > 0) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, errors);
    }

    await updateSlide(slide, values);
    const slides = await findSlidesForSession(session.id);

    liveLog.info('Slide updated', {
      op: 'updateLiveSlide',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: session.id,
      slideId: slide.id,
    });

    return toSessionDto(session, slides, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /** Copy one Slide, placing the copy immediately after it. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, slideId: {required: true, type: String}},
    },
    swagger: {
      summary: 'Duplicate a Slide',
      description: 'Draft only. Options get fresh ids. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The session DTO'}},
    },
  })
  async duplicateLiveSlide(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'duplicateLiveSlide');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'duplicateLiveSlide');

    const slide = await findSlideById(params['slideId']);
    if (!slide || (slide.get('session') as Parse.Object | undefined)?.id !== session.id) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);
    }

    const existing = await findSlidesForSession(session.id);
    if (existing.length >= SLIDE_COUNT.max) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, {slides: 'TOO_LONG'});
    }

    const type = slide.get('type');
    const {values} = validateSlide(slideAsInput(slide, {freshOptionIds: true}), {
      existingType: type,
    });

    const copy = await createSlide(session.id, values, existing.length);

    // Place the copy directly after its original rather than at the end, which
    // is where somebody duplicating a Slide expects to find it.
    const order = existing.map(item => item.id);
    const at = order.indexOf(slide.id);
    order.splice(at + 1, 0, copy.id);
    const reordered = await applySlideOrder(session.id, order);

    liveLog.info('Slide duplicated', {
      op: 'duplicateLiveSlide',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: session.id,
      slideId: copy.id,
    });

    return toSessionDto(session, reordered, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /** Remove one Slide from a Draft session. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, slideId: {required: true, type: String}},
    },
    swagger: {
      summary: 'Delete a Slide',
      description: 'Draft only. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The session DTO'}},
    },
  })
  async deleteLiveSlide(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'deleteLiveSlide');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'deleteLiveSlide');

    const slide = await findSlideById(params['slideId']);
    if (!slide || (slide.get('session') as Parse.Object | undefined)?.id !== session.id) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);
    }

    await deleteSlideRow(slide);

    // Close the gap the deletion left, so positions stay 0..n-1.
    const remaining = await findSlidesForSession(session.id);
    const reordered = await applySlideOrder(
      session.id,
      remaining.map(item => item.id)
    );

    liveLog.info('Slide deleted', {
      op: 'deleteLiveSlide',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      sessionId: session.id,
      count: reordered.length,
    });

    return toSessionDto(session, reordered, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }

  /** Put a Draft session's Slides in a new order. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'Reorder Slides',
      description:
        'Apply a whole new order. The set is rewritten 0..n-1 in one save, so ' +
        'two concurrent reorders cannot interleave. Draft only. Admins only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'The session DTO in its new order'}},
    },
  })
  async reorderLiveSlides(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'reorderLiveSlides');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {session, batch} = await requireSession(params['sessionId']);
    requireEditable(session, 'reorderLiveSlides');

    const orderedIds = parseOrderedIds(params['orderedIds']);
    if (!orderedIds) {
      throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, {orderedIds: 'INVALID'});
    }

    const reordered = await applySlideOrder(session.id, orderedIds);

    liveLog.info('Slides reordered', {
      op: 'reorderLiveSlides',
      stage: 'reorder',
      ok: true,
      userId: admin.id,
      sessionId: session.id,
      count: reordered.length,
    });

    return toSessionDto(session, reordered, {
      batchId: batch.id as string,
      canStart: false,
      editable: true,
    });
  }
}

export {LiveSessionAdminFunctions, LiveSlideAdminFunctions, requireBatch, summarise};
