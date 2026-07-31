/**
 * Stable, sanitised error codes for Student Google authentication.
 *
 * Every failure the client can observe is one of these tokens. They are the
 * *whole* message body — no internal detail, no verifier text, no Google text,
 * no account information travels with them. The frontend maps each token to a
 * translated sentence, so a raw provider or Parse string is never rendered.
 *
 * Deliberate design points:
 *
 *   - **Nothing distinguishes "no such account" from "conflicting account".**
 *     Both resolve to `ACCOUNT_NOT_ELIGIBLE`, so the endpoint cannot be used to
 *     probe whether a particular Google address already has an account here.
 *   - **Every verification failure collapses to `INVALID_CREDENTIAL`** — bad
 *     signature, wrong audience, wrong issuer, expired, malformed, mismatched
 *     subject. Telling a caller *which* check failed helps an attacker tune a
 *     forgery and helps a legitimate user not at all.
 *   - `EMAIL_NOT_VERIFIED` is separate because it is genuinely actionable by the
 *     user and reveals nothing about this system.
 */

export const StudentAuthError = {
  /** No Google Client ID is configured on the server. */
  GOOGLE_NOT_CONFIGURED: 'GOOGLE_NOT_CONFIGURED',
  /** The credential failed verification, for any reason. */
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
  /** The Google account's email address is not verified by Google. */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** The account cannot sign in as a Student (conflict, or role withdrawn). */
  ACCOUNT_NOT_ELIGIBLE: 'ACCOUNT_NOT_ELIGIBLE',
  /** Provisioning failed for an internal reason. */
  SIGN_IN_FAILED: 'SIGN_IN_FAILED',
} as const;

export type StudentAuthErrorCode =
  (typeof StudentAuthError)[keyof typeof StudentAuthError];

/** Every code, for tests and for the frontend contract. */
export const STUDENT_AUTH_ERROR_CODES: readonly StudentAuthErrorCode[] =
  Object.values(StudentAuthError);

/**
 * Build the Parse error for a code. The message *is* the code — there is
 * nothing else in it to leak.
 */
export function studentAuthError(code: StudentAuthErrorCode): Parse.Error {
  switch (code) {
    case StudentAuthError.GOOGLE_NOT_CONFIGURED:
      return new Parse.Error(Parse.Error.OTHER_CAUSE, code);
    case StudentAuthError.ACCOUNT_NOT_ELIGIBLE:
      return new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, code);
    case StudentAuthError.INVALID_CREDENTIAL:
    case StudentAuthError.EMAIL_NOT_VERIFIED:
      return new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, code);
    default:
      return new Parse.Error(Parse.Error.OTHER_CAUSE, StudentAuthError.SIGN_IN_FAILED);
  }
}

/** True when the value is one of the stable codes. */
export function isStudentAuthErrorCode(value: unknown): value is StudentAuthErrorCode {
  return (
    typeof value === 'string' &&
    (STUDENT_AUTH_ERROR_CODES as readonly string[]).includes(value)
  );
}
