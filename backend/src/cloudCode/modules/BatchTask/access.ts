/**
 * Who may see and touch a Task or a Submission ⟨CP7⟩.
 *
 * One module, used by every operation and by the attachment route, so no two of
 * them can disagree about who is allowed what.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *   - an **Admin** manages every Task of every Batch, reads every Submission,
 *     and is the only role that can suppress a Talent Reel;
 *   - an **enrolled Student** sees the published Tasks of the Batches they
 *     joined, and **their own** Submission;
 *   - a **Visitor** does nothing;
 *   - a Student in a different Batch is answered exactly as somebody asking
 *     about a Task that does not exist.
 *
 * A Student keeps reading their own submitted work after the Batch is completed
 * or archived. They did it; the cohort finishing does not undo that.
 */

import {catchError, getUserRoles} from '@90soft/parse-server-kit';

import {AppRole, toAppRole} from '../../utils/constants/roles';
import {BATCH_STATUS} from '../Batch/constants';
import {findEnrollment} from '../Batch/repository';
import {TaskError, taskError} from './errors';
import {taskLog} from './logging';

/** The application roles this session actually holds, live from `_Role`. */
export async function liveRoles(user: Parse.User): Promise<AppRole[]> {
  const [error, names] = await catchError(getUserRoles(user));
  if (error || !names) return [];
  return (names as string[])
    .map(name => toAppRole(name))
    .filter((role): role is AppRole => role !== undefined);
}

export interface TaskViewer {
  user: Parse.User;
  isAdmin: boolean;
  isStudent: boolean;
}

/** Classify the caller. Roles are read live, never from anything they sent. */
export async function describeViewer(user: Parse.User): Promise<TaskViewer> {
  const roles = await liveRoles(user);
  return {
    user,
    isAdmin: roles.includes(AppRole.ADMIN),
    isStudent: roles.includes(AppRole.STUDENT),
  };
}

/**
 * An enrolled Student, or a stable not-found.
 *
 * Enrollment is checked against the database on every call, so a membership
 * removed a moment ago stops working immediately.
 *
 * Throws **TASK_NOT_FOUND**, not a denial. "You may not see this" confirms the
 * Task exists; somebody probing ids would learn which ones are real. A Task the
 * caller cannot read answers exactly as a made-up id does.
 */
export async function requireEnrolled(
  viewer: TaskViewer,
  batchId: string,
  op: string
): Promise<void> {
  if (viewer.isStudent) {
    const [error, enrollment] = await catchError(findEnrollment(batchId, viewer.user));
    if (!error && enrollment) return;
  }

  taskLog.warn('Task access refused', {
    op,
    stage: 'authorize',
    ok: false,
    userId: viewer.user.id,
    batchId,
    code: TaskError.NOT_ENROLLED,
  });
  throw taskError(TaskError.TASK_NOT_FOUND);
}

/** Is this Batch accepting new work? Only an active Batch is. */
export function batchIsActive(batch: Parse.Object): boolean {
  return batch.get('status') === BATCH_STATUS.ACTIVE;
}

/** Is this Batch read-only? Completed and archived both are. */
export function batchIsReadOnly(batch: Parse.Object): boolean {
  const status = batch.get('status');
  return status === BATCH_STATUS.COMPLETED || status === BATCH_STATUS.ARCHIVED;
}

/** May an Admin still create or change Tasks in this Batch? */
export function batchAllowsTaskEditing(batch: Parse.Object): boolean {
  const status = batch.get('status');
  return status === BATCH_STATUS.DRAFT || status === BATCH_STATUS.ACTIVE;
}

/**
 * The Batch a Task belongs to, from the Task itself.
 *
 * Deliberately **not** taken from a `batchId` the caller supplied. A request
 * naming both a Task and a Batch invites the two to disagree, and the caller
 * picks which; reading the pointer means the relationship is whatever the
 * database says it is.
 */
export function batchOf(task: Parse.Object): Parse.Object | undefined {
  const batch = task.get('batch');
  return batch && typeof batch.id === 'string' ? (batch as Parse.Object) : undefined;
}

/** The Task a Submission belongs to, from the Submission itself. */
export function taskOf(submission: Parse.Object): Parse.Object | undefined {
  const task = submission.get('task');
  return task && typeof task.id === 'string' ? (task as Parse.Object) : undefined;
}
