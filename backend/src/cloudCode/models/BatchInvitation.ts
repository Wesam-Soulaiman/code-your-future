import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {INVITATION_STATES, InvitationState} from '../modules/Batch/invitationConstants';

/**
 * `BatchInvitation` — one current join link per Batch, plus its history.
 *
 * ── The raw token is not here, and never was ────────────────────────────────
 * Only `tokenHash` is stored. The raw token exists for exactly one HTTP
 * response — the generate or rotate call that created it — and is then gone
 * from the server for good. That is why the UI cannot show a link again after a
 * reload, and why it says so rather than pretending otherwise: a hash does not
 * turn back into a token.
 *
 * Redemption works by hashing what a caller presents and looking that up, so
 * the server never needs the original.
 *
 * ── "One current invitation per Batch", enforced by the database ────────────
 * `currentForBatch` points at the Batch **only while this row is the current
 * invitation**, and is unset the moment the row is replaced, revoked, or
 * expired. A unique index on that single column means the database itself
 * guarantees at most one current invitation per Batch.
 *
 * That is deliberate rather than an application check: two Admins rotating at
 * the same instant would both pass a "is there already a current one?" test and
 * both write. Here the second write simply loses at the index, and no Batch can
 * ever have two valid links.
 *
 * Superseded rows are kept with `state` and timestamps, so an Admin can see
 * that a link was rotated on a given day — without any of them being usable and
 * without any raw token surviving anywhere.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every operation, an empty class ACL, every column in
 * `protectedFields`. No client reads this class, ever. The public preview
 * endpoint returns Batch facts, never an invitation record.
 */
@ParseClass('BatchInvitation', {
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
        'currentForBatch',
        'tokenHash',
        'fingerprint',
        'state',
        'expiresAt',
        'revokedAt',
        'replacedAt',
        'version',
        'createdBy',
      ],
      authenticated: [
        'batch',
        'currentForBatch',
        'tokenHash',
        'fingerprint',
        'state',
        'expiresAt',
        'revokedAt',
        'replacedAt',
        'version',
        'createdBy',
      ],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // At most one **current** invitation per Batch, enforced by the database
      // rather than by a check two concurrent rotations could both pass.
      //
      // `_p_currentForBatch` is the MongoDB column for the pointer; naming the
      // logical field would index a column that does not exist.
      // `partialFilterNulls` restricts the index to rows where the column is
      // present, so every superseded row — which unsets it — sits outside the
      // index and cannot collide.
      fields: ['_p_currentForBatch'],
      unique: true,
      name: 'batch_invitation_current_unique',
      partialFilterNulls: true,
    },
    {
      // Redemption looks a token up by its hash. Unique because two invitations
      // sharing a hash would mean a 256-bit collision or a bug, and either way
      // the write should fail rather than create an ambiguity.
      fields: ['tokenHash'],
      unique: true,
      name: 'batch_invitation_token_hash_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'Join links for a Batch. Only a hash of each token is stored; the raw ' +
    'token never persists. Server-controlled; never readable by any client.',
})
export default class BatchInvitation extends BaseModel {
  constructor() {
    super('BatchInvitation');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'The Batch this invitation joins. Immutable after creation.',
  })
  batch!: Parse.Object;

  /**
   * The same Batch, but **only while this row is the current invitation**.
   *
   * Unset on replace, revoke, and expiry. The unique index on this column is
   * what makes "one current invitation per Batch" a database guarantee.
   */
  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    description:
      'Set only while this is the current invitation. Unique per Batch; ' +
      'unset when superseded.',
  })
  currentForBatch!: Parse.Object;

  @ParseField({
    type: 'String',
    required: true,
    description: 'SHA-256 of the token. The raw token is never stored.',
  })
  tokenHash!: string;

  /**
   * A short, safe label for one invitation version.
   *
   * Derived from the **hash**, not the token, so it identifies which link an
   * Admin is looking at in the history without revealing any part of the token
   * itself. Showing the last characters of the real token would have leaked
   * some of it for no benefit.
   */
  @ParseField({
    type: 'String',
    description: 'Short label derived from the hash. Reveals nothing about the token.',
  })
  fingerprint!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'current | replaced | revoked | expired',
  })
  state!: InvitationState;

  @ParseField({type: 'Date', description: 'Optional expiry. Absent means no expiry.'})
  expiresAt!: Date;

  @ParseField({type: 'Date', description: 'When an Admin revoked it'})
  revokedAt!: Date;

  @ParseField({type: 'Date', description: 'When a newer token replaced it'})
  replacedAt!: Date;

  @ParseField({
    type: 'Number',
    description: 'Which generation this is for its Batch. Starts at 1.',
  })
  version!: number;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    description: 'The Admin who created it. Audit only; never in a DTO.',
  })
  createdBy!: Parse.User;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Reject client writes and keep the token hash immutable'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<BatchInvitation>) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Invitations are server-controlled'
      );
    }

    if (!(INVITATION_STATES as readonly string[]).includes(String(object.get('state')))) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unknown invitation state');
    }

    if (object.dirty('ACL')) {
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'An invitation cannot be made public'
        );
      }
    }

    if (object.isNew()) return;

    // Re-pointing a hash would let a superseded row start answering for a live
    // token, which is the one thing that must never happen.
    if (object.dirty('tokenHash') || object.dirty('batch')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'An invitation cannot be re-pointed'
      );
    }
  }
}
