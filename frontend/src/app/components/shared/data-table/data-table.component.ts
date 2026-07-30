import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  contentChildren,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { MultiSelectModule } from 'primeng/multiselect';
import { DividerModule } from 'primeng/divider';
import { MenuModule } from 'primeng/menu';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { MenuItem } from 'primeng/api';
import { ColTemplateDirective } from './col-template.directive';
import { PreviewTemplateDirective } from './preview-template.directive';
import { GridCardTemplateDirective } from './grid-card-template.directive';
import { CustomTemplateDirective } from './custom-template.directive';
import { SearchInputComponent } from './search-input.component';
import { PageChangeEvent, PaginatorComponent } from './paginator.component';
import { PageTitleService } from '../../../services/page-title.service';
import { TranslateModule } from '@ngx-translate/core';
import * as XLSX from 'xlsx';

/**
 * Table column configuration
 *
 * @example
 * // Simple field
 * { field: 'username', header: 'Username' }
 *
 * @example
 * // Nested field using dot notation
 * { field: 'profile.address.city', header: 'City' }
 *
 * @example
 * // Field with custom template
 * { field: 'status', header: 'Status', template: 'status' }
 *
 * @example
 * // Nested field with custom template
 * { field: 'contact.email', header: 'Email', template: 'email' }
 */
export interface TableColumn {
  /** Field path - supports dot notation for nested objects (e.g., 'profile.address.city') */
  field: string;
  /** Column header text */
  header: string;
  /** Optional template name for custom cell rendering */
  template?: string;
}

/**
 * Export column configuration for Excel export
 *
 * @example
 * // Simple field
 * { field: 'username', header: 'Username' }
 *
 * @example
 * // Nested field using dot notation
 * { field: 'profile.address.city', header: 'City' }
 */
export interface ExportColumn {
  /** Field path - supports dot notation for nested objects */
  field: string;
  /** Column header in exported file */
  header: string;
}

export interface PreviewAction<T = unknown> {
  label: string;
  icon?: string;
  severity?: 'danger' | 'info' | 'warning' | 'success';
  command: (row: T) => void;
  visible?: (row: T) => boolean;
}

export interface LoadDataEvent {
  skip: number;
  limit: number;
  search: string;
}

// UI Preferences - persists across browser refresh (localStorage)
interface UIPreferences {
  size: TableSize;
  hiddenColumns: string[];
  viewMode: ViewMode;
  rows: number;
}

// Navigation state - clears on browser refresh (sessionStorage)
interface NavState {
  page: number;
}

type TableSize = 'small' | 'large' | undefined;
type ViewMode = 'table' | 'grid';

/**
 * Reusable data table component with preview panel, bulk selection, and export.
 *
 * @example
 * // Basic usage with nested fields
 * ```html
 * <app-data-table
 *   [title]="'Users'"
 *   [stateKey]="'users-table'"
 *   [data]="users()"
 *   [columns]="columns"
 *   [loading]="loading()"
 *   [totalRecords]="totalRecords()"
 *   (loadData)="onLoadData($event)"
 * >
 * </app-data-table>
 * ```
 *
 * ```typescript
 * columns: TableColumn[] = [
 *   { field: 'username', header: 'Username' },
 *   { field: 'profile.email', header: 'Email' },           // Nested field
 *   { field: 'profile.address.city', header: 'City' },     // Deep nested field
 *   { field: 'status', header: 'Status', template: 'status' },
 * ];
 * ```
 *
 * @example
 * // Using custom templates
 * ```html
 * <app-data-table [columns]="columns" [data]="data()" ...>
 *
 *   <!-- Template context: row (full object), value (resolved nested value), field (path string) -->
 *   <ng-template appColTemplate="status" let-row let-value="value">
 *     <span [class]="value === 'active' ? 'text-green-500' : 'text-red-500'">
 *       {{ value }}
 *     </span>
 *   </ng-template>
 *
 *   <!-- Preview panel template -->
 *   <ng-template appPreviewTemplate let-row>
 *     <div>{{ row.username }}</div>
 *     <div>{{ row.profile?.address?.city }}</div>
 *   </ng-template>
 *
 *   <!-- Grid card template -->
 *   <ng-template appGridCardTemplate let-row>
 *     <h3>{{ row.username }}</h3>
 *   </ng-template>
 *
 * </app-data-table>
 * ```
 */
@Component({
  selector: 'app-data-table',
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    SkeletonModule,
    PaginatorComponent,
    TooltipModule,
    MultiSelectModule,
    DividerModule,
    MenuModule,
    CardModule,
    CheckboxModule,
    TranslateModule,
  ],
  template: `
    <div
      class="flex h-full"
      [class.gap-4]="showPreview() && selectedRow()"
      [style.--dt-header-bg]="headerBg()"
      [style.--dt-header-fg]="headerFg()"
    >
      <!-- Table Section -->
      <div class="flex flex-col flex-1 min-w-0 ">
        <!-- Toolbar -->
        <div class="shrink-0 flex justify-between items-center pb-4">
          <!-- Left: Actions + Search -->
          <div class="flex items-center gap-2">
            <!-- Add Button (hidden when items selected) -->
            @if (showAdd() && !hasSelection()) {
              <p-button
                size="small"
                icon="fa-solid fa-plus"
                [label]="addLabel()"
                severity="primary"
                (click)="onAddClick()"
                [pTooltip]="'actions.add' | translate"
                tooltipPosition="bottom"
              />
            }

            <!-- Extra toolbar content projected from parent -->
            <ng-content select="[toolbarExtra]" />

            <!-- Bulk Actions (shown when items selected) -->
            @if (hasSelection()) {
              <!-- Edit: only for single selection -->
              @if (hasSingleSelection()) {
                <p-button
                  size="small"
                  icon="fa-solid fa-pen"
                  [label]="'actions.edit' | translate"
                  severity="primary"
                  (click)="onBulkEdit()"
                />
              }
              <!-- Delete: for any selection -->
              <p-button
                size="small"
                icon="fa-solid fa-trash"
                [label]="'actions.delete' | translate"
                severity="danger"
                (click)="onBulkDelete()"
              />
            }

            @if (customTemplate()) {
              <ng-container [ngTemplateOutlet]="customTemplate()!.templateRef"></ng-container>
            }
          </div>

          <!-- Right: Table Tools -->
          <div class="flex items-center gap-2">
            <!-- Column Visibility Toggle -->
            <div class="relative">
              <p-button
                icon="fa-solid fa-table-columns"
                severity="secondary"
                (click)="columnSelect.show()"
                [disabled]="viewMode() === 'grid'"
                [pTooltip]="'actions.columns' | translate"
                tooltipPosition="bottom"
              />
              <p-multiSelect
                #columnSelect
                [options]="selectableColumns()"
                [ngModel]="selectedColumns()"
                (ngModelChange)="onColumnsChange($event)"
                optionLabel="header"
                [showHeader]="false"
                [filter]="false"
                [showToggleAll]="false"
                class="column-select-hidden"
                appendTo="body"
              />
            </div>
            <!-- Export to Excel (shown when enabled, items selected, and exportColumns defined) -->
            @if (showExport() && hasSelection() && exportColumns().length > 0) {
              <p-button
                icon="fa-solid fa-file-excel"
                severity="secondary"
                (click)="onExport()"
                [pTooltip]="'actions.export' | translate"
                tooltipPosition="bottom"
              />
            }
            <!-- Table Size Toggle (compact/normal/large) -->
            <p-button
              [icon]="sizeIcon()"
              severity="secondary"
              (click)="toggleSize()"
              [disabled]="loading() || viewMode() === 'grid'"
              [pTooltip]="sizeTooltipKey() | translate"
              tooltipPosition="bottom"
            />
            <!-- View Mode Toggle (table/grid) -->
            <p-button
              [icon]="viewModeIcon()"
              severity="secondary"
              (click)="toggleViewMode()"
              [disabled]="loading()"
              [pTooltip]="viewModeTooltipKey() | translate"
              tooltipPosition="bottom"
            />
            <!-- Refresh (clears selection) -->
            <p-button
              icon="fa-solid fa-rotate-right"
              severity="secondary"
              [disabled]="loading()"
              (click)="onRefresh()"
              [pTooltip]="'actions.refresh' | translate"
              tooltipPosition="bottom"
            />
          </div>
        </div>

        <!-- Scrollable Container -->
        <div class="flex-1 min-h-0 overflow-auto">
          @if (viewMode() === 'table') {
            <!-- Table with rounded corners -->
            <div class="rounded-lg overflow-hidden h-full">
              @if (loading()) {
                <!-- Skeleton Table -->
                <p-table [value]="skeletonRows" [size]="tableSize()" [scrollable]="true">
                  <ng-template #header>
                    <tr>
                      @if (showBulkSelect()) {
                        <th class="w-12">
                          <p-skeleton width="1.25rem" height="1.25rem" />
                        </th>
                      }
                      @for (col of visibleColumns(); track col.field) {
                        <th [class.text-end]="col.field === 'actions'">
                          {{ col.header }}
                        </th>
                      }
                    </tr>
                  </ng-template>
                  <ng-template #body>
                    <tr>
                      @if (showBulkSelect()) {
                        <td class="w-12">
                          <p-skeleton width="1.25rem" height="1.25rem" />
                        </td>
                      }
                      @for (col of visibleColumns(); track col.field) {
                        <td [class.text-end]="col.field === 'actions'">
                          <p-skeleton width="100%" height="1rem" />
                        </td>
                      }
                    </tr>
                  </ng-template>
                </p-table>
              } @else {
                <!-- Data Table -->
                <p-table
                  [value]="data()"
                  [size]="tableSize()"
                  [scrollable]="true"
                  scrollHeight="flex"
                >
                  <ng-template #header>
                    <tr>
                      @if (showBulkSelect()) {
                        <th class="w-12">
                          <p-checkbox
                            [binary]="true"
                            [ngModel]="allCurrentPageSelected()"
                            (onChange)="toggleSelectAll()"
                          />
                        </th>
                      }
                      @for (col of visibleColumns(); track col.field) {
                        <th [class.text-end]="col.field === 'actions'" class="m-10">
                          {{ col.header }}
                        </th>
                      }
                    </tr>
                  </ng-template>
                  <ng-template #body let-row>
                    <tr
                      [class.cursor-pointer]="showPreview()"
                      [class.row-selected]="
                        (showPreview() && selectedRow() === row) || isRowSelected(row)
                      "
                      (click)="onRowClick(row)"
                    >
                      @if (showBulkSelect()) {
                        <td class="w-12" (click)="$event.stopPropagation()">
                          <p-checkbox
                            [binary]="true"
                            [ngModel]="isRowSelected(row)"
                            (onChange)="toggleRowSelection(row)"
                          />
                        </td>
                      }
                      @for (col of visibleColumns(); track col.field) {
                        <td [class.text-end]="col.field === 'actions'">
                          @if (col.template && getTemplate(col.template); as tmpl) {
                            <ng-container
                              [ngTemplateOutlet]="tmpl"
                              [ngTemplateOutletContext]="{
                                $implicit: row,
                                row: row,
                                value: getNestedValue(row, col.field),
                                field: col.field,
                              }"
                            />
                          } @else {
                            {{ getNestedValue(row, col.field) }}
                          }
                        </td>
                      }
                    </tr>
                  </ng-template>
                  <ng-template #emptymessage>
                    <tr>
                      <td [attr.colspan]="visibleColumns().length + (showBulkSelect() ? 1 : 0)">
                        <div
                          class="flex flex-col items-center justify-center py-12 text-surface-500"
                        >
                          <img
                            src="images/empty-grid.svg"
                            alt="No data"
                            class="empty-img w-24 h-24 mb-3 opacity-50"
                          />
                          <span>{{ 'common.noRecords' | translate }}</span>
                        </div>
                      </td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </div>
          } @else {
            <!-- Grid View -->
            @if (loading()) {
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
                @for (item of skeletonRows; track item) {
                  <p-card>
                    <p-skeleton width="60%" height="1.25rem" styleClass="mb-3" />
                    <p-skeleton width="100%" height="0.875rem" styleClass="mb-2" />
                    <p-skeleton width="80%" height="0.875rem" />
                  </p-card>
                }
              </div>
            } @else if (data().length === 0) {
              <div class="flex flex-col items-center justify-center py-16 text-surface-500">
                <img
                  src="images/empty-grid.svg"
                  alt="No data"
                  class="empty-img w-32 h-32 mb-4 opacity-50"
                />
                <span class="text-lg">{{ 'common.noRecords' | translate }}</span>
              </div>
            } @else {
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
                @for (row of data(); track row) {
                  <div
                    class="grid-card-wrapper"
                    [class.cursor-pointer]="showPreview()"
                    [class.card-selected]="showPreview() && selectedRow() === row"
                    (click)="onRowClick(row)"
                  >
                    <p-card>
                      <ng-container
                        [ngTemplateOutlet]="gridCardTemplate()!.templateRef"
                        [ngTemplateOutletContext]="{ $implicit: row, row: row }"
                      />
                    </p-card>
                  </div>
                }
              </div>
            }
          }
        </div>

        <!-- Paginator (sticky bottom) -->
        @if (!loading() && totalRecords() > 0) {
          <div class="shrink-0 pt-3">
            <app-paginator
              [page]="page()"
              [rows]="rows()"
              [totalRecords]="totalRecords()"
              (pageChange)="onPageChange($event)"
            />
          </div>
        }
      </div>

      <!-- Preview Side Panel -->
      <div
        class="preview-panel shrink-0 flex flex-col    overflow-hidden rounded-xl  app-card-nested "
        [class.preview-panel-open]="showPreview() && selectedRow()"
      >
        @if (showPreview() && selectedRow()) {
          <!-- Panel Header -->
          <div class="flex items-center justify-between  p-4">
            <span class="font-semibold text-sm">{{ 'common.details' | translate }}</span>
            <div class="flex items-center gap-1">
              @if (previewActions().length > 0) {
                <p-button
                  icon="fa-solid fa-ellipsis-vertical"
                  [rounded]="true"
                  [text]="true"
                  severity="secondary"
                  size="small"
                  (click)="actionsMenu.toggle($event)"
                />
                <p-menu #actionsMenu [model]="menuItems()" [popup]="true" appendTo="body" />
              }
              <p-button
                icon="fa-solid fa-xmark"
                [rounded]="true"
                [text]="true"
                severity="secondary"
                size="small"
                (click)="closePreview()"
              />
            </div>
          </div>

          <!-- Panel Content (custom template from parent) -->
          <div class=" flex-1 overflow-auto p-4">
            @if (previewTemplate()) {
              <ng-container
                [ngTemplateOutlet]="previewTemplate()!.templateRef"
                [ngTemplateOutletContext]="{ $implicit: selectedRow(), row: selectedRow() }"
              />
            } @else {
              <!-- Default preview content -->
              <div class="space-y-3">
                @for (col of previewColumns(); track col.field) {
                  <div>
                    <div class="text-xs text-surface-500 mb-1">{{ col.header }}</div>
                    <div class="text-sm font-medium">
                      {{ getNestedValue(selectedRow(), col.field) ?? '—' }}
                    </div>
                  </div>
                  <p-divider />
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    :host ::ng-deep .p-datatable .p-datatable-table {
      border-radius: 0;
    }
    .dark :host ::ng-deep .p-datatable .p-datatable-thead > tr > th,
    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th {
      background: var(--dt-header-bg);
      color: var(--dt-header-fg);
      border: none;
    }

    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th:first-child {
      border-top-left-radius: 0;
    }
    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th:last-child {
      border-top-right-radius: 0;
    }
    :host ::ng-deep .p-datatable .p-datatable-tbody > tr:last-child > td:first-child {
      border-bottom-left-radius: 0;
    }
    :host ::ng-deep .p-datatable .p-datatable-tbody > tr:last-child > td:last-child {
      border-bottom-right-radius: 0;
    }
    :host ::ng-deep .column-select-hidden {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
    :host ::ng-deep .p-datatable .p-datatable-tbody > tr.row-selected > td {
      background: var(--p-primary-50);
    }
    .dark :host ::ng-deep .p-datatable .p-datatable-tbody > tr.row-selected > td {
      background: var(--p-surface-600);
    }
    :host ::ng-deep .p-datatable .p-datatable-tbody > tr.cursor-pointer:hover > td {
      background: var(--p-surface-100);
    }
    .dark :host ::ng-deep .p-datatable .p-datatable-tbody > tr.cursor-pointer:hover > td {
      background: var(--p-surface-700);
    }
    .grid-card-wrapper ::ng-deep .p-card {
      transition: box-shadow 0.2s ease;
    }
    .grid-card-wrapper.cursor-pointer:hover ::ng-deep .p-card {
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .grid-card-wrapper.card-selected ::ng-deep .p-card {
      border-color: var(--p-primary-500);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    :host-context(.dark) .empty-img {
      filter: invert(1);
    }
    .preview-panel {
      width: 0;
      opacity: 0;
      transition:
        width 0.3s ease,
        opacity 0.3s ease;
    }
    .preview-panel-open {
      width: 20rem;
      opacity: 1;
    }
    :host ::ng-deep .p-menuitem-danger .p-menuitem-link {
      color: var(--p-red-500) !important;
    }
    :host ::ng-deep .p-menuitem-danger .p-menuitem-link:hover {
      background: var(--p-red-50) !important;
    }
    .dark :host ::ng-deep .p-menuitem-danger .p-menuitem-link:hover {
      background: var(--p-red-900) !important;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent implements OnInit, OnDestroy {
  private pageTitleService = inject(PageTitleService);
  private router = inject(Router);
  tableSize = signal<TableSize>('small');
  hiddenColumns = signal<string[]>([]);
  selectedRow = signal<unknown | null>(null);
  viewMode = signal<ViewMode>('table');
  showSearch = input<boolean>(true); // Show/hide search input
  // Bulk selection state - stores row data (Map<id, row>) for persistence across pagination/filtering
  selectedRowsMap = signal<Map<string, unknown>>(new Map());
  selectionCount = computed(() => this.selectedRowsMap().size);
  hasSelection = computed(() => this.selectedRowsMap().size > 0);

  hasSingleSelection = computed(() => this.selectedRowsMap().size === 1);
  allCurrentPageSelected = computed(() => {
    const data = this.data();
    const selectedMap = this.selectedRowsMap();
    if (data.length === 0) return false;
    return data.every((row) => selectedMap.has(this.getRowId(row)));
  });

  // Internal pagination state
  page = signal(0);
  rows = signal(25);
  searchTerm = signal('');

  sizeIcon = computed(() => {
    const s = this.tableSize();
    if (s === 'small') return 'fa-solid fa-compress';
    if (s === 'large') return 'fa-solid fa-expand';
    return 'fa-solid fa-table';
  });
  sizeTooltipKey = computed(() => {
    const s = this.tableSize();
    if (s === 'small') return 'table.compact';
    if (s === 'large') return 'table.large';
    return 'table.normal';
  });

  viewModeIcon = computed(() =>
    this.viewMode() === 'table' ? 'fa-solid fa-grip' : 'fa-solid fa-table',
  );
  viewModeTooltipKey = computed(() =>
    this.viewMode() === 'table' ? 'table.gridView' : 'table.tableView',
  );

  // Columns that can be toggled (excludes actions)
  selectableColumns = computed(() => this.columns().filter((c) => c.field !== 'actions'));

  // Currently selected columns (not hidden)
  selectedColumns = computed(() =>
    this.selectableColumns().filter((c) => !this.hiddenColumns().includes(c.field)),
  );

  // All visible columns including actions
  visibleColumns = computed(() =>
    this.columns().filter((c) => !this.hiddenColumns().includes(c.field)),
  );

  // Columns to show in preview panel (excludes actions)
  previewColumns = computed(() => this.visibleColumns().filter((c) => c.field !== 'actions'));

  // Menu items for preview actions dropdown
  menuItems = computed<MenuItem[]>(() => {
    const row = this.selectedRow();
    if (!row) return [];
    return this.previewActions()
      .filter((action) => !action.visible || action.visible(row))
      .map((action) => ({
        label: action.label,
        icon: action.icon,
        styleClass: action.severity === 'danger' ? 'p-menuitem-danger' : '',
        command: () => (action.command as (row: unknown) => void)(row),
      }));
  });

  // Inputs
  title = input.required<string>();
  stateKey = input.required<string>();
  data = input.required<unknown[]>();
  columns = input.required<TableColumn[]>();
  loading = input<boolean>(false);
  showPreview = input<boolean>(false);
  showAdd = input<boolean>(false);
  showBulkSelect = input<boolean>(false);
  addLabel = input<string>('Add');
  previewActions = input<PreviewAction<any>[]>([]);
  searchPlaceholder = input<string>('Search...');
  totalRecords = input<number>(0);
  previewKey = input<string>();
  rowKey = input<string>('id'); // Key field for row identification (selection persistence)
  showExport = input<boolean>(false); // Enable/disable export functionality
  exportColumns = input<ExportColumn[]>([]); // Columns to export (defined by parent)
  defaultViewMode = input<'table' | 'grid'>('table'); // Initial view mode
  editMode = input<'dialog' | 'route'>('route'); // Edit behavior: dialog or route navigation
  editRoute = input<string>(''); // Base route for navigation (ID will be appended)
  headerBg = input<string>('var(--p-primary-color)'); // Header background color
  headerFg = input<string>('var(--p-primary-contrast-color)'); // Header text color

  // Outputs
  loadData = output<LoadDataEvent>();
  add = output<void>();
  edit = output<unknown>();
  bulkDelete = output<string[]>(); // Emits array of row IDs

  // Content children for custom templates
  colTemplates = contentChildren(ColTemplateDirective);
  previewTemplate = contentChild(PreviewTemplateDirective);
  gridCardTemplate = contentChild(GridCardTemplateDirective);
  customTemplate = contentChild(CustomTemplateDirective);

  // Skeleton rows for loading state
  skeletonRows = [1, 2, 3, 4, 5];

  constructor() {
    effect(() => {
      const base = this.title();
      const row = this.selectedRow() as Record<string, unknown> | null;
      const key = this.previewKey();

      if (row && key && row[key]) {
        this.pageTitleService.setTitle(`${base} / ${row[key]}`);
      } else {
        this.pageTitleService.setTitle(base);
      }
    });

    // Sync selection count with PageTitleService
    effect(() => {
      const count = this.selectionCount();
      if (this.showBulkSelect()) {
        this.pageTitleService.setSelection(count, () => this.clearSelection());
      }
    });

    // Sync loading state with search in title bar
    effect(() => {
      this.pageTitleService.updateSearchLoading(this.loading());
    });
  }

  ngOnInit(): void {
    // Set initial view mode from input (loadState may override from session)
    this.viewMode.set(this.defaultViewMode());
    this.loadState();

    // Register search in title bar
    if (this.showSearch()) {
      this.pageTitleService.setSearch({
        placeholder: this.searchPlaceholder(),
        loading: this.loading(),
        initialValue: this.searchTerm(),
        callback: (term: string) => this.onSearch(term),
      });
    }

    this.emitLoadData();
  }

  ngOnDestroy(): void {
    this.pageTitleService.resetSelection();
    this.pageTitleService.resetSearch();
  }

  private emitLoadData(): void {
    this.loadData.emit({
      skip: this.page() * this.rows(),
      limit: this.rows(),
      search: this.searchTerm(),
    });
  }

  onRefresh(): void {
    this.closePreview();
    this.clearSelection();
    this.emitLoadData();
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.page.set(0);
    this.saveState();
    this.emitLoadData();
  }

  onPageChange(event: PageChangeEvent): void {
    this.page.set(event.page);
    this.rows.set(event.rows);
    this.saveState();
    this.emitLoadData();
  }

  getTemplate(name: string): TemplateRef<unknown> | null {
    const template = this.colTemplates().find((t) => t.name === name);
    return template ? template.templateRef : null;
  }

  /**
   * Get nested value from object using dot notation.
   * Safely handles null/undefined at any level of the path.
   *
   * @param obj - The object to extract value from
   * @param path - Dot notation path (e.g., 'profile.address.city')
   * @returns The value at the path, or undefined if not found
   *
   * @example
   * // Given: { profile: { address: { city: 'NYC' } } }
   * getNestedValue(row, 'profile.address.city')  // Returns: 'NYC'
   * getNestedValue(row, 'profile.address.zip')   // Returns: undefined
   * getNestedValue(row, 'contact.email')         // Returns: undefined (contact is undefined)
   */
  getNestedValue(obj: unknown, path: string): unknown {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((current: unknown, key: string) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  toggleSize(): void {
    const sizes: TableSize[] = ['small', undefined, 'large'];
    const current = sizes.indexOf(this.tableSize());
    this.tableSize.set(sizes[(current + 1) % sizes.length]);
    this.saveState();
  }

  toggleViewMode(): void {
    this.viewMode.set(this.viewMode() === 'table' ? 'grid' : 'table');
    this.saveState();
  }

  onColumnsChange(selected: TableColumn[]): void {
    const selectedFields = selected.map((c) => c.field);
    const hidden = this.selectableColumns()
      .filter((c) => !selectedFields.includes(c.field))
      .map((c) => c.field);
    this.hiddenColumns.set(hidden);
    this.saveState();
  }

  onRowClick(row: unknown): void {
    if (!this.showPreview()) return;
    this.selectedRow.set(this.selectedRow() === row ? null : row);
  }

  closePreview(): void {
    this.selectedRow.set(null);
  }

  /*
   * ==========================================
   * BULK SELECTION
   * ==========================================
   * Selection persists across:
   * - Pagination (navigate between pages)
   * - Filtering/Search (find items across different filters)
   *
   * Selection clears on:
   * - Refresh button click
   * - Browser refresh (via session token)
   * - Clear selection button in header
   *
   * Stores full row data (Map<id, row>) to enable export across pages.
   */

  /** Get unique identifier for a row */
  getRowId(row: unknown): string {
    return String((row as Record<string, unknown>)[this.rowKey()] ?? '');
  }

  /** Toggle select/deselect all items on current page */
  toggleSelectAll(): void {
    const data = this.data();
    const currentMap = this.selectedRowsMap();
    const newMap = new Map(currentMap);

    if (this.allCurrentPageSelected()) {
      data.forEach((row) => newMap.delete(this.getRowId(row)));
    } else {
      data.forEach((row) => newMap.set(this.getRowId(row), row));
    }
    this.selectedRowsMap.set(newMap);
  }

  /** Toggle selection for a single row */
  toggleRowSelection(row: unknown): void {
    const id = this.getRowId(row);
    const currentMap = this.selectedRowsMap();
    const newMap = new Map(currentMap);
    if (newMap.has(id)) {
      newMap.delete(id);
    } else {
      newMap.set(id, row);
    }
    this.selectedRowsMap.set(newMap);
  }

  /** Check if a row is selected */
  isRowSelected(row: unknown): boolean {
    return this.selectedRowsMap().has(this.getRowId(row));
  }

  /** Clear all selections */
  clearSelection(): void {
    this.selectedRowsMap.set(new Map());
  }

  /** Handle edit action for single selected item */
  onBulkEdit(): void {
    if (!this.hasSingleSelection()) return;
    const row = Array.from(this.selectedRowsMap().values())[0];
    if (!row) return;

    if (this.editMode() === 'route' && this.editRoute()) {
      // Navigate to edit route
      const id = this.getRowId(row);
      const rowRecord = row as Record<string, unknown>;
      const displayKey = rowRecord[this.previewKey() || this.rowKey()] || id;
      this.router.navigate([this.editRoute(), id], {
        state: { displayKey },
      });
      this.clearSelection();
    } else {
      // Emit for dialog handling
      this.edit.emit(row);
      this.clearSelection();
    }
  }

  /** Handle delete action - emits array of selected IDs */
  onBulkDelete(): void {
    if (!this.hasSelection()) return;
    this.bulkDelete.emit(Array.from(this.selectedRowsMap().keys()));
  }

  /** Handle add button click */
  onAddClick(): void {
    if (this.editMode() === 'route' && this.editRoute()) {
      // Navigate to add route with 'new' as ID
      this.router.navigate([this.editRoute(), 'new']);
    } else {
      // Emit for dialog handling
      this.add.emit();
    }
  }

  /** Export selected rows to Excel */
  onExport(): void {
    if (!this.hasSelection()) return;
    const columns = this.exportColumns();
    if (columns.length === 0) return;

    const selectedRows = Array.from(this.selectedRowsMap().values());

    // Build export data with column headers
    const exportData = selectedRows.map((row) => {
      const rowData: Record<string, unknown> = {};
      columns.forEach((col) => {
        rowData[col.header] = this.getNestedValue(row, col.field) ?? '';
      });
      return rowData;
    });

    // Create worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    // Generate filename with title and date
    const title = this.title().replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];
    const filename = `${title}_${date}.xlsx`;

    // Download
    XLSX.writeFile(workbook, filename);
  }

  private get prefsKey(): string {
    return `dt-prefs-${this.stateKey()}`;
  }

  private get navKey(): string {
    return `dt-nav-${this.stateKey()}`;
  }

  private saveState(): void {
    // UI Preferences → localStorage (persists across browser refresh)
    const prefs: UIPreferences = {
      size: this.tableSize(),
      hiddenColumns: this.hiddenColumns(),
      viewMode: this.viewMode(),
      rows: this.rows(),
    };
    localStorage.setItem(this.prefsKey, JSON.stringify(prefs));

    // Navigation state → sessionStorage (clears on browser refresh)
    const nav: NavState = {
      page: this.page(),
    };
    sessionStorage.setItem(this.navKey, JSON.stringify(nav));
  }

  private loadState(): void {
    // Load UI Preferences from localStorage
    const prefsRaw = localStorage.getItem(this.prefsKey);
    if (prefsRaw) {
      try {
        const prefs: UIPreferences = JSON.parse(prefsRaw);
        if (prefs.size !== undefined) this.tableSize.set(prefs.size);
        if (prefs.hiddenColumns?.length) this.hiddenColumns.set(prefs.hiddenColumns);
        if (prefs.viewMode) this.viewMode.set(prefs.viewMode);
        if (prefs.rows !== undefined) this.rows.set(prefs.rows);
      } catch {
        // ignore invalid state
      }
    }

    // Load Navigation state from sessionStorage
    const navRaw = sessionStorage.getItem(this.navKey);
    if (navRaw) {
      try {
        const nav: NavState = JSON.parse(navRaw);
        if (nav.page !== undefined) this.page.set(nav.page);
      } catch {
        // ignore invalid state
      }
    }
  }
}
