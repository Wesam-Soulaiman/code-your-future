/**
 * Managing Tasks ⟨CP7⟩.
 *
 * Everything an Admin does to a Task: write it, publish it, close it, archive
 * it, copy it, and read who has handed in. Submissions are `studentFunctions`;
 * the Talent Reel controls are `reelFunctions`.
 *
 * ── The freeze is the rule that shapes this file ────────────────────────────
 * The moment any Student has a Submission, a Task's **type, requirements, and
 * attachment** stop being editable. Not out of caution — because a Student
 * answered the question that was asked, and changing what was asked afterwards
 * turns their answer into a reply to something else. Title, description, and
 * deadline stay editable, because fixing a typo or extending a deadline does not
 * change what was asked.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {rejectPrivilegedParams, requireAdmin} from '../../utils/auth/authorize';
import {BatchError, batchError} from '../Batch/errors';
import {findBatchById, findEnrollmentsForBatch} from '../Batch/repository';
import {availabilityOf, isTaskEditable} from './availability';
import {
  batchAllowsTaskEditing,
  batchIsActive,
  batchOf,
} from './access';
import {
  SUBMISSION_STATUS,
  TASK_STATUS,
  TASK_TRANSITIONS,
  TASK_TYPE,
  TaskStatus,
  TaskType,
} from './constants';
import {
  TaskDto,
  TaskStudentRowDto,
  toAdminSubmissionDto,
  toTaskDto,
} from './dto';
import {TaskError, taskError} from './errors';
import {taskLog} from './logging';
import {
  countSubmissionsForTask,
  createTask,
  deleteTaskRow,
  findFinalTaskForBatch,
  findPublicationsForSubmissions,
  findProfilesForStudents,
  findSubmissionsForTask,
  findTaskById,
  findTasksForBatch,
  pointerTo,
  taskHasAnySubmission,
  updateTask,
} from './repository';
import {reevaluateTaskPublications} from './publication';
import {removeBinaryQuietly} from './storage';
import {findPrivilegedTaskFields, validateTask} from './validation';

/** The Batch, or a stable not-found. Never leaks whether the id was well-formed. */
async function requireBatch(batchId: unknown): Promise<Parse.Object> {
  const id = typeof batchId === 'string' ? batchId.trim() : '';
  if (id.length === 0) throw batchError(BatchError.BATCH_NOT_FOUND);

  const [error, batch] = await catchError(findBatchById(id));
  if (error || !batch) throw batchError(BatchError.BATCH_NOT_FOUND);
  return batch as Parse.Object;
}

/** The Task and its Batch, or a stable not-found. */
export async function requireTask(
  taskId: unknown
): Promise<{task: Parse.Object; batch: Parse.Object}> {
  const task = await findTaskById(taskId);
  if (!task) throw taskError(TaskError.TASK_NOT_FOUND);

  const batch = batchOf(task);
  if (!batch) throw taskError(TaskError.TASK_NOT_FOUND);

  return {task, batch};
}

/** Refuse a request that tried to set something only the server may set. */
function rejectPrivileged(params: Record<string, unknown>): void {
  const privileged = findPrivilegedTaskFields(params);
  if (privileged.length === 0) return;

  throw taskError(
    TaskError.TASK_VALIDATION_FAILED,
    Object.fromEntries(privileged.map(field => [field, 'NOT_ALLOWED']))
  );
}

/** Build the Admin DTO, resolving the derived state a Task carries. */
export async function describeTask(
  task: Parse.Object,
  batch: Parse.Object,
  options: {withCounts?: boolean; studentCount?: number} = {}
): Promise<TaskDto> {
  const frozen = await taskHasAnySubmission(task.id);
  const availability = availabilityOf(
    {status: task.get('status') as TaskStatus, deadline: task.get('deadline')},
    String(batch.get('status') ?? '')
  );

  const counts = options.withCounts ? await countSubmissionsForTask(task.id) : undefined;

  return toTaskDto(task, {
    batchId: batch.id as string,
    ...availability,
    editable: isTaskEditable(task.get('status') as TaskStatus, String(batch.get('status') ?? '')),
    requirementsFrozen: frozen,
    submittedCount: counts?.submitted,
    draftCount: counts?.drafts,
    studentCount: options.studentCount,
  });
}

@Route('batch-tasks')
class BatchTaskAdminFunctions {
  /** Every Task of one Batch, newest first, with its counts. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List Batch Tasks',
      description: 'Every Task of one Batch, newest first, with submission counts. Admins only.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'Safe Task DTOs'},
        '404': {description: 'No such Batch, or not an Admin'},
      },
    },
  })
  async listBatchTasks(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listBatchTasks');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const tasks = await findTasksForBatch(batch.id as string);

    const roster = await findEnrollmentsForBatch(batch.id as string, {skip: 0, limit: 1000});
    const studentCount = (roster.enrollments ?? []).length;

    const items: TaskDto[] = [];
    for (const task of tasks) {
      items.push(await describeTask(task, batch, {withCounts: true, studentCount}));
    }

    taskLog.info('Batch Tasks listed', {
      op: 'listBatchTasks',
      stage: 'load',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      count: items.length,
    });

    return {
      items,
      studentCount,
      canCreate: batchAllowsTaskEditing(batch),
      canPublish: batchIsActive(batch),
      hasFinalTask: Boolean(await findFinalTaskForBatch(batch.id as string)),
    };
  }

  /** One Task, with everything the detail page needs. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Get one Task',
      description: 'The Task and its derived availability. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'A safe Task DTO'}, '404': {description: 'No such Task'}},
    },
  })
  async getBatchTask(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getBatchTask');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task, batch} = await requireTask(params['taskId']);
    const roster = await findEnrollmentsForBatch(batch.id as string, {skip: 0, limit: 1000});

    return describeTask(task, batch, {
      withCounts: true,
      studentCount: (roster.enrollments ?? []).length,
    });
  }

  /** Create a Draft Task. A new Task always starts in Draft. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {
        batchId: {required: true, type: String},
        title: {required: true, type: String},
        type: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Create a Task',
      description:
        'Creates a Draft. A Batch may hold at most one Final Task, enforced by ' +
        'a unique index rather than a check. Admins only.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'The new Task DTO'},
        '400': {description: 'Validation failed, or a Final Task already exists'},
      },
    },
  })
  async createBatchTask(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'createBatchTask');
    rejectPrivilegedParams(req, 'createBatchTask');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const batch = await requireBatch(params['batchId']);
    if (!batchAllowsTaskEditing(batch)) throw taskError(TaskError.BATCH_NOT_ACTIVE);

    const {values, errors} = validateTask(params);
    if (Object.keys(errors).length > 0) {
      throw taskError(TaskError.TASK_VALIDATION_FAILED, errors);
    }

    // Reported before the index has to refuse it, so the Admin gets a sentence
    // rather than a duplicate-key error. The index is still what guarantees it.
    if (values.type === TASK_TYPE.FINAL_TASK) {
      const existing = await findFinalTaskForBatch(batch.id as string);
      if (existing) throw taskError(TaskError.FINAL_TASK_ALREADY_EXISTS);
    }

    const task = await createTask({
      batchId: batch.id as string,
      title: values.title,
      description: values.description,
      type: values.type,
      deadline: values.deadline,
      requirements: values.requirements as unknown as Record<string, string>,
      createdBy: admin,
    });

    taskLog.info('Task created', {
      op: 'createBatchTask',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      taskId: task.id,
      taskType: values.type,
    });

    return describeTask(task, batch);
  }

  /**
   * Change a Task.
   *
   * Title, description, and deadline are always editable while the lifecycle
   * allows it. Type, requirements, and the attachment stop being editable the
   * moment any Submission exists — see the note at the top of this file.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {taskId: {required: true, type: String}, title: {required: true, type: String}},
    },
    swagger: {
      summary: 'Update a Task',
      description:
        'Title, description, and deadline stay editable. Type and requirements ' +
        'freeze once any Submission exists. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'The updated Task DTO'}},
    },
  })
  async updateBatchTask(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'updateBatchTask');
    rejectPrivilegedParams(req, 'updateBatchTask');

    const params = (req.params ?? {}) as Record<string, unknown>;
    rejectPrivileged(params);

    const {task, batch} = await requireTask(params['taskId']);
    if (!isTaskEditable(task.get('status') as TaskStatus, String(batch.get('status') ?? ''))) {
      throw taskError(TaskError.TASK_NOT_EDITABLE);
    }

    const existingType = task.get('type') as TaskType;
    const {values, errors} = validateTask(params, {existingType});
    if (Object.keys(errors).length > 0) {
      throw taskError(TaskError.TASK_VALIDATION_FAILED, errors);
    }

    const frozen = await taskHasAnySubmission(task.id);

    const changes: Record<string, unknown> = {
      title: values.title,
      description: values.description,
      deadline: values.deadline,
    };

    if (!frozen) {
      // Only worth writing when they can still change.
      for (const [column, level] of Object.entries(values.requirements)) changes[column] = level;
    } else {
      // A request that tried to change a frozen field is told, rather than
      // having the attempt quietly dropped.
      for (const [column, level] of Object.entries(values.requirements)) {
        if (params[column] !== undefined && task.get(column) !== level) {
          throw taskError(TaskError.TASK_NOT_EDITABLE, {[column]: 'NOT_ALLOWED'});
        }
      }
      if (params['type'] !== undefined && params['type'] !== existingType) {
        throw taskError(TaskError.TASK_NOT_EDITABLE, {type: 'NOT_ALLOWED'});
      }
    }

    const saved = await updateTask(task, changes);

    taskLog.info('Task updated', {
      op: 'updateBatchTask',
      stage: 'persist',
      ok: true,
      userId: admin.id,
      taskId: saved.id,
      status: String(saved.get('status')),
    });

    return describeTask(saved, batch);
  }

  /**
   * Move a Task through its lifecycle.
   *
   * One operation rather than five, because the checks are the same shape and
   * splitting them would mean five places that could disagree about whether a
   * Batch allows the move.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {taskId: {required: true, type: String}, status: {required: true, type: String}},
    },
    swagger: {
      summary: 'Change a Task status',
      description:
        'Publish, return to Draft, Close, Reopen, or Archive. Each move is ' +
        'checked against the transition table and the Batch. Admins only.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'The updated Task DTO'},
        '400': {description: 'Not a legal move right now'},
      },
    },
  })
  async setBatchTaskStatus(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'setBatchTaskStatus');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task, batch} = await requireTask(params['taskId']);
    const from = task.get('status') as TaskStatus;
    const to = params['status'] as TaskStatus;

    const allowed = TASK_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw taskError(TaskError.TASK_INVALID_STATUS);

    const batchStatus = String(batch.get('status') ?? '');
    const changes: Record<string, unknown> = {status: to};

    if (to === TASK_STATUS.PUBLISHED) {
      // Publishing needs a live cohort. A Draft Batch has nobody to publish to,
      // and a completed one has finished.
      if (!batchIsActive(batch)) throw taskError(TaskError.BATCH_NOT_ACTIVE);

      if (from === TASK_STATUS.CLOSED) {
        // Reopening a Task whose deadline has already passed would put it back
        // in a state that refuses every submission — an open Task nobody can
        // answer, which is worse than a closed one.
        const deadline = task.get('deadline');
        if (deadline instanceof Date && Date.now() >= deadline.getTime()) {
          throw taskError(TaskError.TASK_DEADLINE_PASSED);
        }
        changes['closedAt'] = undefined;
      }
      if (!task.get('publishedAt')) changes['publishedAt'] = new Date();
    }

    if (to === TASK_STATUS.DRAFT) {
      // Unpublishing hides a Task from Students. Doing that after somebody has
      // answered would strand their Submission against something they can no
      // longer see.
      if (await taskHasAnySubmission(task.id)) throw taskError(TaskError.TASK_NOT_EDITABLE);
      changes['publishedAt'] = undefined;
    }

    if (to === TASK_STATUS.CLOSED) changes['closedAt'] = new Date();
    if (to === TASK_STATUS.ARCHIVED) changes['archivedAt'] = new Date();

    // A completed or archived Batch is read-only, except that archiving a Task
    // inside it is still tidying rather than changing.
    if (!batchAllowsTaskEditing(batch) && to !== TASK_STATUS.ARCHIVED) {
      throw taskError(TaskError.BATCH_NOT_ACTIVE);
    }
    void batchStatus;

    const saved = await updateTask(task, changes);

    /*
      A Final Task's Reels follow its status ⟨CP8⟩.

      Publication requires the Task to be published, and nothing else would
      notice it stopping: a Reel is otherwise re-decided only when a Student
      submits, and a Student cannot submit to a Task that was just closed. This
      never throws — an Admin closing a Task should not fail because a Reel
      could not be updated.
    */
    if (saved.get('type') === TASK_TYPE.FINAL_TASK) {
      await reevaluateTaskPublications(saved);
    }

    taskLog.info('Task status changed', {
      op: 'setBatchTaskStatus',
      stage:
        to === TASK_STATUS.PUBLISHED
          ? 'publish'
          : to === TASK_STATUS.CLOSED
            ? 'close'
            : to === TASK_STATUS.ARCHIVED
              ? 'archive'
              : 'persist',
      ok: true,
      userId: admin.id,
      taskId: saved.id,
      status: to,
    });

    return describeTask(saved, batch);
  }

  /** Delete a Draft Task that nobody has answered. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Delete a Draft Task',
      description: 'Only a Draft, and only when no Submission exists. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'Deleted'}, '400': {description: 'Not deletable'}},
    },
  })
  async deleteBatchTask(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'deleteBatchTask');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task} = await requireTask(params['taskId']);

    if (task.get('status') !== TASK_STATUS.DRAFT) {
      throw taskError(TaskError.TASK_DELETE_FORBIDDEN);
    }
    if (await taskHasAnySubmission(task.id)) {
      throw taskError(TaskError.TASK_DELETE_FORBIDDEN);
    }

    const storageKey = String(task.get('attachmentStorageKey') ?? '');
    const taskId = task.id;

    // The row first, then the bytes. A failure between the two leaves bytes with
    // no row — invisible and reclaimable — rather than a Task whose download
    // 404s, which is a broken thing somebody can see and click.
    await deleteTaskRow(task);
    if (storageKey) await removeBinaryQuietly(storageKey);

    taskLog.info('Draft Task deleted', {
      op: 'deleteBatchTask',
      stage: 'delete',
      ok: true,
      userId: admin.id,
      taskId,
    });

    return {id: taskId, deleted: true};
  }

  /**
   * Copy a Task into a Batch.
   *
   * Metadata and requirements only. **The attachment is deliberately not
   * copied**: duplicating the bytes would double the storage for something the
   * Admin may not want, and sharing the storage key would mean deleting one Task
   * destroys the other's file. The copy is a Draft with no attachment, and the
   * response says so, so the Admin can attach whatever the new Batch needs.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {taskId: {required: true, type: String}, targetBatchId: {required: true, type: String}},
    },
    swagger: {
      summary: 'Copy a Task',
      description:
        'Copies title, description, type, and requirements into a new Draft. ' +
        'Never copies the attachment, Submissions, or Talent Reels.',
      tags: ['Tasks'],
      responses: {'200': {description: 'The new Draft Task DTO'}},
    },
  })
  async copyBatchTask(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'copyBatchTask');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task} = await requireTask(params['taskId']);
    const target = await requireBatch(params['targetBatchId']);
    if (!batchAllowsTaskEditing(target)) throw taskError(TaskError.BATCH_NOT_ACTIVE);

    const type = task.get('type') as TaskType;
    if (type === TASK_TYPE.FINAL_TASK) {
      const existing = await findFinalTaskForBatch(target.id as string);
      if (existing) throw taskError(TaskError.FINAL_TASK_ALREADY_EXISTS);
    }

    const requirements: Record<string, string> = {};
    for (const column of [
      'githubRequirement',
      'liveDemoRequirement',
      'driveRequirement',
      'videoRequirement',
      'studentNoteRequirement',
    ]) {
      requirements[column] = String(task.get(column));
    }

    const copy = await createTask({
      batchId: target.id as string,
      title: String(task.get('title') ?? ''),
      description: String(task.get('description') ?? ''),
      type,
      // The deadline belongs to the Batch it was set for, not to the words of
      // the Task. A copy starts without one rather than inheriting a date that
      // may already have passed.
      deadline: undefined,
      requirements,
      createdBy: admin,
    });

    taskLog.info('Task copied', {
      op: 'copyBatchTask',
      stage: 'copy',
      ok: true,
      userId: admin.id,
      batchId: target.id,
      taskId: copy.id,
      taskType: type,
    });

    return {
      task: await describeTask(copy, target),
      // Said explicitly, so the UI can tell the Admin rather than leaving them
      // to notice the missing file later.
      attachmentCopied: false,
    };
  }

  /**
   * Remove a Task's attachment.
   *
   * Metadata first, then the bytes — the same order as deleting a Task, and for
   * the same reason: a failure between the two leaves bytes with no reference,
   * which is invisible and reclaimable, rather than a Task advertising a
   * download that 404s.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'Remove a Task attachment',
      description: 'Frozen once any Submission exists. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'The updated Task DTO'}},
    },
  })
  async removeBatchTaskAttachment(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'removeBatchTaskAttachment');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task, batch} = await requireTask(params['taskId']);
    if (!batchAllowsTaskEditing(batch)) throw taskError(TaskError.BATCH_NOT_ACTIVE);
    if (await taskHasAnySubmission(task.id)) throw taskError(TaskError.TASK_NOT_EDITABLE);

    const storageKey = String(task.get('attachmentStorageKey') ?? '');
    if (!storageKey) return describeTask(task, batch);

    const saved = await updateTask(task, {
      attachmentStorageKey: undefined,
      attachmentFilename: undefined,
      attachmentExtension: undefined,
      attachmentMimeType: undefined,
      attachmentSize: undefined,
    });
    await removeBinaryQuietly(storageKey);

    taskLog.info('Attachment removed', {
      op: 'removeBatchTaskAttachment',
      stage: 'detach',
      ok: true,
      userId: admin.id,
      taskId: saved.id,
    });

    return describeTask(saved, batch);
  }

  /**
   * Who has handed in, for one Task.
   *
   * Every enrolled Student appears, including those with no Submission at all —
   * "Not Submitted" is derived from the roster, not from a row somebody wrote to
   * represent an absence.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {taskId: {required: true, type: String}}},
    swagger: {
      summary: 'List Task submission statuses',
      description:
        'One row per enrolled Student. Not Submitted is derived from the ' +
        'roster. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'Safe per-Student rows'}},
    },
  })
  async listTaskSubmissions(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'listTaskSubmissions');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const {task, batch} = await requireTask(params['taskId']);

    const roster = await findEnrollmentsForBatch(batch.id as string, {skip: 0, limit: 1000});
    const submissions = await findSubmissionsForTask(task.id);
    const publications = await findPublicationsForSubmissions(submissions.map(row => row.id));

    const byStudent = new Map(
      submissions.map(row => [(row.get('student') as Parse.User | undefined)?.id ?? '', row])
    );

    /*
      Names come from the Student's profile, not from the `_User`.

      This used to assemble the name from two given-name fields on the user
      object, which this product has never stored there — a Student's name lives
      on `StudentProfile.fullName`, written by them. Every row therefore
      rendered with a blank name, on a table whose entire purpose is telling an
      Admin *who* has submitted. Only opening the page showed it, and a test now
      asserts no module in this module goes back.
    */
    const profiles = await findProfilesForStudents(
      (roster.enrollments ?? [])
        .map(enrollment => (enrollment.get('student') as Parse.User | undefined)?.id)
        .filter((id): id is string => Boolean(id))
    );

    const items: TaskStudentRowDto[] = [];
    for (const enrollment of roster.enrollments ?? []) {
      const student = enrollment.get('student') as Parse.User | undefined;
      if (!student?.id) continue;

      const submission = byStudent.get(student.id);
      const publication = submission ? publications.get(submission.id) : undefined;
      const profile = profiles.get(student.id);

      const row: TaskStudentRowDto = {
        studentId: student.id,
        studentName: String(profile?.get('fullName') ?? '').trim(),
        // Read, not assumed. An incomplete profile is why a Final Task
        // submission cannot become a Talent Reel, so an Admin needs to see it.
        profileComplete: profile?.get('isComplete') === true,
        hasGithub: Boolean(submission?.get('githubUrl')),
        hasLiveDemo: Boolean(submission?.get('liveDemoUrl')),
        hasDrive: Boolean(submission?.get('googleDriveUrl')),
        hasVideo: Boolean(submission?.get('youtubeVideoId')),
      };

      if (submission) {
        row.submissionStatus = submission.get('status');
        row.submissionId = submission.id;
        const submittedAt = submission.get('submittedAt');
        if (submittedAt instanceof Date) row.submittedAt = submittedAt.toISOString();
        const updatedAt = submission.get('updatedAt');
        if (updatedAt instanceof Date) row.updatedAt = updatedAt.toISOString();
      }
      if (publication) row.talentReelStatus = publication.get('status');

      items.push(row);
    }

    const submitted = items.filter(
      row => row.submissionStatus === SUBMISSION_STATUS.SUBMITTED
    ).length;
    const drafts = items.filter(row => row.submissionStatus === SUBMISSION_STATUS.DRAFT).length;

    return {
      items,
      studentCount: items.length,
      submittedCount: submitted,
      draftCount: drafts,
      notSubmittedCount: items.length - submitted - drafts,
    };
  }

  /** One Student's Submission, read-only. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {submissionId: {required: true, type: String}}},
    swagger: {
      summary: 'Read one Submission',
      description:
        'Read-only. There is no edit, delete, score, or feedback anywhere in ' +
        'this surface. Admins only.',
      tags: ['Tasks'],
      responses: {'200': {description: 'A safe Submission DTO'}},
    },
  })
  async getTaskSubmission(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getTaskSubmission');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const submission = await (
      await import('./repository')
    ).findSubmissionById(params['submissionId']);
    if (!submission) throw taskError(TaskError.SUBMISSION_NOT_FOUND);

    const publications = await findPublicationsForSubmissions([submission.id]);

    // The name is on the profile, not the user — see `listTaskSubmissions`.
    // The Submission already points at the profile, so no lookup is needed.
    const profile = submission.get('studentProfile') as Parse.Object | undefined;
    const name = String(profile?.get('fullName') ?? '').trim();

    return toAdminSubmissionDto(submission, name, publications.get(submission.id));
  }
}

export {BatchTaskAdminFunctions, requireBatch, pointerTo};
