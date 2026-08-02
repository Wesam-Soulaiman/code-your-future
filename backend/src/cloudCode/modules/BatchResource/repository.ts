/**
 * Reading and writing Resource metadata ⟨CP5⟩.
 *
 * Every query uses the master key, because the class grants nobody anything —
 * authorisation happened in the operation that called in here, against the
 * caller's live roles and their enrollment. Nothing in this file decides who may
 * do what; it decides how.
 */

import {catchError} from '@90soft/parse-server-kit';

import {ResourceError, resourceError} from './errors';
import {REORDER_MAX_ITEMS} from './constants';
import {describeFailure, resourceLog} from './logging';

const RESOURCE_CLASS = 'BatchResource';
const BATCH_CLASS = 'Batch';

/** A pointer without fetching the row it points at. */
export function pointerTo(className: string, objectId: string): Parse.Object {
  const pointer = new Parse.Object(className);
  pointer.id = objectId;
  return pointer;
}

/** Every Resource of one Batch, in display order. Backed by the compound index. */
export async function findResourcesForBatch(batchId: string): Promise<Parse.Object[]> {
  const query = new Parse.Query(RESOURCE_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.ascending('displayOrder');
  // A secondary key, so two Resources that somehow share an order still come
  // back in a stable sequence rather than whatever the storage engine felt like.
  query.addAscending('createdAt');
  query.limit(REORDER_MAX_ITEMS);

  const [error, resources] = await catchError(query.find({useMasterKey: true}));
  if (error) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);
  return (resources as Parse.Object[]) ?? [];
}

/** One Resource by id, or undefined. Does **not** authorise. */
export async function findResourceById(resourceId: string): Promise<Parse.Object | undefined> {
  if (typeof resourceId !== 'string' || resourceId.trim().length === 0) return undefined;

  const query = new Parse.Query(RESOURCE_CLASS);
  query.include('batch');

  const [error, resource] = await catchError(query.get(resourceId.trim(), {useMasterKey: true}));
  if (error) return undefined;
  return (resource as Parse.Object | undefined) ?? undefined;
}

/** How many Resources a Batch already has. Used to place a new one at the end. */
export async function countResourcesForBatch(batchId: string): Promise<number> {
  const query = new Parse.Query(RESOURCE_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));

  const [error, count] = await catchError(query.count({useMasterKey: true}));
  if (error) throw resourceError(ResourceError.RESOURCE_NOT_FOUND);
  return (count as number) ?? 0;
}

/**
 * The next display order for a Batch.
 *
 * Reads the current maximum rather than counting, so a Batch that has had
 * Resources deleted does not reuse an order and collide with a survivor.
 */
export async function nextDisplayOrder(batchId: string): Promise<number> {
  const query = new Parse.Query(RESOURCE_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.descending('displayOrder');
  query.limit(1);

  const [error, found] = await catchError(query.first({useMasterKey: true}));
  if (error) {
    resourceLog.error('Reading the next display order failed', {
      op: 'nextDisplayOrder',
      stage: 'load',
      ok: false,
      batchId,
      ...describeFailure(error),
    });
    throw resourceError(ResourceError.RESOURCE_NOT_FOUND);
  }

  const highest = (found as Parse.Object | undefined)?.get('displayOrder');
  return typeof highest === 'number' && Number.isFinite(highest) ? highest + 1 : 0;
}

export interface NewResource {
  batchId: string;
  title: string;
  description?: string;
  filename: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  uploadedBy: Parse.User;
  displayOrder: number;
}

/**
 * Create the metadata row.
 *
 * Called **after** the bytes are stored, so a row can never point at storage
 * that does not exist. The reverse — bytes with no row — is possible for a
 * moment and is exactly what the caller's cleanup handles.
 */
export async function createResource(input: NewResource): Promise<Parse.Object> {
  const resource = new Parse.Object(RESOURCE_CLASS);
  resource.set('batch', pointerTo(BATCH_CLASS, input.batchId));
  resource.set('title', input.title);
  if (input.description) resource.set('description', input.description);
  resource.set('filename', input.filename);
  resource.set('extension', input.extension);
  resource.set('mimeType', input.mimeType);
  resource.set('fileSize', input.fileSize);
  resource.set('storageKey', input.storageKey);
  resource.set('uploadedBy', input.uploadedBy);
  resource.set('displayOrder', input.displayOrder);

  const [error, saved] = await catchError(resource.save(null, {useMasterKey: true}));
  if (error || !saved) {
    // The caller gets a stable code and nothing else. The reason stays here,
    // redacted — a failure that logs only `RESOURCE_UPLOAD_FAILED` is a failure
    // nobody can diagnose.
    resourceLog.error('Creating a resource row failed', {
      op: 'createResource',
      stage: 'persist',
      ok: false,
      batchId: input.batchId,
      code: ResourceError.RESOURCE_UPLOAD_FAILED,
      ...describeFailure(error),
    });
    throw resourceError(ResourceError.RESOURCE_UPLOAD_FAILED);
  }
  return saved as Parse.Object;
}

/**
 * Update the metadata a caller is allowed to change.
 *
 * Title and description, and nothing else. The model's trigger refuses any
 * attempt to touch the file's own fields, so this being the only write path is
 * belt and braces rather than the whole guarantee.
 */
export async function updateResourceMetadata(
  resource: Parse.Object,
  changes: {title: string; description?: string}
): Promise<Parse.Object> {
  resource.set('title', changes.title);

  if (changes.description && changes.description.length > 0) {
    resource.set('description', changes.description);
  } else {
    resource.unset('description');
  }

  const [error, saved] = await catchError(resource.save(null, {useMasterKey: true}));
  if (error || !saved) throw resourceError(ResourceError.RESOURCE_VALIDATION_FAILED);
  return saved as Parse.Object;
}

/**
 * Apply a new order to a Batch's Resources.
 *
 * ── Why the whole set, and why it is re-read here ───────────────────────────
 * The caller sends the ids in the order it wants. This re-reads what the Batch
 * actually has and applies positions to **that**, so a request built against a
 * stale list cannot do damage: an id that no longer exists is ignored, and a
 * Resource the caller did not mention keeps a position after the ones it did —
 * it never silently vanishes from the ordering or collides at zero.
 *
 * Positions are rewritten from 0 in one `saveAll`, so the result is the same
 * whichever order two concurrent reorder requests arrive in: the last writer
 * wins completely, rather than the two interleaving into a sequence neither
 * asked for.
 */
export async function applyResourceOrder(
  batchId: string,
  orderedIds: readonly string[]
): Promise<Parse.Object[]> {
  const existing = await findResourcesForBatch(batchId);
  if (existing.length === 0) return [];

  const byId = new Map(existing.map(resource => [resource.id, resource]));

  // The ids the caller named, in their order, keeping only ones that are really
  // in this Batch. A duplicate id is honoured once.
  const seen = new Set<string>();
  const sequence: Parse.Object[] = [];
  for (const id of orderedIds) {
    const resource = byId.get(id);
    if (!resource || seen.has(id)) continue;
    seen.add(id);
    sequence.push(resource);
  }

  // Anything the caller did not mention keeps its relative order, after the
  // rest. Dropping it would leave a Resource unreachable in the list.
  for (const resource of existing) {
    if (!seen.has(resource.id)) sequence.push(resource);
  }

  sequence.forEach((resource, index) => resource.set('displayOrder', index));

  const [error, saved] = await catchError(
    Parse.Object.saveAll(sequence, {useMasterKey: true})
  );
  if (error) throw resourceError(ResourceError.RESOURCE_VALIDATION_FAILED);
  return (saved as Parse.Object[]) ?? sequence;
}

/**
 * Delete one metadata row.
 *
 * The bytes are removed by the caller, which owns the ordering: metadata first,
 * then storage. That way a failure between the two leaves bytes without a row —
 * invisible, reclaimable, and harmless — rather than a row whose download would
 * 404, which is a broken Resource somebody can see.
 */
export async function deleteResourceRow(resource: Parse.Object): Promise<void> {
  const [error] = await catchError(resource.destroy({useMasterKey: true}));
  if (error) throw resourceError(ResourceError.RESOURCE_DELETE_FAILED);
}
