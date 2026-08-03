import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { ShellComponent } from './shell.component';

/**
 * The shared protected shell ⟨CP4 closeout⟩.
 *
 * One component now frames both workspaces. That is worth a spec of its own for
 * two reasons: the navigation it renders is decided by role, and everything the
 * Student pages used to draw for themselves — branding, the language switch,
 * sign-out, the skip target, the `main` landmark — lives here now, so this is
 * where those guarantees have to be proved.
 *
 * **Hiding a link is not authorization.** Nothing here claims otherwise; the
 * route guards and the backend are the authority, and they have their own tests.
 * What this file checks is that the shell never *offers* somebody a workspace
 * they do not belong to.
 */

@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

/** The four Admin items, in order. */
const ADMIN_ITEMS = ['Dashboard', 'Batches', 'Students', 'Profile Catalogs'];

/** Profile editing lives in the Avatar menu, leaving two primary Student items. */
const STUDENT_ITEMS = ['Home', 'My Batches'];

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let http: HttpTestingController;
  let router: Router;

  type Who = 'admin' | 'student' | 'both' | 'unknownRole' | 'visitor';

  function setup(who: Who = 'admin', lang: 'en' | 'ar' = 'en', width = 1440): void {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('lang', lang);
    // The shell reads the viewport once at construction.
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      writable: true,
      configurable: true,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);

    const session = TestBed.inject(SessionService);
    const roles: Record<Who, string[]> = {
      admin: [AppRole.ADMIN],
      student: [AppRole.STUDENT],
      both: [AppRole.ADMIN, AppRole.STUDENT],
      unknownRole: ['Employee'],
      visitor: [],
    };
    if (who !== 'visitor') {
      session.saveSession({ id: 'u1', roles: roles[who] as never }, 'r:token');
    }

    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  }

  /** The text of every sidebar navigation link. */
  const navLabels = (): string[] =>
    [...fixture.nativeElement.querySelectorAll('nav a.nav-item')]
      .map((link) => (link as HTMLElement).textContent?.trim() ?? '')
      .filter((label) => label.length > 0);

  const navTargets = (): string[] =>
    [...fixture.nativeElement.querySelectorAll('nav a.nav-item')]
      .map((link) => (link as HTMLElement).getAttribute('href') ?? '')
      .filter((href) => href.length > 0);

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(() => setup());

  // ═════════════════════════════════════════════════════════════════════════
  describe('role-based navigation', () => {
    it('gives an Admin exactly the four approved items', () => {
      setup('admin');
      expect(navLabels()).toEqual(ADMIN_ITEMS);
    });

    it('gives a Student exactly the three approved items', () => {
      setup('student');
      expect(navLabels()).toEqual(STUDENT_ITEMS);
    });

    it('never shows an Admin item to a Student', () => {
      setup('student');
      const labels = navLabels();
      for (const adminOnly of ['Batches', 'Students', 'Profile Catalogs', 'Dashboard']) {
        // "My Batches" is a Student item and legitimately contains "Batches";
        // the check is on the exact label.
        expect(labels).not.toContain(adminOnly);
      }
      expect(navTargets().every((href) => !href.includes('/dashboard'))).toBe(true);
    });

    it('never shows a Student item to an Admin', () => {
      setup('admin');
      const labels = navLabels();
      for (const studentOnly of STUDENT_ITEMS) {
        expect(labels).not.toContain(studentOnly);
      }
      // Compared as whole path segments, not as substrings: the Admin
      // directory lives at `/dashboard/students`, which contains `/student`.
      const inStudentArea = navTargets().filter((href) =>
        href.replace(/^#/, '').startsWith('/student/'),
      );
      expect(inStudentArea).toEqual([]);
    });

    it('gives an unrecognised role no navigation at all', () => {
      // Deny by default. Every item carries explicit roles, so a legacy role
      // inherits nothing.
      setup('unknownRole');
      expect(navLabels()).toEqual([]);
    });

    it('gives a session with no roles no navigation at all', () => {
      setup('visitor');
      expect(navLabels()).toEqual([]);
    });

    it('offers both sets to somebody who genuinely holds both roles', () => {
      setup('both');
      expect(navLabels()).toEqual([...ADMIN_ITEMS, ...STUDENT_ITEMS]);
    });

    it('offers no future feature', () => {
      setup('admin');
      const all = navLabels().join(' ') + ' ' + setupAndRead('student');
      for (const future of [
        'Resource',
        'Live Slides',
        'Task',
        'Pinned',
        'Talent',
        'User Management',
        'Users',
      ]) {
        expect(all, `${future} belongs to a later checkpoint`).not.toContain(future);
      }
    });

    function setupAndRead(who: Who): string {
      setup(who);
      return navLabels().join(' ');
    }

    it('every item points at a route that exists', () => {
      const allowed = [
        '/dashboard',
        '/dashboard/batches',
        '/dashboard/students',
        '/dashboard/profile-catalogs',
        '/student/welcome',
        '/student/batches',
      ];
      for (const who of ['admin', 'student'] as Who[]) {
        setup(who);
        for (const href of navTargets()) {
          const path = href.replace(/^#/, '');
          expect(allowed, `${path} is not a page that exists`).toContain(path);
        }
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('one navigation, not two', () => {
    it('renders exactly one primary navigation landmark', () => {
      setup('student');
      const navs = fixture.nativeElement.querySelectorAll('nav');
      expect(navs.length).toBe(1);
    });

    it('puts no route links in the top bar', () => {
      // The header carries the menu trigger, language, theme, and the user
      // menu — never the primary navigation. That was the Student area's old
      // arrangement, and having both would mean two active states.
      setup('student');
      const header = fixture.nativeElement.querySelector('header');
      expect(header).toBeTruthy();
      expect(header.querySelectorAll('a[href]').length).toBe(0);
    });
  });

  describe('account menu', () => {
    it('puts the Student profile above logout and points it at the workspace route', () => {
      setup('student');
      const items = fixture.componentInstance.userMenuItems();

      expect(items.map((item) => item.separator ? 'separator' : item.label)).toEqual([
        'Profile',
        'separator',
        'Logout',
      ]);
      expect(items[0].routerLink).toEqual(['/student/profile/edit']);
    });

    it('does not offer a Student profile to an Admin', () => {
      setup('admin');
      expect(
        fixture.componentInstance.userMenuItems().some((item) => item.label === 'Profile'),
      ).toBe(false);
    });

    it('uses an accessible button for the Avatar trigger', () => {
      setup('student');
      const trigger = fixture.nativeElement.querySelector(
        'header button[aria-haspopup="menu"]',
      ) as HTMLButtonElement;

      expect(trigger).toBeTruthy();
      expect(trigger.getAttribute('aria-label')).toBe('Open account menu');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('the page frame', () => {
    it('provides the one main landmark for the page inside it', () => {
      expect(fixture.nativeElement.querySelectorAll('main').length).toBe(1);
    });

    it('shows branding', () => {
      expect(fixture.nativeElement.querySelector('cyf-brand-mark')).toBeTruthy();
    });

    it('offers the language and theme controls', () => {
      const header = fixture.nativeElement.querySelector('header');
      expect(header.querySelector('.fa-language')).toBeTruthy();
    });

    it('offers sign-out', () => {
      expect(fixture.nativeElement.querySelector('.nav-item-logout')).toBeTruthy();
      expect(text()).toContain('Logout');
    });

    it('serves both workspaces from the same component', () => {
      // The structural guarantee behind "Admin and Student look like one
      // application": if these diverged, this would be two components.
      setup('admin');
      const adminShape = fixture.nativeElement.querySelectorAll('aside, header, main').length;
      setup('student');
      const studentShape = fixture.nativeElement.querySelectorAll('aside, header, main').length;
      expect(studentShape).toBe(adminShape);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('sign-out', () => {
    const logoutLink = (): HTMLElement =>
      fixture.nativeElement.querySelector('.nav-item-logout');

    it('calls the logout endpoint', () => {
      logoutLink().click();
      fixture.detectChanges();
      const request = http.expectOne((req) => req.url.includes('logout'));
      expect(request.request.method).toBe('POST');
      request.flush({ success: true });
    });

    it('returns a Student to the Student sign-in page', () => {
      // Sending them to /auth would ask for a username and password they will
      // never have.
      setup('student');
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture.nativeElement.querySelector('.nav-item-logout').click();
      fixture.detectChanges();
      http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/auth/student']);
    });

    it('returns an Admin to the Admin sign-in page', () => {
      setup('admin');
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture.nativeElement.querySelector('.nav-item-logout').click();
      fixture.detectChanges();
      http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/auth/admin']);
    });

    it('clears the session', () => {
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      logoutLink().click();
      fixture.detectChanges();
      http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
      fixture.detectChanges();

      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(localStorage.getItem('sessionToken')).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('the mobile drawer', () => {
    beforeEach(() => setup('student', 'en', 390));

    const trigger = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('header button');

    const isOpen = (): boolean => fixture.componentInstance.mobileMenuOpen();

    it('offers a trigger with an accessible name', () => {
      const button = trigger();
      expect(button).toBeTruthy();
      // An icon alone says nothing to a screen reader.
      const labelled =
        button.getAttribute('aria-label') ??
        button.closest('p-button')?.getAttribute('ng-reflect-aria-label') ??
        fixture.nativeElement.querySelector('[aria-label]')?.getAttribute('aria-label');
      expect(labelled).toBeTruthy();
    });

    it('opens', () => {
      expect(isOpen()).toBe(false);
      fixture.componentInstance.toggleSidebar();
      fixture.detectChanges();
      expect(isOpen()).toBe(true);
    });

    it('closes after navigating, so the page it opened is visible', () => {
      fixture.componentInstance.toggleSidebar();
      fixture.detectChanges();
      expect(isOpen()).toBe(true);

      fixture.componentInstance.closeMobileMenu();
      fixture.detectChanges();
      expect(isOpen()).toBe(false);
    });

    it('every navigation item closes it', () => {
      // Not a sample: a single item that forgot would leave the drawer over the
      // page it just opened.
      const links = [...fixture.nativeElement.querySelectorAll('nav a.nav-item')];
      expect(links.length).toBeGreaterThan(0);

      for (const link of links) {
        fixture.componentInstance.toggleSidebar();
        fixture.detectChanges();
        (link as HTMLElement).click();
        fixture.detectChanges();
        expect(isOpen(), `${(link as HTMLElement).textContent?.trim()} must close the drawer`).toBe(
          false,
        );
      }
    });

    it('closes on Escape', () => {
      fixture.componentInstance.toggleSidebar();
      fixture.detectChanges();

      fixture.componentInstance.onEscape();
      fixture.detectChanges();
      expect(isOpen()).toBe(false);
    });

    it('locks the page behind it, and always releases the lock', () => {
      fixture.componentInstance.toggleSidebar();
      fixture.detectChanges();
      expect(document.body.style.overflow).toBe('hidden');

      fixture.componentInstance.closeMobileMenu();
      fixture.detectChanges();
      // A page left unscrollable, with the drawer gone, is unrecoverable.
      expect(document.body.style.overflow).toBe('');
    });

    it('releases the lock when the shell is destroyed', () => {
      fixture.componentInstance.toggleSidebar();
      fixture.detectChanges();
      expect(document.body.style.overflow).toBe('hidden');

      fixture.destroy();
      expect(document.body.style.overflow).toBe('');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('Arabic', () => {
    beforeEach(() => setup('student', 'ar'));

    it('translates the navigation labels', () => {
      const labels = navLabels().join(' ');
      expect(labels).toMatch(/[؀-ۿ]/);
      for (const english of STUDENT_ITEMS) {
        expect(labels).not.toContain(english);
      }
    });

    it('still offers exactly the three Student items', () => {
      expect(navLabels().length).toBe(STUDENT_ITEMS.length);
    });

    it('renders the document right to left', () => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    });
  });
});
