import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

/**
 * Inline status panel for form-level and page-level messages.
 *
 * Two accessibility properties matter here:
 *
 *  - **Never colour alone.** Each variant renders an icon *and* a visually
 *    hidden prefix ("Error:", "Note:") so the nature of the message survives
 *    greyscale, colour-blindness, and screen readers.
 *  - **Announced politely.** `role="alert"` (assertive) is used for errors so a
 *    failed sign-in is read out immediately; informational variants use
 *    `role="status"` so they do not interrupt.
 *
 * The message text is passed in already translated by the caller — this
 * component never builds copy itself.
 */
@Component({
  selector: 'cyf-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="cyf-alert"
      [class.cyf-alert-error]="variant() === 'error'"
      [class.cyf-alert-warning]="variant() === 'warning'"
      [class.cyf-alert-info]="variant() === 'info'"
      [class.cyf-alert-success]="variant() === 'success'"
      [attr.role]="role()"
      [attr.aria-live]="ariaLive()"
    >
      <i class="cyf-alert-icon" [class]="iconClass()" aria-hidden="true"></i>
      <span>
        <span class="cyf-sr-only">{{ prefix() }}</span>
        <ng-content />
      </span>
    </div>
  `,
})
export class AlertComponent {
  variant = input<AlertVariant>('info');

  /**
   * Visually hidden prefix, already translated by the caller. Defaults are
   * intentionally empty so a caller that forgets it degrades to icon + colour
   * rather than to an English string leaking into an Arabic page.
   */
  prefix = input('');

  protected iconClass = computed(() => {
    switch (this.variant()) {
      case 'error':
        return 'fa-solid fa-circle-exclamation';
      case 'warning':
        return 'fa-solid fa-triangle-exclamation';
      case 'success':
        return 'fa-solid fa-circle-check';
      default:
        return 'fa-solid fa-circle-info';
    }
  });

  protected role = computed(() => (this.variant() === 'error' ? 'alert' : 'status'));

  protected ariaLive = computed(() => (this.variant() === 'error' ? 'assertive' : 'polite'));
}
