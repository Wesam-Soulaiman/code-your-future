import { HttpContextToken, HttpErrorResponse } from '@angular/common/http';

/**
 * Marks a request whose errors the caller renders itself.
 *
 * The global interceptor shows a toast for unhandled failures. Auth pages
 * display an inline, translated panel instead, so they set this token and the
 * interceptor stays quiet — the user never sees a raw server string, and never
 * sees the same failure twice.
 */
export const HANDLES_OWN_ERRORS = new HttpContextToken<boolean>(() => false);

/**
 * Translation keys for every authentication failure the UI can distinguish.
 * Mapping happens on the client so no backend message is ever rendered — a
 * server string could carry internal detail and would not be translated.
 */
export type AuthErrorKey =
  | 'auth.errors.invalidCredentials'
  | 'auth.errors.notPermitted'
  | 'auth.errors.rateLimited'
  | 'auth.errors.unavailable'
  | 'auth.errors.unexpected';

/** Parse error codes the login endpoint can produce. */
const PARSE_OBJECT_NOT_FOUND = 101;
const PARSE_OPERATION_FORBIDDEN = 119;

/**
 * Map a failed login response to a safe, translated message key.
 *
 * Deliberately coarse: unknown-username and wrong-password both resolve to
 * `invalidCredentials`, matching the backend's opaque response so the UI cannot
 * be used to enumerate accounts.
 */
export function mapAuthError(error: unknown): AuthErrorKey {
  if (!(error instanceof HttpErrorResponse)) {
    return 'auth.errors.unexpected';
  }

  // status 0 — request never reached the server: offline, DNS, TLS, or CORS.
  if (error.status === 0) {
    return 'auth.errors.unavailable';
  }

  if (error.status === 429) {
    return 'auth.errors.rateLimited';
  }

  if (error.status >= 500) {
    return 'auth.errors.unavailable';
  }

  const parseCode = (error.error as { code?: unknown } | null)?.code;

  if (parseCode === PARSE_OPERATION_FORBIDDEN) {
    // The account exists but may not use password login (e.g. a Student).
    return 'auth.errors.notPermitted';
  }

  if (parseCode === PARSE_OBJECT_NOT_FOUND || error.status === 401 || error.status === 404) {
    return 'auth.errors.invalidCredentials';
  }

  if (error.status === 400) {
    return 'auth.errors.invalidCredentials';
  }

  return 'auth.errors.unexpected';
}
