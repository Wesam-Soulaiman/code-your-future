import { INVITATION_ROUTE } from './batch-constants';

/**
 * Remembering that somebody arrived holding a join link.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * A Visitor opens an invitation, signs in with Google, and — if they are new —
 * fills in a profile. Both of those navigate away. Without somewhere to keep
 * the intent, they land on a welcome page having forgotten why they came, and
 * have to find the original link again. Asking somebody to re-open a QR code
 * they scanned five minutes ago is not a flow.
 *
 * ── Why sessionStorage, and why only that ───────────────────────────────────
 * The token is a credential. It lives in `sessionStorage`, so it dies with the
 * tab, and it is cleared the moment it stops being needed — on success, on an
 * unusable link, on cancellation, and on sign-out. `localStorage` would keep a
 * working invitation on a shared machine indefinitely.
 *
 * ── Why the return URL is built, never stored ───────────────────────────────
 * Nothing here stores a redirect target. The only URL this module can produce
 * is `#/join/<token>` for a token it is holding — a fixed internal route with a
 * value that has to match a strict shape. There is no path by which a query
 * parameter, a header, or anything else a request supplied becomes somewhere
 * the app navigates, which is what keeps this from being an open redirect.
 */

const INTENT_KEY = 'pendingInvitationToken';

/**
 * The same shape check the backend applies.
 *
 * A value that fails it is not stored and not navigated to, so a malformed
 * route segment cannot be parked in storage and replayed later.
 */
function looksLikeToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 32 || value.length > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/** Remember that this token is what the visit is about. */
export function rememberInvitation(token: unknown): void {
  if (!looksLikeToken(token)) return;
  try {
    sessionStorage.setItem(INTENT_KEY, token);
  } catch {
    // Storage can be unavailable in a private window. The join page still
    // works when opened directly; only the continuation is lost, and losing it
    // is better than failing the page.
  }
}

/** The remembered token, or null. Anything malformed is dropped, not returned. */
export function pendingInvitationToken(): string | null {
  try {
    const stored = sessionStorage.getItem(INTENT_KEY);
    if (looksLikeToken(stored)) return stored;
    if (stored !== null) clearInvitation();
    return null;
  } catch {
    return null;
  }
}

/** Forget it. Called on success, on an unusable link, on cancel, and on logout. */
export function clearInvitation(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // Nothing to do: if storage is unreachable there is nothing stored either.
  }
}

/** True when a visit is currently about an invitation. */
export function hasPendingInvitation(): boolean {
  return pendingInvitationToken() !== null;
}

/**
 * Where to send somebody back to, or null.
 *
 * A fixed internal route with a validated segment. It is **built**, never read
 * from storage as a URL, so there is no stored value that could point anywhere
 * other than this application's own join page.
 */
export function invitationReturnUrl(): string | null {
  const token = pendingInvitationToken();
  return token ? `${INVITATION_ROUTE}/${token}` : null;
}
