import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { LiveSession, PresenterState } from '../../models/LiveSlides';
import { LiveSessionPollService } from '../../services/live-session-poll.service';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { SLIDE_TYPE, needsOptions, slideIcon } from '../../utils/live-slides-constants';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';

/**
 * Presenter Mode ⟨CP6⟩.
 *
 * ── The screen and the panel are one request ────────────────────────────────
 * `getPresenterState` returns the current Slide, the submitted answers, and the
 * counts together, polled on a timer. Splitting them would let the stage and
 * the panel disagree about which Question is on screen.
 *
 * ── Navigating away closes the Question ─────────────────────────────────────
 * Permanently, server-side, in the same operation as the move. When somebody
 * has not answered, this asks first — and says how many, and who — because
 * continuing is what records No Answer for them.
 *
 * ── Fullscreen stays inside the application ─────────────────────────────────
 * A fixed overlay rather than the Fullscreen API. The API hands the whole
 * screen to the browser and a presenter who cannot find the way back is stuck
 * in front of a room; Escape closes this and the exit control is always visible.
 */
@Component({
  selector: 'cyf-live-presenter',
  imports: [NgTemplateOutlet, TranslateModule, ButtonModule, DialogModule, AlertComponent],
  templateUrl: './live-presenter.component.html',
  providers: [LiveSessionPollService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LivePresenterComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected poll = inject(LiveSessionPollService);

  session = input.required<LiveSession>();
  sessionChanged = output<LiveSession>();

  protected readonly SLIDE_TYPE = SLIDE_TYPE;
  protected readonly slideIcon = slideIcon;

  protected state = signal<PresenterState | null>(null);
  protected busy = signal(false);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);

  protected fullscreen = signal(false);
  protected responsesVisible = signal(true);
  protected confirmLock = signal<'next' | 'previous' | null>(null);
  protected confirmEnd = signal(false);

  protected currentSlide = computed(() => this.state()?.currentSlide);
  protected isQuestion = computed(() => this.currentSlide()?.type === SLIDE_TYPE.QUESTION);
  protected showTally = computed(() => needsOptions(this.currentSlide()?.answerType));

  protected atStart = computed(() => (this.state()?.currentIndex ?? 0) === 0);
  protected atEnd = computed(() => {
    const state = this.state();
    return !state || state.currentIndex >= state.slideCount - 1;
  });

  /** Whether continuing would record No Answer for somebody. */
  protected hasUnanswered = computed(
    () => this.isQuestion() && !this.currentSlide()?.locked && (this.state()?.unanswered ?? 0) > 0,
  );

  constructor() {
    effect(() => {
      const id = this.session().id;
      if (!id) return;
      this.poll.start(
        () => this.api.getPresenterState(id),
        (state) => {
          this.state.set(state);
          this.changeDetector.markForCheck();
        },
      );
    });
  }

  /** Escape leaves fullscreen, which is what every other overlay does. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.fullscreen()) this.fullscreen.set(false);
  }

  protected requestMove(direction: 'next' | 'previous'): void {
    // Ask before locking, but only when it would cost somebody their answer.
    if (this.hasUnanswered()) {
      this.confirmLock.set(direction);
      return;
    }
    this.move(direction);
  }

  protected confirmAndMove(): void {
    const direction = this.confirmLock();
    this.confirmLock.set(null);
    if (direction) this.move(direction);
  }

  private move(direction: 'next' | 'previous'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);

    const request =
      direction === 'next'
        ? this.api.nextSlide(this.session().id)
        : this.api.previousSlide(this.session().id);

    request
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (state) => this.state.set(state),
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }

  protected endSession(): void {
    if (this.busy()) return;
    this.confirmEnd.set(false);
    this.busy.set(true);
    this.errorKey.set(null);

    this.api
      .endSession(this.session().id)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => {
          // The lecture is over; stop asking the server what is on screen.
          this.poll.stop();
          this.fullscreen.set(false);
          this.sessionChanged.emit(session);
        },
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }

  protected toggleResponses(): void {
    this.responsesVisible.update((visible) => !visible);
  }
}
