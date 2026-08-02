/**
 * Resource operations ⟨CP5⟩.
 *
 * **Metadata only.** No file byte reaches a cloud function, in either direction:
 * Parse Server logs every cloud-function call with its serialised input and
 * result, which is exactly how a whole photograph ended up in the log in
 * Checkpoint 3A. Uploading and downloading both go through the dedicated binary
 * route instead, and this file moves titles, descriptions, and order.
 *
 * ── Two audiences, deliberately separate routes ─────────────────────────────
 * `batch-resources/*` is the Admin surface and `student-resources/*` is the
 * Student one. They could have been one route with a role branch inside; they
 * are not, because a shared entry point is where an authorisation branch
 * eventually gets the wrong default. Each route's operations authorise one kind
 * of caller and return one shape of DTO.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {requireAdmin, rejectPrivilegedParams} from '../../utils/auth/authorize';
import {BatchError, batchError} from '../Batch/errors';
import {findBatchById} from '../Batch/repository';
import {
  batchOf,
  describeViewer,
  requireReadAccess,
  requireWriteAccess,
} from './access';
import {
  ResourceDto,
  StudentResourceDto,
  toResourceDto,
  toStudentResourceDto,
  uploadRules,
} from './dto';
import {ResourceError, resourceError} from './errors';
import {resourceLog} from './logging';
import {
  applyResourceOrder,
  deleteResourceRow,
  findResourceById,
  findResourcesForBatch,
  updateResourceMetadata,
} from './repository';
import {removeBinary} from './storage';
import {
  findPrivilegedResourceFields,
  parseOrderedIds,
  validateResourceMetadata,
} from './validation';

/** The Batch, or a stable not-found. Never leaks whether the id was well-formed. */
async function requireBatch(batchId: unknown): Promise<Parse.Object> {
  const id = typeof batchId === 'string' ? batchId.trim() : '';
  if (id.length === 0) throw batchError(BatchError.BATCH_NOT_FOUND);

  const [error, batch] = await catchError(findBatchById(id));
  if (error || !batch) throw batchError(BatchError.BATCH_NOT_FOUND);
  return batch as Parse.Object;
}

/** The Resource, or a stable not-found. */
async function requireResource(resourceId: unknown): Promise<Parse.Object> {
  const id = typeof resourceId === 'string' ? resourceId.trim() : '';
  if (id.length === 0) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);

  const resource = await findResourceById(id);
  if (!resource) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);
  return resource;
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════════

@Route('batch-resources')
class BatchResourceAdminFunctions {
  /**
   * Every Resource of one Batch, in display order.
   *
   * Works for an archived Batch: archived is read-only, not invisible.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List Batch Resources',
      description: 'Every Resource of one Batch, in display order. Admins only.',
      tags: ['Batch resources'],
      responses: {
        '200': {description: 'Safe Resource DTOs and the upload rules'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async listBatchResources(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listBatchResources');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const resources = await findResourcesForBatch(batch.id as string);
    const items: ResourceDto[] = resources.map(toResourceDto);

    resourceLog.info('Batch resources listed', {
      op: 'listBatchResources',
      stage: 'load',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      count: items.length,
    });

    // The rules travel with the list so the upload dialog states the same limits
    // the server enforces, rather than a copy that can drift.
    return {items, rules: uploadRules(), readOnly: Boolean(batch.get('status') === 'archived')};
  }

  /** Change a Resource's title and description. The file is never touched. */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {resourceId: {required: true, type: String}, title: {required: true, type: String}},
    },
    swagger: {
      summary: 'Edit Resource metadata',
      description:
        'Change the title and description. There is no file replacement — the ' +
        'stored bytes are immutable. Admins only.',
      tags: ['Batch resources'],
      responses: {
        '200': {description: 'The updated Resource DTO'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
        '404': {description: 'No such Resource'},
      },
    },
  })
  async updateBatchResource(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'updateBatchResource');
    rejectPrivilegedParams(req, 'updateBatchResource');

    const params = (req.params ?? {}) as Record<string, unknown>;

    const privileged = findPrivilegedResourceFields(params);
    if (privileged.length > 0) {
      throw resourceError(
        ResourceError.RESOURCE_VALIDATION_FAILED,
        Object.fromEntries(privileged.map(field => [field, 'NOT_ALLOWED']))
      );
    }

    const resource = await requireResource(params['resourceId']);
    const batch = batchOf(resource);
    if (!batch) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);

    const viewer = await describeViewer(admin);
    requireWriteAccess(viewer, batch, 'updateBatchResource');

    const {values, errors} = validateResourceMetadata(params);
    if (Object.keys(errors).length > 0) {
      throw resourceError(ResourceError.RESOURCE_VALIDATION_FAILED, errors);
    }

    const saved = await updateResourceMetadata(resource, values);

    resourceLog.info('Resource metadata updated', {
      op: 'updateBatchResource',
      stage: 'complete',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      resourceId: saved.id,
    });

    return toResourceDto(saved);
  }

  /** Put a Batch's Resources in a new order. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Reorder Batch Resources',
      description:
        'Apply a new display order. The whole set is rewritten from the given ' +
        'sequence, so two concurrent reorders cannot interleave. Admins only.',
      tags: ['Batch resources'],
      responses: {
        '200': {description: 'The Resources in their new order'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
        '404': {description: 'No such Batch'},
      },
    },
  })
  async reorderBatchResources(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'reorderBatchResources');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batch = await requireBatch(params['batchId']);
    const viewer = await describeViewer(admin);
    requireWriteAccess(viewer, batch, 'reorderBatchResources');

    const orderedIds = parseOrderedIds(params['orderedIds']);
    if (!orderedIds) {
      throw resourceError(ResourceError.RESOURCE_VALIDATION_FAILED, {
        orderedIds: 'INVALID',
      });
    }

    const reordered = await applyResourceOrder(batch.id as string, orderedIds);

    resourceLog.info('Batch resources reordered', {
      op: 'reorderBatchResources',
      stage: 'reorder',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      count: reordered.length,
    });

    return {items: reordered.map(toResourceDto)};
  }

  /**
   * Delete a Resource and the bytes behind it.
   *
   * **Metadata first, then storage.** A failure between the two leaves bytes
   * with no row — invisible to everybody, reclaimable, and harmless. The other
   * order would leave a row whose download 404s, which is a broken Resource
   * people can see and click.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {resourceId: {required: true, type: String}}},
    swagger: {
      summary: 'Delete a Resource',
      description: 'Removes the Resource and its stored bytes. Admins only.',
      tags: ['Batch resources'],
      responses: {
        '200': {description: 'Deleted'},
        '403': {description: 'Not an Admin, or the Batch is archived'},
        '404': {description: 'No such Resource'},
      },
    },
  })
  async deleteBatchResource(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'deleteBatchResource');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const resource = await requireResource(params['resourceId']);
    const batch = batchOf(resource);
    if (!batch) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);

    const viewer = await describeViewer(admin);
    requireWriteAccess(viewer, batch, 'deleteBatchResource');

    const storageKey = String(resource.get('storageKey') ?? '');
    const resourceId = resource.id;

    await deleteResourceRow(resource);

    // The row is gone whatever happens next. If this throws, the caller learns
    // the bytes may remain — it does not learn a half-truth about the row.
    const removed = await removeBinary(storageKey);

    resourceLog.info('Resource deleted', {
      op: 'deleteBatchResource',
      stage: 'delete',
      ok: true,
      userId: admin.id,
      batchId: batch.id,
      resourceId,
      // Whether bytes were actually there. `false` on a repeat delete is normal.
      count: removed ? 1 : 0,
    });

    return {id: resourceId, deleted: true};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Student
// ═══════════════════════════════════════════════════════════════════════════

@Route('student-resources')
class BatchResourceStudentFunctions {
  /**
   * The Resources of a Batch this Student has joined.
   *
   * Enrollment is checked against the database on every call. An invitation is
   * not enough, and neither is having been invited — only a `BatchEnrollment`
   * that exists right now.
   *
   * Keeps working when the Batch is later completed or archived: a Student who
   * was in a cohort does not lose the material they were given.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'List my Batch Resources',
      description:
        'The Resources of a Batch the caller has joined. Requires a live ' +
        'enrollment; an invitation alone grants nothing.',
      tags: ['Batch resources'],
      responses: {
        '200': {description: 'Safe Resource DTOs'},
        '404': {description: 'No such Batch, or the caller is not in it'},
      },
    },
  })
  async listMyBatchResources(req: Parse.Cloud.FunctionRequest) {
    const user = req.user;
    if (!user) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);

    const params = (req.params ?? {}) as Record<string, unknown>;
    const batch = await requireBatch(params['batchId']);

    const viewer = await describeViewer(user);
    await requireReadAccess(viewer, batch.id as string, 'listMyBatchResources');

    const resources = await findResourcesForBatch(batch.id as string);
    const items: StudentResourceDto[] = resources.map(toStudentResourceDto);

    resourceLog.info('Student resources listed', {
      op: 'listMyBatchResources',
      stage: 'load',
      ok: true,
      userId: user.id,
      batchId: batch.id,
      count: items.length,
    });

    return {items};
  }
}

export {BatchResourceAdminFunctions, BatchResourceStudentFunctions};
