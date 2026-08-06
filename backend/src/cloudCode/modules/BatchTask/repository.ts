/**
 * Reading and writing Tasks, Submissions, and publications ⟨CP7⟩.
 *
 * Every query uses the master key, because all three classes grant nobody
 * anything — authorisation happened in the operation that called in here,
 * against the caller's live roles and their enrollment. Nothing in this file
 * decides who may do what; it decides how.
 */

import {catchError} from '@90soft/parse-server-kit';

import {
  PUBLICATION_STATUS,
  SUBMISSION_PAGE,
  SUBMISSION_STATUS,
  TASK_PAGE,
  TASK_STATUS,
  TASK_TYPE,
  TaskStatus,
} from './constants';
import {TaskError, taskError} from './errors';
import {describeFailure, taskLog} from './logging';

const TASK_CLASS = 'BatchTask';
const SUBMISSION_CLASS = 'TaskSubmission';
const PUBLICATION_CLASS = 'TalentReelPublication';
const BATCH_CLASS = 'Batch';
const PROFILE_CLASS = 'StudentProfile';

/** A pointer without fetching the row it points at. */
export function pointerTo(className: string, objectId: string): Parse.Object {
  const pointer = new Parse.Object(className);
  pointer.id = objectId;
  return pointer;
}

/**
 * True when a write failed because a unique index refused it.
 *
 * Mongo reports 11000; Parse maps it to 137 when it recognises the index. Both
 * are checked because which one arrives depends on whether Parse knows the
 * index by name.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const record = error as {code?: unknown; message?: unknown} | undefined;
  if (record?.code === 137 || record?.code === 11000) return true;
  return typeof record?.message === 'string' && record.message.includes('E11000');
}

// ═══════════════════════════════════════════════════════════════════════════
// Tasks
// ═══════════════════════════════════════════════════════════════════════════

/** Every Task of one Batch, newest first. */
export async function findTasksForBatch(
  batchId: string,
  filter: {statuses?: readonly TaskStatus[]} = {}
): Promise<Parse.Object[]> {
  const query = new Parse.Query(TASK_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  if (filter.statuses && filter.statuses.length > 0) {
    query.containedIn('status', [...filter.statuses]);
  }
  query.descending('createdAt');
  query.limit(TASK_PAGE.maxLimit);

  const [error, tasks] = await catchError(query.find({useMasterKey: true}));
  if (error) throw taskError(TaskError.TASK_NOT_FOUND);
  return (tasks as Parse.Object[]) ?? [];
}

/** One Task by id, with its Batch included. Does **not** authorise. */
export async function findTaskById(taskId: unknown): Promise<Parse.Object | undefined> {
  if (typeof taskId !== 'string' || taskId.trim().length === 0) return undefined;

  const query = new Parse.Query(TASK_CLASS);
  query.include('batch');

  const [error, task] = await catchError(query.get(taskId.trim(), {useMasterKey: true}));
  if (error) return undefined;
  return (task as Parse.Object | undefined) ?? undefined;
}

/** The Batch's Final Task, if it has one. */
export async function findFinalTaskForBatch(batchId: string): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(TASK_CLASS);
  query.equalTo('finalForBatch', pointerTo(BATCH_CLASS, batchId));

  const [error, task] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (task as Parse.Object | undefined) ?? undefined;
}

export interface NewTask {
  batchId: string;
  title: string;
  description: string;
  type: string;
  deadline?: Date;
  requirements: Record<string, string>;
  createdBy: Parse.User;
}

/**
 * Create a Draft Task.
 *
 * A Final Task also takes the Batch's one Final sentinel. If another Final Task
 * already holds it the unique index refuses this write, and that is reported as
 * `FINAL_TASK_ALREADY_EXISTS` — because that is exactly what happened, and it is
 * the outcome two simultaneous creates must produce.
 */
export async function createTask(input: NewTask): Promise<Parse.Object> {
  const TaskClass = Parse.Object.extend(TASK_CLASS);
  const task = new TaskClass() as Parse.Object;

  task.set('batch', pointerTo(BATCH_CLASS, input.batchId));
  task.set('title', input.title);
  task.set('description', input.description);
  task.set('type', input.type);
  task.set('status', TASK_STATUS.DRAFT);
  task.set('createdBy', input.createdBy);
  if (input.deadline) task.set('deadline', input.deadline);
  for (const [column, level] of Object.entries(input.requirements)) task.set(column, level);

  if (input.type === TASK_TYPE.FINAL_TASK) {
    task.set('finalForBatch', pointerTo(BATCH_CLASS, input.batchId));
  }

  const [error, saved] = await catchError(task.save(null, {useMasterKey: true}));
  if (error || !saved) {
    if (isDuplicateKeyError(error)) throw taskError(TaskError.FINAL_TASK_ALREADY_EXISTS);

    taskLog.error('Creating a Task failed', {
      op: 'createTask',
      stage: 'persist',
      ok: false,
      batchId: input.batchId,
      taskType: input.type,
      code: TaskError.TASK_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw taskError(TaskError.TASK_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

/** Apply changed columns to a Task. The caller has checked it may. */
export async function updateTask(
  task: Parse.Object,
  changes: Record<string, unknown>
): Promise<Parse.Object> {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) task.unset(key);
    else task.set(key, value);
  }

  const [error, saved] = await catchError(task.save(null, {useMasterKey: true}));
  if (error || !saved) {
    if (isDuplicateKeyError(error)) throw taskError(TaskError.FINAL_TASK_ALREADY_EXISTS);

    taskLog.error('Updating a Task failed', {
      op: 'updateTask',
      stage: 'persist',
      ok: false,
      taskId: task.id,
      code: TaskError.TASK_VALIDATION_FAILED,
      ...describeFailure(error),
    });
    throw taskError(TaskError.TASK_VALIDATION_FAILED);
  }
  return saved as Parse.Object;
}

export async function deleteTaskRow(task: Parse.Object): Promise<void> {
  const [error] = await catchError(task.destroy({useMasterKey: true}));
  if (error) throw taskError(TaskError.TASK_DELETE_FORBIDDEN);
}

// ═══════════════════════════════════════════════════════════════════════════
// Submissions
// ═══════════════════════════════════════════════════════════════════════════

/** One Student's Submission for one Task, if it exists. */
export async function findSubmission(
  taskId: string,
  student: Parse.User
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(SUBMISSION_CLASS);
  query.equalTo('task', pointerTo(TASK_CLASS, taskId));
  query.equalTo('student', student);

  const [error, submission] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (submission as Parse.Object | undefined) ?? undefined;
}

/** One Submission by id, with its Task included. Does **not** authorise. */
export async function findSubmissionById(
  submissionId: unknown
): Promise<Parse.Object | undefined> {
  if (typeof submissionId !== 'string' || submissionId.trim().length === 0) return undefined;

  const query = new Parse.Query(SUBMISSION_CLASS);
  query.include(['task', 'task.batch']);
  query.include('student');
  // The Admin's read renders the Student's name, which lives on the profile.
  query.include('studentProfile');

  const [error, submission] = await catchError(
    query.get(submissionId.trim(), {useMasterKey: true})
  );
  if (error) return undefined;
  return (submission as Parse.Object | undefined) ?? undefined;
}

/** Every Submission for one Task. The Admin's status table. */
export async function findSubmissionsForTask(taskId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(SUBMISSION_CLASS);
  query.equalTo('task', pointerTo(TASK_CLASS, taskId));
  query.include('student');
  query.limit(SUBMISSION_PAGE.maxLimit * 10);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (rows as Parse.Object[]) ?? [];
}

/** How many Submissions a Task has, by status. */
export async function countSubmissionsForTask(
  taskId: string
): Promise<{drafts: number; submitted: number; total: number}> {
  const rows = await findSubmissionsForTask(taskId);
  const submitted = rows.filter(row => row.get('status') === SUBMISSION_STATUS.SUBMITTED).length;
  return {drafts: rows.length - submitted, submitted, total: rows.length};
}

/** True when any Submission exists — the trigger for freezing a Task. */
export async function taskHasAnySubmission(taskId: string): Promise<boolean> {
  const query = new Parse.Query(SUBMISSION_CLASS);
  query.equalTo('task', pointerTo(TASK_CLASS, taskId));

  const [error, count] = await catchError(query.count({useMasterKey: true}));
  // A failed count is treated as "yes, there is one": refusing to unfreeze is
  // the safe way to be wrong.
  if (error) return true;
  return ((count as number) ?? 0) > 0;
}

export interface NewSubmission {
  taskId: string;
  batchId: string;
  student: Parse.User;
  studentProfileId: string;
}

/**
 * Create the Submission row.
 *
 * A duplicate-key failure means this Student already has one for this Task —
 * two saves raced. The caller re-reads and updates that row instead, so the
 * outcome is one row either way.
 */
export async function createSubmission(
  input: NewSubmission
): Promise<{created: true; submission: Parse.Object} | {created: false}> {
  const SubmissionClass = Parse.Object.extend(SUBMISSION_CLASS);
  const submission = new SubmissionClass() as Parse.Object;

  submission.set('task', pointerTo(TASK_CLASS, input.taskId));
  submission.set('batch', pointerTo(BATCH_CLASS, input.batchId));
  submission.set('student', input.student);
  submission.set('studentProfile', pointerTo(PROFILE_CLASS, input.studentProfileId));
  submission.set('status', SUBMISSION_STATUS.DRAFT);
  submission.set('hasEverBeenSubmitted', false);

  const [error, saved] = await catchError(submission.save(null, {useMasterKey: true}));
  if (error || !saved) {
    if (isDuplicateKeyError(error)) return {created: false};

    taskLog.error('Creating a Submission failed', {
      op: 'createSubmission',
      stage: 'persist',
      ok: false,
      taskId: input.taskId,
      code: TaskError.SUBMISSION_FAILED,
      ...describeFailure(error),
    });
    throw taskError(TaskError.SUBMISSION_FAILED);
  }
  return {created: true, submission: saved as Parse.Object};
}

/** Apply changed columns to a Submission. */
export async function updateSubmission(
  submission: Parse.Object,
  changes: Record<string, unknown>
): Promise<Parse.Object> {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) submission.unset(key);
    else submission.set(key, value);
  }

  const [error, saved] = await catchError(submission.save(null, {useMasterKey: true}));
  if (error || !saved) {
    taskLog.error('Updating a Submission failed', {
      op: 'updateSubmission',
      stage: 'persist',
      ok: false,
      submissionId: submission.id,
      code: TaskError.SUBMISSION_FAILED,
      ...describeFailure(error),
    });
    throw taskError(TaskError.SUBMISSION_FAILED);
  }
  return saved as Parse.Object;
}

export async function deleteSubmissionRow(submission: Parse.Object): Promise<void> {
  const [error] = await catchError(submission.destroy({useMasterKey: true}));
  // The model's `beforeDelete` refuses a submitted row; that refusal is the
  // product rule, so it is reported as such rather than as a storage failure.
  if (error) throw taskError(TaskError.SUBMISSION_DELETE_FORBIDDEN);
}

/** One profile's Submissions, newest first. The Student Detail history. */
export async function findSubmissionsForProfile(
  profileId: string,
  page: {skip: number; limit: number}
): Promise<{items: Parse.Object[]; total: number}> {
  const query = new Parse.Query(SUBMISSION_CLASS);
  query.equalTo('studentProfile', pointerTo(PROFILE_CLASS, profileId));
  query.include(['task', 'task.batch']);
  query.descending('updatedAt');
  query.skip(page.skip);
  query.limit(page.limit);

  const [error, found] = await catchError(query.withCount().find({useMasterKey: true}));
  if (error) return {items: [], total: 0};

  const result = found as unknown as {results?: Parse.Object[]; count?: number};
  return {items: result?.results ?? [], total: result?.count ?? 0};
}

/** The Student's profile, for the pointer a Submission must carry. */
export async function findProfileForStudent(
  student: Parse.User
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(PROFILE_CLASS);
  query.equalTo('user', student);

  const [error, profile] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (profile as Parse.Object | undefined) ?? undefined;
}

/**
 * Profiles for a whole roster, keyed by user id.
 *
 * One query for the page rather than one per Student: the Admin's status table
 * shows every enrolled Student, and a per-row lookup would turn a class of
 * thirty into thirty-one round trips.
 */
export async function findProfilesForStudents(
  studentIds: readonly string[]
): Promise<Map<string, Parse.Object>> {
  const out = new Map<string, Parse.Object>();
  if (studentIds.length === 0) return out;

  const query = new Parse.Query(PROFILE_CLASS);
  query.containedIn(
    'user',
    studentIds.map(id => pointerTo('_User', id))
  );
  query.limit(SUBMISSION_PAGE.maxLimit * 10);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return out;

  for (const row of (rows as Parse.Object[]) ?? []) {
    const id = (row.get('user') as Parse.User | undefined)?.id;
    if (id) out.set(id, row);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Talent Reel publications
// ═══════════════════════════════════════════════════════════════════════════

/** The publication record for one Submission, if one exists. */
export async function findPublicationForSubmission(
  submissionId: string
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(PUBLICATION_CLASS);
  query.equalTo('submission', pointerTo(SUBMISSION_CLASS, submissionId));

  const [error, publication] = await catchError(query.first({useMasterKey: true}));
  if (error) return undefined;
  return (publication as Parse.Object | undefined) ?? undefined;
}

/** Publication records for a set of Submissions, keyed by submission id. */
export async function findPublicationsForSubmissions(
  submissionIds: readonly string[]
): Promise<Map<string, Parse.Object>> {
  const out = new Map<string, Parse.Object>();
  if (submissionIds.length === 0) return out;

  const query = new Parse.Query(PUBLICATION_CLASS);
  query.containedIn(
    'submission',
    submissionIds.map(id => pointerTo(SUBMISSION_CLASS, id))
  );
  query.limit(SUBMISSION_PAGE.maxLimit * 10);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return out;

  for (const row of (rows as Parse.Object[]) ?? []) {
    const id = (row.get('submission') as Parse.Object | undefined)?.id;
    if (id) out.set(id, row);
  }
  return out;
}

/** Every publication produced by one Task. Bounded by the Batch roster. */
export async function findPublicationsForTask(taskId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(PUBLICATION_CLASS);
  query.equalTo('task', pointerTo(TASK_CLASS, taskId));
  query.include('submission');
  query.limit(SUBMISSION_PAGE.maxLimit * 10);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (rows as Parse.Object[]) ?? [];
}

/** Every publication belonging to one Student profile. */
export async function findPublicationsForProfile(profileId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(PUBLICATION_CLASS);
  query.equalTo('studentProfile', pointerTo(PROFILE_CLASS, profileId));
  query.include('submission');
  query.limit(SUBMISSION_PAGE.maxLimit);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return [];
  return (rows as Parse.Object[]) ?? [];
}

/** Create or update a publication record. */
export async function savePublication(
  existing: Parse.Object | undefined,
  values: Record<string, unknown>
): Promise<Parse.Object> {
  const PublicationClass = Parse.Object.extend(PUBLICATION_CLASS);
  const publication = existing ?? (new PublicationClass() as Parse.Object);

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) publication.unset(key);
    else publication.set(key, value);
  }

  const [error, saved] = await catchError(publication.save(null, {useMasterKey: true}));
  if (error || !saved) {
    taskLog.error('Saving a Talent Reel publication failed', {
      op: 'savePublication',
      stage: 'reel',
      ok: false,
      publicationId: existing?.id,
      ...describeFailure(error),
    });
    throw taskError(TaskError.SUBMISSION_FAILED);
  }
  return saved as Parse.Object;
}

export {PUBLICATION_STATUS, SUBMISSION_STATUS, TASK_STATUS};
