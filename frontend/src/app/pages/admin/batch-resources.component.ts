import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
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
import { BatchResource, ResourceUploadRules } from '../../models/BatchResource';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchResourceApiService } from '../../services/dataService/batch-resource-service';
import { formatInstant } from '../../utils/calendar-date';
import {
  RESOURCE_LIMITS,
  acceptAttribute,
  fileSizeUnit,
  formatFileSize,
  resourceIcon,
} from '../../utils/resource-constants';
import { ResourceErrorKey, mapResourceError } from '../../utils/resource-error';
import { saveBlob } from '../../utils/save-blob';

/** A row with its size, date, and icon already rendered. */
interface ResourceRow {
  id: string;
  resource: BatchResource;
  title: string;
  kind: string;
  icon: string;
  size: string;
  sizeUnitKey: string;
  addedAt: string;
  /** Position, so the move buttons know which ends they are at. */
  first: boolean;
  last: boolean;
}

/**
 * The Resources of one Batch, as its Admin manages them ⟨CP5⟩.
 *
 * ── Uploading is the only way bytes arrive, and it happens once ─────────────
 * There is no replace. Editing a Resource changes its title and description and
 * nothing else, because a file that quietly changed under a name people already
 * know is worse than a second file with a clearer name. The dialog says so.
 *
 * ── Order is a full sequence, not a nudge ───────────────────────────────────
 * The move buttons rebuild the whole list and send all of it. Two Admins
 * reordering at the same time therefore cannot interleave into an order neither
 * of them chose — one of them wins, completely, and the other sees the result.
 *
 * Buttons rather than drag-and-drop: dragging needs a pointer, a steady hand,
 * and a library, and a list of teaching materials is short enough that two
 * arrows are faster anyway. They also work from the keyboard, which dragging
 * does not.
 *
 * ── Archived is read-only, not hidden ───────────────────────────────────────
 * Every Resource stays listed and downloadable when the Batch is archived. What
 * disappears is every control that would change something — and the panel says
 * why, rather than leaving somebody hunting for a button that is not there.
 */
@Component({
  selector: 'cyf-batch-resources',
  imports: [
    TranslateModule,
    ButtonModule,
    DialogModule,
    AlertComponent,
    DataTableComponent,
    ColTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
  ],
  templateUrl: './batch-resources.component.html',
  styleUrl: './batch-resources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BatchResourcesComponent {
  private resourceApi = inject(BatchResourceApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  private table = viewChild(DataTableComponent);
  protected langService = inject(ChangeLangService);

  /** The Batch these Resources belong to. */
  batchId = input.required<string>();

  /**
   * What the Batch page already knows about its status.
   *
   * The server says the same thing in every list response, and that answer wins
   * — this input only spares the panel from rendering write controls for a
   * moment before the first response arrives.
   */
  archived = input(false);

  protected readonly limits = RESOURCE_LIMITS;

  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    return [
      { field: 'title', header: this.translate.instant('resources.columns.title'), template: 'title' },
      { field: 'kind', header: this.translate.instant('resources.columns.type'), template: 'kind' },
      { field: 'size', header: this.translate.instant('resources.columns.size'), template: 'size' },
      { field: 'addedAt', header: this.translate.instant('resources.columns.added'), template: 'addedAt' },
      { field: 'actions', header: this.translate.instant('resources.columns.actions'), template: 'actions' },
    ];
  });

  // ── State ─────────────────────────────────────────────────────────────────

  protected items = signal<BatchResource[]>([]);
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);
  protected rules = signal<ResourceUploadRules | null>(null);
  protected serverReadOnly = signal(false);

  protected loading = signal(true);
  protected busy = signal(false);
  protected errorKey = signal<ResourceErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});

  /** Which Resource is being downloaded, so only its own button spins. */
  protected downloadingId = signal('');

  // ── Dialogs ───────────────────────────────────────────────────────────────

  protected uploadOpen = signal(false);
  protected uploadTitle = signal('');
  protected uploadDescription = signal('');
  protected chosenFile = signal<File | null>(null);

  protected editing = signal<BatchResource | null>(null);
  protected editTitle = signal('');
  protected editDescription = signal('');

  protected deleting = signal<BatchResource | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────

  /** The server's answer, falling back to what the page already knew. */
  protected readOnly = computed(() => this.serverReadOnly() || this.archived());

  protected accept = computed(() => acceptAttribute(this.rules()?.extensions ?? []));

  protected extensionList = computed(() =>
    (this.rules()?.extensions ?? []).map((extension) => extension.replace(/^\./, '')).join(', '),
  );

  protected maxSize = computed(() => {
    const max = this.rules()?.maxBytes ?? 0;
    return formatFileSize(max, this.langService.currentLang());
  });

  protected maxSizeUnitKey = computed(
    () => `resources.units.${fileSizeUnit(this.rules()?.maxBytes ?? 0)}`,
  );

  protected chosenFileSize = computed(() => {
    const file = this.chosenFile();
    return file ? formatFileSize(file.size, this.langService.currentLang()) : '';
  });

  protected chosenFileUnitKey = computed(() => {
    const file = this.chosenFile();
    return `resources.units.${fileSizeUnit(file?.size ?? 0)}`;
  });

  protected allRows = computed<ResourceRow[]>(() => {
    const lang = this.langService.currentLang();
    const all = this.items();
    return all.map((resource, index) => ({
      id: resource.id,
      resource,
      title: resource.title,
      kind: resource.kind,
      icon: resourceIcon(resource.kind),
      size: formatFileSize(resource.fileSize, lang),
      sizeUnitKey: `resources.units.${fileSizeUnit(resource.fileSize)}`,
      addedAt: formatInstant(resource.createdAt, lang),
      first: index === 0,
      last: index === all.length - 1,
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

  /** True once a file and a usable title are both in hand. */
  protected canUpload = computed(
    () => Boolean(this.chosenFile()) && this.uploadTitle().trim().length >= this.limits.title.min,
  );

  protected canSaveEdit = computed(
    () => this.editTitle().trim().length >= this.limits.title.min,
  );

  constructor() {
    // The Batch id arrives as an input, so the first load waits for it rather
    // than running in the constructor against an empty string.
    effect(() => {
      const id = this.batchId();
      if (id) this.load(id);
    });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

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
      .adminListResources(batchId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.items.set(page.items ?? []);
          this.rules.set(page.rules ?? null);
          this.serverReadOnly.set(page.readOnly === true);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.items.set([]);
          this.fail(error);
        },
      });
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  protected openUpload(): void {
    this.uploadTitle.set('');
    this.uploadDescription.set('');
    this.chosenFile.set(null);
    this.fieldErrors.set({});
    this.errorKey.set(null);
    this.uploadOpen.set(true);
  }

  protected cancelUpload(): void {
    this.uploadOpen.set(false);
    this.chosenFile.set(null);
  }

  /**
   * Take the chosen file, and check what can be checked here.
   *
   * Size and extension are refused in the browser purely so somebody does not
   * wait for a 20 MiB upload to be told no at the end. Neither check is trusted:
   * the server looks at the bytes themselves, which is the only thing an
   * uploader cannot simply rename.
   */
  protected chooseFile(input: HTMLInputElement): void {
    const file = input.files?.[0] ?? null;
    this.errorKey.set(null);
    this.fieldErrors.set({});

    if (!file) {
      this.chosenFile.set(null);
      return;
    }

    const max = this.rules()?.maxBytes ?? 0;
    if (max > 0 && file.size > max) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('resources.errors.tooLarge');
      return;
    }

    if (file.size === 0) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('resources.errors.empty');
      return;
    }

    const extensions = this.rules()?.extensions ?? [];
    const dot = file.name.lastIndexOf('.');
    const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
    if (extensions.length > 0 && !extensions.includes(extension)) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('resources.errors.typeNotAllowed');
      return;
    }

    this.chosenFile.set(file);

    // A first title, offered rather than imposed: the filename is usually close
    // to what somebody wanted to call it, and it is entirely editable.
    if (!this.uploadTitle().trim()) {
      const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
      this.uploadTitle.set(stem.slice(0, this.limits.title.max));
    }
  }

  protected submitUpload(): void {
    const file = this.chosenFile();
    if (!file || this.busy()) return;

    this.begin();

    this.resourceApi
      .adminUploadResource(
        this.batchId(),
        { title: this.uploadTitle().trim(), description: this.uploadDescription().trim() },
        file,
      )
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (resource) => {
          // Appended rather than re-fetched: the server assigns the next
          // position, and it is the last one.
          this.items.update((current) => [...current, resource]);
          this.uploadOpen.set(false);
          this.chosenFile.set(null);
          this.noticeKey.set('resources.notices.uploaded');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  protected openEdit(resource: BatchResource): void {
    this.editing.set(resource);
    this.editTitle.set(resource.title);
    this.editDescription.set(resource.description ?? '');
    this.fieldErrors.set({});
    this.errorKey.set(null);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected submitEdit(): void {
    const resource = this.editing();
    if (!resource || this.busy()) return;

    this.begin();

    this.resourceApi
      .adminUpdateResource(resource.id, {
        title: this.editTitle().trim(),
        description: this.editDescription().trim(),
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (saved) => {
          this.items.update((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          );
          this.editing.set(null);
          this.noticeKey.set('resources.notices.updated');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Order ─────────────────────────────────────────────────────────────────

  protected moveUp(resource: BatchResource): void {
    this.move(resource, -1);
  }

  protected moveDown(resource: BatchResource): void {
    this.move(resource, 1);
  }

  /**
   * Move one Resource and send the whole resulting order.
   *
   * The list is updated locally first so the row moves under the pointer
   * immediately, and put back if the server refuses — a list that jumps back is
   * clearer than one that sits still for a second and then moves.
   */
  private move(resource: BatchResource, offset: number): void {
    if (this.busy() || this.readOnly()) return;

    const current = this.items();
    const from = current.findIndex((item) => item.id === resource.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= current.length) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const previous = current;
    this.items.set(next);
    this.begin();

    this.resourceApi
      .adminReorderResources(
        this.batchId(),
        next.map((item) => item.id),
      )
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (page) => {
          // The server's order wins, in case somebody else changed it too.
          this.items.set(page.items ?? next);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.items.set(previous);
          this.fail(error);
        },
      });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  protected openDelete(resource: BatchResource): void {
    this.deleting.set(resource);
    this.errorKey.set(null);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const resource = this.deleting();
    if (!resource || this.busy()) return;

    this.begin();

    this.resourceApi
      .adminDeleteResource(resource.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.items.update((current) => current.filter((item) => item.id !== resource.id));
          this.table()?.closePreview();
          this.deleting.set(null);
          this.noticeKey.set('resources.notices.deleted');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.deleting.set(null);
          this.fail(error);
        },
      });
  }

  // ── Download ──────────────────────────────────────────────────────────────

  /**
   * Fetch the bytes and hand them to the browser's save flow.
   *
   * Not a link and not a new tab: there is no URL to link to, and a tab would
   * ask the browser to render a document — which is exactly what an uploaded
   * `.html` must never be allowed to do.
   */
  protected download(resource: BatchResource): void {
    if (this.downloadingId()) return;

    this.downloadingId.set(resource.id);
    this.errorKey.set(null);
    this.noticeKey.set(null);

    this.resourceApi
      .downloadResource(resource.id)
      .pipe(finalize(() => this.downloadingId.set('')))
      .subscribe({
        next: (blob) => {
          saveBlob(blob, resource.filename);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  protected fieldError(field: string): string | null {
    return this.fieldErrors()[field] ?? null;
  }

  private begin(): void {
    this.busy.set(true);
    this.errorKey.set(null);
    this.noticeKey.set(null);
    this.fieldErrors.set({});
  }

  private fail(error: unknown): void {
    const failure = mapResourceError(error);
    this.errorKey.set(failure.key);
    this.fieldErrors.set(failure.fields);
    this.changeDetector.markForCheck();
  }
}
