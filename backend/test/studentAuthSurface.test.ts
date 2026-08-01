/**
 * The Student authentication surface: registered functions, the safe session
 * DTOs, and the logging allow-list.
 *
 * This file loads **both** auth modules, so the assertions about the complete
 * cloud-function surface are made against everything the server registers.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let dto: typeof import('../src/cloudCode/modules/StudentAuth/dto');
let logging: typeof import('../src/cloudCode/modules/StudentAuth/logging');
let AppRole: typeof import('../src/cloudCode/utils/constants/roles').AppRole;

/** A `_User` double carrying whatever attributes a test needs. */
function fakeUser(attrs: Record<string, unknown>, id = 'u1'): Parse.User {
  const Parse = parseSdk();
  const user = new Parse.User();
  user.id = id;
  for (const [key, value] of Object.entries(attrs)) user.set(key, value);
  return user;
}

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/StudentAuthIdentity');
  await import('../src/cloudCode/modules/User/functions');
  await import('../src/cloudCode/modules/StudentAuth/functions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/StudentAuth/dto');
  logging = await import('../src/cloudCode/modules/StudentAuth/logging');
  AppRole = (await import('../src/cloudCode/utils/constants/roles')).AppRole;
});

after(() => clearTrackedIntervals());

describe('registered cloud-function surface', () => {
  test('is exactly the five authentication functions', () => {
    const names = registry.getFunctions().map(fn => fn.name).sort();
    assert.deepEqual(names, [
      'getCurrentUser',
      'getSession',
      'loginUser',
      'loginWithGoogle',
      'logout',
    ]);
  });

  test('Admin password login is still registered and unchanged in shape', () => {
    const login = registry.getFunction('loginUser');
    assert.ok(login, 'loginUser must still exist');
    assert.equal(login!.config.validation?.requireUser, false);
    assert.ok(login!.config.rateLimit, 'Admin login must stay rate limited');
  });

  test('the Google endpoint is unauthenticated and rate limited', () => {
    const google = registry.getFunction('loginWithGoogle');
    assert.ok(google, 'loginWithGoogle must exist');
    assert.equal(google!.config.validation?.requireUser, false);
    assert.ok(google!.config.rateLimit, 'an account-creating endpoint must be rate limited');
    assert.equal(google!.config.rateLimit?.max, 10);
  });

  test('the Google endpoint accepts exactly one field', () => {
    const fields = registry.getFunction('loginWithGoogle')!.config.validation?.fields ?? {};
    assert.deepEqual(Object.keys(fields), ['credential']);
  });

  test('session restoration requires a session and takes no parameters', () => {
    const session = registry.getFunction('getSession');
    assert.equal(session!.config.validation?.requireUser, true);
    assert.equal(session!.config.validation?.fields, undefined);
  });

  test('no function exposes identity records', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'identity',
      'identities',
      'authidentity',
      'listidentities',
      'getidentity',
      'linkaccount',
      'unlink',
      'mergeaccount',
    ]) {
      assert.ok(
        !names.some(name => name.includes(forbidden)),
        `no function may expose '${forbidden}'`
      );
    }
  });

  test('no Student password flow was introduced', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'studentlogin',
      'studentsignup',
      'signup',
      'requestpasswordreset',
      'resetpassword',
      'changepassword',
      'setpassword',
      'createstudent',
      'assignrole',
    ]) {
      assert.ok(
        !names.some(name => name.includes(forbidden)),
        `no function may implement '${forbidden}'`
      );
    }
  });

  test('no future product function was added', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const future of [
      'profile',
      'batch',
      'invitation',
      'enroll',
      'resource',
      'slide',
      'task',
      'submission',
      'pinned',
      'reel',
    ]) {
      assert.ok(
        !names.some(name => name.includes(future)),
        `${future} belongs to a later checkpoint`
      );
    }
  });

  test('AppSettings remains absent', () => {
    assert.equal(registry.getFunction('getAppSetting'), undefined);
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    assert.ok(!names.some(name => name.includes('appsetting')));
  });
});

describe('safe session DTO', () => {
  const studentUser = () =>
    fakeUser({
      username: 'gid_9Xd2sQ1a',
      email: 'learner@example.com',
      firstName: 'Lina',
      lastName: 'Haddad',
      phoneNumber: '+963000000',
      authData: {google: {id: 'sub-1', id_token: 'header.payload.signature'}},
    });

  test('exposes only id, roles, displayName, and the completion flag', () => {
    const result = dto.toSessionDto(studentUser(), [AppRole.STUDENT]);
    assert.deepEqual(Object.keys(result).sort(), [
      'displayName',
      'id',
      'profileComplete',
      'roles',
    ]);
  });

  test('the completion flag is one boolean, never the profile ⟨CP3A⟩', () => {
    const incomplete = dto.toSessionDto(studentUser(), [AppRole.STUDENT], false);
    const complete = dto.toSessionDto(studentUser(), [AppRole.STUDENT], true);
    assert.equal(incomplete.profileComplete, false);
    assert.equal(complete.profileComplete, true);

    // No profile field travels on a session response.
    const serialised = JSON.stringify(complete);
    for (const field of ['phone', 'city', 'dateOfBirth', 'institution', 'careerGoal']) {
      assert.equal(serialised.includes(field), false, `${field} must not appear`);
    }
  });

  test('an Admin has no completion flag at all', () => {
    // An Admin's profile is not incomplete — it does not exist.
    const admin = fakeUser({username: 'wesam'});
    const result = dto.toSessionDto(admin, [AppRole.ADMIN]);
    assert.equal('profileComplete' in result, false);
  });

  test('never carries a session token', () => {
    const result = dto.toSessionDto(studentUser(), [AppRole.STUDENT]) as unknown as Record<string, unknown>;
    assert.equal('sessionToken' in result, false);
  });

  test('omits every forbidden key', () => {
    const result = dto.toSessionDto(studentUser(), [AppRole.STUDENT]) as unknown as Record<string, unknown>;
    for (const forbidden of dto.FORBIDDEN_SESSION_DTO_KEYS) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
  });

  test("never leaks the Student's internal username", () => {
    const serialised = JSON.stringify(dto.toSessionDto(studentUser(), [AppRole.STUDENT]));
    assert.equal(serialised.includes('gid_9Xd2sQ1a'), false);
  });

  test('leaks no sensitive value under any key', () => {
    const serialised = JSON.stringify(dto.toSessionDto(studentUser(), [AppRole.STUDENT]));
    for (const secret of [
      'learner@example.com',
      '+963000000',
      'header.payload.signature',
      'sub-1',
    ]) {
      assert.equal(serialised.includes(secret), false, `${secret} must not appear`);
    }
  });

  test('exposes role names only, never role objects', () => {
    const result = dto.toSessionDto(studentUser(), [AppRole.STUDENT]);
    assert.deepEqual(result.roles, ['Student']);
    assert.equal(typeof result.roles[0], 'string');
  });

  test('reports a Student display name from the verified Google names', () => {
    const result = dto.toSessionDto(studentUser(), [AppRole.STUDENT]);
    assert.equal(result.displayName, 'Lina Haddad');
  });

  test('a Student with no name gets no display name rather than a username', () => {
    const anonymous = fakeUser({username: 'gid_opaque', email: 'a@example.com'});
    const result = dto.toSessionDto(anonymous, [AppRole.STUDENT]);
    assert.equal(result.displayName, undefined);
    assert.equal(JSON.stringify(result).includes('gid_opaque'), false);
  });

  test("an Admin may fall back to their own login name", () => {
    const admin = fakeUser({username: 'wesam'});
    const result = dto.toSessionDto(admin, [AppRole.ADMIN]);
    assert.equal(result.displayName, 'wesam');
  });

  test('the sign-in DTO adds exactly the session token', () => {
    const result = dto.toSessionWithTokenDto(studentUser(), [AppRole.STUDENT], 'r:token');
    assert.deepEqual(Object.keys(result).sort(), [
      'displayName',
      'id',
      'profileComplete',
      'roles',
      'sessionToken',
    ]);
    assert.equal(result.sessionToken, 'r:token');
  });

  test('the sign-in DTO still omits every forbidden key', () => {
    const result = dto.toSessionWithTokenDto(
      studentUser(),
      [AppRole.STUDENT],
      'r:token'
    ) as unknown as Record<string, unknown>;
    for (const forbidden of dto.FORBIDDEN_SESSION_DTO_KEYS) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
  });
});

describe('authentication logging', () => {
  test('emits only the allow-listed fields', () => {
    const safe = logging.toSafeAuthFields({
      op: 'loginWithGoogle',
      provider: 'google',
      stage: 'verify',
      ok: false,
      code: 'INVALID_CREDENTIAL',
      userId: 'u1',
      created: true,
    });
    assert.deepEqual(Object.keys(safe).sort(), [
      'code',
      'created',
      'ok',
      'op',
      'provider',
      'stage',
      'userId',
    ]);
  });

  test('drops the credential, the email, and the raw claims', () => {
    const safe = logging.toSafeAuthFields({
      op: 'loginWithGoogle',
      credential: 'header.payload.signature',
      id_token: 'header.payload.signature',
      email: 'learner@example.com',
      claims: {sub: '110000000000000000001', email: 'learner@example.com'},
      password: 'hunter2',
      sessionToken: 'r:abcdef0123456789abcdef',
      authData: {google: {id: 'sub-1'}},
    });
    assert.deepEqual(Object.keys(safe), ['op']);
  });

  test('drops the Google subject even under an allow-listed-looking name', () => {
    const safe = logging.toSafeAuthFields({
      op: 'provisionStudent',
      providerSubject: '110000000000000000001',
      sub: '110000000000000000001',
      subject: '110000000000000000001',
    });
    assert.deepEqual(Object.keys(safe), ['op']);
    assert.equal(JSON.stringify(safe).includes('110000000000000000001'), false);
  });

  test('drops a raw Parse object passed under an allowed name', () => {
    const Parse = parseSdk();
    const user = new Parse.User();
    user.id = 'u1';
    const safe = logging.toSafeAuthFields({op: 'x', userId: user});
    assert.equal('userId' in safe, false);
  });

  test('the allow-list is the documented seven fields', () => {
    assert.deepEqual([...logging.ALLOWED_AUTH_LOG_FIELDS].sort(), [
      'code',
      'created',
      'ok',
      'op',
      'provider',
      'stage',
      'userId',
    ]);
  });
});

describe('identity model shape', () => {
  let schema: {
    className: string;
    fields: Record<string, unknown>;
    compoundIndexes?: {fields: string[]; unique?: boolean}[];
  };

  before(async () => {
    const model = (await import('../src/cloudCode/models/StudentAuthIdentity')).default;
    const decorators = await import('@90soft/parse-server-kit');
    schema = (
      decorators as unknown as {
        getSchemaDefinition: (target: unknown) => typeof schema;
      }
    ).getSchemaDefinition(model);
  });

  test('stores exactly the provider identity, and nothing about the person', () => {
    const declared = Object.keys(schema.fields).sort();
    // `providerPictureUrl` is provider identity data like the subject beside
    // it, captured once so the first profile save can import an avatar. It is
    // a protected field and appears in no DTO ⟨CP3A catalog⟩.
    assert.deepEqual(declared, [
      'provider',
      'providerPictureUrl',
      'providerSubject',
      'user',
    ]);
  });

  test('the avatar URL is hidden from every non-master caller', () => {
    const clp = (schema as unknown as {
      classLevelPermissions?: {protectedFields?: Record<string, string[]>};
    }).classLevelPermissions;
    for (const audience of ['*', 'authenticated']) {
      assert.ok(
        (clp?.protectedFields?.[audience] ?? []).includes('providerPictureUrl'),
        `providerPictureUrl must be hidden from ${audience}`
      );
    }
  });

  test('stores no token, claim, or profile data', () => {
    const declared = Object.keys(schema.fields).map(name => name.toLowerCase());
    for (const forbidden of [
      'credential',
      'idtoken',
      'id_token',
      'accesstoken',
      'refreshtoken',
      'email',
      'name',
      'picture',
      'locale',
      'claims',
      'rawclaims',
      'profile',
    ]) {
      assert.ok(!declared.includes(forbidden), `${forbidden} must not be stored`);
    }
  });

  test('declares a unique index on provider + providerSubject', () => {
    const found = (schema.compoundIndexes ?? []).find(
      index =>
        index.fields.includes('provider') && index.fields.includes('providerSubject')
    );
    assert.ok(found, 'a (provider, providerSubject) index must be declared');
    assert.equal(found!.unique, true);
  });

  test('declares a unique index preventing two identities for one Student', () => {
    const found = (schema.compoundIndexes ?? []).find(
      index => index.fields.includes('provider') && index.fields.includes('_p_user')
    );
    assert.ok(found, 'a (provider, user) index must be declared');
    assert.equal(found!.unique, true);
  });
});
