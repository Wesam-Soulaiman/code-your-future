/**
 * Invitation tokens — generation, hashing, and the link they go into.
 *
 * Pure functions over Node's crypto. No Parse, no I/O, no logging: a module
 * that mints secrets should be small enough to read in one sitting and testable
 * without a database.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * A raw token exists in exactly two places, ever: the response that created it,
 * and the browser of the Admin who received that response. It is never stored,
 * never logged, and never recoverable. Everything server-side works from the
 * hash.
 *
 * That is why the UI cannot re-display a link after a page reload, and why it
 * says so plainly instead of implying the link is gone for some incidental
 * reason. Rotating is how you get a new one.
 */

import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

import {
  INVITATION_FINGERPRINT_LENGTH,
  INVITATION_ROUTE,
  INVITATION_TOKEN_BYTES,
} from './invitationConstants';

/** A freshly minted token and the two derived values that get stored. */
export interface GeneratedToken {
  /** The only copy. Returned once, then gone from the server. */
  token: string;
  /** SHA-256, hex. This is what persists. */
  tokenHash: string;
  /** A short label derived from the hash, safe to display and to log. */
  fingerprint: string;
}

/**
 * Mint a token.
 *
 * 32 bytes from the OS CSPRNG, base64url-encoded — URL-safe by construction, so
 * it needs no escaping in a path segment and survives a QR code intact. The
 * value is unrelated to the Batch id, so possessing one tells you nothing about
 * any other Batch or invitation.
 */
export function generateInvitationToken(): GeneratedToken {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashInvitationToken(token);
  return {token, tokenHash, fingerprint: fingerprintOf(tokenHash)};
}

/**
 * Hash a token for storage and lookup.
 *
 * Plain SHA-256, deliberately. A password needs a slow KDF because it is drawn
 * from a small, guessable space; this token carries 256 bits of uniform
 * randomness, so there is no dictionary to attack and no rainbow table to
 * build. A slow hash would add latency to every redemption and buy nothing.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A short label for one invitation version.
 *
 * Derived from the **hash**, never from the token: it lets an Admin tell two
 * generations apart in the history without any part of a real token being
 * written down. Showing the last characters of the token itself would have
 * leaked some of it for no benefit at all.
 */
export function fingerprintOf(tokenHash: string): string {
  return tokenHash.slice(0, INVITATION_FINGERPRINT_LENGTH);
}

/**
 * Compare two hashes without leaking where they diverge.
 *
 * Lookup is by indexed equality, so this is belt-and-braces rather than the
 * primary defence — but a comparison that returns early is a habit worth not
 * having anywhere near a credential.
 */
export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Reject anything that cannot be one of our tokens before it reaches a query.
 *
 * Cheap, and it means a caller throwing junk at the endpoint never causes a
 * database round trip. It is a shape check, not an authenticity check: passing
 * it says nothing about whether the token was ever real.
 */
export function looksLikeInvitationToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // base64url of 32 bytes is 43 characters. Bound both ends rather than
  // requiring the exact length, so a future size change does not silently
  // start refusing every live token.
  if (value.length < 32 || value.length > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Build the link an Admin copies, and the QR encodes.
 *
 * `base` is the configured public frontend origin — never a hardcoded host, and
 * never anything a request supplied, so this cannot become an open redirect.
 * The token is a **path segment** under the app's hash route, not a query
 * parameter mixed in with anything else.
 *
 * The hash route is deliberate: the application uses `withHashLocation()`, so
 * `#/join/<token>` is the address the router actually understands. Emitting a
 * path-style link would produce a URL that 404s on any host without a rewrite
 * rule. See OQ-12.
 */
export function buildInvitationUrl(base: string, token: string): string {
  const origin = base.replace(/\/+$/, '');
  return `${origin}/#${INVITATION_ROUTE}/${token}`;
}
