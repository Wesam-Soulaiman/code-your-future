/**
 * Whether a Task is accepting work right now ⟨CP7⟩.
 *
 * ── Derived, never stored ───────────────────────────────────────────────────
 * A Task whose deadline has passed stays `PUBLISHED`. Nothing mutates its status
 * because time went by, and that is deliberate: a status that changes on its own
 * needs a scheduler, a scheduler needs to be running, and a Task whose
 * availability depended on a cron job that died would quietly keep accepting
 * work after its deadline.
 *
 * So availability is computed from the stored status, the Batch's status, and
 * **the server's clock**, every single time it is asked. There is no cached
 * flag, and a client's opinion about whether the deadline has passed is never
 * consulted — that value would arrive from a machine whose clock the Student
 * controls.
 */

import {BATCH_STATUS} from '../Batch/constants';
import {TASK_STATUS, TaskStatus} from './constants';

/**
 * Why a Task is or is not open.
 *
 * Returned to the browser so the UI can say something true and specific
 * instead of a disabled button with no explanation.
 */
export type AvailabilityReason =
  /** Open for Save Draft and Submit. */
  | 'OPEN'
  /** The Admin has not published it yet. Students never see this. */
  | 'NOT_PUBLISHED'
  /** The Admin closed it. */
  | 'CLOSED'
  /** The Admin archived it. */
  | 'ARCHIVED'
  /** The deadline has passed. There are no late submissions. */
  | 'DEADLINE_PASSED'
  /** The Batch has not started, so nothing in it is live yet. */
  | 'BATCH_NOT_ACTIVE'
  /** The Batch has finished or been archived; its Tasks are history. */
  | 'BATCH_CLOSED';

export interface Availability {
  isSubmissionOpen: boolean;
  availabilityReason: AvailabilityReason;
}

/**
 * Decide availability from the stored state and the server clock.
 *
 * The order of the checks is the order of the explanations: the reason a
 * Student is given is the *first* thing standing in their way, which is the one
 * worth telling them about. A Task that is both archived and past its deadline
 * says archived, because that is the thing that will not change.
 *
 * `now` is a parameter only so tests can sit exactly on a boundary. Every caller
 * in production passes nothing and gets the real clock.
 */
export function availabilityOf(
  task: {status: TaskStatus; deadline?: Date | null},
  batchStatus: string,
  now: Date = new Date()
): Availability {
  if (task.status === TASK_STATUS.ARCHIVED) {
    return {isSubmissionOpen: false, availabilityReason: 'ARCHIVED'};
  }
  if (task.status === TASK_STATUS.DRAFT) {
    return {isSubmissionOpen: false, availabilityReason: 'NOT_PUBLISHED'};
  }
  if (task.status === TASK_STATUS.CLOSED) {
    return {isSubmissionOpen: false, availabilityReason: 'CLOSED'};
  }

  // Published, so the Batch decides next.
  if (batchStatus === BATCH_STATUS.DRAFT) {
    return {isSubmissionOpen: false, availabilityReason: 'BATCH_NOT_ACTIVE'};
  }
  if (batchStatus !== BATCH_STATUS.ACTIVE) {
    // Completed or archived: readable history, but nothing new.
    return {isSubmissionOpen: false, availabilityReason: 'BATCH_CLOSED'};
  }

  /*
    The boundary is `>=`, not `>`.

    A deadline of 17:00 means work is due *by* 17:00. At exactly 17:00 the time
    is up — treating the boundary instant as still open would give one
    millisecond of grace to whoever happened to hit it, which is both arbitrary
    and impossible to explain.
  */
  if (task.deadline && now.getTime() >= task.deadline.getTime()) {
    return {isSubmissionOpen: false, availabilityReason: 'DEADLINE_PASSED'};
  }

  return {isSubmissionOpen: true, availabilityReason: 'OPEN'};
}

/** True when an Admin may still edit this Task's own fields. */
export function isTaskEditable(status: TaskStatus, batchStatus: string): boolean {
  if (status === TASK_STATUS.ARCHIVED) return false;
  // A completed or archived Batch is read-only throughout.
  return batchStatus === BATCH_STATUS.DRAFT || batchStatus === BATCH_STATUS.ACTIVE;
}
