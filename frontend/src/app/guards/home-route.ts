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
export const STUDENT_PROFILE = '/student/profile';
export const ADMIN_SIGN_IN = '/auth/admin';
export const STUDENT_SIGN_IN = '/auth/student';

/**
 * Where a signed-in Student belongs right now ⟨CP3A⟩.
 *
 * A Student who has not finished their profile goes to the form; everyone else
 * goes to their welcome page. The answer comes from `profileComplete`, which the
 * **server** recalculates on every session restoration — the cached copy is only
 * ever a hint, and the backend refuses anything a tampered value might unlock.
 */
export function studentHome(session: SessionService): string {
  return session.profileComplete() ? STUDENT_HOME : STUDENT_PROFILE;
}

/** The landing route for the roles the session currently holds. */
export function homeUrlTree(session: SessionService, router: Router): UrlTree {
  if (session.roles().includes(AppRole.ADMIN)) {
    return router.createUrlTree([ADMIN_HOME]);
  }
  if (session.roles().includes(AppRole.STUDENT)) {
    return router.createUrlTree([studentHome(session)]);
  }
  // Signed in but holding no recognised role — nothing is safe to show, so send
  // them back to sign in rather than to a workspace they cannot use.
  return router.createUrlTree([ADMIN_SIGN_IN]);
}
