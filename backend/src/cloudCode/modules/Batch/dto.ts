/**
 * The Batch DTOs — three audiences, three shapes.
 *
 * Every one is a hand-built allow-list, like every other DTO in this
 * repository. A raw `Parse.Object` is never returned, so ACL, pointers, and any
 * column added later cannot leak by default.
 *
 * The three shapes exist because the three audiences genuinely differ:
 *
 *   - **Admin** manages Batches, so gets the metadata and the counts.
 *   - **Student** belongs to one, so gets the same facts minus anything
 *     administrative — no `createdBy`, no invitation state, no roster.
 *   - **Visitor** holds a link and has proved nothing, so gets the least: just
 *     enough to recognise the Batch they are being invited to and be told
 *     whether they can join.
 *
 * None of them ever carries a token, a token hash, an invitation id, a Student,
 * or an Admin.
 */

import {BatchStatus, acceptsEnrollment} from './constants';
import {InvitationState} from './invitationConstants';

// ═══════════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchDto {
  id: string;
  name: string;
  description?: string;
  /** `YYYY-MM-DD`. The UI works in days, not instants. */
  startDate: string;
  endDate?: string;
  status: BatchStatus;
  /** True when this Batch can never change again. */
  readOnly: boolean;
  /** True when a Student could join it right now. */
  acceptsEnrollment: boolean;
  /** How many Students belong to it. A count, never a roster. */
  enrollmentCount?: number;
  createdAt?: string;
}

/** Keys that must never appear in any Batch DTO. Exported for the tests. */
export const FORBIDDEN_BATCH_DTO_KEYS: readonly string[] = [
  'ACL',
  'acl',
  'className',
  // The marker Parse puts on a serialised object. Its presence in a DTO means
  // a raw object escaped instead of a hand-built one.
  '__type',
  'objectId',
  'attributes',
  'createdBy',
  'token',
  'tokenHash',
  'invitation',
  'currentForBatch',
  'students',
  'enrollments',
  'masterKey',
  'sessionToken',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** `YYYY-MM-DD` from a stored date. */
function toDateOnly(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString().slice(0, 10);
}

function toIso(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
}

/**
 * The Admin shape.
 *
 * `createdBy` is stored for audit and deliberately absent here: knowing which
 * Admin account created a Batch is not something the browser needs, and it is
 * one less identifier travelling on every list response.
 */
export function toBatchDto(batch: Parse.Object, enrollmentCount?: number): BatchDto {
  const status = String(batch.get('status')) as BatchStatus;

  const dto: BatchDto = {
    id: batch.id as string,
    name: String(batch.get('name') ?? ''),
    startDate: toDateOnly(batch.get('startDate')) ?? '',
    status,
    readOnly: status === 'archived',
    acceptsEnrollment: acceptsEnrollment(status),
  };

  const description = optionalString(batch.get('description'));
  if (description) dto.description = description;

  const endDate = toDateOnly(batch.get('endDate'));
  if (endDate) dto.endDate = endDate;

  if (typeof enrollmentCount === 'number') dto.enrollmentCount = enrollmentCount;

  const createdAt = toIso(batch.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  return dto;
}

// ═══════════════════════════════════════════════════════════════════════════
// Student
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentBatchDto {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  status: BatchStatus;
  /** When this Student joined. Their own fact, so it is theirs to see. */
  joinedAt?: string;
}

/**
 * What a Student sees of a Batch they belong to.
 *
 * No `createdBy`, no counts, no roster, no invitation state. A Student's
 * relationship to a Batch is their own membership; who else is in it, and how
 * the Admin runs it, is not part of that.
 */
export function toStudentBatchDto(batch: Parse.Object, joinedAt?: Date): StudentBatchDto {
  const dto: StudentBatchDto = {
    id: batch.id as string,
    name: String(batch.get('name') ?? ''),
    startDate: toDateOnly(batch.get('startDate')) ?? '',
    status: String(batch.get('status')) as BatchStatus,
  };

  const description = optionalString(batch.get('description'));
  if (description) dto.description = description;

  const endDate = toDateOnly(batch.get('endDate'));
  if (endDate) dto.endDate = endDate;

  const joined = toDateOnly(joinedAt);
  if (joined) dto.joinedAt = joined;

  return dto;
}

// ═══════════════════════════════════════════════════════════════════════════
// Visitor holding an invitation
// ═══════════════════════════════════════════════════════════════════════════

export interface InvitationPreviewDto {
  /** Whether this link can be redeemed at all, right now. */
  joinable: boolean;
  /**
   * Why not, when it cannot. A stable code the browser translates — the same
   * vocabulary the redemption endpoint uses, so the page and the action agree.
   */
  reason?: string;
  /** Present only when the token itself resolved to a Batch. */
  batch?: {
    name: string;
    description?: string;
    startDate: string;
    endDate?: string;
    status: BatchStatus;
  };
}

/**
 * What somebody holding a link sees before they have proved anything.
 *
 * Deliberately the smallest shape in the file. It carries **no id of any kind**
 * — not the Batch's, not the invitation's — because an unauthenticated caller
 * has no use for one and every identifier handed out is an identifier that can
 * be correlated later. It carries no Student, no count, no Admin, and no
 * creation metadata.
 *
 * A failing preview carries no `batch` at all, so a caller probing tokens
 * cannot harvest Batch names by guessing.
 */
export function toInvitationPreviewDto(
  batch: Parse.Object | undefined,
  joinable: boolean,
  reason?: string
): InvitationPreviewDto {
  const dto: InvitationPreviewDto = {joinable};
  if (reason) dto.reason = reason;
  if (!batch) return dto;

  const description = optionalString(batch.get('description'));
  const endDate = toDateOnly(batch.get('endDate'));

  dto.batch = {
    name: String(batch.get('name') ?? ''),
    startDate: toDateOnly(batch.get('startDate')) ?? '',
    status: String(batch.get('status')) as BatchStatus,
  };
  if (description) dto.batch.description = description;
  if (endDate) dto.batch.endDate = endDate;

  return dto;
}

// ═══════════════════════════════════════════════════════════════════════════
// Invitation status, for the Admin who owns the Batch
// ═══════════════════════════════════════════════════════════════════════════

export interface InvitationStatusDto {
  /** False when the Batch has never had an invitation, or has none current. */
  exists: boolean;
  state?: InvitationState;
  /** A label derived from the hash. Reveals nothing about the token. */
  fingerprint?: string;
  version?: number;
  expiresAt?: string;
  /** True when the current invitation would be accepted right now. */
  usable: boolean;
  /**
   * Whether an Admin may generate or rotate on this Batch at all. False for an
   * archived Batch, which is read-only.
   */
  canManage: boolean;
}

/**
 * The invitation as its Batch's Admin sees it.
 *
 * Carries **no token, no hash, and no objectId** — nothing here can be turned
 * back into a working link. That is the point: after the response that created
 * it, the raw token exists only in the browser that received it, and this shape
 * is what remains once that page is gone.
 */
export function toInvitationStatusDto(
  invitation: Parse.Object | undefined,
  {usable, canManage}: {usable: boolean; canManage: boolean}
): InvitationStatusDto {
  if (!invitation) return {exists: false, usable: false, canManage};

  const dto: InvitationStatusDto = {
    exists: true,
    state: String(invitation.get('state')) as InvitationState,
    usable,
    canManage,
  };

  const fingerprint = optionalString(invitation.get('fingerprint'));
  if (fingerprint) dto.fingerprint = fingerprint;

  const version = invitation.get('version');
  if (typeof version === 'number') dto.version = version;

  const expiresAt = toIso(invitation.get('expiresAt'));
  if (expiresAt) dto.expiresAt = expiresAt;

  return dto;
}
