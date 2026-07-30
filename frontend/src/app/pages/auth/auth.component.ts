import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { AuthLayoutComponent } from '../../components/layout/auth-layout.component';
import { BrandMarkComponent } from '../../components/shared/brand-mark.component';
import { LoginResponse } from '../../models/User';
import { AuthApiService } from '../../services/dataService/user-service';
import { SessionService } from '../../services/session.service';
import { AuthErrorKey, mapAuthError } from '../../utils/auth-error';

/**
 * Admin sign-in.
 *
 * Security behaviour is unchanged from Checkpoint 1 — same endpoint, same
 * session handling, same guards. This checkpoint replaces the presentation and
 * adds the states the previous page lacked:
 *
 *  - a translated inline error panel instead of a toast built from raw server
 *    text (invalid credentials / not permitted / rate limited / unavailable);
 *  - an accessible password visibility toggle;
 *  - re-entrancy protection so Enter cannot submit twice;
 *  - `autocomplete` hints and proper label association.
 */
@Component({
  selector: 'app-auth',
  imports: [
    TranslateModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    AuthLayoutComponent,
    BrandMarkComponent,
    AlertComponent,
  ],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthComponent {
  private authApi = inject(AuthApiService);
  private sessionService = inject(SessionService);
  private router = inject(Router);

  protected loading = signal(false);
  protected username = signal('');
  protected password = signal('');
  protected passwordVisible = signal(false);

  /** Translation key for the current failure, or null when there is none. */
  protected errorKey = signal<AuthErrorKey | null>(null);

  /** Set when the user submits an incomplete form. */
  protected missingFields = signal(false);

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  /** Clear a stale failure as soon as the user edits either field. */
  protected onFieldInput(): void {
    if (this.errorKey()) this.errorKey.set(null);
    if (this.missingFields()) this.missingFields.set(false);
  }

  protected login(): void {
    // Re-entrancy guard: the submit button is disabled while loading, but a
    // second Enter keypress can still reach the form handler.
    if (this.loading()) return;

    const username = this.username().trim();
    const password = this.password();

    if (!username || !password) {
      this.missingFields.set(true);
      this.errorKey.set(null);
      return;
    }

    this.missingFields.set(false);
    this.errorKey.set(null);
    this.loading.set(true);

    this.authApi
      .login({ username, password })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res: LoginResponse) => {
          if (!res.sessionToken) {
            this.errorKey.set('auth.errors.unexpected');
            return;
          }
          this.sessionService.saveSession(res, res.sessionToken);
          this.router.navigate(['/']);
        },
        error: (error: unknown) => {
          // Only a mapped translation key ever reaches the template.
          this.errorKey.set(mapAuthError(error));
        },
      });
  }
}
