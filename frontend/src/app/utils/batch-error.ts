import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a Batch, invitation, or enrollment failure into translated copy.
 *
 * The backend answers with a stable code and, for a validation failure, a map
 * of **field name → stable reason code**. Neither carries a submitted value, so
 * nothing personal travels in an error and nothing untranslated is rendered.
 *
 * ── The invitation codes carry real meaning ─────────────────────────────────
 * "Expired", "revoked", and "replaced" are genuinely different things to tell
 * somebody holding a link, and the page says which. What the backend refuses to
 * distinguish — and therefore what this cannot render — is a token that never
 * existed from one that is merely malformed: both arrive as
 * `INVITATION_INVALID`, so nobody probing tokens learns which were real.
 */

export type BatchErrorKey =
  | 'batch.errors.validation'
  | 'batch.errors.notFound'
  | 'batch.errors.readOnly'
  | 'batch.errors.invalidStatus'
  | 'batch.errors.forbidden'
  | 'batch.errors.unavailable'
  | 'batch.errors.unexpected'
  | 'join.errors.invalid'
  | 'join.errors.expired'
  | 'join.errors.revoked'
  | 'join.errors.replaced'
  | 'join.errors.notActive'
  | 'join.errors.profileIncomplete'
  | 'join.errors.notAStudent'
  | 'join.errors.failed';

/** Mirrors `modules/Batch/errors.ts`. */
const CODE_TO_KEY: Record<string, BatchErrorKey> = {
  BATCH_VALIDATION_FAILED: 'batch.errors.validation',
  BATCH_NOT_FOUND: 'batch.errors.notFound',
  BATCH_READ_ONLY: 'batch.errors.readOnly',
  BATCH_INVALID_STATUS: 'batch.errors.invalidStatus',
  BATCH_SAVE_FAILED: 'batch.errors.unexpected',
  INVITATION_INVALID: 'join.errors.invalid',
  INVITATION_EXPIRED: 'join.errors.expired',
  INVITATION_REVOKED: 'join.errors.revoked',
  INVITATION_REPLACED: 'join.errors.replaced',
  BATCH_NOT_ACTIVE: 'join.errors.notActive',
  PROFILE_INCOMPLETE: 'join.errors.profileIncomplete',
  ALREADY_ENROLLED: 'join.errors.invalid',
  ENROLLMENT_FAILED: 'join.errors.failed',
  NOT_A_STUDENT: 'join.errors.notAStudent',
};

/** Field-level reason codes → translated copy. Shared with the profile form. */
const REASON_TO_KEY: Record<string, string> = {
  REQUIRED: 'student.profile.fieldErrors.required',
  TOO_SHORT: 'student.profile.fieldErrors.tooShort',
  TOO_LONG: 'student.profile.fieldErrors.tooLong',
  INVALID: 'student.profile.fieldErrors.invalid',
  NOT_ALLOWED: 'student.profile.fieldErrors.notAllowed',
  OUT_OF_RANGE: 'student.profile.fieldErrors.outOfRange',
  WRONG_DOMAIN: 'student.profile.fieldErrors.wrongDomain',
};

/** What a stable backend code looks like: SCREAMING_SNAKE_CASE and nothing else. */
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface BatchFailure {
  key: BatchErrorKey;
  /** Field name → translation key. Empty unless the backend rejected fields. */
  fields: Record<string, string>;
  /** The raw stable code, for pages that branch on it. Never rendered. */
  code?: string;
}

/** Read the stable code and any field map out of a Parse error body. */
function parseMessage(error: HttpErrorResponse): { code?: string; fields: Record<string, string> } {
  const body = error.error as { error?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : '';
  if (message.length === 0) return { fields: {} };

  const separator = message.indexOf(':');
  const candidate = separator === -1 ? message : message.slice(0, separator);

  // Only a stable code is kept. Without this, an unexpected server message —
  // a stack frame, an internal path, a driver error — would be carried around
  // inside the failure object, and anything carried is eventually rendered or
  // logged by somebody who assumed it was safe.
  const code = STABLE_CODE.test(candidate) ? candidate : undefined;
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

/** Map a failed call to safe, translated copy. */
export function mapBatchError(error: unknown): BatchFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'batch.errors.unexpected', fields: {} };
  }

  // Transport conditions are decided first: they hold regardless of the body,
  // and a body may not exist at all.
  if (error.status === 0 || error.status >= 500) {
    return { key: 'batch.errors.unavailable', fields: {} };
  }

  const { code, fields } = parseMessage(error);

  // A plain 403 with no Batch code is the authorisation gate, not a product
  // rule — an Admin whose role was withdrawn mid-session lands here.
  if (error.status === 403 && !code) {
    return { key: 'batch.errors.forbidden', fields: {} };
  }

  const key = code ? CODE_TO_KEY[code] : undefined;
  return { key: key ?? 'batch.errors.unexpected', fields, code };
}
