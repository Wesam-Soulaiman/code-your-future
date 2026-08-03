/**
 * Student profile constants — the single source of truth for validation.
 *
 * Every bound, list, and pattern the profile depends on lives here so the rules
 * are stated once and can be read at a glance. `frontend/src/app/utils/
 * student-profile-constants.ts` mirrors this file; a test asserts the two stay
 * in step, because a frontend that validates differently from the backend either
 * blocks something the server would accept or promises something it will reject.
 *
 * The backend is always the authority: the frontend copy exists to give fast,
 * friendly feedback, never to decide.
 */

/** Education status — exactly the two values the product defines. */
export const EDUCATION_STATUS = {
  CURRENT_STUDENT: 'Current Student',
  GRADUATE: 'Graduate',
} as const;

export type EducationStatus = (typeof EDUCATION_STATUS)[keyof typeof EDUCATION_STATUS];

export const EDUCATION_STATUSES: readonly EducationStatus[] = [
  EDUCATION_STATUS.CURRENT_STUDENT,
  EDUCATION_STATUS.GRADUATE,
];

/**
 * The four selections that come from `ProfileCatalogItem` ⟨CP3A catalog⟩.
 *
 * City, institution, major, and target role were free text (or, for the
 * institution, a hard-coded array) in the first cut of Checkpoint 3A. They are
 * now **catalog references**: the request carries an id, the backend resolves
 * the authoritative item, and no name the browser sends is ever trusted or
 * stored. The escape hatch for an unlisted institution survives as the catalog
 * item flagged `isOther`, which is what still demands a typed name.
 *
 * The stored column names are `city`, `institution`, `major`, and `targetRole`;
 * a request names them with an `Id` suffix, so nothing about a pointer leaks
 * into the request vocabulary.
 */
export const CATALOG_REFERENCE_FIELDS = {
  city: {param: 'cityId', type: 'CITY', required: true},
  institution: {param: 'institutionId', type: 'INSTITUTION', required: true},
  major: {param: 'majorId', type: 'MAJOR', required: true},
  targetRole: {param: 'targetRoleId', type: 'TARGET_ROLE', required: false},
} as const;

export type CatalogReferenceField = keyof typeof CATALOG_REFERENCE_FIELDS;

export const CATALOG_REFERENCE_NAMES: readonly CatalogReferenceField[] = [
  'city',
  'institution',
  'major',
  'targetRole',
];

/** Length bounds. Generous enough for real names, tight enough to bound storage. */
export const LIMITS = {
  fullName: {min: 2, max: 120},
  phone: {min: 6, max: 32},
  customInstitutionName: {min: 2, max: 160},
  careerGoal: {max: 500},
  /**
   * "Why did you choose this role?" — the same bound as the career goal.
   *
   * It is a sentence or two about what somebody wants to do, not an assessment
   * and not something anybody scores. 500 characters is enough to answer
   * properly and short enough that nobody mistakes it for an essay.
   */
  targetRoleReason: {max: 500},
  url: {max: 300},
} as const;

/**
 * Date of birth bounds. A profile is for a person old enough to be a learner and
 * young enough to be alive; both ends catch typos rather than police anybody.
 */
export const DATE_OF_BIRTH = {minAge: 14, maxAge: 100} as const;

/** Graduation month bounds, relative to the current year. */
export const GRADUATION_YEAR = {minOffset: -60, maxOffset: 15} as const;

/** Domains the social links must belong to. */
export const URL_HOSTS = {
  github: ['github.com', 'www.github.com'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
} as const;

/** Schemes accepted on every URL field. */
export const URL_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * Photo rules.
 *
 * 5 MiB matches the product requirement. The accepted types are the three
 * formats browsers actually produce from a camera roll or a screenshot; every
 * upload is re-encoded to WebP server-side regardless, so this list bounds what
 * we are willing to *decode*, not what we store.
 */
export const PHOTO = {
  maxBytes: 5 * 1024 * 1024,
  maxWidth: 1024,
  quality: 82,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  extensions: ['jpg', 'jpeg', 'png', 'webp'] as readonly string[],
} as const;

/**
 * Magic-byte signatures, checked against the actual bytes.
 *
 * A filename and a `Content-Type` are both attacker-controlled. These are what
 * the file *is*.
 */
export const PHOTO_SIGNATURES: readonly {
  mime: string;
  test: (bytes: Buffer) => boolean;
}[] = [
  {
    mime: 'image/jpeg',
    test: bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: bytes =>
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    test: bytes =>
      bytes.length > 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP',
  },
];

/**
 * The **only** fields a client may send when saving a profile.
 *
 * `verifiedEmail`, `user`, `photo`, and `isComplete` are absent on purpose: the
 * first two are derived from the authenticated session, the third is set by the
 * photo endpoint, and the fourth is calculated server-side.
 *
 * The four catalog selections appear as ids. A name is never accepted — the
 * backend resolves the item and stores the pointer.
 */
export const WRITABLE_PROFILE_FIELDS: readonly string[] = [
  'fullName',
  'phone',
  'cityId',
  'dateOfBirth',
  'institutionId',
  'customInstitutionName',
  'majorId',
  'educationStatus',
  'expectedGraduationMonth',
  'careerGoal',
  'targetRoleId',
  'targetRoleReason',
  'githubUrl',
  'linkedinUrl',
  'portfolioUrl',
];

/**
 * Fields that must be present and valid before a profile counts as complete.
 *
 * `targetRole` and `targetRoleReason` are deliberately absent: they are optional
 * by product decision, and a profile is finished without them.
 */
export const REQUIRED_PROFILE_FIELDS: readonly string[] = [
  'fullName',
  'verifiedEmail',
  'phone',
];

/** Catalog selections that must be present before a profile counts as complete. */
export const REQUIRED_CATALOG_FIELDS: readonly CatalogReferenceField[] = [
  'city',
  'institution',
  'major',
];
