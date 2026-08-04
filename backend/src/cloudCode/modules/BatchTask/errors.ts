/**
 * Stable failure codes for Tasks, Submissions, and Talent Reels ⟨CP7⟩.
 *
 * A code, never a sentence and never a driver message. The browser maps each to
 * translated copy, so nothing a database or a validator said reaches a caller.
 *
 * ── Not-found is deliberately ambiguous ─────────────────────────────────────
 * `TASK_NOT_FOUND` answers both "there is no such Task" and "there is, and it is
 * not yours". A Student probing objectIds from another Batch must not be able to
 * tell which Tasks are real, and a differently-worded refusal would tell them.
 * The same applies to `SUBMISSION_NOT_FOUND`.
 */

import {FieldErrors, FieldReason} from '../StudentProfile/errors';

export const TaskError = {
  // ── Tasks ─────────────────────────────────────────────────────────────────
  /** No such Task — **or** one this caller may not see. */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  /** A field failed validation; carries a field map. */
  TASK_VALIDATION_FAILED: 'TASK_VALIDATION_FAILED',
  /** The Task is not published, so Students cannot see or answer it. */
  TASK_NOT_PUBLISHED: 'TASK_NOT_PUBLISHED',
  /** The Task is published but closed to submissions right now. */
  TASK_NOT_OPEN: 'TASK_NOT_OPEN',
  /** The deadline has passed. There are no late submissions. */
  TASK_DEADLINE_PASSED: 'TASK_DEADLINE_PASSED',
  /** The Task is archived. Archived is terminal and read-only. */
  TASK_ARCHIVED: 'TASK_ARCHIVED',
  /** The requested status is not a legal next step from the current one. */
  TASK_INVALID_STATUS: 'TASK_INVALID_STATUS',
  /** The Task can no longer be edited — a Submission exists, or the lifecycle forbids it. */
  TASK_NOT_EDITABLE: 'TASK_NOT_EDITABLE',
  /** A Batch may hold at most one Final Task. */
  FINAL_TASK_ALREADY_EXISTS: 'FINAL_TASK_ALREADY_EXISTS',
  /** The Task cannot be deleted — a Submission exists, or it is not a Draft. */
  TASK_DELETE_FORBIDDEN: 'TASK_DELETE_FORBIDDEN',

  // ── Batch ─────────────────────────────────────────────────────────────────
  /** The Batch is not active, so nothing may be published or submitted. */
  BATCH_NOT_ACTIVE: 'BATCH_NOT_ACTIVE',
  /** The caller is not enrolled in this Task's Batch. */
  NOT_ENROLLED: 'NOT_ENROLLED',
  /** The Student's profile is not complete. */
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',

  // ── Attachments ───────────────────────────────────────────────────────────
  /** The extension, the MIME type, or the bytes are not an accepted format. */
  TASK_ATTACHMENT_INVALID: 'TASK_ATTACHMENT_INVALID',
  /** Over 20 MiB. Refused at the socket, before anything is parsed. */
  TASK_ATTACHMENT_TOO_LARGE: 'TASK_ATTACHMENT_TOO_LARGE',
  /** Storing or removing the bytes failed. Deliberately opaque. */
  TASK_ATTACHMENT_FAILED: 'TASK_ATTACHMENT_FAILED',

  // ── Submissions ───────────────────────────────────────────────────────────
  /** No such Submission — **or** one this caller may not see. */
  SUBMISSION_NOT_FOUND: 'SUBMISSION_NOT_FOUND',
  /** A field failed validation; carries a field map. */
  SUBMISSION_VALIDATION_FAILED: 'SUBMISSION_VALIDATION_FAILED',
  /** A field the Admin configured as NOT_USED was supplied. */
  SUBMISSION_FIELD_NOT_USED: 'SUBMISSION_FIELD_NOT_USED',
  /** A field the Admin configured as REQUIRED is missing on Submit. */
  SUBMISSION_REQUIRED_FIELD_MISSING: 'SUBMISSION_REQUIRED_FIELD_MISSING',
  /** A Submission that has ever been submitted can never be deleted. */
  SUBMISSION_DELETE_FORBIDDEN: 'SUBMISSION_DELETE_FORBIDDEN',
  /** Anything unexpected while storing a Submission. */
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',

  // ── Talent Reels ──────────────────────────────────────────────────────────
  /** The latest Submission does not meet every publication condition. */
  TALENT_REEL_NOT_ELIGIBLE: 'TALENT_REEL_NOT_ELIGIBLE',
  /** No publication record exists for this Submission. */
  TALENT_REEL_NOT_FOUND: 'TALENT_REEL_NOT_FOUND',
} as const;

export type TaskErrorCode = (typeof TaskError)[keyof typeof TaskError];

export const TASK_ERROR_CODES: readonly TaskErrorCode[] = Object.values(TaskError);

/**
 * Raise a stable failure.
 *
 * `fields` carries **field names and reason codes only** — never the value that
 * failed. A rejected URL is a link to somebody's work and a rejected note is
 * something they wrote about it; neither belongs in an error that will be
 * rendered onto a page and written into a log.
 */
export function taskError(code: TaskErrorCode, fields?: FieldErrors): Parse.Error {
  const suffix = fields && Object.keys(fields).length > 0 ? `:${JSON.stringify(fields)}` : '';
  return new Parse.Error(Parse.Error.VALIDATION_ERROR, `${code}${suffix}`);
}

export {FieldReason};
export type {FieldErrors};
