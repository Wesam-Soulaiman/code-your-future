/**
 * What a Task or Submission operation may write to a log ⟨CP7⟩.
 *
 * A fixed allow-list, and it is short. Everything not named here is dropped
 * before the line is written, so a field added to an operation later cannot
 * reach a log by being passed along.
 *
 * ── Absent on purpose ───────────────────────────────────────────────────────
 * Every URL a Student submitted, the YouTube video id, the Google Drive link,
 * the Student Note, the public project title, description and contribution, the
 * technology list, the attachment's filename, and its storage key.
 *
 * A submitted URL is a link to somebody's unfinished work, often on a personal
 * account; a Drive link is a document that may be shared with anybody holding
 * it; a note is what somebody said privately to staff. None of it is diagnostic,
 * and a byte *count* or a stable code answers every operational question a
 * person actually has.
 *
 * The attachment filename deserves its own line: people name files after
 * themselves, and `cv-lina-haddad.pdf` in a log is personal data.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {redactMessage} from '../../utils/logging/redact';

export type TaskStage =
  | 'authorize'
  | 'validate'
  | 'load'
  | 'persist'
  | 'publish'
  | 'close'
  | 'archive'
  | 'copy'
  | 'attach'
  | 'detach'
  | 'stream'
  | 'submit'
  | 'delete'
  | 'reel';

export interface TaskLogFields {
  op?: string;
  stage?: TaskStage;
  ok?: boolean;
  code?: string;
  /** Who acted. An objectId, never a name. */
  userId?: string;
  batchId?: string;
  taskId?: string;
  submissionId?: string;
  publicationId?: string;
  studentId?: string;
  /** Lifecycle status, which explains most refusals. */
  status?: string;
  /** ASSIGNMENT or FINAL_TASK. A shape, not content. */
  taskType?: string;
  /** Why a Task is closed to submissions. A reason code, never a date. */
  availability?: string;
  /** A count of bytes. Never the bytes. */
  bytes?: number;
  /** An extension is a format, not content. */
  extension?: string;
  /** Counts of things. Never the things. */
  count?: number;
  submitted?: number;
  drafts?: number;
  /** Whether a Reel ended up published. A boolean, not a snapshot. */
  published?: boolean;
  /** A Parse or driver code. A number or short symbol, never prose. */
  parseCode?: string | number;
  /** Why an infrastructure operation failed, server-side only. */
  reason?: string;
}

const ALLOWED_FIELDS: readonly string[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'batchId',
  'taskId',
  'submissionId',
  'publicationId',
  'studentId',
  'status',
  'taskType',
  'availability',
  'bytes',
  'extension',
  'count',
  'submitted',
  'drafts',
  'published',
  'parseCode',
  'reason',
];

/**
 * Reduce an arbitrary object to the allow-listed fields.
 *
 * Exported so a test can assert the filter directly rather than inferring it
 * from log output.
 */
export function toSafeTaskFields(fields: Record<string, unknown>): Record<string, unknown> {
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

function safeFields(fields: TaskLogFields): Record<string, unknown> {
  return toSafeTaskFields(fields as unknown as Record<string, unknown>);
}

export const taskLog = {
  info(message: string, fields: TaskLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: TaskLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: TaskLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

/**
 * Reduce a thrown error to something a log can carry.
 *
 * Same shape and same reasoning as the Resource and Live Slides versions: a
 * failure that logs only a stable code is a failure nobody can diagnose, so the
 * reason is written server-side — scrubbed through `redactMessage` first,
 * because a driver quotes the offending value back and this module's offending
 * values are links and filenames.
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

export {ALLOWED_FIELDS as ALLOWED_TASK_LOG_FIELDS};
