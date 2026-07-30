import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { LanguageSwitchComponent } from '../shared/language-switch.component';

/**
 * Shared chrome for every authentication page.
 *
 * Composition:
 *   - mobile / tablet: a single centred column; the informational aside is
 *     hidden so the primary action is reachable without scrolling;
 *   - >= 1024px: a balanced split, form on the inline-start side and a quiet
 *     informational panel on the inline-end side.
 *
 * The split is built with CSS logical properties, so RTL mirrors without a
 * second template.
 *
 * Landmarks: `<header>`, `<main id="cyf-auth-main">`, and an `<aside>` that is
 * `aria-hidden` because it is supporting marketing copy already conveyed by the
 * form itself — announcing it again would be noise. A skip link targets the main
 * region.
 */
@Component({
  selector: 'cyf-auth-layout',
  imports: [TranslateModule, RouterLink, BrandMarkComponent, LanguageSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cyf-auth">
      <a class="cyf-skip-link" href="#cyf-auth-main">{{ 'a11y.skipToContent' | translate }}</a>

      <header class="cyf-auth-header">
        <a routerLink="/auth" class="cyf-brand cyf-focusable">
          <cyf-brand-mark />
        </a>
        <cyf-language-switch />
      </header>

      <div class="cyf-auth-body">
        <main id="cyf-auth-main" class="cyf-auth-main" tabindex="-1">
          <div class="cyf-auth-panel">
            <ng-content />
          </div>
        </main>

        <aside class="cyf-auth-aside" aria-hidden="true">
          <div class="cyf-auth-aside-inner">
            <ng-content select="[asidePanel]" />
          </div>
        </aside>
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
