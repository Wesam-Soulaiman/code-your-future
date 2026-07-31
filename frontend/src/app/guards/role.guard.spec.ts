import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../config/user-roles';
import { CurrentUser } from '../models/User';
import { SessionService } from '../services/session.service';
import { authGuard } from './auth.guard';
import { adminGuard, roleGuard } from './role.guard';

/**
 * Guard behaviour tests.
 *
 * The guards are run through `TestBed.runInInjectionContext` so `inject()` works
 * exactly as at runtime, with a real `SessionService` backed by localStorage.
 */
function signIn(roles: string[]): void {
  const user: CurrentUser = {
    id: 'u1',
    displayName: 'Tester',
    roles: roles as AppRole[],
  };
  localStorage.setItem('currentUser', JSON.stringify(user));
  localStorage.setItem('sessionToken', 'r:test-token');
}

function runGuard(guard: ReturnType<typeof roleGuard>): boolean | UrlTree {
  return TestBed.runInInjectionContext(
    () => guard({} as never, {} as never) as boolean | UrlTree,
  );
}

describe('roleGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('allows an Admin into an Admin route', () => {
    signIn(['Admin']);
    expect(runGuard(roleGuard(AppRole.ADMIN))).toBe(true);
  });

  it('redirects a Student away from an Admin route', () => {
    signIn(['Student']);
    const result = runGuard(roleGuard(AppRole.ADMIN));
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/dashboard');
  });

  it('redirects a Visitor to /auth', () => {
    const result = runGuard(roleGuard(AppRole.ADMIN));
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/auth');
  });

  it('allows a user holding any one of several permitted roles', () => {
    signIn(['Student']);
    expect(runGuard(roleGuard(AppRole.ADMIN, AppRole.STUDENT))).toBe(true);
  });

  it('is role-set aware, not first-role-only', () => {
    // Admin is the SECOND role. The template guard read roles[0] and would fail.
    signIn(['Student', 'Admin']);
    expect(runGuard(roleGuard(AppRole.ADMIN))).toBe(true);
  });

  it('adminGuard behaves as roleGuard(Admin)', () => {
    signIn(['Admin']);
    expect(
      TestBed.runInInjectionContext(
        () => adminGuard({} as never, {} as never) as boolean | UrlTree,
      ),
    ).toBe(true);
  });
});

describe('legacy roles grant no access', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  for (const legacy of ['SuperAdmin', 'Employee']) {
    it(`${legacy} is not treated as Admin`, () => {
      signIn([legacy]);
      const result = runGuard(roleGuard(AppRole.ADMIN));
      expect(result).not.toBe(true);
      expect(result).toBeInstanceOf(UrlTree);
    });
  }

  it('a legacy role is stripped from session state entirely', () => {
    signIn(['SuperAdmin']);
    const session = TestBed.runInInjectionContext(() => TestBed.inject(SessionService));
    expect(session.roles()).toEqual([]);
    expect(session.isAdmin()).toBe(false);
  });
});

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('admits an authenticated user', () => {
    signIn(['Admin']);
    expect(
      TestBed.runInInjectionContext(
        () => authGuard({} as never, {} as never) as boolean | UrlTree,
      ),
    ).toBe(true);
  });

  it('redirects a Visitor to /auth', () => {
    const result = TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never) as boolean | UrlTree,
    );
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/auth');
  });
});
