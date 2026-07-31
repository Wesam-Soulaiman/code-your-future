/**
 * Google Student-authentication configuration.
 *
 * One environment variable, read at call time so a deployment can be inspected
 * without restarting a test process:
 *
 *   GOOGLE_CLIENT_ID   the OAuth 2.0 **Web application Client ID** issued by
 *                      Google Cloud Console for this deployment.
 *
 * There is deliberately **no client-secret variable**. The browser sign-in flow
 * used here (Google Identity Services) returns a signed ID token directly to the
 * page; verifying it needs only Google's public keys and the expected audience.
 * No authorization-code exchange happens, so no secret exists to leak.
 *
 * The value is never logged, never returned by any endpoint, and never included
 * in an error message. Only *whether* it is configured is ever reported.
 *
 * Absence is not an error at startup: the server boots normally, Admin password
 * login keeps working, and only the Student Google endpoint refuses — with the
 * stable `GOOGLE_NOT_CONFIGURED` code.
 */

/** The provider name stored on `StudentAuthIdentity`. */
export const GOOGLE_PROVIDER = 'google';

/** Environment variable names this feature reads. Values are never exposed. */
export const GOOGLE_ENV_KEYS: readonly string[] = ['GOOGLE_CLIENT_ID'];

/**
 * The configured Client ID, or `undefined`.
 *
 * A Google Web Client ID is public by design — it is embedded in the browser
 * page that starts the sign-in. It is treated as configuration, not as a secret;
 * what matters is that the *server* checks the token's audience against it.
 */
export function googleClientId(): string | undefined {
  const raw = process.env.GOOGLE_CLIENT_ID;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when Student Google sign-in can operate. */
export function isGoogleAuthConfigured(): boolean {
  return googleClientId() !== undefined;
}

/**
 * Startup report: names and presence only, never a value.
 * Called from `app.ts` so the operator sees the state of the feature at boot.
 */
export function googleAuthStatus(): {configured: boolean; requiredKeys: readonly string[]} {
  return {configured: isGoogleAuthConfigured(), requiredKeys: GOOGLE_ENV_KEYS};
}
