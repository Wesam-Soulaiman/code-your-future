import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

type Language = 'en' | 'ar';
type Direction = 'ltr' | 'rtl';

@Injectable({
  providedIn: 'root',
})
export class ChangeLangService {
  private document = inject(DOCUMENT);
  private translate = inject(TranslateService);

  currentLang = signal<Language>((localStorage.getItem('lang') as Language) || 'en');

  currentDirection = computed<Direction>(() => (this.currentLang() === 'ar' ? 'rtl' : 'ltr'));

  position = computed(() => (this.currentLang() === 'ar' ? 'right' : 'left'));

  constructor() {
    // Apply direction changes to document
    effect(() => {
      const dir = this.currentDirection();
      this.document.documentElement.setAttribute('dir', dir);
      this.document.body.setAttribute('dir', dir);
    });
  }

  initLang(): void {
    const lang = this.currentLang();
    this.applyLang(lang);
  }

  changeLang(lang: Language): void {
    localStorage.setItem('lang', lang);
    this.currentLang.set(lang);
    this.applyLang(lang);
  }

  private applyLang(lang: Language): void {
    this.document.documentElement.lang = lang;
    this.translate.use(lang);
  }
}
