import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a backend profile failure into translated copy.
 *
 * The backend answers with a stable code and, for a validation failure, a map of
 * **field name → stable reason code**. Neither carries a submitted value, so
 * nothing personal travels in an error and nothing untranslated is ever
 * rendered.
 */

/** Page-level message keys. */
export type ProfileErrorKey =
  | 'student.profile.errors.notAStudent'
  | 'student.profile.errors.validation'
  | 'student.profile.errors.unavailable'
  | 'student.profile.errors.photoRejected'
  | 'student.profile.errors.photoMissing'
  | 'student.profile.errors.photoTooLarge'
  | 'student.profile.errors.photoPartial'
  | 'student.profile.errors.catalogUnavailable'
  | 'student.profile.errors.unexpected';

/** Mirrors `modules/StudentProfile/errors.ts`. */
const CODE_TO_KEY: Record<string, ProfileErrorKey> = {
  NOT_A_STUDENT: 'student.profile.errors.notAStudent',
  VALIDATION_FAILED: 'student.profile.errors.validation',
  PROFILE_UNAVAILABLE: 'student.profile.errors.unavailable',
  PHOTO_REJECTED: 'student.profile.errors.photoRejected',
  PHOTO_NOT_FOUND: 'student.profile.errors.photoMissing',
  PROFILE_SAVE_FAILED: 'student.profile.errors.unexpected',
  CATALOG_VALIDATION_FAILED: 'student.profile.errors.validation',
};

/** Field-level reason codes → translated copy. */
const REASON_TO_KEY: Record<string, string> = {
  REQUIRED: 'student.profile.fieldErrors.required',
  TOO_SHORT: 'student.profile.fieldErrors.tooShort',
  TOO_LONG: 'student.profile.fieldErrors.tooLong',
  INVALID: 'student.profile.fieldErrors.invalid',
  NOT_ALLOWED: 'student.profile.fieldErrors.notAllowed',
  OUT_OF_RANGE: 'student.profile.fieldErrors.outOfRange',
  WRONG_DOMAIN: 'student.profile.fieldErrors.wrongDomain',
};

export interface ProfileFailure {
  key: ProfileErrorKey;
  /** Field name → translation key. Empty unless the backend rejected fields. */
  fields: Record<string, string>;
}

/** Read the stable code and any field map out of a Parse error body. */
function parseMessage(error: HttpErrorResponse): { code?: string; fields: Record<string, string> } {
  const body = error.error as { error?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : '';
  if (message.length === 0) return { fields: {} };

  const separator = message.indexOf(':');
  const code = separator === -1 ? message : message.slice(0, separator);
  const fields: Record<string, string> = {};

  if (separator !== -1) {
    try {
      const raw = JSON.parse(message.slice(separator + 1)) as Record<string, unknown>;
      for (const [field, reason] of Object.entries(raw)) {
        const key = REASON_TO_KEY[String(reason)];
        // An unrecognised reason is dropped rather than rendered raw.
        if (key) fields[field] = key;
      }
    } catch {
      // A malformed map is simply no map; the page-level message still shows.
    }
  }

  return { code, fields };
}

/** Map a failed profile call to safe, translated copy. */
export function mapProfileError(error: unknown): ProfileFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'student.profile.errors.unexpected', fields: {} };
  }

  // Transport conditions are decided first: they hold regardless of the body,
  // and a body may not exist at all.
  if (error.status === 0 || error.status >= 500) {
    return { key: 'student.profile.errors.unavailable', fields: {} };
  }

  const { code, fields } = parseMessage(error);
  const key = code ? CODE_TO_KEY[code] : undefined;

  return { key: key ?? 'student.profile.errors.unexpected', fields };
}
