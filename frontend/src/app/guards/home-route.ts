import { Router, UrlTree } from '@angular/router';
import { AppRole } from '../config/user-roles';
import { SessionService } from '../services/session.service';
import { INVITATION_ROUTE } from '../utils/batch-constants';
import { pendingInvitationToken } from '../utils/invitation-intent';

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

/** ⟨CP4⟩ */
export const STUDENT_BATCHES = '/student/batches';
export const ADMIN_BATCHES = '/dashboard/batches';
export const ADMIN_STUDENTS = '/dashboard/students';

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

/**
 * Where a Student goes next, as router commands ⟨CP4⟩.
 *
 * Same rule as `studentHome`, with one addition: a Student who arrived holding
 * an invitation is taken back to it once there is nothing left blocking them.
 * Somebody who scanned a QR code, signed in, and filled in a profile has been
 * doing all of that *in order to join something* — dropping them on a generic
 * welcome page at the end would make them go and find the code again.
 *
 * The token is validated against a strict shape before it is stored, and the
 * route is a fixed internal path with the token as one segment. Nothing here
 * navigates to a value that came from a query parameter, so this stays
 * incapable of becoming an open redirect.
 */
export function studentLandingCommands(session: SessionService): string[] {
  // The profile still comes first: a membership in a Batch is meaningless if
  // nobody knows who the member is.
  if (!session.profileComplete()) return [STUDENT_PROFILE];

  const token = pendingInvitationToken();
  if (token) return [INVITATION_ROUTE, token];

  return [STUDENT_HOME];
}

/** The landing route for the roles the session currently holds. */
export function homeUrlTree(session: SessionService, router: Router): UrlTree {
  if (session.roles().includes(AppRole.ADMIN)) {
    // Deliberately *not* invitation-aware. An Admin cannot join a Batch, so
    // following their pending invitation would only land them on a page telling
    // them so. The join page still says it plainly if they open the link.
    return router.createUrlTree([ADMIN_HOME]);
  }
  if (session.roles().includes(AppRole.STUDENT)) {
    return router.createUrlTree(studentLandingCommands(session));
  }
  // Signed in but holding no recognised role — nothing is safe to show, so send
  // them back to sign in rather than to a workspace they cannot use.
  return router.createUrlTree([ADMIN_SIGN_IN]);
}
