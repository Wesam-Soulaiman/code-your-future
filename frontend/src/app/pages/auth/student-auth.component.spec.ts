import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleIdentityService } from '../../services/google-identity.service';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { StudentAuthComponent } from './student-auth.component';

/**
 * Student auth page — the real Google flow.
 *
 * **No test here contacts Google.** `GoogleIdentityService` is replaced by a
 * double, so every state — loading, ready, unavailable, unconfigured — is
 * driven deterministically, and the credential handler is invoked directly.
 *
 * The load-bearing assertions remain negative: this page must never offer a
 * password, never fake a session, and never render a server or provider string.
 */

/** A controllable stand-in for Google's library wrapper. */
class FakeGoogleIdentityService {
  state = vi.fn();
  private stateValue: 'idle' | 'notConfigured' | 'loading' | 'ready' | 'unavailable' = 'ready';
  configured = true;
  credentialHandler: ((credential: string) => void) | null = null;
  renderedInto: HTMLElement | null = null;
  renderedLocale: string | null = null;

  constructor() {
    this.state = vi.fn(() => this.stateValue) as unknown as typeof this.state;
  }

  setState(next: typeof this.stateValue): void {
    this.stateValue = next;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  initializeCalls: string[] = [];

  async initialize(
    onCredential: (credential: string) => void,
    locale = 'en',
  ): Promise<boolean> {
    this.credentialHandler = onCredential;
    this.initializeCalls.push(locale);
    return this.stateValue === 'ready';
  }

  renderButton(host: HTMLElement, locale: string): void {
    this.renderedInto = host;
    this.renderedLocale = locale;
  }

  disableAutoSelect(): void {}
}

const CREDENTIAL = 'header.payload.signature';

/**
 * A stand-in for the Student welcome page.
 *
 * The success path really navigates, so the test router needs a matching route;
 * without one the navigation rejects and the run reports an unhandled error even
 * though every assertion passed.
 */
@Component({ selector: 'app-welcome-stub', template: 'welcome' })
class WelcomeStubComponent {}

describe('StudentAuthComponent', () => {
  let fixture: ComponentFixture<StudentAuthComponent>;
  let google: FakeGoogleIdentityService;
  let http: HttpTestingController;

  async function setup(
    lang: 'en' | 'ar' = 'en',
    sdkState: 'idle' | 'notConfigured' | 'loading' | 'ready' | 'unavailable' = 'ready',
  ): Promise<void> {
    localStorage.clear();
    // A pending invitation lives in sessionStorage and changes where sign-in
    // lands, so one test must not leak it into the next. ⟨CP4⟩
    sessionStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();

    google = new FakeGoogleIdentityService();
    google.setState(sdkState);
    google.configured = sdkState !== 'notConfigured';

    TestBed.configureTestingModule({
      imports: [StudentAuthComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'student/welcome', component: WelcomeStubComponent },
          { path: '**', component: WelcomeStubComponent },
        ]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
        { provide: GoogleIdentityService, useValue: google },
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(StudentAuthComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const html = () => fixture.nativeElement.innerHTML as string;
  const text = () => fixture.nativeElement.textContent as string;
  const component = () => fixture.componentInstance;

  /** Drive a credential through the component exactly as Google would. */
  function receiveCredential(credential = CREDENTIAL): void {
    component().onCredential(credential);
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  describe('no credential UI of any kind', () => {
    it('renders no password input', () => {
      expect(fixture.nativeElement.querySelectorAll('input[type="password"]').length).toBe(0);
    });

    it('renders no input element at all', () => {
      expect(fixture.nativeElement.querySelectorAll('input').length).toBe(0);
    });

    it('renders no signup or credential form', () => {
      expect(fixture.nativeElement.querySelectorAll('form').length).toBe(0);
    });

    it('offers no signup, password reset, or invitation-token affordance', () => {
      const lowered = text().toLowerCase();
      for (const forbidden of [
        'sign up',
        'signup',
        'create account',
        'forgot',
        'reset password',
        'invitation code',
        'invitation token',
      ]) {
        expect(lowered).not.toContain(forbidden);
      }
    });

    it('shows no Apple sign-in', () => {
      expect(html().toLowerCase()).not.toContain('apple');
    });
  });

  describe('Google library states', () => {
    it('renders Google’s own button into the reserved host when ready', () => {
      expect(google.renderedInto).toBeTruthy();
      expect(google.renderedInto?.classList.contains('cyf-google-host')).toBe(true);
    });

    it('passes the active language to Google so its button is localised', async () => {
      // Regression: reading the language from TranslateService gave Google an
      // empty locale, and a real browser rendered a Dutch button on an English
      // page. The language now comes from ChangeLangService, the app's single
      // source of truth.
      await setup('ar');
      expect(google.renderedLocale).toBe('ar');
    });

    it('passes English when the page is English', async () => {
      await setup('en');
      expect(google.renderedLocale).toBe('en');
    });

    it('never asks Google to guess the locale', async () => {
      await setup('en');
      expect(google.renderedLocale).toBeTruthy();
      expect(['en', 'ar']).toContain(google.renderedLocale);
    });

    it('loads Google’s library for that language too', async () => {
      // Google fixes the button text when its script loads, so the language has
      // to reach `initialize`, not only `renderButton`.
      await setup('ar');
      expect(google.initializeCalls).toEqual(['ar']);
    });

    it('shows a loading state while the library is being fetched', async () => {
      await setup('en', 'loading');
      expect(text()).toContain('Preparing Google sign-in');
      const fallback: HTMLButtonElement =
        fixture.nativeElement.querySelector('.cyf-google-btn');
      expect(fallback.disabled).toBe(true);
    });

    it('renders no Google button while loading', async () => {
      await setup('en', 'loading');
      expect(google.renderedInto).toBeNull();
    });

    it('explains a missing configuration instead of offering a dead control', async () => {
      await setup('en', 'notConfigured');
      expect(text()).toContain('not set up on this server yet');
      expect(fixture.nativeElement.querySelector('.cyf-google-btn').disabled).toBe(true);
    });

    it('explains an unreachable Google library', async () => {
      await setup('en', 'unavailable');
      expect(text()).toContain('could not be loaded');
      expect(fixture.nativeElement.querySelector('.cyf-google-btn').disabled).toBe(true);
    });

    it('issues no HTTP request in any non-ready state', async () => {
      for (const state of ['loading', 'notConfigured', 'unavailable'] as const) {
        await setup('en', state);
        http.verify();
      }
    });

    it('the fallback control is described by a visible explanation', async () => {
      await setup('en', 'unavailable');
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.cyf-google-btn');
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const note = fixture.nativeElement.querySelector(`#${describedBy}`);
      expect((note.textContent as string).trim().length).toBeGreaterThan(0);
    });
  });

  describe('Google rejects the origin', () => {
    /**
     * When the page's origin is not in the client's *Authorised JavaScript
     * origins*, Google serves its button but never issues a credential — the
     * button iframe returns 403 and `GSI_LOGGER` complains inside it.
     *
     * The page must sit there safely: no session, no navigation, no request,
     * and above all no pretence that anybody signed in.
     */
    it('creates no session when no credential ever arrives', async () => {
      // 'ready' is exactly the origin-rejected state: the library loaded and the
      // button rendered, but the callback is never invoked.
      expect(google.state()).toBe('ready');

      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(localStorage.getItem('sessionToken')).toBeNull();
      expect(localStorage.getItem('currentUser')).toBeNull();
      http.verify();
    });

    it('does not navigate away from the sign-in page', () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate');
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows no success message while nothing has happened', () => {
      expect(text()).not.toContain('Signed in');
      expect(text()).not.toContain('Taking you to your account');
    });

    it('renders no raw GSI or origin error text', () => {
      const rendered = text();
      for (const raw of [
        'GSI_LOGGER',
        'origin is not allowed',
        'given client ID',
        '403',
      ]) {
        expect(rendered).not.toContain(raw);
      }
    });

    it('still refuses to sign anyone in if an empty credential arrives', () => {
      receiveCredential('');
      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(text()).toContain('Sign-in was cancelled');
      http.verify();
    });
  });

  describe('successful sign-in', () => {
    it('sends the credential to the Student endpoint', () => {
      receiveCredential();
      const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ credential: CREDENTIAL });
      request.flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:token' });
      http.verify();
    });

    it('never puts the credential in the URL', () => {
      receiveCredential();
      const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
      expect(request.request.urlWithParams).not.toContain(CREDENTIAL);
      request.flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:token' });
    });

    it('never stores the credential anywhere', () => {
      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:token' });
      fixture.detectChanges();
      expect(JSON.stringify(localStorage)).not.toContain(CREDENTIAL);
      expect(JSON.stringify(sessionStorage)).not.toContain(CREDENTIAL);
    });

    it('establishes the Parse session from the response', () => {
      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ id: 'u1', displayName: 'Lina Haddad', roles: ['Student'], sessionToken: 'r:tok' });
      fixture.detectChanges();

      const session = TestBed.inject(SessionService);
      expect(session.isLoggedIn()).toBe(true);
      expect(session.isStudent()).toBe(true);
      expect(localStorage.getItem('sessionToken')).toBe('r:tok');
    });

    it('sends a Student with an unfinished profile to the form', () => {
      // Straight to the form rather than to the welcome page and back out
      // again via a guard. The response says nothing about completion, which
      // is exactly the state a brand-new Student signs in with.
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:tok' });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/student/profile']);
    });

    it('sends a Student with a finished profile to the welcome page', () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      receiveCredential();
      http.expectOne((req) => req.url.includes('loginWithGoogle')).flush({
        id: 'u1',
        roles: ['Student'],
        profileComplete: true,
        sessionToken: 'r:tok',
      });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/student/welcome']);
    });

    it('returns a Student holding an invitation to the join page ⟨CP4⟩', () => {
      // Somebody who scanned a QR code and signed in to join should land back
      // on the invitation, not on a welcome page having lost the thread.
      sessionStorage.setItem('pendingInvitationToken', 'A'.repeat(43));

      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      receiveCredential();
      http.expectOne((req) => req.url.includes('loginWithGoogle')).flush({
        id: 'u1',
        roles: ['Student'],
        profileComplete: true,
        sessionToken: 'r:tok',
      });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/join', 'A'.repeat(43)]);
    });

    it('does not follow an invitation until the profile is finished ⟨CP4⟩', () => {
      // The profile still comes first: a membership is meaningless if nobody
      // knows who the member is.
      sessionStorage.setItem('pendingInvitationToken', 'A'.repeat(43));

      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:tok' });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/student/profile']);
    });

    it('treats a response with no session token as a failure, not a sign-in', () => {
      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ id: 'u1', roles: ['Student'] });
      fixture.detectChanges();

      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(text()).toContain('Something went wrong');
    });
  });

  describe('duplicate submission is prevented', () => {
    it('ignores a second credential while a request is in flight', () => {
      receiveCredential();
      receiveCredential();
      // Exactly one request — expectOne throws if a second was opened.
      const request = http.expectOne((req) => req.url.includes('loginWithGoogle'));
      request.flush({ id: 'u1', roles: ['Student'], sessionToken: 'r:tok' });
      http.verify();
    });

    it('marks the sign-in slot busy while authenticating', () => {
      receiveCredential();
      fixture.detectChanges();
      const slot = fixture.nativeElement.querySelector('.cyf-google-slot');
      expect(slot.classList.contains('cyf-google-slot-busy')).toBe(true);
      http.expectOne((req) => req.url.includes('loginWithGoogle')).flush({});
    });

    it('ignores a dismissal that arrives while authenticating', () => {
      receiveCredential();
      component().onDismissed();
      fixture.detectChanges();
      expect(text()).not.toContain('cancelled');
      http.expectOne((req) => req.url.includes('loginWithGoogle')).flush({});
    });
  });

  describe('failure states are translated and safe', () => {
    function failWith(status: number, body: Record<string, unknown> | null): void {
      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush(body, { status, statusText: 'Error' });
      fixture.detectChanges();
    }

    it('shows a safe message for an unverifiable credential', () => {
      failWith(404, { code: 101, error: 'INVALID_CREDENTIAL' });
      expect(text()).toContain('could not verify your Google sign-in');
    });

    it('shows a safe message for an unverified Google email', () => {
      failWith(404, { code: 101, error: 'EMAIL_NOT_VERIFIED' });
      expect(text()).toContain('not verified');
    });

    it('shows a safe message for a blocked account', () => {
      failWith(403, { code: 119, error: 'ACCOUNT_NOT_ELIGIBLE' });
      expect(text()).toContain('cannot sign in as a student');
    });

    it('shows a safe message when the server has no Google configuration', () => {
      failWith(400, { code: 1, error: 'GOOGLE_NOT_CONFIGURED' });
      expect(text()).toContain('not set up on this server yet');
    });

    it('shows a rate-limit message', () => {
      failWith(429, { error: 'Too many requests' });
      expect(text()).toContain('Too many sign-in attempts');
    });

    it('shows an unavailable message when the backend cannot be reached', () => {
      failWith(0, null);
      expect(text()).toContain('cannot reach the server');
    });

    it('shows an unavailable message for a server error', () => {
      failWith(503, { error: 'gateway exploded' });
      expect(text()).toContain('cannot reach the server');
    });

    it('renders no raw backend or provider string', () => {
      failWith(404, {
        code: 101,
        error: 'INVALID_CREDENTIAL',
        stack: 'at verifyIdToken (/srv/app/google.js:88)',
      });
      const rendered = text();
      expect(rendered).not.toContain('INVALID_CREDENTIAL');
      expect(rendered).not.toContain('verifyIdToken');
      expect(rendered).not.toContain('/srv/app');
    });

    it('announces the failure assertively', () => {
      failWith(404, { code: 101, error: 'INVALID_CREDENTIAL' });
      const alert = fixture.nativeElement.querySelector('.cyf-alert-error');
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
    });

    it('creates no session on failure', () => {
      failWith(403, { code: 119, error: 'ACCOUNT_NOT_ELIGIBLE' });
      expect(TestBed.inject(SessionService).isLoggedIn()).toBe(false);
      expect(localStorage.getItem('sessionToken')).toBeNull();
    });

    it('shows a cancellation message when the user dismisses the prompt', () => {
      component().onDismissed();
      fixture.detectChanges();
      expect(text()).toContain('Sign-in was cancelled');
      http.verify();
    });

    it('treats an empty credential as a cancellation, not a sign-in', () => {
      receiveCredential('');
      expect(text()).toContain('Sign-in was cancelled');
      http.verify();
    });

    it('clears a stale failure when a new sign-in starts', () => {
      failWith(404, { code: 101, error: 'INVALID_CREDENTIAL' });
      expect(text()).toContain('could not verify');

      receiveCredential();
      fixture.detectChanges();
      expect(text()).not.toContain('could not verify');
      http.expectOne((req) => req.url.includes('loginWithGoogle')).flush({});
    });
  });

  describe('English content', () => {
    it('shows the student heading as the single h1', () => {
      const headings = fixture.nativeElement.querySelectorAll('h1');
      expect(headings.length).toBe(1);
      expect(headings[0].textContent).toContain('Student sign in');
    });

    it('shows the approved invitation copy verbatim', () => {
      expect(text()).toContain(
        'You can sign in and complete your profile now. An invitation is required only to join a batch.',
      );
    });

    it('includes a privacy reassurance', () => {
      expect(text()).toContain('verify who you are');
    });

    it('links to Admin sign in', () => {
      expect(html()).toContain('/auth/admin');
    });
  });

  describe('Arabic content', () => {
    beforeEach(async () => setup('ar'));

    it('shows the approved Arabic invitation copy verbatim', () => {
      expect(text()).toContain(
        'يمكنك تسجيل الدخول وإكمال ملفك الشخصي الآن. ستحتاج إلى دعوة فقط للانضمام إلى دفعة.',
      );
    });

    it('renders the Arabic heading', () => {
      expect(fixture.nativeElement.querySelector('h1').textContent).toContain('تسجيل دخول الطالب');
    });

    it('renders Arabic failure messages', () => {
      receiveCredential();
      http
        .expectOne((req) => req.url.includes('loginWithGoogle'))
        .flush({ code: 101, error: 'INVALID_CREDENTIAL' }, { status: 404, statusText: 'x' });
      fixture.detectChanges();
      expect(text()).toContain('تعذّر التحقّق');
    });

    it('leaves no untranslated English marker in the body copy', () => {
      expect(text()).not.toContain('Student sign in');
      expect(text()).not.toContain('An invitation is required');
    });

    it('still renders no credential input', () => {
      expect(fixture.nativeElement.querySelectorAll('input').length).toBe(0);
    });
  });

  describe('layout safety', () => {
    it('uses the shared auth layout rather than a fixed width', () => {
      expect(fixture.nativeElement.querySelector('cyf-auth-layout')).toBeTruthy();
      expect(html()).not.toMatch(/style="[^"]*width:\s*\d+px/);
    });

    it('reserves the message area so a failure causes no layout shift', () => {
      expect(fixture.nativeElement.querySelector('.cyf-student-status')).toBeTruthy();
    });

    it('marks the decorative aside as hidden from assistive technology', () => {
      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside?.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
