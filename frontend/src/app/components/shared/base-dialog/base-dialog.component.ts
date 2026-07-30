import {
  ChangeDetectionStrategy,
  Component,
  contentChild,
  Directive,
  inject,
  signal,
  TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export type DialogMode = 'edit' | 'add';

// Directive for body content template
@Directive({ selector: '[appDialogBody]', standalone: true })
export class DialogBodyDirective {
  templateRef = inject(TemplateRef);
}

// Directive for footer actions template
@Directive({ selector: '[appDialogActions]', standalone: true })
export class DialogActionsDirective {
  templateRef = inject(TemplateRef);
}

@Component({
  selector: 'app-base-dialog',
  imports: [NgTemplateOutlet],
  template: `
    <!-- Body Content -->
    <div class="dialog-body">
      @if (bodyTemplate()) {
        <ng-container
          [ngTemplateOutlet]="bodyTemplate()!.templateRef"
          [ngTemplateOutletContext]="{ $implicit: config.data, saving: saving() }"
        />
      }
    </div>

    <!-- Footer Actions -->
    <div class="custom-footer flex justify-end gap-2">
      @if (actionsTemplate()) {
        <ng-container
          [ngTemplateOutlet]="actionsTemplate()!.templateRef"
          [ngTemplateOutletContext]="{ $implicit: config.data, saving: saving() }"
        />
      }
    </div>
  `,
  styles: `
    .dialog-body {
      margin-bottom: 4rem;
    }
    .custom-footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 1.25rem 1.25rem;
      background-color: var(--p-surface-50);
      border-bottom-left-radius: 0.75rem;
      border-bottom-right-radius: 0.75rem;
    }
    :host-context(.dark) .custom-footer {
      background-color: var(--p-surface-900);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BaseDialogComponent {
  ref = inject(DynamicDialogRef);
  config = inject(DynamicDialogConfig);

  bodyTemplate = contentChild(DialogBodyDirective);
  actionsTemplate = contentChild(DialogActionsDirective);

  saving = signal(false);

  close(result?: unknown): void {
    this.ref.close(result);
  }

  setSaving(value: boolean): void {
    this.saving.set(value);
  }
}
