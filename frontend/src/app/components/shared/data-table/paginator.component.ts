import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';

export interface PageChangeEvent {
  page: number;
  rows: number;
  skip: number;
}

@Component({
  selector: 'app-paginator',
  imports: [PaginatorModule],
  template: `
    <div class="flex items-center justify-end w-full">
      <p-paginator
        [first]="first"
        [rows]="rows()"
        [totalRecords]="totalRecords()"
        [rowsPerPageOptions]="[10, 25, 50]"
        [showFirstLastIcon]="true"
        [showCurrentPageReport]="true"
        [locale]="locale()"
        currentPageReportTemplate="{first} - {last} / {totalRecords}"
        (onPageChange)="onPageChange($event)"
      />
    </div>
  `,
  styles: `
    :host ::ng-deep .p-paginator {
      background: transparent;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginatorComponent {
  page = input<number>(0);
  rows = input<number>(25);
  totalRecords = input<number>(0);

  /**
   * The locale PrimeNG formats the page numbers with ⟨CP4 closeout⟩.
   *
   * PrimeNG renders each page number through
   * `new Intl.NumberFormat(this.locale)`. Left unset, `locale` is `undefined`,
   * which means **the viewer's operating system decides** — so the same page,
   * in the same language, shows `1 2 3` on one machine and `١ ٢ ٣` on another.
   * Found by a test that failed on an Arabic-configured machine while the page
   * was rendering in English.
   *
   * Pinned to Latin digits, matching every other figure in this product: dates,
   * counts, and table columns all use `-u-nu-latn` for the same reason. The
   * *words* around them still localise; only the digits are held steady.
   *
   * The default preserves the template's appearance on a machine already set to
   * English, and callers may override it.
   */
  locale = input<string>('en-GB-u-nu-latn');

  // PrimeNG expects first as skip count (page * rows)
  get first(): number {
    return this.page() * this.rows();
  }

  pageChange = output<PageChangeEvent>();

  onPageChange(event: PaginatorState): void {
    const rows = event.rows ?? this.rows();
    const page = event.page ?? 0;
    this.pageChange.emit({
      page,
      rows,
      skip: page * rows,
    });
  }
}
