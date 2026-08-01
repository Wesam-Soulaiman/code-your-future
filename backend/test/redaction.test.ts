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

  test('never emits buffer contents', () => {
    const output = serialise(redactMeta({payload: Buffer.from('binary-image-data')}));
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

/**
 * ── S-19 — OAuth identity redaction ⟨CP2B closeout⟩ ─────────────────────────
 *
 * Parse Server logs each trigger's `Input`/`Result`, so saving a
 * `StudentAuthIdentity` used to write the Google **subject** into the log line.
 * The subject is a stable identifier for a real person, so it is now redacted by
 * key name — everywhere, at every log level, and without relying on `LOG_LEVEL`.
 *
 * The rules must stay precise: `id` and `objectId` are ordinary, safe fields and
 * must survive, or every log line loses the identifier that makes it useful.
 */
const OAUTH_CANARY = {
  subject: '110000000000000000900',
  credential: 'eyJhbGciOiJSUzI1NiJ9.CREDENTIALCANARY.signature',
  idToken: 'eyJhbGciOiJSUzI1NiJ9.IDTOKENCANARY.signature',
  refreshToken: '1//REFRESHTOKENCANARY',
  authorizationCode: '4/AUTHORIZATIONCODECANARY',
};

function assertNoOauthCanaries(output: string) {
  for (const [name, value] of Object.entries(OAUTH_CANARY)) {
    assert.ok(!output.includes(value), `${name} canary leaked: ${output}`);
  }
}

describe('OAuth identity redaction (S-19)', () => {
  test('every OAuth identity key name is recognised as sensitive', () => {
    for (const key of [
      'sub',
      'subject',
      'providerSubject',
      'googleSubject',
      'oauthSubject',
      'credential',
      'idToken',
      'id_token',
      'accessToken',
      'refreshToken',
      'authorizationCode',
      'authData',
      'claims',
      'rawClaims',
      'authentication',
    ]) {
      assert.ok(isSensitiveKey(key), `${key} must be treated as sensitive`);
    }
  });

  test('a direct subject value is redacted', () => {
    const output = serialise(redact({providerSubject: OAUTH_CANARY.subject}));
    assert.ok(output.includes(REDACTED));
    assertNoOauthCanaries(output);
  });

  test('a nested subject is redacted at depth', () => {
    const output = serialise(
      redact({
        op: 'provisionStudent',
        identity: {
          provider: 'google',
          detail: {inner: {providerSubject: OAUTH_CANARY.subject}},
        },
      })
    );
    assertNoOauthCanaries(output);
    // The non-sensitive neighbours survive, so the line is still diagnosable.
    assert.ok(output.includes('provisionStudent'));
    assert.ok(output.includes('google'));
  });

  test('a claim bag containing sub is redacted', () => {
    const output = serialise(
      redact({claims: {sub: OAUTH_CANARY.subject, email: CANARY.email}})
    );
    assertNoOauthCanaries(output);
    assert.ok(!output.includes(CANARY.email));
  });

  test('a bare sub claim is redacted', () => {
    const output = serialise(redact({sub: OAUTH_CANARY.subject}));
    assertNoOauthCanaries(output);
  });

  test('subjects inside arrays are redacted', () => {
    const output = serialise(
      redact([{providerSubject: OAUTH_CANARY.subject}, {sub: OAUTH_CANARY.subject}])
    );
    assertNoOauthCanaries(output);
  });

  test('subjects inside a Map are redacted', () => {
    const map = new Map<string, unknown>([
      ['providerSubject', OAUTH_CANARY.subject],
      ['credential', OAUTH_CANARY.credential],
    ]);
    assertNoOauthCanaries(serialise(redact(map)));
  });

  test('subjects inside a Set are redacted', () => {
    const set = new Set([{sub: OAUTH_CANARY.subject}]);
    assertNoOauthCanaries(serialise(redact(set)));
  });

  test('subjects hung off an Error are redacted', () => {
    const error = new Error('provisioning failed') as Error & Record<string, unknown>;
    error['providerSubject'] = OAUTH_CANARY.subject;
    error['credential'] = OAUTH_CANARY.credential;
    const output = serialise(redact(error));
    assertNoOauthCanaries(output);
    assert.ok(output.includes('provisioning failed'));
  });

  test('subjects on a Parse-like object never reach the output', () => {
    const parseLike = {
      className: 'StudentAuthIdentity',
      id: 'abc123',
      attributes: {providerSubject: OAUTH_CANARY.subject},
      get: () => undefined,
    };
    const output = serialise(redact(parseLike));
    assertNoOauthCanaries(output);
    assert.ok(output.includes('StudentAuthIdentity'));
  });

  test('every OAuth token kind stays redacted', () => {
    const output = serialise(
      redact({
        credential: OAUTH_CANARY.credential,
        idToken: OAUTH_CANARY.idToken,
        id_token: OAUTH_CANARY.idToken,
        accessToken: CANARY.accessToken,
        refreshToken: OAUTH_CANARY.refreshToken,
        authorizationCode: OAUTH_CANARY.authorizationCode,
        authData: {google: {id: OAUTH_CANARY.subject}},
      })
    );
    assertNoOauthCanaries(output);
    assert.ok(!output.includes(CANARY.accessToken));
  });

  test('ordinary id and objectId values survive', () => {
    const output = serialise(
      redact({id: 'bwz1IxJxNp', objectId: 'Xy7Qm2', userId: 'u1', code: 'SIGN_IN_FAILED'})
    );
    assert.ok(output.includes('bwz1IxJxNp'), 'id must survive');
    assert.ok(output.includes('Xy7Qm2'), 'objectId must survive');
    assert.ok(output.includes('u1'), 'userId must survive');
    assert.ok(output.includes('SIGN_IN_FAILED'), 'the stable error code must survive');
  });

  test('short words merely containing "sub" are not redacted', () => {
    // `sub` is matched as a whole word, so ordinary product vocabulary survives.
    const output = serialise(
      redact({submissionCount: 7, subtotal: 42, subscriptionTier: 'basic'})
    );
    assert.ok(output.includes('7'));
    assert.ok(output.includes('42'));
    assert.ok(output.includes('basic'));
  });

  test('every existing redaction rule still holds', () => {
    const output = serialise(
      redactMeta({
        password: CANARY.password,
        sessionToken: CANARY.sessionToken,
        masterKey: CANARY.masterKey,
        databaseURI: CANARY.dbUri,
        email: CANARY.email,
        phoneNumber: CANARY.phone,
        clientSecret: 'CLIENTSECRETCANARY',
      })
    );
    assertNoCanaries(output);
    assert.ok(!output.includes('CLIENTSECRETCANARY'));
  });
});

describe('Parse trigger logging for a Student sign-in (S-19)', () => {
  /** The exact shape Parse Server writes when the identity trigger runs. */
  const TRIGGER_INPUT =
    `Input: {"ACL":{},"provider":"google","providerSubject":"${OAUTH_CANARY.subject}",` +
    '"user":{"__type":"Pointer","className":"_User","objectId":"bwz1IxJxNp"}}';

  test('the trigger line no longer carries the Google subject', () => {
    const line = redactMessage(TRIGGER_INPUT);
    assertNoOauthCanaries(line);
    assert.ok(line.includes(REDACTED));
  });

  test('the trigger line keeps the objectId that makes it useful', () => {
    const line = redactMessage(TRIGGER_INPUT);
    assert.ok(line.includes('bwz1IxJxNp'));
    assert.ok(line.includes('_User'));
  });

  test('this holds through the Parse logger adapter, at info level', () => {
    // The previous mitigation was LOG_LEVEL=warn. Redaction now applies at the
    // level Parse actually logs triggers at, so no log-level setting is needed.
    const line = buildParseLogLine('info', TRIGGER_INPUT, {
      className: 'StudentAuthIdentity',
      triggerType: 'beforeSave',
    });
    assertNoOauthCanaries(line);
    assert.ok(line.includes('StudentAuthIdentity'));
  });

  test('the sign-in call log carries no credential, subject, email, or token', () => {
    const line = buildParseLogLine(
      'info',
      'Ran cloud function loginWithGoogle for user undefined with:\n' +
        `  Input: {"credential":"${OAUTH_CANARY.credential}"}\n` +
        `  Result: {"id":"bwz1IxJxNp","roles":["Student"],"sessionToken":"${CANARY.sessionToken}"}`,
      {functionName: 'loginWithGoogle', params: {credential: OAUTH_CANARY.credential}}
    );
    assertNoOauthCanaries(line);
    assertNoCanaries(line);
    assert.ok(line.includes('loginWithGoogle'), 'the operation stays diagnosable');
  });

  test('a provisioning failure log carries no identity data', () => {
    const line = buildParseLogLine('error', 'Student provisioning failed', {
      op: 'provisionStudent',
      providerSubject: OAUTH_CANARY.subject,
      email: CANARY.email,
      userId: 'bwz1IxJxNp',
      code: 'ACCOUNT_NOT_ELIGIBLE',
    });
    assertNoOauthCanaries(line);
    assertNoCanaries(line);
    assert.ok(line.includes('ACCOUNT_NOT_ELIGIBLE'));
    assert.ok(line.includes('bwz1IxJxNp'));
  });
});
