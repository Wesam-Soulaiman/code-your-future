/**
 * Startup index application ⟨CP4 closeout⟩.
 *
 * The property under test is not "an index was requested" but "the process
 * refuses to become ready unless the index is physically there". The kit's
 * applier cannot fail — every `createIndex` is wrapped and stepped over — so a
 * test that only checked the applier ran would pass on a boot with no indexes
 * at all.
 *
 * These tests therefore drive the wrapper against a fake MongoDB handle and
 * assert what it does when the database lies, when it is empty, when it is
 * blocked by duplicate rows, and when everything is fine.
 */

import {test, describe, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

interface FakeIndex {
  name: string;
  unique?: boolean;
  key?: Record<string, unknown>;
}

let startup: typeof import('../src/cloudCode/startup/indexes');

/**
 * A MongoDB stand-in.
 *
 * `created` records what the kit's applier asked for, so a test can assert the
 * wrapper neither dropped nor recreated anything.
 */
class FakeDb {
  readonly created: {collection: string; name: string}[] = [];
  readonly dropped: string[] = [];
  pingFails = false;
  /** Index names `createIndex` should refuse, as a duplicate-data failure. */
  refuse = new Set<string>();
  /** Index names that must not appear when read back, whatever creation said. */
  hide = new Set<string>();
  /** Index names to report back without their uniqueness. */
  weaken = new Set<string>();

  private store = new Map<string, FakeIndex[]>();

  async command(): Promise<unknown> {
    if (this.pingFails) {
      const error = new Error('connection refused to mongodb://user:pw@host/db');
      throw error;
    }
    return {ok: 1};
  }

  collection(name: string) {
    if (!this.store.has(name)) this.store.set(name, [{name: '_id_'}]);
    const list = this.store.get(name)!;

    return {
      indexes: async (): Promise<FakeIndex[]> =>
        list
          .filter(index => !this.hide.has(index.name))
          .map(index =>
            this.weaken.has(index.name) ? {...index, unique: false} : index
          ),

      createIndex: async (
        key: Record<string, unknown>,
        options: {name: string; unique?: boolean}
      ): Promise<string> => {
        if (this.refuse.has(options.name)) {
          // Exactly the shape a real duplicate-key failure takes, including the
          // offending value — which is why nothing may log this message.
          const error: Error & {code?: number} = new Error(
            'E11000 duplicate key error collection: test.BatchInvitation ' +
              'index: batch_invitation_token_hash_unique dup key: ' +
              '{ tokenHash: "e3b0c44298fc1c149afbf4c8996fb924" }'
          );
          error.code = 11000;
          throw error;
        }
        if (list.some(index => index.name === options.name)) {
          const error: Error & {code?: number} = new Error('index already exists');
          error.code = 85;
          throw error;
        }
        list.push({name: options.name, unique: options.unique === true, key});
        this.created.push({collection: name, name: options.name});
        return options.name;
      },

      dropIndex: async (indexName: string): Promise<void> => {
        this.dropped.push(indexName);
      },
    };
  }
}

/** A Parse Server stand-in exposing the adapter shape the wrapper reads. */
function fakeParseServer(db: FakeDb | null): unknown {
  return {config: {databaseController: {adapter: {database: db ?? undefined}}}};
}

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/StudentAuthIdentity');
  await import('../src/cloudCode/models/StudentProfile');
  await import('../src/cloudCode/models/ProfileCatalogItem');
  await import('../src/cloudCode/models/Batch');
  await import('../src/cloudCode/models/BatchInvitation');
  await import('../src/cloudCode/models/BatchEnrollment');
  await import('../src/cloudCode/models/BatchResource');
  await import('../src/cloudCode/models/LiveSlideSession');
  await import('../src/cloudCode/models/LiveSlide');
  await import('../src/cloudCode/models/LiveResponse');
  await import('../src/cloudCode/models/BatchTask');
  await import('../src/cloudCode/models/TaskSubmission');
  await import('../src/cloudCode/models/TalentReelPublication');

  startup = await import('../src/cloudCode/startup/indexes');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('the required index set', () => {
  test('is derived from the models, not hand-written', () => {
    const names = startup.requiredIndexes().map(index => index.indexName);
    // If a model gains a compound index, it appears here without anybody
    // remembering to update a list.
    assert.ok(names.length > 0, 'at least one index must be declared');
  });

  test('includes the one-current-invitation constraint, as unique', () => {
    const index = startup
      .requiredIndexes()
      .find(entry => entry.indexName === 'batch_invitation_current_unique');
    assert.ok(index, 'the current-invitation index must be required');
    assert.equal(index!.collection, 'BatchInvitation');
    assert.equal(index!.unique, true);
  });

  test('includes the one-enrollment-per-pair constraint, as unique', () => {
    const index = startup
      .requiredIndexes()
      .find(entry => entry.indexName === 'batch_enrollment_unique');
    assert.ok(index, 'the enrollment index must be required');
    assert.equal(index!.collection, 'BatchEnrollment');
    assert.equal(index!.unique, true);
  });

  test('includes the Checkpoint 3A uniqueness constraints', () => {
    const required = startup.requiredIndexes();
    for (const [collection, indexName] of [
      ['StudentProfile', 'student_profile_user_unique'],
      ['ProfileCatalogItem', 'profile_catalog_type_code_unique'],
      ['StudentAuthIdentity', 'provider_subject_unique'],
      ['StudentAuthIdentity', 'provider_user_unique'],
      ['BatchInvitation', 'batch_invitation_token_hash_unique'],
    ]) {
      const index = required.find(entry => entry.indexName === indexName);
      assert.ok(index, `${indexName} must be required`);
      assert.equal(index!.collection, collection);
      assert.equal(index!.unique, true, `${indexName} must be unique`);
    }
  });

  test('every unique index this product depends on is present', () => {
    /*
      Every uniqueness guarantee in the product, named.

      This list *is* the set of invariants that survive concurrency. Each one is
      the only reason some "two simultaneous requests" case has a single winner
      — one profile per Student, one live session per Batch, one Final Task per
      Batch, one Submission per Student per Task, one Reel per Submission. A
      change here is a change to a guarantee and should be deliberate.

      The model list above was incomplete until Checkpoint 7: it stopped at
      BatchEnrollment, so the Resource, Live Slides, and Task indexes were never
      asserted. Loading all of them is why this reads as a long list rather than
      a number.
    */
    const unique = startup.requiredIndexes().filter(index => index.unique);
    assert.deepEqual(
      unique.map(index => index.indexName).sort(),
      [
        'batch_enrollment_unique',
        'batch_invitation_current_unique',
        'batch_invitation_token_hash_unique',
        'batch_resource_storage_key_unique',
        'batch_task_attachment_key_unique',
        'batch_task_final_per_batch_unique',
        'live_response_unique',
        'live_session_live_per_batch_unique',
        'profile_catalog_type_code_unique',
        'provider_subject_unique',
        'provider_user_unique',
        'student_profile_public_slug_unique',
        'student_profile_user_unique',
        'talent_reel_submission_unique',
        'task_submission_unique',
      ],
      unique.map(index => index.indexName).join(', ')
    );
  });

  test('every Checkpoint 7 concurrency guarantee is physically enforced', () => {
    // Named individually, because each answers a specific "what if two requests
    // arrive at once" question that has no application-level answer.
    const required = startup.requiredIndexes();
    for (const [collection, indexName] of [
      // Two Admins creating a Final Task in one Batch.
      ['BatchTask', 'batch_task_final_per_batch_unique'],
      // Two saves from one Student for one Task.
      ['TaskSubmission', 'task_submission_unique'],
      // Two publication records answering "is this published?" differently.
      ['TalentReelPublication', 'talent_reel_submission_unique'],
      // Two Students issued the same public link.
      ['StudentProfile', 'student_profile_public_slug_unique'],
    ] as const) {
      const index = required.find(entry => entry.indexName === indexName);
      assert.ok(index, `${indexName} must be required`);
      assert.equal(index!.collection, collection);
      assert.equal(index!.unique, true, `${indexName} must be unique`);
    }
  });
});

describe('a healthy startup', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
  });

  test('creates every declared index and returns them', async () => {
    const applied = await startup.applyAndVerifyIndexes(fakeParseServer(db));
    assert.equal(applied.length, startup.requiredIndexes().length);

    for (const index of startup.requiredIndexes()) {
      assert.ok(
        db.created.some(
          entry => entry.name === index.indexName && entry.collection === index.collection
        ),
        `${index.collection}.${index.indexName} must have been created`
      );
    }
  });

  test('is idempotent — a second run creates nothing new', async () => {
    await startup.applyAndVerifyIndexes(fakeParseServer(db));
    const afterFirst = db.created.length;

    await startup.applyAndVerifyIndexes(fakeParseServer(db));
    assert.equal(
      db.created.length,
      afterFirst,
      'a repeated startup must not recreate an existing index'
    );
  });

  test('does not drop a valid index to recreate it', async () => {
    await startup.applyAndVerifyIndexes(fakeParseServer(db));
    await startup.applyAndVerifyIndexes(fakeParseServer(db));

    // The kit drops a *conflicting non-unique* single-field index, which is a
    // different case. No compound index this product declares is ever dropped.
    for (const index of startup.requiredIndexes()) {
      assert.ok(
        !db.dropped.includes(index.indexName),
        `${index.indexName} must not be dropped`
      );
    }
  });
});

describe('a startup that cannot succeed', () => {
  test('fails when the database does not answer', async () => {
    const db = new FakeDb();
    db.pingFails = true;

    await assert.rejects(
      () => startup.applyAndVerifyIndexes(fakeParseServer(db)),
      (error: InstanceType<typeof startup.IndexStartupError>) => {
        assert.equal(error.code, startup.IndexStartupCode.DATABASE_UNAVAILABLE);
        // The driver's message carries the connection string.
        assert.ok(!error.message.includes('mongodb://'), error.message);
        assert.ok(!error.message.includes('pw'), error.message);
        return true;
      }
    );
  });

  test('fails when the adapter exposes no driver handle', async () => {
    await assert.rejects(
      () => startup.applyAndVerifyIndexes(fakeParseServer(null)),
      (error: InstanceType<typeof startup.IndexStartupError>) => {
        assert.equal(error.code, startup.IndexStartupCode.ADAPTER_UNAVAILABLE);
        return true;
      }
    );
  });

  test('fails when duplicate data blocks a unique index', async () => {
    // The exact production scenario: two rows already share a token hash, so
    // the index cannot be built. The correct answer is to stop.
    const db = new FakeDb();
    db.refuse.add('batch_invitation_token_hash_unique');
    db.hide.add('batch_invitation_token_hash_unique');

    await assert.rejects(
      () => startup.applyAndVerifyIndexes(fakeParseServer(db)),
      (error: InstanceType<typeof startup.IndexStartupError>) => {
        assert.equal(error.code, startup.IndexStartupCode.INDEX_MISSING);
        assert.equal(error.collection, 'BatchInvitation');
        assert.equal(error.indexName, 'batch_invitation_token_hash_unique');
        return true;
      }
    );
  });

  test('the duplicate-data failure never carries the duplicate value', async () => {
    // The whole point. A real E11000 message embeds the colliding value — here
    // a token hash. Nothing that reaches a log or an operator may contain it.
    const db = new FakeDb();
    db.refuse.add('batch_invitation_token_hash_unique');
    db.hide.add('batch_invitation_token_hash_unique');

    const error = await startup
      .applyAndVerifyIndexes(fakeParseServer(db))
      .then(() => null)
      .catch((caught: unknown) => caught as InstanceType<typeof startup.IndexStartupError>);

    assert.ok(error, 'the startup must have failed');

    const surfaced =
      error!.message +
      JSON.stringify({
        code: error!.code,
        collection: error!.collection,
        indexName: error!.indexName,
      }) +
      startup.indexFailureGuidance(error!);

    assert.ok(!surfaced.includes('e3b0c44298fc'), 'the duplicate value leaked');
    assert.ok(!surfaced.includes('dup key'), 'the driver message leaked');
    assert.ok(!surfaced.includes('E11000'), 'the driver code leaked');

    // What it *does* say is enough to act on.
    assert.ok(surfaced.includes('BatchInvitation'));
    assert.ok(surfaced.includes('batch_invitation_token_hash_unique'));
  });

  test('the guidance tells an operator to clean up by hand, and promises nothing was deleted', () => {
    const error = new startup.IndexStartupError(startup.IndexStartupCode.DUPLICATE_DATA, {
      collection: 'BatchEnrollment',
      indexName: 'batch_enrollment_unique',
    });
    const guidance = startup.indexFailureGuidance(error).toLowerCase();
    assert.ok(guidance.includes('by hand'));
    assert.ok(guidance.includes('nothing was deleted'));
  });

  test('fails when a declared index is silently absent afterwards', async () => {
    // The kit swallows failures, so "the applier returned" proves nothing. This
    // is the case that a naive test would miss entirely.
    const db = new FakeDb();
    db.hide.add('batch_enrollment_unique');

    await assert.rejects(
      () => startup.applyAndVerifyIndexes(fakeParseServer(db)),
      (error: InstanceType<typeof startup.IndexStartupError>) => {
        assert.equal(error.code, startup.IndexStartupCode.INDEX_MISSING);
        assert.equal(error.indexName, 'batch_enrollment_unique');
        return true;
      }
    );
  });

  test('fails when an index exists under the right name but is not unique', async () => {
    // An index that is present but not unique enforces nothing, and looks
    // correct to anything that only checks for the name.
    const db = new FakeDb();
    db.weaken.add('batch_invitation_current_unique');

    await assert.rejects(
      () => startup.applyAndVerifyIndexes(fakeParseServer(db)),
      (error: InstanceType<typeof startup.IndexStartupError>) => {
        assert.equal(error.code, startup.IndexStartupCode.INDEX_NOT_UNIQUE);
        assert.equal(error.indexName, 'batch_invitation_current_unique');
        return true;
      }
    );
  });

  test('does not delete or rewrite anything when it fails', async () => {
    const db = new FakeDb();
    db.hide.add('batch_enrollment_unique');

    await startup.applyAndVerifyIndexes(fakeParseServer(db)).catch(() => undefined);

    assert.deepEqual(db.dropped, [], 'nothing may be dropped on a failed startup');
  });
});

describe("the kit's own console output", () => {
  test('is diverted, so a duplicate value never reaches the real console', async () => {
    // The kit prints `createErr.message` with `console.error`, and a driver's
    // E11000 message contains the colliding value. Nothing may reach the
    // process console unredacted.
    const db = new FakeDb();
    db.refuse.add('batch_invitation_token_hash_unique');
    db.hide.add('batch_invitation_token_hash_unique');

    const seen: string[] = [];
    const original = {log: console.log, warn: console.warn, error: console.error};
    console.log = (...args: unknown[]) => seen.push(args.join(' '));
    console.warn = (...args: unknown[]) => seen.push(args.join(' '));
    console.error = (...args: unknown[]) => seen.push(args.join(' '));

    try {
      await startup.applyAndVerifyIndexes(fakeParseServer(db)).catch(() => undefined);
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }

    const output = seen.join(' | ');
    assert.ok(!output.includes('e3b0c44298fc'), `the duplicate value reached the console: ${output}`);
  });

  test('restores the console even when the applier throws', async () => {
    const before = {log: console.log, warn: console.warn, error: console.error};

    const db = new FakeDb();
    db.hide.add('batch_enrollment_unique');
    await startup.applyAndVerifyIndexes(fakeParseServer(db)).catch(() => undefined);

    assert.equal(console.log, before.log);
    assert.equal(console.warn, before.warn);
    assert.equal(console.error, before.error);
  });
});

describe('duplicate-data detection', () => {
  test('recognises the driver codes, never the message', () => {
    assert.equal(startup.isDuplicateDataError({code: 11000}), true);
    assert.equal(startup.isDuplicateDataError({code: 11001}), true);
    assert.equal(startup.isDuplicateDataError({code: 68}), true);
    assert.equal(startup.isDuplicateDataError({code: 85}), false);
    assert.equal(startup.isDuplicateDataError(new Error('E11000 duplicate key')), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The wiring itself. These read the source, because the property being checked
// is *where* the call sits relative to `server.listen` — which no unit test of
// the module can observe.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `app.ts` as written, not as compiled.
 *
 * The suite runs from `build/test/`, so `__dirname` is two directories away
 * from anything useful. Walking up to the backend root — the directory holding
 * `package.json` and `src/` — finds the source wherever the runner started.
 */
function readAppSource(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'src', 'app.ts');
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('backend/src/app.ts not found');
}

describe('the startup wiring', () => {
  const source = readAppSource();

  test('index application runs during normal startup', () => {
    assert.ok(
      source.includes('applyAndVerifyIndexes(parseServer)'),
      'app.ts must apply and verify indexes'
    );
  });

  test('it is awaited, so startup cannot run ahead of it', () => {
    assert.match(source, /await\s+applyAndVerifyIndexes\(/);
  });

  test('it runs BEFORE the port is opened', () => {
    const applyAt = source.indexOf('applyAndVerifyIndexes(parseServer)');
    const listenAt = source.indexOf('server.listen(');
    assert.ok(applyAt > 0, 'the apply call must exist');
    assert.ok(listenAt > 0, 'the listen call must exist');
    assert.ok(
      applyAt < listenAt,
      'indexes must be in place before the server accepts a request'
    );
  });

  test('the apply call is not inside the listen callback', () => {
    // The original defect. Everything between `server.listen(` and the end of
    // the file must be free of it.
    const listenAt = source.indexOf('server.listen(');
    assert.ok(!source.slice(listenAt).includes('applyAndVerifyIndexes'));
  });

  test('the deprecated alias is no longer used', () => {
    assert.ok(
      !source.includes('applyUniqueIndexes'),
      'applyUniqueIndexes hid the fact that this applies every index kind'
    );
  });

  test('a failed index step is not swallowed', () => {
    // No `catchError` around the call — it must be allowed to reject and reach
    // the boot handler.
    assert.ok(!source.includes('catchError(applyAndVerifyIndexes'));
    assert.ok(source.includes('IndexStartupError'), 'the boot handler must recognise it');
  });

  test('a failed boot exits rather than lingering', () => {
    // A process that is up but not listening looks healthy to a supervisor.
    assert.ok(source.includes('process.exit(1)'));
  });

  test('the boot handler never puts the raw error into a log field', () => {
    // `indexFailureGuidance(error)` is fine — it returns a fixed sentence built
    // from the stable code. What must never appear is the error itself, or its
    // message, as a *value*: both can carry the database URI, and a
    // duplicate-key message carries the colliding value.
    const handler = source.slice(source.indexOf('.catch('));

    for (const forbidden of [
      'error.message',
      'error.stack',
      'String(error)',
      'err: error',
      'error: error',
      'detail: error',
      'JSON.stringify(error)',
    ]) {
      assert.ok(!handler.includes(forbidden), `the boot handler must not log ${forbidden}`);
    }

    // Only the safe identity fields are passed.
    assert.ok(handler.includes('code: error.code'));
    assert.ok(handler.includes('collection: error.collection'));
    assert.ok(handler.includes('indexName: error.indexName'));
  });
});
