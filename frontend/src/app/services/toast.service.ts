import { inject, Injectable } from '@angular/core';
import { MessageService } from 'primeng/api';

type Severity = 'success' | 'info' | 'warn' | 'error';

interface ToastOptions {
  sticky?: boolean;
  life?: number;
  closable?: boolean;
}

const DEFAULT_LIFE = 3000;

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private messageService = inject(MessageService);

  success(detail: string, summary = 'Success', options?: ToastOptions): void {
    this.show('success', summary, detail, options);
  }

  error(detail: string, summary = 'Error', options?: ToastOptions): void {
    this.show('error', summary, detail, options);
  }

  warn(detail: string, summary = 'Warning', options?: ToastOptions): void {
    this.show('warn', summary, detail, options);
  }

  info(detail: string, summary = 'Info', options?: ToastOptions): void {
    this.show('info', summary, detail, options);
  }

  clear(): void {
    this.messageService.clear();
  }

  private show(
    severity: Severity,
    summary: string,
    detail: string,
    options?: ToastOptions
  ): void {
    this.messageService.clear();
    this.messageService.add({
      severity,
      summary,
      detail,
      life: options?.life ?? DEFAULT_LIFE,
      sticky: options?.sticky ?? false,
      closable: options?.closable ?? true,
    });
  }
}
