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
import { studentGuard } from './guards/student.guard';
import { routes } from './app.routes';
import { useTranslations } from './testing/i18n-testing';

/** Stand-ins so routing can be exercised without loading real page bundles. */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

function signIn(roles: string[] = ['Admin']): void {
  const user: CurrentUser = { id: 'u1', displayName: 'Test User', roles: roles as AppRole[] };
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
    { id: 'u1', displayName: 'Test User', roles: roles as AppRole[] },
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

  it('declares a Student area guarded on the branch and on the page', () => {
    const student = findRoute('student');
    expect(student).toBeTruthy();
    expect(student?.canActivate).toContain(studentGuard);

    const welcome = student?.children?.find((child) => child.path === 'welcome');
    expect(welcome).toBeTruthy();
    expect(welcome?.canActivate).toContain(studentGuard);
  });

  it('guards the Admin shell so a Student cannot enter it', () => {
    const shell = routes.find((route) => route.path === '');
    expect(shell?.canActivate).toContain(authGuard);
  });

  it('gives every route a meaningful title', () => {
    const auth = findRoute('auth');
    for (const path of ['admin', 'student']) {
      const child = auth?.children?.find((c) => c.path === path);
      expect(String(child?.title)).toContain('Code Your Future');
    }
    const welcome = findRoute('student')?.children?.find((c) => c.path === 'welcome');
    expect(String(welcome?.title)).toContain('Code Your Future');
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

  it('declares no Complete Profile route yet', () => {
    const declared = JSON.stringify(routes);
    expect(declared).not.toContain('complete-profile');
    expect(declared).not.toContain('completeProfile');
  });
});

describe('guestGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  const run = () =>
    TestBed.runInInjectionContext(
      () => guestGuard({} as never, {} as never) as boolean | UrlTree,
    );

  it('lets a Visitor reach the auth pages', () => {
    expect(run()).toBe(true);
  });

  it('sends an authenticated Admin to the dashboard', () => {
    signIn(['Admin']);
    const result = run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/dashboard');
  });

  it('sends an authenticated Student to their own area', () => {
    signIn(['Student']);
    const result = run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/student/welcome');
  });

  it('sends a session with no recognised role back to sign in', () => {
    signIn(['SuperAdmin']);
    expect(String(run())).toBe('/auth/admin');
  });

  it('returns a UrlTree rather than navigating, so there is no auth-page flash', () => {
    signIn();
    // A UrlTree is resolved by the router before the component is created.
    expect(run()).toBeInstanceOf(UrlTree);
  });
});

describe('authGuard protects the Admin workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  const run = () =>
    TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never) as boolean | UrlTree,
    );

  it('redirects a Visitor to /auth/admin (not the bare /auth) to avoid a double hop', () => {
    expect(String(run())).toBe('/auth/admin');
  });

  it('admits an Admin', () => {
    signIn(['Admin']);
    expect(run()).toBe(true);
  });

  it('sends a Student to their own area rather than admitting them', () => {
    signIn(['Student']);
    const result = run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/student/welcome');
  });

  it('refuses a legacy role', () => {
    signIn(['SuperAdmin', 'Employee']);
    expect(String(run())).toBe('/auth/admin');
  });
});

describe('studentGuard protects the Student area', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  const run = () =>
    TestBed.runInInjectionContext(
      () => studentGuard({} as never, {} as never) as boolean | UrlTree,
    );

  it('sends a Visitor to the Student sign-in page, not the Admin one', () => {
    const result = run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/auth/student');
  });

  it('admits a Student', () => {
    signIn(['Student']);
    expect(run()).toBe(true);
  });

  it('sends an Admin to the dashboard rather than admitting them', () => {
    signIn(['Admin']);
    expect(String(run())).toBe('/dashboard');
  });

  it('refuses a legacy role', () => {
    signIn(['Employee']);
    expect(String(run())).toBe('/auth/student');
  });

  it('refuses a session whose Student role was withdrawn', () => {
    signIn(['Student']);
    expect(run()).toBe(true);

    // The backend removed the role; restoration replaced the cached set.
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 'u1', displayName: 'Test User', roles: [] }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    expect(String(run())).toBe('/auth/student');
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
          {
            path: 'student',
            canActivate: [studentGuard],
            children: [
              { path: '', redirectTo: 'welcome', pathMatch: 'full' },
              { path: 'welcome', canActivate: [studentGuard], component: StubComponent },
              { path: '**', redirectTo: 'welcome' },
            ],
          },
          {
            path: '',
            canActivate: [authGuard],
            children: [
              { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
              { path: 'dashboard', component: StubComponent },
            ],
          },
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

  it('sends a Visitor asking for the Student area to Student sign-in', async () => {
    await router.navigateByUrl('/student/welcome');
    expect(router.url).toBe('/auth/student');
  });

  it('lets a signed-in Student into their area', async () => {
    signInLive(['Student']);
    await router.navigateByUrl('/student/welcome');
    expect(router.url).toBe('/student/welcome');
  });

  it('redirects bare /student to the welcome page', async () => {
    signInLive(['Student']);
    await router.navigateByUrl('/student');
    expect(router.url).toBe('/student/welcome');
  });

  it('keeps a Student out of the Admin workspace', async () => {
    signInLive(['Student']);
    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/student/welcome');
  });

  it('keeps an Admin out of the Student area', async () => {
    signInLive(['Admin']);
    await router.navigateByUrl('/student/welcome');
    expect(router.url).toBe('/dashboard');
  });

  it('keeps an authenticated Admin off the auth pages', async () => {
    signInLive(['Admin']);
    // Navigate to a URL different from the current one — the router treats a
    // same-URL navigation as a no-op, which would not exercise the guard.
    await router.navigateByUrl('/auth/student');
    expect(router.url).toBe('/dashboard');

    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/dashboard');
  });

  it('keeps an authenticated Student off the auth pages', async () => {
    signInLive(['Student']);
    await router.navigateByUrl('/auth/student');
    expect(router.url).toBe('/student/welcome');

    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/student/welcome');
  });

  it('does not loop between the guards', async () => {
    signInLive(['Admin']);
    await router.navigateByUrl('/auth/student');
    expect(router.url).toBe('/dashboard');

    // Signing out and heading back to an auth page must settle immediately —
    // the guards must not bounce the user between the workspaces.
    TestBed.inject(SessionService).clearSession();
    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/auth/admin');

    // ...and a Visitor asking for a protected URL lands on the auth page.
    await router.navigateByUrl('/');
    expect(router.url).toBe('/auth/admin');
  });

  it('does not loop for a Student either', async () => {
    signInLive(['Student']);
    await router.navigateByUrl('/student/welcome');
    expect(router.url).toBe('/student/welcome');

    TestBed.inject(SessionService).clearSession();
    // Move away first: the router treats a navigation to the current URL as a
    // no-op, and '/student' redirects straight back to '/student/welcome'.
    await router.navigateByUrl('/auth/admin');
    expect(router.url).toBe('/auth/admin');

    await router.navigateByUrl('/student/welcome');
    expect(router.url).toBe('/auth/student');
  });

  it('allows switching between the two auth pages', async () => {
    await router.navigateByUrl('/auth/admin');
    await router.navigateByUrl('/auth/student');
    expect(location.path()).toBe('/auth/student');

    await router.navigateByUrl('/auth/admin');
    expect(location.path()).toBe('/auth/admin');
  });
});
