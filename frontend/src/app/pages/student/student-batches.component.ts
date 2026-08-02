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

import { AlertComponent } from '../../components/shared/alert.component';
import { StudentBatch } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { BATCH_STATUS_TONE, BatchStatus } from '../../utils/batch-constants';
import { formatCalendarDate } from '../../utils/calendar-date';

/** A Batch with its dates already rendered for the current language. */
interface BatchRow {
  batch: StudentBatch;
  startDate: string;
  endDate: string;
  tone: string;
}

/**
 * My Batches — everything a Student can see about their own membership.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No other Student appears anywhere on this page, and no count of them. A
 * Student sees the Batches they belong to and nothing about who else is in the
 * room; the roster is an Admin view, and the API a Student can reach does not
 * return one. That is a backend guarantee, not a rendering choice — but the page
 * is built so that it never asks.
 *
 * ── Empty is a normal state, not an error ───────────────────────────────────
 * Most Students will land here with nothing, because joining requires somebody
 * to send them a link. The empty state says exactly that, rather than showing a
 * spinner that never resolves or an error for a situation that is not wrong.
 */
@Component({
  selector: 'app-student-batches',
  imports: [TranslateModule, ButtonModule, AlertComponent],
  templateUrl: './student-batches.component.html',
  styleUrl: './student-batches.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentBatchesComponent {
  private batchApi = inject(BatchApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);
  private batches = signal<StudentBatch[]>([]);

  /**
   * The rows, with dates formatted for the language that is active *now*.
   *
   * Reading the language signal here rather than formatting once on load means
   * switching language re-renders the dates instead of leaving them in the
   * language the page happened to open in.
   */
  protected rows = computed<BatchRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.batches().map((batch) => ({
      batch,
      startDate: formatCalendarDate(batch.startDate, lang),
      endDate: formatCalendarDate(batch.endDate, lang),
      tone: BATCH_STATUS_TONE[batch.status as BatchStatus] ?? 'neutral',
    }));
  });

  protected isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.batchApi
      .listMyBatches()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (result) => {
          this.batches.set(result.items ?? []);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected open(batch: StudentBatch): void {
    this.router.navigate(['/student/batches', batch.id]);
  }
}
