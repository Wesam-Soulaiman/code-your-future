import { ProfileCatalogItem } from './ProfileCatalogItem';
import { BatchStatus, InvitationState } from '../utils/batch-constants';

/**
 * The Batch DTOs — the browser's copies.
 *
 * Mirror `backend/src/cloudCode/modules/Batch/dto.ts` exactly. Fields the
 * backend deliberately withholds — `createdBy`, the invitation token and hash,
 * ACL, raw Parse objects — are absent here too, so no component can depend on
 * data the API does not send.
 */

/** What an Admin sees of a Batch. */
export interface Batch {
  id: string;
  name: string;
  description?: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate?: string;
  status: BatchStatus;
  /** True when the Batch can never change again. Archived is terminal. */
  readOnly: boolean;
  /** True when a Student could join it right now. */
  acceptsEnrollment: boolean;
  /** How many Students belong to it. A count, never a roster. */
  enrollmentCount?: number;
  createdAt?: string;
}

/** What a Student sees of a Batch they belong to. No counts, no roster. */
export interface StudentBatch {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  status: BatchStatus;
  /** When this Student joined. Their own fact. */
  joinedAt?: string;
}

/** What the form sends. Exactly the writable fields, nothing more. */
export interface BatchInput {
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  /** Only on create, and only `draft` or `active`. */
  status?: BatchStatus;
}

/**
 * The invitation as its Batch's Admin sees it.
 *
 * Carries **no token and no hash**: after the response that created it, the raw
 * token exists only in the browser that received it. This is what remains.
 */
export interface InvitationStatus {
  exists: boolean;
  state?: InvitationState;
  /** A label derived from the hash. Reveals nothing about the token. */
  fingerprint?: string;
  version?: number;
  expiresAt?: string;
  /** True when the current link would be accepted right now. */
  usable: boolean;
  /** False for an archived Batch, which cannot have its link changed. */
  canManage: boolean;
}

/**
 * The response to generating or rotating a link.
 *
 * `token` and the URLs built from it exist **only here**, and only until the
 * page is left. Nothing stores them.
 */
export interface IssuedInvitation {
  token: string;
  /** Absolute, when the backend has a configured frontend origin. */
  invitationUrl?: string;
  /** Always present. Resolved against the current origin when the URL is absent. */
  invitationPath: string;
  invitation: InvitationStatus;
}

/** What somebody holding a link sees before signing in. */
export interface InvitationPreview {
  joinable: boolean;
  /** A stable code the page translates. Absent when the link is usable. */
  reason?: string;
  /** Present only when the token resolved to a Batch. */
  batch?: {
    name: string;
    description?: string;
    startDate: string;
    endDate?: string;
    status: BatchStatus;
  };
}

/** The result of redeeming a link. */
export interface JoinResult {
  /** True when the Student already belonged to the Batch. Not a failure. */
  alreadyEnrolled: boolean;
  batch: StudentBatch;
}

/**
 * A Student as an Admin sees them — read-only, and an allow-list.
 *
 * Never carries a password, a session token, `authData`, the Google subject,
 * the Google avatar URL, anything from `StudentAuthIdentity`, the internal
 * username, ACL, or a raw Parse object.
 */
export interface AdminStudentSummary {
  id: string;
  fullName: string;
  /** Verified at Google. Present so an Admin can tell two people apart. */
  verifiedEmail: string;
  city?: ProfileCatalogItem;
  institution?: ProfileCatalogItem;
  major?: ProfileCatalogItem;
  targetRole?: ProfileCatalogItem;
  profileComplete: boolean;
  hasPhoto: boolean;
  /** How many Batches they belong to. Zero is a normal answer. */
  batchCount?: number;
  /** Only on a Batch roster. */
  joinedAt?: string;
}

/** A page of anything the Admin lists. */
export interface Page<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}
