import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { AuthLayoutComponent } from '../../components/layout/auth-layout.component';
import { BrandMarkComponent } from '../../components/shared/brand-mark.component';
import { LoginResponse } from '../../models/User';
import { ChangeLangService } from '../../services/change-lang.service';
import { GoogleIdentityService } from '../../services/google-identity.service';
import { StudentAuthApiService } from '../../services/dataService/student-auth-service';
import { SessionService } from '../../services/session.service';
import { STUDENT_HOME } from '../../guards/home-route';
import { GoogleAuthErrorKey, mapGoogleAuthError } from '../../utils/google-auth-error';

/**
 * Student sign-in with Google.
 *
 * The page's structure, copy, and styling are unchanged from Checkpoint 2A; what
 * changed is that the Google action now works. The states it can be in:
 *
 *   loadingSdk    Google's library is being fetched
 *   ready         Google's button is rendered and can be used
 *   authenticating a credential arrived and is being verified by the backend
 *   redirecting   verification succeeded; the router is moving to /student/welcome
 *   notConfigured no Client ID is configured for this deployment
 *   unavailable   Google's library could not be loaded at all
 *
 * plus a translated failure message for a cancelled sign-in, an unverified
 * credential, an unverified email, an ineligible account, a rate limit, and an
 * unreachable backend.
 *
 * Two rules hold throughout:
 *   - **the credential never leaves this call chain** — it is handed straight to
 *     the API service, never stored, never logged, never put in a URL;
 *   - **no server or Google text is ever rendered** — only translated keys
 *     chosen from the backend's stable error codes.
 *
 * There is still no email, username, password, signup, reset, or invitation-token
 * field here: Students authenticate only through Google, and an invitation is
 * required only to join a Batch.
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
export class StudentAuthComponent implements AfterViewInit {
  private googleIdentity = inject(GoogleIdentityService);
  private studentAuthApi = inject(StudentAuthApiService);
  private sessionService = inject(SessionService);
  private langService = inject(ChangeLangService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);

  /** Host for Google's own rendered button. */
  private googleButtonHost = viewChild<ElementRef<HTMLElement>>('googleButtonHost');

  /** Where the Google library has got to. */
  protected sdkState = this.googleIdentity.state;

  /** True while the backend is verifying a credential. */
  protected authenticating = signal(false);

  /** True once sign-in succeeded and navigation has been requested. */
  protected redirecting = signal(false);

  /** Translation key for the current failure, or null when there is none. */
  protected errorKey = signal<GoogleAuthErrorKey | null>(null);

  /** True when this deployment has no Google Client ID. */
  protected notConfigured = computed(() => this.sdkState() === 'notConfigured');

  /** True when Google's library could not be loaded. */
  protected unavailable = computed(() => this.sdkState() === 'unavailable');

  /** True while Google's library is loading. */
  protected loadingSdk = computed(
    () => this.sdkState() === 'idle' || this.sdkState() === 'loading',
  );

  /** True when Google's button is usable. */
  protected googleReady = computed(() => this.sdkState() === 'ready');

  /**
   * True when the page is busy. Used to disable the fallback control and to
   * dim Google's button, so a second sign-in cannot be started on top of one
   * already in flight.
   */
  protected busy = computed(() => this.authenticating() || this.redirecting());

  /** The language Google's button was last built for. */
  private appliedLocale: string | null = null;

  /** True once the button host exists in the DOM. */
  private viewReady = false;

  constructor() {
    // Switching language must rebuild Google's button: its text is fixed when
    // Google's script loads, so our own copy would flip while the button stayed
    // in the previous language.
    effect(() => {
      const lang = this.langService.currentLang();
      if (!this.viewReady || this.appliedLocale === lang) return;
      void this.setUpGoogle(lang);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewReady = true;
    await this.setUpGoogle(this.langService.currentLang());
  }

  /**
   * Load Google's library for a language and render its button.
   *
   * The locale comes from `ChangeLangService`, this application's single source
   * of truth for language — it is set during bootstrap, before any route
   * activates. Reading `TranslateService.getCurrentLang()` here instead produced
   * an empty locale, and a real browser then rendered a **Dutch** button on an
   * English page.
   */
  private async setUpGoogle(locale: string): Promise<void> {
    this.appliedLocale = locale;

    const ready = await this.googleIdentity.initialize(
      (credential) => this.onCredential(credential),
      locale,
    );

    if (ready) {
      const host = this.googleButtonHost()?.nativeElement;
      if (host) this.googleIdentity.renderButton(host, locale);
    }

    // The awaited work resolved outside Angular's change detection.
    this.changeDetector.markForCheck();
  }

  /**
   * Handle a credential returned by Google.
   *
   * Public so a test can drive the flow without loading Google's library; it is
   * never wired to a template event — only Google's callback reaches it.
   */
  onCredential(credential: string): void {
    // Re-entrancy guard: Google can fire again while a request is in flight.
    if (this.busy()) return;

    if (!credential) {
      this.errorKey.set('auth.student.errors.cancelled');
      return;
    }

    this.errorKey.set(null);
    this.authenticating.set(true);

    this.studentAuthApi
      .loginWithGoogle(credential)
      .pipe(finalize(() => this.authenticating.set(false)))
      .subscribe({
        next: (response: LoginResponse) => {
          if (!response?.sessionToken) {
            this.errorKey.set('auth.student.errors.unexpected');
            return;
          }
          this.sessionService.saveSession(response, response.sessionToken);
          this.redirecting.set(true);
          this.router.navigate([STUDENT_HOME]);
        },
        error: (error: unknown) => {
          // Only a mapped translation key ever reaches the template.
          this.errorKey.set(mapGoogleAuthError(error));
        },
      });
  }

  /**
   * Google dismissed or cancelled the prompt without issuing a credential.
   *
   * Public for the same reason as `onCredential`.
   */
  onDismissed(): void {
    if (this.busy()) return;
    this.errorKey.set('auth.student.errors.cancelled');
  }
}
