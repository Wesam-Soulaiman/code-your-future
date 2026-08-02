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
import { ADMIN_BATCHES, ADMIN_STUDENTS } from '../../guards/home-route';
import { AdminStudentSummary, StudentBatch } from '../../models/Batch';
import { catalogItemName } from '../../models/ProfileCatalogItem';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { BATCH_STATUS_TONE, BatchStatus } from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDate } from '../../utils/calendar-date';

/** A Batch this Student belongs to, with its dates rendered. */
interface BatchRow {
  batch: StudentBatch;
  startDate: string;
  tone: string;
}

/**
 * One Student, read-only.
 *
 * ── Read-only means the page has no verbs ───────────────────────────────────
 * There is no edit, no delete, no role change, no password reset, no
 * impersonation, no note, no rating, and no export. The only interactive things
 * on the page are links to Batches. This is not enforcement — the API has no
 * write operation an Admin could reach for a Student — but the page must not
 * suggest otherwise.
 *
 * ── What is deliberately not shown ──────────────────────────────────────────
 * No phone number, no date of birth, no profile photo, no Google subject, no
 * internal username, no session data. The endpoint does not return any of them,
 * and this page could not display them if it wanted to. The verified email is
 * shown for one reason: two Students can have the same name, and an Admin about
 * to invite one of them needs to know which.
 */
@Component({
  selector: 'app-admin-student-detail',
  imports: [TranslateModule, ButtonModule, AlertComponent],
  templateUrl: './student-detail.component.html',
  styleUrl: './student-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStudentDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  private studentId = signal('');
  protected student = signal<AdminStudentSummary | null>(null);
  private batches = signal<StudentBatch[]>([]);
  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);

  protected city = computed(() => this.name(this.student()?.city));
  protected institution = computed(() => this.name(this.student()?.institution));
  protected major = computed(() => this.name(this.student()?.major));
  protected targetRole = computed(() => this.name(this.student()?.targetRole));

  protected rows = computed<BatchRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.batches().map((batch) => ({
      batch,
      startDate: formatCalendarDate(batch.startDate, lang),
      tone: BATCH_STATUS_TONE[batch.status as BatchStatus] ?? 'neutral',
    }));
  });

  constructor() {
    this.studentId.set(String(this.route.snapshot.paramMap.get('studentId') ?? ''));
    this.load();
  }

  protected load(): void {
    const id = this.studentId();
    if (!id) {
      this.loading.set(false);
      this.errorKey.set('batch.errors.notFound');
      return;
    }

    this.loading.set(true);
    this.errorKey.set(null);

    this.batchApi
      .adminGetStudent(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ student, batches }) => {
          this.student.set(student);
          this.batches.set(batches ?? []);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected back(): void {
    this.router.navigate([ADMIN_STUDENTS]);
  }

  protected openBatch(batch: StudentBatch): void {
    this.router.navigate([ADMIN_BATCHES, batch.id]);
  }

  /** A catalog item's name in the active language, or an empty string. */
  private name(item: Parameters<typeof catalogItemName>[0] | undefined): string {
    return item ? catalogItemName(item, this.langService.currentLang()) : '';
  }
}
