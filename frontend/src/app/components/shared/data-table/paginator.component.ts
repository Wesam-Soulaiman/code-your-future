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
