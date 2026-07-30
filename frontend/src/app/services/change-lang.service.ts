import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

export type Language = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

const LANG_KEY = 'lang';
const SUPPORTED: readonly Language[] = ['en', 'ar'];

/**
 * Language and document-direction state.
 *
 * `initLang()` is called from an app initializer (see `app.config.ts`), so both
 * the translation language and the document `dir`/`lang` attributes are correct
 * before the router activates a route. That fixes the confirmed defect where
 * `/auth` rendered English text inside an RTL document because initialization
 * only happened in the authenticated shell.
 */
@Injectable({
  providedIn: 'root',
})
export class ChangeLangService {
  private document = inject(DOCUMENT);
  private translate = inject(TranslateService);

  currentLang = signal<Language>(this.readStoredLang());

  currentDirection = computed<Direction>(() => (this.currentLang() === 'ar' ? 'rtl' : 'ltr'));

  position = computed(() => (this.currentLang() === 'ar' ? 'right' : 'left'));

  constructor() {
    // Keep the document attributes synchronized with the signal. `lang` and `dir`
    // are set together so they can never disagree.
    effect(() => {
      const lang = this.currentLang();
      const dir = this.currentDirection();
      const html = this.document.documentElement;
      html.setAttribute('dir', dir);
      html.setAttribute('lang', lang);
      this.document.body.setAttribute('dir', dir);
    });
  }

  /**
   * Apply the persisted (or default) language. Idempotent, and safe to call
   * before the router starts.
   */
  initLang(): void {
    this.applyLang(this.currentLang());
  }

  changeLang(lang: Language): void {
    if (!SUPPORTED.includes(lang)) return;
    localStorage.setItem(LANG_KEY, lang);
    this.currentLang.set(lang);
    this.applyLang(lang);
  }

  private applyLang(lang: Language): void {
    // Set the attributes eagerly as well as via the effect, so a caller that
    // runs before the first effect flush still sees a correct document.
    const html = this.document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    this.document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    this.translate.use(lang);
  }

  private readStoredLang(): Language {
    const stored = localStorage.getItem(LANG_KEY);
    return SUPPORTED.find((lang) => lang === stored) ?? 'en';
  }
}
