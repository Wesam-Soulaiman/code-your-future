import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';

/**
 * Render the template only when the user holds one of the given roles.
 *
 * Role-set aware: the template version compared only the user's first role.
 * UI visibility only — the backend re-authorises every request, so hiding an
 * element is never the security control.
 */
@Directive({
  selector: '[appIfRole]',
})
export class IfRoleDirective {
  private templateRef = inject(TemplateRef);
  private viewContainer = inject(ViewContainerRef);
  private sessionService = inject(SessionService);

  appIfRole = input.required<AppRole | AppRole[]>();

  private hasView = false;

  constructor() {
    effect(() => {
      const allowed = this.appIfRole();
      const roles = Array.isArray(allowed) ? allowed : [allowed];
      const shouldShow = this.sessionService.hasAnyRole(roles);

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
