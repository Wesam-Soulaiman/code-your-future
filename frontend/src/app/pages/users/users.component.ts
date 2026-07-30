import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';

import { DatePipe, TitleCasePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { finalize } from 'rxjs';
import {
  DataTableComponent,
  TableColumn,
  ExportColumn,
  LoadDataEvent,
} from '../../components/shared/data-table';
import { ColTemplateDirective } from '../../components/shared/data-table/col-template.directive';
import { GridCardTemplateDirective } from '../../components/shared/data-table/grid-card-template.directive';
import { PreviewTemplateDirective } from '../../components/shared/data-table/preview-template.directive';
import { UserService } from '../../services/dataService/user-service';
import { ToastService } from '../../services/toast.service';
import { User } from '../../models/User';

@Component({
  selector: 'app-users',
  imports: [
    DataTableComponent,
    ColTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
    TranslateModule,
    AvatarModule,
    ButtonModule,
    DividerModule,
    TagModule,
    TooltipModule,
    DatePipe,
    TitleCasePipe,
  ],
  templateUrl: './users.component.html',
  styles: `
    :host ::ng-deep .grid-card-wrapper .p-card {
      background-color: var(--app-card-nested);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersComponent {
  private userService = inject(UserService);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);
  private toastService = inject(ToastService);

  loading = signal(false);
  objs = signal<User[]>([]);
  totalRecords = signal(0);
  columns = signal<TableColumn[]>([]);
  exportColumns = signal<ExportColumn[]>([]);
  emailCopied = signal(false);

  constructor() {
    this.initTranslations();
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.initTranslations());
  }

  private initTranslations(): void {
    this.columns.set([
      { field: 'name', header: this.translate.instant('users.name'), template: 'name' },
      { field: 'email', header: this.translate.instant('users.email') },
      { field: 'phoneNumber', header: this.translate.instant('users.phone') },
      { field: 'role', header: 'Role', template: 'role' },
    ]);
    this.exportColumns.set([
      { field: 'email', header: this.translate.instant('users.email') },
      { field: 'name', header: this.translate.instant('users.name') },
      { field: 'phoneNumber', header: this.translate.instant('users.phone') },
    ]);
  }

  onLoadData(event: LoadDataEvent): void {
    this.loading.set(true);
    const params: Record<string, unknown> = {
      skip: event.skip,
      limit: event.limit,
      withCount: true,
    };
    if (event.search) params['searchString'] = event.search;
    this.userService
      .listUsers(params)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res: unknown) => {
          const data = res as { results?: User[]; count?: number };
          const objs = Array.isArray(res) ? res : (data.results ?? []);
          this.objs.set(objs);
          this.totalRecords.set(data.count ?? objs.length);
        },
      });
  }

  sendEmail(email: string): void {
    window.open(`mailto:${email}`, '_blank');
  }

  copyEmail(email: string): void {
    if (this.emailCopied()) return;
    navigator.clipboard.writeText(email).then(() => {
      this.emailCopied.set(true);
      this.toastService.success(this.translate.instant('users.copiedToClipboard'));
      setTimeout(() => this.emailCopied.set(false), 2000);
    });
  }
}
