import { Router, UrlTree } from '@angular/router';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';

/**
 * Where a signed-in user belongs.
 *
 * One definition, used by every guard, so the two workspaces can never disagree
 * about a landing page — which is how redirect loops start. Each target is a
 * fixed internal path; none is ever read from a query parameter, so none of
 * these can become an open redirect.
 */
export const ADMIN_HOME = '/dashboard';
export const STUDENT_HOME = '/student/welcome';
export const ADMIN_SIGN_IN = '/auth/admin';
export const STUDENT_SIGN_IN = '/auth/student';

/** The landing route for the roles the session currently holds. */
export function homeUrlTree(session: SessionService, router: Router): UrlTree {
  if (session.roles().includes(AppRole.ADMIN)) {
    return router.createUrlTree([ADMIN_HOME]);
  }
  if (session.roles().includes(AppRole.STUDENT)) {
    return router.createUrlTree([STUDENT_HOME]);
  }
  // Signed in but holding no recognised role — nothing is safe to show, so send
  // them back to sign in rather than to a workspace they cannot use.
  return router.createUrlTree([ADMIN_SIGN_IN]);
}
