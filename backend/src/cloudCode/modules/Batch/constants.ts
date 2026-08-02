/**
 * Batch constants — the single source of truth for the lifecycle.
 *
 * `frontend/src/app/utils/batch-constants.ts` mirrors this file; a test asserts
 * the two stay in step, for the same reason the profile and catalog constants
 * are mirrored: a browser that offers a transition the server refuses, or
 * refuses one it accepts, is worse than no client-side check at all.
 */

/**
 * The four statuses, exactly as `docs/PRODUCT_REQUIREMENTS.md` §6 fixes them.
 *
 * Stored lower-case; the browser translates them for display. The stored value
 * is a code, not a label — an Arabic page must not store a different string
 * from an English one.
 */
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

/**
 * Statuses a **new** Batch may be created in.
 *
 * A Batch starts in `draft` unless an Admin explicitly picks another. Only
 * `active` is offered alongside it, and that is a deliberate narrowing of
 * "another valid status":
 *
 *   - `completed` is excluded because the transition table forbids
 *     `draft → completed`; allowing it at creation would sidestep a rule the
 *     product states explicitly;
 *   - `archived` is excluded because archived is terminal **and** read-only, so
 *     a Batch created that way would be born immutable and could never be used.
 */
export const BATCH_CREATE_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUS.DRAFT,
  BATCH_STATUS.ACTIVE,
];

/**
 * Which status may follow which, from `docs/PRODUCT_REQUIREMENTS.md` §6.
 *
 * There are no backward transitions and `archived` is terminal, so its entry is
 * deliberately empty rather than absent — an empty list says "nothing follows
 * this", which is the rule, while a missing key would read as an oversight.
 */
export const BATCH_TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  [BATCH_STATUS.DRAFT]: [BATCH_STATUS.ACTIVE, BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.ACTIVE]: [BATCH_STATUS.COMPLETED, BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.COMPLETED]: [BATCH_STATUS.ARCHIVED],
  [BATCH_STATUS.ARCHIVED]: [],
};

/**
 * The only status that accepts new enrollment.
 *
 * `draft` is not ready, `completed` has finished, and `archived` is read-only.
 * Stated once here so no call site has to re-derive it.
 */
export const ENROLLABLE_STATUS: BatchStatus = BATCH_STATUS.ACTIVE;

/** Statuses whose Batch is read-only. Archived is terminal. */
export const READ_ONLY_STATUSES: readonly BatchStatus[] = [BATCH_STATUS.ARCHIVED];

/** Length bounds. Generous for real names, tight enough to bound storage. */
export const BATCH_LIMITS = {
  name: {min: 2, max: 120},
  description: {max: 1000},
  search: {max: 80},
} as const;

/** Pagination. A page size a client asks for is clamped to this. */
export const BATCH_PAGE = {defaultLimit: 10, maxLimit: 100} as const;

/** Narrow an arbitrary value to a Batch status, or `undefined`. */
export function toBatchStatus(value: unknown): BatchStatus | undefined {
  return BATCH_STATUSES.find(status => status === value);
}

/** True when a Batch in this status may no longer be changed at all. */
export function isReadOnlyStatus(status: unknown): boolean {
  return READ_ONLY_STATUSES.includes(status as BatchStatus);
}

/** True when `next` may follow `current`. A no-op transition is not a change. */
export function canTransition(current: BatchStatus, next: BatchStatus): boolean {
  return (BATCH_TRANSITIONS[current] ?? []).includes(next);
}

/** True when a Batch in this status accepts new enrollment. */
export function acceptsEnrollment(status: unknown): boolean {
  return status === ENROLLABLE_STATUS;
}
