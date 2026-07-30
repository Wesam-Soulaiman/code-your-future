import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';

export function roleGuard(...allowedRoles: string[]): CanActivateFn {
  return () => {
    const sessionService = inject(SessionService);
    const router = inject(Router);
    const userRole = sessionService.userRole();

    if (allowedRoles.includes(userRole)) {
      return true;
    }

    return router.createUrlTree(['/dashboard']);
  };
}
