/**
 * Recursive redaction for anything that may reach a log sink.
 *
 * The rule is deny-by-default on key names: if a key looks sensitive it is
 * replaced with a placeholder regardless of nesting depth, casing, or the value
 * type. Nothing here ever returns the original value for a matched key, so a
 * new sensitive field added upstream cannot silently start leaking as long as
 * its name matches one of the patterns below.
 */

export const REDACTED = '[REDACTED]';

/**
 * Key fragments that mark a value as sensitive. Matching is case-insensitive
 * and substring-based on a normalised key (non-alphanumerics stripped), so
 * `sessionToken`, `session_token`, `SESSION-TOKEN`, and `X-Parse-Session-Token`
 * all match the same `sessiontoken` fragment.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  // credentials
  'password',
  'passwd',
  'newpassword',
  'oldpassword',
  'secret',
  'credential',
  // Parse / server keys
  'masterkey',
  'readonlymasterkey',
  'maintenancekey',
  'restapikey',
  'javascriptkey',
  'clientkey',
  'dotnetkey',
  'webhookkey',
  'filekey',
  // sessions & tokens
  'sessiontoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearer',
  'apikey',
  'token',
  // OAuth / auth payloads
  'authdata',
  'authorization',
  'authorizationcode',
  'authentication',
  'cookie',
  'setcookie',
  'clientsecret',
  'privatekey',
  'vapid',
  // OAuth identity — a provider's subject is a stable identifier for a real
  // person. `subject` as a fragment covers `providerSubject`, `googleSubject`,
  // and `oauthSubject` in one rule; `claims` covers a whole claim bag.
  'subject',
  'claims',
  // infrastructure
  'databaseuri',
  'connectionstring',
  'mongodburi',
  'dsn',
  // personal data that must not be logged
  'email',
  'phone',
  'phonenumber',
  'dateofbirth',
  'dob',
  // payload bodies / binary
  'base64',
  'filecontents',
  'imagebytes',
  'buffer',
  'rawbody',
];

/**
 * Keys whose whole subtree is dropped rather than walked. Request/response
 * bodies and raw Parse objects have no business in a log line at all, and
 * walking them risks emitting an unbounded blob of unknown shape.
 */
const DROPPED_KEY_FRAGMENTS: readonly string[] = [
  'body',
  'params',
  'headers',
  'request',
  'response',
];

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 512;

function normaliseKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Key names that are sensitive only as a **whole word**.
 *
 * `sub` is the OAuth subject claim and must be redacted, but it is too short to
 * be a substring rule: that would also swallow `submission`, `subtotal`, and
 * `subscription`. Exact matching keeps the rule precise.
 */
const SENSITIVE_KEY_NAMES: readonly string[] = ['sub'];

/** True when a key name marks its value as sensitive. */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (SENSITIVE_KEY_NAMES.includes(normalised)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some(fragment => normalised.includes(fragment));
}

/** True when a key's whole subtree should be dropped instead of walked. */
export function isDroppedKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return DROPPED_KEY_FRAGMENTS.some(fragment => normalised === fragment);
}

function isPlainish(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * A Parse.Object (or anything shaped like one) must never be logged whole — it
 * carries every attribute plus its ACL. Reduce it to a stable identity.
 */
function summariseParseObject(value: Record<string, unknown>): string | undefined {
  const className = value['className'];
  if (typeof className !== 'string') return undefined;
  const hasParseShape =
    typeof (value as {get?: unknown}).get === 'function' ||
    typeof (value as {toPointer?: unknown}).toPointer === 'function' ||
    'attributes' in value;
  if (!hasParseShape) return undefined;
  const id = typeof value['id'] === 'string' ? value['id'] : 'unsaved';
  return `[ParseObject ${className}#${id}]`;
}

/**
 * Redact a value recursively. Handles nested objects, arrays, `Map`, `Set`,
 * `Error` (including request data hung off the error), and circular graphs.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';

  const type = typeof value;

  if (type === 'string') {
    const asString = value as string;
    return asString.length > MAX_STRING_LENGTH
      ? `${asString.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
      : asString;
  }

  if (type === 'number' || type === 'boolean' || type === 'bigint') return value;
  if (type === 'function') return '[Function]';
  if (type === 'symbol') return '[Symbol]';

  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (value instanceof Error) {
    // Errors frequently carry `request`, `config`, or `response` (axios) —
    // walking the error body redacts those via the normal key rules.
    const result: Record<string, unknown> = {
      name: value.name,
      message: redact(value.message, depth + 1),
    };
    const code = (value as {code?: unknown}).code;
    if (typeof code === 'number' || typeof code === 'string') result['code'] = code;
    for (const key of Object.keys(value)) {
      if (key === 'name' || key === 'message' || key === 'code' || key === 'stack') continue;
      result[key] = redactEntry(key, (value as unknown as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => redact(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[TRUNCATED ${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    return items;
  }

  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      const keyName = String(key);
      result[keyName] = redactEntry(keyName, entry, depth + 1);
    }
    return result;
  }

  if (value instanceof Set) {
    return redact([...value.values()], depth);
  }

  if (isPlainish(value)) {
    const record = value as Record<string, unknown>;

    const parseSummary = summariseParseObject(record);
    if (parseSummary) return parseSummary;

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      result[key] = redactEntry(key, record[key], depth + 1);
    }
    return result;
  }

  return '[UNKNOWN]';
}

/** Apply the key rules for one entry, then recurse. */
function redactEntry(key: string, value: unknown, depth: number): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (isDroppedKey(key)) return '[OMITTED]';
  return redact(value, depth);
}

/**
 * Redact a top-level metadata bag. Exposed separately because log call sites
 * always pass an object, and the key rules must apply to its own keys too.
 */
export function redactMeta(meta: unknown): unknown {
  if (!isPlainish(meta) || Array.isArray(meta)) return redact(meta);
  const record = meta as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    result[key] = redactEntry(key, record[key], 1);
  }
  return result;
}

/**
 * Scrub a free-text message.
 *
 * This matters more than it looks: Parse Server logs every cloud-function call as
 * a message string containing the serialised input params and result
 * (`Input: {...}` / `Result: {...}`). Parse masks only `password`, so without
 * this pass a future function taking an email, phone, or token argument would
 * have it written verbatim.
 *
 * Three passes:
 *   1. mask any `"sensitiveKey": value` pair inside embedded JSON, using the
 *      same key rules as `redact()` — so the key list has one definition;
 *   2. mask Mongo connection strings;
 *   3. mask bare Parse session tokens (`r:` + hex).
 */
export function redactMessage(message: string): string {
  return (
    message
      // "key": "value" | "key": value | key=value  (JSON and query-string shapes)
      .replace(
        /(["']?)([A-Za-z0-9_.\-]+)\1(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s}&]+)/g,
        (match, quote, key, separator) =>
          isSensitiveKey(key) ? `${quote}${key}${quote}${separator}"${REDACTED}"` : match
      )
      .replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://[REDACTED]')
      .replace(/\br:[A-Za-z0-9]{16,}\b/g, REDACTED)
  );
}
