import { DecimalPipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { finalize, forkJoin } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  ColTemplateDirective,
  CustomTemplateDirective,
  DataTableComponent,
  GridCardTemplateDirective,
  LoadDataEvent,
  PreviewTemplateDirective,
  TableColumn,
} from '../../components/shared/data-table';
import { ADMIN_STUDENTS } from '../../guards/home-route';
import { AdminStudentSummary, Batch } from '../../models/Batch';
import { ProfileCatalogItem, catalogItemName } from '../../models/ProfileCatalogItem';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService, StudentDirectoryFilters } from '../../services/dataService/batch-service';
import { ProfileCatalogApiService } from '../../services/dataService/profile-catalog-service';
import { BATCH_PAGE } from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { CATALOG_TYPE } from '../../utils/profile-catalog-constants';

interface FilterOption {
  value: string;
  label: string;
}

interface StudentRow {
  id: string;
  student: AdminStudentSummary;
  name: string;
  email: string;
  city: string;
  institution: string;
  major: string;
  targetRole: string;
  batches: number;
  profileComplete: boolean;
}

const COMPLETION = { ANY: '', COMPLETE: 'complete', INCOMPLETE: 'incomplete' } as const;

@Component({
  selector: 'app-admin-students',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    AvatarModule,
    AlertComponent,
    DataTableComponent,
    ColTemplateDirective,
    CustomTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
    DecimalPipe,
    TitleCasePipe,
  ],
  templateUrl: './students.component.html',
  styleUrl: './students.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStudentsComponent {
  private readonly batchApi = inject(BatchApiService);
  private readonly catalogApi = inject(ProfileCatalogApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  protected readonly langService = inject(ChangeLangService);
  private readonly table = viewChild(DataTableComponent);

  protected readonly completion = COMPLETION;

  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    return [
      {
        field: 'name',
        header: this.translate.instant('admin.students.columns.name'),
        template: 'name',
      },
      {
        field: 'email',
        header: this.translate.instant('admin.students.columns.email'),
        template: 'email',
      },
      {
        field: 'city',
        header: this.translate.instant('admin.students.columns.city'),
        template: 'city',
      },
      {
        field: 'institution',
        header: this.translate.instant('admin.students.columns.institution'),
        template: 'institution',
      },
      {
        field: 'targetRole',
        header: this.translate.instant('admin.students.columns.targetRole'),
        template: 'targetRole',
      },
      {
        field: 'batches',
        header: this.translate.instant('admin.students.columns.batches'),
        template: 'batches',
      },
      {
        field: 'profileComplete',
        header: this.translate.instant('admin.students.columns.profile'),
        template: 'profile',
      },
    ];
  });

  protected batchId = signal('');
  protected cityId = signal('');
  protected institutionId = signal('');
  protected majorId = signal('');
  protected targetRoleId = signal('');
  protected completionFilter = signal<string>(COMPLETION.ANY);
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);

  private readonly students = signal<AdminStudentSummary[]>([]);
  protected total = signal(0);
  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);

  private readonly cities = signal<ProfileCatalogItem[]>([]);
  private readonly institutions = signal<ProfileCatalogItem[]>([]);
  private readonly majors = signal<ProfileCatalogItem[]>([]);
  private readonly targetRoles = signal<ProfileCatalogItem[]>([]);
  private readonly batches = signal<Batch[]>([]);
  protected filtersLoading = signal(true);

  protected cityOptions = computed(() => this.toOptions(this.cities()));
  protected institutionOptions = computed(() => this.toOptions(this.institutions()));
  protected majorOptions = computed(() => this.toOptions(this.majors()));
  protected targetRoleOptions = computed(() => this.toOptions(this.targetRoles()));

  protected batchOptions = computed<FilterOption[]>(() => {
    this.langService.currentLang();
    return [
      { value: '', label: this.translate.instant('admin.students.filters.anyBatch') },
      ...this.batches().map((batch) => ({ value: batch.id, label: batch.name })),
    ];
  });

  protected completionOptions = computed<FilterOption[]>(() => {
    this.langService.currentLang();
    return [
      { value: COMPLETION.ANY, label: this.translate.instant('admin.students.filters.anyProfile') },
      {
        value: COMPLETION.COMPLETE,
        label: this.translate.instant('admin.students.filters.complete'),
      },
      {
        value: COMPLETION.INCOMPLETE,
        label: this.translate.instant('admin.students.filters.incomplete'),
      },
    ];
  });

  protected rows = computed<StudentRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.students().map((student) => ({
      id: student.id,
      student,
      name: student.fullName,
      email: student.verifiedEmail,
      city: student.city ? catalogItemName(student.city, lang) : '',
      institution: student.institution ? catalogItemName(student.institution, lang) : '',
      major: student.major ? catalogItemName(student.major, lang) : '',
      targetRole: student.targetRole ? catalogItemName(student.targetRole, lang) : '',
      batches: student.batchCount ?? 0,
      profileComplete: student.profileComplete,
    }));
  });

  protected hasFilters = computed(
    () =>
      !!this.batchId() ||
      !!this.cityId() ||
      !!this.institutionId() ||
      !!this.majorId() ||
      !!this.targetRoleId() ||
      this.completionFilter() !== COMPLETION.ANY,
  );

  constructor() {
    this.loadFilters();
  }

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
        },
        error: () => undefined,
      });
  }

  protected onLoadData(event: LoadDataEvent): void {
    this.lastLoadEvent.set(event);
    this.loading.set(true);
    this.errorKey.set(null);

    const filters: StudentDirectoryFilters = {
      search: event.search,
      batchId: this.batchId(),
      cityId: this.cityId(),
      institutionId: this.institutionId(),
      majorId: this.majorId(),
      targetRoleId: this.targetRoleId(),
      skip: event.skip,
      limit: event.limit,
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
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.students.set([]);
          this.total.set(0);
        },
      });
  }

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
    this.reloadFirstPage();
  }

  protected clearFilters(): void {
    this.batchId.set('');
    this.cityId.set('');
    this.institutionId.set('');
    this.majorId.set('');
    this.targetRoleId.set('');
    this.completionFilter.set(COMPLETION.ANY);
    this.reloadFirstPage();
  }

  private reloadFirstPage(): void {
    const search = this.lastLoadEvent()?.search ?? '';
    const table = this.table();
    if (table) table.onSearch(search);
    else this.onLoadData({ skip: 0, limit: 25, search });
  }

  protected open(student: AdminStudentSummary): void {
    this.router.navigate([ADMIN_STUDENTS, student.id]);
  }

  private toOptions(items: ProfileCatalogItem[]): FilterOption[] {
    const lang = this.langService.currentLang();
    return [
      { value: '', label: this.translate.instant('admin.students.filters.any') },
      ...items.map((item) => ({ value: item.id, label: catalogItemName(item, lang) })),
    ];
  }
}
