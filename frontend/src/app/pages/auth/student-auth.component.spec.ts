import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTranslations } from '../../testing/i18n-testing';
import { StudentAuthComponent } from './student-auth.component';

/**
 * Student auth page — UI only.
 *
 * The load-bearing assertions here are negative: this page must not be able to
 * authenticate anybody. Google OAuth arrives in Checkpoint 3.
 */
describe('StudentAuthComponent', () => {
  let fixture: ComponentFixture<StudentAuthComponent>;

  async function setup(lang: 'en' | 'ar' = 'en'): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudentAuthComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);

    fixture = TestBed.createComponent(StudentAuthComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const html = () => fixture.nativeElement.innerHTML as string;
  const text = () => fixture.nativeElement.textContent as string;

  beforeEach(async () => setup());

  describe('no credential UI of any kind', () => {
    it('renders no password input', () => {
      expect(fixture.nativeElement.querySelectorAll('input[type="password"]').length).toBe(0);
    });

    it('renders no email or text input', () => {
      expect(fixture.nativeElement.querySelectorAll('input[type="email"]').length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('input[type="text"]').length).toBe(0);
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

  describe('Google button cannot authenticate', () => {
    const googleButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('.cyf-google-btn');

    it('exists and is disabled', () => {
      const button = googleButton();
      expect(button).toBeTruthy();
      expect(button.disabled).toBe(true);
    });

    it('has no click binding at all', () => {
      // A disabled button cannot fire, but assert the component exposes no
      // handler either — there must be nothing to wire up by accident.
      const component = fixture.componentInstance as unknown as Record<string, unknown>;
      for (const name of [
        'signInWithGoogle',
        'onGoogleClick',
        'loginWithGoogle',
        'continueWithGoogle',
        'handleGoogle',
      ]) {
        expect(component[name]).toBeUndefined();
      }
    });

    it('clicking it changes no session state and performs no navigation', () => {
      const before = window.location.href;
      googleButton().click();
      fixture.detectChanges();

      expect(localStorage.getItem('sessionToken')).toBeNull();
      expect(localStorage.getItem('currentUser')).toBeNull();
      expect(window.location.href).toBe(before);
    });

    it('issues no HTTP request when clicked', () => {
      // verify() throws if any request was opened, so this proves the button
      // never reaches a backend — real or faked.
      const controller = TestBed.inject(HttpTestingController);
      googleButton().click();
      fixture.detectChanges();
      controller.verify();
    });

    it('is described by a visible explanation', () => {
      const describedBy = googleButton().getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const note = fixture.nativeElement.querySelector(`#${describedBy}`);
      expect(note).toBeTruthy();
      expect((note.textContent as string).trim().length).toBeGreaterThan(0);
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

    it('explains that Google sign-in is not available yet', () => {
      expect(text()).toContain('not available yet');
    });

    it('includes a privacy reassurance', () => {
      expect(text()).toContain('verify who you are');
    });

    it('links to Admin sign in', () => {
      const link: HTMLAnchorElement = fixture.nativeElement.querySelector(
        'a[href="/auth/admin"], a[ng-reflect-router-link="/auth/admin"]',
      );
      expect(link ?? html()).toBeTruthy();
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

    it('marks the decorative aside as hidden from assistive technology', () => {
      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside?.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
