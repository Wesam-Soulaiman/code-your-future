import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {
  ATTACHMENT_MAX_BYTES,
  REQUIREMENT_COLUMNS,
  TASK_LIMITS,
  TASK_STATUS,
  TASK_STATUSES,
  TASK_TYPE,
  TASK_TYPES,
  TaskStatus,
  TaskType,
  isRequirement,
} from '../modules/BatchTask/constants';

/**
 * `BatchTask` — one piece of work an Admin sets for a Batch ⟨CP7⟩.
 *
 * Named `BatchTask` rather than `Task` on purpose: `Task` is a word half the
 * libraries in a Node process already use, and a Parse class competing with one
 * of them is a debugging session nobody needs.
 *
 * ── `finalForBatch` is a sentinel, not a duplicate ──────────────────────────
 * "At most one Final Task per Batch" is enforced by a **unique partial index**
 * on a pointer that exists only on a Final Task, not by a query-then-create that
 * two concurrent requests both pass. It is the third time this repository has
 * needed the pattern — `BatchInvitation.currentForBatch` and
 * `LiveSlideSession.liveForBatch` are the others — and it is the only way the
 * guarantee survives a race.
 *
 * ── Why the requirements are five columns, not a JSON blob ──────────────────
 * A `requirements: {...}` object would be one column and would accept anything.
 * Five typed columns each bounded to three values mean the database itself
 * refuses a sixth field, a misspelled level, and a nested surprise — and the
 * freeze check has something concrete to compare.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No `displayOrder` — Tasks are ordered by creation and there is no manual
 * reordering. No score, grade, feedback, review state, or reviewer. No rich
 * text. No second attachment. Each of those was named out of scope, and a
 * column is where a feature starts.
 */
@ParseClass('BatchTask', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'batch',
        'title',
        'description',
        'type',
        'status',
        'deadline',
        'finalForBatch',
        'githubRequirement',
        'liveDemoRequirement',
        'driveRequirement',
        'videoRequirement',
        'studentNoteRequirement',
        'attachmentFilename',
        'attachmentExtension',
        'attachmentMimeType',
        'attachmentSize',
        'attachmentStorageKey',
        'publishedAt',
        'closedAt',
        'archivedAt',
        'createdBy',
      ],
      authenticated: [
        'batch',
        'title',
        'description',
        'type',
        'status',
        'deadline',
        'finalForBatch',
        'githubRequirement',
        'liveDemoRequirement',
        'driveRequirement',
        'videoRequirement',
        'studentNoteRequirement',
        'attachmentFilename',
        'attachmentExtension',
        'attachmentMimeType',
        'attachmentSize',
        'attachmentStorageKey',
        'publishedAt',
        'closedAt',
        'archivedAt',
        'createdBy',
      ],
    },
  },
  // Deny-by-default. Every read and write goes through an authorised operation
  // using the master key; no per-record ACL grants anybody direct access.
  ACL: {},
  compoundIndexes: [
    {
      // **At most one Final Task per Batch**, enforced by the database.
      //
      // `_p_finalForBatch` is the MongoDB column the pointer occupies. It is set
      // only on a Final Task, so every Assignment sits outside the partial index
      // and cannot collide — while two simultaneous Final Task creates cannot
      // both win.
      fields: ['_p_finalForBatch'],
      unique: true,
      name: 'batch_task_final_per_batch_unique',
      partialFilterNulls: true,
    },
    {
      // The Admin's list: a Batch's Tasks, newest first.
      fields: ['_p_batch', 'createdAt'],
      name: 'batch_task_batch_created_index',
    },
    {
      // The Student's list and the status filter.
      fields: ['_p_batch', 'status'],
      name: 'batch_task_batch_status_index',
    },
    {
      // The type filter, and the "does this Batch already have a Final Task?"
      // read that reports the conflict before the index has to.
      fields: ['_p_batch', 'type'],
      name: 'batch_task_batch_type_index',
    },
    {
      // Attachment cleanup and the download's key lookup. Unique because two
      // Tasks sharing a storage key would mean deleting one destroys the
      // other's bytes.
      fields: ['attachmentStorageKey'],
      unique: true,
      name: 'batch_task_attachment_key_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'One Task set for one Batch. Assignment or Final Task. Never readable or ' +
    'writable directly by any client.',
})
export default class BatchTask extends BaseModel {
  constructor() {
    super('BatchTask');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'The Batch this Task belongs to. Immutable after creation',
  })
  batch!: Parse.Object;

  @ParseField({type: 'String', required: true, description: 'Task title'})
  title!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'What the Student has to do. Plain text — never rendered as HTML',
  })
  description!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'ASSIGNMENT or FINAL_TASK. Frozen once a Submission exists',
  })
  type!: TaskType;

  @ParseField({
    type: 'String',
    required: true,
    description: 'DRAFT | PUBLISHED | CLOSED | ARCHIVED',
  })
  status!: TaskStatus;

  @ParseField({
    type: 'Date',
    description: 'Optional. Stored UTC. After it passes there are no late submissions',
  })
  deadline!: Date;

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    description: 'Set only on a Final Task. The sentinel behind the unique index',
  })
  finalForBatch!: Parse.Object;

  // ── Submission requirements ───────────────────────────────────────────────

  @ParseField({type: 'String', required: true, description: 'NOT_USED | OPTIONAL | REQUIRED'})
  githubRequirement!: string;

  @ParseField({type: 'String', required: true, description: 'NOT_USED | OPTIONAL | REQUIRED'})
  liveDemoRequirement!: string;

  @ParseField({type: 'String', required: true, description: 'NOT_USED | OPTIONAL | REQUIRED'})
  driveRequirement!: string;

  @ParseField({type: 'String', required: true, description: 'NOT_USED | OPTIONAL | REQUIRED'})
  videoRequirement!: string;

  @ParseField({type: 'String', required: true, description: 'NOT_USED | OPTIONAL | REQUIRED'})
  studentNoteRequirement!: string;

  // ── The optional private attachment ───────────────────────────────────────

  @ParseField({type: 'String', description: 'Sanitised original filename, sent back on download'})
  attachmentFilename!: string;

  @ParseField({type: 'String', description: 'Lower-case, with the dot'})
  attachmentExtension!: string;

  @ParseField({type: 'String', description: 'The MIME type this product decided on'})
  attachmentMimeType!: string;

  @ParseField({type: 'Number', description: 'Size in bytes'})
  attachmentSize!: number;

  @ParseField({
    type: 'String',
    description: 'Private storage key. Server-only; never in a DTO or a log',
  })
  attachmentStorageKey!: string;

  // ── Lifecycle stamps ──────────────────────────────────────────────────────

  @ParseField({type: 'Date', description: 'When it was published. Server clock only'})
  publishedAt!: Date;

  @ParseField({type: 'Date', description: 'When it was closed. Server clock only'})
  closedAt!: Date;

  @ParseField({type: 'Date', description: 'When it was archived. Server clock only'})
  archivedAt!: Date;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Admin who created it. Resolved from the session, never sent',
  })
  createdBy!: Parse.User;

  /**
   * The invariants, enforced at the database boundary.
   *
   * The operations check all of this first. This trigger exists because a rule
   * that lives in only one call path stops being true the moment somebody adds
   * a second one.
   */
  @BeforeSave({description: 'Reject client writes, bound the vocabulary, hold the Final sentinel'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<BatchTask>): Promise<void> {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'BatchTask is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      if (!object.get('batch')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Task requires a Batch');
      }
      if (!object.get('createdBy')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Task requires a creator');
      }
    } else if (object.dirty('batch')) {
      // A Task that could change Batch would carry its Students' submissions
      // into a cohort those Students are not in.
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A Task cannot change Batch after creation'
      );
    }

    const type = object.get('type');
    if (!TASK_TYPES.includes(type as TaskType)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported task type');
    }

    const status = object.get('status');
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported task status');
    }

    const title = String(object.get('title') ?? '').trim();
    if (title.length < TASK_LIMITS.title.min || title.length > TASK_LIMITS.title.max) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Task requires a title');
    }

    const description = String(object.get('description') ?? '').trim();
    if (
      description.length < TASK_LIMITS.description.min ||
      description.length > TASK_LIMITS.description.max
    ) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Task requires a description');
    }

    for (const column of REQUIREMENT_COLUMNS) {
      if (!isRequirement(object.get(column))) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${column} must be a known requirement`);
      }
    }

    const deadline = object.get('deadline');
    if (deadline !== undefined && deadline !== null && !(deadline instanceof Date)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A deadline must be an instant');
    }

    const size = object.get('attachmentSize');
    if (size !== undefined && size !== null) {
      if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'An attachment requires a size');
      }
      if (size > ATTACHMENT_MAX_BYTES) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'An attachment exceeds the size limit');
      }
    }

    // The sentinel exists exactly on a Final Task. Enforced here so no call path
    // can leave an Assignment holding a Batch's one Final slot, or a Final Task
    // outside the index that guarantees it is the only one.
    const isFinal = type === TASK_TYPE.FINAL_TASK;
    if (isFinal && !object.get('finalForBatch')) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'A Final Task must hold the Batch final sentinel'
      );
    }
    if (!isFinal && object.get('finalForBatch')) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Only a Final Task may hold the Batch final sentinel'
      );
    }

    // Archived is terminal, and the stamp records when.
    if (status === TASK_STATUS.ARCHIVED && !object.get('archivedAt')) {
      object.set('archivedAt', new Date());
    }

    // Deny-by-default at the record level too.
    object.setACL(new Parse.ACL());
  }
}
