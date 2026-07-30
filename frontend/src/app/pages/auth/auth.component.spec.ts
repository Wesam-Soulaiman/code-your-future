import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTranslations } from '../../testing/i18n-testing';
import { SessionService } from '../../services/session.service';
import { AuthComponent } from './auth.component';

/**
 * Admin auth page.
 *
 * Covers the redesigned presentation plus the states Checkpoint 2A added, and
 * re-asserts the Checkpoint 1 security properties that must not regress.
 */
describe('AuthComponent (Admin)', () => {
  let fixture: ComponentFixture<AuthComponent>;
  let http: HttpTestingController;

  async function setup(lang: 'en' | 'ar' = 'en'): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    useTranslations(TestBed.inject(TranslateService), lang);

    fixture = TestBed.createComponent(AuthComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const html = () => fixture.nativeElement.innerHTML as string;
  const text = () => fixture.nativeElement.textContent as string;
  const usernameInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('#admin-username');
  const passwordInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('#admin-password');
  const form = (): HTMLFormElement => fixture.nativeElement.querySelector('form');
  const submitButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button[type="submit"]');

  function fillCredentials(user = 'admin', pass = 'correct-horse'): void {
    const u = usernameInput();
    u.value = user;
    u.dispatchEvent(new Event('input'));
    const p = passwordInput();
    p.value = pass;
    p.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    form().dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  describe('structure and labels', () => {
    it('has exactly one h1', () => {
      expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    });

    it('associates a real label with each field', () => {
      for (const id of ['admin-username', 'admin-password']) {
        const label = fixture.nativeElement.querySelector(`label[for="${id}"]`);
        expect(label, `label for ${id}`).toBeTruthy();
        expect((label.textContent as string).trim().length).toBeGreaterThan(0);
      }
    });

    it('does not rely on placeholder-only labelling', () => {
      expect(usernameInput().getAttribute('placeholder')).toBeNull();
      expect(passwordInput().getAttribute('placeholder')).toBeNull();
    });

    it('sets appropriate autocomplete attributes', () => {
      expect(usernameInput().getAttribute('autocomplete')).toBe('username');
      expect(passwordInput().getAttribute('autocomplete')).toBe('current-password');
    });

    it('does not autofocus (harmful on mobile)', () => {
      // Only the form fields matter here — a focused field on load pops the
      // mobile keyboard. PrimeNG renders its own autofocus attribute on the
      // button, which is outside this component's control.
      expect(usernameInput().autofocus).toBe(false);
      expect(passwordInput().autofocus).toBe(false);
      expect(document.activeElement).not.toBe(usernameInput());
      expect(document.activeElement).not.toBe(passwordInput());
    });

    it('shows Code Your Future branding', () => {
      expect(fixture.nativeElement.querySelector('cyf-brand-mark')).toBeTruthy();
      expect(text()).toContain('Admin sign in');
    });

    it('links to the Student auth page', () => {
      expect(html()).toContain('/auth/student');
    });

    it('offers no signup, reset, or account-type selection', () => {
      const lowered = text().toLowerCase();
      for (const forbidden of ['sign up', 'signup', 'forgot', 'reset password', 'create account']) {
        expect(lowered).not.toContain(forbidden);
      }
      expect(fixture.nativeElement.querySelector('select')).toBeNull();
    });

    it('shows no default or example credentials', () => {
      expect(usernameInput().value).toBe('');
      expect(passwordInput().value).toBe('');
    });
  });

  describe('password visibility toggle', () => {
    const toggle = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('.cyf-input-affix');

    it('starts masked', () => {
      expect(passwordInput().type).toBe('password');
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
    });

    it('reveals and re-masks the value', () => {
      toggle().click();
      fixture.detectChanges();
      expect(passwordInput().type).toBe('text');
      expect(toggle().getAttribute('aria-pressed')).toBe('true');

      toggle().click();
      fixture.detectChanges();
      expect(passwordInput().type).toBe('password');
    });

    it('has an accessible name that reflects state', () => {
      expect(toggle().getAttribute('aria-label')).toBe('Show password');
      toggle().click();
      fixture.detectChanges();
      expect(toggle().getAttribute('aria-label')).toBe('Hide password');
    });

    it('is a real button so it is keyboard reachable', () => {
      expect(toggle().tagName.toLowerCase()).toBe('button');
      expect(toggle().getAttribute('type')).toBe('button');
    });
  });

  describe('validation', () => {
    it('does not call the API when fields are empty', () => {
      submit();
      http.verify();
      expect(text()).toContain('Enter your username and password');
    });

    it('clears the validation notice once the user types', () => {
      submit();
      expect(text()).toContain('Enter your username and password');

      fillCredentials();
      expect(text()).not.toContain('Enter your username and password');
    });

    it('reserves space for messages so the layout does not jump', () => {
      expect(fixture.nativeElement.querySelectorAll('.cyf-field-message').length)
        .toBeGreaterThanOrEqual(2);
    });
  });

  describe('submission', () => {
    it('posts to the Admin login route on submit', () => {
      fillCredentials();
      submit();
      const request = http.expectOne((r) => r.url.includes('loginUser'));
      expect(request.request.method).toBe('POST');
      request.flush({ id: 'u1', username: 'admin', roles: ['Admin'], sessionToken: 'r:tok' });
      http.verify();
    });

    it('submits on Enter via the form (keyboard submission)', () => {
      fillCredentials();
      // Dispatching submit is what Enter does inside a form.
      submit();
      http.expectOne((r) => r.url.includes('loginUser')).flush({
        id: 'u1',
        username: 'admin',
        roles: ['Admin'],
        sessionToken: 'r:tok',
      });
      http.verify();
    });

    it('prevents duplicate submits while a request is in flight', () => {
      fillCredentials();
      submit();
      // Two further submits while loading must not open new requests.
      submit();
      submit();
      const requests = http.match((r) => r.url.includes('loginUser'));
      expect(requests.length).toBe(1);
      requests[0].flush({ id: 'u1', username: 'admin', roles: ['Admin'], sessionToken: 'r:tok' });
      http.verify();
    });

    it('disables the submit button while loading', () => {
      fillCredentials();
      submit();
      expect(submitButton().disabled).toBe(true);

      http.expectOne((r) => r.url.includes('loginUser')).flush({
        id: 'u1',
        username: 'admin',
        roles: ['Admin'],
        sessionToken: 'r:tok',
      });
    });

    it('stores the session on success', () => {
      const session = TestBed.inject(SessionService);
      fillCredentials();
      submit();
      http.expectOne((r) => r.url.includes('loginUser')).flush({
        id: 'u1',
        username: 'admin',
        roles: ['Admin'],
        sessionToken: 'r:tok',
      });
      fixture.detectChanges();
      expect(session.isLoggedIn()).toBe(true);
      expect(session.isAdmin()).toBe(true);
    });
  });

  describe('error states are translated and safe', () => {
    function failWith(status: number, body: Record<string, unknown> | null): void {
      fillCredentials();
      submit();
      http
        .expectOne((r) => r.url.includes('loginUser'))
        .flush(body, { status, statusText: 'Error' });
      fixture.detectChanges();
    }

    it('shows a translated message for invalid credentials', () => {
      failWith(400, { code: 101, error: 'Invalid credentials' });
      expect(text()).toContain('The username or password is incorrect.');
    });

    it('shows a translated message when the account may not use a password', () => {
      failWith(400, { code: 119, error: 'This account cannot sign in with a password' });
      expect(text()).toContain('This account cannot sign in with a password.');
    });

    it('shows a translated rate-limit message', () => {
      failWith(429, { error: 'Too many requests' });
      expect(text()).toContain('Too many sign-in attempts');
    });

    it('shows a translated backend-unavailable message', () => {
      failWith(0, null);
      expect(text()).toContain('cannot reach the server');
    });

    it('shows a translated message for a server fault', () => {
      failWith(500, { error: 'boom' });
      expect(text()).toContain('cannot reach the server');
    });

    it('never renders the raw backend error string', () => {
      failWith(400, { code: 101, error: 'RAW_BACKEND_CANARY' });
      expect(text()).not.toContain('RAW_BACKEND_CANARY');
    });

    it('announces the error assertively and not by colour alone', () => {
      failWith(400, { code: 101, error: 'nope' });
      const alert = fixture.nativeElement.querySelector('[role="alert"]');
      expect(alert).toBeTruthy();
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      // A visually hidden prefix carries the meaning without colour.
      expect(alert.textContent).toContain('Error:');
      expect(alert.querySelector('i')).toBeTruthy();
    });

    it('re-enables submission after a failure', () => {
      failWith(400, { code: 101, error: 'nope' });
      expect(submitButton().disabled).toBe(false);
    });

    it('clears the error when the user edits a field', () => {
      failWith(400, { code: 101, error: 'nope' });
      expect(text()).toContain('incorrect');

      const u = usernameInput();
      u.value = 'admin2';
      u.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(text()).not.toContain('The username or password is incorrect.');
    });

    it('writes no session on failure', () => {
      failWith(400, { code: 101, error: 'nope' });
      expect(localStorage.getItem('sessionToken')).toBeNull();
    });
  });

  describe('Arabic', () => {
    beforeEach(async () => setup('ar'));

    it('renders the Arabic heading', () => {
      expect(fixture.nativeElement.querySelector('h1').textContent).toContain(
        'تسجيل دخول المشرف',
      );
    });

    it('renders Arabic field labels', () => {
      expect(text()).toContain('اسم المستخدم');
      expect(text()).toContain('كلمة المرور');
    });

    it('shows a translated Arabic error', () => {
      fillCredentials();
      submit();
      http
        .expectOne((r) => r.url.includes('loginUser'))
        .flush({ code: 101 }, { status: 400, statusText: 'Error' });
      fixture.detectChanges();
      expect(text()).toContain('اسم المستخدم أو كلمة المرور غير صحيحة.');
    });

    it('leaves no untranslated English heading', () => {
      expect(text()).not.toContain('Admin sign in');
    });
  });

  describe('layout safety', () => {
    it('uses the shared auth layout', () => {
      expect(fixture.nativeElement.querySelector('cyf-auth-layout')).toBeTruthy();
    });

    it('declares no fixed pixel width that could overflow small screens', () => {
      expect(html()).not.toMatch(/style="[^"]*width:\s*\d{3,}px/);
    });

    it('hides the decorative aside from assistive technology', () => {
      expect(
        fixture.nativeElement.querySelector('aside')?.getAttribute('aria-hidden'),
      ).toBe('true');
    });
  });
});
