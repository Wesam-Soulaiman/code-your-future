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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
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
import {
  ProfileCatalogItem,
  ProfileCatalogItemInput,
  catalogItemName,
} from '../../models/ProfileCatalogItem';
import { ChangeLangService } from '../../services/change-lang.service';
import { ProfileCatalogApiService } from '../../services/dataService/profile-catalog-service';
import { CatalogErrorKey, mapCatalogError } from '../../utils/catalog-error';
import {
  CATALOG_TABS,
  CATALOG_TYPE,
  CatalogType,
  INSTITUTION_KIND,
  INSTITUTION_KINDS,
  InstitutionKind,
  CATALOG_LIMITS,
  CATALOG_SORT_ORDER,
  normaliseCatalogCode,
} from '../../utils/profile-catalog-constants';

/** The dialog's working copy. */
interface CatalogForm {
  code: string;
  nameEn: string;
  nameAr: string;
  sortOrder: number;
  active: boolean;
  institutionKind: InstitutionKind;
  isOther: boolean;
}

const EMPTY_FORM: CatalogForm = {
  code: '',
  nameEn: '',
  nameAr: '',
  sortOrder: 0,
  active: true,
  institutionKind: INSTITUTION_KIND.UNIVERSITY,
  isOther: false,
};

/**
 * Profile Catalogs — the Admin screen behind the Student form's four selects.
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 * The institution list used to be a hard-coded array in two source files. Cities
 * and majors were free text, which meant "Damascus", "damascus", and "Dmascus"
 * were three different places. Both are now one Admin-managed catalog, so
 * correcting a spelling is an edit here rather than a deployment — and it
 * corrects every profile that points at it at once.
 *
 * ── Deleting versus deactivating ────────────────────────────────────────────
 * An unused item can be deleted outright. An item some Student has already
 * chosen **cannot** be, and the backend refuses it with `CATALOG_IN_USE`;
 * cascading would silently blank a field in somebody's profile. Deactivating is
 * the answer, and the page says so rather than leaving an Admin to guess: a
 * deactivated value keeps displaying on the profiles that hold it and stops
 * being offered to anybody new.
 *
 * ── Honesty ─────────────────────────────────────────────────────────────────
 * Empty means empty. Cities, majors, and target roles ship with **no** seeded
 * data, because no authoritative list exists and inventing one would put
 * plausible-looking options in front of Students that nobody approved.
 */
@Component({
  selector: 'app-profile-catalogs',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DataTableComponent,
    ColTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
    SelectModule,
    AlertComponent,
  ],
  templateUrl: './profile-catalogs.component.html',
  styleUrl: './profile-catalogs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCatalogsComponent {
  private catalogApi = inject(ProfileCatalogApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  protected readonly tabs = CATALOG_TABS;
  protected readonly limits = CATALOG_LIMITS;
  protected readonly sortBounds = CATALOG_SORT_ORDER;
  protected readonly institutionKinds = INSTITUTION_KINDS;
  protected readonly institutionType = CATALOG_TYPE.INSTITUTION;

  protected activeType = signal<CatalogType>(CATALOG_TYPE.CITY);
  protected items = signal<ProfileCatalogItem[]>([]);
  protected supportsOther = signal(false);

  protected loading = signal(true);
  protected busy = signal(false);
  protected search = signal('');
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);

  protected errorKey = signal<CatalogErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});

  /** Dialog state. `editing` is the item being changed, or null for a new one. */
  protected dialogOpen = signal(false);
  protected editing = signal<ProfileCatalogItem | null>(null);
  protected form = signal<CatalogForm>({ ...EMPTY_FORM });

  /** Delete confirmation, so a permanent action needs a second deliberate click. */
  protected confirming = signal<ProfileCatalogItem | null>(null);

  protected isInstitutionTab = computed(() => this.activeType() === CATALOG_TYPE.INSTITUTION);

  /** Options for the institution sub-kind select. */
  protected kindOptions = computed(() =>
    INSTITUTION_KINDS.map((kind) => ({
      value: kind,
      label: `admin.catalogs.kind.${kind.toLowerCase()}`,
    })),
  );

  /**
   * The code preview.
   *
   * Shown while typing because the backend normalises what it is given, and an
   * Admin who types `Damascus Univ.` should see `DAMASCUS_UNIV` before they save
   * rather than discover it afterwards.
   */
  protected codePreview = computed(() => normaliseCatalogCode(this.form().code));

  /** Client-side filtering of the loaded list, so typing feels instant. */
  protected filteredItems = computed(() => {
    const term = this.search().trim().toLowerCase();
    const all = this.items();
    if (!term) return all;
    return all.filter(
      (item) =>
        item.nameEn.toLowerCase().includes(term) ||
        item.nameAr.toLowerCase().includes(term) ||
        item.code.toLowerCase().includes(term),
    );
  });

  protected visibleItems = computed(() => {
    const event = this.lastLoadEvent() ?? { skip: 0, limit: 25, search: '' };
    return this.filteredItems().slice(event.skip, event.skip + event.limit);
  });

  protected totalRecords = computed(() => this.filteredItems().length);

  /**
   * The columns, in the template table's own shape.
   *
   * Computed rather than fixed because the institution tab carries one column
   * the other three do not.
   */
  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    const columns: TableColumn[] = [
      {
        field: 'sortOrder',
        header: this.translate.instant('admin.catalogs.columns.order'),
        template: 'order',
      },
      {
        field: 'nameEn',
        header: this.translate.instant('admin.catalogs.columns.nameEn'),
        template: 'nameEn',
      },
      {
        field: 'nameAr',
        header: this.translate.instant('admin.catalogs.columns.nameAr'),
        template: 'nameAr',
      },
      {
        field: 'code',
        header: this.translate.instant('admin.catalogs.columns.code'),
        template: 'code',
      },
    ];

    if (this.isInstitutionTab()) {
      columns.push({
        field: 'institutionKind',
        header: this.translate.instant('admin.catalogs.columns.kind'),
        template: 'kind',
      });
    }

    columns.push(
      {
        field: 'active',
        header: this.translate.instant('admin.catalogs.columns.status'),
        template: 'status',
      },
      {
        field: 'actions',
        header: this.translate.instant('admin.catalogs.columns.actions'),
        template: 'actions',
      },
    );

    return columns;
  });

  protected isEmpty = computed(() => !this.loading() && this.items().length === 0);
  protected noMatches = computed(
    () => !this.loading() && this.items().length > 0 && this.visibleItems().length === 0,
  );

  /** Guards the language effect's first run, which the constructor covers. */
  private languageWatched = false;

  constructor() {
    // The server sorts by the localised name, so a language change reorders the
    // list — not just its labels.
    //
    // `untracked` matters: the reload writes `loading`, and reading that signal
    // inside a tracked effect would make the effect depend on its own side
    // effect and reload forever. The language is the only dependency.
    effect(() => {
      const language = this.langService.currentLang();
      untracked(() => {
        if (this.languageWatched) this.reload(language);
        else this.languageWatched = true;
      });
    });
  }

  protected itemName(item: ProfileCatalogItem): string {
    return catalogItemName(item, this.langService.currentLang());
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  protected selectTab(type: CatalogType): void {
    if (this.activeType() === type) return;
    this.activeType.set(type);
    this.search.set('');
    this.lastLoadEvent.set(null);
    this.errorKey.set(null);
    this.noticeKey.set(null);
    this.reload();
  }

  private reload(language = this.langService.currentLang()): void {
    this.loading.set(true);
    this.catalogApi
      .adminList(this.activeType(), language)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => {
          this.items.set(response.items ?? []);
          this.supportsOther.set(response.supportsOther === true);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.items.set([]);
          this.errorKey.set(mapCatalogError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected refresh(): void {
    this.errorKey.set(null);
    this.noticeKey.set(null);
    this.reload();
  }

  protected onLoadData(event: LoadDataEvent): void {
    const previous = this.lastLoadEvent();
    this.lastLoadEvent.set(event);
    this.search.set(event.search.slice(0, CATALOG_LIMITS.search.max));

    if (
      !previous ||
      (previous.skip === event.skip &&
        previous.limit === event.limit &&
        previous.search === event.search)
    ) {
      this.refresh();
    }
  }

  protected updateSearch(value: string): void {
    this.search.set(value.slice(0, CATALOG_LIMITS.search.max));
  }

  // ── Dialog ────────────────────────────────────────────────────────────────

  protected openCreate(): void {
    this.editing.set(null);
    this.fieldErrors.set({});
    this.errorKey.set(null);
    this.form.set({
      ...EMPTY_FORM,
      // Ten past the current maximum, so a new row lands at the end without
      // renumbering anything.
      sortOrder: this.items().reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10,
    });
    this.dialogOpen.set(true);
  }

  protected openEdit(item: ProfileCatalogItem): void {
    this.editing.set(item);
    this.fieldErrors.set({});
    this.errorKey.set(null);
    this.form.set({
      code: item.code,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      sortOrder: item.sortOrder,
      active: item.active,
      institutionKind: item.institutionKind ?? INSTITUTION_KIND.UNIVERSITY,
      isOther: item.isOther === true,
    });
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (this.busy()) return;
    this.dialogOpen.set(false);
    this.editing.set(null);
  }

  protected updateForm<K extends keyof CatalogForm>(field: K, value: CatalogForm[K]): void {
    this.form.update((current) => ({ ...current, [field]: value }));
    if (this.fieldErrors()[field]) {
      this.fieldErrors.update((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  protected fieldError(field: string): string | null {
    return this.fieldErrors()[field] ?? null;
  }

  /** Save the dialog. The backend re-validates and owns uniqueness. */
  protected submit(): void {
    if (this.busy()) return;

    const form = this.form();
    const type = this.activeType();

    const input: ProfileCatalogItemInput = {
      type,
      code: form.code,
      nameEn: form.nameEn.trim(),
      nameAr: form.nameAr.trim(),
      active: form.active,
      sortOrder: form.sortOrder,
    };

    // The two institution-only fields travel only for institutions; sending
    // them elsewhere is a validation failure, by design.
    if (type === CATALOG_TYPE.INSTITUTION) {
      input.institutionKind = form.institutionKind;
      if (form.isOther) input.isOther = true;
    }

    this.busy.set(true);
    this.errorKey.set(null);
    this.fieldErrors.set({});

    const editing = this.editing();
    const request = editing
      ? this.catalogApi.adminUpdate(editing.id, input)
      : this.catalogApi.adminCreate(input);

    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.dialogOpen.set(false);
        this.editing.set(null);
        this.noticeKey.set(
          editing ? 'admin.catalogs.notices.updated' : 'admin.catalogs.notices.created',
        );
        this.reload();
      },
      error: (error: unknown) => {
        const failure = mapCatalogError(error);
        this.errorKey.set(failure.key);
        this.fieldErrors.set(failure.fields);
        this.changeDetector.markForCheck();
      },
    });
  }

  // ── Activation ────────────────────────────────────────────────────────────

  /**
   * Activate or deactivate.
   *
   * Always allowed, including for an item Students reference — that is exactly
   * what deactivation is for.
   */
  protected toggleActive(item: ProfileCatalogItem): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);

    this.catalogApi
      .adminSetActive(item.id, this.activeType(), !item.active)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (updated) => {
          this.items.update((current) =>
            current.map((entry) => (entry.id === updated.id ? updated : entry)),
          );
          this.noticeKey.set(
            updated.active
              ? 'admin.catalogs.notices.activated'
              : 'admin.catalogs.notices.deactivated',
          );
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapCatalogError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  // ── Deletion ──────────────────────────────────────────────────────────────

  protected confirmDelete(item: ProfileCatalogItem): void {
    this.errorKey.set(null);
    this.noticeKey.set(null);
    this.confirming.set(item);
  }

  protected cancelDelete(): void {
    if (this.busy()) return;
    this.confirming.set(null);
  }

  /**
   * Delete for real.
   *
   * A referenced item comes back as `CATALOG_IN_USE`, and the page explains
   * that deactivating is what to do instead — the backend is the one that
   * knows, so the browser does not pre-guess and offer a delete that will fail.
   */
  protected deleteConfirmed(): void {
    const item = this.confirming();
    if (!item || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    this.catalogApi
      .adminDelete(item.id, this.activeType())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.confirming.set(null);
          this.items.update((current) => current.filter((entry) => entry.id !== item.id));
          this.noticeKey.set('admin.catalogs.notices.deleted');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.confirming.set(null);
          this.errorKey.set(mapCatalogError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }
}
