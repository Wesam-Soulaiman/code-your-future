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
  // A person's name ⟨CP3A catalog⟩. Found by runtime validation: Parse logs
  // every `beforeSave` and cloud-function result as a serialised object, so a
  // Student's `fullName` and their Google `displayName` were written verbatim
  // in lines where the email beside them was already `[REDACTED]` — which is
  // incoherent, and a name identifies a person just as well as an address.
  // No log call site anywhere passes a field with these names, so nothing
  // useful is lost.
  'fullname',
  'displayname',
  'givenname',
  'familyname',
  'rawbody',
  // The address of a private file's bytes ⟨CP5⟩. Found by runtime validation,
  // the same way `fullname` was: Parse logs every `beforeSave` with its
  // serialised object, so `BatchResource.storageKey` — 128 bits of randomness
  // that is the *only* thing standing between a log reader and somebody's
  // private document — was written verbatim on every upload. It is in
  // `protectedFields`, absent from every DTO, and absent from the Resource
  // logging allow-list; a log line was the one place left that had it.
  //
  // The fragment is `storagekey` rather than `storage`, which would also
  // swallow harmless keys like `storageIsUsable`. No log call site anywhere
  // passes a field with this name, so nothing useful is lost.
  'storagekey',
  // A Student's Live Slides answer ⟨CP6⟩. The primary protection is the
  // payload omission below — these four are defence in depth, for the case
  // where an answer reaches a log line that names no Live Slides subject.
  //
  // Only names that exist nowhere else are listed. `question`, `content`, and
  // `description` are deliberately **absent**: `description` alone appears in
  // Batch logs, Resource logs, and every `@ParseField` declaration, and masking
  // it globally would blank a great deal of harmless output to protect one
  // module. Scope, not breadth.
  'textanswer',
  'selectedoptionid',
  'selectedoptionids',
  'answervalue',
];

/**
 * Key fragments that carry **file or image content** ⟨CP3A catalog⟩.
 *
 * These are split from the list above because of one detail: a *count* of bytes
 * is safe and genuinely useful in a log line, while the bytes themselves are
 * never acceptable at any length. `bytes: 48213` tells an operator the upload
 * worked; `bytes: "iVBORw0KGgo…"` is a photograph of somebody in the log.
 *
 * So a key matching one of these is redacted **unless its value is a number or a
 * boolean**, which no image can be. Everything else — a string, an array, a
 * buffer, a nested object — is replaced outright, with no truncated prefix:
 * the first characters of a JPEG are still the first characters of a JPEG, and
 * a "safe" 64-character preview is a habit that leaks the moment somebody
 * raises the limit.
 *
 * `filename` is here on purpose. People name photographs after themselves.
 */
const BINARY_KEY_FRAGMENTS: readonly string[] = [
  'data',
  'base64',
  'photo',
  'image',
  'file',
  'buffer',
  'bytes',
  'binary',
  'contents',
  'payload',
  'blob',
  'attachment',
  'thumbnail',
  'avatar',
  'picture',
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

/** True when a key name marks its value as sensitive whatever the value is. */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (SENSITIVE_KEY_NAMES.includes(normalised)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some(fragment => normalised.includes(fragment));
}

/**
 * True when a key name marks its value as file or image content.
 *
 * `profile` is removed before matching, and that is not a nicety: `profileId`
 * contains `file`, so without this every profile id in every log line would
 * come out as `[REDACTED]` — losing the one identifier an operator needs to
 * follow a request. Stripping the product word keeps `profilePhoto` and
 * `profileFileData` matching, because what remains is still `photo` and
 * `filedata`.
 */
export function isBinaryKey(key: string): boolean {
  const normalised = normaliseKey(key).replace(/profile/g, '');
  return BINARY_KEY_FRAGMENTS.some(fragment => normalised.includes(fragment));
}

/**
 * A value that cannot possibly be file content.
 *
 * Deliberately narrow: a number or a boolean. A short string is **not** on this
 * list, because "it's only 40 characters" is how a prefix of an image ends up in
 * a log.
 */
function isSafeMetric(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

/** The same test against the raw text captured from an embedded JSON pair. */
function isSafeMetricLiteral(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false') return true;
  return /^-?\d+(\.\d+)?$/.test(trimmed);
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
  // A byte count survives; anything that could *be* the bytes does not.
  if (isBinaryKey(key)) return isSafeMetric(value) ? value : REDACTED;
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
 * Four passes:
 *   1. mask any `"sensitiveKey": value` pair inside embedded JSON, using the
 *      same key rules as `redact()` — so the key list has one definition;
 *   2. mask a `data:` URI, which is a whole image written inline and reaches a
 *      log without ever being a key/value pair;
 *   3. mask Mongo connection strings;
 *   4. mask bare Parse session tokens (`r:` + hex).
 *
 * The value pattern is `[^"\\]*(?:\\.[^"\\]*)*` rather than `(?:[^"\\]|\\.)*`:
 * both match the same quoted strings, but only the first is unambiguous. The
 * alternation form has two ways to match every ordinary character, which on a
 * multi-megabyte payload that fails to close makes the matcher explore an
 * exponential number of paths and hang the process. An image is exactly that
 * size, so the shape mattered here.
 */
const QUOTED_VALUE = String.raw`"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'`;

/**
 * `{` is excluded from the unquoted value class, and that detail is the whole
 * fix for Parse's own log shape.
 *
 * Parse writes `Input: {"data":"…"}`. With `{` allowed, the very first match is
 * the pair `Input` → `{"data":"…"`, which is not a sensitive key — so the match
 * is kept and the scanner has already consumed the `data` pair it was supposed
 * to mask. Excluding `{` makes `Input:` fail to match, and the scanner reaches
 * the real key/value pairs inside the object.
 */
const KEY_VALUE_PAIR = new RegExp(
  String.raw`(["']?)([A-Za-z0-9_.\-]+)\1(\s*[:=]\s*)(${QUOTED_VALUE}|[^,\s{}&]+)`,
  'g'
);

/**
 * Payloads that are omitted **whole**, by the surface they belong to ⟨CP6⟩.
 *
 * ── Why this is not a longer key list ───────────────────────────────────────
 * Live Slides moves questions, option labels, and Students' answers about
 * themselves. The obvious fix is to add `question`, `content`, `options`, and
 * `description` to the sensitive-key list — and it is the wrong one:
 * `description` alone appears in Batch logs, Resource logs, and every
 * `@ParseField` declaration, so masking it globally would blank a great deal of
 * useful, harmless output to protect one module.
 *
 * The narrow fix is to recognise **whose payload it is**. Parse writes one line
 * per cloud-function call and per trigger, and both name their subject:
 *
 *     Ran cloud function submitLiveResponse for user … with:
 *       Input: {"slideId":"…","textAnswer":"…"}
 *     beforeSave triggered for LiveSlide for user …:
 *       Input: {"question":"…","options":[…]}
 *
 * When the subject is a Live Slides class or operation, the whole `Input:` and
 * `Result:` block is replaced. Every other surface's logs are untouched, and no
 * field name has to be predicted in advance — which matters, because the field
 * that leaks is always the one nobody thought of.
 */
export const OMITTED_PAYLOAD_SUBJECTS: readonly string[] = [
  // Classes, for the trigger lines.
  'LiveSlideSession',
  'LiveSlide',
  'LiveResponse',
  // Cloud functions, for the call lines. **Named explicitly, not matched by a
  // pattern.** An earlier version tested names against a regular expression and
  // it silently missed `getPresenterState` and `getResultsByQuestion` — whose
  // results carry every answer in the room *and* the name of the Student who
  // gave each one. A list is checkable; a pattern is a guess.
  //
  // `liveSlidesPayloadCoverage` in the CP6 suite asserts this list covers every
  // registered Live Slides operation, so a nineteenth one fails the build
  // rather than quietly logging its payload.
  'listLiveSessions',
  'getLiveSession',
  'createLiveSession',
  'updateLiveSession',
  'markLiveSessionReady',
  'returnLiveSessionToDraft',
  'duplicateLiveSession',
  'addLiveSlide',
  'updateLiveSlide',
  'duplicateLiveSlide',
  'deleteLiveSlide',
  'reorderLiveSlides',
  'startLiveSession',
  'getPresenterState',
  'previousLiveSlide',
  'nextLiveSlide',
  'endLiveSession',
  'listLiveResponses',
  'getResultsByStudent',
  'getResultsByQuestion',
  'getMyLiveState',
  'submitLiveResponse',
  'listMyLiveResponses',
  'listStudentLiveAnswers',
];

/** True when this log line belongs to a surface whose payload is omitted whole. */
function hasOmittedPayload(message: string): boolean {
  const subject = /(?:triggered for|cloud function)\s+([A-Za-z0-9_]+)/.exec(message);
  return subject !== null && OMITTED_PAYLOAD_SUBJECTS.includes(subject[1]);
}

/**
 * Replace everything after an `Input:` or `Result:` label on that line.
 *
 * ── Why this is line-scoped rather than brace-matched ───────────────────────
 * The first version matched a balanced `{…}` with a lazy quantifier and a
 * lookahead for the end of the block. It worked on a small payload and silently
 * failed on a large one: the runtime validation found a `Result:` carrying five
 * questions that survived untouched while the `Input:` on the line above was
 * redacted correctly.
 *
 * Parse writes each label on its own line, so the end of the line is the end of
 * the payload — a boundary no amount of nesting, escaping, or sheer length can
 * move. The trailing metadata object on a `Result:` line goes with it, which
 * costs nothing: the function name is already on the header line above.
 */
function omitPayloadBlocks(message: string): string {
  // Split rather than a multiline regex. An earlier version used
  // `/(Input|Result):.+$/gm` and, for reasons that were not worth chasing,
  // redacted nothing when called through `redactMessage` while working
  // perfectly in isolation. Walking the lines cannot fail that way, and the
  // intent reads directly off the code.
  const NEWLINE = String.fromCharCode(10);
  return message
    .split(NEWLINE)
    .map(line => {
      const label = /^(\s*(?:Input|Result):)\s*(.*)$/.exec(line);
      if (!label || label[2].length === 0) return line;
      return `${label[1]} ${REDACTED}`;
    })
    .join(NEWLINE);
}


export function redactMessage(message: string): string {
  const scoped = hasOmittedPayload(message) ? omitPayloadBlocks(message) : message;

  return (
    scoped
      // "key": "value" | "key": value | key=value  (JSON and query-string shapes)
      .replace(KEY_VALUE_PAIR, (match, quote, key, separator, value) => {
        if (isSensitiveKey(key)) return `${quote}${key}${quote}${separator}"${REDACTED}"`;
        if (isBinaryKey(key) && !isSafeMetricLiteral(String(value))) {
          return `${quote}${key}${quote}${separator}"${REDACTED}"`;
        }
        return match;
      })
      // A whole image inline. No prefix is kept — the first bytes of a JPEG are
      // still the first bytes of a JPEG.
      .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*/gi, REDACTED)
      // A Batch join link ⟨CP4⟩. The token sits in a path segment rather than a
      // key/value pair, so the rule above cannot see it — and a link pasted
      // into a message is a working invitation for anybody who reads the log.
      // The `/join/` prefix is kept so a line still says what kind of URL was
      // masked; only the token itself goes.
      .replace(/(#?\/join\/)[A-Za-z0-9_-]{16,}/g, `$1${REDACTED}`)
      .replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://[REDACTED]')
      .replace(/\br:[A-Za-z0-9]{16,}\b/g, REDACTED)
  );
}
