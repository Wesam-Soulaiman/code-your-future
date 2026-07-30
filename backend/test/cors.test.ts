/**
 * CORS policy tests — the policy must fail closed.
 *
 * These call the real resolver and the real options object the middleware
 * receives, so they assert behaviour rather than configuration text.
 */

import {test, describe, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_HEADERS,
  ALLOWED_METHODS,
  CORS_DENY_SENTINEL,
  DEVELOPMENT_ORIGINS,
  buildCorsOptions,
  configuredOrigins,
  isOriginAllowed,
  isProduction,
  parseAllowOrigin,
  resolveAllowedOrigins,
} from '../src/cloudCode/utils/config/cors';

const snapshot: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in snapshot)) snapshot[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(snapshot)) delete snapshot[key];
});

/** Run the middleware's origin callback and return its decision. */
function decide(origin: string | undefined): boolean {
  const options = buildCorsOptions();
  let allowed: boolean | undefined;
  let error: Error | null = null;
  options.origin(origin, (err, allow) => {
    error = err;
    allowed = allow;
  });
  assert.equal(error, null, 'the origin callback must not error');
  return allowed === true;
}

describe('configured allow-list', () => {
  test('an origin listed in CORS_ORIGINS is allowed', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test,https://admin.example.test');
    assert.equal(decide('https://app.example.test'), true);
    assert.equal(decide('https://admin.example.test'), true);
  });

  test('CORS_ORIGINS wins in production too', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    assert.equal(decide('https://app.example.test'), true);
    assert.deepEqual(resolveAllowedOrigins(), ['https://app.example.test']);
  });

  test('whitespace and duplicates are normalised', () => {
    setEnv('CORS_ORIGINS', ' https://a.test , https://a.test ,https://b.test ');
    assert.deepEqual(configuredOrigins(), ['https://a.test', 'https://b.test']);
  });
});

describe('unapproved origins are rejected', () => {
  test('an origin absent from the allow-list is refused', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    assert.equal(decide('https://evil.example.test'), false);
  });

  test('a near-miss origin is refused (no prefix or suffix matching)', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    for (const origin of [
      'https://app.example.test.evil.test',
      'https://evil-app.example.test',
      'http://app.example.test', // different scheme
      'https://app.example.test:8443', // different port
    ]) {
      assert.equal(decide(origin), false, `${origin} must be refused`);
    }
  });

  test('an arbitrary origin is never reflected', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    assert.equal(decide('https://anything.test'), false);
    assert.equal(isOriginAllowed('https://anything.test'), false);
  });
});

describe('requests without an Origin header still work', () => {
  test('undefined origin is allowed (server-to-server, curl, health probes)', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    assert.equal(decide(undefined), true);
  });

  test('an empty origin string is allowed', () => {
    assert.equal(isOriginAllowed(''), true);
  });

  test('this holds in production with no allow-list', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    assert.equal(decide(undefined), true);
  });
});

describe('production without CORS_ORIGINS fails closed', () => {
  test('the allow-list is empty', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    assert.equal(isProduction(), true);
    assert.deepEqual(resolveAllowedOrigins(), []);
  });

  test('every cross-origin browser request is refused', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    for (const origin of [
      'https://app.example.test',
      'http://localhost:4200',
      'https://anything.test',
    ]) {
      assert.equal(decide(origin), false, `${origin} must be refused`);
    }
  });

  test('the development localhost list does NOT leak into production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    for (const origin of DEVELOPMENT_ORIGINS) {
      assert.equal(decide(origin), false, `${origin} must not be allowed in production`);
    }
  });
});

describe('safe development fallback', () => {
  test('the Angular dev origin works with no configuration', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('CORS_ORIGINS', undefined);
    assert.equal(decide('http://localhost:4200'), true);
    assert.equal(decide('http://127.0.0.1:4200'), true);
  });

  test('the fallback is a narrow localhost list, not a wildcard', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('CORS_ORIGINS', undefined);
    const origins = resolveAllowedOrigins();
    assert.ok(origins.length > 0 && origins.length <= 6, 'the list must stay small');
    for (const origin of origins) {
      assert.ok(
        origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'),
        `${origin} must be a localhost origin`
      );
    }
  });

  test('a non-localhost origin is still refused in development', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('CORS_ORIGINS', undefined);
    assert.equal(decide('https://evil.example.test'), false);
  });

  test('an unset NODE_ENV is treated as development, not production', () => {
    setEnv('NODE_ENV', undefined);
    setEnv('CORS_ORIGINS', undefined);
    assert.equal(isProduction(), false);
    assert.equal(decide('http://localhost:4200'), true);
  });
});

describe('no wildcard on any path', () => {
  test("'*' is never in the resolved allow-list", () => {
    for (const [nodeEnv, corsOrigins] of [
      ['production', undefined],
      ['development', undefined],
      ['production', 'https://app.example.test'],
      ['development', 'https://app.example.test'],
      [undefined, undefined],
    ] as [string | undefined, string | undefined][]) {
      setEnv('NODE_ENV', nodeEnv);
      setEnv('CORS_ORIGINS', corsOrigins);
      assert.ok(
        !resolveAllowedOrigins().includes('*'),
        `wildcard leaked with NODE_ENV=${nodeEnv}`
      );
      assert.equal(decide('https://wildcard-probe.test'), false);
    }
  });

  test("a literal '*' in CORS_ORIGINS only ever matches the literal origin '*'", () => {
    // Even a misconfiguration cannot produce reflect-any behaviour: the check is
    // an exact list membership test, so no real browser origin matches.
    setEnv('CORS_ORIGINS', '*');
    assert.equal(decide('https://anything.test'), false);
    assert.equal(decide('http://localhost:4200'), false);
  });
});

/**
 * Parse Server writes its own `Access-Control-Allow-Origin` from its mounted app
 * and defaults to `'*'`, overriding any upstream `cors()` middleware. These tests
 * cover the value handed to its `allowOrigin` option, which is what actually
 * removes the wildcard on `/api/*` responses.
 */
describe('Parse Server allowOrigin', () => {
  /** Reproduces Parse's own selection logic from `allowCrossDomain`. */
  function parseWouldReturn(requestOrigin: string | undefined): string {
    const baseOrigins = parseAllowOrigin();
    return requestOrigin && baseOrigins.includes(requestOrigin)
      ? requestOrigin
      : baseOrigins[0];
  }

  test('is never the wildcard, in any configuration', () => {
    for (const [nodeEnv, corsOrigins] of [
      ['production', undefined],
      ['development', undefined],
      ['production', 'https://app.example.test'],
      [undefined, undefined],
    ] as [string | undefined, string | undefined][]) {
      setEnv('NODE_ENV', nodeEnv);
      setEnv('CORS_ORIGINS', corsOrigins);
      const value = parseAllowOrigin();
      assert.ok(!value.includes('*'), `wildcard leaked with NODE_ENV=${nodeEnv}`);
      assert.ok(value.length > 0, 'the list must never be empty');
    }
  });

  test('echoes an allowed origin exactly', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    assert.equal(parseWouldReturn('https://app.example.test'), 'https://app.example.test');
  });

  test('never echoes a disallowed origin back to the caller', () => {
    setEnv('CORS_ORIGINS', 'https://app.example.test');
    const returned = parseWouldReturn('https://evil.example.test');
    assert.notEqual(
      returned,
      'https://evil.example.test',
      'a disallowed origin must never be echoed — the browser would grant access'
    );
  });

  test('production without configuration returns an unmatchable sentinel', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    assert.deepEqual(parseAllowOrigin(), [CORS_DENY_SENTINEL]);
    // .invalid is a reserved TLD, so no real browser origin can ever equal it.
    assert.ok(CORS_DENY_SENTINEL.endsWith('.invalid'));
    for (const origin of ['https://app.example.test', 'http://localhost:4200']) {
      assert.notEqual(parseWouldReturn(origin), origin);
    }
  });

  test('the list is never empty (Parse would emit undefined)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('CORS_ORIGINS', undefined);
    const value = parseAllowOrigin();
    assert.ok(Array.isArray(value) && value.length >= 1);
    assert.equal(typeof value[0], 'string');
  });

  test('development defaults flow through to Parse', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('CORS_ORIGINS', undefined);
    assert.deepEqual(parseAllowOrigin(), [...DEVELOPMENT_ORIGINS]);
    assert.equal(parseWouldReturn('http://localhost:4200'), 'http://localhost:4200');
  });
});

describe('explicit credentials, methods, and headers', () => {
  const options = buildCorsOptions();

  test('credentials are explicitly disabled', () => {
    assert.equal(options.credentials, false);
  });

  test('methods are an explicit narrow list', () => {
    assert.deepEqual(options.methods, ['GET', 'POST', 'OPTIONS']);
    assert.ok(!options.methods.includes('DELETE'));
    assert.ok(!options.methods.includes('PUT'));
    assert.deepEqual([...ALLOWED_METHODS], options.methods);
  });

  test('allowed headers are explicit and contain no wildcard', () => {
    assert.ok(options.allowedHeaders.length > 0);
    assert.ok(!options.allowedHeaders.includes('*'));
    assert.ok(options.allowedHeaders.includes('X-Parse-Session-Token'));
    assert.deepEqual([...ALLOWED_HEADERS], options.allowedHeaders);
  });

  test('preflight returns 204', () => {
    assert.equal(options.optionsSuccessStatus, 204);
  });
});
