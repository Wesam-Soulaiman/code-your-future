import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Code Your Future brand mark.
 *
 * The monogram tile is decorative (`aria-hidden`) — the product name beside it
 * carries the accessible text, so a screen reader announces the brand once
 * rather than twice.
 */
@Component({
  selector: 'cyf-brand-mark',
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cyf-brand" [class.cyf-brand-lg]="size() === 'lg'">
      <span
        class="cyf-brand-mark"
        [class.cyf-brand-mark-lg]="size() === 'lg'"
        aria-hidden="true"
        >{{ 'app.shortName' | translate }}</span
      >
      @if (showName()) {
        <span class="cyf-brand-name">{{ 'app.name' | translate }}</span>
      }
    </span>
  `,
})
export class BrandMarkComponent {
  /** `md` for headers, `lg` for the auth panel. */
  size = input<'md' | 'lg'>('md');
  /** Hide the wordmark when the layout is tight (collapsed sidebar). */
  showName = input(true);
}
