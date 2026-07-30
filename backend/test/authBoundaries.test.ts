/**
 * Authentication and authorization boundary tests.
 *
 * These exercise the real authorize helpers and the real registered cloud
 * functions. `_Role` lookups are served by a stubbed `Parse.Query`, so the tests
 * are deterministic and touch no database.
 */

import {test, describe, before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

type Authorize = typeof import('../src/cloudCode/utils/auth/authorize');
let authorize: Authorize;
let AppRole: typeof import('../src/cloudCode/utils/constants/roles').AppRole;
let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;

/** Role names the stubbed `_Role` query will report for the next call. */
let stubbedRoleNames: string[] = [];
let originalQuery: unknown;

function stubRoleQuery(): void {
  const Parse = parseSdk();
  originalQuery = Parse.Query;

  class StubQuery {
    private className: string;
    constructor(target: unknown) {
      this.className =
        typeof target === 'string'
          ? target
          : ((target as {className?: string})?.className ?? 'unknown');
    }
    equalTo() {
      return this;
    }
    select() {
      return this;
    }
    limit() {
      return this;
    }
    async find() {
      if (this.className === '_Role') {
        return stubbedRoleNames.map(name => ({get: (key: string) => (key === 'name' ? name : undefined)}));
      }
      return [];
    }
    async first() {
      return undefined;
    }
  }

  (Parse as unknown as {Query: unknown}).Query = StubQuery;
}

function restoreRoleQuery(): void {
  const Parse = parseSdk();
  (Parse as unknown as {Query: unknown}).Query = originalQuery;
}

function fakeUser(id = 'u1'): Parse.User {
  const Parse = parseSdk();
  const user = new Parse.User();
  user.id = id;
  user.set('username', 'someone');
  return user;
}

function requestWith(user: Parse.User | undefined, params: Record<string, unknown> = {}) {
  return {user, params} as unknown as Parse.Cloud.FunctionRequest;
}

before(async () => {
  installParseTestGlobal();
  authorize = await import('../src/cloudCode/utils/auth/authorize');
  AppRole = (await import('../src/cloudCode/utils/constants/roles')).AppRole;

  // Importing the module registers the cloud functions with the kit registry.
  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/modules/User/functions');
  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
});

beforeEach(() => {
  stubbedRoleNames = [];
  stubRoleQuery();
});

afterEach(() => {
  restoreRoleQuery();
});

describe('requireUser', () => {
  test('rejects a Visitor with INVALID_SESSION_TOKEN', () => {
    const Parse = parseSdk();
    assert.throws(
      () => authorize.requireUser(requestWith(undefined)),
      (error: Parse.Error) => error.code === Parse.Error.INVALID_SESSION_TOKEN
    );
  });

  test('returns the authenticated user', () => {
    const user = fakeUser();
    assert.equal(authorize.requireUser(requestWith(user)), user);
  });
});

describe('role checks read live membership', () => {
  test('Admin membership grants requireAdmin', async () => {
    stubbedRoleNames = ['Admin'];
    const user = await authorize.requireAdmin(requestWith(fakeUser()));
    assert.equal(user.id, 'u1');
  });

  test('a Student is refused Admin access', async () => {
    stubbedRoleNames = ['Student'];
    const Parse = parseSdk();
    await assert.rejects(
      authorize.requireAdmin(requestWith(fakeUser())),
      (error: Parse.Error) => error.code === Parse.Error.OPERATION_FORBIDDEN
    );
  });

  test('a Visitor is refused Admin access', async () => {
    const Parse = parseSdk();
    await assert.rejects(
      authorize.requireAdmin(requestWith(undefined)),
      (error: Parse.Error) => error.code === Parse.Error.INVALID_SESSION_TOKEN
    );
  });

  test('legacy SuperAdmin membership grants nothing', async () => {
    stubbedRoleNames = ['SuperAdmin'];
    await assert.rejects(authorize.requireAdmin(requestWith(fakeUser())));
    assert.deepEqual(await authorize.getAppRoles(fakeUser()), []);
  });

  test('legacy Employee membership grants nothing', async () => {
    stubbedRoleNames = ['Employee'];
    await assert.rejects(authorize.requireAdmin(requestWith(fakeUser())));
    await assert.rejects(authorize.requireStudent(requestWith(fakeUser())));
    assert.deepEqual(await authorize.getAppRoles(fakeUser()), []);
  });

  test('unknown role names are discarded', async () => {
    stubbedRoleNames = ['Company', 'Trainer', 'Recruiter', 'Moderator'];
    assert.deepEqual(await authorize.getAppRoles(fakeUser()), []);
  });

  test('only recognised roles survive a mixed membership list', async () => {
    stubbedRoleNames = ['SuperAdmin', 'Admin', 'Employee', 'Student'];
    assert.deepEqual(await authorize.getAppRoles(fakeUser()), ['Admin', 'Student']);
  });
});

describe('privileged client parameters are rejected', () => {
  const forbidden = [
    'role',
    'roles',
    'ACL',
    'sessionToken',
    'authData',
    'masterKey',
    '_MasterKey',
    'protectedFields',
    'owner',
    'userId',
    'studentId',
  ];

  for (const key of forbidden) {
    test(`'${key}' is refused`, () => {
      const Parse = parseSdk();
      assert.throws(
        () => authorize.rejectPrivilegedParams(requestWith(fakeUser(), {[key]: 'x'}), 'test'),
        (error: Parse.Error) => error.code === Parse.Error.OPERATION_FORBIDDEN
      );
    });
  }

  test('ordinary parameters pass', () => {
    assert.doesNotThrow(() =>
      authorize.rejectPrivilegedParams(
        requestWith(fakeUser(), {username: 'admin', password: 'x'}),
        'test'
      )
    );
  });
});

describe('registered cloud-function surface', () => {
  test('is exactly login, current user, and logout', () => {
    const names = registry.getFunctions().map(fn => fn.name).sort();
    assert.deepEqual(names, ['getCurrentUser', 'loginUser', 'logout']);
  });

  test('retired user-management functions are gone', () => {
    const names = registry.getFunctions().map(fn => fn.name);
    for (const retired of [
      'signupUser',
      'createUser',
      'updateUser',
      'deleteUser',
      'listUsers',
      'getUser',
      'searchEmployees',
    ]) {
      assert.ok(!names.includes(retired), `${retired} must be removed`);
    }
  });

  test('no Student password flow is registered', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'studentlogin',
      'studentsignup',
      'signup',
      'requestpasswordreset',
      'resetpassword',
      'changepassword',
      'updatepassword',
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

  test('AppSettings cloud function is gone', () => {
    assert.equal(registry.getFunction('getAppSetting'), undefined);
  });

  test('login is the only unauthenticated function, and it is rate limited', () => {
    const open = registry
      .getFunctions()
      .filter(fn => fn.config.validation?.requireUser !== true);
    assert.deepEqual(open.map(fn => fn.name), ['loginUser']);
    assert.ok(open[0].config.rateLimit, 'login must be rate limited');
  });

  test('current user and logout both require a session', () => {
    for (const name of ['getCurrentUser', 'logout']) {
      const fn = registry.getFunction(name);
      assert.equal(fn?.config.validation?.requireUser, true, `${name} must require a user`);
    }
  });
});

/** Release the kit's module-load rate-limit interval so the process exits. */
after(() => {
  clearTrackedIntervals();
});
