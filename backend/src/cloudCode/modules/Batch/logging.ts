/**
 * Logging boundary for Batches, invitations, and enrollment.
 *
 * Accepts a **fixed shape** rather than redacting an arbitrary one, exactly as
 * the profile and catalog surfaces do. The reason is the same and it matters
 * more here: a future edit must not be able to start logging a token, a link, a
 * Student's email, or a filter somebody typed, merely by adding a field to a
 * call.
 *
 * Only these fields are ever emitted:
 *
 *   op            the operation name
 *   stage         a coarse progress marker
 *   ok            success or failure
 *   code          a stable error code from `errors.ts`
 *   userId        a Parse objectId
 *   batchId       a Parse objectId
 *   invitationId  a Parse objectId
 *   enrollmentId  a Parse objectId
 *   status        a Batch status — a closed, four-value vocabulary
 *   state         an invitation state — likewise closed
 *   fingerprint   a label derived from the token **hash**, never the token
 *   version       which invitation generation
 *   count         how many rows were read or written
 *   fieldCount    how many fields failed validation — a number, never names
 *
 * Absent on purpose: the raw token, the invitation URL, the token hash, any
 * search term, and any filter value. A search term is something a person typed
 * and can contain a Student's name; "which Students did the Admin look for" is
 * not information an operator needs.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {BatchSurfaceErrorCode} from './errors';
import {BatchStatus} from './constants';
import {InvitationState} from './invitationConstants';

export type BatchStage =
  | 'authorize'
  | 'validate'
  | 'load'
  | 'save'
  | 'invitation'
  | 'redeem'
  | 'enroll'
  | 'complete';

export interface BatchLogFields {
  op: string;
  stage?: BatchStage;
  ok?: boolean;
  code?: BatchSurfaceErrorCode | string;
  userId?: string;
  batchId?: string;
  invitationId?: string;
  enrollmentId?: string;
  status?: BatchStatus | string;
  state?: InvitationState | string;
  fingerprint?: string;
  version?: number;
  count?: number;
  fieldCount?: number;
}

/** The only field names this module will emit. */
const ALLOWED_FIELDS: readonly (keyof BatchLogFields)[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'batchId',
  'invitationId',
  'enrollmentId',
  'status',
  'state',
  'fingerprint',
  'version',
  'count',
  'fieldCount',
];

/**
 * Reduce an arbitrary object to the allow-listed fields. Exported so a test can
 * assert the filter directly rather than inferring it from log output.
 */
export function toSafeBatchFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    }
  }
  return safe;
}

function safeFields(fields: BatchLogFields): Record<string, unknown> {
  return toSafeBatchFields(fields as unknown as Record<string, unknown>);
}

export const batchLog = {
  info(message: string, fields: BatchLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: BatchLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: BatchLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

export {ALLOWED_FIELDS as ALLOWED_BATCH_LOG_FIELDS};
