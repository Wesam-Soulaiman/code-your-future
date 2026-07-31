import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { httpInterceptor } from '../http.interceptor';
import { SessionService } from '../session.service';
import { StudentAuthApiService } from './student-auth-service';

/**
 * Student sign-in and session restoration.
 *
 * `HttpTestingController` means no request ever leaves the process, and
 * `verify()` fails the test if a request was opened that the test did not
 * expect — which is how "no extra call" is proven rather than asserted.
 */
/**
 * A stand-in for the auth pages.
 *
 * The interceptor really navigates when a session is rejected, so the test
 * router needs matching routes; without them the navigation rejects and the run
 * reports an unhandled error even though every assertion passed.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // The real interceptor is registered so the header rules — attach the
    // session token, but never to a call that establishes a session — are
    // exercised rather than assumed.
    providers: [
      provideHttpClient(withInterceptors([httpInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'auth/admin', component: StubComponent },
        { path: 'auth/student', component: StubComponent },
        { path: '**', component: StubComponent },
      ]),
      MessageService,
    ],
  });
  return {
    api: TestBed.inject(StudentAuthApiService),
    http: TestBed.inject(HttpTestingController),
    session: TestBed.inject(SessionService),
  };
}

describe('loginWithGoogle', () => {
  beforeEach(() => localStorage.clear());

  it('posts the credential to the Student endpoint', () => {
    const { api, http } = setup();
    api.loginWithGoogle('header.payload.signature').subscribe();

    const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
    expect(request.request.method).toBe('POST');
    expect(request.request.url).toContain('/student-auth/loginWithGoogle');
    expect(request.request.body).toEqual({ credential: 'header.payload.signature' });
    request.flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:t' });
    http.verify();
  });

  it('never places the credential in the URL or the query string', () => {
    const { api, http } = setup();
    api.loginWithGoogle('header.payload.signature').subscribe();

    const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
    expect(request.request.url).not.toContain('header.payload.signature');
    expect(request.request.urlWithParams).not.toContain('header.payload.signature');
    request.flush({});
  });

  it('does not attach a stale session token to the sign-in call', () => {
    // The interceptor exempts the two calls that establish a session; a leftover
    // token from a previous account must not travel with a new sign-in.
    const { api, http } = setup();
    localStorage.setItem('sessionToken', 'r:stale-token');
    api.loginWithGoogle('c').subscribe();

    const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
    expect(request.request.headers.get('X-Parse-Session-Token')).toBeNull();
    request.flush({});
  });

  it('does not itself write a session — the caller decides', () => {
    const { api, http, session } = setup();
    api.loginWithGoogle('c').subscribe();
    http
      .expectOne((req) => req.url.includes('loginWithGoogle'))
      .flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:t' });

    expect(session.isLoggedIn()).toBe(false);
  });
});

describe('getSession', () => {
  beforeEach(() => localStorage.clear());

  it('calls the role-agnostic restoration endpoint', () => {
    const { api, http } = setup();
    api.getSession().subscribe();

    const request = http.expectOne((req) => req.url.includes('getSession'));
    expect(request.request.method).toBe('GET');
    expect(request.request.url).toContain('/student-auth/getSession');
    request.flush({ id: 'u1', roles: ['Student'] });
    http.verify();
  });

  it('sends the session token', () => {
    const { api, http } = setup();
    localStorage.setItem('sessionToken', 'r:token');
    api.getSession().subscribe();

    const request = http.expectOne((req) => req.url.includes('getSession'));
    expect(request.request.headers.get('X-Parse-Session-Token')).toBe('r:token');
    request.flush({ id: 'u1', roles: ['Student'] });
  });
});

describe('restoreSession', () => {
  beforeEach(() => localStorage.clear());

  it('makes no request when there is no stored token', async () => {
    const { api, http, session } = setup();
    const restored = await api.restoreSession();

    expect(restored).toBeNull();
    expect(session.status()).toBe('unauthenticated');
    http.verify();
  });

  it('restores a Student session and marks it authenticated', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    const { api, http, session } = setup();

    expect(session.status()).toBe('restoring');

    const pending = api.restoreSession();
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ id: 'u1', displayName: 'Lina Haddad', roles: ['Student'] });
    await pending;

    expect(session.status()).toBe('authenticated');
    expect(session.isStudent()).toBe(true);
    expect(session.userDisplayName()).toBe('Lina Haddad');
    expect(session.token()).toBe('r:token');
    http.verify();
  });

  it('restores an Admin session through the same call', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    const { api, http, session } = setup();

    const pending = api.restoreSession();
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ id: 'u9', displayName: 'wesam', roles: ['Admin'] });
    await pending;

    expect(session.isAdmin()).toBe(true);
    expect(session.status()).toBe('authenticated');
  });

  it('clears a rejected session rather than leaving it half-signed-in', async () => {
    localStorage.setItem('sessionToken', 'r:expired');
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', roles: [AppRole.STUDENT] }),
    );
    const { api, http, session } = setup();

    const pending = api.restoreSession();
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ code: 209, error: 'Invalid session token' }, { status: 400, statusText: 'x' });
    const restored = await pending;

    expect(restored).toBeNull();
    expect(session.status()).toBe('unauthenticated');
    expect(session.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('sessionToken')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
  });

  it('returns an expired Student to the Student sign-in page', async () => {
    localStorage.setItem('sessionToken', 'r:expired');
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', roles: [AppRole.STUDENT] }),
    );
    const { api, http } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const pending = api.restoreSession();
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ code: 209, error: 'Invalid session token' }, { status: 400, statusText: 'x' });
    await pending;

    // Not /auth/admin: a Student has no password to offer there.
    expect(navigate).toHaveBeenCalledWith(['/auth/student']);
  });

  it('returns an expired Admin to the Admin sign-in page', async () => {
    localStorage.setItem('sessionToken', 'r:expired');
    localStorage.setItem('currentUser', JSON.stringify({ id: 'u9', roles: [AppRole.ADMIN] }));
    const { api, http } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const pending = api.restoreSession();
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ code: 209, error: 'Invalid session token' }, { status: 400, statusText: 'x' });
    await pending;

    expect(navigate).toHaveBeenCalledWith(['/auth/admin']);
  });

  it('drops a role the server no longer reports', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', roles: [AppRole.STUDENT] }),
    );
    const { api, http, session } = setup();

    const pending = api.restoreSession();
    // The Admin withdrew the Student role: the server reports an empty set.
    http.expectOne((req) => req.url.includes('getSession')).flush({ id: 'u1', roles: [] });
    await pending;

    expect(session.isStudent()).toBe(false);
    expect(session.roles()).toEqual([]);
  });

  it('issues one request even when two callers restore at once', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    const { api, http } = setup();

    const first = api.restoreSession();
    const second = api.restoreSession();
    expect(first).toBe(second);

    // expectOne fails if a second request was opened.
    http.expectOne((req) => req.url.includes('getSession')).flush({ id: 'u1', roles: ['Student'] });
    await Promise.all([first, second]);
    http.verify();
  });

  it('allows a fresh restoration after the first one settles', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    const { api, http } = setup();

    const first = api.restoreSession();
    http.expectOne((req) => req.url.includes('getSession')).flush({ id: 'u1', roles: ['Student'] });
    await first;

    const second = api.restoreSession();
    http.expectOne((req) => req.url.includes('getSession')).flush({ id: 'u1', roles: ['Student'] });
    await second;
    http.verify();
  });

  it('never exposes a session token in the restoration response shape', async () => {
    localStorage.setItem('sessionToken', 'r:token');
    const { api, http, session } = setup();

    const pending = api.restoreSession();
    // Even if a server mistakenly returned one, it must not be stored as user data.
    http.expectOne((req) => req.url.includes('getSession')).flush({
      id: 'u1',
      roles: ['Student'],
      sessionToken: 'r:should-not-be-here',
      username: 'gid_internal',
    });
    await pending;

    const stored = localStorage.getItem('currentUser')!;
    expect(stored).not.toContain('should-not-be-here');
    expect(stored).not.toContain('gid_internal');
    expect(session.token()).toBe('r:token');
  });
});
