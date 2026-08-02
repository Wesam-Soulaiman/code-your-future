import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { BrandMarkComponent } from '../../components/shared/brand-mark.component';
import { LanguageSwitchComponent } from '../../components/shared/language-switch.component';
import { AppRole } from '../../config/user-roles';
import { ADMIN_HOME, STUDENT_PROFILE, STUDENT_SIGN_IN } from '../../guards/home-route';
import { InvitationPreview, StudentBatch } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { SessionService } from '../../services/session.service';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDate } from '../../utils/calendar-date';
import { clearInvitation, rememberInvitation } from '../../utils/invitation-intent';

/** What the page is currently asking the person to do. */
type JoinStage =
  | 'loading'
  | 'unusable'
  | 'signIn'
  | 'completeProfile'
  | 'ready'
  | 'joined'
  | 'alreadyJoined'
  | 'notEligible';

/**
 * The public invitation landing page.
 *
 * Reached by opening a link or scanning a QR code, by anybody — signed in or
 * not. It is the one page in the product that a Visitor can open and see real
 * product content on, so what it shows is deliberately the smallest thing that
 * lets somebody recognise what they were invited to.
 *
 * ── One page, six audiences ─────────────────────────────────────────────────
 * The same URL has to work for a Visitor, a signed-in Student with a finished
 * profile, one without, an Admin who clicked the wrong link, somebody whose
 * link has expired, and somebody who already joined. Rather than redirecting
 * each of them somewhere else and losing the thread, the page **stays** and
 * changes what it asks for. The invitation is remembered before any navigation,
 * so signing in or finishing a profile comes back here.
 *
 * ── An invitation is only ever needed to join ───────────────────────────────
 * Nothing on this page gates signing in or completing a profile — those are
 * offered as steps *towards* joining, and a Student who abandons the invitation
 * keeps their account and their profile.
 */
@Component({
  selector: 'app-join',
  imports: [
    TranslateModule,
    ButtonModule,
    AlertComponent,
    BrandMarkComponent,
    LanguageSwitchComponent,
  ],
  templateUrl: './join.component.html',
  styleUrl: './join.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private langService = inject(ChangeLangService);
  protected session = inject(SessionService);

  /** The token from the route. Held in memory; never written to a log. */
  private token = signal<string>('');

  protected preview = signal<InvitationPreview | null>(null);
  protected joinedBatch = signal<StudentBatch | null>(null);

  /**
   * True when the redemption found an existing membership.
   *
   * Not a failure, and worth saying out loud: somebody who scans the same QR
   * code twice should be told they are already in, not congratulated on
   * joining again as if the second scan did something.
   */
  protected alreadyEnrolled = signal(false);
  protected loading = signal(true);
  protected joining = signal(false);
  protected errorKey = signal<BatchErrorKey | null>(null);

  /** True once the preview call has failed outright, rather than said "no". */
  protected unreachable = signal(false);

  protected batch = computed(() => this.preview()?.batch ?? null);

  // Read through the language signal, so switching language re-renders the
  // dates rather than leaving them in the language the page loaded in.
  protected startDate = computed(() =>
    formatCalendarDate(this.batch()?.startDate, this.langService.currentLang()),
  );
  protected endDate = computed(() =>
    formatCalendarDate(this.batch()?.endDate, this.langService.currentLang()),
  );

  /**
   * What to ask for next.
   *
   * Ordered by what blocks what: an unusable link is the end of the road
   * whoever is holding it, an Admin cannot join whatever their profile says,
   * and a profile has to be finished before a membership can mean anything.
   */
  protected stage = computed<JoinStage>(() => {
    if (this.loading()) return 'loading';
    if (this.unreachable()) return 'unusable';

    const preview = this.preview();
    if (!preview) return 'unusable';
    if (this.joinedBatch()) return this.alreadyEnrolled() ? 'alreadyJoined' : 'joined';
    if (!preview.joinable) return 'unusable';

    if (!this.session.isLoggedIn()) return 'signIn';

    // An Admin holding a join link opened the wrong thing. Told plainly rather
    // than shown a Join button that would fail.
    if (this.session.roles().includes(AppRole.ADMIN)) return 'notEligible';
    if (!this.session.roles().includes(AppRole.STUDENT)) return 'notEligible';

    if (!this.session.profileComplete()) return 'completeProfile';
    return 'ready';
  });

  /** The stable reason a link cannot be used, as a translation key. */
  protected unusableKey = computed<BatchErrorKey>(() => {
    if (this.unreachable()) return 'batch.errors.unavailable';
    const reason = this.preview()?.reason;
    switch (reason) {
      case 'INVITATION_EXPIRED':
        return 'join.errors.expired';
      case 'INVITATION_REVOKED':
        return 'join.errors.revoked';
      case 'INVITATION_REPLACED':
        return 'join.errors.replaced';
      case 'BATCH_NOT_ACTIVE':
        return 'join.errors.notActive';
      default:
        return 'join.errors.invalid';
    }
  });

  constructor() {
    const token = String(this.route.snapshot.paramMap.get('token') ?? '');
    this.token.set(token);
    // Remembered before anything can navigate away, so signing in or finishing
    // a profile returns here rather than to a generic landing page.
    rememberInvitation(token);
    this.load(token);
  }

  private load(token: string): void {
    this.batchApi
      .previewInvitation(token)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          // A link that can never work is not worth carrying through a sign-in.
          if (!preview.joinable) clearInvitation();
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.unreachable.set(true);
          this.errorKey.set(mapBatchError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Send a Visitor to sign in. The invitation is already remembered. */
  protected signIn(): void {
    this.router.navigate([STUDENT_SIGN_IN]);
  }

  /** Send an incomplete Student to the form. It returns here when saved. */
  protected completeProfile(): void {
    this.router.navigate([STUDENT_PROFILE]);
  }

  protected goToDashboard(): void {
    clearInvitation();
    this.router.navigate([ADMIN_HOME]);
  }

  /** Give up on this invitation. Clears the intent so it stops following them. */
  protected dismiss(): void {
    clearInvitation();
    this.router.navigate([this.session.isLoggedIn() ? '/student/batches' : STUDENT_SIGN_IN]);
  }

  /**
   * Join.
   *
   * Guarded against a double tap, though the backend is idempotent anyway: a
   * second redemption returns the existing membership rather than failing, so
   * the worst a race can do is show the same success twice.
   */
  protected join(): void {
    if (this.joining()) return;

    this.joining.set(true);
    this.errorKey.set(null);

    this.batchApi
      .joinBatch(this.token())
      .pipe(finalize(() => this.joining.set(false)))
      .subscribe({
        next: (result) => {
          this.joinedBatch.set(result.batch);
          this.alreadyEnrolled.set(result.alreadyEnrolled);
          // The invitation has done its job.
          clearInvitation();
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          const failure = mapBatchError(error);
          this.errorKey.set(failure.key);
          // A link that has since been rotated, revoked, or expired stops being
          // worth carrying — re-previewing keeps the page honest about why.
          if (failure.code && failure.code.startsWith('INVITATION_')) {
            clearInvitation();
            this.loading.set(true);
            this.load(this.token());
          }
          this.changeDetector.markForCheck();
        },
      });
  }

  protected openMyBatches(): void {
    this.router.navigate(['/student/batches']);
  }
}
