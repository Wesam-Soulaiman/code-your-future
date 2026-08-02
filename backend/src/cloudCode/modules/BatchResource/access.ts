/**
 * Who may see and touch a Resource ⟨CP5⟩.
 *
 * One module, used by the cloud functions **and** by the download route, so the
 * two can never disagree about who is allowed what. A download that authorised
 * differently from the list it appeared in would be the whole bug.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *   - an **Admin** may read every Resource, and may write to one whose Batch is
 *     not archived;
 *   - an **enrolled Student** may read the Resources of a Batch they joined, and
 *     may never write;
 *   - a **Visitor** may do nothing;
 *   - a Student who was invited but has not joined may do nothing — an
 *     invitation is permission to join, not permission to read.
 *
 * A Student keeps reading after their Batch is completed or archived. They were
 * in it; the material they were given does not stop being theirs because the
 * cohort finished.
 */

import {catchError, getUserRoles} from '@90soft/parse-server-kit';

import {AppRole, toAppRole} from '../../utils/constants/roles';
import {isReadOnlyStatus} from '../Batch/constants';
import {findEnrollment} from '../Batch/repository';
import {ResourceError, resourceError} from './errors';
import {resourceLog} from './logging';

/** The application roles this session actually holds, live from `_Role`. */
export async function liveRoles(user: Parse.User): Promise<AppRole[]> {
  const [error, names] = await catchError(getUserRoles(user));
  if (error || !names) return [];
  return (names as string[])
    .map(name => toAppRole(name))
    .filter((role): role is AppRole => role !== undefined);
}

export interface ResourceViewer {
  user: Parse.User;
  isAdmin: boolean;
  isStudent: boolean;
}

/** Classify the caller. Roles are read live, never from anything they sent. */
export async function describeViewer(user: Parse.User): Promise<ResourceViewer> {
  const roles = await liveRoles(user);
  return {
    user,
    isAdmin: roles.includes(AppRole.ADMIN),
    isStudent: roles.includes(AppRole.STUDENT),
  };
}

/**
 * May this caller **read** the Resources of this Batch?
 *
 * An Admin may. A Student may only if a `BatchEnrollment` exists for the pair —
 * checked against the database on every call, so a membership removed a moment
 * ago stops working immediately.
 */
export async function canReadBatchResources(
  viewer: ResourceViewer,
  batchId: string
): Promise<boolean> {
  if (viewer.isAdmin) return true;
  if (!viewer.isStudent) return false;

  const [error, enrollment] = await catchError(findEnrollment(batchId, viewer.user));
  if (error) return false;
  return Boolean(enrollment);
}

/**
 * Require read access, or throw.
 *
 * Throws **NOT_FOUND**, not ACCESS_DENIED. "You may not see this" confirms the
 * Batch exists and has Resources; somebody probing ids would learn which ones
 * are real. A Batch the caller cannot read answers exactly as a made-up id does.
 */
export async function requireReadAccess(
  viewer: ResourceViewer,
  batchId: string,
  op: string
): Promise<void> {
  if (await canReadBatchResources(viewer, batchId)) return;

  resourceLog.warn('Resource read refused', {
    op,
    stage: 'authorize',
    ok: false,
    userId: viewer.user.id,
    batchId,
    code: ResourceError.RESOURCE_NOT_FOUND,
  });
  throw resourceError(ResourceError.RESOURCE_NOT_FOUND);
}

/**
 * Require write access to a Batch's Resources, or throw.
 *
 * Admin only, and never on an archived Batch. This one **does** answer
 * ACCESS_DENIED: the caller is an Admin who can already see the Batch, so its
 * existence is not a secret — only the action is refused, and saying why is what
 * lets the UI explain it.
 */
export function requireWriteAccess(
  viewer: ResourceViewer,
  batch: Parse.Object,
  op: string
): void {
  if (!viewer.isAdmin) {
    resourceLog.warn('Resource write refused for a non-Admin', {
      op,
      stage: 'authorize',
      ok: false,
      userId: viewer.user.id,
      batchId: batch.id,
      code: ResourceError.RESOURCE_ACCESS_DENIED,
    });
    throw resourceError(ResourceError.RESOURCE_ACCESS_DENIED);
  }

  const status = String(batch.get('status') ?? '');
  if (isReadOnlyStatus(status)) {
    resourceLog.warn('Resource write refused on an archived Batch', {
      op,
      stage: 'authorize',
      ok: false,
      userId: viewer.user.id,
      batchId: batch.id,
      status,
      code: ResourceError.RESOURCE_ACCESS_DENIED,
    });
    throw resourceError(ResourceError.RESOURCE_ACCESS_DENIED);
  }
}

/**
 * The Batch a Resource belongs to, from the Resource itself.
 *
 * Deliberately **not** taken from a `batchId` the caller supplied. A request
 * that names both a Resource and a Batch invites the two to disagree, and the
 * caller chooses one of them; reading the pointer means the relationship is
 * whatever the database says it is.
 */
export function batchOf(resource: Parse.Object): Parse.Object | undefined {
  const batch = resource.get('batch');
  return batch && typeof batch.id === 'string' ? (batch as Parse.Object) : undefined;
}
