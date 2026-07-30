/**
 * DTO allow-list tests.
 *
 * Builds DTOs from a real Parse.User carrying every sensitive attribute, then
 * asserts the forbidden keys are absent and no value leaks by another name.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let toCurrentUserDto: typeof import('../src/cloudCode/utils/dto/userDto').toCurrentUserDto;
let toLoginDto: typeof import('../src/cloudCode/utils/dto/userDto').toLoginDto;
let FORBIDDEN_DTO_KEYS: readonly string[];
let AppRole: typeof import('../src/cloudCode/utils/constants/roles').AppRole;

const SENSITIVE = {
  email: 'admin.canary@example.com',
  phone: '+963900000001',
  sessionToken: 'r:aaaabbbbccccddddeeeeffff00001111',
  password: 'AdminPassw0rdCanary',
};

function buildUser(): Parse.User {
  const Parse = parseSdk();
  const user = new Parse.User();
  user.id = 'user123';
  user.set('username', 'admin');
  user.set('firstName', 'Ada');
  user.set('lastName', 'Lovelace');
  user.set('email', SENSITIVE.email);
  user.set('phoneNumber', SENSITIVE.phone);
  user.set('emailVerified', true);
  user.set('authData', {google: {id: 'g-1', access_token: 'tok'}});
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  user.setACL(acl);
  return user;
}

before(async () => {
  installParseTestGlobal();
  const dto = await import('../src/cloudCode/utils/dto/userDto');
  toCurrentUserDto = dto.toCurrentUserDto;
  toLoginDto = dto.toLoginDto;
  FORBIDDEN_DTO_KEYS = dto.FORBIDDEN_DTO_KEYS;
  AppRole = (await import('../src/cloudCode/utils/constants/roles')).AppRole;
});

describe('current-user DTO', () => {
  test('exposes only the allow-listed keys', () => {
    const dto = toCurrentUserDto(buildUser(), [AppRole.ADMIN]);
    assert.deepEqual(
      Object.keys(dto).sort(),
      ['firstName', 'id', 'lastName', 'roles', 'username']
    );
  });

  test('omits every forbidden key', () => {
    const dto = toCurrentUserDto(buildUser(), [AppRole.ADMIN]) as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_DTO_KEYS) {
      if (key === 'objectId' || key === 'createdAt' || key === 'updatedAt') {
        assert.ok(!(key in dto), `${key} must be absent`);
        continue;
      }
      assert.ok(!(key in dto), `${key} must be absent from the current-user DTO`);
    }
  });

  test('never carries a session token', () => {
    const dto = toCurrentUserDto(buildUser(), [AppRole.ADMIN]) as unknown as Record<string, unknown>;
    assert.ok(!('sessionToken' in dto));
  });

  test('leaks no sensitive value under any key', () => {
    const serialised = JSON.stringify(toCurrentUserDto(buildUser(), [AppRole.ADMIN]));
    for (const [name, value] of Object.entries(SENSITIVE)) {
      assert.ok(!serialised.includes(value), `${name} leaked into the DTO`);
    }
  });

  test('exposes role names only, not role objects', () => {
    const dto = toCurrentUserDto(buildUser(), [AppRole.ADMIN, AppRole.STUDENT]);
    assert.deepEqual(dto.roles, ['Admin', 'Student']);
    for (const role of dto.roles) {
      assert.equal(typeof role, 'string');
    }
  });

  test('never reports a legacy role', () => {
    const serialised = JSON.stringify(toCurrentUserDto(buildUser(), [AppRole.ADMIN]));
    assert.ok(!serialised.includes('SuperAdmin'));
    assert.ok(!serialised.includes('Employee'));
  });

  test('omits absent optional names rather than emitting empty strings', () => {
    const Parse = parseSdk();
    const user = new Parse.User();
    user.id = 'u2';
    user.set('username', 'plain');
    const dto = toCurrentUserDto(user, [AppRole.ADMIN]) as unknown as Record<string, unknown>;
    assert.ok(!('firstName' in dto));
    assert.ok(!('lastName' in dto));
  });
});

describe('login DTO', () => {
  test('adds exactly the session token to the current-user shape', () => {
    const dto = toLoginDto(buildUser(), [AppRole.ADMIN], SENSITIVE.sessionToken);
    assert.deepEqual(
      Object.keys(dto).sort(),
      ['firstName', 'id', 'lastName', 'roles', 'sessionToken', 'username']
    );
    assert.equal(dto.sessionToken, SENSITIVE.sessionToken);
  });

  test('still omits email, phone, authData, and ACL', () => {
    const dto = toLoginDto(
      buildUser(),
      [AppRole.ADMIN],
      SENSITIVE.sessionToken
    ) as unknown as Record<string, unknown>;
    for (const key of ['email', 'phoneNumber', 'authData', 'ACL', 'password']) {
      assert.ok(!(key in dto), `${key} must be absent from the login DTO`);
    }
    const serialised = JSON.stringify(dto);
    assert.ok(!serialised.includes(SENSITIVE.email));
    assert.ok(!serialised.includes(SENSITIVE.phone));
    assert.ok(!serialised.includes(SENSITIVE.password));
  });
});

/** Release the kit's module-load rate-limit interval so the process exits. */
after(() => {
  clearTrackedIntervals();
});
