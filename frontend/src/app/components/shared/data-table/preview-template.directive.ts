import { Directive, inject, TemplateRef } from '@angular/core';

@Directive({
  selector: '[appPreviewTemplate]',
})
export class PreviewTemplateDirective {
  templateRef = inject(TemplateRef);
}
