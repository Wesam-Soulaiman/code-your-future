import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { SessionService } from '../session.service';
import { AuthApiService } from './user-service';

function setup(): { api: AuthApiService; http: HttpTestingController; session: SessionService } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    api: TestBed.inject(AuthApiService),
    http: TestBed.inject(HttpTestingController),
    session: TestBed.inject(SessionService),
  };
}

describe('AuthApiService surface', () => {
  it('exposes only login, getCurrentUser, and logout', () => {
    const { api } = setup();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual(['getCurrentUser', 'login', 'logout']);
  });

  it('has no retired user-management method', () => {
    const { api } = setup();
    const surface = api as unknown as Record<string, unknown>;
    for (const retired of [
      'listUsers',
      'getUser',
      'createUser',
      'updateUser',
      'deleteUser',
      'searchEmployees',
    ]) {
      expect(surface[retired]).toBeUndefined();
    }
  });

  it('has no Student password flow', () => {
    const { api } = setup();
    const surface = api as unknown as Record<string, unknown>;
    for (const forbidden of [
      'signup',
      'signUp',
      'register',
      'resetPassword',
      'requestPasswordReset',
      'changePassword',
      'studentLogin',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});

describe('session restoration', () => {
  beforeEach(() => localStorage.clear());

  it('calls getCurrentUser and stores only safe DTO fields', async () => {
    const { api, http, session } = setup();

    const pending = new Promise<void>((resolve) => {
      api.getCurrentUser().subscribe((user) => {
        session.saveSession(user, 'r:token');
        resolve();
      });
    });

    const request = http.expectOne((req) => req.url.includes('getCurrentUser'));
    expect(request.request.method).toBe('GET');

    // The server returns the safe DTO — note the absence of a session token.
    request.flush({
      id: 'u1',
      username: 'admin',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: [AppRole.ADMIN],
    });

    await pending;

    expect(session.isAdmin()).toBe(true);
    const stored = localStorage.getItem('currentUser')!;
    expect(stored).not.toContain('sessionToken');
    expect(stored).not.toContain('@');
    http.verify();
  });

  it('drops extra fields if the server ever sends more than the DTO', async () => {
    const { api, http, session } = setup();

    const pending = new Promise<void>((resolve) => {
      api.getCurrentUser().subscribe((user) => {
        session.saveSession(user, 'r:token');
        resolve();
      });
    });

    http.expectOne((req) => req.url.includes('getCurrentUser')).flush({
      id: 'u1',
      username: 'admin',
      roles: [AppRole.ADMIN],
      email: 'leak@example.com',
      authData: { google: { id: 'x' } },
    });

    await pending;

    const stored = localStorage.getItem('currentUser')!;
    expect(stored).not.toContain('leak@example.com');
    expect(stored).not.toContain('authData');
    http.verify();
  });
});

describe('login', () => {
  beforeEach(() => localStorage.clear());

  it('posts to the Admin login route', () => {
    const { api, http } = setup();
    api.login({ username: 'admin', password: 'secret' }).subscribe();

    const request = http.expectOne((req) => req.url.includes('loginUser'));
    expect(request.request.method).toBe('POST');
    expect(request.request.url).toContain('/users/loginUser');
    request.flush({ id: 'u1', username: 'admin', roles: ['Admin'], sessionToken: 'r:t' });
    http.verify();
  });
});

describe('logout', () => {
  beforeEach(() => localStorage.clear());

  it('clears local session state on success', async () => {
    const { api, http, session } = setup();
    session.saveSession({ id: 'u1', username: 'admin', roles: [AppRole.ADMIN] }, 'r:token');
    expect(session.isLoggedIn()).toBe(true);

    const pending = new Promise<void>((resolve) => api.logout().subscribe(() => resolve()));
    http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
    await pending;

    expect(session.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('sessionToken')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
    http.verify();
  });

  it('still clears local state when the server call fails', async () => {
    const { api, http, session } = setup();
    session.saveSession({ id: 'u1', username: 'admin', roles: [AppRole.ADMIN] }, 'r:token');

    const pending = new Promise<void>((resolve) =>
      api.logout().subscribe({ next: () => resolve(), error: () => resolve() }),
    );
    http
      .expectOne((req) => req.url.includes('logout'))
      .flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    await pending;

    expect(session.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('sessionToken')).toBeNull();
  });
});
