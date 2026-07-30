import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

export interface ConfirmOptions {
  title?: string;
  message?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  icon?: string;
  severity?: 'danger' | 'warn' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);

  confirm(options: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      const severity = options.severity ?? 'danger';
      const iconMap = {
        danger: 'fa-solid fa-triangle-exclamation text-red-500',
        warn: 'fa-solid fa-triangle-exclamation text-yellow-500',
        info: 'fa-solid fa-circle-info text-blue-500',
      };

      this.confirmationService.confirm({
        header: options.title ?? this.translate.instant('confirm.title'),
        message: options.message ?? this.translate.instant('confirm.deleteMessage'),
        icon: options.icon ?? iconMap[severity],
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  confirmDelete(itemName?: string): Promise<boolean> {
    const message = itemName
      ? this.translate.instant('confirm.deleteItemMessage', { item: itemName })
      : this.translate.instant('confirm.deleteMessage');

    return this.confirm({
      title: this.translate.instant('confirm.deleteTitle'),
      message,
      severity: 'danger',
    });
  }
}
