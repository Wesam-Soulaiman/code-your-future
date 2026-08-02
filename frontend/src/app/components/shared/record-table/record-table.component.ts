import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  inject,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';

import { ChangeLangService } from '../../../services/change-lang.service';
import { ColTemplateDirective } from '../data-table/col-template.directive';
import { PageChangeEvent, PaginatorComponent } from '../data-table/paginator.component';
import { TableColumn } from '../data-table/data-table.component';

/**
 * A record list, in the original template's visual language ⟨CP4 closeout⟩.
 *
 * ── What this restores, and why it was needed ───────────────────────────────
 * The template ships `app-data-table`: a PrimeNG `p-table` with the template's
 * header, row, hover, and empty-state styling, and `app-paginator` beneath it —
 * a `p-paginator` with **page-number buttons, first/last controls, a
 * rows-per-page selector, and a current-page report**.
 *
 * Nothing used it. Every list built since — Profile Catalogs in Checkpoint 3A,
 * then Batches, Students, and the Batch roster in Checkpoint 4 — hand-rolled a
 * bare `<table>` with bespoke `.cyf-*-table` rules and a pair of Previous/Next
 * buttons. Four pages, four nearly-identical stylesheets, and a pagination
 * control that could not tell you which page you were on.
 *
 * This component puts those lists back on the template's table and the
 * template's paginator. It reuses `app-paginator` **as it is** rather than
 * restyling it, so the buttons are the ones the template drew.
 *
 * ── Why not `app-data-table` itself ─────────────────────────────────────────
 * `app-data-table` is kept, untouched, and still exported — it carries bulk
 * selection, Excel export, a preview panel, column visibility, and a grid mode,
 * and those are template capabilities that must not be deleted. But it also
 * registers its search box into the shell's title bar through `PageTitleService`
 * and owns its own paging state, which fights with pages that already hold
 * filters, a status select, and a search term of their own.
 *
 * So this is the narrow slice those four pages actually need — the same
 * `p-table`, the same `app-paginator`, the same column-template directive — with
 * paging left where it already lives: in the page, against the server.
 *
 * ── A wide table on a narrow screen ─────────────────────────────────────────
 * PrimeNG scrolls it, on its own `.p-datatable-table-container` — 633px of
 * table inside a 333px card on a 390px phone, verified in a browser. The card
 * around it clips rather than scrolls, which is what makes the header follow
 * the corner radius; the two do not fight because they are different elements.
 *
 * That container is not focusable and carries no accessible name, so the
 * off-screen columns cannot be reached by keyboard alone. That is PrimeNG's
 * own long-standing behaviour and `node_modules` is not ours to patch, so it is
 * recorded in the handoff rather than worked around here — an earlier attempt
 * to take the scrolling over produced a labelled element that did not actually
 * scroll, which is worse than the honest version.
 *
 * ── Server-side paging is preserved exactly ─────────────────────────────────
 * This component holds **no** data and does **no** slicing. It renders the rows
 * it is given and emits `pageChange`; the page turns that into the next request.
 * There is no client-side pagination anywhere in it.
 */
@Component({
  selector: 'cyf-record-table',
  imports: [
    NgTemplateOutlet,
    TranslateModule,
    TableModule,
    SkeletonModule,
    PaginatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cyf-record-table">
      <!-- The card clips, which is what makes the header follow its radius.
           PrimeNG scrolls the table inside it. -->
      <div class="cyf-record-table-surface">
        @if (loading()) {
          <p-table [value]="skeletonRows" [size]="size()" styleClass="cyf-table">
            <ng-template #header>
              <tr>
                @for (col of columns(); track col.field) {
                  <th [class.text-end]="col.field === 'actions'">{{ col.header | translate }}</th>
                }
              </tr>
            </ng-template>
            <ng-template #body>
              <tr>
                @for (col of columns(); track col.field) {
                  <td [class.text-end]="col.field === 'actions'">
                    <p-skeleton width="100%" height="1rem" />
                  </td>
                }
              </tr>
            </ng-template>
          </p-table>
        } @else {
          <p-table [value]="data()" [size]="size()" styleClass="cyf-table">
            <ng-template #header>
              <tr>
                @for (col of columns(); track col.field) {
                  <th [class.text-end]="col.field === 'actions'">{{ col.header | translate }}</th>
                }
              </tr>
            </ng-template>

            <ng-template #body let-row>
              <tr>
                @for (col of columns(); track col.field) {
                  <td [class.text-end]="col.field === 'actions'">
                    @if (col.template && templateFor(col.template); as tmpl) {
                      <ng-container
                        [ngTemplateOutlet]="tmpl"
                        [ngTemplateOutletContext]="{
                          $implicit: row,
                          row: row,
                          value: valueOf(row, col.field),
                          field: col.field,
                        }"
                      />
                    } @else {
                      {{ valueOf(row, col.field) }}
                    }
                  </td>
                }
              </tr>
            </ng-template>

            <ng-template #emptymessage>
              <tr>
                <td [attr.colspan]="columns().length">
                  <div class="cyf-record-table-empty">
                    <span class="cyf-empty-icon" aria-hidden="true">
                      <i [class]="emptyIcon()"></i>
                    </span>
                    <span>{{ emptyMessage() | translate }}</span>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>

      <!--
        The template's paginator, unchanged. It brings page numbers, an active
        page, first/last, a rows-per-page selector, and a current-page report —
        all of which the hand-built Previous/Next pair had lost.

        Rendered whenever there is anything to page through, including while a
        page is loading, so it does not appear and disappear under the pointer.
      -->
      @if (totalRecords() > 0) {
        <div class="cyf-record-table-paginator">
          <app-paginator
            [page]="page()"
            [rows]="rows()"
            [totalRecords]="totalRecords()"
            [locale]="paginatorLocale()"
            (pageChange)="pageChange.emit($event)"
          />
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    /* The card the table sits in. Clipping the overflow is what makes the
       header's corners follow the radius, and scrolling the inner element is
       what keeps a wide table from widening the whole document. */
    .cyf-record-table-surface {
      background-color: var(--cyf-surface);
      border: 1px solid var(--cyf-border);
      border-radius: var(--cyf-radius-lg);
      box-shadow: var(--cyf-shadow-sm);
      overflow: hidden;
    }

    /* PrimeNG scrolls a wide table on its own container. Momentum scrolling on
       touch is added here; everything else is the template's own behaviour. */
    :host ::ng-deep .cyf-table .p-datatable-table-container {
      -webkit-overflow-scrolling: touch;
    }

    /* The template's own header treatment: filled, flat, no cell borders. */
    :host ::ng-deep .cyf-table .p-datatable-thead > tr > th {
      background: var(--cyf-surface-subtle);
      color: var(--cyf-text-secondary);
      border: none;
      border-block-end: 1px solid var(--cyf-border);
      font-size: var(--cyf-text-xs);
      font-weight: var(--cyf-weight-semibold);
      text-transform: uppercase;
      letter-spacing: var(--cyf-tracking-wide);
      white-space: nowrap;
      text-align: start;
    }

    :host ::ng-deep .cyf-table .p-datatable-tbody > tr > td {
      border: none;
      border-block-start: 1px solid var(--cyf-border);
      white-space: nowrap;
      text-align: start;
    }

    :host ::ng-deep .cyf-table .p-datatable-tbody > tr:first-child > td {
      border-block-start: none;
    }

    :host ::ng-deep .cyf-table .p-datatable-tbody > tr:hover > td {
      background: var(--cyf-surface-subtle);
    }

    /* PrimeNG hard-codes a left text alignment on header cells, so RTL needs
       the direction-scoped rule below to win it back. */
    :host ::ng-deep [dir='rtl'] .cyf-table .p-datatable-thead > tr > th,
    :host ::ng-deep [dir='rtl'] .cyf-table .p-datatable-tbody > tr > td {
      text-align: right;
    }

    .cyf-record-table-empty {
      display: grid;
      justify-items: center;
      gap: var(--cyf-space-3);
      padding: var(--cyf-space-8) var(--cyf-space-4);
      color: var(--cyf-text-muted);
      white-space: normal;
    }

    /* Clear of the last row, and clear of whatever follows the table. The
       hand-built paginators were flush against the final row. */
    .cyf-record-table-paginator {
      margin-block-start: var(--cyf-space-3);
    }
  `,
})
export class RecordTableComponent {
  private langService = inject(ChangeLangService);

  /** The rows for the **current page**. This component never slices. */
  data = input.required<unknown[]>();

  /** Column definitions. `header` is a translation key. */
  columns = input.required<TableColumn[]>();

  loading = input(false);

  /** Total across every page, from the server. Drives the paginator. */
  totalRecords = input(0);

  /** Zero-based current page. */
  page = input(0);

  /** Page size. */
  rows = input(10);

  /** Translation key for the empty state. */
  emptyMessage = input('common.noRecords');

  emptyIcon = input('fa-solid fa-inbox');

  size = input<'small' | 'large' | undefined>(undefined);

  /** Emitted when the reader asks for a different page or page size. */
  pageChange = output<PageChangeEvent>();

  /**
   * The locale the paginator formats its page numbers with.
   *
   * Follows the application language so the current-page report reads in the
   * right one, with the numbering system pinned to Latin digits so the figures
   * match every other number on the page. See the note on
   * `PaginatorComponent.locale`.
   */
  protected paginatorLocale = computed(() =>
    this.langService.currentLang() === 'ar' ? 'ar-u-nu-latn' : 'en-GB-u-nu-latn',
  );

  /** Cell templates, declared by the page with `appColTemplate="name"`. */
  private colTemplates = contentChildren(ColTemplateDirective);

  /** Four placeholder rows while loading — enough to read as a table. */
  protected readonly skeletonRows = [{}, {}, {}, {}];

  private templates = computed(
    () => new Map(this.colTemplates().map((directive) => [directive.name, directive.templateRef])),
  );

  protected templateFor(name: string) {
    return this.templates().get(name) ?? null;
  }

  /** Dot-notation field access, matching the template's own table. */
  protected valueOf(row: unknown, path: string): unknown {
    if (!row || !path) return undefined;
    return path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === 'object'
            ? (value as Record<string, unknown>)[key]
            : undefined,
        row,
      );
  }
}
