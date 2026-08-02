import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a Live Slides failure into translated copy ⟨CP6⟩.
 *
 * The backend answers with one of sixteen stable codes and, for a validation
 * failure, a map of **field name → stable reason code**. Neither carries a
 * question, an answer, an option label, or anything a driver said, so nothing
 * personal travels in an error and nothing untranslated is rendered.
 *
 * ── Not found covers two different things, on purpose ───────────────────────
 * A session that does not exist and a session the caller may not see answer
 * identically. That is decided server-side — "you may not have this" would
 * confirm the thing exists — so this file renders one message for both and
 * cannot leak the difference by wording it differently.
 */

export type LiveSlidesErrorKey =
  | 'liveSlides.errors.notFound'
  | 'liveSlides.errors.validation'
  | 'liveSlides.errors.notEditable'
  | 'liveSlides.errors.notReady'
  | 'liveSlides.errors.alreadyActive'
  | 'liveSlides.errors.notActive'
  | 'liveSlides.errors.completed'
  | 'liveSlides.errors.slideNotFound'
  | 'liveSlides.errors.slideValidation'
  | 'liveSlides.errors.questionClosed'
  | 'liveSlides.errors.answerMismatch'
  | 'liveSlides.errors.optionInvalid'
  | 'liveSlides.errors.alreadySubmitted'
  | 'liveSlides.errors.profileIncomplete'
  | 'liveSlides.errors.notEnrolled'
  | 'liveSlides.errors.responseFailed'
  | 'liveSlides.errors.unavailable'
  | 'liveSlides.errors.unexpected';

/** Mirrors `modules/LiveSlides/errors.ts`. */
const CODE_TO_KEY: Record<string, LiveSlidesErrorKey> = {
  LIVE_SESSION_NOT_FOUND: 'liveSlides.errors.notFound',
  LIVE_SESSION_VALIDATION_FAILED: 'liveSlides.errors.validation',
  LIVE_SESSION_NOT_EDITABLE: 'liveSlides.errors.notEditable',
  LIVE_SESSION_NOT_READY: 'liveSlides.errors.notReady',
  LIVE_SESSION_ALREADY_ACTIVE: 'liveSlides.errors.alreadyActive',
  LIVE_SESSION_NOT_ACTIVE: 'liveSlides.errors.notActive',
  LIVE_SESSION_COMPLETED: 'liveSlides.errors.completed',
  LIVE_SLIDE_NOT_FOUND: 'liveSlides.errors.slideNotFound',
  LIVE_SLIDE_VALIDATION_FAILED: 'liveSlides.errors.slideValidation',
  QUESTION_CLOSED: 'liveSlides.errors.questionClosed',
  ANSWER_TYPE_MISMATCH: 'liveSlides.errors.answerMismatch',
  ANSWER_OPTION_INVALID: 'liveSlides.errors.optionInvalid',
  ALREADY_SUBMITTED: 'liveSlides.errors.alreadySubmitted',
  PROFILE_INCOMPLETE: 'liveSlides.errors.profileIncomplete',
  NOT_ENROLLED: 'liveSlides.errors.notEnrolled',
  LIVE_RESPONSE_FAILED: 'liveSlides.errors.responseFailed',
  // A Live Slides operation reaches the Batch first, so its codes arrive here.
  BATCH_NOT_FOUND: 'liveSlides.errors.notFound',
  BATCH_READ_ONLY: 'liveSlides.errors.notEditable',
};

/** Field-level reasons → translated copy. Shared with the profile form. */
const REASON_TO_KEY: Record<string, string> = {
  REQUIRED: 'validation.required',
  TOO_SHORT: 'validation.tooShort',
  TOO_LONG: 'validation.tooLong',
  INVALID: 'validation.invalid',
  NOT_ALLOWED: 'validation.notAllowed',
  OUT_OF_RANGE: 'validation.outOfRange',
};

export interface LiveSlidesFailure {
  key: LiveSlidesErrorKey;
  /** Field name → translation key. Empty when the failure is not field-level. */
  fields: Record<string, string>;
  /** The raw stable code, for the few places that branch on it. */
  code: string;
}

/**
 * Read a server failure without ever rendering what it said.
 *
 * The message is `CODE` or `CODE:{"field":"REASON"}`. Anything that does not
 * parse becomes `unexpected` — a server string is never shown to a person.
 */
export function mapLiveSlidesError(error: unknown): LiveSlidesFailure {
  const fallback: LiveSlidesFailure = {
    key: 'liveSlides.errors.unexpected',
    fields: {},
    code: '',
  };

  if (!(error instanceof HttpErrorResponse)) return fallback;

  // A network failure has no body to read, and it deserves its own message: it
  // is the one a Student sees when the room's wifi drops mid-lecture.
  if (error.status === 0) {
    return { key: 'liveSlides.errors.unavailable', fields: {}, code: '' };
  }

  const body = error.error as { error?: unknown; message?: unknown } | undefined;
  const raw =
    typeof body?.error === 'string'
      ? body.error
      : typeof body?.message === 'string'
        ? body.message
        : '';

  const separator = raw.indexOf(':');
  const code = separator >= 0 ? raw.slice(0, separator) : raw;
  const key = CODE_TO_KEY[code];
  if (!key) return fallback;

  const fields: Record<string, string> = {};
  if (separator >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(separator + 1)) as Record<string, string>;
      for (const [field, reason] of Object.entries(parsed)) {
        const reasonKey = REASON_TO_KEY[reason];
        if (reasonKey) fields[field] = reasonKey;
      }
    } catch {
      // A map that does not parse is simply not a map. The code still stands.
    }
  }

  return { key, fields, code };
}
