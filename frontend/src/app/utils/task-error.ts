import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a Task or Submission failure into translated copy ⟨CP7⟩.
 *
 * The backend answers with one of twenty-four stable codes and, for a
 * validation failure, a map of **field name → stable reason code**. Neither
 * carries a URL, a note, a filename, or anything a driver said — which is the
 * point. A Student's submission is their work; an error message is not a place
 * to put it, and an error message that echoed a rejected URL back would render
 * one straight onto the page.
 *
 * ── Not found covers two different things, on purpose ───────────────────────
 * A Task that does not exist and a Task the caller may not see answer
 * identically, and a Student who is not enrolled gets the same. That is decided
 * server-side — "you may not have this" would confirm the thing exists — so
 * this file renders one message for all of them and cannot leak the difference
 * by wording it differently.
 */

export type TaskErrorKey =
  | 'tasks.errors.validation'
  | 'tasks.errors.notFound'
  | 'tasks.errors.notPublished'
  | 'tasks.errors.notOpen'
  | 'tasks.errors.deadlinePassed'
  | 'tasks.errors.archived'
  | 'tasks.errors.invalidStatus'
  | 'tasks.errors.notEditable'
  | 'tasks.errors.finalExists'
  | 'tasks.errors.deleteForbidden'
  | 'tasks.errors.batchNotActive'
  | 'tasks.errors.notEnrolled'
  | 'tasks.errors.profileIncomplete'
  | 'tasks.errors.attachmentInvalid'
  | 'tasks.errors.attachmentTooLarge'
  | 'tasks.errors.attachmentFailed'
  | 'tasks.errors.fieldNotUsed'
  | 'tasks.errors.requiredFieldMissing'
  | 'tasks.errors.submissionDeleteForbidden'
  | 'tasks.errors.submissionFailed'
  | 'tasks.errors.reelNotEligible'
  | 'tasks.errors.reelNotFound'
  | 'tasks.errors.accessDenied'
  | 'tasks.errors.unavailable'
  | 'tasks.errors.unexpected';

/** Mirrors `modules/BatchTask/errors.ts`. */
const CODE_TO_KEY: Record<string, TaskErrorKey> = {
  TASK_NOT_FOUND: 'tasks.errors.notFound',
  TASK_VALIDATION_FAILED: 'tasks.errors.validation',
  TASK_NOT_PUBLISHED: 'tasks.errors.notPublished',
  TASK_NOT_OPEN: 'tasks.errors.notOpen',
  TASK_DEADLINE_PASSED: 'tasks.errors.deadlinePassed',
  TASK_ARCHIVED: 'tasks.errors.archived',
  TASK_INVALID_STATUS: 'tasks.errors.invalidStatus',
  TASK_NOT_EDITABLE: 'tasks.errors.notEditable',
  FINAL_TASK_ALREADY_EXISTS: 'tasks.errors.finalExists',
  TASK_DELETE_FORBIDDEN: 'tasks.errors.deleteForbidden',

  BATCH_NOT_ACTIVE: 'tasks.errors.batchNotActive',
  NOT_ENROLLED: 'tasks.errors.notEnrolled',
  PROFILE_INCOMPLETE: 'tasks.errors.profileIncomplete',

  TASK_ATTACHMENT_INVALID: 'tasks.errors.attachmentInvalid',
  TASK_ATTACHMENT_TOO_LARGE: 'tasks.errors.attachmentTooLarge',
  TASK_ATTACHMENT_FAILED: 'tasks.errors.attachmentFailed',

  SUBMISSION_NOT_FOUND: 'tasks.errors.notFound',
  SUBMISSION_VALIDATION_FAILED: 'tasks.errors.validation',
  SUBMISSION_FIELD_NOT_USED: 'tasks.errors.fieldNotUsed',
  SUBMISSION_REQUIRED_FIELD_MISSING: 'tasks.errors.requiredFieldMissing',
  SUBMISSION_DELETE_FORBIDDEN: 'tasks.errors.submissionDeleteForbidden',
  SUBMISSION_FAILED: 'tasks.errors.submissionFailed',

  TALENT_REEL_NOT_ELIGIBLE: 'tasks.errors.reelNotEligible',
  TALENT_REEL_NOT_FOUND: 'tasks.errors.reelNotFound',

  // A Task operation reaches the Batch first, so its codes arrive here too.
  BATCH_NOT_FOUND: 'tasks.errors.notFound',
  BATCH_READ_ONLY: 'tasks.errors.accessDenied',
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

export interface TaskFailure {
  key: TaskErrorKey;
  /** Field name → translation key. Empty unless the backend rejected fields. */
  fields: Record<string, string>;
  /** The raw stable code, for callers that branch on it. Never rendered. */
  code?: string;
}

/**
 * Read the stable code and any field map out of an error body.
 *
 * Both surfaces answer the same shape: the cloud functions raise a `Parse.Error`
 * whose message is the code, and the attachment route replies `{error: CODE}`.
 * One reader covers both.
 */
function parseMessage(error: HttpErrorResponse): { code?: string; fields: Record<string, string> } {
  const body = error.error as { error?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : '';
  if (message.length === 0) return { fields: {} };

  const separator = message.indexOf(':');
  const candidate = separator === -1 ? message : message.slice(0, separator);

  // Only a stable code is kept. Anything else — a stack frame, an internal
  // path, a driver message quoting a URL back — is dropped here rather than
  // carried around inside a failure object somebody later assumes is safe to
  // render.
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

/** Map a failed Task call to safe, translated copy. */
export function mapTaskError(error: unknown): TaskFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'tasks.errors.unexpected', fields: {} };
  }

  // Transport conditions are decided first: they hold regardless of the body,
  // and a body may not exist at all.
  if (error.status === 0 || error.status >= 500) {
    const { code } = parseMessage(error);
    // A 500 carrying the attachment code is a storage failure, which is worth
    // saying plainly — "try again" is the right advice and "check your
    // connection" is not.
    if (code === 'TASK_ATTACHMENT_FAILED') {
      return { key: 'tasks.errors.attachmentFailed', fields: {}, code };
    }
    return { key: 'tasks.errors.unavailable', fields: {} };
  }

  const { code, fields } = parseMessage(error);

  // The multipart guard answers 413 before anything is parsed, and a stream cut
  // short may carry no body at all.
  if (error.status === 413 && !code) {
    return { key: 'tasks.errors.attachmentTooLarge', fields: {} };
  }

  // A plain 403 with no Task code is the authorisation gate, not a product
  // rule — an Admin whose role was withdrawn mid-session lands here.
  if (error.status === 403 && !code) {
    return { key: 'tasks.errors.accessDenied', fields: {} };
  }

  if (error.status === 404 && !code) {
    return { key: 'tasks.errors.notFound', fields: {} };
  }

  const key = code ? CODE_TO_KEY[code] : undefined;
  return { key: key ?? 'tasks.errors.unexpected', fields, code };
}
