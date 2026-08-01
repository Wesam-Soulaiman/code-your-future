import { effect, inject, Injectable } from '@angular/core';
import { PrimeNG } from 'primeng/config';

import { ChangeLangService, Language } from './change-lang.service';

/**
 * Keep PrimeNG's own calendar vocabulary in step with the application language
 * ⟨CP3A catalog⟩.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * PrimeNG does not read `@ngx-translate`. Its DatePicker draws month and day
 * names from its **own** translation object, which defaults to English — so an
 * Arabic page opened an Arabic-labelled field onto a calendar reading
 * "May 2001 / Su Mo Tu We Th Fr Sa". Found by looking at the screenshots, not
 * by any test.
 *
 * ── Where the names come from ───────────────────────────────────────────────
 * `Intl.DateTimeFormat`, not a hand-typed table. The browser already ships
 * correct month and day names for both languages, and generating them means the
 * spelling cannot drift, a locale we add later needs no new list, and nobody has
 * to review 24 strings for typos.
 *
 * `firstDayOfWeek` is 0 for both. Arabic calendars vary by country, and Sunday
 * is what the Syrian week starts on — the audience this product serves.
 */
@Injectable({
  providedIn: 'root',
})
export class PrimeNgLocaleService {
  private config = inject(PrimeNG);
  private langService = inject(ChangeLangService);

  constructor() {
    // Re-applied on every language change, so switching mid-form relabels an
    // already-rendered calendar rather than waiting for a reload.
    effect(() => this.apply(this.langService.currentLang()));
  }

  /** Apply the calendar vocabulary for a language. Idempotent. */
  apply(lang: Language): void {
    const locale = lang === 'ar' ? 'ar' : 'en';

    this.config.setTranslation({
      dayNames: this.dayNames(locale, 'long'),
      dayNamesShort: this.dayNames(locale, 'short'),
      dayNamesMin: this.dayNames(locale, 'narrow'),
      monthNames: this.monthNames(locale, 'long'),
      monthNamesShort: this.monthNames(locale, 'short'),
      firstDayOfWeek: 0,
      today: lang === 'ar' ? 'اليوم' : 'Today',
      clear: lang === 'ar' ? 'مسح' : 'Clear',
      dateFormat: lang === 'ar' ? 'dd/mm/yy' : 'dd/mm/yy',
      weekHeader: lang === 'ar' ? 'أسبوع' : 'Wk',
      chooseDate: lang === 'ar' ? 'اختر التاريخ' : 'Choose date',
      prevMonth: lang === 'ar' ? 'الشهر السابق' : 'Previous month',
      nextMonth: lang === 'ar' ? 'الشهر التالي' : 'Next month',
      prevYear: lang === 'ar' ? 'السنة السابقة' : 'Previous year',
      nextYear: lang === 'ar' ? 'السنة التالية' : 'Next year',
      chooseYear: lang === 'ar' ? 'اختر السنة' : 'Choose year',
      chooseMonth: lang === 'ar' ? 'اختر الشهر' : 'Choose month',
      emptyMessage: lang === 'ar' ? 'لا توجد نتائج' : 'No results found',
      emptyFilterMessage: lang === 'ar' ? 'لا توجد نتائج' : 'No results found',
    });
  }

  /** Sunday-first day names, from the browser's own locale data. */
  private dayNames(locale: string, weekday: 'long' | 'short' | 'narrow'): string[] {
    const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
    // 2024-01-07 was a Sunday, so seven consecutive days start the week right.
    return Array.from({ length: 7 }, (_, index) =>
      format.format(new Date(Date.UTC(2024, 0, 7 + index))),
    );
  }

  private monthNames(locale: string, month: 'long' | 'short'): string[] {
    const format = new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, index) =>
      format.format(new Date(Date.UTC(2024, index, 1))),
    );
  }
}
