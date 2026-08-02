import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { Subject, debounceTime, finalize, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AlertComponent } from '../../components/shared/alert.component';
import { ColTemplateDirective } from '../../components/shared/data-table/col-template.directive';
import { TableColumn } from '../../components/shared/data-table/data-table.component';
import { PageChangeEvent } from '../../components/shared/data-table/paginator.component';
import { RecordTableComponent } from '../../components/shared/record-table/record-table.component';
import { ADMIN_STUDENTS } from '../../guards/home-route';
import { AdminStudentSummary, Batch } from '../../models/Batch';
import { ProfileCatalogItem, catalogItemName } from '../../models/ProfileCatalogItem';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService, StudentDirectoryFilters } from '../../services/dataService/batch-service';
import { ProfileCatalogApiService } from '../../services/dataService/profile-catalog-service';
import { BATCH_LIMITS, BATCH_PAGE } from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { CATALOG_TYPE } from '../../utils/profile-catalog-constants';

/** One option in a filter select. Labels are resolved for the active language. */
interface FilterOption {
  value: string;
  label: string;
}

/** A directory row with its catalog names already resolved. */
interface StudentRow {
  student: AdminStudentSummary;
  city: string;
  institution: string;
  major: string;
  targetRole: string;
}

const SEARCH_DEBOUNCE_MS = 300;

/** The completion filter's three positions. */
const COMPLETION = { ANY: '', COMPLETE: 'complete', INCOMPLETE: 'incomplete' } as const;

/**
 * Students — the Admin directory.
 *
 * ── This is a directory, not user management ────────────────────────────────
 * There is no create, no edit, no delete, no role assignment, no password
 * reset, no impersonation, no rating, no score, and no export. An Admin can
 * find a Student and read the profile that Student wrote. Every one of those
 * absences is also an absence in the API — the endpoints behind this page can
 * only read.
 *
 * ── Driven by profiles, not by Batches ──────────────────────────────────────
 * The listing comes from `StudentProfile`, so a Student who has signed in and
 * filled in their details appears here whether or not anybody has invited them
 * anywhere. A directory that only showed people already in a Batch would be
 * useless for the one job it has: finding somebody to invite.
 *
 * ── Filters are ids, and searches are never logged ──────────────────────────
 * Every filter sends a catalog **id**, never a typed name, so the query cannot
 * be steered by free text. The search term is debounced here and dropped
 * server-side — the logging allow-list has no field it could travel in.
 */
@Component({
  selector: 'app-admin-students',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    AlertComponent,
    RecordTableComponent,
    ColTemplateDirective,
  ],
  templateUrl: './students.component.html',
  styleUrl: './students.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStudentsComponent {
  private batchApi = inject(BatchApiService);
  private catalogApi = inject(ProfileCatalogApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  protected readonly limits = BATCH_LIMITS;
  protected readonly completion = COMPLETION;

  /** The columns, in the template table's own shape. `header` is a key. */
  protected readonly columns: TableColumn[] = [
    { field: 'name', header: 'admin.students.columns.name', template: 'name' },
    { field: 'email', header: 'admin.students.columns.email', template: 'email' },
    { field: 'city', header: 'admin.students.columns.city', template: 'city' },
    {
      field: 'institution',
      header: 'admin.students.columns.institution',
      template: 'institution',
    },
    { field: 'targetRole', header: 'admin.students.columns.targetRole', template: 'targetRole' },
    { field: 'batches', header: 'admin.students.columns.batches', template: 'batches' },
    { field: 'profile', header: 'admin.students.columns.profile', template: 'profile' },
  ];

  // ── Filter state ──────────────────────────────────────────────────────────
  protected search = signal('');
  protected batchId = signal('');
  protected cityId = signal('');
  protected institutionId = signal('');
  protected majorId = signal('');
  protected targetRoleId = signal('');
  protected completionFilter = signal<string>(COMPLETION.ANY);

  /** Zero-based page and page size, driven by the restored paginator. */
  protected page = signal(0);
  protected pageSize = signal<number>(BATCH_PAGE.defaultLimit);

  // ── Data ──────────────────────────────────────────────────────────────────
  private students = signal<AdminStudentSummary[]>([]);
  protected total = signal(0);
  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);

  private cities = signal<ProfileCatalogItem[]>([]);
  private institutions = signal<ProfileCatalogItem[]>([]);
  private majors = signal<ProfileCatalogItem[]>([]);
  private targetRoles = signal<ProfileCatalogItem[]>([]);
  private batches = signal<Batch[]>([]);
  protected filtersLoading = signal(true);

  private searchInput = new Subject<string>();

  /** Guards the language effect so its first run does not re-trigger a load. */
  private languageWatched = signal(false);

  // ── Options, resolved for the active language ─────────────────────────────

  protected cityOptions = computed(() => this.toOptions(this.cities()));
  protected institutionOptions = computed(() => this.toOptions(this.institutions()));
  protected majorOptions = computed(() => this.toOptions(this.majors()));
  protected targetRoleOptions = computed(() => this.toOptions(this.targetRoles()));

  protected batchOptions = computed<FilterOption[]>(() => [
    { value: '', label: this.translate.instant('admin.students.filters.anyBatch') },
    ...this.batches().map((batch) => ({ value: batch.id, label: batch.name })),
  ]);

  protected completionOptions = computed<FilterOption[]>(() => [
    { value: COMPLETION.ANY, label: this.translate.instant('admin.students.filters.anyProfile') },
    {
      value: COMPLETION.COMPLETE,
      label: this.translate.instant('admin.students.filters.complete'),
    },
    {
      value: COMPLETION.INCOMPLETE,
      label: this.translate.instant('admin.students.filters.incomplete'),
    },
  ]);

  protected rows = computed<StudentRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.students().map((student) => ({
      student,
      city: student.city ? catalogItemName(student.city, lang) : '',
      institution: student.institution ? catalogItemName(student.institution, lang) : '',
      major: student.major ? catalogItemName(student.major, lang) : '',
      targetRole: student.targetRole ? catalogItemName(student.targetRole, lang) : '',
    }));
  });

  protected hasFilters = computed(
    () =>
      !!this.search() ||
      !!this.batchId() ||
      !!this.cityId() ||
      !!this.institutionId() ||
      !!this.majorId() ||
      !!this.targetRoleId() ||
      this.completionFilter() !== COMPLETION.ANY,
  );

  protected isEmpty = computed(
    () => !this.loading() && this.total() === 0 && !this.hasFilters(),
  );
  protected noMatches = computed(
    () => !this.loading() && this.rows().length === 0 && !this.isEmpty(),
  );



  constructor() {
    this.searchInput
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        // A new search is a new result set; the old page number does not
        // survive it.
        this.page.set(0);
        this.load();
      });

    // Filter labels come from the catalogs, whose names are per-language.
    // Re-resolving on a language change keeps the selects legible without
    // re-fetching. `untracked` keeps the writes out of the dependency set, and
    // the first-run guard stops this from firing during construction.
    effect(() => {
      this.langService.currentLang();
      untracked(() => {
        if (!this.languageWatched()) {
          this.languageWatched.set(true);
          return;
        }
        this.changeDetector.markForCheck();
      });
    });

    this.loadFilters();
    this.load();
  }

  /**
   * The catalogs and the Batch list that drive the filters.
   *
   * Read through the **Admin** catalog endpoint, not the Student one — an Admin
   * cannot call the Student list, and this one also returns retired items,
   * which matters: a profile saved last year may point at a City that has since
   * been retired, and a filter that could not name it could not find them.
   *
   * Fetched once, in parallel, and treated as optional: a directory that cannot
   * offer a City filter is still a working directory, so a failure here narrows
   * the filters rather than blocking the page.
   */
  private loadFilters(): void {
    const lang = this.langService.currentLang();

    forkJoin({
      cities: this.catalogApi.adminList(CATALOG_TYPE.CITY, lang),
      institutions: this.catalogApi.adminList(CATALOG_TYPE.INSTITUTION, lang),
      majors: this.catalogApi.adminList(CATALOG_TYPE.MAJOR, lang),
      targetRoles: this.catalogApi.adminList(CATALOG_TYPE.TARGET_ROLE, lang),
      batches: this.batchApi.adminListBatches({ limit: BATCH_PAGE.maxLimit }),
    })
      .pipe(finalize(() => this.filtersLoading.set(false)))
      .subscribe({
        next: (result) => {
          this.cities.set(result.cities?.items ?? []);
          this.institutions.set(result.institutions?.items ?? []);
          this.majors.set(result.majors?.items ?? []);
          this.targetRoles.set(result.targetRoles?.items ?? []);
          this.batches.set(result.batches?.items ?? []);
          this.changeDetector.markForCheck();
        },
        error: () => {
          // The list itself still works; only the filters are unavailable.
          this.changeDetector.markForCheck();
        },
      });
  }

  protected load(): void {
    this.loading.set(true);
    this.errorKey.set(null);

    const filters: StudentDirectoryFilters = {
      search: this.search(),
      batchId: this.batchId(),
      cityId: this.cityId(),
      institutionId: this.institutionId(),
      majorId: this.majorId(),
      targetRoleId: this.targetRoleId(),
      skip: this.page() * this.pageSize(),
      limit: this.pageSize(),
    };

    const completion = this.completionFilter();
    if (completion === COMPLETION.COMPLETE) filters.profileComplete = true;
    if (completion === COMPLETION.INCOMPLETE) filters.profileComplete = false;

    this.batchApi
      .adminListStudents(filters)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.students.set(page.items ?? []);
          this.total.set(page.total ?? 0);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.students.set([]);
          this.total.set(0);
          this.changeDetector.markForCheck();
        },
      });
  }

  // ── Filter changes ────────────────────────────────────────────────────────

  protected updateSearch(term: string): void {
    this.searchInput.next(term.slice(0, this.limits.search.max));
  }

  /** Any filter change returns to page one. Page 3 of 2 pages reads as broken. */
  protected updateFilter(
    field:
      | 'batchId'
      | 'cityId'
      | 'institutionId'
      | 'majorId'
      | 'targetRoleId'
      | 'completionFilter',
    value: string,
  ): void {
    this[field].set(value ?? '');
    this.page.set(0);
    this.load();
  }

  protected clearFilters(): void {
    this.batchId.set('');
    this.cityId.set('');
    this.institutionId.set('');
    this.majorId.set('');
    this.targetRoleId.set('');
    this.completionFilter.set(COMPLETION.ANY);
    this.search.set('');
    this.page.set(0);
    this.load();
  }

  /** A different page, or a different page size. Both go back to the server. */
  protected onPageChange(event: PageChangeEvent): void {
    this.page.set(event.page);
    this.pageSize.set(event.rows);
    this.load();
  }

  protected open(student: AdminStudentSummary): void {
    this.router.navigate([ADMIN_STUDENTS, student.id]);
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /** Catalog items to select options, with an "any" entry at the top. */
  private toOptions(items: ProfileCatalogItem[]): FilterOption[] {
    const lang = this.langService.currentLang();
    return [
      { value: '', label: this.translate.instant('admin.students.filters.any') },
      ...items.map((item) => ({ value: item.id, label: catalogItemName(item, lang) })),
    ];
  }
}
