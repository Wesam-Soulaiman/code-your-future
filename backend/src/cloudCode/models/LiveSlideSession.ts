import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {
  LIVE_LIMITS,
  SESSION_STATUS,
  SESSION_STATUSES,
  SessionStatus,
} from '../modules/LiveSlides/constants';

/**
 * `LiveSlideSession` — one interactive lecture for one Batch ⟨CP6⟩.
 *
 * ── Why a session owns its Slides instead of reusing a deck ─────────────────
 * A reusable deck and a session that presents it are two objects that must agree
 * about what was asked, and they stop agreeing the moment somebody edits the
 * deck after a lecture. A Student's answer would then hang off a question that
 * no longer says what they answered — which is not a record of anything.
 *
 * So a session **owns** its Slides. Duplicating a completed session copies the
 * Slides into a new Draft; the original stays exactly as it was presented.
 *
 * ── `liveForBatch` is a sentinel, not a duplicate ───────────────────────────
 * "Only one Live session per Batch" is enforced by a **unique partial index** on
 * a pointer that exists only while the session is Live, not by an application
 * check two concurrent starts could both pass. It is the same mechanism
 * `BatchInvitation.currentForBatch` uses, for the same reason: a rule that two
 * requests can race past is not a rule.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No join code, no public link, no meeting URL, no attendance list, no score, no
 * evaluation, and no generic metadata column. Students and Admin are in the same
 * room; everything a remote session would need is absent on purpose.
 */
@ParseClass('LiveSlideSession', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'batch',
        'title',
        'description',
        'sessionDate',
        'status',
        'liveForBatch',
        'currentSlide',
        'currentSlideIndex',
        'startedBy',
        'startedAt',
        'completedAt',
        'createdBy',
      ],
      authenticated: [
        'batch',
        'title',
        'description',
        'sessionDate',
        'status',
        'liveForBatch',
        'currentSlide',
        'currentSlideIndex',
        'startedBy',
        'startedAt',
        'completedAt',
        'createdBy',
      ],
    },
  },
  // Deny-by-default. Every read and write goes through an authorised operation
  // using the master key; no per-record ACL grants anybody direct access.
  ACL: {},
  compoundIndexes: [
    {
      // **At most one Live session per Batch**, enforced by the database.
      //
      // `_p_liveForBatch` is the MongoDB column the pointer occupies. The
      // pointer is set when a session starts and unset when it completes, so
      // every non-live row sits outside the partial index and cannot collide —
      // while two simultaneous starts on one Batch cannot both win.
      fields: ['_p_liveForBatch'],
      unique: true,
      name: 'live_session_live_per_batch_unique',
      partialFilterNulls: true,
    },
    {
      // The Batch's session list, filtered and sorted in one index.
      fields: ['_p_batch', 'status'],
      name: 'live_session_batch_status_index',
    },
  ],
  description:
    'One interactive lecture for one Batch. Owns its Slides; frozen once it ' +
    'starts. Never readable or writable directly by any client.',
})
export default class LiveSlideSession extends BaseModel {
  constructor() {
    super('LiveSlideSession');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'The Batch this session belongs to. Immutable after creation',
  })
  batch!: Parse.Object;

  @ParseField({type: 'String', required: true, description: 'Session title'})
  title!: string;

  @ParseField({type: 'String', description: 'Optional description'})
  description!: string;

  @ParseField({
    type: 'Date',
    required: true,
    description: 'The day of the lecture. Informational — it starts nothing',
  })
  sessionDate!: Date;

  @ParseField({
    type: 'String',
    required: true,
    description: 'draft | ready | live | completed',
  })
  status!: SessionStatus;

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    description: 'Set only while Live. The sentinel behind the unique index',
  })
  liveForBatch!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: 'LiveSlide',
    description: 'The Slide being presented right now',
  })
  currentSlide!: Parse.Object;

  @ParseField({type: 'Number', description: 'Position of the current Slide, 0-based'})
  currentSlideIndex!: number;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    description: 'The Admin who started it. Resolved from the session, never sent',
  })
  startedBy!: Parse.User;

  @ParseField({type: 'Date', description: 'When it went Live. Server clock only'})
  startedAt!: Date;

  @ParseField({type: 'Date', description: 'When it completed. Server clock only'})
  completedAt!: Date;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Admin who created it. Resolved from the session, never sent',
  })
  createdBy!: Parse.User;

  /**
   * The invariants, enforced here as well as in the operations.
   *
   * The cloud functions check all of this first. This trigger exists because a
   * rule that lives in only one call path stops being true the moment somebody
   * adds a second one.
   */
  @BeforeSave({description: 'Reject client writes, bound the status, freeze the Batch'})
  static async onBeforeSave(
    request: Parse.Cloud.BeforeSaveRequest<LiveSlideSession>
  ): Promise<void> {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'LiveSlideSession is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      if (!object.get('batch')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A session requires a Batch');
      }
      if (!object.get('createdBy')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A session requires a creator');
      }
    } else if (object.dirty('batch')) {
      // A session that could change Batch would carry its Students' answers
      // into a cohort those Students are not in.
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A session cannot change Batch after creation'
      );
    }

    const status = object.get('status');
    if (!SESSION_STATUSES.includes(status as SessionStatus)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported session status');
    }

    const title = object.get('title');
    if (
      typeof title !== 'string' ||
      title.trim().length < LIVE_LIMITS.sessionTitle.min ||
      title.trim().length > LIVE_LIMITS.sessionTitle.max
    ) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A session requires a title');
    }

    if (!(object.get('sessionDate') instanceof Date)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A session requires a date');
    }

    // The sentinel exists exactly while the session is Live. Enforced here so no
    // call path can leave a completed session holding the Batch's one Live slot.
    const isLive = status === SESSION_STATUS.LIVE;
    if (isLive && !object.get('liveForBatch')) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'A live session must hold the Batch live sentinel'
      );
    }
    if (!isLive && object.get('liveForBatch')) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Only a live session may hold the Batch live sentinel'
      );
    }

    // Deny-by-default at the record level too.
    object.setACL(new Parse.ACL());
  }
}
