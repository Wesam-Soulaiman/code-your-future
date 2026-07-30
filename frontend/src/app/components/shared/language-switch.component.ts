import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ChangeLangService, Language } from '../../services/change-lang.service';

/**
 * English / Arabic switch.
 *
 * Rendered as a pair of real `<button>` elements in a `group`, each carrying
 * `aria-pressed` so assistive technology announces which language is active.
 * Native buttons mean keyboard support is free and no ARIA role juggling is
 * needed. Each language is written in its own script so the option is legible
 * regardless of the language currently active.
 */
@Component({
  selector: 'cyf-language-switch',
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cyf-lang-switch" role="group" [attr.aria-label]="'a11y.languageSwitch' | translate">
      @for (option of options; track option.code) {
        <button
          type="button"
          class="cyf-lang-option"
          [attr.aria-pressed]="langService.currentLang() === option.code"
          [attr.lang]="option.code"
          (click)="select(option.code)"
        >
          {{ option.label }}
          <span class="cyf-sr-only">{{ option.a11yKey | translate }}</span>
        </button>
      }
    </div>
  `,
})
export class LanguageSwitchComponent {
  protected langService = inject(ChangeLangService);

  protected readonly options: {
    code: Language;
    label: string;
    a11yKey: string;
  }[] = [
    { code: 'en', label: 'English', a11yKey: 'a11y.switchToEnglish' },
    { code: 'ar', label: 'العربية', a11yKey: 'a11y.switchToArabic' },
  ];

  protected select(code: Language): void {
    this.langService.changeLang(code);
  }
}
