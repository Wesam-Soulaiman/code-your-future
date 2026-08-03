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
    profileName: string | null = 'Lina Haddad',
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
      {
        id: 'u1',
        roles: [AppRole.STUDENT],
        profileComplete: true,
        ...(displayName ? { displayName } : {}),
      },
      'r:token',
    );

    fixture = TestBed.createComponent(StudentWelcomeComponent);
    fixture.detectChanges();

    // The page reads the real profile so it can greet the Student by the name
    // they chose rather than the one Google supplied ⟨CP3A⟩.
    const request = http.expectOne((req) => req.url.includes('getMyStudentProfile'));
    request.flush({
      id: 'p1',
      fullName: profileName ?? '',
      verifiedEmail: 'lina@example.com',
      hasPhoto: false,
      isComplete: true,
    });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const html = () => fixture.nativeElement.innerHTML as string;

  beforeEach(async () => setup());

  describe('content', () => {
    it('greets the Student by their verified name', () => {
      const headings = fixture.nativeElement.querySelectorAll('h2');
      expect(headings.length).toBe(1);
      expect(headings[0].textContent).toContain('Lina Haddad');
    });

    it('falls back to a nameless greeting rather than an identifier', async () => {
      await setup('en', null, null);
      const heading = fixture.nativeElement.querySelector('h2').textContent as string;
      expect(heading).toContain('Welcome to Code Your Future');
      expect(heading).not.toContain('u1');
      expect(heading).not.toContain('gid_');
    });

    it('confirms the account is ready', () => {
      expect(text()).toContain('student account is ready');
    });

    it('confirms the profile is complete', () => {
      expect(text()).toContain('profile is complete');
    });

    it('names joining a batch as the next step without offering it', () => {
      expect(text()).toContain('not available yet');
      expect(fixture.nativeElement.querySelectorAll('form').length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('input').length).toBe(0);
    });

    it('offers an Edit profile action ⟨CP3A⟩', () => {
      const button = fixture.nativeElement.querySelector('.cyf-edit-profile-btn');
      expect(button).toBeTruthy();
      expect(text()).toContain('Edit profile');
    });

    it('Edit profile navigates to the form', () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      fixture.nativeElement.querySelector('.cyf-edit-profile-btn').click();
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith(['/student/profile/edit']);
    });

    it('greets the Student by the name from their saved profile', async () => {
      // Not the Google display name: the Student may have entered a different
      // one, and this page should use the name they chose.
      await setup('en', 'Google Name', 'Chosen Name');
      expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Chosen Name');
    });

    it('repeats the approved invitation copy verbatim', () => {
      expect(text()).toContain(
        'You can sign in and complete your profile now. An invitation is required only to join a batch.',
      );
    });

    it('renders no chrome of its own ⟨CP4 closeout⟩', () => {
      // Branding, the language switch, and sign-out moved to the shared shell
      // when the Student area gained a sidebar. They are asserted there, in
      // `shell.component.spec.ts` — a page that still drew them would be a
      // second copy to keep in step.
      expect(fixture.nativeElement.querySelector('cyf-brand-mark')).toBeNull();
      expect(fixture.nativeElement.querySelector('cyf-language-switch')).toBeNull();
      expect(fixture.nativeElement.querySelector('.cyf-logout-btn')).toBeNull();
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
      // Batches left this list in Checkpoint 4: My Batches is a real page and
      // the header links to it. What remains belongs to a checkpoint that has
      // not happened, and naming one here would be a promise the product
      // cannot keep.
      const lowered = text().toLowerCase();
      for (const forbidden of [
        'invitation code',
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
      // The header gained navigation in Checkpoint 4, so links are now allowed
      // — but only to pages that are actually registered. An allow-list rather
      // than "no links at all", because the failure worth catching is a link
      // to a feature that has not shipped.
      const allowed = ['/student/welcome', '/student/batches', '/student/profile/edit'];
      const links = [...fixture.nativeElement.querySelectorAll('a')] as HTMLAnchorElement[];

      for (const link of links) {
        const target = link.getAttribute('routerLink') ?? link.getAttribute('href');
        if (target === null) continue;
        // The in-page skip link, or a route that exists.
        const ok = target.startsWith('#') || allowed.includes(target);
        expect(ok, `${target} is not a page that exists`).toBe(true);
      }
    });

    it('issues no HTTP request beyond reading the profile', () => {
      // The profile read is expected and already flushed in setup; anything
      // else would be an unexplained call.
      http.verify();
    });

    it('shows no Complete Profile action', () => {
      const lowered = html().toLowerCase();
      expect(lowered).not.toContain('complete-profile');
      expect(lowered).not.toContain('completeprofile');
    });
  });

  describe('Arabic', () => {
    beforeEach(async () => setup('ar'));

    it('renders the Arabic greeting', () => {
      expect(fixture.nativeElement.querySelector('h2').textContent).toContain('أهلاً بك');
    });

    it('renders the Arabic next-step copy', () => {
      expect(text()).toContain('الانضمام إلى دفعة هو الخطوة التالية');
    });

    it('repeats the approved Arabic invitation copy verbatim', () => {
      expect(text()).toContain(
        'يمكنك تسجيل الدخول وإكمال ملفك الشخصي الآن. ستحتاج إلى دعوة فقط للانضمام إلى دفعة.',
      );
    });

    it('leaves no untranslated English marker', () => {
      expect(text()).not.toContain('Welcome to Code Your Future');
      expect(text()).not.toContain('next step');
      expect(text()).not.toContain('Edit profile');
    });
  });

  describe('layout safety', () => {
    it('declares no fixed pixel width', () => {
      expect(html()).not.toMatch(/style="[^"]*width:\s*\d+px/);
    });

    it('renders no page frame of its own ⟨CP4 closeout⟩', () => {
      // The skip link and the `main` landmark belong to the shared shell now.
      // Both are asserted in `shell.component.spec.ts`.
      expect(fixture.nativeElement.querySelector('.cyf-skip-link')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('main').length).toBe(0);
    });
  });
});
