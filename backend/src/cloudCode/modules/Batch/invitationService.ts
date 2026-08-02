/**
 * The invitation lifecycle.
 *
 * Sits between the cloud functions and the repository so the rules about what a
 * token *means* live in one place: generate, rotate, revoke, expire, and — most
 * importantly — resolve.
 *
 * ── Expiry is evaluated, not scheduled ──────────────────────────────────────
 * There is no job that sweeps expired invitations. A token is judged against
 * the clock at the moment it is presented, which is the only moment that
 * matters, and the row is retired lazily when something notices. A cron sweep
 * would add a moving part whose failure mode is an expired link that still
 * works.
 */

import {catchError} from '@90soft/parse-server-kit';

import {acceptsEnrollment, isReadOnlyStatus, BatchStatus} from './constants';
import {BatchError, EnrollmentError, InvitationError, batchError} from './errors';
import {INVITATION_STATE, InvitationState} from './invitationConstants';
import {
  generateInvitationToken,
  hashInvitationToken,
  looksLikeInvitationToken,
} from './invitationToken';
import {batchLog} from './logging';
import {
  countInvitations,
  createInvitation,
  findCurrentInvitation,
  findInvitationByHash,
  isDuplicateKeyError,
  retireInvitation,
} from './repository';

/** What a presented token resolved to. */
export interface ResolvedInvitation {
  /** The invitation row, when the hash matched something. */
  invitation?: Parse.Object;
  /** The Batch it belongs to, when there is one. */
  batch?: Parse.Object;
  /** True only when the token may be redeemed right now. */
  usable: boolean;
  /**
   * Why not, when it cannot. A stable code — never a sentence, and never
   * anything that distinguishes "never existed" from "malformed".
   */
  reason?: string;
}

/** True when an invitation row is past its expiry, judged now. */
export function isExpired(invitation: Parse.Object, now = new Date()): boolean {
  const expiresAt = invitation.get('expiresAt');
  return expiresAt instanceof Date && expiresAt.getTime() <= now.getTime();
}

/**
 * Whether the current invitation would be accepted right now.
 *
 * Deliberately separate from `resolveInvitationToken`: the Admin status card
 * needs this answer without anybody presenting a token.
 */
export function isInvitationUsable(
  invitation: Parse.Object | undefined,
  now = new Date()
): boolean {
  if (!invitation) return false;
  if (invitation.get('state') !== INVITATION_STATE.CURRENT) return false;
  return !isExpired(invitation, now);
}

/**
 * Resolve a token presented by anybody.
 *
 * The order of checks is the order of honesty. A token that is the wrong shape,
 * or that matches nothing, gets `INVITATION_INVALID` — the *same* answer, so
 * somebody probing random strings cannot tell which ones were ever real. Beyond
 * that point the caller demonstrably holds a token we issued, so telling them
 * it was rotated, revoked, or has expired costs nothing and saves them guessing.
 */
export async function resolveInvitationToken(
  rawToken: unknown,
  now = new Date()
): Promise<ResolvedInvitation> {
  if (!looksLikeInvitationToken(rawToken)) {
    return {usable: false, reason: InvitationError.INVITATION_INVALID};
  }

  const tokenHash = hashInvitationToken(rawToken);

  const [error, invitation] = await catchError(findInvitationByHash(tokenHash));
  if (error) throw batchError(BatchError.BATCH_SAVE_FAILED);
  if (!invitation) {
    return {usable: false, reason: InvitationError.INVITATION_INVALID};
  }

  const row = invitation as Parse.Object;
  const batch = row.get('batch') as Parse.Object | undefined;
  const state = String(row.get('state')) as InvitationState;

  if (state === INVITATION_STATE.REVOKED) {
    return {invitation: row, batch, usable: false, reason: InvitationError.INVITATION_REVOKED};
  }
  if (state === INVITATION_STATE.REPLACED) {
    return {invitation: row, batch, usable: false, reason: InvitationError.INVITATION_REPLACED};
  }

  if (isExpired(row, now)) {
    // Retire it lazily. Best effort: the answer below is already correct
    // whether or not this write lands, so a failure here must not change it.
    if (state === INVITATION_STATE.CURRENT) {
      await catchError(retireInvitation(row, INVITATION_STATE.EXPIRED));
    }
    return {invitation: row, batch, usable: false, reason: InvitationError.INVITATION_EXPIRED};
  }

  if (state !== INVITATION_STATE.CURRENT) {
    return {invitation: row, batch, usable: false, reason: InvitationError.INVITATION_INVALID};
  }

  if (!batch) {
    return {invitation: row, usable: false, reason: InvitationError.INVITATION_INVALID};
  }

  // The token is fine; the Batch may still not be taking anybody.
  const status = String(batch.get('status')) as BatchStatus;
  if (!acceptsEnrollment(status)) {
    return {invitation: row, batch, usable: false, reason: EnrollmentError.BATCH_NOT_ACTIVE};
  }

  return {invitation: row, batch, usable: true};
}

/** A freshly issued invitation, and the one copy of its token. */
export interface IssuedInvitation {
  invitation: Parse.Object;
  /** Returned to the caller once. Never stored, never logged. */
  token: string;
}

/**
 * Issue the current invitation for a Batch, replacing any existing one.
 *
 * This is both "generate" and "rotate": the difference is only whether there
 * was one before, and treating them as one operation is what guarantees a
 * rotation can never leave two live tokens or none at all.
 *
 * ── The order matters ───────────────────────────────────────────────────────
 * The old row is retired **first**, which frees the unique index slot, and the
 * new one is created second. If two Admins rotate at the same instant, both may
 * retire, but only one create can win the index — so the outcome is always
 * exactly one current token, never two.
 *
 * The loser is told the write failed rather than handed somebody else's token,
 * because a token it did not mint is not a token it can show anybody.
 */
export async function issueInvitation(
  batch: Parse.Object,
  admin: Parse.User,
  expiresAt: Date | undefined,
  op: string
): Promise<IssuedInvitation> {
  const status = batch.get('status');
  if (isReadOnlyStatus(status)) throw batchError(BatchError.BATCH_READ_ONLY);

  const batchId = batch.id as string;

  const existing = await findCurrentInvitation(batchId);
  if (existing) {
    // Rotation invalidates the previous token immediately — before the new one
    // exists, so there is never an instant where both would be accepted.
    await retireInvitation(existing, INVITATION_STATE.REPLACED);
  }

  const previousCount = await countInvitations(batchId);
  const {token, tokenHash, fingerprint} = generateInvitationToken();

  const [error, created] = await catchError(
    createInvitation(batch, admin, {
      tokenHash,
      fingerprint,
      version: previousCount + 1,
      expiresAt,
    })
  );

  if (error || !created) {
    if (isDuplicateKeyError(error)) {
      // Another request claimed the current slot between our retire and our
      // create. Exactly one token exists, which is the invariant that matters;
      // this caller simply is not the one holding it.
      batchLog.warn('Concurrent invitation issue lost the unique index', {
        op,
        stage: 'invitation',
        ok: false,
        batchId,
        code: BatchError.BATCH_SAVE_FAILED,
      });
    }
    throw batchError(BatchError.BATCH_SAVE_FAILED);
  }

  const invitation = created as Parse.Object;

  batchLog.info('Invitation issued', {
    op,
    stage: 'invitation',
    ok: true,
    userId: admin.id,
    batchId,
    invitationId: invitation.id,
    // The fingerprint comes from the hash, so this line identifies which
    // generation was issued without any part of the token appearing.
    fingerprint,
    version: previousCount + 1,
  });

  return {invitation, token};
}

/** Take the current invitation out of service. */
export async function revokeCurrentInvitation(
  batch: Parse.Object,
  admin: Parse.User,
  op: string
): Promise<Parse.Object | undefined> {
  const current = await findCurrentInvitation(batch.id as string);
  if (!current) return undefined;

  const retired = await retireInvitation(current, INVITATION_STATE.REVOKED);

  batchLog.info('Invitation revoked', {
    op,
    stage: 'invitation',
    ok: true,
    userId: admin.id,
    batchId: batch.id,
    invitationId: retired.id,
    state: INVITATION_STATE.REVOKED,
  });

  return retired;
}

/**
 * Expire the current invitation now.
 *
 * Distinct from revoking on purpose: both stop the link working immediately,
 * but the states read differently in the history and to the person holding the
 * link, and an Admin choosing "expire now" is saying something different from
 * "revoke".
 */
export async function expireCurrentInvitation(
  batch: Parse.Object,
  admin: Parse.User,
  op: string
): Promise<Parse.Object | undefined> {
  const current = await findCurrentInvitation(batch.id as string);
  if (!current) return undefined;

  current.set('expiresAt', new Date());
  const retired = await retireInvitation(current, INVITATION_STATE.EXPIRED);

  batchLog.info('Invitation expired', {
    op,
    stage: 'invitation',
    ok: true,
    userId: admin.id,
    batchId: batch.id,
    invitationId: retired.id,
    state: INVITATION_STATE.EXPIRED,
  });

  return retired;
}
