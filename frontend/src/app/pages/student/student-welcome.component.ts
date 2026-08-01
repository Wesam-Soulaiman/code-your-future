import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { BrandMarkComponent } from '../../components/shared/brand-mark.component';
import { LanguageSwitchComponent } from '../../components/shared/language-switch.component';
import { AuthApiService } from '../../services/dataService/user-service';
import { StudentProfileApiService } from '../../services/dataService/student-profile-service';
import { SessionService } from '../../services/session.service';
import { STUDENT_PROFILE, STUDENT_SIGN_IN } from '../../guards/home-route';

/**
 * The Student area — deliberately one page.
 *
 * Its only job is to prove the complete authentication flow: a Student who
 * signed in with Google lands here, the page survives a refresh, and logging out
 * invalidates the session.
 *
 * It shows nothing it cannot truthfully show. There is no Complete Profile form,
 * no completion percentage, no batch, no invitation, no task, no statistic, no
 * chart, and no navigation to anything that does not exist yet. Those arrive in
 * Checkpoint 4 and later; inventing a placeholder for them here would be a lie
 * the UI tells about the product.
 */
@Component({
  selector: 'app-student-welcome',
  imports: [TranslateModule, ButtonModule, BrandMarkComponent, LanguageSwitchComponent],
  templateUrl: './student-welcome.component.html',
  styleUrl: './student-welcome.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentWelcomeComponent {
  private authApi = inject(AuthApiService);
  private profileApi = inject(StudentProfileApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  protected sessionService = inject(SessionService);

  protected loggingOut = signal(false);

  /**
   * The name from the saved profile.
   *
   * Read once from the real profile rather than assumed: the Student may have
   * entered a name that differs from the one Google supplied, and this page
   * should greet them by the name they chose. Falls back to the session's
   * display name until the profile arrives, so the greeting is never empty.
   */
  private profileName = signal('');

  /**
   * The verified Google name, when Google supplied one. Empty otherwise — the
   * heading falls back to a greeting with no name rather than to an internal
   * identifier.
   */
  protected displayName = computed(
    () => this.profileName() || this.sessionService.userDisplayName(),
  );

  constructor() {
    // The page is only reachable with a complete profile, so this is a name,
    // not a guess.
    this.profileApi.getMyProfile().subscribe({
      next: (profile) => {
        this.profileName.set(profile.fullName ?? '');
        this.changeDetector.markForCheck();
      },
      // The session display name already covers this; nothing to interrupt for.
      error: () => undefined,
    });
  }

  /** Open the profile form for editing. */
  protected editProfile(): void {
    this.router.navigate([STUDENT_PROFILE]);
  }

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
