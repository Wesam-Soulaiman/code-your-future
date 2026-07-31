import { HttpErrorResponse } from '@angular/common/http';

/**
 * Translation keys for every Student sign-in state the UI can distinguish.
 *
 * Mapping happens on the client, from the backend's **stable code** — never from
 * a server sentence and never from a Google sentence. A provider message is not
 * translated, can change without notice, and may carry token internals.
 */
export type GoogleAuthErrorKey =
  | 'auth.student.errors.notConfigured'
  | 'auth.student.errors.invalidCredential'
  | 'auth.student.errors.emailNotVerified'
  | 'auth.student.errors.notEligible'
  | 'auth.student.errors.rateLimited'
  | 'auth.student.errors.unavailable'
  | 'auth.student.errors.cancelled'
  | 'auth.student.errors.unexpected';

/**
 * The backend's stable error tokens. Mirrors
 * `backend/src/cloudCode/modules/StudentAuth/errors.ts`.
 */
const CODE_TO_KEY: Record<string, GoogleAuthErrorKey> = {
  GOOGLE_NOT_CONFIGURED: 'auth.student.errors.notConfigured',
  INVALID_CREDENTIAL: 'auth.student.errors.invalidCredential',
  EMAIL_NOT_VERIFIED: 'auth.student.errors.emailNotVerified',
  ACCOUNT_NOT_ELIGIBLE: 'auth.student.errors.notEligible',
  SIGN_IN_FAILED: 'auth.student.errors.unexpected',
};

/** Read the stable token out of a Parse error body, if one is present. */
function stableCode(error: HttpErrorResponse): string | undefined {
  const body = error.error as { error?: unknown } | null;
  const message = body?.error;
  return typeof message === 'string' && message in CODE_TO_KEY ? message : undefined;
}

/**
 * Map a failed Student sign-in to a safe, translated message key.
 *
 * Transport conditions are decided first, because they are true regardless of
 * what the body says — and a body may not exist at all.
 */
export function mapGoogleAuthError(error: unknown): GoogleAuthErrorKey {
  if (!(error instanceof HttpErrorResponse)) {
    return 'auth.student.errors.unexpected';
  }

  // status 0 — the request never reached the server: offline, DNS, TLS, or CORS.
  if (error.status === 0) {
    return 'auth.student.errors.unavailable';
  }

  if (error.status === 429) {
    return 'auth.student.errors.rateLimited';
  }

  const code = stableCode(error);
  if (code) {
    return CODE_TO_KEY[code];
  }

  if (error.status >= 500) {
    return 'auth.student.errors.unavailable';
  }

  return 'auth.student.errors.unexpected';
}
