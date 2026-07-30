import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthComponent } from './auth.component';

/**
 * Auth-screen tests.
 *
 * The important assertions are negative: Checkpoint 1 must not present any
 * Student email/password login, any signup link, or a non-functional Google
 * button. Student OAuth arrives in Checkpoint 3.
 */
describe('AuthComponent', () => {
  let fixture: ComponentFixture<AuthComponent>;
  let html: string;

  beforeEach(async () => {
    localStorage.clear();
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
    fixture = TestBed.createComponent(AuthComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    html = fixture.nativeElement.innerHTML as string;
  });

  it('renders exactly one password field — the Admin one', () => {
    const passwordInputs = fixture.nativeElement.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(1);
  });

  it('renders a single login form', () => {
    expect(fixture.nativeElement.querySelectorAll('form').length).toBe(1);
  });

  it('presents no Student email/password login UI', () => {
    const lowered = html.toLowerCase();
    // No second credential form, and no student-specific credential controls.
    expect(lowered).not.toContain('student-password');
    expect(lowered).not.toContain('studentemail');
    expect(fixture.nativeElement.querySelectorAll('input[type="email"]').length).toBe(0);
  });

  it('offers no signup, password-reset, or password-change affordance', () => {
    const lowered = html.toLowerCase();
    for (const forbidden of [
      'sign up',
      'signup',
      'register',
      'forgot password',
      'reset password',
      'change password',
    ]) {
      expect(lowered).not.toContain(forbidden);
    }
  });

  it('shows no non-functional OAuth button', () => {
    const lowered = html.toLowerCase();
    expect(lowered).not.toContain('continue with google');
    expect(lowered).not.toContain('continue with apple');
  });

  it('shows the Student notice as informational text, not a control', () => {
    const notice = fixture.nativeElement.querySelector('[data-testid="student-signin-notice"]');
    expect(notice).toBeTruthy();
    expect(notice.tagName.toLowerCase()).toBe('p');
    expect(notice.querySelector('button')).toBeNull();
    expect(notice.querySelector('a')).toBeNull();
  });

  it('exposes no legacy role vocabulary', () => {
    expect(html).not.toContain('SuperAdmin');
    expect(html).not.toContain('Employee');
  });

  it('references no missing login carousel image', () => {
    // The template referenced six login*.webp files that were never shipped.
    expect(html).not.toContain('login1.webp');
    expect(fixture.componentInstance.images.length).toBe(0);
  });
});
