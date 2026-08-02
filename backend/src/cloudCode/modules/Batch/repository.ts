/**
 * Persistence for Batches, invitations, and enrollments.
 *
 * The only place that reads or writes the three classes. Every operation uses
 * the master key, because all three deny client access by design; authorisation
 * happens above, in the cloud functions, before anything here is called.
 *
 * ── Two invariants live in the database, not in this file ───────────────────
 * "One current invitation per Batch" and "one enrollment per Student per Batch"
 * are enforced by **unique indexes**. The code below is written to cooperate
 * with that rather than to duplicate it: where a race is possible, the loser is
 * detected by a duplicate-key error and handled, instead of being prevented by
 * a check both racers would pass.
 */

import {catchError} from '@90soft/parse-server-kit';

import {BATCH_PAGE, BATCH_STATUS, BatchStatus} from './constants';
import {BatchError, batchError} from './errors';
import {INVITATION_STATE, InvitationState} from './invitationConstants';
import {NormalisedBatch} from './validation';

const BATCH_CLASS = 'Batch';
const INVITATION_CLASS = 'BatchInvitation';
const ENROLLMENT_CLASS = 'BatchEnrollment';

/** Parse's duplicate-value code, plus MongoDB's raw duplicate-key code. */
const PARSE_DUPLICATE_VALUE = 137;
const MONGO_DUPLICATE_KEY = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code;
  if (code === PARSE_DUPLICATE_VALUE || code === MONGO_DUPLICATE_KEY) return true;
  const message = String((error as {message?: unknown} | null)?.message ?? '');
  return message.includes('E11000') || message.includes('duplicate key');
}

/** A pointer without a round trip, for filtering. */
function pointerTo(className: string, id: string): Parse.Object {
  const Klass = Parse.Object.extend(className);
  const object = new Klass() as Parse.Object;
  object.id = id;
  return object;
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchQuery {
  search: string;
  status?: BatchStatus;
  skip: number;
  limit: number;
}

export interface BatchPage {
  batches: Parse.Object[];
  total: number;
}

/**
 * A page of Batches for an Admin.
 *
 * The search is a case-insensitive contains on the name only. It is passed to
 * `matches` with an escaped pattern, never as raw user input: a search term is
 * something a person typed, and letting it reach a regular expression
 * un-escaped turns a search box into a way to spend the database's CPU.
 */
export async function findBatches(query: BatchQuery): Promise<BatchPage> {
  const build = (): Parse.Query => {
    const parseQuery = new Parse.Query(BATCH_CLASS);
    if (query.status) parseQuery.equalTo('status', query.status);
    if (query.search.length > 0) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      parseQuery.matches('name', new RegExp(escaped), 'i');
    }
    return parseQuery;
  };

  const listQuery = build();
  listQuery.descending('startDate');
  listQuery.skip(query.skip);
  listQuery.limit(Math.min(query.limit, BATCH_PAGE.maxLimit));

  const [error, results] = await catchError(
    Promise.all([listQuery.find({useMasterKey: true}), build().count({useMasterKey: true})])
  );
  if (error || !results) throw batchError(BatchError.BATCH_SAVE_FAILED);

  const [batches, total] = results as [Parse.Object[], number];
  return {batches, total};
}

/** One Batch by id, or `undefined`. */
export async function findBatchById(id: unknown): Promise<Parse.Object | undefined> {
  if (typeof id !== 'string' || id.trim().length === 0) return undefined;

  const query = new Parse.Query(BATCH_CLASS);
  query.equalTo('objectId', id.trim());

  const [error, batch] = await catchError(query.first({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (batch as Parse.Object | undefined) ?? undefined;
}

function applyBatchValues(batch: Parse.Object, values: NormalisedBatch): void {
  batch.set('name', values.name);
  batch.set('startDate', values.startDate);
  batch.set('status', values.status);

  if (values.description) batch.set('description', values.description);
  else batch.unset('description');

  if (values.endDate) batch.set('endDate', values.endDate);
  else batch.unset('endDate');
}

export async function createBatch(
  values: NormalisedBatch,
  admin: Parse.User
): Promise<Parse.Object> {
  const BatchClass = Parse.Object.extend(BATCH_CLASS);
  const batch = new BatchClass() as Parse.Object;

  applyBatchValues(batch, values);
  batch.set('createdBy', admin);

  // Deny-by-default: no public access and no per-record grant to anybody.
  // Every read goes through an authorised operation using the master key.
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  batch.setACL(acl);

  const [error, saved] = await catchError(batch.save(null, {useMasterKey: true}));
  if (error || !saved) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return saved as Parse.Object;
}

/** Update metadata. The status is changed through its own operation. */
export async function updateBatch(
  batch: Parse.Object,
  values: NormalisedBatch
): Promise<Parse.Object> {
  applyBatchValues(batch, values);

  const [error, saved] = await catchError(batch.save(null, {useMasterKey: true}));
  if (error || !saved) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return saved as Parse.Object;
}

export async function setBatchStatus(
  batch: Parse.Object,
  status: BatchStatus
): Promise<Parse.Object> {
  batch.set('status', status);

  const [error, saved] = await catchError(batch.save(null, {useMasterKey: true}));
  if (error || !saved) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return saved as Parse.Object;
}

// ═══════════════════════════════════════════════════════════════════════════
// Invitations
// ═══════════════════════════════════════════════════════════════════════════

/** The current invitation for a Batch, if it has one. */
export async function findCurrentInvitation(
  batchId: string
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(INVITATION_CLASS);
  query.equalTo('currentForBatch', pointerTo(BATCH_CLASS, batchId));

  const [error, invitation] = await catchError(query.first({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (invitation as Parse.Object | undefined) ?? undefined;
}

/**
 * The invitation a token belongs to — found by hash, never by the token.
 *
 * Superseded rows are found too, on purpose: a caller presenting a rotated or
 * revoked link deserves to be told which of those it was, rather than a generic
 * failure that leaves them wondering whether they mistyped it.
 */
export async function findInvitationByHash(
  tokenHash: string
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(INVITATION_CLASS);
  query.equalTo('tokenHash', tokenHash);
  query.include('batch');

  const [error, invitation] = await catchError(query.first({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (invitation as Parse.Object | undefined) ?? undefined;
}

/** How many invitations a Batch has had, so the next one can number itself. */
export async function countInvitations(batchId: string): Promise<number> {
  const query = new Parse.Query(INVITATION_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));

  const [error, total] = await catchError(query.count({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (total as number) ?? 0;
}

/**
 * Retire the current invitation.
 *
 * Unsetting `currentForBatch` is what actually takes it out of service: it
 * leaves the unique index, so a new invitation can claim the slot, and every
 * lookup for "the current one" stops finding it. The `state` and timestamp are
 * for the audit trail.
 */
export async function retireInvitation(
  invitation: Parse.Object,
  state: Extract<InvitationState, 'replaced' | 'revoked' | 'expired'>
): Promise<Parse.Object> {
  invitation.set('state', state);
  invitation.unset('currentForBatch');

  if (state === INVITATION_STATE.REPLACED) invitation.set('replacedAt', new Date());
  if (state === INVITATION_STATE.REVOKED) invitation.set('revokedAt', new Date());

  const [error, saved] = await catchError(invitation.save(null, {useMasterKey: true}));
  if (error || !saved) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return saved as Parse.Object;
}

export interface NewInvitation {
  tokenHash: string;
  fingerprint: string;
  version: number;
  expiresAt?: Date;
}

/**
 * Create the current invitation for a Batch.
 *
 * Throws a duplicate-key error when another request has already claimed the
 * current slot. The caller decides what that means; this function does not
 * pretend it did not happen.
 */
export async function createInvitation(
  batch: Parse.Object,
  admin: Parse.User,
  values: NewInvitation
): Promise<Parse.Object> {
  const InvitationClass = Parse.Object.extend(INVITATION_CLASS);
  const invitation = new InvitationClass() as Parse.Object;

  invitation.set('batch', batch);
  // Both pointers, deliberately: `batch` is the permanent relationship and
  // `currentForBatch` is the claim on the unique index.
  invitation.set('currentForBatch', batch);
  invitation.set('tokenHash', values.tokenHash);
  invitation.set('fingerprint', values.fingerprint);
  invitation.set('state', INVITATION_STATE.CURRENT);
  invitation.set('version', values.version);
  if (values.expiresAt) invitation.set('expiresAt', values.expiresAt);
  invitation.set('createdBy', admin);

  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  invitation.setACL(acl);

  return (await invitation.save(null, {useMasterKey: true})) as Parse.Object;
}

/** Set or clear the expiry on the current invitation. */
export async function setInvitationExpiry(
  invitation: Parse.Object,
  expiresAt: Date | undefined
): Promise<Parse.Object> {
  if (expiresAt) invitation.set('expiresAt', expiresAt);
  else invitation.unset('expiresAt');

  const [error, saved] = await catchError(invitation.save(null, {useMasterKey: true}));
  if (error || !saved) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return saved as Parse.Object;
}

// ═══════════════════════════════════════════════════════════════════════════
// Enrollment
// ═══════════════════════════════════════════════════════════════════════════

/** This Student's membership of this Batch, if it exists. */
export async function findEnrollment(
  batchId: string,
  student: Parse.User
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.equalTo('student', student);

  const [error, enrollment] = await catchError(query.first({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (enrollment as Parse.Object | undefined) ?? undefined;
}

/**
 * Create a membership.
 *
 * Throws a duplicate-key error when this Student already belongs to this Batch.
 * The caller treats that as "already enrolled" rather than a failure, which is
 * what makes redemption idempotent under a double-tap or two racing devices.
 */
export async function createEnrollment(
  batch: Parse.Object,
  student: Parse.User,
  invitation: Parse.Object | undefined
): Promise<Parse.Object> {
  const EnrollmentClass = Parse.Object.extend(ENROLLMENT_CLASS);
  const enrollment = new EnrollmentClass() as Parse.Object;

  enrollment.set('batch', batch);
  enrollment.set('student', student);
  enrollment.set('joinedAt', new Date());
  if (invitation) enrollment.set('invitation', invitation);

  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  enrollment.setACL(acl);

  return (await enrollment.save(null, {useMasterKey: true})) as Parse.Object;
}

/** Every Batch this Student belongs to, newest membership first. */
export async function findEnrollmentsForStudent(student: Parse.User): Promise<Parse.Object[]> {
  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.equalTo('student', student);
  query.include('batch');
  query.descending('joinedAt');
  query.limit(BATCH_PAGE.maxLimit);

  const [error, enrollments] = await catchError(query.find({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (enrollments ?? []) as Parse.Object[];
}

/** How many Students belong to a Batch. A count, never a roster. */
export async function countEnrollments(batchId: string): Promise<number> {
  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));

  const [error, total] = await catchError(query.count({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  return (total as number) ?? 0;
}

/** Counts for several Batches at once, so a list costs one query, not N. */
export async function countEnrollmentsForBatches(
  batchIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (batchIds.length === 0) return counts;

  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.containedIn(
    'batch',
    batchIds.map(id => pointerTo(BATCH_CLASS, id))
  );
  query.select('batch');
  query.limit(BATCH_PAGE.maxLimit * 50);

  const [error, enrollments] = await catchError(query.find({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);

  for (const enrollment of (enrollments ?? []) as Parse.Object[]) {
    const id = (enrollment.get('batch') as Parse.Object | undefined)?.id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface EnrollmentPage {
  enrollments: Parse.Object[];
  total: number;
}

/** A page of a Batch's roster, for an Admin. Includes the Student pointer. */
export async function findEnrollmentsForBatch(
  batchId: string,
  {skip, limit}: {skip: number; limit: number}
): Promise<EnrollmentPage> {
  const build = (): Parse.Query => {
    const query = new Parse.Query(ENROLLMENT_CLASS);
    query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
    return query;
  };

  const listQuery = build();
  listQuery.include('student');
  listQuery.descending('joinedAt');
  listQuery.skip(skip);
  listQuery.limit(Math.min(limit, BATCH_PAGE.maxLimit));

  const [error, results] = await catchError(
    Promise.all([listQuery.find({useMasterKey: true}), build().count({useMasterKey: true})])
  );
  if (error || !results) throw batchError(BatchError.BATCH_SAVE_FAILED);

  const [enrollments, total] = results as [Parse.Object[], number];
  return {enrollments, total};
}

/** Which of these Students belong to which Batches. Used by the directory. */
export async function findEnrollmentsForStudents(
  studentIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byStudent = new Map<string, string[]>();
  if (studentIds.length === 0) return byStudent;

  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.containedIn(
    'student',
    studentIds.map(id => pointerTo('_User', id))
  );
  query.select('student', 'batch');
  query.limit(BATCH_PAGE.maxLimit * 50);

  const [error, enrollments] = await catchError(query.find({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);

  for (const enrollment of (enrollments ?? []) as Parse.Object[]) {
    const studentId = (enrollment.get('student') as Parse.Object | undefined)?.id;
    const batchId = (enrollment.get('batch') as Parse.Object | undefined)?.id;
    if (!studentId || !batchId) continue;
    const existing = byStudent.get(studentId) ?? [];
    existing.push(batchId);
    byStudent.set(studentId, existing);
  }
  return byStudent;
}

/** Student ids enrolled in one Batch. Used to filter the directory. */
export async function findStudentIdsInBatch(batchId: string): Promise<string[]> {
  const query = new Parse.Query(ENROLLMENT_CLASS);
  query.equalTo('batch', pointerTo(BATCH_CLASS, batchId));
  query.select('student');
  query.limit(BATCH_PAGE.maxLimit * 50);

  const [error, enrollments] = await catchError(query.find({useMasterKey: true}));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);

  const ids: string[] = [];
  for (const enrollment of (enrollments ?? []) as Parse.Object[]) {
    const id = (enrollment.get('student') as Parse.Object | undefined)?.id;
    if (id) ids.push(id);
  }
  return ids;
}

export {BATCH_STATUS, pointerTo};
