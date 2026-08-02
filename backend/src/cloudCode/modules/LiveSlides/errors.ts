/**
 * Stable failure codes for Live Slides ⟨CP6⟩.
 *
 * A code, never a sentence and never a driver message. The browser maps each to
 * translated copy, so nothing a database or a validator said reaches a caller.
 *
 * ── Two of these carry a deliberate ambiguity ───────────────────────────────
 * `LIVE_SESSION_NOT_FOUND` and `LIVE_SLIDE_NOT_FOUND` answer both "there is no
 * such thing" and "there is, and it is not yours". A Student probing objectIds
 * from another Batch must not be able to tell which sessions are real, and a
 * differently-worded refusal would tell them.
 */

import {FieldErrors, FieldReason} from '../StudentProfile/errors';

export const LiveSlidesError = {
  // ── Session ───────────────────────────────────────────────────────────────
  /** No such session — **or** one this caller may not see. */
  LIVE_SESSION_NOT_FOUND: 'LIVE_SESSION_NOT_FOUND',
  /** A field failed validation; carries a field map. */
  LIVE_SESSION_VALIDATION_FAILED: 'LIVE_SESSION_VALIDATION_FAILED',
  /** The session is not in Draft, so its Slides are frozen. */
  LIVE_SESSION_NOT_EDITABLE: 'LIVE_SESSION_NOT_EDITABLE',
  /** The session is not Ready, so it cannot start. */
  LIVE_SESSION_NOT_READY: 'LIVE_SESSION_NOT_READY',
  /** Another session is already Live for this Batch. */
  LIVE_SESSION_ALREADY_ACTIVE: 'LIVE_SESSION_ALREADY_ACTIVE',
  /** The session is not Live, so there is nothing to present or answer. */
  LIVE_SESSION_NOT_ACTIVE: 'LIVE_SESSION_NOT_ACTIVE',
  /** The session is Completed. Completed is terminal. */
  LIVE_SESSION_COMPLETED: 'LIVE_SESSION_COMPLETED',

  // ── Slides ────────────────────────────────────────────────────────────────
  /** No such Slide on this session. */
  LIVE_SLIDE_NOT_FOUND: 'LIVE_SLIDE_NOT_FOUND',
  /** A Slide field failed validation; carries a field map. */
  LIVE_SLIDE_VALIDATION_FAILED: 'LIVE_SLIDE_VALIDATION_FAILED',

  // ── Answering ─────────────────────────────────────────────────────────────
  /** The Question is locked, or is not the Slide being presented. */
  QUESTION_CLOSED: 'QUESTION_CLOSED',
  /** The answer's shape does not match the Slide's answer type. */
  ANSWER_TYPE_MISMATCH: 'ANSWER_TYPE_MISMATCH',
  /** An option id is not one of this Slide's options, or is repeated. */
  ANSWER_OPTION_INVALID: 'ANSWER_OPTION_INVALID',
  /** This Student already answered this Slide. Their answer stands. */
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  /** The Student's profile is not complete. */
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  /** The caller is not enrolled in this session's Batch. */
  NOT_ENROLLED: 'NOT_ENROLLED',
  /** Anything unexpected while storing a response. */
  LIVE_RESPONSE_FAILED: 'LIVE_RESPONSE_FAILED',
} as const;

export type LiveSlidesErrorCode = (typeof LiveSlidesError)[keyof typeof LiveSlidesError];

export const LIVE_SLIDES_ERROR_CODES: readonly LiveSlidesErrorCode[] =
  Object.values(LiveSlidesError);

/**
 * Raise a stable failure.
 *
 * `fields` carries **field names and reason codes only** — never the value that
 * failed. A rejected question is somebody's teaching material and a rejected
 * answer is somebody's words; neither belongs in an error that will be rendered
 * onto a page and written to a log.
 */
export function liveSlidesError(code: LiveSlidesErrorCode, fields?: FieldErrors): Parse.Error {
  const suffix = fields && Object.keys(fields).length > 0 ? `:${JSON.stringify(fields)}` : '';
  return new Parse.Error(Parse.Error.VALIDATION_ERROR, `${code}${suffix}`);
}

export {FieldReason};
export type {FieldErrors};
