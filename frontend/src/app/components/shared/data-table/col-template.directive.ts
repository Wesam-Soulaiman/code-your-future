import { Directive, inject, input, TemplateRef } from '@angular/core';

/**
 * Directive for defining custom column templates in data-table.
 *
 * Template context variables:
 * - `$implicit` / `row`: The full row object
 * - `value`: The resolved value (supports dot notation paths)
 * - `field`: The field path string
 *
 * @example
 * // Simple template
 * ```html
 * <ng-template appColTemplate="status" let-row let-value="value">
 *   <span [class]="value === 'active' ? 'text-green-500' : 'text-red-500'">
 *     {{ value }}
 *   </span>
 * </ng-template>
 * ```
 *
 * @example
 * // Template with nested field (value is already resolved)
 * ```html
 * <!-- Column: { field: 'profile.address.city', template: 'city' } -->
 * <ng-template appColTemplate="city" let-value="value">
 *   <i class="fa-solid fa-location-dot"></i> {{ value ?? '—' }}
 * </ng-template>
 * ```
 *
 * @example
 * // Access full row object
 * ```html
 * <ng-template appColTemplate="actions" let-row>
 *   <button (click)="onEdit(row)">Edit</button>
 *   <button (click)="onDelete(row.id)">Delete</button>
 * </ng-template>
 * ```
 */
@Directive({
  selector: '[appColTemplate]',
})
export class ColTemplateDirective {
  appColTemplate = input.required<string>();
  templateRef = inject(TemplateRef);

  get name(): string {
    return this.appColTemplate();
  }
}
