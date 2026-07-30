import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';

/**
 * Keeps an authenticated user off the authentication pages.
 *
 * Returns a `UrlTree` rather than navigating imperatively, so the router
 * resolves the redirect before the auth component is ever created — there is no
 * flash of the sign-in form for a signed-in Admin.
 *
 * The redirect target is the fixed internal route `/`, never a value taken from
 * a query parameter, so this cannot become an open redirect.
 */
export const guestGuard: CanActivateFn = () => {
  const sessionService = inject(SessionService);
  const router = inject(Router);

  if (sessionService.isLoggedIn()) {
    return router.createUrlTree(['/']);
  }

  return true;
};
