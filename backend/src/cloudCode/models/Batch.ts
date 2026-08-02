import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {BATCH_STATUSES, BatchStatus, isReadOnlyStatus} from '../modules/Batch/constants';

/**
 * `Batch` — a cohort of Students, and the only grouping concept in the product.
 *
 * There is deliberately no `Program`: Batch is the whole hierarchy, and the word
 * "Batch" is used everywhere in the code, the API, and both languages.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every class-level operation and an empty default object
 * ACL. Nobody touches this class directly: an Admin manages Batches through
 * focused operations, a Student receives a sanitised DTO of a Batch they belong
 * to, and a Visitor holding an invitation receives a smaller preview DTO still.
 *
 * `protectedFields` covers every column as a second layer, so a query that
 * somehow reached this class would read an empty shell.
 *
 * ── The lifecycle, and why it is enforced here too ──────────────────────────
 * `archived` is **terminal and read-only**. The cloud functions refuse an
 * archived Batch before they do anything, and the trigger below refuses it
 * again — because "read-only" that lives only in one call path stops being true
 * the first time somebody adds a second call path.
 *
 * There is **no hard delete**. A Batch accumulates enrollments and invitation
 * history that are somebody's record of belonging; archiving retires it while
 * keeping that record intact.
 */
@ParseClass('Batch', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': ['name', 'description', 'startDate', 'endDate', 'status', 'createdBy'],
      authenticated: ['name', 'description', 'startDate', 'endDate', 'status', 'createdBy'],
    },
  },
  // Deny-by-default. Every read and write goes through an authorised operation
  // using the master key; no per-record ACL grants anybody direct access.
  ACL: {},
  description:
    'A cohort of Students. Server-controlled; never readable or writable ' +
    'directly by any client.',
})
export default class Batch extends BaseModel {
  constructor() {
    super('Batch');
  }

  @ParseField({type: 'String', required: true, description: 'Batch name, as the Admin writes it'})
  name!: string;

  @ParseField({type: 'String', description: 'Optional description'})
  description!: string;

  @ParseField({type: 'Date', required: true, description: 'When the Batch starts'})
  startDate!: Date;

  @ParseField({type: 'Date', description: 'Optional end date. Never before the start date.'})
  endDate!: Date;

  @ParseField({
    type: 'String',
    required: true,
    description: 'draft | active | completed | archived. Archived is terminal.',
  })
  status!: BatchStatus;

  /**
   * Who created it.
   *
   * Audit only. It is never returned in any DTO — a Student has no business
   * knowing which Admin account set up their cohort, and a Visitor holding an
   * invitation certainly does not.
   */
  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    description: 'The Admin who created this Batch. Audit only; never in a DTO.',
  })
  createdBy!: Parse.User;

  // ==================== TRIGGERS ====================

  /**
   * The last line of defence, independent of which operation saved.
   *
   * The CLP already denies client writes; this also protects against a future
   * server-side path that forgets the master key, and enforces the two rules
   * that must hold however a Batch is written.
   */
  @BeforeSave({description: 'Reject client writes, enforce the status set, keep archived terminal'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<Batch>) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Batches are server-controlled');
    }

    const status = object.get('status');
    if (!(BATCH_STATUSES as readonly string[]).includes(String(status))) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unknown Batch status');
    }

    const start = object.get('startDate');
    const end = object.get('endDate');
    if (start instanceof Date && end instanceof Date && end.getTime() < start.getTime()) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Batch cannot end before it starts');
    }

    if (object.dirty('ACL')) {
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'A Batch cannot be made public');
      }
    }

    if (object.isNew()) return;

    // Archived is terminal: once a Batch carries it, nothing about the Batch
    // may change again — not its status, and not its metadata.
    const previous = request.original?.get('status');
    if (isReadOnlyStatus(previous)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'An archived Batch is read-only'
      );
    }
  }
}
