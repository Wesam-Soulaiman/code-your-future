/**
 * Profile validation — pure functions, no Parse, no I/O.
 *
 * Everything here is deterministic and directly testable. The cloud function
 * calls `validateProfileInput()` once and either saves the normalised result or
 * returns the field map; nothing downstream re-checks or re-interprets.
 *
 * Two rules shape the whole file:
 *
 *   1. **Normalise, then validate.** Values are trimmed and collapsed first, so
 *      `"  Lina   Haddad "` and `"Lina Haddad"` are the same profile and a field
 *      of spaces is empty rather than "present".
 *   2. **Never echo a value.** A rejection carries a field name and a reason
 *      code. Quoting the input back would put a phone number or an email into a
 *      response, a log, or a screenshot.
 */

import {
  DATE_OF_BIRTH,
  EDUCATION_STATUS,
  EducationStatus,
  GRADUATION_YEAR,
  LIMITS,
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  PHONE_PATTERN,
  REQUIRED_PROFILE_FIELDS,
  URL_HOSTS,
  URL_SCHEMES,
  WRITABLE_PROFILE_FIELDS,
} from './constants';
import {FieldErrors, FieldReason} from './errors';

/**
 * The normalised, storable **scalar** shape produced by a successful validation.
 *
 * The four catalog selections are deliberately absent: they need a database
 * lookup, which would make this module impure and untestable without Parse.
 * `catalogRefs.ts` resolves them separately and the repository writes both.
 */
export interface NormalisedProfile {
  fullName: string;
  phone: string;
  dateOfBirth?: Date;
  customInstitutionName?: string;
  educationStatus: EducationStatus;
  expectedGraduationDate?: Date;
  careerGoal?: string;
  targetRoleReason?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
}

export interface ValidationResult {
  values: NormalisedProfile;
  errors: FieldErrors;
}

/**
 * What the scalar validator needs to know about the resolved catalog items.
 *
 * Two scalar rules depend on a selection the database has to answer for:
 * whether a typed institution name is required, and whether the target-role
 * reason has a role to belong to. Passing the two answers in keeps this module
 * pure — it still performs no I/O and is still testable without Parse.
 */
export interface ProfileValidationContext {
  /** True when the chosen institution is the catalog's `isOther` escape hatch. */
  institutionIsOther?: boolean;
  /** True when a target role resolved successfully. */
  hasTargetRole?: boolean;
}

/** Collapse internal whitespace and trim. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Trim only — used where internal spacing is the user's own formatting. */
function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function checkLength(
  value: string,
  bounds: {min?: number; max: number},
  required: boolean
): keyof typeof FieldReason | undefined {
  if (value.length === 0) return required ? 'REQUIRED' : undefined;
  if (bounds.min !== undefined && value.length < bounds.min) return 'TOO_SHORT';
  if (value.length > bounds.max) return 'TOO_LONG';
  return undefined;
}

/**
 * Validate a URL.
 *
 * `new URL()` does the parsing, so no hand-written pattern has to be trusted.
 * Only `http:` and `https:` are accepted, which is what rejects `javascript:`,
 * `data:`, and `file:` — the shapes that turn a profile link into an attack when
 * something later renders it as an anchor.
 *
 * `allowedHosts` pins GitHub and LinkedIn to their real domains. Matching is on
 * the parsed hostname, not on a substring of the string, so
 * `https://github.com.evil.test/x` is refused.
 */
export function validateUrl(
  raw: string,
  allowedHosts?: readonly string[]
): {value?: string; reason?: keyof typeof FieldReason} {
  const value = trimText(raw);
  if (value.length === 0) return {};
  if (value.length > LIMITS.url.max) return {reason: 'TOO_LONG'};

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {reason: 'INVALID'};
  }

  if (!URL_SCHEMES.includes(parsed.protocol)) return {reason: 'INVALID'};
  if (parsed.hostname.length === 0) return {reason: 'INVALID'};

  if (allowedHosts) {
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.includes(host)) return {reason: 'WRONG_DOMAIN'};
    // A bare domain is not a profile link.
    if (parsed.pathname.replace(/\/+$/, '').length === 0) return {reason: 'INVALID'};
  }

  return {value: parsed.toString()};
}

/**
 * Normalise a `YYYY-MM` month to the first day of that month at 00:00:00 UTC.
 *
 * `Date.UTC` is used rather than `new Date('2027-06-01')` so the result never
 * depends on the server's timezone: in a UTC+3 deployment the latter would store
 * the previous month for anyone near a boundary.
 */
export function normaliseGraduationMonth(
  raw: unknown
): {value?: Date; reason?: keyof typeof FieldReason} {
  const value = trimText(raw);
  if (value.length === 0) return {};

  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return {reason: 'INVALID'};

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return {reason: 'INVALID'};

  const currentYear = new Date().getUTCFullYear();
  if (
    year < currentYear + GRADUATION_YEAR.minOffset ||
    year > currentYear + GRADUATION_YEAR.maxOffset
  ) {
    return {reason: 'OUT_OF_RANGE'};
  }

  return {value: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))};
}

/** Render a stored graduation date back to the `YYYY-MM` the UI works in. */
export function toGraduationMonth(value: Date | undefined): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  return `${value.getUTCFullYear()}-${month}`;
}

/** Validate a `YYYY-MM-DD` date of birth. */
function validateDateOfBirth(raw: unknown): {value?: Date; reason?: keyof typeof FieldReason} {
  const value = trimText(raw);
  if (value.length === 0) return {};

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return {reason: 'INVALID'};

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Round-tripping catches impossible dates such as 2001-02-30.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return {reason: 'INVALID'};
  }

  const now = new Date();
  const age = (now.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < DATE_OF_BIRTH.minAge || age > DATE_OF_BIRTH.maxAge) {
    return {reason: 'OUT_OF_RANGE'};
  }

  return {value: parsed};
}

/** Count the digits in a phone string, ignoring formatting. */
function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Validate and normalise everything a client may send.
 *
 * Unknown keys are simply never read: the function reaches into `input` by name,
 * so a `verifiedEmail`, `user`, `isComplete`, or `photo` in the payload has no
 * path to the stored object. `assertNoPrivilegedFields()` additionally refuses
 * the request outright, so a caller attempting it gets told rather than silently
 * ignored.
 */
export function validateProfileInput(
  input: Record<string, unknown>,
  context: ProfileValidationContext = {}
): ValidationResult {
  const errors: FieldErrors = {};

  // ── Identity ─────────────────────────────────────────────────────────────
  const fullName = normaliseText(input['fullName']);
  const fullNameReason = checkLength(fullName, LIMITS.fullName, true);
  if (fullNameReason) errors['fullName'] = FieldReason[fullNameReason];

  // ── Personal ─────────────────────────────────────────────────────────────
  const phone = normaliseText(input['phone']);
  if (phone.length === 0) {
    errors['phone'] = FieldReason.REQUIRED;
  } else if (!PHONE_PATTERN.test(phone)) {
    errors['phone'] = FieldReason.INVALID;
  } else {
    const digits = digitCount(phone);
    if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) {
      errors['phone'] = FieldReason.INVALID;
    }
  }

  const dob = validateDateOfBirth(input['dateOfBirth']);
  if (dob.reason) errors['dateOfBirth'] = FieldReason[dob.reason];

  // ── Education ────────────────────────────────────────────────────────────
  // City, institution, major, and target role are catalog references and are
  // resolved against the database in `catalogRefs.ts`; only the fields that
  // depend on the *outcome* of that resolution are decided here.
  const customInstitutionName = normaliseText(input['customInstitutionName']);
  const needsCustomName = context.institutionIsOther === true;
  if (needsCustomName) {
    const reason = checkLength(customInstitutionName, LIMITS.customInstitutionName, true);
    if (reason) errors['customInstitutionName'] = FieldReason[reason];
  }

  const educationStatus = normaliseText(input['educationStatus']);
  const statusValid =
    educationStatus === EDUCATION_STATUS.CURRENT_STUDENT ||
    educationStatus === EDUCATION_STATUS.GRADUATE;
  if (educationStatus.length === 0) {
    errors['educationStatus'] = FieldReason.REQUIRED;
  } else if (!statusValid) {
    errors['educationStatus'] = FieldReason.NOT_ALLOWED;
  }

  const graduation = normaliseGraduationMonth(input['expectedGraduationMonth']);
  if (graduation.reason) {
    errors['expectedGraduationMonth'] = FieldReason[graduation.reason];
  } else if (educationStatus === EDUCATION_STATUS.CURRENT_STUDENT && !graduation.value) {
    // A current student is by definition heading towards a date.
    errors['expectedGraduationMonth'] = FieldReason.REQUIRED;
  }

  // ── Career and links ─────────────────────────────────────────────────────
  const careerGoal = trimText(input['careerGoal']);
  const careerGoalReason = checkLength(careerGoal, LIMITS.careerGoal, false);
  if (careerGoalReason) errors['careerGoal'] = FieldReason[careerGoalReason];

  /**
   * "Why did you choose this role?" — optional, bounded, and meaningful only
   * alongside a target role.
   *
   * Sending it without a role is not an error: a Student clearing their role is
   * a legitimate save, and refusing it would strand them on a form complaining
   * about a field they can no longer see. The value is dropped instead, which
   * is what the product asks for — the reason belongs to the role.
   *
   * It is a sentence about what somebody wants to do. It is never scored, never
   * ranked, and never part of completion.
   */
  const targetRoleReason = trimText(input['targetRoleReason']);
  const targetRoleReasonKept = context.hasTargetRole === true;
  if (targetRoleReasonKept) {
    const reason = checkLength(targetRoleReason, LIMITS.targetRoleReason, false);
    if (reason) errors['targetRoleReason'] = FieldReason[reason];
  }

  const github = validateUrl(String(input['githubUrl'] ?? ''), URL_HOSTS.github);
  if (github.reason) errors['githubUrl'] = FieldReason[github.reason];

  const linkedin = validateUrl(String(input['linkedinUrl'] ?? ''), URL_HOSTS.linkedin);
  if (linkedin.reason) errors['linkedinUrl'] = FieldReason[linkedin.reason];

  const portfolio = validateUrl(String(input['portfolioUrl'] ?? ''));
  if (portfolio.reason) errors['portfolioUrl'] = FieldReason[portfolio.reason];

  const values: NormalisedProfile = {
    fullName,
    phone,
    educationStatus: educationStatus as EducationStatus,
  };

  if (dob.value) values.dateOfBirth = dob.value;
  // A custom name is only meaningful under the "Other" institution; storing it
  // otherwise would leave a stale value behind after switching institution.
  if (needsCustomName && customInstitutionName) {
    values.customInstitutionName = customInstitutionName;
  }
  // A graduate has already graduated: the product clears the expected date.
  if (educationStatus === EDUCATION_STATUS.CURRENT_STUDENT && graduation.value) {
    values.expectedGraduationDate = graduation.value;
  }
  if (careerGoal) values.careerGoal = careerGoal;
  // Cleared with the role it explains.
  if (targetRoleReasonKept && targetRoleReason) values.targetRoleReason = targetRoleReason;
  if (github.value) values.githubUrl = github.value;
  if (linkedin.value) values.linkedinUrl = linkedin.value;
  if (portfolio.value) values.portfolioUrl = portfolio.value;

  return {values, errors};
}

/**
 * Decide completeness from the **stored** values.
 *
 * Only the required set counts. An optional field that is empty, or invalid in
 * some earlier draft, must never keep a Student out of the product — and the
 * client is never asked, because a client that can declare itself complete is
 * not a check at all.
 */
export function calculateIsComplete(stored: {
  fullName?: unknown;
  verifiedEmail?: unknown;
  phone?: unknown;
  /** Whether each required catalog selection resolved. */
  hasCity?: boolean;
  hasInstitution?: boolean;
  hasMajor?: boolean;
  institutionIsOther?: boolean;
  customInstitutionName?: unknown;
  educationStatus?: unknown;
  expectedGraduationDate?: unknown;
}): boolean {
  const present = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

  for (const field of REQUIRED_PROFILE_FIELDS) {
    if (!present((stored as Record<string, unknown>)[field])) return false;
  }

  // The three required catalog selections. A target role is optional by product
  // decision and is deliberately not consulted here — neither is its reason.
  if (!stored.hasCity || !stored.hasInstitution || !stored.hasMajor) return false;

  if (!present(stored.educationStatus)) return false;

  if (stored.institutionIsOther === true && !present(stored.customInstitutionName)) {
    return false;
  }

  if (
    stored.educationStatus === EDUCATION_STATUS.CURRENT_STUDENT &&
    !(stored.expectedGraduationDate instanceof Date)
  ) {
    return false;
  }

  return true;
}

/**
 * Refuse a request that tries to set a server-controlled column.
 *
 * Ignoring these silently would be safe but dishonest — a caller sending
 * `verifiedEmail` deserves to learn it was refused rather than believe it took.
 */
export function findPrivilegedFields(input: Record<string, unknown>): string[] {
  const forbidden = [
    'user',
    'userId',
    'verifiedEmail',
    'email',
    'isComplete',
    'photo',
    'photoData',
    'objectId',
    'id',
    'ACL',
    'createdAt',
    'updatedAt',
    // The catalog columns hold pointers the backend resolves. A request names
    // them with an `Id` suffix, so a bare `city` or `institution` in the payload
    // is somebody trying to write a name straight into the record.
    'city',
    'institution',
    'major',
    'targetRole',
  ];
  return forbidden.filter(key => Object.prototype.hasOwnProperty.call(input, key));
}

/** Keys a client may legitimately send. Exported for the tests. */
export {WRITABLE_PROFILE_FIELDS};
