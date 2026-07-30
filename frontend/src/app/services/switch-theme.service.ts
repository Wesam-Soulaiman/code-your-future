import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SwitchThemeService {
  private document = inject(DOCUMENT);

  switchTheme(theme: string): void {
    localStorage.setItem('theme', theme);
    const htmlEl = this.document.documentElement;
    const bodyEl = this.document.body;

    if (theme === 'dark') {
      htmlEl.classList.add('dark');
      bodyEl.classList.add('dark');
    } else {
      htmlEl.classList.remove('dark');
      bodyEl.classList.remove('dark');
    }
  }

  getCurrentTheme(): string {
    return localStorage.getItem('theme') ?? 'dark';
  }

  initTheme(): void {
    this.switchTheme(this.getCurrentTheme());
  }
}
