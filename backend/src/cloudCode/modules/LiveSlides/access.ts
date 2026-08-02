/**
 * Who may see and touch a Live Slides session ⟨CP6⟩.
 *
 * One module, used by every operation, so no two of them can disagree about who
 * is allowed what.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *   - an **Admin** may manage every session of every Batch, and is the only
 *     role that ever sees a submitted answer that is not their own;
 *   - an **enrolled Student** may see the session they are in, the Slide being
 *     presented, and **their own** answers;
 *   - a **Visitor** may do nothing;
 *   - a Student in a different Batch is answered exactly as somebody asking
 *     about a session that does not exist.
 *
 * A Student keeps reading their own completed answers after the Batch is
 * completed or archived. They said those things; the cohort finishing does not
 * unsay them.
 */

import {catchError, getUserRoles} from '@90soft/parse-server-kit';

import {AppRole, toAppRole} from '../../utils/constants/roles';
import {BATCH_STATUS} from '../Batch/constants';
import {findEnrollment} from '../Batch/repository';
import {LiveSlidesError, liveSlidesError} from './errors';
import {liveLog} from './logging';
import {SESSION_STATUS, SessionStatus, isEditableStatus} from './constants';

/** The application roles this session actually holds, live from `_Role`. */
export async function liveRoles(user: Parse.User): Promise<AppRole[]> {
  const [error, names] = await catchError(getUserRoles(user));
  if (error || !names) return [];
  return (names as string[])
    .map(name => toAppRole(name))
    .filter((role): role is AppRole => role !== undefined);
}

export interface LiveViewer {
  user: Parse.User;
  isAdmin: boolean;
  isStudent: boolean;
}

/** Classify the caller. Roles are read live, never from anything they sent. */
export async function describeViewer(user: Parse.User): Promise<LiveViewer> {
  const roles = await liveRoles(user);
  return {
    user,
    isAdmin: roles.includes(AppRole.ADMIN),
    isStudent: roles.includes(AppRole.STUDENT),
  };
}

/** An Admin, or a stable not-found. */
export function requireAdminViewer(viewer: LiveViewer, op: string): void {
  if (viewer.isAdmin) return;

  liveLog.warn('Live Slides management refused', {
    op,
    stage: 'authorize',
    ok: false,
    userId: viewer.user.id,
    code: LiveSlidesError.LIVE_SESSION_NOT_FOUND,
  });
  // Not-found, not access-denied: an enrolled Student probing session ids must
  // not learn which ones are real.
  throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);
}

/**
 * An enrolled Student, or a stable not-found.
 *
 * Enrollment is checked against the database on every call, so a membership
 * removed a moment ago stops working immediately.
 */
export async function requireEnrolled(
  viewer: LiveViewer,
  batchId: string,
  op: string
): Promise<void> {
  if (viewer.isStudent) {
    const [error, enrollment] = await catchError(findEnrollment(batchId, viewer.user));
    if (!error && enrollment) return;
  }

  liveLog.warn('Live Slides access refused', {
    op,
    stage: 'authorize',
    ok: false,
    userId: viewer.user.id,
    batchId,
    code: LiveSlidesError.NOT_ENROLLED,
  });
  throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);
}

/**
 * Require that this session's Slides may still be edited.
 *
 * Answers ACCESS-shaped codes rather than not-found: the caller is an Admin who
 * demonstrably holds the session, so its existence is not the secret — only the
 * action is refused, and saying why is what lets the UI explain it.
 */
export function requireEditable(session: Parse.Object, op: string): void {
  const status = session.get('status') as SessionStatus;
  if (isEditableStatus(status)) return;

  liveLog.warn('Live Slides edit refused', {
    op,
    stage: 'authorize',
    ok: false,
    sessionId: session.id,
    status,
    code: LiveSlidesError.LIVE_SESSION_NOT_EDITABLE,
  });
  throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_EDITABLE);
}

/** Require that this session is the one being presented. */
export function requireLive(session: Parse.Object, op: string): void {
  const status = session.get('status') as SessionStatus;
  if (status === SESSION_STATUS.LIVE) return;

  liveLog.warn('Live Slides presentation refused', {
    op,
    stage: 'authorize',
    ok: false,
    sessionId: session.id,
    status,
    code:
      status === SESSION_STATUS.COMPLETED
        ? LiveSlidesError.LIVE_SESSION_COMPLETED
        : LiveSlidesError.LIVE_SESSION_NOT_ACTIVE,
  });
  throw liveSlidesError(
    status === SESSION_STATUS.COMPLETED
      ? LiveSlidesError.LIVE_SESSION_COMPLETED
      : LiveSlidesError.LIVE_SESSION_NOT_ACTIVE
  );
}

/**
 * May a session of this Batch be started right now?
 *
 * Only an **active** Batch. A draft Batch may be prepared — an Admin builds the
 * lecture before the cohort opens — but it has no Students to present to. A
 * completed or archived Batch has finished.
 */
export function batchAllowsStart(batch: Parse.Object): boolean {
  return batch.get('status') === BATCH_STATUS.ACTIVE;
}

/** Is this Batch read-only? Archived is terminal. */
export function batchIsReadOnly(batch: Parse.Object): boolean {
  return batch.get('status') === BATCH_STATUS.ARCHIVED;
}

/**
 * The Batch a session belongs to, from the session itself.
 *
 * Deliberately **not** taken from a `batchId` the caller supplied. A request
 * naming both a session and a Batch invites the two to disagree, and the caller
 * picks which; reading the pointer means the relationship is whatever the
 * database says it is.
 */
export function batchOf(session: Parse.Object): Parse.Object | undefined {
  const batch = session.get('batch');
  return batch && typeof batch.id === 'string' ? (batch as Parse.Object) : undefined;
}
