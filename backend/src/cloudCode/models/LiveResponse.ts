import {
  ParseClass,
  ParseField,
  BaseModel,
  BeforeSave,
  BeforeDelete,
} from '@90soft/parse-server-kit';

import {isAnswerType} from '../modules/LiveSlides/constants';

/**
 * `LiveResponse` — one Student's answer to one Question, permanently ⟨CP6⟩.
 *
 * ── Immutable is a property of the class, not a rule in a function ──────────
 * The product promise made to every Student is one sentence: *you cannot change
 * your answer after submitting it.* A promise enforced only by the operation
 * that happens to write the row is a promise that lasts until somebody adds a
 * second write path.
 *
 * So it is enforced here. `beforeSave` refuses any update to an existing row and
 * `beforeDelete` refuses every deletion — including with the master key, and
 * including by an Admin. There is no correction workflow and no edit endpoint,
 * because there is nowhere for one to write.
 *
 * ── One answer per Student per Question, by index ───────────────────────────
 * A unique compound index on `(session, slide, student)` is what makes two
 * simultaneous submissions produce exactly one row. An application check would
 * let both pass and the second would overwrite the first — which is the one
 * outcome the immutability promise cannot survive.
 *
 * ── Why the Batch and profile pointers are stored ──────────────────────────
 * Both are derivable from the session and the Student, and both are stored
 * anyway: `batch` so a cross-Batch read can be refused without a join, and
 * `studentProfile` because the product says these answers are *part of the
 * Student's profile history*. That link is the whole reason the profile itself
 * does not carry an unbounded array of answers — see the note in
 * `docs/TEMPLATE_ARCHITECTURE.md` §20.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No score, no grade, no correctness flag, no feedback, no evaluation, no
 * reviewer, no edit history — there is nothing to keep a history of — and no
 * generic metadata column.
 */
@ParseClass('LiveResponse', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'session',
        'slide',
        'batch',
        'student',
        'studentProfile',
        'answerType',
        'textAnswer',
        'selectedOptionId',
        'selectedOptionIds',
        'submittedAt',
      ],
      authenticated: [
        'session',
        'slide',
        'batch',
        'student',
        'studentProfile',
        'answerType',
        'textAnswer',
        'selectedOptionId',
        'selectedOptionIds',
        'submittedAt',
      ],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // **One response per Student per Question.** This is the concurrency
      // guarantee: two simultaneous submissions cannot both win, and the loser
      // is reported as ALREADY_SUBMITTED rather than overwriting the winner.
      fields: ['_p_session', '_p_slide', '_p_student'],
      unique: true,
      name: 'live_response_unique',
      partialFilterNulls: true,
    },
    {
      // The Admin's live panel and the by-Question results: every answer to one
      // Slide of one session.
      fields: ['_p_session', '_p_slide'],
      name: 'live_response_session_slide_index',
    },
    {
      // The Student Detail answer history: this profile's answers, newest first.
      fields: ['_p_studentProfile', 'submittedAt'],
      name: 'live_response_profile_submitted_index',
    },
  ],
  description:
    'One Student answer to one Question. Create-only: it can never be ' +
    'updated or deleted, by anybody, including the master key.',
})
export default class LiveResponse extends BaseModel {
  constructor() {
    super('LiveResponse');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'LiveSlideSession',
    required: true,
    description: 'The session this answer belongs to',
  })
  session!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: 'LiveSlide',
    required: true,
    description: 'The Question answered',
  })
  slide!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'Denormalised from the session, so a cross-Batch read needs no join',
  })
  batch!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Student. Resolved from the session token, never sent',
  })
  student!: Parse.User;

  @ParseField({
    type: 'Pointer',
    targetClass: 'StudentProfile',
    required: true,
    description: 'The profile this answer is part of. Resolved server-side',
  })
  studentProfile!: Parse.Object;

  @ParseField({
    type: 'String',
    required: true,
    description: 'Copied from the Slide at submission, never from the request',
  })
  answerType!: string;

  @ParseField({type: 'String', description: 'Short or long text answer'})
  textAnswer!: string;

  @ParseField({type: 'String', description: 'Poll or single-choice selection'})
  selectedOptionId!: string;

  @ParseField({type: 'Array', description: 'Multiple-choice selections'})
  selectedOptionIds!: string[];

  @ParseField({
    type: 'Date',
    required: true,
    description: 'Server clock at submission. A client timestamp is never trusted',
  })
  submittedAt!: Date;

  /**
   * Create-only, at the database boundary.
   *
   * The `isNew()` check is the whole immutability guarantee. Everything else
   * here bounds what a *new* row may contain.
   */
  @BeforeSave({description: 'Create-only. Refuse every update, including with the master key'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<LiveResponse>): Promise<void> {
    const object = request.object;

    if (!object.isNew()) {
      // Deliberately outside the master-key check: a submitted answer is not
      // editable by anybody, and "the server did it" is not an exception. If a
      // correction is ever wanted it needs a product decision and a new record
      // type, not a quiet update path.
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A submitted answer can never be changed'
      );
    }

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'LiveResponse is written only by authorised server operations'
      );
    }

    for (const required of ['session', 'slide', 'batch', 'student', 'studentProfile']) {
      if (!object.get(required)) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `A response requires ${required}`);
      }
    }

    if (!isAnswerType(object.get('answerType'))) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported answer type');
    }

    if (!(object.get('submittedAt') instanceof Date)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A response requires a server timestamp');
    }

    object.setACL(new Parse.ACL());
  }

  /**
   * Deletion is refused for everybody.
   *
   * Not "refused for clients" — refused. A Student's answer is part of their
   * record, and a record that an Admin can quietly remove is not a record.
   */
  @BeforeDelete({description: 'A submitted answer can never be deleted'})
  static async onBeforeDelete(): Promise<void> {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'A submitted answer can never be deleted'
    );
  }
}
