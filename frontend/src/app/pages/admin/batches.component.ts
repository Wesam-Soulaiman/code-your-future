import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { Subject, debounceTime, finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AlertComponent } from '../../components/shared/alert.component';
import { ColTemplateDirective } from '../../components/shared/data-table/col-template.directive';
import { TableColumn } from '../../components/shared/data-table/data-table.component';
import { PageChangeEvent } from '../../components/shared/data-table/paginator.component';
import { RecordTableComponent } from '../../components/shared/record-table/record-table.component';
import { ADMIN_BATCHES } from '../../guards/home-route';
import { Batch } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import {
  BATCH_LIMITS,
  BATCH_PAGE,
  BATCH_STATUSES,
  BATCH_STATUS_TONE,
  BatchStatus,
} from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDateShort } from '../../utils/calendar-date';

/** A Batch with its dates rendered for the language that is active now. */
interface BatchRow {
  batch: Batch;
  startDate: string;
  endDate: string;
  tone: string;
}

/** One entry in the status filter. */
interface StatusOption {
  value: BatchStatus | '';
  labelKey: string;
}

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Batches — the Admin list.
 *
 * ── There is no delete ──────────────────────────────────────────────────────
 * Not hidden, not disabled: it does not exist, here or in the API. A Batch that
 * Students have joined is a record of who was where, and deleting one would
 * silently remove their membership with it. Archiving is the way a Batch is
 * retired — it stops accepting anybody and stops changing, and it stays.
 *
 * ── Searching does not page ─────────────────────────────────────────────────
 * Every new search resets to the first page. Keeping the offset would show
 * "page 3" of a result set that has two pages, which reads as an empty product
 * rather than as an empty page.
 *
 * The search term is debounced and is never logged — not here, and not by the
 * backend, whose logging allow-list has no field it could travel in.
 */
@Component({
  selector: 'app-admin-batches',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    AlertComponent,
    RecordTableComponent,
    ColTemplateDirective,
  ],
  templateUrl: './batches.component.html',
  styleUrl: './batches.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminBatchesComponent {
  private batchApi = inject(BatchApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  protected readonly limits = BATCH_LIMITS;

  /**
   * The columns, in the template table's own shape.
   *
   * `header` is a translation key — the table translates it, so the header row
   * follows a language change without the page re-rendering anything.
   */
  protected readonly columns: TableColumn[] = [
    { field: 'name', header: 'batch.fields.name', template: 'name' },
    { field: 'startDate', header: 'batch.fields.startDate', template: 'startDate' },
    { field: 'endDate', header: 'batch.fields.endDate', template: 'endDate' },
    { field: 'status', header: 'batch.fields.status', template: 'status' },
    { field: 'students', header: 'admin.batches.columns.students', template: 'students' },
    { field: 'actions', header: 'admin.batches.columns.actions', template: 'actions' },
  ];

  /** "Any status" first, then the four real ones, in lifecycle order. */
  protected readonly statusOptions: StatusOption[] = [
    { value: '', labelKey: 'admin.batches.filters.anyStatus' },
    ...BATCH_STATUSES.map((status) => ({
      value: status,
      labelKey: `batch.status.${status}`,
    })),
  ];

  protected search = signal('');
  protected status = signal<BatchStatus | ''>('');

  /**
   * Zero-based page and page size.
   *
   * Held here rather than inside the table: the request that fetches a page is
   * this component's, and the paginator only says which page to ask for. The
   * size is a signal because the restored paginator offers a rows-per-page
   * selector — the hand-built Previous/Next pair could not change it.
   */
  protected page = signal(0);
  protected pageSize = signal<number>(BATCH_PAGE.defaultLimit);

  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);
  private batches = signal<Batch[]>([]);
  protected total = signal(0);

  private searchInput = new Subject<string>();

  protected rows = computed<BatchRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.batches().map((batch) => ({
      batch,
      startDate: formatCalendarDateShort(batch.startDate, lang),
      endDate: formatCalendarDateShort(batch.endDate, lang),
      tone: BATCH_STATUS_TONE[batch.status] ?? 'neutral',
    }));
  });

  /** True when the product has no Batches at all, not merely no matches. */
  protected isEmpty = computed(
    () => !this.loading() && this.total() === 0 && !this.search() && !this.status(),
  );

  /** True when filters are in play and matched nothing. A different message. */
  protected noMatches = computed(
    () => !this.loading() && this.rows().length === 0 && !this.isEmpty(),
  );



  constructor() {
    this.searchInput
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        // A new search means a new result set, so page 3 of the old one is
        // meaningless — and would read as an empty product rather than an
        // empty page.
        this.page.set(0);
        this.load();
      });

    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.batchApi
      .adminListBatches({
        search: this.search(),
        status: this.status(),
        skip: this.page() * this.pageSize(),
        limit: this.pageSize(),
      })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.batches.set(page.items ?? []);
          this.total.set(page.total ?? 0);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.batches.set([]);
          this.total.set(0);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected updateSearch(term: string): void {
    this.searchInput.next(term.slice(0, this.limits.search.max));
  }

  protected updateStatus(next: BatchStatus | ''): void {
    this.status.set(next ?? '');
    this.page.set(0);
    this.load();
  }

  /**
   * The paginator asked for a different page, or a different page size.
   *
   * Both go straight back to the server. Nothing is sliced here — the rows this
   * component holds are only ever the current page.
   */
  protected onPageChange(event: PageChangeEvent): void {
    this.page.set(event.page);
    this.pageSize.set(event.rows);
    this.load();
  }

  protected create(): void {
    this.router.navigate([ADMIN_BATCHES, 'new']);
  }

  protected open(batch: Batch): void {
    this.router.navigate([ADMIN_BATCHES, batch.id]);
  }
}
