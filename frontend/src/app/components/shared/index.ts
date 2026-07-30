/**
 * Shared Components — barrel exports
 *
 * Re-export reusable components here so they can be imported from
 * a single path: import { DataTableComponent } from '../../components/shared';
 */
export {
  DataTableComponent,
  ColTemplateDirective,
  PreviewTemplateDirective,
  GridCardTemplateDirective,
  CustomTemplateDirective,
  PaginatorComponent,
  SearchInputComponent,
} from './data-table';
export type { TableColumn, LoadDataEvent, PreviewAction, ExportColumn } from './data-table';

export {
  BaseDialogComponent,
  DialogBodyDirective,
  DialogActionsDirective,
} from './base-dialog/base-dialog.component';
export type { DialogMode } from './base-dialog/base-dialog.component';
