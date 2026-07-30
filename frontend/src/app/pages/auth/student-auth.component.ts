import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AlertComponent } from '../../components/shared/alert.component';
import { AuthLayoutComponent } from '../../components/layout/auth-layout.component';
import { BrandMarkComponent } from '../../components/shared/brand-mark.component';

/**
 * Student sign-in — **presentation only**.
 *
 * Google OAuth is Checkpoint 3. This component deliberately has:
 *   - no injected auth service,
 *   - no HTTP call,
 *   - no router navigation,
 *   - no session write,
 *   - no click handler on the Google button at all.
 *
 * The Google button is a `<button disabled>`, so it cannot be activated by
 * mouse, keyboard, or programmatic click, and it exposes correct disabled
 * semantics to assistive technology. A translated informational panel beside it
 * explains that Student sign-in arrives in the next checkpoint, so the disabled
 * control is never unexplained.
 *
 * There is no email, username, password, signup, reset, or invitation-token
 * field here by design — Students authenticate only through Google, and an
 * invitation is required only to join a Batch, never to sign in.
 */
@Component({
  selector: 'app-student-auth',
  imports: [
    TranslateModule,
    RouterLink,
    AuthLayoutComponent,
    BrandMarkComponent,
    AlertComponent,
  ],
  templateUrl: './student-auth.component.html',
  styleUrl: './student-auth.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentAuthComponent {
  /**
   * Google sign-in is not available yet. Exposed as a readonly flag so the
   * template and the tests share one source of truth, and so enabling it in
   * Checkpoint 3 is a single deliberate change.
   */
  protected readonly googleSignInAvailable = false;
}
