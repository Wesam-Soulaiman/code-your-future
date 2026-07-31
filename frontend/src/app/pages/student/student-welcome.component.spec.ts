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
import { StudentWelcomeComponent } from './student-welcome.component';

/**
 * The Student welcome page.
 *
 * Most assertions here are negative on purpose: this page exists to prove the
 * authentication flow, and it must not imply that any later feature already
 * works. A fake percentage, a placeholder batch, or a link to a page that does
 * not exist would each be the UI lying about the product.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

describe('StudentWelcomeComponent', () => {
  let fixture: ComponentFixture<StudentWelcomeComponent>;
  let http: HttpTestingController;

  /**
   * `displayName` is `null` for "no name available" rather than `undefined`,
   * because a default parameter would swallow an explicit `undefined` and the
   * nameless case would silently test the named one instead.
   */
  async function setup(
    lang: 'en' | 'ar' = 'en',
    displayName: string | null = 'Lina Haddad',
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudentWelcomeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'auth/student', component: StubComponent },
          { path: '**', component: StubComponent },
        ]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);

    TestBed.inject(SessionService).saveSession(
      { id: 'u1', roles: [AppRole.STUDENT], ...(displayName ? { displayName } : {}) },
      'r:token',
    );

    fixture = TestBed.createComponent(StudentWelcomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const html = () => fixture.nativeElement.innerHTML as string;

  beforeEach(async () => setup());

  describe('content', () => {
    it('greets the Student by their verified name', () => {
      const headings = fixture.nativeElement.querySelectorAll('h1');
      expect(headings.length).toBe(1);
      expect(headings[0].textContent).toContain('Lina Haddad');
    });

    it('falls back to a nameless greeting rather than an identifier', async () => {
      await setup('en', null);
      const heading = fixture.nativeElement.querySelector('h1').textContent as string;
      expect(heading).toContain('Welcome to Code Your Future');
      expect(heading).not.toContain('u1');
      expect(heading).not.toContain('gid_');
    });

    it('confirms the account is ready', () => {
      expect(text()).toContain('student account is ready');
    });

    it('names profile completion as the next step without offering it', () => {
      expect(text()).toContain('Completing your profile is the next step');
      expect(text()).toContain('not available yet');
      expect(fixture.nativeElement.querySelectorAll('form').length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('input').length).toBe(0);
    });

    it('repeats the approved invitation copy verbatim', () => {
      expect(text()).toContain(
        'You can sign in and complete your profile now. An invitation is required only to join a batch.',
      );
    });

    it('offers a language switch and a logout', () => {
      expect(fixture.nativeElement.querySelector('cyf-language-switch')).toBeTruthy();
      expect(text()).toContain('Logout');
    });

    it('shows Code Your Future branding', () => {
      expect(fixture.nativeElement.querySelector('cyf-brand-mark')).toBeTruthy();
    });
  });

  describe('no fake product data', () => {
    it('shows no percentage, score, or count', () => {
      // Any digit followed by % would be an invented completion figure.
      expect(text()).not.toMatch(/\d+\s*%/);
    });

    it('shows no chart, progress bar, or statistic widget', () => {
      for (const selector of [
        'p-chart',
        'p-progressbar',
        'canvas',
        'svg[role="img"]',
        '.stat',
        '.statistic',
      ]) {
        expect(
          fixture.nativeElement.querySelectorAll(selector).length,
          `${selector} must not appear`,
        ).toBe(0);
      }
    });

    it('mentions no future product feature', () => {
      // 'batch' is deliberately absent from this list: the approved invitation
      // copy must be reproduced verbatim, and it ends "...only to join a batch."
      // Mentioning batches is required; offering one is what would be wrong.
      const lowered = text().toLowerCase();
      for (const forbidden of [
        'my batch',
        'invitation code',
        'enrol',
        'resource',
        'live slides',
        'assignment',
        'final task',
        'submission',
        'talent reel',
      ]) {
        expect(lowered, `${forbidden} belongs to a later checkpoint`).not.toContain(forbidden);
      }
    });

    it('links to no page that does not exist', () => {
      const links = [...fixture.nativeElement.querySelectorAll('a')] as HTMLAnchorElement[];
      const targets = links.map((link) => link.getAttribute('routerLink') ?? link.getAttribute('href'));
      for (const target of targets) {
        // Only the in-page skip link is allowed.
        expect(target === null || target.startsWith('#')).toBe(true);
      }
    });

    it('issues no HTTP request when it loads', () => {
      http.verify();
    });

    it('shows no Complete Profile action', () => {
      const lowered = html().toLowerCase();
      expect(lowered).not.toContain('complete-profile');
      expect(lowered).not.toContain('completeprofile');
    });
  });

  describe('logout', () => {
    const logoutButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('.cyf-logout-btn');

    function clickLogout(): void {
      logoutButton().click();
      fixture.detectChanges();
    }

    it('calls the logout endpoint', () => {
      clickLogout();
      const request = http.expectOne((req) => req.url.includes('logout'));
      expect(request.request.method).toBe('POST');
      request.flush({ success: true });
    });

    it('clears the session and returns to Student sign-in', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      clickLogout();
      http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
      fixture.detectChanges();

      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(localStorage.getItem('sessionToken')).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/auth/student']);
    });

    it('clears local state even when the server call fails', () => {
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      clickLogout();
      http
        .expectOne((req) => req.url.includes('logout'))
        .flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
    });

    it('prevents a duplicate logout while one is in flight', () => {
      logoutButton().click();
      fixture.detectChanges();
      logoutButton().click();
      fixture.detectChanges();

      // expectOne fails if a second request was opened.
      http.expectOne((req) => req.url.includes('logout')).flush({ success: true });
      http.verify();
    });
  });

  describe('Arabic', () => {
    beforeEach(async () => setup('ar'));

    it('renders the Arabic greeting', () => {
      expect(fixture.nativeElement.querySelector('h1').textContent).toContain('أهلاً بك');
    });

    it('renders the Arabic next-step copy', () => {
      expect(text()).toContain('إكمال ملفك الشخصي هو الخطوة التالية');
    });

    it('repeats the approved Arabic invitation copy verbatim', () => {
      expect(text()).toContain(
        'يمكنك تسجيل الدخول وإكمال ملفك الشخصي الآن. ستحتاج إلى دعوة فقط للانضمام إلى دفعة.',
      );
    });

    it('leaves no untranslated English marker', () => {
      expect(text()).not.toContain('Welcome to Code Your Future');
      expect(text()).not.toContain('next step');
    });
  });

  describe('layout safety', () => {
    it('declares no fixed pixel width', () => {
      expect(html()).not.toMatch(/style="[^"]*width:\s*\d+px/);
    });

    it('provides a skip link to the main content', () => {
      const skip = fixture.nativeElement.querySelector('.cyf-skip-link');
      expect(skip).toBeTruthy();
      expect(skip.getAttribute('href')).toBe('#cyf-student-main');
      expect(fixture.nativeElement.querySelector('#cyf-student-main')).toBeTruthy();
    });

    it('uses a main landmark', () => {
      expect(fixture.nativeElement.querySelectorAll('main').length).toBe(1);
    });
  });
});
