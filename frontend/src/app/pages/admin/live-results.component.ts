import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  LiveSession,
  ResultsByQuestion,
  ResultsByStudent,
  StudentResultRow,
} from '../../models/LiveSlides';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { needsOptions } from '../../utils/live-slides-constants';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';

type ResultsView = 'student' | 'question';

/**
 * A completed session's results ⟨CP6⟩.
 *
 * ── Two views of the same answers ───────────────────────────────────────────
 * By Student answers "what did this person say"; by Question answers "what did
 * the room say". Both are read-only: there is no edit, no delete, no score, no
 * correctness, and no feedback anywhere on this screen, because there is no
 * such operation behind it.
 *
 * ── Everybody enrolled appears ──────────────────────────────────────────────
 * Including Students who answered nothing. Their missing answers are **derived**
 * — an enrolled Student, a locked Question, and no response — and shown as No
 * Answer. Nothing was written to represent their silence.
 */
@Component({
  selector: 'cyf-live-results',
  imports: [TranslateModule, ButtonModule, DialogModule, AlertComponent],
  templateUrl: './live-results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveResultsComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);

  session = input.required<LiveSession>();
  readOnly = input(false);
  duplicated = output<LiveSession>();

  protected readonly needsOptions = needsOptions;

  protected view = signal<ResultsView>('student');
  protected byStudent = signal<ResultsByStudent | null>(null);
  protected byQuestion = signal<ResultsByQuestion | null>(null);
  protected openStudent = signal<StudentResultRow | null>(null);

  protected loading = signal(true);
  protected busy = signal(false);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);

  protected participantCount = computed(() => this.byStudent()?.participantCount ?? 0);
  protected studentCount = computed(() => this.byStudent()?.studentCount ?? 0);
  protected questionCount = computed(() => this.byStudent()?.questionCount ?? 0);
  protected responseCount = computed(() => this.byStudent()?.responseCount ?? 0);

  constructor() {
    effect(() => {
      const id = this.session().id;
      if (id) this.load(id);
    });
  }

  private load(sessionId: string): void {
    this.loading.set(true);
    this.errorKey.set(null);

    // Both views are fetched together: switching between them is a tab, and a
    // tab that has to wait for a request feels broken.
    this.api.resultsByStudent(sessionId).subscribe({
      next: (result) => {
        this.byStudent.set(result);
        this.changeDetector.markForCheck();
      },
      error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
    });

    this.api
      .resultsByQuestion(sessionId)
      .pipe(
        finalize(() => {
          this.loading.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (result) => this.byQuestion.set(result),
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }

  protected duplicate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);

    this.api
      .duplicateSession(this.session().id)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => this.duplicated.emit(session),
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }
}
