/**
 * Role vocabulary and legacy-alias tests.
 *
 * These are behaviour tests over the real modules, not text assertions: they
 * import the shipped code and exercise the exported functions.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {
  AppRole,
  APP_ROLES,
  LEGACY_ROLE_NAMES,
  isLegacyRoleName,
  roleKey,
  toAppRole,
} from '../src/cloudCode/utils/constants/roles';

describe('application roles', () => {
  test('are exactly Admin and Student', () => {
    assert.deepEqual([...APP_ROLES], ['Admin', 'Student']);
    assert.equal(AppRole.ADMIN, 'Admin');
    assert.equal(AppRole.STUDENT, 'Student');
  });

  test('roleKey builds a Parse role key', () => {
    assert.equal(roleKey(AppRole.ADMIN), 'role:Admin');
    assert.equal(roleKey(AppRole.STUDENT), 'role:Student');
  });

  test('Visitor is not a stored role', () => {
    assert.equal(toAppRole('Visitor'), undefined);
    assert.ok(!APP_ROLES.includes('Visitor' as AppRole));
  });
});

describe('legacy roles never authorise', () => {
  for (const legacy of ['SuperAdmin', 'Employee']) {
    test(`toAppRole('${legacy}') resolves to undefined`, () => {
      assert.equal(
        toAppRole(legacy),
        undefined,
        `${legacy} must not resolve to an application role`
      );
    });
  }

  test('legacy names are recognised only for migration', () => {
    assert.deepEqual([...LEGACY_ROLE_NAMES], ['SuperAdmin', 'Employee']);
    assert.equal(isLegacyRoleName('SuperAdmin'), true);
    assert.equal(isLegacyRoleName('Employee'), true);
    assert.equal(isLegacyRoleName('Admin'), false);
    assert.equal(isLegacyRoleName('Student'), false);
  });

  test('no legacy name is an application role', () => {
    for (const legacy of LEGACY_ROLE_NAMES) {
      assert.ok(
        !(APP_ROLES as readonly string[]).includes(legacy),
        `${legacy} must not be an application role`
      );
    }
  });

  test('role keys never reference a legacy role', () => {
    const keys = APP_ROLES.map(roleKey);
    for (const legacy of LEGACY_ROLE_NAMES) {
      assert.ok(
        !keys.some(key => key.includes(legacy)),
        `role keys must not contain ${legacy}`
      );
    }
  });
});
