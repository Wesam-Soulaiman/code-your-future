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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  ColTemplateDirective,
  DataTableComponent,
  GridCardTemplateDirective,
  LoadDataEvent,
  PreviewTemplateDirective,
  TableColumn,
} from '../../components/shared/data-table';
import { StudentBatchResource } from '../../models/BatchResource';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchResourceApiService } from '../../services/dataService/batch-resource-service';
import { formatInstant } from '../../utils/calendar-date';
import { fileSizeUnit, formatFileSize, resourceIcon } from '../../utils/resource-constants';
import { ResourceErrorKey, mapResourceError } from '../../utils/resource-error';
import { saveBlob } from '../../utils/save-blob';

interface StudentResourceRow {
  id: string;
  resource: StudentBatchResource;
  title: string;
  kind: string;
  icon: string;
  size: string;
  sizeUnitKey: string;
  addedAt: string;
}

/**
 * The materials of a Batch, as the Student in it sees them ⟨CP5⟩.
 *
 * ── Read, and download. Nothing else ────────────────────────────────────────
 * There is no upload, no edit, no reorder, and no delete — not disabled, but
 * absent, because a Student has no such operation to call and a greyed-out
 * button would suggest otherwise. What they get is the list and the files.
 *
 * ── Still theirs when the cohort ends ───────────────────────────────────────
 * A completed or archived Batch keeps working here. Somebody who took the
 * course does not lose the material they were given because the term finished.
 *
 * ── Downloads are saved, never opened ───────────────────────────────────────
 * Every file arrives as bytes over an authenticated request and goes straight
 * to the browser's save flow. Nothing is opened in a tab, which matters most
 * for an uploaded `.html`: rendered in this application's origin it would run
 * its own script with the reader's session in scope.
 */
@Component({
  selector: 'cyf-student-batch-resources',
  imports: [
    TranslateModule,
    ButtonModule,
    AlertComponent,
    DataTableComponent,
    ColTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
  ],
  templateUrl: './student-batch-resources.component.html',
  styleUrl: './student-batch-resources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentBatchResourcesComponent {
  private resourceApi = inject(BatchResourceApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  batchId = input.required<string>();

  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    return [
      { field: 'title', header: this.translate.instant('resources.columns.title'), template: 'title' },
      { field: 'kind', header: this.translate.instant('resources.columns.type'), template: 'kind' },
      { field: 'size', header: this.translate.instant('resources.columns.size'), template: 'size' },
      { field: 'actions', header: this.translate.instant('resources.columns.actions'), template: 'actions' },
    ];
  });

  protected items = signal<StudentBatchResource[]>([]);
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);
  protected loading = signal(true);
  protected errorKey = signal<ResourceErrorKey | null>(null);
  protected downloadingId = signal('');

  protected allRows = computed<StudentResourceRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.items().map((resource) => ({
      id: resource.id,
      resource,
      title: resource.title,
      kind: resource.kind,
      icon: resourceIcon(resource.kind),
      size: formatFileSize(resource.fileSize, lang),
      sizeUnitKey: `resources.units.${fileSizeUnit(resource.fileSize)}`,
      addedAt: formatInstant(resource.createdAt, lang),
    }));
  });

  protected filteredRows = computed(() => {
    const term = (this.lastLoadEvent()?.search ?? '').trim().toLowerCase();
    if (!term) return this.allRows();
    return this.allRows().filter(({ resource }) =>
      [resource.title, resource.description, resource.filename, resource.kind]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(term)),
    );
  });

  protected rows = computed(() => {
    const event = this.lastLoadEvent() ?? { skip: 0, limit: 25, search: '' };
    return this.filteredRows().slice(event.skip, event.skip + event.limit);
  });

  protected totalRecords = computed(() => this.filteredRows().length);

  protected isEmpty = computed(() => !this.loading() && this.items().length === 0);

  constructor() {
    effect(() => {
      const id = this.batchId();
      if (id) this.load(id);
    });
  }

  protected reload(): void {
    this.load(this.batchId());
  }

  protected onLoadData(event: LoadDataEvent): void {
    const previous = this.lastLoadEvent();
    this.lastLoadEvent.set(event);
    if (
      previous &&
      previous.skip === event.skip &&
      previous.limit === event.limit &&
      previous.search === event.search
    ) {
      this.reload();
    }
  }

  private load(batchId: string): void {
    if (!batchId) return;

    this.loading.set(true);
    this.errorKey.set(null);

    this.resourceApi
      .listMyBatchResources(batchId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.items.set(page.items ?? []);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.items.set([]);
          this.errorKey.set(mapResourceError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected download(resource: StudentBatchResource): void {
    if (this.downloadingId()) return;

    this.downloadingId.set(resource.id);
    this.errorKey.set(null);

    this.resourceApi
      .downloadResource(resource.id)
      .pipe(finalize(() => this.downloadingId.set('')))
      .subscribe({
        next: (blob) => {
          saveBlob(blob, resource.filename);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapResourceError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }
}
