import { describe, expect, it } from 'vitest';
import { APP_ROLES, AppRole, LEGACY_ROLE_NAMES, toAppRole } from './user-roles';

describe('application roles', () => {
  it('are exactly Admin and Student', () => {
    expect([...APP_ROLES]).toEqual(['Admin', 'Student']);
    expect(AppRole.ADMIN).toBe('Admin');
    expect(AppRole.STUDENT).toBe('Student');
  });

  it('does not define Visitor as a role', () => {
    expect(toAppRole('Visitor')).toBeUndefined();
    expect(APP_ROLES).not.toContain('Visitor' as AppRole);
  });

  it('does not define any forbidden role', () => {
    for (const forbidden of ['Company', 'Trainer', 'Teacher', 'Moderator', 'Recruiter']) {
      expect(toAppRole(forbidden)).toBeUndefined();
    }
  });
});

describe('legacy roles', () => {
  it('do not resolve to an application role', () => {
    for (const legacy of LEGACY_ROLE_NAMES) {
      expect(toAppRole(legacy)).toBeUndefined();
    }
  });

  it('are not members of APP_ROLES', () => {
    for (const legacy of LEGACY_ROLE_NAMES) {
      expect(APP_ROLES as readonly string[]).not.toContain(legacy);
    }
  });
});
