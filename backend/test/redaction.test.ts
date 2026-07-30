/**
 * Log-redaction tests.
 *
 * Each test plants a representative secret at a realistic location — top level,
 * nested, inside an array, behind mixed key casing, hung off an error — and
 * asserts the serialised output does not contain it.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTED,
  isSensitiveKey,
  redact,
  redactMessage,
  redactMeta,
} from '../src/cloudCode/utils/logging/redact';
import {buildParseLogLine} from '../src/cloudCode/utils/logging/safeLogger';

/** Distinctive canaries — if any appears in output, redaction failed. */
const CANARY = {
  password: 'PlainTextPassw0rd!canary',
  sessionToken: 'r:0123456789abcdef0123456789abcdef',
  masterKey: 'MASTERKEYCANARY0123456789abcdef',
  dbUri: 'mongodb://user:secret@localhost:27017/cyf',
  email: 'student.canary@example.com',
  phone: '+963900000000',
  accessToken: 'ya29.ACCESSTOKENCANARY',
};

function serialise(value: unknown): string {
  return JSON.stringify(value);
}

function assertNoCanaries(output: string, exclude: string[] = []) {
  for (const [name, value] of Object.entries(CANARY)) {
    if (exclude.includes(name)) continue;
    assert.ok(
      !output.includes(value),
      `${name} canary leaked into output: ${output}`
    );
  }
}

describe('sensitive key detection', () => {
  const sensitive = [
    'password',
    'Password',
    'PASSWORD',
    'sessionToken',
    'session_token',
    'SESSION-TOKEN',
    'X-Parse-Session-Token',
    'masterKey',
    'MasterKey',
    '_MasterKey',
    'readOnlyMasterKey',
    'authData',
    'auth_data',
    'authorization',
    'Cookie',
    'databaseURI',
    'restAPIKey',
    'accessToken',
    'refresh_token',
    'email',
    'phoneNumber',
    'base64',
  ];

  for (const key of sensitive) {
    test(`'${key}' is sensitive`, () => {
      assert.equal(isSensitiveKey(key), true);
    });
  }

  const safe = ['op', 'route', 'userId', 'code', 'stage', 'ok', 'count', 'roleName'];
  for (const key of safe) {
    test(`'${key}' is not sensitive`, () => {
      assert.equal(isSensitiveKey(key), false);
    });
  }
});

describe('recursive redaction', () => {
  test('masks top-level secrets', () => {
    const output = serialise(
      redactMeta({password: CANARY.password, sessionToken: CANARY.sessionToken})
    );
    assertNoCanaries(output);
    assert.ok(output.includes(REDACTED));
  });

  test('masks deeply nested secrets', () => {
    const output = serialise(
      redactMeta({
        level1: {
          level2: {
            level3: {
              credentials: {password: CANARY.password},
              connection: {databaseURI: CANARY.dbUri},
            },
          },
        },
      })
    );
    assertNoCanaries(output);
  });

  test('masks secrets inside arrays', () => {
    const output = serialise(
      redactMeta({
        users: [
          {email: CANARY.email, phoneNumber: CANARY.phone},
          {authData: {google: {access_token: CANARY.accessToken}}},
        ],
      })
    );
    assertNoCanaries(output);
  });

  test('masks mixed-casing key variants', () => {
    const output = serialise(
      redactMeta({
        PASSWORD: CANARY.password,
        Session_Token: CANARY.sessionToken,
        'X-Parse-Master-Key': CANARY.masterKey,
      })
    );
    assertNoCanaries(output);
  });

  test('drops request/response bodies wholesale', () => {
    const output = serialise(
      redactMeta({
        body: {password: CANARY.password},
        params: {password: CANARY.password},
        headers: {authorization: `Bearer ${CANARY.accessToken}`},
      })
    );
    assertNoCanaries(output);
    assert.ok(output.includes('[OMITTED]'));
  });

  test('redacts errors that carry request data', () => {
    const error = new Error('Request failed') as Error & {
      config?: unknown;
      response?: unknown;
    };
    error.config = {headers: {authorization: `Bearer ${CANARY.accessToken}`}};
    error.response = {data: {password: CANARY.password}};

    const output = serialise(redact(error));
    assertNoCanaries(output);
    assert.ok(output.includes('Request failed'));
  });

  test('never emits a raw Parse object', () => {
    const fakeParseObject = {
      className: '_User',
      id: 'abc123',
      attributes: {email: CANARY.email, authData: {google: {id: 'x'}}},
      get: () => undefined,
    };
    const output = serialise(redactMeta({user: fakeParseObject}));
    assertNoCanaries(output);
    assert.ok(output.includes('[ParseObject _User#abc123]'));
  });

  test('summarises buffers instead of emitting bytes', () => {
    const output = serialise(redactMeta({payload: Buffer.from('binary-image-data')}));
    assert.ok(output.includes('bytes'));
    assert.ok(!output.includes('binary-image-data'));
  });

  test('survives circular graphs without leaking', () => {
    const node: Record<string, unknown> = {password: CANARY.password};
    node['self'] = node;
    const output = serialise(redactMeta(node));
    assertNoCanaries(output);
  });

  test('handles null, undefined, and primitives', () => {
    assert.equal(redact(null), null);
    assert.equal(redact(undefined), undefined);
    assert.equal(redact(7), 7);
    assert.equal(redact(true), true);
  });
});

describe('message scrubbing', () => {
  test('masks a Mongo URI in free text', () => {
    const output = redactMessage(`connecting to ${CANARY.dbUri}`);
    assert.ok(!output.includes(CANARY.dbUri));
  });

  test('masks a Parse session token in free text', () => {
    const output = redactMessage(`token ${CANARY.sessionToken} rejected`);
    assert.ok(!output.includes(CANARY.sessionToken));
  });

  test("masks sensitive values inside Parse's serialised Input line", () => {
    // Exactly the shape Parse Server writes for a cloud-function call.
    const line = redactMessage(
      `Ran cloud function loginUser for user undefined with:\n  Input: ${JSON.stringify({
        username: 'admin',
        password: CANARY.password,
        email: CANARY.email,
        phoneNumber: CANARY.phone,
      })}`
    );
    assertNoCanaries(line);
    // The operation name and the non-sensitive username stay readable.
    assert.ok(line.includes('loginUser'));
    assert.ok(line.includes('admin'));
  });

  test("masks sensitive values inside Parse's serialised Result line", () => {
    const line = redactMessage(
      `  Result: ${JSON.stringify({
        id: 'abc',
        sessionToken: CANARY.sessionToken,
        authData: {google: {access_token: CANARY.accessToken}},
      })}`
    );
    assertNoCanaries(line);
  });

  test('masks a query-string shaped secret', () => {
    const line = redactMessage(`GET /api/x?sessionToken=${CANARY.sessionToken}&limit=10`);
    assertNoCanaries(line);
    assert.ok(line.includes('limit=10'));
  });

  test('leaves a non-sensitive key/value pair intact', () => {
    const line = redactMessage('{"op":"loginUser","ok":true,"count":3}');
    assert.ok(line.includes('loginUser'));
    assert.ok(line.includes('true'));
    assert.ok(line.includes('3'));
  });
});

describe('Parse logger adapter', () => {
  test('redacts cloud-function params Parse would otherwise print', () => {
    const line = buildParseLogLine('info', 'Ran cloud function loginUser', {
      params: {username: 'admin', password: CANARY.password},
      user: 'abc123',
    });
    assertNoCanaries(line);
  });

  test('redacts a sensitive object message', () => {
    const line = buildParseLogLine('error', {
      message: 'failed',
      sessionToken: CANARY.sessionToken,
    });
    assertNoCanaries(line);
  });

  test('keeps the operation name visible for diagnosis', () => {
    const line = buildParseLogLine('info', 'Ran cloud function getCurrentUser', {});
    assert.ok(line.includes('getCurrentUser'));
  });
});
