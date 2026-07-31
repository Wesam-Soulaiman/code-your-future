import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../config/user-roles';
import { CurrentUser } from '../models/User';
import { SessionService } from './session.service';

const SAFE_USER: CurrentUser = {
  id: 'u1',
  displayName: 'Ada Lovelace',
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
    expect(session.user()?.displayName).toBe('Ada Lovelace');
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
        username: 'gid_internal_username',
        email: 'leak@example.com',
        phoneNumber: '+963900000000',
        authData: { google: { id: 'x' } },
        sessionToken: 'r:should-not-be-here',
        providerSubject: '110000000000000000001',
      } as unknown as CurrentUser,
      'r:token',
    );

    const stored = localStorage.getItem('currentUser')!;
    expect(stored).not.toContain('leak@example.com');
    expect(stored).not.toContain('+963900000000');
    expect(stored).not.toContain('authData');
    expect(stored).not.toContain('should-not-be-here');
    expect(stored).not.toContain('gid_internal_username');
    expect(stored).not.toContain('110000000000000000001');

    const user = session.user() as unknown as Record<string, unknown>;
    expect(Object.keys(user).sort()).toEqual(['displayName', 'id', 'roles']);
  });

  it('strips legacy role names from a stale cached session', () => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', displayName: 'Legacy', roles: ['SuperAdmin', 'Employee'] }),
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

  describe('explicit session states', () => {
    it('starts unauthenticated when no token is stored', () => {
      expect(service().status()).toBe('unauthenticated');
    });

    it('starts restoring when a token is present but unverified', () => {
      localStorage.setItem('currentUser', JSON.stringify(SAFE_USER));
      localStorage.setItem('sessionToken', 'r:token');
      const session = service();
      expect(session.status()).toBe('restoring');
      expect(session.isRestoring()).toBe(true);
      // A stored token is not yet proof of anything.
      expect(session.isAuthenticated()).toBe(false);
    });

    it('becomes authenticated only once a session is saved', () => {
      localStorage.setItem('sessionToken', 'r:token');
      const session = service();
      expect(session.isAuthenticated()).toBe(false);
      session.saveSession(SAFE_USER, 'r:token');
      expect(session.status()).toBe('authenticated');
      expect(session.isAuthenticated()).toBe(true);
    });

    it('becomes unauthenticated when the session is cleared', () => {
      const session = service();
      session.saveSession(SAFE_USER, 'r:token');
      session.clearSession();
      expect(session.status()).toBe('unauthenticated');
      expect(session.isRestoring()).toBe(false);
    });
  });

  describe('display name', () => {
    it('is the safe display name from the DTO', () => {
      const session = service();
      session.saveSession(SAFE_USER, 'r:token');
      expect(session.userDisplayName()).toBe('Ada Lovelace');
    });

    it('is empty rather than falling back to an internal identifier', () => {
      const session = service();
      session.saveSession({ id: 'u2', roles: [AppRole.STUDENT] }, 'r:token');
      expect(session.userDisplayName()).toBe('');
    });
  });
});
