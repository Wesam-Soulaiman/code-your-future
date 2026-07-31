import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';
import { ADMIN_SIGN_IN, STUDENT_HOME } from './home-route';

/**
 * Guard the Admin workspace.
 *
 * A Visitor is sent to Admin sign-in. A signed-in **Student** is sent to their
 * own workspace instead — the Admin shell is not theirs to see, and bouncing
 * them back to a sign-in page they are already past would loop.
 *
 * Both targets are fixed internal paths, never taken from user input.
 */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (!session.isLoggedIn()) {
    return router.createUrlTree([ADMIN_SIGN_IN]);
  }

  if (session.roles().includes(AppRole.ADMIN)) {
    return true;
  }

  if (session.roles().includes(AppRole.STUDENT)) {
    return router.createUrlTree([STUDENT_HOME]);
  }

  // A token with no recognised role authorises nothing.
  return router.createUrlTree([ADMIN_SIGN_IN]);
};
