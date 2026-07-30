import { Directive, inject, TemplateRef } from '@angular/core';

@Directive({
  selector: '[appCustomTemplate]',
})
export class CustomTemplateDirective {
  templateRef = inject(TemplateRef);
}
