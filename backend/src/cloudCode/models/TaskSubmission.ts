import {ParseClass, ParseField, BaseModel, BeforeSave, BeforeDelete} from '@90soft/parse-server-kit';

import {
  SUBMISSION_STATUS,
  SUBMISSION_STATUSES,
  SubmissionStatus,
  TASK_LIMITS,
  TECHNOLOGY_COUNT,
} from '../modules/BatchTask/constants';

/**
 * `TaskSubmission` — one Student's answer to one Task ⟨CP7⟩.
 *
 * ── One mutable row, and no version history ─────────────────────────────────
 * A Student may edit and resubmit until the deadline. Each edit updates **this
 * row**; nothing is snapshotted. That is a product decision with teeth: there is
 * no version table, no version number, no archived payload, and therefore no
 * quiet second copy of somebody's work sitting in the database after they
 * changed their mind about it. The latest stored data is the whole truth.
 *
 * ── `hasEverBeenSubmitted` is why deletion stops ────────────────────────────
 * A Draft that was never submitted is somebody's scratch work and they may
 * delete it. Once a Submission has been submitted even once, it is a record that
 * this Student handed something in — and saving it back to Draft must not become
 * a way to erase that. The flag is set by the server on the first Submit and
 * never cleared; `beforeDelete` reads it.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No score, grade, feedback, reviewer, review state, or comment thread. No
 * `LATE` status — there are no late submissions, so there is nothing to label.
 * No version pointer. Every one of those was named out of scope.
 */
@ParseClass('TaskSubmission', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'task',
        'batch',
        'student',
        'studentProfile',
        'status',
        'hasEverBeenSubmitted',
        'githubUrl',
        'liveDemoUrl',
        'googleDriveUrl',
        'youtubeVideoId',
        'studentNote',
        'publicProjectTitle',
        'publicProjectDescription',
        'technologies',
        'myContribution',
        'demoTitle',
        'demoVideoUrl',
        'demoVideoId',
        'publicConsent',
        'publicConsentAt',
        'submittedAt',
      ],
      authenticated: [
        'task',
        'batch',
        'student',
        'studentProfile',
        'status',
        'hasEverBeenSubmitted',
        'githubUrl',
        'liveDemoUrl',
        'googleDriveUrl',
        'youtubeVideoId',
        'studentNote',
        'publicProjectTitle',
        'publicProjectDescription',
        'technologies',
        'myContribution',
        'demoTitle',
        'demoVideoUrl',
        'demoVideoId',
        'publicConsent',
        'publicConsentAt',
        'submittedAt',
      ],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // **One Submission per Student per Task.** This is the concurrency
      // guarantee: two simultaneous saves cannot both create a row, and the
      // loser is reported as a conflict rather than silently overwriting.
      fields: ['_p_task', '_p_student'],
      unique: true,
      name: 'task_submission_unique',
      partialFilterNulls: true,
    },
    {
      // The Admin's per-Task status table.
      fields: ['_p_task', 'status'],
      name: 'task_submission_task_status_index',
    },
    {
      // The Student Detail history: this profile's submissions, newest first.
      fields: ['_p_studentProfile', 'updatedAt'],
      name: 'task_submission_profile_updated_index',
    },
    {
      // Batch-wide counts.
      fields: ['_p_batch', 'status'],
      name: 'task_submission_batch_status_index',
    },
  ],
  description:
    'One Student answer to one Task. One mutable row — there is no version ' +
    'history. Never readable or writable directly by any client.',
})
export default class TaskSubmission extends BaseModel {
  constructor() {
    super('TaskSubmission');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'BatchTask',
    required: true,
    description: 'The Task this answers. Immutable',
  })
  task!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'Resolved from the Task, never from the request',
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
    description: 'The profile this belongs to. Resolved server-side',
  })
  studentProfile!: Parse.Object;

  @ParseField({type: 'String', required: true, description: 'DRAFT | SUBMITTED'})
  status!: SubmissionStatus;

  @ParseField({
    type: 'Boolean',
    required: true,
    description: 'Set on the first Submit and never cleared. Blocks deletion',
  })
  hasEverBeenSubmitted!: boolean;

  // ── The submitted links ───────────────────────────────────────────────────

  @ParseField({type: 'String', description: 'Canonical HTTPS GitHub URL'})
  githubUrl!: string;

  @ParseField({type: 'String', description: 'Canonical HTTPS public demo URL'})
  liveDemoUrl!: string;

  @ParseField({type: 'String', description: 'Canonical HTTPS Google Drive URL. Never public'})
  googleDriveUrl!: string;

  @ParseField({
    type: 'String',
    description: 'The YouTube video id alone — never a URL and never embed HTML',
  })
  youtubeVideoId!: string;

  @ParseField({type: 'String', description: 'Private note to staff. Never public'})
  studentNote!: string;

  // ── Final Task public project fields ──────────────────────────────────────

  @ParseField({type: 'String', description: 'Final Task only. Public once consented'})
  publicProjectTitle!: string;

  @ParseField({type: 'String', description: 'Final Task only. Public once consented'})
  publicProjectDescription!: string;

  @ParseField({type: 'Array', description: 'Final Task only. Plain strings, deduplicated'})
  technologies!: string[];

  @ParseField({type: 'String', description: 'Final Task only. Public once consented'})
  myContribution!: string;

  /*
    The public demo ⟨CP8⟩.

    Two optional fields the Student may add to a Final Task, and the pair the
    public Talent Reel is built from. Both are optional: a Student who fills in
    neither is still published if the rest of their Final Task qualifies — they
    simply appear without a titled demo, and the "Has demo" filter passes them
    over.

    Three columns for two fields, deliberately. The Student supplies a URL; the
    server keeps the eleven-character id **and** the canonical watch URL it
    rebuilt from that id. Keeping only the id would mean reconstructing a link
    every time one is needed; keeping only the URL would mean parsing it again
    every time an embed is built, which is exactly the place a provider URL
    turns into an injection point.
  */
  @ParseField({type: 'String', description: 'CP8. Optional title for the public demo video'})
  demoTitle!: string;

  @ParseField({
    type: 'String',
    description: 'CP8. Canonical YouTube watch URL, rebuilt from the id. Never as pasted',
  })
  demoVideoUrl!: string;

  @ParseField({
    type: 'String',
    description: 'CP8. The eleven-character YouTube id. Embeds are built from this alone',
  })
  demoVideoId!: string;

  @ParseField({
    type: 'Boolean',
    description: 'The Student’s own consent to public display. Never set by an Admin',
  })
  publicConsent!: boolean;

  @ParseField({type: 'Date', description: 'When consent was given. Server clock only'})
  publicConsentAt!: Date;

  @ParseField({
    type: 'Date',
    description: 'Server clock at Submit. Null while a Draft. A client time is never trusted',
  })
  submittedAt!: Date;

  /**
   * The invariants, at the database boundary.
   *
   * The pointers are frozen after creation: a Submission that could change Task
   * or Student would let one person's work be reattributed to another.
   */
  @BeforeSave({description: 'Reject client writes, freeze the identity, bound the vocabulary'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<TaskSubmission>): Promise<void> {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'TaskSubmission is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      for (const required of ['task', 'batch', 'student', 'studentProfile']) {
        if (!object.get(required)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `A Submission requires ${required}`);
        }
      }
    } else {
      for (const immutable of ['task', 'batch', 'student', 'studentProfile']) {
        if (object.dirty(immutable)) {
          throw new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            `${immutable} cannot change after a Submission is created`
          );
        }
      }
    }

    const status = object.get('status');
    if (!SUBMISSION_STATUSES.includes(status as SubmissionStatus)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported submission status');
    }

    // The flag only ever goes false → true. A save that tried to clear it would
    // be turning a submitted record back into a deletable draft.
    if (!object.isNew() && object.dirty('hasEverBeenSubmitted')) {
      if (object.get('hasEverBeenSubmitted') !== true) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'hasEverBeenSubmitted can never be cleared'
        );
      }
    }
    if (object.get('hasEverBeenSubmitted') === undefined) {
      object.set('hasEverBeenSubmitted', false);
    }

    // A submitted row carries its instant; a draft carries none. Keeping a stale
    // `submittedAt` on a draft would make it look handed in.
    if (status === SUBMISSION_STATUS.SUBMITTED) {
      if (!(object.get('submittedAt') instanceof Date)) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A submitted Submission requires a server timestamp'
        );
      }
      if (object.get('hasEverBeenSubmitted') !== true) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A submitted Submission must be marked as having been submitted'
        );
      }
    } else if (object.get('submittedAt')) {
      object.unset('submittedAt');
    }

    const note = object.get('studentNote');
    if (typeof note === 'string' && note.length > TASK_LIMITS.studentNote.max) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'The note is too long');
    }

    const technologies = object.get('technologies');
    if (technologies !== undefined && technologies !== null) {
      if (!Array.isArray(technologies) || technologies.length > TECHNOLOGY_COUNT.max) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported technologies list');
      }
      if (technologies.some(item => typeof item !== 'string')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A technology must be text');
      }
    }

    // Consent carries its instant, and losing consent loses the instant with it.
    if (object.get('publicConsent') === true) {
      if (!(object.get('publicConsentAt') instanceof Date)) {
        object.set('publicConsentAt', new Date());
      }
    } else if (object.get('publicConsentAt')) {
      object.unset('publicConsentAt');
    }

    object.setACL(new Parse.ACL());
  }

  /**
   * A Submission that has ever been submitted can never be deleted.
   *
   * Not "cannot be deleted by a client" — cannot be deleted. Handing work in is
   * a fact about what happened, and a Student saving it back to Draft must not
   * become a way to remove the record that they did.
   */
  @BeforeDelete({description: 'Refuse deletion once a Submission has ever been submitted'})
  static async onBeforeDelete(
    request: Parse.Cloud.BeforeDeleteRequest<TaskSubmission>
  ): Promise<void> {
    if (request.object.get('hasEverBeenSubmitted') === true) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A Submission that has been submitted can never be deleted'
      );
    }
  }
}
