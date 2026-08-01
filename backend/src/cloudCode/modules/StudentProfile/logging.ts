/**
 * Logging boundary for the Student profile.
 *
 * A profile is almost entirely private data — name, email, phone, city, date of
 * birth, education, links, and a photograph. None of it belongs in a log line at
 * any level, so this module does not redact profile fields: it never accepts
 * them in the first place.
 *
 * Only these fields are ever emitted:
 *
 *   op         the operation name              e.g. 'saveMyStudentProfile'
 *   stage      a coarse progress marker
 *   ok         success or failure
 *   code       a stable ProfileError code
 *   userId     a Parse objectId
 *   profileId  a Parse objectId
 *   created    whether this call created the profile
 *   complete   the calculated completion state (a boolean, not a value)
 *   fieldCount how many fields failed validation — a number, never the names
 *   bytes      a photo's byte length — a number, never its contents
 *
 * `fieldCount` is deliberately a count rather than a list: field *names* would
 * describe the shape of somebody's answers ("the date-of-birth one failed"),
 * which is more than an operator needs to know.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {ProfileErrorCode} from './errors';

export type ProfileStage =
  | 'authorize'
  | 'load'
  | 'validate'
  | 'save'
  | 'photo'
  | 'complete';

export interface ProfileLogFields {
  op: string;
  stage?: ProfileStage;
  ok?: boolean;
  code?: ProfileErrorCode | string;
  userId?: string;
  profileId?: string;
  created?: boolean;
  complete?: boolean;
  fieldCount?: number;
  bytes?: number;
}

/** The only field names this module will emit. */
const ALLOWED_FIELDS: readonly (keyof ProfileLogFields)[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'profileId',
  'created',
  'complete',
  'fieldCount',
  'bytes',
];

/**
 * Reduce an arbitrary object to the allow-listed fields. Exported so a test can
 * assert the filter directly rather than inferring it from log output.
 */
export function toSafeProfileFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function safeFields(fields: ProfileLogFields): Record<string, unknown> {
  return toSafeProfileFields(fields as unknown as Record<string, unknown>);
}

export const profileLog = {
  info(message: string, fields: ProfileLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: ProfileLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: ProfileLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

export {ALLOWED_FIELDS as ALLOWED_PROFILE_LOG_FIELDS};
