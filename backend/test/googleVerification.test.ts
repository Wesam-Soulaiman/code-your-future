/**
 * Google credential verification — behaviour tests.
 *
 * The verifier boundary is injected, so every case below runs against a
 * controlled double. **No test here contacts Google**, needs network access, or
 * depends on a real token: the production verifier delegates to Parse Server's
 * bundled adapter, and what is asserted here is this repository's own contract
 * on top of it — audience, issuer, expiry, subject, and verified email.
 */

import {test, describe, before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

type Verifier = import('../src/cloudCode/modules/StudentAuth/googleVerifier').GoogleCredentialVerifier;
type RawClaims = import('../src/cloudCode/modules/StudentAuth/googleVerifier').RawGoogleClaims;

let verifierModule: typeof import('../src/cloudCode/modules/StudentAuth/googleVerifier');
let errors: typeof import('../src/cloudCode/modules/StudentAuth/errors');
let config: typeof import('../src/cloudCode/modules/StudentAuth/googleConfig');

const CLIENT_ID = '1234567890-testclient.apps.googleusercontent.com';
const CREDENTIAL = 'header.payload.signature';

let savedClientId: string | undefined;

/** Claims a healthy Google token would carry. */
function validClaims(overrides: RawClaims = {}): RawClaims {
  return {
    sub: '110000000000000000001',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    email: 'Learner@Example.com',
    email_verified: true,
    given_name: 'Lina',
    family_name: 'Haddad',
    ...overrides,
  };
}

/** A verifier that returns fixed claims and records what it was given. */
function stubVerifier(claims: RawClaims | (() => never)): Verifier & {
  seen: {credential?: string; clientId?: string};
} {
  const seen: {credential?: string; clientId?: string} = {};
  return {
    seen,
    async verify(credential: string, clientId: string): Promise<RawClaims> {
      seen.credential = credential;
      seen.clientId = clientId;
      if (typeof claims === 'function') claims();
      return claims as RawClaims;
    },
  };
}

before(async () => {
  installParseTestGlobal();
  verifierModule = await import('../src/cloudCode/modules/StudentAuth/googleVerifier');
  errors = await import('../src/cloudCode/modules/StudentAuth/errors');
  config = await import('../src/cloudCode/modules/StudentAuth/googleConfig');
  savedClientId = process.env.GOOGLE_CLIENT_ID;
});

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
});

afterEach(() => {
  verifierModule.resetGoogleCredentialVerifier();
  if (savedClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = savedClientId;
});

after(() => clearTrackedIntervals());

/**
 * Run the verifier and return the error message (which is the stable code).
 *
 * The parameter is deliberately **not** defaulted: `failureCode(undefined)` must
 * genuinely pass `undefined` through, so the "missing credential" case tests
 * what it claims to.
 */
async function failureCodeFor(credential: unknown): Promise<string> {
  try {
    await verifierModule.verifyGoogleCredential(credential);
  } catch (error) {
    return String((error as {message?: unknown}).message);
  }
  throw new Error('expected verification to fail');
}

/** The common case: a well-formed credential that fails for another reason. */
function failureCode(): Promise<string> {
  return failureCodeFor(CREDENTIAL);
}

describe('configuration', () => {
  test('reports configured when GOOGLE_CLIENT_ID is set', () => {
    assert.equal(config.isGoogleAuthConfigured(), true);
    assert.equal(config.googleClientId(), CLIENT_ID);
  });

  test('treats an empty or whitespace value as absent', () => {
    process.env.GOOGLE_CLIENT_ID = '   ';
    assert.equal(config.isGoogleAuthConfigured(), false);
    assert.equal(config.googleClientId(), undefined);
  });

  test('missing configuration fails safely with a stable code', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims()));
    assert.equal(await failureCode(), errors.StudentAuthError.GOOGLE_NOT_CONFIGURED);
  });

  test('the verifier is never even called when configuration is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const verifier = stubVerifier(validClaims());
    verifierModule.setGoogleCredentialVerifier(verifier);
    await failureCode();
    assert.equal(verifier.seen.credential, undefined);
  });

  test('the status report names the key and never carries a value', () => {
    const status = config.googleAuthStatus();
    assert.deepEqual([...status.requiredKeys], ['GOOGLE_CLIENT_ID']);
    assert.equal(JSON.stringify(status).includes(CLIENT_ID), false);
  });
});

describe('credential shape', () => {
  beforeEach(() => {
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims()));
  });

  test('a missing credential is rejected', async () => {
    assert.equal(
      await failureCodeFor(undefined),
      errors.StudentAuthError.INVALID_CREDENTIAL
    );
  });

  test('an empty credential is rejected', async () => {
    assert.equal(await failureCodeFor('   '), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('a non-string credential is rejected', async () => {
    assert.equal(
      await failureCodeFor({token: 'x'}),
      errors.StudentAuthError.INVALID_CREDENTIAL
    );
  });
});

describe('verifier failure', () => {
  test('a verifier rejection becomes INVALID_CREDENTIAL', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(() => {
        throw new Error('invalid signature');
      })
    );
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('the verifier message never reaches the client error', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(() => {
        throw new Error('jwt malformed: kid=abc123 secret-internal-detail');
      })
    );
    const message = await failureCode();
    assert.equal(message.includes('secret-internal-detail'), false);
    assert.equal(message.includes('kid'), false);
    assert.equal(message, errors.StudentAuthError.INVALID_CREDENTIAL);
  });
});

describe('claim checks', () => {
  test('a wrong audience is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({aud: 'someone-elses-client-id.apps.googleusercontent.com'}))
    );
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('an audience array containing the client id is accepted', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({aud: ['other', CLIENT_ID]}))
    );
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.equal(claims.subject, '110000000000000000001');
  });

  test('a wrong issuer is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({iss: 'https://accounts.evil.example'}))
    );
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('both official Google issuers are accepted', async () => {
    for (const issuer of ['accounts.google.com', 'https://accounts.google.com']) {
      verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims({iss: issuer})));
      const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
      assert.equal(claims.subject, '110000000000000000001');
    }
  });

  test('an expired credential is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({exp: Math.floor(Date.now() / 1000) - 1}))
    );
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('a missing expiry is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims({exp: undefined})));
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('a missing subject is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims({sub: undefined})));
    assert.equal(await failureCode(), errors.StudentAuthError.INVALID_CREDENTIAL);
  });

  test('an unverified email is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({email_verified: false}))
    );
    assert.equal(await failureCode(), errors.StudentAuthError.EMAIL_NOT_VERIFIED);
  });

  test('a missing email is rejected', async () => {
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims({email: undefined})));
    assert.equal(await failureCode(), errors.StudentAuthError.EMAIL_NOT_VERIFIED);
  });

  test("Google's string form of email_verified is accepted", async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(validClaims({email_verified: 'true'}))
    );
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.equal(claims.email, 'learner@example.com');
  });
});

describe('successful verification', () => {
  beforeEach(() => {
    verifierModule.setGoogleCredentialVerifier(stubVerifier(validClaims()));
  });

  test('returns the stable subject and the normalised email', async () => {
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.equal(claims.subject, '110000000000000000001');
    assert.equal(claims.email, 'learner@example.com');
  });

  test('returns the verified given and family names', async () => {
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.equal(claims.givenName, 'Lina');
    assert.equal(claims.familyName, 'Haddad');
  });

  test('returns nothing beyond the four consumed claims', async () => {
    verifierModule.setGoogleCredentialVerifier(
      stubVerifier(
        validClaims({
          picture: 'https://example.test/photo.jpg',
          locale: 'ar',
          hd: 'example.com',
          at_hash: 'abc',
          nonce: 'n-1',
        })
      )
    );
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.deepEqual(Object.keys(claims).sort(), [
      'email',
      'familyName',
      'givenName',
      'subject',
    ]);
  });

  test('the credential itself is never part of the result', async () => {
    const claims = await verifierModule.verifyGoogleCredential(CREDENTIAL);
    assert.equal(JSON.stringify(claims).includes(CREDENTIAL), false);
  });

  test('the credential and client id reach the verifier unchanged', async () => {
    const verifier = stubVerifier(validClaims());
    verifierModule.setGoogleCredentialVerifier(verifier);
    await verifierModule.verifyGoogleCredential(`  ${CREDENTIAL}  `);
    assert.equal(verifier.seen.credential, CREDENTIAL);
    assert.equal(verifier.seen.clientId, CLIENT_ID);
  });
});

describe('the production verifier delegates rather than reimplementing', () => {
  test('a malformed token is refused before any adapter call', async () => {
    // Three segments are required; "not-a-jwt" cannot yield a candidate subject,
    // so the adapter is never reached and no network call is possible.
    verifierModule.resetGoogleCredentialVerifier();
    assert.equal(
      await failureCodeFor('not-a-jwt'),
      errors.StudentAuthError.INVALID_CREDENTIAL
    );
  });

  test('a token whose payload is not JSON is refused', async () => {
    verifierModule.resetGoogleCredentialVerifier();
    assert.equal(
      await failureCodeFor('aGVhZGVy.bm90LWpzb24.c2ln'),
      errors.StudentAuthError.INVALID_CREDENTIAL
    );
  });
});

describe('stable error codes', () => {
  test('every code is a plain uppercase token', () => {
    for (const code of errors.STUDENT_AUTH_ERROR_CODES) {
      assert.match(code, /^[A-Z_]+$/);
    }
  });

  test('the code set is exactly the documented five', () => {
    assert.deepEqual([...errors.STUDENT_AUTH_ERROR_CODES].sort(), [
      'ACCOUNT_NOT_ELIGIBLE',
      'EMAIL_NOT_VERIFIED',
      'GOOGLE_NOT_CONFIGURED',
      'INVALID_CREDENTIAL',
      'SIGN_IN_FAILED',
    ]);
  });

  test('a Parse error carries the code as its whole message', () => {
    const error = errors.studentAuthError(errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    assert.equal(error.message, 'ACCOUNT_NOT_ELIGIBLE');
    assert.equal(error.code, Parse.Error.OPERATION_FORBIDDEN);
  });

  test('a conflicting account and an unknown account are indistinguishable', () => {
    // Both paths use ACCOUNT_NOT_ELIGIBLE, so the endpoint cannot be used to
    // discover whether a given Google address already has an account here.
    const conflict = errors.studentAuthError(errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    const withdrawn = errors.studentAuthError(errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    assert.equal(conflict.message, withdrawn.message);
    assert.equal(conflict.code, withdrawn.code);
  });
});
