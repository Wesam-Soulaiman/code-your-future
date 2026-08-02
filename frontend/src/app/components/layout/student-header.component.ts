import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { BrandMarkComponent } from '../shared/brand-mark.component';
import { LanguageSwitchComponent } from '../shared/language-switch.component';
import { STUDENT_BATCHES, STUDENT_HOME, STUDENT_PROFILE, STUDENT_SIGN_IN } from '../../guards/home-route';
import { AuthApiService } from '../../services/dataService/user-service';

/**
 * The Student area's header ⟨CP4⟩.
 *
 * ── Why this exists now and did not before ──────────────────────────────────
 * Through Checkpoint 3A the Student area was a single page, so a header with
 * navigation in it would have been navigation to nowhere. Checkpoint 4 gives a
 * Student a second place to be — their Batches — and the moment there are two
 * pages, every one of them needs a way to reach the other. Extracting the header
 * also means branding, language, and sign-out are defined once rather than
 * re-typed on each page and drifting apart.
 *
 * ── Sign-out belongs here ───────────────────────────────────────────────────
 * The call, the double-submit guard, and the destination all moved with the
 * button. Both outcomes land on the Student sign-in page: `logout()` clears the
 * local session either way, so a failed round-trip must not leave somebody
 * sitting on a page they are no longer authenticated for.
 *
 * The Admin workspace keeps its own shell; nothing here touches it.
 */
@Component({
  selector: 'cyf-student-header',
  imports: [
    TranslateModule,
    ButtonModule,
    RouterLink,
    RouterLinkActive,
    BrandMarkComponent,
    LanguageSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cyf-student-header">
      <div class="cyf-student-header-brand">
        <cyf-brand-mark size="md" />

        @if (showNav()) {
          <nav class="cyf-student-nav" [attr.aria-label]="'a11y.mainNavigation' | translate">
            @for (item of navItems; track item.path) {
              <a
                class="cyf-student-nav-link cyf-nav-text"
                [routerLink]="item.path"
                routerLinkActive="cyf-is-active"
                #active="routerLinkActive"
                [attr.aria-current]="active.isActive ? 'page' : null"
              >
                <i [class]="item.icon" aria-hidden="true"></i>
                <span>{{ item.labelKey | translate }}</span>
              </a>
            }
          </nav>
        }
      </div>

      <div class="cyf-student-header-actions">
        <cyf-language-switch />

        <p-button
          type="button"
          severity="secondary"
          [text]="true"
          [disabled]="loggingOut()"
          (onClick)="logout()"
          styleClass="cyf-btn cyf-logout-btn"
        >
          <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
          <span>{{ 'actions.logout' | translate }}</span>
        </p-button>
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    .cyf-student-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cyf-space-4);
      flex-wrap: wrap;
      padding: var(--cyf-space-4) var(--cyf-space-6);
      border-block-end: 1px solid var(--cyf-border);
      background: var(--cyf-surface);
    }

    .cyf-student-header-brand {
      display: flex;
      align-items: center;
      gap: var(--cyf-space-6);
      flex-wrap: wrap;
    }

    .cyf-student-header-actions {
      display: flex;
      align-items: center;
      gap: var(--cyf-space-2);
    }

    .cyf-student-nav {
      display: flex;
      align-items: center;
      gap: var(--cyf-space-1);
      flex-wrap: wrap;
    }

    .cyf-student-nav-link {
      display: inline-flex;
      align-items: center;
      gap: var(--cyf-space-2);
      min-block-size: var(--cyf-touch-target);
      padding-inline: var(--cyf-space-3);
      color: var(--cyf-text-secondary);
      text-decoration: none;
      border-radius: var(--cyf-radius-md);
      transition: background-color var(--cyf-transition) var(--cyf-ease),
        color var(--cyf-transition) var(--cyf-ease);
    }

    .cyf-student-nav-link:hover {
      color: var(--cyf-text);
      background-color: var(--cyf-surface-subtle);
    }

    /* The active page is marked by weight and background as well as colour, and
       carries aria-current in markup — never colour alone. */
    .cyf-student-nav-link.cyf-is-active {
      color: var(--cyf-primary);
      background-color: var(--cyf-primary-subtle);
      font-weight: var(--cyf-weight-semibold);
    }

    @media (max-width: 640px) {
      .cyf-student-header {
        padding-inline: var(--cyf-space-4);
      }

      .cyf-student-header-brand {
        gap: var(--cyf-space-3);
      }
    }
  `,
})
export class StudentHeaderComponent {
  private authApi = inject(AuthApiService);
  private router = inject(Router);

  protected loggingOut = signal(false);

  /**
   * Whether to offer navigation.
   *
   * Set to false on the profile form when the profile is not finished yet: the
   * two pages it could lead to are both gated behind finishing that form, and
   * links that immediately bounce back read as the product being broken.
   */
  showNav = input(true);

  protected readonly navItems = [
    { path: STUDENT_HOME, labelKey: 'nav.welcome', icon: 'fa-solid fa-house' },
    { path: STUDENT_BATCHES, labelKey: 'nav.myBatches', icon: 'fa-solid fa-layer-group' },
    { path: STUDENT_PROFILE, labelKey: 'nav.myProfile', icon: 'fa-solid fa-user' },
  ] as const;

  protected logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);

    this.authApi
      .logout()
      .pipe(finalize(() => this.loggingOut.set(false)))
      .subscribe({
        // `logout()` clears local state either way, so both paths land on the
        // Student sign-in page rather than the Admin one.
        next: () => this.router.navigate([STUDENT_SIGN_IN]),
        error: () => this.router.navigate([STUDENT_SIGN_IN]),
      });
  }
}
