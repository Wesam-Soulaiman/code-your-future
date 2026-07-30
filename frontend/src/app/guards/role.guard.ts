import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';

/**
 * Restrict a route to the supplied application roles.
 *
 * Role-set aware: the template guard compared only `roles[0]`, so a user holding
 * two roles could be refused a route their second role allowed. This checks the
 * whole set.
 *
 * A Visitor is sent to `/auth`; an authenticated user without a permitted role is
 * sent to `/dashboard`. This is UI routing only — the backend independently
 * re-authorises every request against live role membership.
 */
export function roleGuard(...allowedRoles: AppRole[]): CanActivateFn {
  return () => {
    const sessionService = inject(SessionService);
    const router = inject(Router);

    if (!sessionService.isLoggedIn()) {
      return router.createUrlTree(['/auth']);
    }

    if (sessionService.hasAnyRole(allowedRoles)) {
      return true;
    }

    return router.createUrlTree(['/dashboard']);
  };
}

/** Convenience guard for Admin-only routes. */
export const adminGuard: CanActivateFn = (route, state) =>
  roleGuard(AppRole.ADMIN)(route, state);
