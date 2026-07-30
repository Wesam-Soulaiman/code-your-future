import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChangeLangService } from './change-lang.service';

/**
 * Language / direction initialization tests.
 *
 * These cover the confirmed defect: `/auth` used to render English text inside an
 * RTL document because `initLang()` only ran in the authenticated shell. The fix
 * moved initialization into an app initializer, so a cold load in either language
 * has `lang` and `dir` synchronized before any route renders.
 */
function service(): ChangeLangService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTranslateService({})] });
  return TestBed.inject(ChangeLangService);
}

describe('English initialization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  it('defaults to English with LTR when nothing is stored', () => {
    const lang = service();
    lang.initLang();

    expect(lang.currentLang()).toBe('en');
    expect(lang.currentDirection()).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('restores a stored English preference', () => {
    localStorage.setItem('lang', 'en');
    const lang = service();
    lang.initLang();
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});

describe('Arabic initialization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  it('restores Arabic with RTL on a cold load', () => {
    localStorage.setItem('lang', 'ar');
    const lang = service();
    lang.initLang();

    expect(lang.currentLang()).toBe('ar');
    expect(lang.currentDirection()).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('never leaves lang and dir disagreeing', () => {
    localStorage.setItem('lang', 'ar');
    const lang = service();
    lang.initLang();

    // The bug: dir=rtl while lang=en (English text under an RTL document).
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    lang.changeLang('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('sets the document attributes synchronously, before any effect flush', () => {
    localStorage.setItem('lang', 'ar');
    const lang = service();
    lang.initLang();
    // No tick / detectChanges: attributes must already be correct so the first
    // paint of /auth cannot flash the wrong direction.
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});

describe('language switching', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists the new language', () => {
    const lang = service();
    lang.changeLang('ar');
    expect(localStorage.getItem('lang')).toBe('ar');
    expect(lang.currentDirection()).toBe('rtl');

    lang.changeLang('en');
    expect(localStorage.getItem('lang')).toBe('en');
    expect(lang.currentDirection()).toBe('ltr');
  });

  it('ignores an unsupported language', () => {
    const lang = service();
    lang.changeLang('fr' as never);
    expect(lang.currentLang()).toBe('en');
  });

  it('falls back to English for a corrupt stored value', () => {
    localStorage.setItem('lang', 'klingon');
    const lang = service();
    expect(lang.currentLang()).toBe('en');
  });

  it('exposes the RTL-aware position helper', () => {
    const lang = service();
    expect(lang.position()).toBe('left');
    lang.changeLang('ar');
    expect(lang.position()).toBe('right');
  });
});
