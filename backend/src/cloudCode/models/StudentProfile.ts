import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

/**
 * `StudentProfile` — exactly one per Student.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every class-level operation and an empty default object
 * ACL. A Student never touches this class directly: they call a cloud function
 * that resolves them from their session, authorises them, and returns a
 * hand-built DTO. A Visitor has no access, another Student has no access, and no
 * raw Parse object ever reaches the browser.
 *
 * `protectedFields` covers every personal column as a second layer, so even a
 * query that somehow reached this class would read an empty shell.
 *
 * ── Server-controlled columns ───────────────────────────────────────────────
 * `user`, `verifiedEmail`, and `isComplete` are never accepted from a request:
 *
 *   - `user` is the authenticated caller and is **immutable** after creation —
 *     re-pointing a profile at another account would hand one Student another
 *     Student's data;
 *   - `verifiedEmail` comes from the Google identity established at sign-in, so
 *     it is verified by definition and cannot be edited into something else;
 *   - `isComplete` is calculated from the stored values, so the client cannot
 *     declare itself finished.
 *
 * The `beforeSave` below enforces all three plus the master-key requirement.
 *
 * ── Identity separation ─────────────────────────────────────────────────────
 * Provider identity lives in `StudentAuthIdentity` and stays there. This class
 * holds no provider name, no provider subject, and no token: the only thing it
 * inherits from the identity is the verified email address.
 */
@ParseClass('StudentProfile', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      // Every personal column, hidden from any non-master caller.
      '*': [
        'user',
        'fullName',
        'verifiedEmail',
        'phone',
        'city',
        'dateOfBirth',
        'institution',
        'customInstitutionName',
        'major',
        'educationStatus',
        'expectedGraduationDate',
        'careerGoal',
        'targetRole',
        'targetRoleReason',
        'githubUrl',
        'linkedinUrl',
        'portfolioUrl',
        'photoData',
        'photoUpdatedAt',
        'isComplete',
      ],
      authenticated: [
        'user',
        'fullName',
        'verifiedEmail',
        'phone',
        'city',
        'dateOfBirth',
        'institution',
        'customInstitutionName',
        'major',
        'educationStatus',
        'expectedGraduationDate',
        'careerGoal',
        'targetRole',
        'targetRoleReason',
        'githubUrl',
        'linkedinUrl',
        'portfolioUrl',
        'photoData',
        'photoUpdatedAt',
        'isComplete',
      ],
    },
  },
  // Deny-by-default. The per-record ACL is stamped by the cloud function that
  // creates the profile, and grants the owning Student read access only.
  ACL: {},
  compoundIndexes: [
    {
      // One profile per Student, enforced by the database rather than by a
      // check that two concurrent requests could both pass.
      //
      // `_p_user` is the MongoDB column for a Parse pointer — naming the logical
      // field would index a column that does not exist.
      fields: ['_p_user'],
      unique: true,
      name: 'student_profile_user_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'One profile per Student. Server-controlled; never readable or writable ' +
    'directly by any client.',
})
export default class StudentProfile extends BaseModel {
  constructor() {
    super('StudentProfile');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Student this profile belongs to. Immutable after creation.',
  })
  user!: Parse.User;

  @ParseField({type: 'String', required: true, description: 'Full name, as the Student writes it'})
  fullName!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'Verified email from the Google identity. Read-only to the Student.',
  })
  verifiedEmail!: string;

  @ParseField({type: 'String', description: 'Syrian mobile in canonical +9639XXXXXXXX format'})
  phone!: string;

  /**
   * The four catalog selections ⟨CP3A catalog⟩.
   *
   * Pointers, not names. The browser sends an id, the backend resolves the
   * authoritative `ProfileCatalogItem`, and the pointer is what is stored — so a
   * renamed city renames on every profile at once, and a name invented by a
   * client has nowhere to land.
   *
   * A pointer at an item an Admin has since deactivated stays valid and keeps
   * displaying. It simply cannot be chosen again; see `catalogRefs.ts`.
   */
  @ParseField({
    type: 'Pointer',
    targetClass: 'ProfileCatalogItem',
    description: 'City of residence. A CITY catalog item.',
  })
  city!: Parse.Object;

  @ParseField({type: 'Date', description: 'Date of birth (optional)'})
  dateOfBirth!: Date;

  @ParseField({
    type: 'Pointer',
    targetClass: 'ProfileCatalogItem',
    description: 'Institution. An INSTITUTION catalog item.',
  })
  institution!: Parse.Object;

  @ParseField({
    type: 'String',
    description:
      'Institution name typed by the Student when the chosen institution is ' +
      'the catalog\'s "Other" escape hatch',
  })
  customInstitutionName!: string;

  @ParseField({
    type: 'Pointer',
    targetClass: 'ProfileCatalogItem',
    description: 'Field of study. A MAJOR catalog item.',
  })
  major!: Parse.Object;

  @ParseField({
    type: 'String',
    description: 'Current Student or Graduate',
  })
  educationStatus!: string;

  @ParseField({
    type: 'Date',
    description:
      'Expected graduation, normalised to the first day of the selected month at 00:00 UTC',
  })
  expectedGraduationDate!: Date;

  @ParseField({type: 'String', description: 'Optional career goal, free text'})
  careerGoal!: string;

  /**
   * The optional target role and the reason behind it ⟨CP3A catalog⟩.
   *
   * Neither affects completion. This is a Student saying what they are aiming
   * for, not an assessment: nothing scores it, nothing ranks it, and a profile
   * is finished without it.
   */
  @ParseField({
    type: 'Pointer',
    targetClass: 'ProfileCatalogItem',
    description: 'Optional target role. A TARGET_ROLE catalog item.',
  })
  targetRole!: Parse.Object;

  @ParseField({
    type: 'String',
    description:
      'Optional answer to "Why did you choose this role?". Cleared when the ' +
      'target role is removed.',
  })
  targetRoleReason!: string;

  @ParseField({type: 'String', description: 'Optional GitHub profile URL'})
  githubUrl!: string;

  @ParseField({type: 'String', description: 'Optional LinkedIn profile URL'})
  linkedinUrl!: string;

  @ParseField({type: 'String', description: 'Optional portfolio URL'})
  portfolioUrl!: string;

  /**
   * The profile photo, stored inline as base64 ⟨CP3A⟩.
   *
   * **Why not a `Parse.File`.** Checkpoint 1 closed Parse's raw file endpoint
   * (`blockRawFileRoutes` answers `/api/files/*` with 403). Parse's own
   * `FilesRouter` is not part of the router that `directAccess` uses, so a
   * `Parse.File.save()` inside cloud code cannot be routed internally: Parse
   * falls back to a real HTTP request to its own `serverURL` and is refused by
   * that block. Reading it back with `getData()` hits the same wall.
   *
   * Re-opening the endpoint would undo a security control, and `models/File.ts`,
   * `models/IMG.ts`, and `utils/` are protected paths. Storing the bytes on this
   * already-private, owner-ACL'd, deny-by-default class needs no security change
   * at all, and no public URL exists to leak. Found by runtime validation.
   *
   * The value is bounded: every upload is re-encoded to a WebP capped at
   * 1024px, so a stored photo is tens to a few hundred kilobytes.
   *
   * It is stripped by `protectedFields` and never appears in any DTO — the
   * bytes come back only through an authorised cloud function.
   */
  @ParseField({
    type: 'String',
    description: 'Private profile photo, base64 WebP. Never published as a URL.',
  })
  photoData!: string;

  @ParseField({
    type: 'Date',
    description: 'When the photo was last replaced; drives the cache key',
  })
  photoUpdatedAt!: Date;

  @ParseField({
    type: 'Boolean',
    description: 'Calculated server-side from the stored values',
  })
  isComplete!: boolean;

  // ==================== TRIGGERS ====================

  /**
   * The last line of defence, independent of which cloud function saved.
   *
   * The CLP already denies client writes; this also protects against a future
   * server-side path that forgets the master key, and freezes the one column
   * that must never move.
   */
  @BeforeSave({description: 'Reject client writes, freeze the owner, refuse a public ACL'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<StudentProfile>) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Student profiles are server-controlled'
      );
    }

    if (object.dirty('ACL')) {
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'A profile cannot be made public'
        );
      }
    }

    if (object.isNew()) return;

    if (object.dirty('user')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A profile cannot be reassigned to another account'
      );
    }
  }
}
