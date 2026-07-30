import { Directive, inject, TemplateRef } from '@angular/core';

@Directive({
  selector: '[appGridCardTemplate]',
})
export class GridCardTemplateDirective {
  templateRef = inject(TemplateRef);
}
