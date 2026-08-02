/**
 * What a Resource operation may write to a log ⟨CP5⟩.
 *
 * A fixed allow-list, and it is short. Everything not named here is dropped
 * before the line is written, so a field added to an operation later cannot
 * reach a log by being passed along.
 *
 * **Absent on purpose:** the storage key, the file's bytes or any prefix of
 * them, the title, the description, the filename, a Student's name or email, and
 * anything resembling a URL. A byte *count* is useful and safe; a byte *sample*
 * is a document in the log, and "just the first 64 characters" is the habit that
 * leaks the first time somebody raises the limit.
 *
 * A filename deserves its own note: people name documents after themselves and
 * after the people they are about. `offer-letter-lina-haddad.pdf` in a log line
 * is personal data, so filenames are not loggable either — the Resource's
 * `objectId` identifies it precisely and reveals nothing.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {redactMessage} from '../../utils/logging/redact';

export type ResourceStage =
  | 'authorize'
  | 'validate'
  | 'store'
  | 'persist'
  | 'load'
  | 'reorder'
  | 'delete'
  | 'stream'
  | 'complete';

export interface ResourceLogFields {
  op?: string;
  stage?: ResourceStage;
  ok?: boolean;
  code?: string;
  /** Who acted. An objectId, never a name. */
  userId?: string;
  batchId?: string;
  resourceId?: string;
  /** The Batch's status, which explains a read-only refusal. */
  status?: string;
  /** An extension is a format, not content. Safe and genuinely diagnostic. */
  extension?: string;
  /** A count of bytes. Never the bytes. */
  bytes?: number;
  count?: number;
  /** A Parse or driver error code — a number or a short symbol, never prose. */
  parseCode?: string | number;
  /**
   * Why an infrastructure operation failed, **server-side only**.
   *
   * A caller never sees this: it gets one of the eight stable codes and nothing
   * else. But a failure that logs only `RESOURCE_UPLOAD_FAILED` is a failure
   * nobody can diagnose, which is how a production incident becomes a guessing
   * game — so the underlying reason is written to the log, and only to the log.
   *
   * It goes through the same redaction boundary as everything else, which masks
   * connection strings, keys, tokens, and any `storageKey` a duplicate-key
   * message would otherwise quote back. See `describeFailure`.
   */
  reason?: string;
}

const ALLOWED_FIELDS: readonly string[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'batchId',
  'resourceId',
  'status',
  'extension',
  'bytes',
  'count',
  'parseCode',
  'reason',
];

/**
 * Reduce a thrown error to something a log can carry.
 *
 * ── Why this scrubs its own text ────────────────────────────────────────────
 * The redaction boundary the logger writes through masks by **key name**. That
 * covers `{storageKey: '…'}` as a field and does nothing at all for the same
 * value sitting inside a *string* — which is exactly the shape a driver error
 * takes: `dup key: { storageKey: "resource_…" }`. A test caught this; without
 * it, the one value this checkpoint works hardest to keep out of logs would have
 * walked straight back in through the diagnostic meant to help.
 *
 * So the message goes through `redactMessage` here, which masks connection
 * strings, keys, tokens, and any sensitive key/value pair embedded in the text.
 * Double redaction downstream is harmless.
 *
 * The raw text is bounded **before** the regex pass, because a driver can throw
 * a page and the scanner should not be handed one.
 */
export function describeFailure(error: unknown): {parseCode?: string | number; reason?: string} {
  if (!error) return {};

  const record = error as {code?: unknown; message?: unknown; name?: unknown};
  const code =
    typeof record.code === 'number' || typeof record.code === 'string' ? record.code : undefined;

  const text =
    typeof record.message === 'string' && record.message.length > 0
      ? record.message
      : typeof record.name === 'string'
        ? record.name
        : String(error);

  return {parseCode: code, reason: redactMessage(text.slice(0, 600)).slice(0, 300)};
}

/**
 * Reduce an arbitrary object to the allow-listed fields.
 *
 * Exported so a test can assert the filter directly rather than inferring it
 * from log output.
 */
export function toSafeResourceFields(fields: Record<string, unknown>): Record<string, unknown> {
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

function safeFields(fields: ResourceLogFields): Record<string, unknown> {
  return toSafeResourceFields(fields as unknown as Record<string, unknown>);
}

export const resourceLog = {
  info(message: string, fields: ResourceLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: ResourceLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: ResourceLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

export {ALLOWED_FIELDS as ALLOWED_RESOURCE_LOG_FIELDS};
