/**
 * Where an invitation link points.
 *
 * ── Why this reuses the CORS allow-list ─────────────────────────────────────
 * The frontend origin the backend is willing to *accept requests from* is, by
 * definition, the frontend origin it should be *linking to*. Deriving one from
 * the other means there is a single approved list to keep correct instead of
 * two that can disagree — and a deployment that has already configured
 * `CORS_ORIGINS` (which Checkpoint 1 makes mandatory in production, because
 * CORS fails closed without it) needs no new setting at all.
 *
 * `FRONTEND_ORIGIN` overrides it, for the case where the app is served from an
 * origin that differs from the one browsers call the API from.
 *
 * ── No hardcoded host ───────────────────────────────────────────────────────
 * Nothing here falls back to `localhost` in production. Outside production the
 * CORS layer already supplies a narrow localhost list, which is exactly what a
 * developer's link should use; in production, an unconfigured origin yields
 * `undefined` and the response carries only a **relative path**, which the
 * browser resolves against the page it is already on. A wrong absolute link is
 * worse than none — it would send people somewhere that does not exist.
 *
 * A request can never influence any of this: nothing here reads a header, a
 * body, or a query, so an invitation link cannot be pointed at an attacker's
 * host. That is what keeps it from becoming an open redirect.
 */

import {resolveAllowedOrigins} from '../../utils/config/cors';

/** An origin is usable only if it is an absolute http(s) origin. */
function isUsableOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The configured public frontend origin, or `undefined`.
 *
 * `undefined` is a legitimate answer, not a failure: the caller falls back to a
 * relative path rather than guessing a host.
 */
export function frontendOrigin(): string | undefined {
  const explicit = (process.env.FRONTEND_ORIGIN ?? '').trim();
  if (isUsableOrigin(explicit)) return new URL(explicit).origin;

  // The first entry of the approved CORS allow-list. In development that is the
  // Angular dev server; in production it is whatever the deployment configured.
  const allowed = resolveAllowedOrigins().find(isUsableOrigin);
  return allowed ? new URL(allowed).origin : undefined;
}

/** Key names only, for a boot-time log line. Never a value. */
export function frontendOriginStatus(): {configured: boolean; source: string} {
  if (isUsableOrigin((process.env.FRONTEND_ORIGIN ?? '').trim())) {
    return {configured: true, source: 'FRONTEND_ORIGIN'};
  }
  return {
    configured: frontendOrigin() !== undefined,
    source: 'CORS_ORIGINS',
  };
}
