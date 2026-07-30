import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { SessionService } from '../services/session.service';

@Directive({
  selector: '[appIfRole]',
})
export class IfRoleDirective {
  private templateRef = inject(TemplateRef);
  private viewContainer = inject(ViewContainerRef);
  private sessionService = inject(SessionService);

  appIfRole = input.required<string | string[]>();

  private hasView = false;

  constructor() {
    effect(() => {
      const allowed = this.appIfRole();
      const userRole = this.sessionService.userRole();
      const roles = Array.isArray(allowed) ? allowed : [allowed];
      const shouldShow = roles.includes(userRole);

      if (shouldShow && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!shouldShow && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
