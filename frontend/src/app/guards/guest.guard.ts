import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { homeUrlTree } from './home-route';

/**
 * Keeps an authenticated user off the authentication pages.
 *
 * Returns a `UrlTree` rather than navigating imperatively, so the router
 * resolves the redirect before the auth component is ever created — there is no
 * flash of a sign-in form for somebody who is already signed in.
 *
 * The destination is role-aware: an Admin lands on the dashboard, a Student on
 * their welcome page. Every target is a fixed internal route, so this cannot
 * become an open redirect.
 */
export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.isLoggedIn()) {
    return homeUrlTree(session, router);
  }

  return true;
};
