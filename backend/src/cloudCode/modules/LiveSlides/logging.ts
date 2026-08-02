/**
 * What a Live Slides operation may write to a log ⟨CP6⟩.
 *
 * A fixed allow-list, and it is short. Everything not named here is dropped
 * before the line is written, so a field added to an operation later cannot
 * reach a log by being passed along.
 *
 * ── Absent on purpose ───────────────────────────────────────────────────────
 * The question text, the optional description, an Information slide's content,
 * every option label, a Student's answer in any form, the option ids they chose,
 * their name, and their email.
 *
 * A question is somebody's teaching material and an answer is somebody's words
 * about themselves — often about their background, their goals, and why they
 * want this. "Just the first sixty characters" is the habit that leaks the first
 * time somebody raises the limit, so no prefix of any of it is loggable at all.
 *
 * `answerType` **is** allowed, because knowing a poll was submitted tells an
 * operator what happened and tells them nothing about who voted for what.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {redactMessage} from '../../utils/logging/redact';

export type LiveStage =
  | 'authorize'
  | 'validate'
  | 'load'
  | 'persist'
  | 'reorder'
  | 'start'
  | 'navigate'
  | 'lock'
  | 'complete'
  | 'submit'
  | 'delete';

export interface LiveLogFields {
  op?: string;
  stage?: LiveStage;
  ok?: boolean;
  code?: string;
  /** Who acted. An objectId, never a name. */
  userId?: string;
  batchId?: string;
  sessionId?: string;
  slideId?: string;
  responseId?: string;
  /** The session's lifecycle status, which explains most refusals. */
  status?: string;
  /** A format, not an answer. Safe and genuinely diagnostic. */
  answerType?: string;
  /** A slide's type. Also a format. */
  slideType?: string;
  /** Counts of things. Never the things. */
  count?: number;
  submitted?: number;
  unanswered?: number;
  /** A Parse or driver code. A number or short symbol, never prose. */
  parseCode?: string | number;
  /** Why an infrastructure operation failed, server-side only. See `describeFailure`. */
  reason?: string;
}

const ALLOWED_FIELDS: readonly string[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'batchId',
  'sessionId',
  'slideId',
  'responseId',
  'status',
  'answerType',
  'slideType',
  'count',
  'submitted',
  'unanswered',
  'parseCode',
  'reason',
];

/**
 * Reduce an arbitrary object to the allow-listed fields.
 *
 * Exported so a test can assert the filter directly rather than inferring it
 * from log output.
 */
export function toSafeLiveFields(fields: Record<string, unknown>): Record<string, unknown> {
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

function safeFields(fields: LiveLogFields): Record<string, unknown> {
  return toSafeLiveFields(fields as unknown as Record<string, unknown>);
}

export const liveLog = {
  info(message: string, fields: LiveLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: LiveLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: LiveLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

/**
 * Reduce a thrown error to something a log can carry.
 *
 * The same shape, and the same reasoning, as the Resource module's version: a
 * failure that logs only a stable code is a failure nobody can diagnose, so the
 * reason is written server-side — scrubbed through `redactMessage` first,
 * because a driver quotes the offending value back and this module's offending
 * values are questions and answers.
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

export {ALLOWED_FIELDS as ALLOWED_LIVE_LOG_FIELDS};
