import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';
import { ADMIN_HOME, STUDENT_SIGN_IN } from './home-route';

/**
 * Restrict a route to Students.
 *
 * A Visitor is sent to the **Student** sign-in page rather than the Admin one:
 * somebody who followed a Student link should not be asked for a username and
 * password they will never have.
 *
 * An authenticated non-Student goes to their own workspace, never to a Student
 * page they cannot use. Both targets are fixed internal paths.
 *
 * This is UI routing only. The backend re-authorises every request against live
 * `_Role` membership, so a cached role in localStorage grants nothing.
 */
export const studentGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (!session.isLoggedIn()) {
    return router.createUrlTree([STUDENT_SIGN_IN]);
  }

  if (session.roles().includes(AppRole.STUDENT)) {
    return true;
  }

  if (session.roles().includes(AppRole.ADMIN)) {
    return router.createUrlTree([ADMIN_HOME]);
  }

  // Signed in with no recognised role: the session is unusable here.
  return router.createUrlTree([STUDENT_SIGN_IN]);
};
