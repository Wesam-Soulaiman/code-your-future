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
import { DialogModule } from 'primeng/dialog';
import { Subject, debounceTime, finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AlertComponent } from '../../components/shared/alert.component';
import { ColTemplateDirective } from '../../components/shared/data-table/col-template.directive';
import { TableColumn } from '../../components/shared/data-table/data-table.component';
import { PageChangeEvent } from '../../components/shared/data-table/paginator.component';
import { RecordTableComponent } from '../../components/shared/record-table/record-table.component';
import { ADMIN_BATCHES, ADMIN_STUDENTS } from '../../guards/home-route';
import { AdminStudentSummary, Batch, InvitationStatus } from '../../models/Batch';
import { catalogItemName } from '../../models/ProfileCatalogItem';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import {
  BATCH_LIMITS,
  BATCH_PAGE,
  BATCH_STATUS,
  BATCH_STATUS_TONE,
  BATCH_TRANSITIONS,
  BatchStatus,
} from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDate, formatInstant } from '../../utils/calendar-date';
import { BatchResourcesComponent } from './batch-resources.component';
import { InvitationCardComponent } from './invitation-card.component';

/**
 * The four tabs. There is no fifth: nothing else exists yet to put in one.
 *
 * Resources joined in Checkpoint 5 and sits here rather than in the sidebar,
 * because a Resource has no meaning away from its Batch — a top-level
 * "Resources" item would be a list of files with nothing to say which cohort
 * each belongs to.
 */
type BatchTab = 'overview' | 'students' | 'invitation' | 'resources';

/** A roster row with its joined date already rendered. */
interface StudentRow {
  student: AdminStudentSummary;
  joinedAt: string;
  city: string;
  institution: string;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * One Batch, as its Admin sees it.
 *
 * Three tabs, because a Batch has exactly three things worth looking at: what
 * it is, who is in it, and how people get in. Anything else would be a tab
 * waiting for a feature that does not exist.
 *
 * ── Archiving is the end ────────────────────────────────────────────────────
 * It is irreversible and it makes the Batch read-only: no edits, no status
 * changes, no new invitations, no new members. That is a big enough thing to
 * ask twice, so it is confirmed in a dialog that says what it means rather than
 * asking "are you sure".
 *
 * ── The roster is a list of people, not a management screen ─────────────────
 * There is no way to remove a Student from a Batch, change their details, or
 * act on them from here. The endpoint returns an allow-listed summary — a name,
 * their verified email, their catalog selections, and when they joined — and
 * this page renders exactly that.
 */
@Component({
  selector: 'app-admin-batch-detail',
  imports: [
    TranslateModule,
    ButtonModule,
    DialogModule,
    AlertComponent,
    InvitationCardComponent,
    BatchResourcesComponent,
    RecordTableComponent,
    ColTemplateDirective,
  ],
  templateUrl: './batch-detail.component.html',
  styleUrl: './batch-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminBatchDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  protected readonly limits = BATCH_LIMITS;

  /** The roster columns. `header` is a translation key. */
  protected readonly studentColumns: TableColumn[] = [
    { field: 'name', header: 'admin.students.columns.name', template: 'name' },
    { field: 'email', header: 'admin.students.columns.email', template: 'email' },
    { field: 'city', header: 'admin.students.columns.city', template: 'city' },
    {
      field: 'institution',
      header: 'admin.students.columns.institution',
      template: 'institution',
    },
    { field: 'joinedAt', header: 'admin.batches.roster.joinedAt', template: 'joinedAt' },
  ];

  protected readonly tabs: { id: BatchTab; labelKey: string }[] = [
    { id: 'overview', labelKey: 'admin.batches.tabs.overview' },
    { id: 'students', labelKey: 'admin.batches.tabs.students' },
    { id: 'invitation', labelKey: 'admin.batches.tabs.invitation' },
    { id: 'resources', labelKey: 'admin.batches.tabs.resources' },
  ];

  protected batchId = signal('');
  protected activeTab = signal<BatchTab>('overview');

  protected batch = signal<Batch | null>(null);
  protected invitation = signal<InvitationStatus | null>(null);
  protected loading = signal(true);
  protected busy = signal(false);
  protected errorKey = signal<BatchErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);

  /** The archive confirmation. Null when closed. */
  protected confirmingArchive = signal(false);

  // ── Roster ────────────────────────────────────────────────────────────────
  private students = signal<AdminStudentSummary[]>([]);
  protected studentTotal = signal(0);

  /** Zero-based page and page size for the roster, driven by the paginator. */
  protected studentPage = signal(0);
  protected studentPageSize = signal<number>(BATCH_PAGE.defaultLimit);
  protected studentSearch = signal('');
  protected studentsLoading = signal(false);
  protected studentsErrorKey = signal<BatchErrorKey | null>(null);
  private studentsLoaded = signal(false);
  private studentSearchInput = new Subject<string>();

  // ── Derived ───────────────────────────────────────────────────────────────

  protected startDate = computed(() =>
    formatCalendarDate(this.batch()?.startDate, this.langService.currentLang()),
  );
  protected endDate = computed(() =>
    formatCalendarDate(this.batch()?.endDate, this.langService.currentLang()),
  );
  protected createdAt = computed(() =>
    formatInstant(this.batch()?.createdAt, this.langService.currentLang()),
  );

  protected tone = computed(() => BATCH_STATUS_TONE[this.batch()?.status as BatchStatus] ?? 'neutral');
  protected readOnly = computed(() => this.batch()?.readOnly === true);

  /**
   * The status moves offered right now.
   *
   * Read from the shared transition map rather than hand-written, so the buttons
   * and the server's rules cannot disagree. Archive is excluded: it is offered
   * separately, behind a confirmation, because it is the one that cannot be
   * undone.
   */
  protected transitions = computed<BatchStatus[]>(() => {
    const current = this.batch()?.status;
    if (!current) return [];
    return (BATCH_TRANSITIONS[current] ?? []).filter(
      (status) => status !== BATCH_STATUS.ARCHIVED,
    );
  });

  protected canArchive = computed(() => {
    const current = this.batch()?.status;
    if (!current) return false;
    return (BATCH_TRANSITIONS[current] ?? []).includes(BATCH_STATUS.ARCHIVED);
  });

  protected rows = computed<StudentRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.students().map((student) => ({
      student,
      joinedAt: formatInstant(student.joinedAt, lang),
      // The catalog pointers are optional on a profile, so an absent one is an
      // empty cell rather than a crash.
      city: student.city ? catalogItemName(student.city, lang) : '',
      institution: student.institution ? catalogItemName(student.institution, lang) : '',
    }));
  });

  protected noStudents = computed(
    () => !this.studentsLoading() && this.studentTotal() === 0 && !this.studentSearch(),
  );
  protected noStudentMatches = computed(
    () => !this.studentsLoading() && this.rows().length === 0 && !this.noStudents(),
  );



  constructor() {
    this.batchId.set(String(this.route.snapshot.paramMap.get('batchId') ?? ''));

    this.studentSearchInput
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((term) => {
        this.studentSearch.set(term);
        // A new search is a new result set; the old page number does not
        // survive it.
        this.studentPage.set(0);
        this.loadStudents();
      });

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
      .adminGetBatch(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ batch, invitation }) => {
          this.batch.set(batch);
          this.invitation.set(invitation);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  protected selectTab(tab: BatchTab): void {
    this.activeTab.set(tab);
    // The roster is fetched the first time somebody actually looks at it, not
    // on every page load — most visits to a Batch are not about the roster.
    if (tab === 'students' && !this.studentsLoaded()) this.loadStudents();
  }

  // ── Status ────────────────────────────────────────────────────────────────

  protected changeStatus(status: BatchStatus): void {
    if (this.busy()) return;
    this.begin();

    this.batchApi
      .adminChangeStatus(this.batchId(), status)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (batch) => {
          this.batch.set(batch);
          this.noticeKey.set('admin.batches.notices.statusChanged');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected openArchive(): void {
    this.confirmingArchive.set(true);
  }

  protected cancelArchive(): void {
    this.confirmingArchive.set(false);
  }

  protected archiveConfirmed(): void {
    if (this.busy()) return;
    this.begin();

    this.batchApi
      .adminArchiveBatch(this.batchId())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (batch) => {
          this.batch.set(batch);
          this.confirmingArchive.set(false);
          this.noticeKey.set('admin.batches.notices.archived');
          // The invitation panel's own rules change with the Batch, so its
          // status is re-read rather than left saying it can still be managed.
          this.refreshInvitation();
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.confirmingArchive.set(false);
          this.fail(error);
        },
      });
  }

  private refreshInvitation(): void {
    this.batchApi.adminGetInvitation(this.batchId()).subscribe({
      next: (status) => {
        this.invitation.set(status);
        this.changeDetector.markForCheck();
      },
      // The panel keeps what it has; a stale "can manage" is corrected by the
      // server refusing the operation, which the panel reports.
      error: () => undefined,
    });
  }

  // ── Roster ────────────────────────────────────────────────────────────────

  protected loadStudents(): void {
    this.studentsLoading.set(true);
    this.studentsErrorKey.set(null);

    this.batchApi
      .adminListBatchStudents(this.batchId(), {
        search: this.studentSearch(),
        skip: this.studentPage() * this.studentPageSize(),
        limit: this.studentPageSize(),
      })
      .pipe(
        finalize(() => {
          this.studentsLoading.set(false);
          this.studentsLoaded.set(true);
        }),
      )
      .subscribe({
        next: (page) => {
          this.students.set(page.items ?? []);
          this.studentTotal.set(page.total ?? 0);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.studentsErrorKey.set(mapBatchError(error).key);
          this.students.set([]);
          this.studentTotal.set(0);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected updateStudentSearch(term: string): void {
    this.studentSearchInput.next(term.slice(0, this.limits.search.max));
  }

  /** A different roster page, or a different page size. Both hit the server. */
  protected onStudentPageChange(event: PageChangeEvent): void {
    this.studentPage.set(event.page);
    this.studentPageSize.set(event.rows);
    this.loadStudents();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  protected edit(): void {
    this.router.navigate([ADMIN_BATCHES, this.batchId(), 'edit']);
  }

  protected back(): void {
    this.router.navigate([ADMIN_BATCHES]);
  }

  protected openStudent(student: AdminStudentSummary): void {
    this.router.navigate([ADMIN_STUDENTS, student.id]);
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private begin(): void {
    this.busy.set(true);
    this.errorKey.set(null);
    this.noticeKey.set(null);
  }

  private fail(error: unknown): void {
    this.errorKey.set(mapBatchError(error).key);
    this.changeDetector.markForCheck();
  }
}
