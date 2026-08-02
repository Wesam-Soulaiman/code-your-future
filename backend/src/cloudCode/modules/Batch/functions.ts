/**
 * Admin Batch surface — focused operations, no generic CRUD.
 *
 * All mounted under `/api/batches`:
 *
 *   listBatches            a page, searched and filtered
 *   getBatch               one Batch, with its invitation status
 *   createBatch            draft or active only
 *   updateBatch            metadata; never the status
 *   changeBatchStatus      one legal step along the lifecycle
 *   archiveBatch           the terminal step, named for what it is
 *   listBatchStudents      the roster of one Batch
 *   generateBatchInvitation / rotate / revoke / expire / setExpiry
 *
 * Every one of them:
 *   - requires an authenticated session;
 *   - verifies **live** `Admin` role membership, so a withdrawn role takes
 *     effect immediately;
 *   - refuses an archived Batch before doing anything;
 *   - returns a hand-built DTO;
 *   - returns a stable error code and nothing else.
 *
 * There is deliberately no delete: a Batch carries enrollments and invitation
 * history that are somebody's record of belonging, and archiving retires it
 * while keeping that intact.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {requireAdmin, rejectPrivilegedParams} from '../../utils/auth/authorize';
import {
  BATCH_STATUS,
  BatchStatus,
  canTransition,
  isReadOnlyStatus,
  toBatchStatus,
} from './constants';
import {
  BatchDto,
  toBatchDto,
  toInvitationStatusDto,
} from './dto';
import {
  BatchError,
  FieldErrors,
  FieldReason,
  batchError,
  isBatchSurfaceErrorCode,
} from './errors';
import {frontendOrigin} from './frontendOrigin';
import {buildInvitationUrl} from './invitationToken';
import {
  expireCurrentInvitation,
  isInvitationUsable,
  issueInvitation,
  revokeCurrentInvitation,
} from './invitationService';
import {batchLog} from './logging';
import {
  countEnrollments,
  countEnrollmentsForBatches,
  createBatch,
  findBatchById,
  findBatches,
  findCurrentInvitation,
  findEnrollmentsForBatch,
  setBatchStatus,
  setInvitationExpiry,
  updateBatch,
} from './repository';
import {toBatchStudentDto} from './studentSummary';
import {
  findPrivilegedBatchFields,
  normaliseBatchSearch,
  normalisePaging,
  parseExpiry,
  validateBatchInput,
} from './validation';

/**
 * The last gate before a message reaches the client. Anything unexpected — a
 * database failure, a driver stack trace — collapses to a stable code.
 */
function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (typeof message === 'string') {
    const [code] = message.split(':');
    if (isBatchSurfaceErrorCode(code)) return error as Parse.Error;
  }
  return batchError(BatchError.BATCH_SAVE_FAILED);
}

/** Resolve a Batch by id, or fail with a stable code. */
async function requireBatch(id: unknown): Promise<Parse.Object> {
  const [error, batch] = await catchError(findBatchById(id));
  if (error) throw toClientError(error);
  if (!batch) throw batchError(BatchError.BATCH_NOT_FOUND);
  return batch as Parse.Object;
}

/**
 * Resolve a Batch that is about to be changed.
 *
 * Archived is terminal, so every write path goes through here rather than
 * remembering to check — the one place it could be forgotten is the one place
 * it would matter.
 */
async function requireWritableBatch(id: unknown): Promise<Parse.Object> {
  const batch = await requireBatch(id);
  if (isReadOnlyStatus(batch.get('status'))) throw batchError(BatchError.BATCH_READ_ONLY);
  return batch;
}

/** The invitation status card for a Batch, as its Admin sees it. */
async function invitationStatusFor(batch: Parse.Object) {
  const current = await findCurrentInvitation(batch.id as string);
  return toInvitationStatusDto(current, {
    usable: isInvitationUsable(current),
    canManage: !isReadOnlyStatus(batch.get('status')),
  });
}

@Route('batches')
class BatchAdminFunctions {
  /** A page of Batches, searched by name and filtered by status. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'List Batches',
      description: 'A page of Batches for an Admin, searched and filtered. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe Batch DTOs and a total'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not an Admin'},
      },
    },
  })
  async listBatches(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listBatches');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const search = normaliseBatchSearch(params['search']);
    const {skip, limit} = normalisePaging(params);

    const rawStatus = params['status'];
    let status: BatchStatus | undefined;
    if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).length > 0) {
      status = toBatchStatus(rawStatus);
      // An unknown status is refused rather than ignored: silently returning
      // everything would look like a filter that did not apply.
      if (!status) {
        throw batchError(BatchError.BATCH_VALIDATION_FAILED, {
          status: FieldReason.NOT_ALLOWED,
        });
      }
    }

    const [error, page] = await catchError(findBatches({search, status, skip, limit}));
    if (error || !page) throw toClientError(error);

    const batches = page.batches;
    const counts = await countEnrollmentsForBatches(batches.map(batch => batch.id as string));
    const items: BatchDto[] = batches.map(batch =>
      toBatchDto(batch, counts.get(batch.id as string) ?? 0)
    );

    batchLog.info('Batches listed', {
      op: 'listBatches',
      stage: 'load',
      ok: true,
      userId: admin.id,
      count: items.length,
      status,
    });

    return {items, total: page.total, skip, limit};
  }

  /** One Batch, with its enrollment count and invitation status. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Get a Batch',
      description: 'One Batch with its invitation status. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe Batch DTO'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async getBatch(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'getBatch');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const count = await countEnrollments(batch.id as string);

    batchLog.info('Batch read', {
      op: 'getBatch',
      stage: 'load',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      status: String(batch.get('status')),
    });

    return {
      batch: toBatchDto(batch, count),
      invitation: await invitationStatusFor(batch),
    };
  }

  /** Create a Batch. Draft unless the Admin explicitly chose active. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Create a Batch',
      description: 'Create a Batch in draft or active. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Created; returns the safe DTO'},
        '400': {description: 'Validation failed'},
        '403': {description: 'Not an Admin'},
      },
    },
  })
  async createBatch(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'createBatch');
    const admin = await requireAdmin(req, 'createBatch');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const privileged = findPrivilegedBatchFields(params);
    if (privileged.length > 0) {
      const fields: FieldErrors = {};
      for (const key of privileged) fields[key] = FieldReason.NOT_ALLOWED;
      batchLog.warn('Rejected server-controlled fields in a Batch create', {
        op: 'createBatch',
        stage: 'validate',
        ok: false,
        userId: admin.id,
        fieldCount: privileged.length,
        code: BatchError.BATCH_VALIDATION_FAILED,
      });
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, fields);
    }

    const {values, errors} = validateBatchInput(params);
    if (Object.keys(errors).length > 0) {
      batchLog.warn('Batch validation failed', {
        op: 'createBatch',
        stage: 'validate',
        ok: false,
        userId: admin.id,
        // A count, never the names: which fields an Admin got wrong is theirs.
        fieldCount: Object.keys(errors).length,
        code: BatchError.BATCH_VALIDATION_FAILED,
      });
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, errors);
    }

    const [error, batch] = await catchError(createBatch(values, admin));
    if (error || !batch) throw toClientError(error);

    batchLog.info('Batch created', {
      op: 'createBatch',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: (batch as Parse.Object).id,
      status: values.status,
    });

    return toBatchDto(batch as Parse.Object, 0);
  }

  /** Edit metadata. The status is changed through its own operation. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Update a Batch',
      description: 'Edit name, description, and dates. Archived Batches are refused.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Saved; returns the safe DTO'},
        '400': {description: 'Validation failed'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async updateBatch(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'updateBatch');
    const admin = await requireAdmin(req, 'updateBatch');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);

    const privileged = findPrivilegedBatchFields(params);
    if (privileged.length > 0) {
      const fields: FieldErrors = {};
      for (const key of privileged) fields[key] = FieldReason.NOT_ALLOWED;
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, fields);
    }

    // The stored status wins: editing metadata never moves a Batch along its
    // lifecycle, so a `status` in the payload is simply not read.
    const {values, errors} = validateBatchInput(
      params,
      String(batch.get('status')) as BatchStatus
    );
    if (Object.keys(errors).length > 0) {
      batchLog.warn('Batch validation failed', {
        op: 'updateBatch',
        stage: 'validate',
        ok: false,
        userId: admin.id,
        batchId: batch.id,
        fieldCount: Object.keys(errors).length,
        code: BatchError.BATCH_VALIDATION_FAILED,
      });
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, errors);
    }

    const [error, saved] = await catchError(updateBatch(batch, values));
    if (error || !saved) throw toClientError(error);

    batchLog.info('Batch updated', {
      op: 'updateBatch',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: (saved as Parse.Object).id,
      status: values.status,
    });

    return toBatchDto(saved as Parse.Object, await countEnrollments(batch.id as string));
  }

  /**
   * Move a Batch one legal step along its lifecycle.
   *
   * The transition table is the authority, and it allows no backward step and
   * nothing at all out of `archived`.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {batchId: {required: true, type: String}, status: {required: true, type: String}},
    },
    swagger: {
      summary: 'Change a Batch status',
      description:
        'Move a Batch one legal step. No backward transitions; archived is terminal.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Saved; returns the safe DTO'},
        '403': {description: 'Not an Admin, the Batch is archived, or the step is illegal'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async changeBatchStatus(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'changeBatchStatus');
    const admin = await requireAdmin(req, 'changeBatchStatus');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);
    const current = String(batch.get('status')) as BatchStatus;

    const next = toBatchStatus(params['status']);
    if (!next) throw batchError(BatchError.BATCH_INVALID_STATUS);
    if (!canTransition(current, next)) {
      batchLog.warn('Refused an illegal Batch transition', {
        op: 'changeBatchStatus',
        stage: 'validate',
        ok: false,
        userId: admin.id,
        batchId: batch.id,
        status: current,
        code: BatchError.BATCH_INVALID_STATUS,
      });
      throw batchError(BatchError.BATCH_INVALID_STATUS);
    }

    const [error, saved] = await catchError(setBatchStatus(batch, next));
    if (error || !saved) throw toClientError(error);

    batchLog.info('Batch status changed', {
      op: 'changeBatchStatus',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: (saved as Parse.Object).id,
      status: next,
    });

    return toBatchDto(saved as Parse.Object, await countEnrollments(batch.id as string));
  }

  /**
   * Archive a Batch.
   *
   * Its own operation rather than a status change with a special value, because
   * it is the one step that cannot be undone and deserves to be asked for by
   * name. Legal from every non-archived status.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Archive a Batch',
      description: 'Terminal and irreversible. The Batch becomes read-only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Archived; returns the safe DTO'},
        '403': {description: 'Not an Admin, or already archived'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async archiveBatch(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'archiveBatch');
    const admin = await requireAdmin(req, 'archiveBatch');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);

    // Archiving retires the join link with the Batch: leaving a live token on a
    // read-only Batch would be a link that looks fine and can never work.
    await catchError(revokeCurrentInvitation(batch, admin, 'archiveBatch'));

    const [error, saved] = await catchError(setBatchStatus(batch, BATCH_STATUS.ARCHIVED));
    if (error || !saved) throw toClientError(error);

    batchLog.info('Batch archived', {
      op: 'archiveBatch',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: (saved as Parse.Object).id,
      status: BATCH_STATUS.ARCHIVED,
    });

    return toBatchDto(saved as Parse.Object, await countEnrollments(batch.id as string));
  }

  /** A page of the Batch's roster. Only enrolled members, never all Students. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List the Students in a Batch',
      description: 'The enrolled members of one Batch, as read-only summaries. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe Student summaries and a total'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async listBatchStudents(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listBatchStudents');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const {skip, limit} = normalisePaging(params);
    const search = normaliseBatchSearch(params['search']);

    const [error, page] = await catchError(
      findEnrollmentsForBatch(batch.id as string, {skip, limit})
    );
    if (error || !page) throw toClientError(error);

    const items = await toBatchStudentDto(page.enrollments, search);

    batchLog.info('Batch roster listed', {
      op: 'listBatchStudents',
      stage: 'load',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      count: items.length,
    });

    return {items, total: page.total, skip, limit};
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Invitations
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Issue the current invitation — generate or rotate, one operation.
   *
   * The raw token is in this response and nowhere else, ever. Rotating
   * invalidates the previous token before the new one exists.
   */
  @CloudFunction({
    methods: ['POST'],
    rateLimit: {windowMs: 60_000, max: 20},
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Generate or rotate the Batch invitation',
      description:
        'Issues the current invitation and returns the raw token **once**. Any ' +
        'previous token is invalidated immediately. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'The one copy of the token, plus its link'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async issueBatchInvitation(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'issueBatchInvitation');
    const admin = await requireAdmin(req, 'issueBatchInvitation');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);

    const expiry = parseExpiry(params['expiresAt']);
    if (expiry.reason) {
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, {
        expiresAt: FieldReason[expiry.reason],
      });
    }

    const [error, issued] = await catchError(
      issueInvitation(batch, admin, expiry.value, 'issueBatchInvitation')
    );
    if (error || !issued) throw toClientError(error);

    const origin = frontendOrigin();

    return {
      // The one copy. Not stored, not logged, not recoverable.
      token: issued.token,
      // Absolute when an origin is configured; the browser falls back to its
      // own origin and the path otherwise. Never a hardcoded host.
      invitationUrl: origin ? buildInvitationUrl(origin, issued.token) : undefined,
      invitationPath: `/#/join/${issued.token}`,
      invitation: toInvitationStatusDto(issued.invitation, {usable: true, canManage: true}),
    };
  }

  /** The invitation status card. Never a token, never a hash. */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Get the Batch invitation status',
      description:
        'State, fingerprint, version, and expiry. Never the token — it cannot ' +
        'be recovered from its hash.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe invitation status'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async getBatchInvitation(req: Parse.Cloud.FunctionRequest) {
    await requireAdmin(req, 'getBatchInvitation');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    return invitationStatusFor(batch);
  }

  /** Take the current link out of service. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Revoke the Batch invitation',
      description: 'The current link stops working immediately. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe invitation status'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
      },
    },
  })
  async revokeBatchInvitation(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'revokeBatchInvitation');
    const admin = await requireAdmin(req, 'revokeBatchInvitation');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);
    const [error] = await catchError(
      revokeCurrentInvitation(batch, admin, 'revokeBatchInvitation')
    );
    if (error) throw toClientError(error);

    return invitationStatusFor(batch);
  }

  /** Expire the current link now. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Expire the Batch invitation now',
      description: 'The current link stops working immediately. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe invitation status'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
      },
    },
  })
  async expireBatchInvitation(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'expireBatchInvitation');
    const admin = await requireAdmin(req, 'expireBatchInvitation');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);
    const [error] = await catchError(
      expireCurrentInvitation(batch, admin, 'expireBatchInvitation')
    );
    if (error) throw toClientError(error);

    return invitationStatusFor(batch);
  }

  /**
   * Set or clear the expiry on the current link.
   *
   * Changing when a link stops working does not change the link, so no token is
   * minted and none is returned.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Set the Batch invitation expiry',
      description: 'Set or clear the expiry without changing the link. Admins only.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe invitation status'},
        '400': {description: 'The expiry is not a future instant'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
      },
    },
  })
  async setBatchInvitationExpiry(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'setBatchInvitationExpiry');
    const admin = await requireAdmin(req, 'setBatchInvitationExpiry');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireWritableBatch(params['batchId']);

    const expiry = parseExpiry(params['expiresAt']);
    if (expiry.reason) {
      throw batchError(BatchError.BATCH_VALIDATION_FAILED, {
        expiresAt: FieldReason[expiry.reason],
      });
    }

    const current = await findCurrentInvitation(batch.id as string);
    if (!current) throw batchError(BatchError.BATCH_NOT_FOUND);

    const [error, saved] = await catchError(setInvitationExpiry(current, expiry.value));
    if (error || !saved) throw toClientError(error);

    batchLog.info('Invitation expiry updated', {
      op: 'setBatchInvitationExpiry',
      stage: 'invitation',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      invitationId: (saved as Parse.Object).id,
    });

    return invitationStatusFor(batch);
  }
}

export default BatchAdminFunctions;
export {requireBatch, requireWritableBatch, toClientError, invitationStatusFor};
