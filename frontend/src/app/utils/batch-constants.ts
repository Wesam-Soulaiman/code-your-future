/**
 * Batch constants — the browser's copy.
 *
 * Mirrors `backend/src/cloudCode/modules/Batch/constants.ts`. A backend test
 * asserts the two stay in step: a browser that offers a transition the server
 * refuses, or refuses one it accepts, is worse than no client-side check at all.
 *
 * **The backend is always the authority.** These exist to build the right form
 * and disable the right buttons; every rule is re-checked server-side.
 */

/** The four statuses. Stored lower-case; the browser translates them. */
export const BATCH_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const;

export type BatchStatus = (typeof BATCH_STATUS)[keyof typeof BATCH_STATUS];

export const BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUS.DRAFT,
  BATCH_STATUS.ACTIVE,
  BATCH_STATUS.COMPLETED,
  BATCH_STATUS.ARCHIVED,
];

/** Statuses a new Batch may be created in. */
export const BATCH_CREATE_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUS.DRAFT,
  BATCH_STATUS.ACTIVE,
];

/** Which status may follow which. Archived is terminal, so its list is empty. */
export const BATCH_TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  [BATCH_STATUS.DRAFT]: [BATCH_STATUS.ACTIVE, BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.ACTIVE]: [BATCH_STATUS.COMPLETED, BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.COMPLETED]: [BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.ARCHIVED]: [],
};

/** The only status that accepts new enrollment. */
export const ENROLLABLE_STATUS: BatchStatus = BATCH_STATUS.ACTIVE;

export const READ_ONLY_STATUSES: readonly BatchStatus[] = [BATCH_STATUS.ARCHIVED];

export const BATCH_LIMITS = {
  name: { min: 2, max: 120 },
  description: { max: 1000 },
  search: { max: 80 },
} as const;

export const BATCH_PAGE = { defaultLimit: 10, maxLimit: 100 } as const;

export function toBatchStatus(value: unknown): BatchStatus | undefined {
  return BATCH_STATUSES.find((status) => status === value);
}

export function isReadOnlyStatus(status: unknown): boolean {
  return READ_ONLY_STATUSES.includes(status as BatchStatus);
}

export function canTransition(current: BatchStatus, next: BatchStatus): boolean {
  return (BATCH_TRANSITIONS[current] ?? []).includes(next);
}

export function acceptsEnrollment(status: unknown): boolean {
  return status === ENROLLABLE_STATUS;
}

/** Which colour a status chip carries. Never colour alone — the label is there too. */
export const BATCH_STATUS_TONE: Readonly<Record<BatchStatus, 'info' | 'success' | 'neutral' | 'warning'>> = {
  [BATCH_STATUS.DRAFT]: 'neutral',
  [BATCH_STATUS.ACTIVE]: 'success',
  [BATCH_STATUS.COMPLETED]: 'info',
  [BATCH_STATUS.ARCHIVED]: 'warning',
};

/** Invitation states, mirroring the backend's own list. */
export const INVITATION_STATE = {
  CURRENT: 'current',
  REPLACED: 'replaced',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;

export type InvitationState = (typeof INVITATION_STATE)[keyof typeof INVITATION_STATE];

export const INVITATION_STATES: readonly InvitationState[] = [
  INVITATION_STATE.CURRENT,
  INVITATION_STATE.REPLACED,
  INVITATION_STATE.REVOKED,
  INVITATION_STATE.EXPIRED,
];

/** The route an invitation link points at, under the app's hash routing. */
export const INVITATION_ROUTE = '/join';
