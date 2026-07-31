/**
 * Logging boundary for Student Google authentication.
 *
 * The repository already redacts recursively on the way to every log sink
 * (`utils/logging/redact.ts` + the Parse `loggerAdapter`), and its key rules
 * already cover `credential`, `id_token`, `authData`, `email`, `password`, and
 * `sessionToken`. That layer is a safety net, not a licence.
 *
 * This module is the *call-site* half: authentication code never hands a bag of
 * arbitrary fields to the logger. It passes a fixed shape, and only these
 * fields are ever emitted:
 *
 *   op       the operation name                     e.g. 'loginWithGoogle'
 *   provider the identity provider name             e.g. 'google'
 *   stage    a coarse, non-revealing progress marker
 *   ok       success or failure
 *   code     one of the stable StudentAuthError codes
 *   userId   a Parse objectId, when one exists
 *   created  whether provisioning created a record
 *
 * Anything else passed by a caller is dropped, so a future edit cannot start
 * logging a credential, a Google subject, an email address, a display name, a
 * raw `_User`, or a raw `StudentAuthIdentity` by adding one field to a call.
 *
 * Note in particular that the Google **subject** is not in the allow-list. It is
 * a stable identifier for a real person; the repository-wide key rules do not
 * cover the name `providerSubject`, so it is excluded here instead — and this
 * file is the only place authentication logs are produced.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {StudentAuthErrorCode} from './errors';

/** Coarse progress markers. None of them reveals anything about an account. */
export type AuthStage =
  | 'config'
  | 'verify'
  | 'lookup'
  | 'provision'
  | 'role'
  | 'identity'
  | 'session'
  | 'restore'
  | 'complete';

export interface AuthLogFields {
  op: string;
  provider?: string;
  stage?: AuthStage;
  ok?: boolean;
  code?: StudentAuthErrorCode | string;
  userId?: string;
  created?: boolean;
}

/** The only field names this module will emit. */
const ALLOWED_FIELDS: readonly (keyof AuthLogFields)[] = [
  'op',
  'provider',
  'stage',
  'ok',
  'code',
  'userId',
  'created',
];

/**
 * Reduce an arbitrary object to the allow-listed fields. Exported so a test can
 * assert the filter directly rather than inferring it from log output.
 */
export function toSafeAuthFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined) continue;
    // Only primitives are ever emitted; an object under an allowed name would
    // be a mistake, so it is dropped rather than walked.
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

function safeFields(fields: AuthLogFields): Record<string, unknown> {
  return toSafeAuthFields(fields as unknown as Record<string, unknown>);
}

export const authLog = {
  info(message: string, fields: AuthLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: AuthLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: AuthLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

export {ALLOWED_FIELDS as ALLOWED_AUTH_LOG_FIELDS};
