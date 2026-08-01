import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

/**
 * `StudentAuthIdentity` — the link between an external identity provider account
 * and a Code Your Future Student.
 *
 * This is the smallest record that can answer one question: *which Student does
 * this Google account belong to?* It stores the provider name, the provider's
 * stable subject identifier, and a pointer to the `_User`. Nothing else.
 *
 * Deliberately NOT stored:
 *   - the Google credential (the ID token) or any part of it,
 *   - an OAuth access or refresh token,
 *   - the verified email, display name, picture, locale, or any other claim.
 *
 * Claims are consumed at verification time and used to populate `_User`; the
 * identity record keeps only what is needed to recognise a returning Student.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every class-level operation, an empty default object ACL,
 * and `protectedFields` covering every column. No client session can find, get,
 * count, create, update, or delete an identity, and there is no cloud function
 * that returns one — the record is invisible to the API surface.
 *
 * ── Uniqueness ──────────────────────────────────────────────────────────────
 * Two unique compound indexes are declared, and both are applied to MongoDB at
 * startup by `applyUniqueIndexes()` in `app.ts`:
 *
 *   1. (provider, providerSubject) — one Google account maps to exactly one
 *      Student. This is what makes concurrent first sign-ins safe: the second
 *      writer loses at the database, not in application memory.
 *   2. (provider, _p_user) — one Student holds at most one identity per
 *      provider, so a Student can never accumulate duplicate records.
 *
 * `_p_user` is the MongoDB column name for the `user` pointer: Parse stores a
 * Pointer field as `_p_<field>`. Naming the logical field `user` here would
 * index a column that does not exist, so the storage name is used deliberately.
 * `partialFilterNulls` restricts each index to documents where both columns are
 * present, so a malformed row can never collide with a well-formed one.
 */
@ParseClass('StudentAuthIdentity', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      // Every column is hidden from any non-master caller. Even if a future
      // query somehow reached this class, it would read an empty shell.
      '*': ['provider', 'providerSubject', 'user', 'providerPictureUrl'],
      authenticated: ['provider', 'providerSubject', 'user', 'providerPictureUrl'],
    },
  },
  // Deny-by-default object ACL. The server-controlled flow that creates the
  // record leaves it that way — nobody but the master key may read it.
  ACL: {},
  compoundIndexes: [
    {
      fields: ['provider', 'providerSubject'],
      unique: true,
      name: 'provider_subject_unique',
      partialFilterNulls: true,
    },
    {
      // See the note above: `_p_user` is the stored column for the pointer.
      fields: ['provider', '_p_user'],
      unique: true,
      name: 'provider_user_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'Link between an external identity-provider account and a Student. ' +
    'Server-controlled; never readable or writable by a client.',
})
export default class StudentAuthIdentity extends BaseModel {
  constructor() {
    super('StudentAuthIdentity');
  }

  @ParseField({
    type: 'String',
    required: true,
    description: "Identity provider name, e.g. 'google'",
  })
  provider!: string;

  @ParseField({
    type: 'String',
    required: true,
    description:
      "The provider's stable subject identifier for this account " +
      '(Google `sub`). Never returned by any API.',
  })
  providerSubject!: string;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Student this identity belongs to',
  })
  user!: Parse.User;

  /**
   * The provider's avatar URL, captured at first sign-in ⟨CP3A catalog⟩.
   *
   * It lives here rather than on `_User` or on the profile because it is
   * **provider identity data**, the same as the subject beside it — and because
   * putting it on the profile would place an unauthenticated address for a
   * photograph of a person one careless DTO away from a browser.
   *
   * Written once, read once: the first profile save fetches the image, stores a
   * private re-encoded copy, and never consults this column again. It is in
   * `protectedFields` and appears in no DTO and no log.
   */
  @ParseField({
    type: 'String',
    description:
      "The provider's avatar URL, used once to import a profile photo. " +
      'Never returned by any API.',
  })
  providerPictureUrl!: string;

  // ==================== TRIGGERS ====================

  /**
   * The record is server-controlled in the strongest sense available: a
   * non-master save is refused outright, and the three identity columns are
   * immutable once written.
   *
   * The CLP already denies client writes; this is the second layer, and it also
   * protects against a future cloud function that saves without the master key
   * by accident.
   */
  @BeforeSave({description: 'Reject client writes and freeze identity fields'})
  static async onBeforeSave(
    request: Parse.Cloud.BeforeSaveRequest<StudentAuthIdentity>
  ) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Identity records are server-controlled'
      );
    }

    if (object.dirty('ACL')) {
      // Even a master-key caller must not widen access to this class.
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Identity records cannot be made public'
        );
      }
    }

    if (object.isNew()) return;

    for (const field of ['provider', 'providerSubject', 'user'] as const) {
      if (object.dirty(field)) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Identity fields cannot be reassigned'
        );
      }
    }
  }
}
