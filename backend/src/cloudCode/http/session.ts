/**
 * Resolving the caller of an authenticated **binary** route ⟨CP5⟩.
 *
 * ── Why this exists separately from the cloud-function path ─────────────────
 * A cloud function gets `req.user` from Parse. An Express route mounted beside
 * Parse does not: it has a session-token header and nothing else. Checkpoint 3A
 * wrote that resolution inside the profile-photo route, and Checkpoint 5 needs
 * exactly the same thing for Resource downloads.
 *
 * Two copies of session resolution is the kind of duplication that eventually
 * diverges in the direction of being wrong — one gets an expiry check and the
 * other does not. So it lives here once.
 *
 * ── What it actually checks ─────────────────────────────────────────────────
 * `_Session` is read with the master key because the class is not
 * client-readable, and expiry is checked **explicitly** rather than trusting
 * that Parse has already swept the row. A token is never logged, in any form.
 */

import type {Request} from 'express';

import {catchError} from '@90soft/parse-server-kit';

/** The session-token header a Parse client sends. */
export const SESSION_TOKEN_HEADER = 'x-parse-session-token';

/**
 * The user behind the request's session token, or `undefined`.
 *
 * `undefined` covers every reason equally — no header, a malformed one, an
 * unknown token, an expired session — because the caller answers all of them
 * with the same 401. Distinguishing them would tell somebody probing tokens
 * which ones were once real.
 */
export async function resolveSessionUser(req: Request): Promise<Parse.User | undefined> {
  const header = req.headers[SESSION_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== 'string' || token.trim().length === 0) return undefined;

  const query = new Parse.Query(Parse.Session);
  query.equalTo('sessionToken', token.trim());
  query.include('user');

  const [error, session] = await catchError(query.first({useMasterKey: true}));
  if (error || !session) return undefined;

  const expiresAt = (session as Parse.Object).get('expiresAt');
  if (expiresAt instanceof Date && expiresAt.getTime() <= Date.now()) return undefined;

  const user = (session as Parse.Object).get('user') as Parse.User | undefined;
  return user && typeof user.id === 'string' ? user : undefined;
}
