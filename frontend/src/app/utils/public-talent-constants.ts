import { EDUCATION_STATUS } from './student-profile-constants';

/**
 * Bounds for the public pages — the browser's copy ⟨CP8⟩.
 *
 * Mirrors `backend/src/cloudCode/modules/PublicTalent/constants.ts`. The server
 * clamps every request to its own ceiling regardless, so these decide what to
 * *ask* for and never what is allowed.
 */

/** How many cards one page of the directory requests. */
export const PUBLIC_PAGE_SIZE = 24;

/**
 * How many reel items one page requests.
 *
 * Smaller than the directory on purpose. Each item is a full screen with an
 * iframe behind it, and asking for twenty-four would mean twenty-four embeds
 * queued before anybody has scrolled past the first.
 */
export const PUBLIC_REEL_PAGE_SIZE = 6;

/**
 * How close to the end of the loaded reel a Visitor gets before more is asked
 * for.
 *
 * Two screens of warning is enough to fetch a page over a slow connection
 * without the scroll ever hitting a wall, and small enough that somebody who
 * opens the page and leaves has loaded almost nothing.
 */
export const REEL_PREFETCH_THRESHOLD = 2;

/**
 * The translation key for a stored education status ⟨CP8⟩.
 *
 * The values on a profile are `'Current Student'` and `'Graduate'` — words, not
 * codes — so they cannot be pasted into a key path. Anything unrecognised falls
 * back to rendering the stored value itself, which is a readable English phrase,
 * rather than showing a translation key to a Visitor.
 */
export function educationStatusKey(value: string | undefined): string {
  if (value === EDUCATION_STATUS.CURRENT_STUDENT) return 'student.profile.status.currentStudent';
  if (value === EDUCATION_STATUS.GRADUATE) return 'student.profile.status.graduate';
  return '';
}
