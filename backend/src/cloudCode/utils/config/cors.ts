/**
 * CORS policy — fails closed.
 *
 * The template used bare `cors()`, which reflects **any** origin. That is now
 * impossible: there is no wildcard fallback on any code path.
 *
 * Resolution order for the allow-list:
 *   1. `CORS_ORIGINS` — an explicit comma-separated list. Always honoured.
 *   2. Development only (`NODE_ENV !== 'production'`) — a narrow, hardcoded
 *      localhost allow-list matching the Angular dev server and this backend.
 *   3. Production with no `CORS_ORIGINS` — **empty allow-list**. Every
 *      cross-origin browser request is denied, and startup logs an error. The
 *      server still serves same-origin and server-to-server traffic, so a
 *      misconfiguration degrades safely instead of opening the API to the web.
 *
 * A request with **no `Origin` header** (curl, server-to-server, health probes)
 * is allowed through without an `Access-Control-Allow-Origin` header — CORS is a
 * browser mechanism and such requests are not subject to it.
 *
 * No production domain is hardcoded anywhere.
 */

import {safeLog} from '../logging/safeLogger';

/**
 * The only origins allowed without configuration, and only outside production:
 * the Angular dev server (default and the alternate port used for validation)
 * and this backend's own origin.
 */
export const DEVELOPMENT_ORIGINS: readonly string[] = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:1337',
  'http://127.0.0.1:1337',
];

/** Methods the API actually uses. */
export const ALLOWED_METHODS: readonly string[] = ['GET', 'POST', 'OPTIONS'];

/** Headers a browser client legitimately sends. Nothing wildcarded. */
export const ALLOWED_HEADERS: readonly string[] = [
  'Content-Type',
  'X-Parse-Application-Id',
  'X-Parse-REST-API-Key',
  'X-Parse-Javascript-Key',
  'X-Parse-Session-Token',
  'X-Requested-With',
];

export function isProduction(): boolean {
  return (process.env.NODE_ENV || '').toLowerCase() === 'production';
}

/** Parse `CORS_ORIGINS` into a de-duplicated list. */
export function configuredOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || '';
  const parsed = raw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
  return [...new Set(parsed)];
}

/**
 * Resolve the effective allow-list. Never returns `'*'` and never returns a
 * value meaning "reflect the request origin".
 */
export function resolveAllowedOrigins(): string[] {
  const configured = configuredOrigins();
  if (configured.length > 0) return configured;
  if (isProduction()) return [];
  return [...DEVELOPMENT_ORIGINS];
}

/** True when this origin may receive an `Access-Control-Allow-Origin` header. */
export function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header: not a CORS request. Allowed, but nothing is echoed back.
  if (origin === undefined || origin === '') return true;
  return resolveAllowedOrigins().includes(origin);
}

/**
 * Sentinel handed to Parse Server when nothing is allowed.
 *
 * Parse Server's own `allowCrossDomain` middleware always writes an
 * `Access-Control-Allow-Origin` header, and it defaults to `'*'` when
 * `allowOrigin` is unset. It picks `baseOrigins[0]` whenever the request origin
 * is not in the list, so the list can never be left empty — an empty array would
 * make it emit `undefined`.
 *
 * `.invalid` is a reserved TLD (RFC 2606) that can never be a real page origin,
 * so this value can never match a requesting browser origin. The header is
 * therefore always present but never grants access to anyone.
 */
export const CORS_DENY_SENTINEL = 'https://cors-disallowed.invalid';

/**
 * The value for Parse Server's `allowOrigin` option.
 *
 * Parse echoes the request origin when it appears in this list, and otherwise
 * returns the first entry — which a browser rejects because it does not match the
 * requesting origin. Either way the wildcard default is replaced.
 */
export function parseAllowOrigin(): string[] {
  const allowed = resolveAllowedOrigins();
  return allowed.length > 0 ? allowed : [CORS_DENY_SENTINEL];
}

export interface CorsOptions {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => void;
  methods: string[];
  allowedHeaders: string[];
  credentials: boolean;
  optionsSuccessStatus: number;
  maxAge: number;
}

/**
 * Build the options object for the `cors` middleware.
 *
 * `credentials: false` is explicit and deliberate: this API authenticates with
 * the `X-Parse-Session-Token` header, not with cookies, so credentialed
 * cross-origin requests are never needed.
 */
export function buildCorsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      // Returning `false` (not an error) makes the middleware omit the
      // Access-Control-Allow-Origin header, so the browser blocks the response.
      callback(null, isOriginAllowed(origin));
    },
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_HEADERS],
    credentials: false,
    optionsSuccessStatus: 204,
    maxAge: 600,
  };
}

/** Log the effective policy at boot. Origins are configuration, not secrets. */
export function logCorsPolicy(): void {
  const configured = configuredOrigins();
  const effective = resolveAllowedOrigins();

  if (isProduction() && configured.length === 0) {
    safeLog.error(
      'CORS_ORIGINS is not set in production — every cross-origin browser ' +
        'request will be denied. Set CORS_ORIGINS to the exact frontend origins.',
      {op: 'cors', ok: false, stage: 'production-without-allow-list'}
    );
    return;
  }

  safeLog.info('CORS policy resolved', {
    op: 'cors',
    ok: true,
    source: configured.length > 0 ? 'CORS_ORIGINS' : 'development-defaults',
    production: isProduction(),
    originCount: effective.length,
    origins: effective,
    credentials: false,
  });
}
