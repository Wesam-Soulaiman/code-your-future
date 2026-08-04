import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { TaskHistoryRow } from '../../models/BatchTask';
import { ChangeLangService } from '../../services/change-lang.service';
import { TaskApiService } from '../../services/dataService/task-service';
import { formatInstant } from '../../utils/calendar-date';
import { SUBMISSION_STATUS, TASK_TYPE } from '../../utils/task-constants';
import { TaskErrorKey, mapTaskError } from '../../utils/task-error';

/** One history row with its dates already rendered. */
interface HistoryRow {
  row: TaskHistoryRow;
  deadline: string;
  submitted: string;
  tone: string;
}

const PAGE_SIZE = 10;

/**
 * One Student's Task submissions, on their Admin profile ⟨CP7⟩.
 *
 * Every Batch they have ever been in, newest first. Read from the
 * `studentProfile` index on `TaskSubmission` rather than from an array on the
 * profile — the same decision, for the same reason, as the Live Slides history
 * beside it: a profile row that grew with every submission would eventually
 * stop loading.
 *
 * ── Read-only, and it has to look read-only ─────────────────────────────────
 * There is no Edit, no Delete, no Score, and no Feedback anywhere on this
 * table, because there is no operation behind any of them. A control that
 * existed here would be a control that cannot work.
 *
 * The links and notes are deliberately absent too: this is a record of *what
 * happened*, and the work itself is read from the Batch's own Tasks tab, where
 * the Admin already has the context to make sense of it.
 */
@Component({
  selector: 'cyf-student-task-history',
  imports: [TranslateModule, ButtonModule, AlertComponent],
  templateUrl: './student-task-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentTaskHistoryComponent {
  private api = inject(TaskApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  studentId = input.required<string>();

  protected readonly taskType = TASK_TYPE;

  protected loading = signal(false);
  protected errorKey = signal<TaskErrorKey | null>(null);
  protected items = signal<TaskHistoryRow[]>([]);
  protected total = signal(0);

  constructor() {
    effect(() => {
      const studentId = this.studentId();
      if (studentId) {
        this.items.set([]);
        this.total.set(0);
        this.loadPage(studentId, 0);
      }
    });
  }

  protected rows = computed<HistoryRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.items().map((row) => ({
      row,
      deadline: formatInstant(row.deadline, lang),
      submitted: formatInstant(row.submittedAt ?? row.updatedAt, lang),
      tone: row.submissionStatus === SUBMISSION_STATUS.SUBMITTED ? 'success' : 'warning',
    }));
  });

  protected isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  protected hasMore = computed(() => this.items().length < this.total());

  private loadPage(studentId: string, skip: number): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .studentTaskHistory(studentId, { skip, limit: PAGE_SIZE })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          // Appended rather than replaced, so "load more" keeps what is already
          // on screen instead of making the reader find their place again.
          this.items.update((current) => (skip === 0 ? page.items : [...current, ...page.items]));
          this.total.set(page.total);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapTaskError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected loadMore(): void {
    if (this.loading() || !this.hasMore()) return;
    this.loadPage(this.studentId(), this.items().length);
  }
}
