/**
 * What a Student can see and do with a Task ⟨CP7⟩.
 *
 * ── The whole surface is "me" ───────────────────────────────────────────────
 * Every operation resolves the Student from **their session token**. No
 * signature accepts a `studentId` or a `studentProfileId`, so none of them can
 * be pointed at somebody else even by mistake — and nothing any of them returns
 * mentions another Student's name, work, or existence.
 *
 * ── Save Draft and Submit are the same write ────────────────────────────────
 * Both update the one row. The difference is what is checked and what the status
 * becomes, which is why they share `writeSubmission` rather than being two
 * functions that drift apart. A Draft may be missing required fields — a draft
 * that refused to save until it was finished would not be a draft — but anything
 * present must be valid either way.
 *
 * ── Saving a submitted row back to Draft is a real un-submitting ────────────
 * It clears `submittedAt`, it stops counting as handed in, and it unpublishes
 * any Talent Reel that came from it. The UI says so before it happens. What it
 * does **not** do is let the row be deleted afterwards: `hasEverBeenSubmitted`
 * stays true for good.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {rejectPrivilegedParams, requireStudent} from '../../utils/auth/authorize';
import {findBatchById, findEnrollment} from '../Batch/repository';
import {availabilityOf} from './availability';
import {batchOf, describeViewer, requireEnrolled} from './access';
import {
  STUDENT_VISIBLE_TASK_STATUSES,
  SUBMISSION_STATUS,
  TASK_STATUS,
  TaskStatus,
  TaskType,
} from './constants';
import {StudentTaskDto, toStudentTaskDto, toSubmissionDto} from './dto';
import {TaskError, taskError} from './errors';
import {taskLog} from './logging';
import {reevaluatePublication, withdrawPublicationForSubmission} from './publication';
import {
  createSubmission,
  deleteSubmissionRow,
  findProfileForStudent,
  findPublicationForSubmission,
  findSubmission,
  findTaskById,
  findTasksForBatch,
  updateSubmission,
} from './repository';
import {findPrivilegedTaskFields, validateSubmission} from './validation';
import {requirementsOf} from './dto';

/** The Task and its Batch, or a stable not-found. */
async function requireVisibleTask(
  taskId: unknown,
  student: Parse.User
): Promise<{task: Parse.Object; batch: Parse.Object}> {
  const task = await findTaskById(taskId);
  if (!task) throw taskError(TaskError.TASK_NOT_FOUND);

  const batch = batchOf(task);
  if (!batch) throw taskError(TaskError.TASK_NOT_FOUND);

  // A Draft Task is not a Task to a Student. Answering "not found" rather than
  // "not published" means they cannot tell a Draft exists at all.
  if (!STUDENT_VISIBLE_TASK_STATUSES.includes(task.get('status') as TaskStatus)) {
    throw taskError(TaskError.TASK_NOT_FOUND);
  }

  const enrollment = await findEnrollment(batch.id as string, student);
  if (!enrollment) throw taskError(TaskError.TASK_NOT_FOUND);

  return {task, batch};
}

/** The one write path behind Save Draft and Submit. */
async function writeSubmission(
  req: Parse.Cloud.FunctionRequest,
  op: 'saveMyTaskDraft' | 'submitMyTask'
) {
  const student = await requireStudent(req, op);
  rejectPrivilegedParams(req, op);

  const params = (req.params ?? {}) as Record<string, unknown>;

  // A request naming a Student, a status, or a timestamp is refused outright
  // rather than ignored: it means something upstream believes it can choose.
  const privileged = findPrivilegedTaskFields(params);
  if (privileged.length > 0) {
    throw taskError(
      TaskError.SUBMISSION_VALIDATION_FAILED,
      Object.fromEntries(privileged.map(field => [field, 'NOT_ALLOWED']))
    );
  }

  const {task, batch} = await requireVisibleTask(params['taskId'], student);
  const forSubmit = op === 'submitMyTask';

  // ── Is this Task accepting work right now? ────────────────────────────────
  const availability = availabilityOf(
    {status: task.get('status') as TaskStatus, deadline: task.get('deadline')},
    String(batch.get('status') ?? '')
  );
  if (!availability.isSubmissionOpen) {
    taskLog.warn('Submission refused', {
      op,
      stage: 'authorize',
      ok: false,
      userId: student.id,
      taskId: task.id,
      availability: availability.availabilityReason,
    });
    throw taskError(
      availability.availabilityReason === 'DEADLINE_PASSED'
        ? TaskError.TASK_DEADLINE_PASSED
        : availability.availabilityReason === 'BATCH_NOT_ACTIVE' ||
            availability.availabilityReason === 'BATCH_CLOSED'
          ? TaskError.BATCH_NOT_ACTIVE
          : availability.availabilityReason === 'ARCHIVED'
            ? TaskError.TASK_ARCHIVED
            : TaskError.TASK_NOT_OPEN
    );
  }

  // The profile must exist and be complete: a Submission becomes part of a
  // profile's history, and a history needs somebody to belong to.
  const profile = await findProfileForStudent(student);
  if (!profile || profile.get('isComplete') !== true) {
    throw taskError(TaskError.PROFILE_INCOMPLETE);
  }

  // ── Validate against the Task's own requirements ──────────────────────────
  const check = validateSubmission(
    params,
    {type: task.get('type') as TaskType, requirements: requirementsOf(task)},
    forSubmit
  );

  if (check.notUsed.length > 0) {
    throw taskError(
      TaskError.SUBMISSION_FIELD_NOT_USED,
      Object.fromEntries(check.notUsed.map(field => [field, 'NOT_ALLOWED']))
    );
  }
  if (Object.keys(check.errors).length > 0) {
    throw taskError(TaskError.SUBMISSION_VALIDATION_FAILED, check.errors);
  }
  if (forSubmit && check.missing.length > 0) {
    throw taskError(
      TaskError.SUBMISSION_REQUIRED_FIELD_MISSING,
      Object.fromEntries(check.missing.map(field => [field, 'REQUIRED']))
    );
  }

  // ── One row, created or found ─────────────────────────────────────────────
  let submission = await findSubmission(task.id, student);
  if (!submission) {
    const created = await createSubmission({
      taskId: task.id,
      batchId: batch.id as string,
      student,
      studentProfileId: profile.id,
    });
    if (created.created) {
      submission = created.submission;
    } else {
      // The unique index refused it: two saves raced and the other won. Its row
      // is the one row, so this request updates that instead of failing.
      submission = await findSubmission(task.id, student);
      if (!submission) throw taskError(TaskError.SUBMISSION_FAILED);
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const changes: Record<string, unknown> = {...check.values};

  // A field that is configured but absent from this payload is cleared, so a
  // Student can remove a link they no longer want rather than being stuck with
  // whatever they first typed.
  for (const field of [
    'githubUrl',
    'liveDemoUrl',
    'googleDriveUrl',
    'youtubeVideoId',
    'studentNote',
    'publicProjectTitle',
    'publicProjectDescription',
    'myContribution',
    'technologies',
  ]) {
    if (!(field in changes) && field in params) changes[field] = undefined;
  }

  if (forSubmit) {
    changes['status'] = SUBMISSION_STATUS.SUBMITTED;
    changes['hasEverBeenSubmitted'] = true;
    // The server's clock. A client timestamp would let a late submission claim
    // to have arrived before the deadline.
    changes['submittedAt'] = new Date();
  } else {
    changes['status'] = SUBMISSION_STATUS.DRAFT;
    changes['submittedAt'] = undefined;
  }

  const saved = await updateSubmission(submission, changes);

  // ── Talent Reels follow from the Submission, never the other way round ────
  const outcome = await reevaluatePublication(saved, task, profile);

  taskLog.info(forSubmit ? 'Task submitted' : 'Task draft saved', {
    op,
    stage: 'submit',
    ok: true,
    userId: student.id,
    taskId: task.id,
    submissionId: saved.id,
    taskType: String(task.get('type')),
    status: String(saved.get('status')),
    published: outcome.published,
  });

  return toSubmissionDto(saved, outcome.publication);
}

@Route('student-tasks')
class StudentTaskFunctions {
  /** Every visible Task of one joined Batch, with this Student's own state. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List my Batch Tasks',
      description:
        'Published, closed, and archived Tasks of a Batch this Student joined, ' +
        'each with their own submission state. Drafts are invisible.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'Safe Task DTOs'},
        '404': {description: 'No such Batch, or the caller is not in it'},
      },
    },
  })
  async listMyBatchTasks(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'listMyBatchTasks');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batchId = typeof params['batchId'] === 'string' ? params['batchId'].trim() : '';
    if (batchId.length === 0) throw taskError(TaskError.TASK_NOT_FOUND);

    const viewer = await describeViewer(student);
    await requireEnrolled(viewer, batchId, 'listMyBatchTasks');

    const [batchError2, batch] = await catchError(findBatchById(batchId));
    if (batchError2 || !batch) throw taskError(TaskError.TASK_NOT_FOUND);

    const tasks = await findTasksForBatch(batchId, {statuses: STUDENT_VISIBLE_TASK_STATUSES});
    const batchStatus = String((batch as Parse.Object).get('status') ?? '');

    const items: StudentTaskDto[] = [];
    for (const task of tasks) {
      const submission = await findSubmission(task.id, student);
      items.push(
        toStudentTaskDto(task, {
          batchId,
          ...availabilityOf(
            {status: task.get('status') as TaskStatus, deadline: task.get('deadline')},
            batchStatus
          ),
          submission,
        })
      );
    }

    taskLog.info('Student Tasks listed', {
      op: 'listMyBatchTasks',
      stage: 'load',
      ok: true,
      userId: student.id,
      batchId,
      count: items.length,
    });

    return {items};
  }

  /** One visible Task, with this Student's own Submission. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Get one of my Tasks',
      description: 'The Task and this Student’s own Submission, if they have one.',
      tags: ['Tasks'],
      responses: {'200': {description: 'A safe Task DTO and Submission'}},
    },
  })
  async getMyBatchTask(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'getMyBatchTask');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task, batch} = await requireVisibleTask(params['taskId'], student);
    const submission = await findSubmission(task.id, student);
    const publication = submission
      ? await findPublicationForSubmission(submission.id)
      : undefined;

    return {
      task: toStudentTaskDto(task, {
        batchId: batch.id as string,
        ...availabilityOf(
          {status: task.get('status') as TaskStatus, deadline: task.get('deadline')},
          String(batch.get('status') ?? '')
        ),
        submission,
      }),
      submission: submission ? toSubmissionDto(submission, publication) : undefined,
    };
  }

  /** Save a Draft. Incomplete required fields are fine; invalid ones are not. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Save my draft',
      description:
        'Updates the one Submission row. Required fields may be missing; ' +
        'anything supplied must still be valid.',
      tags: ['Tasks'],
      responses: {'200': {description: 'The stored Submission'}},
    },
  })
  async saveMyTaskDraft(req: Parse.Cloud.FunctionRequest) {
    return writeSubmission(req, 'saveMyTaskDraft');
  }

  /** Submit. Everything the Admin marked required must be present and valid. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Submit my task',
      description:
        'Validates every required field, stamps the server clock, and ' +
        're-evaluates Talent Reel publication for a Final Task.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'The submitted Submission'},
        '400': {description: 'Closed, or a required field is missing'},
      },
    },
  })
  async submitMyTask(req: Parse.Cloud.FunctionRequest) {
    return writeSubmission(req, 'submitMyTask');
  }

  /**
   * Delete a Draft that has never been submitted.
   *
   * Once something has been handed in, the record that it was handed in is not
   * the Student's to remove — saving it back to Draft must not become a way to
   * erase it. The model's `beforeDelete` refuses that independently.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Delete my never-submitted draft',
      description: 'Only a Draft that has never been submitted can be deleted.',
      tags: ['Tasks'],
      responses: {'200': {description: 'Deleted'}, '400': {description: 'Not deletable'}},
    },
  })
  async deleteMyTaskDraft(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'deleteMyTaskDraft');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task} = await requireVisibleTask(params['taskId'], student);
    const submission = await findSubmission(task.id, student);
    if (!submission) throw taskError(TaskError.SUBMISSION_NOT_FOUND);

    if (submission.get('hasEverBeenSubmitted') === true) {
      throw taskError(TaskError.SUBMISSION_DELETE_FORBIDDEN);
    }

    const submissionId = submission.id;
    await deleteSubmissionRow(submission);

    // No Submission, no public page ⟨CP8B⟩. Only a never-submitted Draft can
    // be deleted, so this is normally a no-op — but the rule should not depend
    // on that staying true.
    await withdrawPublicationForSubmission(submissionId);

    taskLog.info('Draft Submission deleted', {
      op: 'deleteMyTaskDraft',
      stage: 'delete',
      ok: true,
      userId: student.id,
      taskId: task.id,
      submissionId,
    });

    return {id: submissionId, deleted: true};
  }
}

export {StudentTaskFunctions, TASK_STATUS};
