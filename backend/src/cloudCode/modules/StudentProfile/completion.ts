/**
 * The one profile fact the session surface needs.
 *
 * Kept in its own tiny module so the authentication surface can answer "should
 * this Student be sent to Complete Profile?" without importing the profile's
 * validation, DTO, photo handling, or repository — and, more importantly,
 * without any temptation to put profile data into a session response.
 *
 * The answer is read from the stored `isComplete`, which the server calculated
 * when the profile was last saved. Nothing is recalculated here: two places
 * deciding the same thing is how they come to disagree.
 */

import {catchError} from '@90soft/parse-server-kit';
import {AppRole} from '../../utils/constants/roles';

/**
 * Whether this user's Student profile is complete.
 *
 * `false` for a Student with no profile yet — which is the point: a brand-new
 * Student is incomplete and gets routed to the form.
 *
 * `undefined` for anyone who is not a Student, so the session DTO can omit the
 * field rather than claim an Admin has an incomplete profile.
 *
 * A lookup failure returns `false` rather than throwing: session restoration
 * must not break because of a profile read, and "incomplete" sends the Student
 * to a form that will simply load their existing answers.
 */
export async function isProfileComplete(
  user: Parse.User,
  roles: readonly AppRole[]
): Promise<boolean | undefined> {
  if (!roles.includes(AppRole.STUDENT)) return undefined;

  const query = new Parse.Query('StudentProfile');
  query.equalTo('user', user);
  query.select('isComplete');

  const [error, profile] = await catchError(query.first({useMasterKey: true}));
  if (error || !profile) return false;

  return (profile as Parse.Object).get('isComplete') === true;
}
