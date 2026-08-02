/**
 * Batch validation — pure functions, no Parse, no I/O.
 *
 * Everything here is deterministic and directly testable. The cloud function
 * calls one of these once and either saves the normalised result or returns the
 * field map; nothing downstream re-checks or re-interprets.
 *
 * The same two rules the rest of the codebase follows:
 *
 *   1. **Normalise, then validate**, so `"  Summer  2026 "` and `"Summer 2026"`
 *      are the same Batch and a name of spaces is empty rather than "present";
 *   2. **Never echo a value.** A rejection carries a field name and a reason
 *      code, so nothing anybody typed reaches a response or a log.
 */

import {
  BATCH_CREATE_STATUSES,
  BATCH_LIMITS,
  BATCH_PAGE,
  BATCH_STATUS,
  BatchStatus,
  toBatchStatus,
} from './constants';
import {FieldErrors, FieldReason} from './errors';

/** The normalised, storable shape produced by a successful validation. */
export interface NormalisedBatch {
  name: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  status: BatchStatus;
}

export interface BatchValidationResult {
  values: NormalisedBatch;
  errors: FieldErrors;
}

/** Collapse internal whitespace and trim. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Trim only — internal spacing in a description is the author's formatting. */
function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parse a `YYYY-MM-DD` day into UTC midnight.
 *
 * `Date.UTC` rather than `new Date('2026-06-01')`, so the stored instant never
 * depends on the server's timezone: in a UTC+3 deployment the latter would
 * store the previous day for anyone near a boundary. The same rule the
 * graduation month follows.
 */
export function parseBatchDate(raw: unknown): {value?: Date; reason?: keyof typeof FieldReason} {
  const value = trimText(raw);
  if (value.length === 0) return {};

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return {reason: 'INVALID'};

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Round-tripping catches impossible dates such as 2026-02-30.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return {reason: 'INVALID'};
  }

  return {value: parsed};
}

/**
 * Validate and normalise a Batch.
 *
 * `existingStatus` is supplied when editing: the status is changed through its
 * own operation, so an edit keeps whatever the Batch already has and a `status`
 * in the payload is simply not read.
 */
export function validateBatchInput(
  input: Record<string, unknown>,
  existingStatus?: BatchStatus
): BatchValidationResult {
  const errors: FieldErrors = {};

  // ── Name ─────────────────────────────────────────────────────────────────
  const name = normaliseText(input['name']);
  if (name.length === 0) {
    errors['name'] = FieldReason.REQUIRED;
  } else if (name.length < BATCH_LIMITS.name.min) {
    errors['name'] = FieldReason.TOO_SHORT;
  } else if (name.length > BATCH_LIMITS.name.max) {
    errors['name'] = FieldReason.TOO_LONG;
  }

  // ── Description ──────────────────────────────────────────────────────────
  const description = trimText(input['description']);
  if (description.length > BATCH_LIMITS.description.max) {
    errors['description'] = FieldReason.TOO_LONG;
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  const start = parseBatchDate(input['startDate']);
  if (start.reason) errors['startDate'] = FieldReason[start.reason];
  else if (!start.value) errors['startDate'] = FieldReason.REQUIRED;

  const end = parseBatchDate(input['endDate']);
  if (end.reason) errors['endDate'] = FieldReason[end.reason];

  // A Batch that ends before it starts is a typo, not a schedule. Reported on
  // `endDate`, because that is the field the Admin most likely mistyped and the
  // one they can fix without touching anything else.
  if (start.value && end.value && end.value.getTime() < start.value.getTime()) {
    errors['endDate'] = FieldReason.OUT_OF_RANGE;
  }

  // ── Status ───────────────────────────────────────────────────────────────
  let status: BatchStatus = existingStatus ?? BATCH_STATUS.DRAFT;

  if (!existingStatus) {
    const requested = input['status'];
    if (requested !== undefined && requested !== null && requested !== '') {
      const parsed = toBatchStatus(requested);
      if (!parsed || !BATCH_CREATE_STATUSES.includes(parsed)) {
        // `completed` and `archived` are refused at creation; see the note on
        // BATCH_CREATE_STATUSES.
        errors['status'] = FieldReason.NOT_ALLOWED;
      } else {
        status = parsed;
      }
    }
  }

  const values: NormalisedBatch = {
    name,
    startDate: start.value ?? new Date(0),
    status,
  };
  if (description) values.description = description;
  if (end.value) values.endDate = end.value;

  return {values, errors};
}

/**
 * Refuse a request that tries to set a server-controlled column.
 *
 * Ignoring these silently would be safe but dishonest — a caller sending
 * `createdBy` deserves to learn it was refused rather than believe it took.
 */
export function findPrivilegedBatchFields(input: Record<string, unknown>): string[] {
  const forbidden = [
    'createdBy',
    'objectId',
    'ACL',
    'acl',
    'createdAt',
    'updatedAt',
    'className',
    // Enrollment and invitation state are never set by writing a Batch.
    'enrollmentCount',
    'invitation',
    'token',
    'tokenHash',
    // Nothing about authorisation is ever set by writing a Batch. These are
    // not Batch columns at all, which is exactly why an input carrying one
    // deserves to be refused rather than silently dropped.
    'roles',
    'role',
    'sessionToken',
    'password',
  ];
  return forbidden.filter(key => Object.prototype.hasOwnProperty.call(input, key));
}

/**
 * Trim and bound a search term.
 *
 * Only a string is a search. Coercing a number or an object would turn a
 * malformed request into a search for `[object Object]` — a query that runs,
 * returns nothing, and looks like an empty product rather than a bad request.
 */
export function normaliseBatchSearch(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, BATCH_LIMITS.search.max);
}

/**
 * Clamp a page window a client asked for.
 *
 * A caller can always ask for something unreasonable; the answer is to bound it
 * rather than to refuse, so a mistaken `limit=100000` returns a page instead of
 * an error the UI has to handle.
 */
export function normalisePaging(input: Record<string, unknown>): {skip: number; limit: number} {
  const rawSkip = Number(input['skip']);
  const rawLimit = Number(input['limit']);

  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? Math.floor(rawSkip) : 0;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), BATCH_PAGE.maxLimit)
      : BATCH_PAGE.defaultLimit;

  return {skip, limit};
}

/** Parse an optional expiry instant for an invitation. */
export function parseExpiry(raw: unknown): {value?: Date; reason?: keyof typeof FieldReason} {
  if (raw === undefined || raw === null || raw === '') return {};

  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) return {reason: 'INVALID'};

  // An expiry already in the past would create an invitation that is dead on
  // arrival — almost certainly a mistake, and confusing to debug.
  if (parsed.getTime() <= Date.now()) return {reason: 'OUT_OF_RANGE'};

  return {value: parsed};
}
