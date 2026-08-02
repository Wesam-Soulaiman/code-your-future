import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a Resource failure into translated copy ⟨CP5⟩.
 *
 * The backend answers with one of eight stable codes and, for a validation
 * failure, a map of **field name → stable reason code**. Neither carries a
 * filename, a title, or anything a driver said, so nothing personal travels in
 * an error and nothing untranslated is rendered.
 *
 * ── Not found covers two different things, on purpose ───────────────────────
 * A Resource that does not exist and a Resource the caller may not see answer
 * identically. That is decided server-side — "you may not have this" would
 * confirm the thing exists — so this file renders one message for both and
 * cannot leak the difference by wording it differently.
 */

export type ResourceErrorKey =
  | 'resources.errors.validation'
  | 'resources.errors.typeNotAllowed'
  | 'resources.errors.tooLarge'
  | 'resources.errors.empty'
  | 'resources.errors.uploadFailed'
  | 'resources.errors.notFound'
  | 'resources.errors.accessDenied'
  | 'resources.errors.deleteFailed'
  | 'resources.errors.unavailable'
  | 'resources.errors.unexpected';

/** Mirrors `modules/BatchResource/errors.ts`. */
const CODE_TO_KEY: Record<string, ResourceErrorKey> = {
  RESOURCE_VALIDATION_FAILED: 'resources.errors.validation',
  RESOURCE_TYPE_NOT_ALLOWED: 'resources.errors.typeNotAllowed',
  RESOURCE_TOO_LARGE: 'resources.errors.tooLarge',
  RESOURCE_EMPTY: 'resources.errors.empty',
  RESOURCE_UPLOAD_FAILED: 'resources.errors.uploadFailed',
  RESOURCE_NOT_FOUND: 'resources.errors.notFound',
  RESOURCE_ACCESS_DENIED: 'resources.errors.accessDenied',
  RESOURCE_DELETE_FAILED: 'resources.errors.deleteFailed',
  // A Resource operation reaches the Batch first, so its codes arrive here too.
  BATCH_NOT_FOUND: 'resources.errors.notFound',
  BATCH_READ_ONLY: 'resources.errors.accessDenied',
};

/** Field-level reasons → translated copy. Shared with the profile form. */
const REASON_TO_KEY: Record<string, string> = {
  REQUIRED: 'student.profile.fieldErrors.required',
  TOO_SHORT: 'student.profile.fieldErrors.tooShort',
  TOO_LONG: 'student.profile.fieldErrors.tooLong',
  INVALID: 'student.profile.fieldErrors.invalid',
  NOT_ALLOWED: 'student.profile.fieldErrors.notAllowed',
};

/** What a stable backend code looks like: SCREAMING_SNAKE_CASE and nothing else. */
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface ResourceFailure {
  key: ResourceErrorKey;
  /** Field name → translation key. Empty unless the backend rejected fields. */
  fields: Record<string, string>;
  /** The raw stable code, for callers that branch on it. Never rendered. */
  code?: string;
}

/**
 * Read the stable code and any field map out of an error body.
 *
 * Both surfaces answer the same shape: the cloud functions raise a `Parse.Error`
 * whose message is the code, and the binary route replies `{error: CODE}`. One
 * reader covers both.
 */
function parseMessage(error: HttpErrorResponse): { code?: string; fields: Record<string, string> } {
  const body = error.error as { error?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : '';
  if (message.length === 0) return { fields: {} };

  const separator = message.indexOf(':');
  const candidate = separator === -1 ? message : message.slice(0, separator);

  // Only a stable code is kept. Anything else — a stack frame, an internal
  // path, a driver message — is dropped here rather than carried around inside
  // a failure object that somebody later assumes is safe to render.
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

/** Map a failed Resource call to safe, translated copy. */
export function mapResourceError(error: unknown): ResourceFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'resources.errors.unexpected', fields: {} };
  }

  // Transport conditions are decided first: they hold regardless of the body,
  // and a body may not exist at all.
  if (error.status === 0 || error.status >= 500) {
    const { code } = parseMessage(error);
    // A 500 carrying the upload code is a storage failure, which is worth
    // saying plainly — "try again" is the right advice and "check your
    // connection" is not.
    if (code === 'RESOURCE_UPLOAD_FAILED') {
      return { key: 'resources.errors.uploadFailed', fields: {}, code };
    }
    return { key: 'resources.errors.unavailable', fields: {} };
  }

  const { code, fields } = parseMessage(error);

  // The multipart guard answers 413 before anything is parsed, and a stream cut
  // short may carry no body at all.
  if (error.status === 413 && !code) {
    return { key: 'resources.errors.tooLarge', fields: {} };
  }

  // A plain 403 with no Resource code is the authorisation gate, not a product
  // rule — an Admin whose role was withdrawn mid-session lands here.
  if (error.status === 403 && !code) {
    return { key: 'resources.errors.accessDenied', fields: {} };
  }

  if (error.status === 404 && !code) {
    return { key: 'resources.errors.notFound', fields: {} };
  }

  const key = code ? CODE_TO_KEY[code] : undefined;
  return { key: key ?? 'resources.errors.unexpected', fields, code };
}
