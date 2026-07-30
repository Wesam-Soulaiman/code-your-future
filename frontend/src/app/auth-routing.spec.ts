import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from './config/user-roles';
import { CurrentUser } from './models/User';
import { SessionService } from './services/session.service';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { routes } from './app.routes';
import { useTranslations } from './testing/i18n-testing';

/** Stand-ins so routing can be exercised without loading real page bundles. */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

function signIn(roles: string[] = ['Admin']): void {
  const user: CurrentUser = { id: 'u1', username: 'admin', roles: roles as AppRole[] };
  localStorage.setItem('currentUser', JSON.stringify(user));
  localStorage.setItem('sessionToken', 'r:test-token');
}

/**
 * Sign in through the live SessionService.
 *
 * `SessionService` hydrates its signals once at construction, so writing
 * localStorage after the router has already injected it has no effect. Tests
 * that sign in mid-run must go through the service.
 */
function signInLive(roles: string[] = ['Admin']): void {
  const session = TestBed.inject(SessionService);
  session.saveSession(
    { id: 'u1', username: 'admin', roles: roles as AppRole[] },
    'r:test-token',
  );
}

describe('auth route structure', () => {
  function findRoute(path: string) {
    return routes.find((route) => route.path === path);
  }

  it('declares an /auth branch with admin and student children', () => {
    const auth = findRoute('auth');
    expect(auth).toBeTruthy();
    const children = (auth?.children ?? []).map((child) => child.path);
    expect(children).toContain('admin');
    expect(children).toContain('student');
  });

  it('redirects bare /auth to the Admin page', () => {
    const auth = findRoute('auth');
    const index = auth?.children?.find((child) => child.path === '');
    expect(index?.redirectTo).toBe('admin');
    expect(index?.pathMatch).toBe('full');
  });

  it('resolves an unknown auth sub-route to the Admin page', () => {
    const auth = findRoute('auth');
    const wildcard = auth?.children?.find((child) => child.path === '**');
    expect(wildcard?.redirectTo).toBe('admin');
  });

  it('guards the /auth branch and each auth page with guestGuard', () => {
    const auth = findRoute('auth');
    expect(auth?.canActivate).toContain(guestGuard);

    // Angular does not re-run a parent's canActivate when only the child
    // changes, so each page carries the guard too — otherwise a sibling
    // navigation would bypass it.
    for (const path of ['admin', 'student']) {
      const child = auth?.children?.find((c) => c.path === path);
      expect(child?.canActivate, `${path} must be guarded`).toContain(guestGuard);
    }
  });

  it('gives every auth route a meaningful title', () => {
    const auth = findRoute('auth');
    for (const path of ['admin', 'student']) {
      const child = auth?.children?.find((c) => c.path === path);
      expect(String(child?.title)).toContain('Code Your Future');
    }
  });

  it('uses only fixed internal redirect targets (no open redirect)', () => {
    const targets: string[] = [];
    const walk = (list: typeof routes): void => {
      for (const route of list) {
        if (route.redirectTo) targets.push(String(route.redirectTo));
        if (route.children) walk(route.children);
      }
    };
    walk(routes);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      // No absolute URL, no protocol-relative URL, no scheme of any kind.
      expect(target).not.toMatch(/^https?:\/\//);
      expect(target).not.toContain('//');
      expect(target).not.toContain(':');
    }
  });

  it('registers no future product route', () => {
    const declared = JSON.stringify(routes.map((r) => r.path));
    for (const future of ['join', 'reels', 'batches', 'profile', 'students', 'resources']) {
      expect(declared).not.toContain(future);
    }
  });
});

describe('guestGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('lets a Visitor reach the auth pages', () => {
    const result = TestBed.runInInjectionContext(
      () => guestGuard({} as never, {} as never) as boolean | UrlTree,
    );
    expect(result).toBe(true);
  });

  it('redirects an authenticated Admin away from the auth pages', () => {
    signIn();
    const result = TestBed.runInInjectionContext(
      () => guestGuard({} as never, {} as never) as boolean | UrlTree,
    );
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/');
  });

  it('returns a UrlTree rather than navigating, so there is no auth-page flash', () => {
    signIn();
    const result = TestBed.runInInjectionContext(
      () => guestGuard({} as never, {} as never) as boolean | UrlTree,
    );
    // A UrlTree is resolved by the router before the component is created.
    expect(result).toBeInstanceOf(UrlTree);
  });
});

describe('authGuard sends a Visitor to the Admin auth page', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('redirects to /auth/admin (not the bare /auth) to avoid a double hop', () => {
    const result = TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never) as boolean | UrlTree,
    );
    expect(String(result)).toBe('/auth/admin');
  });

  it('admits an authenticated user', () => {
    signIn();
    const result = TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never) as boolean | UrlTree,
    );
    expect(result).toBe(true);
  });
});

describe('navigation behaviour', () => {
  let router: Router;
  let location: Location;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
        provideRouter([
          {
            path: 'auth',
            canActivate: [guestGuard],
            children: [
              { path: '', redirectTo: 'admin', pathMatch: 'full' },
              { path: 'admin', canActivate: [guestGuard], component: StubComponent },
              { path: 'student', canActivate: [guestGuard], component: StubComponent },
              { path: '**', redirectTo: 'admin' },
            ],
          },
          { path: '', canActivate: [authGuard], component: StubComponent },
          { path: '**', redirectTo: '' },
        ]),
      ],
    });
    useTranslations(TestBed.inject(TranslateService));
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    await router.navigateByUrl('/auth/admin');
  });

  it('serves /auth/admin to a Visitor', async () => {
    await router.navigateByUrl('/auth/admin');
    expect(location.path()).toBe('/auth/admin');
  });

  it('serves /auth/student to a Visitor', async () => {
    await router.navigateByUrl('/auth/student');
    expect(location.path()).toBe('/auth/student');
  });

  it('redirects bare /auth to /auth/admin', async () => {
    await router.navigateByUrl('/auth');
    expect(location.path()).toBe('/auth/admin');
  });

  it('resolves an unknown auth sub-route safely', async () => {
    await router.navigateByUrl('/auth/does-not-exist');
    expect(location.path()).toBe('/auth/admin');
  });

  it('keeps an authenticated Admin off the auth pages', async () => {
    signInLive();
    // Navigate to a URL different from the current one — the router treats a
    // same-URL navigation as a no-op, which would not exercise the guard.
    await router.navigateByUrl('/auth/student');
    expect(router.url).toBe('/');

    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/');
  });

  it('does not loop between the guards', async () => {
    signInLive();
    await router.navigateByUrl('/auth/student');
    expect(router.url).toBe('/');

    // Signing out and heading back to an auth page must settle immediately —
    // the two guards must not bounce the user between '/' and '/auth/admin'.
    TestBed.inject(SessionService).clearSession();
    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/auth/admin');

    // ...and a Visitor asking for a protected URL lands on the auth page.
    await router.navigateByUrl('/');
    expect(router.url).toBe('/auth/admin');
  });

  it('allows switching between the two auth pages', async () => {
    await router.navigateByUrl('/auth/admin');
    await router.navigateByUrl('/auth/student');
    expect(location.path()).toBe('/auth/student');

    await router.navigateByUrl('/auth/admin');
    expect(location.path()).toBe('/auth/admin');
  });
});
