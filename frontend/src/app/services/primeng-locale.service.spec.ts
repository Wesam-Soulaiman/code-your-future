import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { PrimeNG } from 'primeng/config';
import { providePrimeNG } from 'primeng/config';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChangeLangService } from './change-lang.service';
import { PrimeNgLocaleService } from './primeng-locale.service';

/**
 * PrimeNG's calendar vocabulary.
 *
 * This exists because PrimeNG does not read `@ngx-translate`: its DatePicker
 * draws month and day names from its own translation object, which defaults to
 * English. Without this service an Arabic page opened an Arabic-labelled field
 * onto a calendar reading "May 2001 / Su Mo Tu We Th Fr Sa".
 */
describe('PrimeNgLocaleService', () => {
  let config: PrimeNG;
  let locale: PrimeNgLocaleService;
  let langService: ChangeLangService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [providePrimeNG({}), provideTranslateService({ fallbackLang: 'en' })],
    });
    config = TestBed.inject(PrimeNG);
    langService = TestBed.inject(ChangeLangService);
    locale = TestBed.inject(PrimeNgLocaleService);
  });

  describe('English', () => {
    beforeEach(() => locale.apply('en'));

    it('names twelve months', () => {
      expect(config.translation.monthNames?.length).toBe(12);
      expect(config.translation.monthNames?.[0]).toBe('January');
      expect(config.translation.monthNames?.[11]).toBe('December');
    });

    it('names seven days, starting on Sunday', () => {
      expect(config.translation.dayNames?.length).toBe(7);
      expect(config.translation.dayNames?.[0]).toBe('Sunday');
      expect(config.translation.firstDayOfWeek).toBe(0);
    });

    it('supplies short and narrow day names for the calendar header', () => {
      expect(config.translation.dayNamesShort?.length).toBe(7);
      expect(config.translation.dayNamesMin?.length).toBe(7);
    });
  });

  describe('Arabic', () => {
    beforeEach(() => locale.apply('ar'));

    it('names the months in Arabic', () => {
      const months = config.translation.monthNames ?? [];
      expect(months.length).toBe(12);
      for (const month of months) {
        expect(month, `${month} must be Arabic`).toMatch(/[؀-ۿ]/);
      }
    });

    it('names the days in Arabic', () => {
      const days = config.translation.dayNames ?? [];
      expect(days.length).toBe(7);
      for (const day of days) {
        expect(day, `${day} must be Arabic`).toMatch(/[؀-ۿ]/);
      }
    });

    it('translates the calendar actions and labels', () => {
      expect(config.translation.today).toMatch(/[؀-ۿ]/);
      expect(config.translation.clear).toMatch(/[؀-ۿ]/);
      expect(config.translation.chooseYear).toMatch(/[؀-ۿ]/);
      expect(config.translation.nextMonth).toMatch(/[؀-ۿ]/);
    });

    it('leaves no English month or day name behind', () => {
      const all = [
        ...(config.translation.monthNames ?? []),
        ...(config.translation.dayNames ?? []),
        ...(config.translation.dayNamesShort ?? []),
      ].join(' ');
      for (const english of ['January', 'December', 'Sunday', 'Sat']) {
        expect(all).not.toContain(english);
      }
    });

    it('still starts the week on Sunday, as the Syrian week does', () => {
      expect(config.translation.firstDayOfWeek).toBe(0);
    });
  });

  it('follows a language change without a reload', async () => {
    langService.changeLang('ar');
    await TestBed.inject(PrimeNG).translationObserver;
    TestBed.tick();
    expect(config.translation.monthNames?.[0]).toMatch(/[؀-ۿ]/);

    langService.changeLang('en');
    TestBed.tick();
    expect(config.translation.monthNames?.[0]).toBe('January');
  });

  it('is idempotent', () => {
    locale.apply('ar');
    const first = [...(config.translation.monthNames ?? [])];
    locale.apply('ar');
    expect(config.translation.monthNames).toEqual(first);
  });
});
