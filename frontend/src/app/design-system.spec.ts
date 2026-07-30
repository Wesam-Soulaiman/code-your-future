import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AlertComponent } from './components/shared/alert.component';
import { BrandMarkComponent } from './components/shared/brand-mark.component';
import { LanguageSwitchComponent } from './components/shared/language-switch.component';
import { useTranslations } from './testing/i18n-testing';

/**
 * Design-system primitives — behaviour.
 *
 * The stylesheet contract itself (token names, logical properties, and proof
 * that the preserved FullCalendar / Timeline / Editor theming survives) is
 * asserted in `backend/test/templatePreservation.test.ts`, the only suite in
 * this repository with filesystem access. The Angular unit-test builder
 * compiles `?raw` CSS imports through its CSS pipeline instead of returning
 * source text, so it cannot inspect stylesheet source.
 */
describe('BrandMarkComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    useTranslations(TestBed.inject(TranslateService));
  });

  it('renders the product name and a decorative monogram', () => {
    const fixture = TestBed.createComponent(BrandMarkComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Code Your Future');

    const monogram = element.querySelector('.cyf-brand-mark');
    expect(monogram?.getAttribute('aria-hidden')).toBe('true');
  });

  it('can hide the wordmark for tight layouts', () => {
    const fixture = TestBed.createComponent(BrandMarkComponent);
    fixture.componentRef.setInput('showName', false);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.cyf-brand-name')).toBeNull();
  });
});

describe('LanguageSwitchComponent', () => {
  function build() {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    useTranslations(TestBed.inject(TranslateService));
    const fixture = TestBed.createComponent(LanguageSwitchComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes both languages as real buttons', () => {
    const buttons = (build().nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons.length).toBe(2);
    for (const button of Array.from(buttons)) {
      expect(button.tagName.toLowerCase()).toBe('button');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('marks the active language with aria-pressed', () => {
    const fixture = build();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('switching to Arabic updates document lang and dir together', () => {
    const fixture = build();
    const arabicButton = (fixture.nativeElement as HTMLElement).querySelectorAll('button')[1];

    arabicButton.click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(localStorage.getItem('lang')).toBe('ar');
  });

  it('switching back to English restores LTR', () => {
    const fixture = build();
    const [english, arabic] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );

    arabic.click();
    fixture.detectChanges();
    english.click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('labels each option in its own script so it is legible either way', () => {
    const buttons = Array.from(
      (build().nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(buttons[0].textContent).toContain('English');
    expect(buttons[1].textContent).toContain('العربية');
    expect(buttons[1].getAttribute('lang')).toBe('ar');
  });
});

describe('AlertComponent', () => {
  function build(variant: 'error' | 'info' | 'warning' | 'success', prefix = 'Error:') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AlertComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('prefix', prefix);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('announces errors assertively', () => {
    const element = build('error');
    const alert = element.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
  });

  it('announces non-errors politely', () => {
    const element = build('info', 'Note:');
    const status = element.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  it('never conveys status by colour alone — icon plus hidden prefix', () => {
    const element = build('error');
    expect(element.querySelector('i')).toBeTruthy();
    expect(element.querySelector('.cyf-sr-only')?.textContent).toContain('Error:');
  });

  it('applies a distinct class per variant', () => {
    expect(build('error').querySelector('.cyf-alert-error')).toBeTruthy();
    expect(build('warning').querySelector('.cyf-alert-warning')).toBeTruthy();
    expect(build('info').querySelector('.cyf-alert-info')).toBeTruthy();
    expect(build('success').querySelector('.cyf-alert-success')).toBeTruthy();
  });
});
