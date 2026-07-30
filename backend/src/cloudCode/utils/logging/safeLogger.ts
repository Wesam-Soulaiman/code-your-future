/**
 * The single logging boundary for this backend.
 *
 * Everything written here passes through `redact()` first, so no call site can
 * leak a password, session token, master key, OAuth payload, database URI, or a
 * raw Parse object — even by accident, and even when the value is nested inside
 * an error.
 *
 * `parseLoggerAdapter` plugs the same redaction into Parse Server itself via the
 * supported `loggerAdapter` option, so Parse's own cloud-function and request
 * logs are covered too. node_modules is never patched.
 */

import {redactMessage, redactMeta} from './redact';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {error: 0, warn: 1, info: 2, debug: 3};

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return (['error', 'warn', 'info', 'debug'] as const).find(level => level === raw) ?? 'info';
}

function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[configuredLevel()];
}

/**
 * Fields a safe log line may carry. Anything outside this shape still gets
 * redacted, but keeping call sites on this type makes the intent explicit.
 */
export interface SafeLogFields {
  /** Logical operation, e.g. `loginUser` or `seedRoles`. */
  op?: string;
  /** Route or cloud-function name. */
  route?: string;
  /** Authenticated user objectId — an opaque id, never an email. */
  userId?: string;
  /** Stable, non-secret outcome code. */
  code?: string | number;
  /** Coarse stage marker for multi-step operations. */
  stage?: string;
  /** Whether the operation succeeded. */
  ok?: boolean;
  /** Counts, durations, and other non-identifying numbers. */
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields?: SafeLogFields): void {
  if (!enabled(level)) return;

  const safeMessage = redactMessage(message);
  const payload = fields === undefined ? undefined : redactMeta(fields);

  const line =
    payload === undefined
      ? `[${level}] ${safeMessage}`
      : `[${level}] ${safeMessage} ${JSON.stringify(payload)}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const safeLog = {
  error: (message: string, fields?: SafeLogFields) => emit('error', message, fields),
  warn: (message: string, fields?: SafeLogFields) => emit('warn', message, fields),
  info: (message: string, fields?: SafeLogFields) => emit('info', message, fields),
  debug: (message: string, fields?: SafeLogFields) => emit('debug', message, fields),
};

/**
 * Build the redacted line Parse Server would otherwise write verbatim. Exported
 * so tests can assert redaction without capturing console output.
 */
export function buildParseLogLine(
  level: string,
  message: unknown,
  meta?: unknown
): string {
  const normalisedLevel = String(level || 'info');
  const safeMessage =
    typeof message === 'string'
      ? redactMessage(message)
      : JSON.stringify(redactMeta(message));
  const safeMeta = meta === undefined ? undefined : redactMeta(meta);
  return safeMeta === undefined
    ? `[parse:${normalisedLevel}] ${safeMessage}`
    : `[parse:${normalisedLevel}] ${safeMessage} ${JSON.stringify(safeMeta)}`;
}

/**
 * Parse Server `loggerAdapter`. Parse calls `log(level, message, metadata)`;
 * both arguments are redacted before anything is written.
 *
 * Parse Server logs cloud-function invocations at `info` including their input
 * params and result. Those are dropped wholesale by the redaction key rules
 * (`params`, `body`, `result` bodies are omitted, and any token-ish key is
 * masked), so a sensitive login payload cannot reach the sink.
 */
export const parseLoggerAdapter = {
  log(level: string, message: unknown, ...rest: unknown[]): void {
    const meta = rest.length > 0 ? rest[0] : undefined;
    const normalisedLevel = String(level || 'info').toLowerCase();
    const mapped: LogLevel =
      normalisedLevel === 'error'
        ? 'error'
        : normalisedLevel === 'warn'
          ? 'warn'
          : normalisedLevel === 'debug' || normalisedLevel === 'verbose' || normalisedLevel === 'silly'
            ? 'debug'
            : 'info';

    if (!enabled(mapped)) return;

    const line = buildParseLogLine(normalisedLevel, message, meta);
    if (mapped === 'error') {
      console.error(line);
    } else if (mapped === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};
