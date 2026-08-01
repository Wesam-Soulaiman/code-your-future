/**
 * Google credential verification — the single trust boundary for Student
 * identity.
 *
 * ── What verifies the token ─────────────────────────────────────────────────
 * Nothing here implements JWT or OAuth. The cryptographic work is delegated to
 * **Parse Server's own bundled Google auth adapter**
 * (`parse-server/lib/Adapters/Auth/google`), which is the official server-side
 * verification mechanism for this stack. It fetches Google's published signing
 * keys (JWKS), and checks:
 *
 *   - the RS256 **signature** against the matching Google key,
 *   - the **audience** equals the configured Client ID,
 *   - the **expiry** (`jwt.verify` rejects an expired token),
 *   - the **issuer** is `accounts.google.com` / `https://accounts.google.com`,
 *   - the token's `sub` matches the `id` handed to it.
 *
 * This module adds the two product rules the adapter does not enforce:
 *
 *   - the **email must be verified by Google** (`email_verified === true`),
 *   - a **stable subject** (`sub`) must be present.
 *
 * and re-asserts audience, issuer, and expiry on the *verified* claims, so the
 * contract is stated in one readable place and is directly testable.
 *
 * ── Why the subject is pre-read ─────────────────────────────────────────────
 * The adapter's signature is `validateAuthData({id, id_token}, {clientId})` and
 * it requires the caller to supply the expected `id`. We do not know it yet, so
 * the payload segment is base64-decoded **without any trust** purely to obtain a
 * candidate `sub`. The adapter then verifies the signature and asserts that the
 * *verified* `sub` equals the candidate. A forged or altered payload therefore
 * fails: it can change the candidate, but it cannot make the signature check
 * pass. Nothing from the untrusted decode is ever used as an identity claim.
 *
 * ── The test seam ───────────────────────────────────────────────────────────
 * `setGoogleCredentialVerifier()` replaces the verifier. Tests substitute a
 * controlled double so the suite never contacts Google, never needs network
 * access, and can exercise every failure mode deterministically.
 */

import {catchError} from '@90soft/parse-server-kit';
import {StudentAuthError, studentAuthError} from './errors';
import {googleClientId} from './googleConfig';

/** The claims this product consumes. Everything else Google sends is discarded. */
export interface GoogleIdentityClaims {
  /** Google's stable `sub`. Never returned by any endpoint. */
  subject: string;
  /** The verified email address. Stored on `_User`; never returned in a DTO. */
  email: string;
  /** Given name, when Google supplies one. */
  givenName?: string;
  /** Family name, when Google supplies one. */
  familyName?: string;
  /**
   * Google's avatar URL, when it supplies one and it passes the host check.
   *
   * **Never returned by any endpoint and never sent to a browser.** It exists so
   * the backend can fetch the image once, on first profile creation, and store
   * a private re-encoded copy. Keeping the URL out of every DTO is deliberate:
   * a Google avatar URL is a stable, unauthenticated address for a photograph of
   * a person, and publishing one would undo the point of storing the image
   * privately at all.
   */
  pictureUrl?: string;
}

/**
 * Hosts a Google avatar may be fetched from.
 *
 * This is the SSRF boundary. The URL arrives inside a token, so it is attacker-
 * influenced in principle: without pinning, a forged `picture` claim would turn
 * the backend into a request forwarder aimed at anything reachable from the
 * server — including cloud metadata endpoints and internal services.
 *
 * Matched on the parsed hostname, either exactly or as a sub-domain, so
 * `googleusercontent.com.evil.test` does not pass.
 */
export const GOOGLE_PICTURE_HOSTS: readonly string[] = [
  'googleusercontent.com',
  'google.com',
  'gstatic.com',
];

/** True when a URL is an `https:` address on a pinned Google image host. */
export function isGooglePictureUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  // Plain http would let a network position swap the image; there is no reason
  // to accept it from a provider that serves everything over TLS.
  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  return GOOGLE_PICTURE_HOSTS.some(
    allowed => host === allowed || host.endsWith(`.${allowed}`)
  );
}

/** Raw claims as returned by a verifier implementation. */
export interface RawGoogleClaims {
  sub?: unknown;
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  email?: unknown;
  email_verified?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
  [claim: string]: unknown;
}

/**
 * The injectable boundary. An implementation must perform genuine cryptographic
 * verification and return the verified claims, or throw.
 */
export interface GoogleCredentialVerifier {
  verify(credential: string, clientId: string): Promise<RawGoogleClaims>;
}

const ACCEPTED_ISSUERS: readonly string[] = [
  'accounts.google.com',
  'https://accounts.google.com',
];

/**
 * Read the `sub` out of an unverified token payload.
 *
 * Untrusted by construction — see the module note. Returns `undefined` for
 * anything that is not a well-formed three-segment token.
 */
function unverifiedSubject(credential: string): string | undefined {
  const segments = credential.split('.');
  if (segments.length !== 3) return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(segments[1], 'base64url').toString('utf8');
  } catch {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return undefined;
  }

  const subject = (payload as {sub?: unknown} | null)?.sub;
  return typeof subject === 'string' && subject.length > 0 ? subject : undefined;
}

/**
 * The production verifier: Parse Server's bundled Google adapter.
 *
 * Loaded lazily with `require` so that importing this module in a test process
 * does not pull in the adapter's JWKS client.
 */
export const parseAdapterVerifier: GoogleCredentialVerifier = {
  async verify(credential: string, clientId: string): Promise<RawGoogleClaims> {
    const subject = unverifiedSubject(credential);
    if (!subject) {
      throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const googleAdapter = require('parse-server/lib/Adapters/Auth/google');

    const claims = await googleAdapter.validateAuthData(
      {id: subject, id_token: credential},
      {clientId}
    );

    return (claims ?? {}) as RawGoogleClaims;
  },
};

let activeVerifier: GoogleCredentialVerifier = parseAdapterVerifier;

/** Replace the verifier. Tests only — production never calls this. */
export function setGoogleCredentialVerifier(verifier: GoogleCredentialVerifier): void {
  activeVerifier = verifier;
}

/** Restore the production verifier. */
export function resetGoogleCredentialVerifier(): void {
  activeVerifier = parseAdapterVerifier;
}

/** The verifier currently in force. */
export function getGoogleCredentialVerifier(): GoogleCredentialVerifier {
  return activeVerifier;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Verify a Google credential and reduce it to the claims this product uses.
 *
 * Throws a stable `StudentAuthError` code and nothing else — no verifier text,
 * no Google text, no indication of which check failed.
 */
export async function verifyGoogleCredential(
  credential: unknown
): Promise<GoogleIdentityClaims> {
  const clientId = googleClientId();
  if (!clientId) {
    throw studentAuthError(StudentAuthError.GOOGLE_NOT_CONFIGURED);
  }

  if (typeof credential !== 'string' || credential.trim().length === 0) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  const [error, claims] = await catchError(
    activeVerifier.verify(credential.trim(), clientId)
  );

  if (error || !claims) {
    // The underlying message is deliberately discarded: it can quote token
    // internals and Google's own wording.
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  // ── Re-assert the security claims on the verified payload ────────────────
  // The adapter already checked these. Repeating them here means the contract
  // is enforced by this repository's own code and cannot silently weaken if the
  // adapter changes.
  const audience = claims.aud;
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;
  if (!audienceMatches) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  if (!ACCEPTED_ISSUERS.includes(String(claims.iss))) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  const expiry = claims.exp;
  if (typeof expiry !== 'number' || !Number.isFinite(expiry)) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }
  if (expiry * 1000 <= Date.now()) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  const subject = asString(claims.sub);
  if (!subject) {
    throw studentAuthError(StudentAuthError.INVALID_CREDENTIAL);
  }

  const email = asString(claims.email);
  // `email_verified` may arrive as a boolean or as the string "true".
  const emailVerified =
    claims.email_verified === true || claims.email_verified === 'true';

  if (!email || !emailVerified) {
    throw studentAuthError(StudentAuthError.EMAIL_NOT_VERIFIED);
  }

  const identity: GoogleIdentityClaims = {
    subject,
    email: email.toLowerCase(),
  };

  const givenName = asString(claims.given_name);
  if (givenName) identity.givenName = givenName;

  const familyName = asString(claims.family_name);
  if (familyName) identity.familyName = familyName;

  // Optional and non-load-bearing: an avatar URL that fails the host check is
  // simply dropped, never a reason to refuse a sign-in.
  const picture = asString(claims.picture);
  if (picture && isGooglePictureUrl(picture)) identity.pictureUrl = picture;

  return identity;
}
