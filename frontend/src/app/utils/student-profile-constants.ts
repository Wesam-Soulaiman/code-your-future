/**
 * Student profile constants — the browser's copy.
 *
 * Mirrors `backend/src/cloudCode/modules/StudentProfile/constants.ts`. A backend
 * test asserts the two stay in step, because a frontend that validates
 * differently either blocks something the server would accept or promises
 * something it will reject.
 *
 * **The backend is always the authority.** These exist to give fast, friendly
 * feedback while somebody types; every value is re-validated server-side, and a
 * server rejection always wins.
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
 * The four selections that come from the profile catalog ⟨CP3A catalog⟩.
 *
 * The hard-coded institution array that used to live here has moved into
 * `ProfileCatalogItem`, so the list is Admin-managed rather than a code change.
 * The request names each selection with an `Id` suffix; a name is never sent.
 */
export const CATALOG_REFERENCE_FIELDS = {
  city: { param: 'cityId', type: 'CITY', required: true },
  institution: { param: 'institutionId', type: 'INSTITUTION', required: true },
  major: { param: 'majorId', type: 'MAJOR', required: true },
  targetRole: { param: 'targetRoleId', type: 'TARGET_ROLE', required: false },
} as const;

export type CatalogReferenceField = keyof typeof CATALOG_REFERENCE_FIELDS;

export const CATALOG_REFERENCE_NAMES: readonly CatalogReferenceField[] = [
  'city',
  'institution',
  'major',
  'targetRole',
];

export const LIMITS = {
  fullName: { min: 2, max: 120 },
  phone: { min: 6, max: 32 },
  customInstitutionName: { min: 2, max: 160 },
  careerGoal: { max: 500 },
  /** "Why did you choose this role?" — optional, and never scored. */
  targetRoleReason: { max: 500 },
  url: { max: 300 },
} as const;

export const DATE_OF_BIRTH = { minAge: 14, maxAge: 100 } as const;
export const GRADUATION_YEAR = { minOffset: -60, maxOffset: 15 } as const;

export const URL_HOSTS = {
  github: ['github.com', 'www.github.com'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
} as const;

export const URL_SCHEMES: readonly string[] = ['http:', 'https:'];

/** Photo rules. 5 MiB matches the product requirement. */
export const PHOTO = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  extensions: ['jpg', 'jpeg', 'png', 'webp'] as readonly string[],
} as const;

/** The `accept` attribute for the file input. */
export const PHOTO_ACCEPT = PHOTO.mimeTypes.join(',');

/** The multipart field name the photo endpoint reads. */
export const PROFILE_PHOTO_FIELD = 'photo';

/** Fields the client may send. Anything else is refused by the backend. */
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
 * Scalar fields that must be valid before the backend will call a profile
 * complete. The three required catalog selections are listed separately.
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
