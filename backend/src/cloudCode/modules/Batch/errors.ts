/**
 * Stable, sanitised error codes for Batches, invitations, and enrollment.
 *
 * Same contract as every other surface in this repository: the token **is** the
 * whole message. No database detail, no library text, no Batch metadata, and —
 * this one matters here — **no information that helps somebody enumerate
 * invitation tokens**.
 *
 * ── Why the invitation codes are shaped the way they are ────────────────────
 * A join page has to tell a real person why their link did not work, so
 * "expired", "revoked", and "replaced" are legitimately distinguishable. What is
 * *not* distinguishable is a token that never existed from one that is merely
 * malformed: both answer `INVITATION_INVALID`, so a caller probing random
 * strings learns nothing about which of them were ever real.
 */

import {FieldErrors, FieldReason} from '../StudentProfile/errors';

export const BatchError = {
  /** One or more fields failed validation; see the `fields` map. */
  BATCH_VALIDATION_FAILED: 'BATCH_VALIDATION_FAILED',
  /** No Batch with that id, or the caller may not see it. */
  BATCH_NOT_FOUND: 'BATCH_NOT_FOUND',
  /** The Batch is archived. Archived is terminal and read-only. */
  BATCH_READ_ONLY: 'BATCH_READ_ONLY',
  /** The requested status is not a legal next step from the current one. */
  BATCH_INVALID_STATUS: 'BATCH_INVALID_STATUS',
  /** Anything unexpected while writing. */
  BATCH_SAVE_FAILED: 'BATCH_SAVE_FAILED',
} as const;

export const InvitationError = {
  /**
   * Unknown, malformed, or otherwise unusable. Deliberately the same answer for
   * "never existed" and "not a token at all".
   */
  INVITATION_INVALID: 'INVITATION_INVALID',
  /** Past its expiry. */
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  /** An Admin revoked it. */
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  /** A newer token replaced it — rotation invalidates the previous one at once. */
  INVITATION_REPLACED: 'INVITATION_REPLACED',
} as const;

export const EnrollmentError = {
  /** The Batch exists and the token is fine, but the Batch is not accepting. */
  BATCH_NOT_ACTIVE: 'BATCH_NOT_ACTIVE',
  /** The Student must finish their profile before joining. */
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  /** This Student already belongs to this Batch. Not an error state to fear. */
  ALREADY_ENROLLED: 'ALREADY_ENROLLED',
  /** Anything unexpected while enrolling. */
  ENROLLMENT_FAILED: 'ENROLLMENT_FAILED',
  /** The caller is not a Student. An Admin cannot redeem an invitation. */
  NOT_A_STUDENT: 'NOT_A_STUDENT',
} as const;

export type BatchErrorCode = (typeof BatchError)[keyof typeof BatchError];
export type InvitationErrorCode = (typeof InvitationError)[keyof typeof InvitationError];
export type EnrollmentErrorCode = (typeof EnrollmentError)[keyof typeof EnrollmentError];
export type BatchSurfaceErrorCode = BatchErrorCode | InvitationErrorCode | EnrollmentErrorCode;

export const BATCH_ERROR_CODES: readonly BatchErrorCode[] = Object.values(BatchError);
export const INVITATION_ERROR_CODES: readonly InvitationErrorCode[] = Object.values(InvitationError);
export const ENROLLMENT_ERROR_CODES: readonly EnrollmentErrorCode[] = Object.values(EnrollmentError);

/** Every code this surface can produce, for the tests and the error gate. */
export const BATCH_SURFACE_ERROR_CODES: readonly BatchSurfaceErrorCode[] = [
  ...BATCH_ERROR_CODES,
  ...INVITATION_ERROR_CODES,
  ...ENROLLMENT_ERROR_CODES,
];

export function isBatchSurfaceErrorCode(value: unknown): value is BatchSurfaceErrorCode {
  return (
    typeof value === 'string' &&
    (BATCH_SURFACE_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Build the Parse error for a code.
 *
 * A validation failure carries its field map appended as JSON, exactly as the
 * profile and catalog surfaces do. The map holds nothing but field names and
 * reason codes, both fixed vocabulary this repository defines.
 */
export function batchError(
  code: BatchSurfaceErrorCode,
  fields?: FieldErrors
): Parse.Error {
  const message =
    code === BatchError.BATCH_VALIDATION_FAILED && fields && Object.keys(fields).length > 0
      ? `${code}:${JSON.stringify(fields)}`
      : code;

  switch (code) {
    case BatchError.BATCH_VALIDATION_FAILED:
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
    case BatchError.BATCH_NOT_FOUND:
      return new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, message);
    case BatchError.BATCH_READ_ONLY:
    case BatchError.BATCH_INVALID_STATUS:
    case EnrollmentError.NOT_A_STUDENT:
    case EnrollmentError.BATCH_NOT_ACTIVE:
    case EnrollmentError.PROFILE_INCOMPLETE:
      return new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
    case InvitationError.INVITATION_INVALID:
    case InvitationError.INVITATION_EXPIRED:
    case InvitationError.INVITATION_REVOKED:
    case InvitationError.INVITATION_REPLACED:
      // Not "not found": a caller must not learn from the HTTP shape whether a
      // token was ever real.
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
    case EnrollmentError.ALREADY_ENROLLED:
      return new Parse.Error(Parse.Error.DUPLICATE_VALUE, message);
    default:
      return new Parse.Error(Parse.Error.OTHER_CAUSE, message);
  }
}

/** Re-exported so call sites use one reason vocabulary, not several. */
export {FieldReason};
export type {FieldErrors};
