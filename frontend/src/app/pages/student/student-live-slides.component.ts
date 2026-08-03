import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { StudentLiveState } from '../../models/LiveSlides';
import { LiveSessionPollService } from '../../services/live-session-poll.service';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { formatCalendarDate } from '../../utils/calendar-date';
import { ChangeLangService } from '../../services/change-lang.service';
import {
  LIVE_LIMITS,
  SESSION_STATUS,
  SLIDE_TYPE,
  isMultiSelect,
  isTextAnswer,
  needsOptions,
  slideIcon,
} from '../../utils/live-slides-constants';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';

/**
 * The Live Slides tab on a Student's Batch ⟨CP6⟩.
 *
 * ── An answer is local until Submit ─────────────────────────────────────────
 * What is typed here goes nowhere until the confirmation is accepted. The Admin
 * sees no draft text and no typing indicator, because none is ever sent — this
 * is a property of the code, not a setting.
 *
 * ── And then it is permanent ────────────────────────────────────────────────
 * The confirmation says so in plain words before anything is sent, because
 * afterwards there is no edit, no delete, and no way back. On success the form
 * is replaced by a read-only view of what was submitted.
 *
 * ── Refreshing and reconnecting are the same thing ──────────────────────────
 * Every poll returns the authoritative state, including whether this Student
 * already answered. So a refresh, a reconnect, and a second device all show the
 * same read-only answer without any local storage to go stale.
 */
@Component({
  selector: 'cyf-student-live-slides',
  imports: [TranslateModule, FormsModule, ButtonModule, DialogModule, AlertComponent],
  templateUrl: './student-live-slides.component.html',
  providers: [LiveSessionPollService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:fullscreenchange)': 'onFullscreenChange()',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class StudentLiveSlidesComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private document = inject(DOCUMENT);
  private destroyRef = inject(DestroyRef);
  protected poll = inject(LiveSessionPollService);
  protected langService = inject(ChangeLangService);

  batchId = input.required<string>();

  protected readonly limits = LIVE_LIMITS;
  protected readonly SLIDE_TYPE = SLIDE_TYPE;
  protected readonly SESSION_STATUS = SESSION_STATUS;
  protected readonly slideIcon = slideIcon;
  protected readonly needsOptions = needsOptions;
  protected readonly isTextAnswer = isTextAnswer;
  protected readonly isMultiSelect = isMultiSelect;

  protected state = signal<StudentLiveState | null>(null);
  protected loading = signal(true);
  protected busy = signal(false);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);

  /**
   * Whether this Student has entered the live view.
   *
   * A view transition only. Nothing is recorded, no attendance exists, and the
   * server is not told — because opening a page is not the same as being here.
   */
  protected entered = signal(false);
  protected confirmSubmit = signal(false);
  protected fullscreen = signal(false);

  // ── The local answer, never sent until Submit ─────────────────────────────
  protected draftText = signal('');
  protected draftChoice = signal<string[]>([]);

  protected session = computed(() => this.state()?.session);
  protected slide = computed(() => this.state()?.currentSlide);
  protected myResponse = computed(() => this.state()?.myResponse);

  protected sessionDate = computed(() =>
    formatCalendarDate(this.session()?.sessionDate, this.langService.currentLang()),
  );

  protected isLive = computed(() => this.session()?.status === SESSION_STATUS.LIVE);
  protected isCompleted = computed(() => this.session()?.status === SESSION_STATUS.COMPLETED);
  protected isQuestion = computed(() => this.slide()?.type === SLIDE_TYPE.QUESTION);
  protected locked = computed(() => this.slide()?.locked === true);

  /** The form shows only when there is something open to answer. */
  protected canAnswer = computed(
    () => this.isLive() && this.isQuestion() && !this.locked() && !this.myResponse(),
  );

  /** Whether the local answer is complete enough to send. */
  protected answerReady = computed(() => {
    const answerType = this.slide()?.answerType;
    if (isTextAnswer(answerType)) return this.draftText().trim().length > 0;
    if (needsOptions(answerType)) return this.draftChoice().length > 0;
    return false;
  });

  /** The answers a completed session shows back, in question order. */
  protected completedRows = computed(() => {
    const questions = this.state()?.questions ?? [];
    const mine = this.state()?.myResponses ?? [];
    return questions.map((question) => ({
      question,
      response: mine.find((response) => response.slideId === question.id),
    }));
  });

  constructor() {
    effect(() => {
      const id = this.batchId();
      if (!id) return;
      this.poll.start(
        () => this.api.getMyLiveState(id),
        (state) => {
          const previousSlide = this.slide()?.id;
          this.state.set(state);
          if (state.session?.status !== SESSION_STATUS.LIVE && this.fullscreen()) {
            this.exitFullscreen();
          }
          // A new Slide clears whatever was half-typed for the last one: it is
          // an answer to a question that is no longer being asked.
          if (state.currentSlide?.id !== previousSlide) {
            this.draftText.set('');
            this.draftChoice.set([]);
          }
          this.loading.set(false);
          this.changeDetector.markForCheck();
        },
      );
    });

    this.destroyRef.onDestroy(() => {
      if (this.fullscreen() && this.document.fullscreenElement) {
        void this.document.exitFullscreen().catch(() => undefined);
      }
    });
  }

  protected enter(): void {
    this.entered.set(true);
  }

  protected onEscape(): void {
    if (this.fullscreen()) this.exitFullscreen();
  }

  protected onFullscreenChange(): void {
    if (!this.document.fullscreenElement && this.fullscreen()) this.fullscreen.set(false);
  }

  protected toggleFullscreen(): void {
    if (this.fullscreen()) {
      this.exitFullscreen();
      return;
    }

    this.fullscreen.set(true);
    const root = this.document.documentElement;
    if (typeof root.requestFullscreen === 'function') {
      void root.requestFullscreen().catch(() => undefined);
    }
  }

  protected exitFullscreen(): void {
    this.fullscreen.set(false);
    if (this.document.fullscreenElement && typeof this.document.exitFullscreen === 'function') {
      void this.document.exitFullscreen().catch(() => undefined);
    }
  }

  protected toggleChoice(optionId: string): void {
    const multi = isMultiSelect(this.slide()?.answerType);
    this.draftChoice.update((chosen) => {
      if (!multi) return chosen[0] === optionId ? [] : [optionId];
      return chosen.includes(optionId)
        ? chosen.filter((id) => id !== optionId)
        : [...chosen, optionId];
    });
  }

  protected isChosen(optionId: string): boolean {
    return this.draftChoice().includes(optionId);
  }

  protected submit(): void {
    const session = this.session();
    const slide = this.slide();
    // Guarded rather than only disabled: a double tap must not send twice, and
    // the server's uniqueness index is the backstop rather than the first line.
    if (!session || !slide || this.busy() || !this.answerReady()) return;

    this.confirmSubmit.set(false);
    this.busy.set(true);
    this.errorKey.set(null);

    const answerType = slide.answerType;
    const answer = isTextAnswer(answerType)
      ? { textAnswer: this.draftText().trim() }
      : isMultiSelect(answerType)
        ? { selectedOptionIds: this.draftChoice() }
        : { selectedOptionId: this.draftChoice()[0] };

    this.api
      .submitResponse(session.id, slide.id, answer)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (result) => {
          // Whether this call created the answer or found one already there,
          // the outcome for this Student is the same: it is submitted.
          this.state.update((state) =>
            state ? { ...state, myResponse: result.myResponse } : state,
          );
          this.draftText.set('');
          this.draftChoice.set([]);
        },
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }
}
