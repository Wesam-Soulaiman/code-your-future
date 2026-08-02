/**
 * Applying and **verifying** the database indexes at startup ⟨CP4 closeout⟩.
 *
 * ── Why this module exists at all ───────────────────────────────────────────
 * The kit ships `applyAllIndexes`, and it was already being called — but under
 * its deprecated alias `applyUniqueIndexes`, from **inside the `server.listen`
 * callback**. That is too late: the port is open and requests are being served
 * while the indexes are still being built. For most indexes that is merely
 * slow. For the two that are the *sole* enforcement of a concurrency invariant
 * — one current invitation per Batch, one enrollment per (Batch, Student) — it
 * means a window in which the guarantee simply does not exist.
 *
 * Three further problems made the call unsafe to rely on:
 *
 *  1. **It cannot fail.** Every `createIndex` is wrapped in `catchError`, and a
 *     genuine failure is reported with `console.error` and then stepped over.
 *     A boot with a missing unique index looked exactly like a healthy one.
 *  2. **It never checks its own work.** Nothing reads the indexes back, so a
 *     silently-skipped index and a created one are indistinguishable.
 *  3. **It logs outside the redacting logger.** A duplicate-key failure's
 *     driver message embeds the offending value — `E11000 … dup key: {
 *     tokenHash: "…" }`. Printing that writes an invitation's token hash, or a
 *     Student's verified email, straight into the log.
 *
 * The kit must not be patched, so this module wraps it: it runs the kit's
 * applier, then **reads every declared index back out of MongoDB** and refuses
 * to let the process become ready if one is missing. Nothing here re-implements
 * index creation, and nothing here deletes or rewrites data.
 *
 * ── What it will never do ───────────────────────────────────────────────────
 * It does not remove duplicate rows, does not rewrite business records, does
 * not drop a valid index to recreate it, and does not relax a unique constraint
 * to make a boot succeed. When existing data blocks an index the only correct
 * answer is to stop and tell an operator which collection and which index need
 * attention — never to make the problem disappear.
 */

import {
  applyAllIndexes,
  getCompoundIndexes,
  getFieldIndexes,
  getUniqueIndexes,
  catchError,
} from '@90soft/parse-server-kit';

import {safeLog} from '../utils/logging/safeLogger';
import {redactMessage} from '../utils/logging/redact';

/** A stable reason a startup index step failed. Never a driver message. */
export const IndexStartupCode = {
  /** The database could not be reached at all. */
  DATABASE_UNAVAILABLE: 'INDEX_DATABASE_UNAVAILABLE',
  /** The adapter did not expose a driver handle, so nothing could be verified. */
  ADAPTER_UNAVAILABLE: 'INDEX_ADAPTER_UNAVAILABLE',
  /** A declared index is absent after the applier ran. */
  INDEX_MISSING: 'INDEX_MISSING',
  /** A declared index exists but does not carry the uniqueness it was declared with. */
  INDEX_NOT_UNIQUE: 'INDEX_NOT_UNIQUE',
  /** Existing rows violate a unique index, so it cannot be built. */
  DUPLICATE_DATA: 'INDEX_DUPLICATE_DATA',
} as const;

export type IndexStartupCodeValue =
  (typeof IndexStartupCode)[keyof typeof IndexStartupCode];

/**
 * A startup failure carrying only a stable code and the identity of the index.
 *
 * Deliberately **not** an error that wraps the driver's own error: the driver's
 * message for a duplicate key contains the duplicate value, and this object is
 * what gets logged.
 */
export class IndexStartupError extends Error {
  readonly code: IndexStartupCodeValue;
  readonly collection?: string;
  readonly indexName?: string;

  constructor(
    code: IndexStartupCodeValue,
    detail?: {collection?: string; indexName?: string}
  ) {
    // The message is built from the code and the index identity only. A
    // collection name and an index name are schema, not data.
    const where = detail?.collection
      ? ` (${detail.collection}${detail.indexName ? `.${detail.indexName}` : ''})`
      : '';
    super(`${code}${where}`);
    this.name = 'IndexStartupError';
    this.code = code;
    this.collection = detail?.collection;
    this.indexName = detail?.indexName;
  }
}

/** One index this application requires to exist before it serves a request. */
export interface RequiredIndex {
  collection: string;
  indexName: string;
  unique: boolean;
}

/**
 * Every index the models declare, flattened.
 *
 * Read from the same decorator metadata the applier reads, so this cannot drift
 * from what was actually asked for — adding a `compoundIndexes` entry to a model
 * adds it here, and therefore to the verification, automatically.
 */
export function requiredIndexes(): RequiredIndex[] {
  const required: RequiredIndex[] = [];

  for (const {className, indexName} of getUniqueIndexes()) {
    required.push({collection: className, indexName, unique: true});
  }
  for (const {className, indexName, unique} of getCompoundIndexes()) {
    required.push({collection: className, indexName, unique});
  }
  for (const {className, indexName} of getFieldIndexes()) {
    required.push({collection: className, indexName, unique: false});
  }

  return required;
}

/** The MongoDB driver handle Parse is using, or undefined. */
function databaseHandle(parseServerInstance: unknown): MongoDatabaseLike | undefined {
  const config = (parseServerInstance as {config?: Record<string, any>})?.config;
  const adapter =
    config?.['databaseController']?.adapter ?? config?.['database']?.adapter;
  return (
    adapter?.database ?? adapter?.client?.db?.() ?? adapter?.mongoClient?.db?.()
  );
}

/** The narrow slice of the driver this module uses. */
interface MongoDatabaseLike {
  collection(name: string): {
    indexes(): Promise<{name?: string; unique?: boolean}[]>;
  };
  command?(command: Record<string, unknown>): Promise<unknown>;
}

/**
 * Confirm the database answers before anything tries to build an index.
 *
 * A `ping` distinguishes "the database is not there" from "the index could not
 * be created", which are different operational problems with different fixes.
 */
async function assertDatabaseAvailable(db: MongoDatabaseLike): Promise<void> {
  if (typeof db.command !== 'function') return;

  const [error] = await catchError(db.command({ping: 1}));
  if (error) {
    // The driver's error can carry the connection string. Only the code leaves.
    throw new IndexStartupError(IndexStartupCode.DATABASE_UNAVAILABLE);
  }
}

/**
 * Read back what MongoDB actually has for one collection.
 *
 * Returns an empty list when the collection does not exist yet, which is normal
 * on a first boot — the index is created by the applier, and the verification
 * below is what decides whether that worked.
 */
async function existingIndexes(
  db: MongoDatabaseLike,
  collection: string
): Promise<{name?: string; unique?: boolean}[]> {
  const [error, indexes] = await catchError(db.collection(collection).indexes());
  if (error) return [];
  return indexes ?? [];
}

/**
 * True when a driver error means "existing rows violate this unique index".
 *
 * Checked by **code**, never by matching the message — the message is the thing
 * that must not be read, let alone logged.
 */
export function isDuplicateDataError(error: unknown): boolean {
  const code = (error as {code?: unknown})?.code;
  // 11000/11001: duplicate key. 68: index build failed on existing data.
  return code === 11000 || code === 11001 || code === 68;
}

/**
 * Run `work` with `console` diverted through the redacting logger.
 *
 * The kit's applier writes with bare `console.log` / `console.error`, outside
 * every logging boundary this application has. That is not a style complaint:
 * on a duplicate-key failure it prints `createErr.message`, and a driver's
 * E11000 message **contains the colliding value** —
 * `dup key: { tokenHash: "e3b0c4…" }`. On this product's collections that value
 * is an invitation's token hash, a Student's verified email, or a Google
 * subject.
 *
 * `node_modules` is not ours to patch, so the output is intercepted here
 * instead: every line goes through `redactMessage`, which masks the value, and
 * out at **debug** level. A normal boot therefore shows only the structured
 * lines this module writes; `LOG_LEVEL=debug` still gets the kit's detail, with
 * the sensitive part removed.
 *
 * The originals are restored in a `finally`, so a throw cannot leave the
 * process with a rewritten console.
 */
async function withRedactedConsole<T>(work: () => Promise<T>): Promise<T> {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  // Buffered, not forwarded. `safeLog` writes to `console` itself, so emitting
  // from inside the replacement would call straight back into it — the first
  // attempt at this recursed until the boot stalled.
  const captured: {level: 'debug' | 'warn'; line: string}[] = [];
  const capture =
    (level: 'debug' | 'warn') =>
    (...args: unknown[]): void => {
      captured.push({level, line: redactMessage(args.map(part => String(part)).join(' '))});
    };

  console.log = capture('debug');
  console.warn = capture('warn');
  console.error = capture('warn');

  try {
    return await work();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;

    // Replayed only once the real console is back.
    for (const {level, line} of captured) {
      if (level === 'warn') safeLog.warn(line, {op: 'applyIndexes', stage: 'kit'});
      else safeLog.debug(line, {op: 'applyIndexes', stage: 'kit'});
    }
  }
}

/**
 * Apply every declared index and prove each one exists.
 *
 * Idempotent: the applier treats an existing index as success (MongoDB codes 85
 * and 86), and this verification then finds it either way. A second boot creates
 * nothing and drops nothing.
 *
 * Throws `IndexStartupError` rather than returning a flag, so a caller cannot
 * accidentally continue past a failure.
 */
export async function applyAndVerifyIndexes(
  parseServerInstance: unknown
): Promise<RequiredIndex[]> {
  const required = requiredIndexes();

  const db = databaseHandle(parseServerInstance);
  if (!db) {
    throw new IndexStartupError(IndexStartupCode.ADAPTER_UNAVAILABLE);
  }

  await assertDatabaseAvailable(db);

  if (required.length === 0) {
    safeLog.info('No indexes are declared', {
      op: 'applyIndexes',
      stage: 'complete',
      ok: true,
      count: 0,
    });
    return [];
  }

  safeLog.info('Applying declared indexes', {
    op: 'applyIndexes',
    stage: 'start',
    ok: true,
    count: required.length,
  });

  // The kit's applier does the creating. It swallows its own failures, which is
  // exactly why the verification below is not optional — and it writes straight
  // to `console`, which is why the call is wrapped.
  const [applyError] = await catchError(
    withRedactedConsole(() => applyAllIndexes(parseServerInstance))
  );
  if (applyError) {
    if (isDuplicateDataError(applyError)) {
      throw new IndexStartupError(IndexStartupCode.DUPLICATE_DATA);
    }
    throw new IndexStartupError(IndexStartupCode.INDEX_MISSING);
  }

  // ── Verification ─────────────────────────────────────────────────────────
  // Read each collection once, then check every index declared against it.
  const byCollection = new Map<string, RequiredIndex[]>();
  for (const index of required) {
    const list = byCollection.get(index.collection) ?? [];
    list.push(index);
    byCollection.set(index.collection, list);
  }

  for (const [collection, wanted] of byCollection) {
    const present = await existingIndexes(db, collection);
    const byName = new Map(present.map(index => [index.name, index]));

    for (const index of wanted) {
      const found = byName.get(index.indexName);

      if (!found) {
        // The most likely cause by far is existing data that violates a unique
        // constraint, so the diagnostic points an operator at that first.
        safeLog.error('A declared index is missing after startup', {
          op: 'applyIndexes',
          stage: 'verify',
          ok: false,
          code: IndexStartupCode.INDEX_MISSING,
          collection,
          indexName: index.indexName,
          unique: index.unique,
        });
        throw new IndexStartupError(IndexStartupCode.INDEX_MISSING, {
          collection,
          indexName: index.indexName,
        });
      }

      if (index.unique && found.unique !== true) {
        // An index with the right name but without uniqueness enforces nothing.
        // Left in place deliberately: dropping it is an operator's decision,
        // because doing it automatically could mask a deployment mistake.
        safeLog.error('A declared unique index is not unique', {
          op: 'applyIndexes',
          stage: 'verify',
          ok: false,
          code: IndexStartupCode.INDEX_NOT_UNIQUE,
          collection,
          indexName: index.indexName,
        });
        throw new IndexStartupError(IndexStartupCode.INDEX_NOT_UNIQUE, {
          collection,
          indexName: index.indexName,
        });
      }
    }
  }

  safeLog.info('Indexes applied and verified', {
    op: 'applyIndexes',
    stage: 'complete',
    ok: true,
    count: required.length,
    uniqueCount: required.filter(index => index.unique).length,
  });

  return required;
}

/**
 * The operator-facing explanation of a failed index step.
 *
 * Deliberately generic about *what* is duplicated. Naming the collection and
 * the index is enough to act on; printing the offending rows would put exactly
 * the values this product protects — a token hash, a verified email, a provider
 * subject — into a log file.
 */
export function indexFailureGuidance(error: IndexStartupError): string {
  switch (error.code) {
    case IndexStartupCode.DATABASE_UNAVAILABLE:
      return 'The database did not respond. The server will not start without it.';
    case IndexStartupCode.ADAPTER_UNAVAILABLE:
      return 'The database adapter exposed no driver handle, so indexes could not be verified.';
    case IndexStartupCode.DUPLICATE_DATA:
    case IndexStartupCode.INDEX_MISSING:
      return (
        'A required index could not be created. The usual cause is existing rows ' +
        'that violate it. Inspect the named collection and index by hand, resolve ' +
        'the conflict, and start again. Nothing was deleted or modified.'
      );
    case IndexStartupCode.INDEX_NOT_UNIQUE:
      return (
        'An index with the required name exists but is not unique, so it enforces ' +
        'nothing. Drop it by hand once you are satisfied the data is consistent, ' +
        'then start again. Nothing was dropped automatically.'
      );
    default:
      return 'A required index is not in place.';
  }
}
