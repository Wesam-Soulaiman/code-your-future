import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { finalize } from 'rxjs';

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
import { ADMIN_BATCHES } from '../../guards/home-route';
import { Batch } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import {
  BATCH_STATUSES,
  BATCH_STATUS_TONE,
  BatchStatus,
} from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatCalendarDateShort } from '../../utils/calendar-date';

interface BatchRow {
  id: string;
  batch: Batch;
  name: string;
  startDate: string;
  endDate: string;
  status: BatchStatus;
  students: number;
  tone: string;
}

interface StatusOption {
  value: BatchStatus | '';
  labelKey: string;
}

@Component({
  selector: 'app-admin-batches',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    AlertComponent,
    DataTableComponent,
    ColTemplateDirective,
    CustomTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
    DecimalPipe,
  ],
  templateUrl: './batches.component.html',
  styleUrl: './batches.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminBatchesComponent {
  private readonly batchApi = inject(BatchApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  protected readonly langService = inject(ChangeLangService);
  private readonly table = viewChild(DataTableComponent);

  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    return [
      { field: 'name', header: this.translate.instant('batch.fields.name'), template: 'name' },
      {
        field: 'startDate',
        header: this.translate.instant('batch.fields.startDate'),
        template: 'startDate',
      },
      {
        field: 'endDate',
        header: this.translate.instant('batch.fields.endDate'),
        template: 'endDate',
      },
      {
        field: 'status',
        header: this.translate.instant('batch.fields.status'),
        template: 'status',
      },
      {
        field: 'students',
        header: this.translate.instant('admin.batches.columns.students'),
        template: 'students',
      },
      {
        field: 'actions',
        header: this.translate.instant('admin.batches.columns.actions'),
        template: 'actions',
      },
    ];
  });

  protected readonly statusOptions: StatusOption[] = [
    { value: '', labelKey: 'admin.batches.filters.anyStatus' },
    ...BATCH_STATUSES.map((status) => ({
      value: status,
      labelKey: `batch.status.${status}`,
    })),
  ];

  protected search = signal('');
  protected status = signal<BatchStatus | ''>('');
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);
  protected loading = signal(true);
  protected errorKey = signal<BatchErrorKey | null>(null);
  private readonly batches = signal<Batch[]>([]);
  protected total = signal(0);

  protected rows = computed<BatchRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.batches().map((batch) => ({
      id: batch.id,
      batch,
      name: batch.name,
      startDate: formatCalendarDateShort(batch.startDate, lang),
      endDate: formatCalendarDateShort(batch.endDate, lang),
      status: batch.status,
      students: batch.enrollmentCount ?? 0,
      tone: BATCH_STATUS_TONE[batch.status] ?? 'neutral',
    }));
  });

  protected onLoadData(event: LoadDataEvent): void {
    this.lastLoadEvent.set(event);
    this.search.set(event.search);
    this.load(event);
  }

  protected load(
    event: LoadDataEvent = this.lastLoadEvent() ?? { skip: 0, limit: 25, search: this.search() },
  ): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.batchApi
      .adminListBatches({
        search: event.search,
        status: this.status(),
        skip: event.skip,
        limit: event.limit,
      })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.batches.set(page.items ?? []);
          this.total.set(page.total ?? 0);
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.batches.set([]);
          this.total.set(0);
        },
      });
  }

  protected updateStatus(next: BatchStatus | ''): void {
    this.status.set(next ?? '');
    const search = this.lastLoadEvent()?.search ?? '';
    const table = this.table();
    if (table) table.onSearch(search);
    else this.onLoadData({ skip: 0, limit: 25, search });
  }

  protected create(): void {
    this.router.navigate([ADMIN_BATCHES, 'new']);
  }

  protected open(batch: Batch): void {
    this.router.navigate([ADMIN_BATCHES, batch.id]);
  }
}
