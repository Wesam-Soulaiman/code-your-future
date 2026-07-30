import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../config/user-roles';
import { CurrentUser } from '../models/User';
import { SessionService } from './session.service';

const SAFE_USER: CurrentUser = {
  id: 'u1',
  username: 'admin',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [AppRole.ADMIN],
};

function service(): SessionService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(SessionService);
}

describe('SessionService', () => {
  beforeEach(() => localStorage.clear());

  it('stores and exposes a safe DTO', () => {
    const session = service();
    session.saveSession(SAFE_USER, 'r:token');
    expect(session.isLoggedIn()).toBe(true);
    expect(session.user()?.username).toBe('admin');
    expect(session.roles()).toEqual(['Admin']);
    expect(session.isAdmin()).toBe(true);
    expect(session.isStudent()).toBe(false);
  });

  it('restores a session from localStorage on construction', () => {
    localStorage.setItem('currentUser', JSON.stringify(SAFE_USER));
    localStorage.setItem('sessionToken', 'r:token');
    const session = service();
    expect(session.isLoggedIn()).toBe(true);
    expect(session.isAdmin()).toBe(true);
  });

  it('clearSession removes all local session state', () => {
    const session = service();
    session.saveSession(SAFE_USER, 'r:token');
    session.clearSession();

    expect(session.isLoggedIn()).toBe(false);
    expect(session.user()).toBeNull();
    expect(session.token()).toBeNull();
    expect(session.roles()).toEqual([]);
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(localStorage.getItem('sessionToken')).toBeNull();
  });

  it('discards fields outside the safe DTO allow-list', () => {
    const session = service();
    // Simulate a server (or tampered cache) sending more than the DTO allows.
    session.saveSession(
      {
        ...SAFE_USER,
        email: 'leak@example.com',
        phoneNumber: '+963900000000',
        authData: { google: { id: 'x' } },
        sessionToken: 'r:should-not-be-here',
      } as unknown as CurrentUser,
      'r:token',
    );

    const stored = localStorage.getItem('currentUser')!;
    expect(stored).not.toContain('leak@example.com');
    expect(stored).not.toContain('+963900000000');
    expect(stored).not.toContain('authData');
    expect(stored).not.toContain('should-not-be-here');

    const user = session.user() as unknown as Record<string, unknown>;
    expect(Object.keys(user).sort()).toEqual([
      'firstName',
      'id',
      'lastName',
      'roles',
      'username',
    ]);
  });

  it('strips legacy role names from a stale cached session', () => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', username: 'legacy', roles: ['SuperAdmin', 'Employee'] }),
    );
    localStorage.setItem('sessionToken', 'r:token');

    const session = service();
    expect(session.roles()).toEqual([]);
    expect(session.isAdmin()).toBe(false);
    expect(session.hasAnyRole([AppRole.ADMIN])).toBe(false);
  });

  it('keeps only recognised roles from a mixed list', () => {
    const session = service();
    session.saveSession(
      { ...SAFE_USER, roles: ['SuperAdmin', 'Admin', 'Employee', 'Student'] as AppRole[] },
      'r:token',
    );
    expect(session.roles()).toEqual(['Admin', 'Student']);
  });

  it('hasAnyRole is role-set aware', () => {
    const session = service();
    session.saveSession({ ...SAFE_USER, roles: [AppRole.STUDENT, AppRole.ADMIN] }, 'r:t');
    expect(session.hasAnyRole([AppRole.ADMIN])).toBe(true);
    expect(session.hasAnyRole([AppRole.STUDENT])).toBe(true);
  });

  it('survives corrupt cached JSON', () => {
    localStorage.setItem('currentUser', '{not json');
    localStorage.setItem('sessionToken', 'r:token');
    const session = service();
    expect(session.user()).toBeNull();
  });
});
