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

import { StudentProfileApiService } from '../../services/dataService/student-profile-service';
import { SessionService } from '../../services/session.service';
import { STUDENT_PROFILE } from '../../guards/home-route';

/**
 * The Student's landing page.
 *
 * It greets a signed-in Student by the name on their profile and does nothing
 * else of substance. Sign-out, language, and navigation all moved into
 * `cyf-student-header` in Checkpoint 4, when the Student area gained a second
 * page and one header had to serve both.
 *
 * It still shows nothing it cannot truthfully show: no completion percentage,
 * no statistic, no chart, and no link to a feature that does not exist. Batches
 * are reachable from the header because they are real now — everything from
 * Resources onward is not, and a placeholder for it would be a lie the UI tells
 * about the product.
 */
@Component({
  selector: 'app-student-welcome',
  imports: [TranslateModule, ButtonModule],
  templateUrl: './student-welcome.component.html',
  styleUrl: './student-welcome.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentWelcomeComponent {
  private profileApi = inject(StudentProfileApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  protected sessionService = inject(SessionService);

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
}
