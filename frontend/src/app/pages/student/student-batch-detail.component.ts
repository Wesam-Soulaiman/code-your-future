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
import { STUDENT_BATCHES } from '../../guards/home-route';
import { StudentBatch } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { BATCH_STATUS_TONE, BatchStatus } from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDate, formatInstant } from '../../utils/calendar-date';
import { StudentBatchResourcesComponent } from './student-batch-resources.component';
import { StudentLiveSlidesComponent } from './student-live-slides.component';
import { StudentTasksComponent } from './student-tasks.component';

/** Three tabs: what the Batch is, what was shared, and what is happening. */
type StudentBatchTab = 'overview' | 'resources' | 'live-slides' | 'tasks';

/**
 * One Batch, as the Student who belongs to it sees it.
 *
 * ── A membership, not a directory ───────────────────────────────────────────
 * This page shows the Batch's own details and the date this Student joined. It
 * shows no other Student, no count of them, no trainer, no schedule, and no
 * score — partly because none of those exist yet, and partly because the roster
 * is not a Student's to see. The endpoint behind this page cannot return one.
 *
 * ── Not found and not yours are the same answer ─────────────────────────────
 * Asking for a Batch this Student does not belong to fails exactly as asking
 * for one that does not exist does. That is decided server-side; the page
 * simply renders the one message, so nothing here can leak the difference by
 * wording it differently.
 */
@Component({
  selector: 'app-student-batch-detail',
  imports: [
    TranslateModule,
    ButtonModule,
    AlertComponent,
    StudentBatchResourcesComponent,
    StudentLiveSlidesComponent,
    StudentTasksComponent,
  ],
  templateUrl: './student-batch-detail.component.html',
  styleUrl: './student-batch-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentBatchDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  protected batchId = signal('');
  protected activeTab = signal<StudentBatchTab>('overview');

  protected readonly tabs: { id: StudentBatchTab; labelKey: string }[] = [
    { id: 'overview', labelKey: 'student.batches.tabs.overview' },
    { id: 'resources', labelKey: 'student.batches.tabs.resources' },
    { id: 'live-slides', labelKey: 'student.batches.tabs.liveSlides' },
    { id: 'tasks', labelKey: 'student.batches.tabs.tasks' },
  ];

  protected batch = signal<StudentBatch | null>(null);
  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);

  protected startDate = computed(() =>
    formatCalendarDate(this.batch()?.startDate, this.langService.currentLang()),
  );
  protected endDate = computed(() =>
    formatCalendarDate(this.batch()?.endDate, this.langService.currentLang()),
  );

  /** The moment this Student joined — an instant, so it follows their zone. */
  protected joinedAt = computed(() =>
    formatInstant(this.batch()?.joinedAt, this.langService.currentLang()),
  );

  protected tone = computed(
    () => BATCH_STATUS_TONE[this.batch()?.status as BatchStatus] ?? 'neutral',
  );

  constructor() {
    this.batchId.set(String(this.route.snapshot.paramMap.get('batchId') ?? ''));
    this.load();
  }

  protected load(): void {
    const id = this.batchId();
    if (!id) {
      this.loading.set(false);
      this.errorKey.set('batch.errors.notFound');
      return;
    }

    this.loading.set(true);
    this.errorKey.set(null);

    this.batchApi
      .getMyBatch(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (batch) => {
          this.batch.set(batch);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected selectTab(tab: StudentBatchTab): void {
    this.activeTab.set(tab);
  }

  protected back(): void {
    this.router.navigate([STUDENT_BATCHES]);
  }
}
