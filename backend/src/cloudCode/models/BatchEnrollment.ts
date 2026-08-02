import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

/**
 * `BatchEnrollment` — one Student's membership of one Batch.
 *
 * ── One membership per Student per Batch, enforced by the database ──────────
 * The unique compound index on `(batch, student)` is what makes redemption
 * idempotent. Two taps on Join, a double-submitted form, or two devices racing
 * all end with **one** row: the second write loses at the index, and the
 * operation re-reads the winner and reports the Student is already enrolled.
 *
 * An application-level "have they joined already?" check cannot do that — both
 * requests would pass it before either wrote.
 *
 * A Student may join any number of Batches; only the pair is unique.
 *
 * ── What this class deliberately is not ─────────────────────────────────────
 * There is no approval, no rejection, no waitlist, no attendance, no score, no
 * rating, and no removal workflow. Membership is a fact with a date on it. The
 * columns below are the whole of it, and the writable list is closed.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every operation, an empty class ACL, every column in
 * `protectedFields`. A Student reads their own memberships through an operation
 * that resolves them from their session; an Admin reads a Batch's roster
 * through a separate one. No client touches the class.
 */
@ParseClass('BatchEnrollment', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': ['batch', 'student', 'joinedAt', 'invitation'],
      authenticated: ['batch', 'student', 'joinedAt', 'invitation'],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // `_p_batch` and `_p_student` are the MongoDB columns for the pointers;
      // naming the logical fields would index columns that do not exist.
      fields: ['_p_batch', '_p_student'],
      unique: true,
      name: 'batch_enrollment_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    "A Student's membership of a Batch. One per pair, enforced by a unique " +
    'index. Server-controlled; never readable directly by any client.',
})
export default class BatchEnrollment extends BaseModel {
  constructor() {
    super('BatchEnrollment');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'The Batch joined. Immutable after creation.',
  })
  batch!: Parse.Object;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Student who joined. Immutable after creation.',
  })
  student!: Parse.User;

  @ParseField({type: 'Date', required: true, description: 'When they joined'})
  joinedAt!: Date;

  /**
   * Which invitation version was redeemed.
   *
   * Audit only, and never returned in any DTO — it exists so an Admin
   * investigating later can tell which link somebody came in on, not so anybody
   * can trace a Student back to a token.
   */
  @ParseField({
    type: 'Pointer',
    targetClass: 'BatchInvitation',
    description: 'The invitation redeemed. Audit only; never in a DTO.',
  })
  invitation!: Parse.Object;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Reject client writes and freeze the membership pair'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<BatchEnrollment>) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Enrollments are server-controlled'
      );
    }

    if (object.dirty('ACL')) {
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'An enrollment cannot be made public'
        );
      }
    }

    if (object.isNew()) return;

    // Re-pointing either half would move somebody's membership to a different
    // Batch, or hand one Student another Student's place.
    if (object.dirty('batch') || object.dirty('student')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'An enrollment cannot be reassigned'
      );
    }
  }
}
