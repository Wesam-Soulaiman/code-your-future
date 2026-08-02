/**
 * Reconciling a stored schema with the models that own it ⟨CP5 fix⟩.
 *
 * The failure this guards against was found in a real database, not in a test:
 * `BatchResource` carried a required `file` column no model declares, and Parse
 * Server's `RestWrite` therefore refused **every** create on the class with a
 * bare `142 / "file is required"`. The class read fine, counted fine, and would
 * not accept a single row.
 *
 * A fresh database never has it, which is why every suite and every clean
 * install passed while one real database could not store a file.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let drift: typeof import('../src/cloudCode/startup/schemaDrift');

/** What the fake `Parse.Schema` was asked to do, per class. */
interface SchemaCall {
  className: string;
  deleted: string[];
  updated: boolean;
}

let calls: SchemaCall[] = [];
/** Stored schema per class, as `Parse.Schema.get()` would answer. */
let stored: Record<string, Record<string, {type?: string; required?: boolean}>> = {};
/** How many rows hold a value for a field — `Query.count()`'s answer. */
let rowsWithField: Record<string, number> = {};

before(async () => {
  installParseTestGlobal();

  // The models must be loaded before anything below runs: the reconciliation
  // iterates the registered classes and reads each one's declared fields from
  // decorator metadata. Without this the loop has nothing to walk and every
  // assertion below passes for the wrong reason.
  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  await import('../src/cloudCode/models/BatchResource');

  const Parse = parseSdk() as unknown as Record<string, unknown>;

  // A `Parse.Schema` that records rather than talks to a database.
  class FakeSchema {
    private call: SchemaCall;
    constructor(className: string) {
      this.call = {className, deleted: [], updated: false};
      calls.push(this.call);
    }
    async get(options: {useMasterKey: boolean}) {
      assert.equal(options.useMasterKey, true, 'schema reads must use the master key');
      const fields = stored[this.call.className];
      if (!fields) throw new Error('Class does not exist');
      return {fields};
    }
    deleteField(name: string) {
      this.call.deleted.push(name);
      return this;
    }
    async update(options: {useMasterKey: boolean}) {
      assert.equal(options.useMasterKey, true, 'schema writes must use the master key');
      this.call.updated = true;
      return {};
    }
  }
  Parse['Schema'] = FakeSchema;

  // A `Parse.Query` that answers only `exists(field).count()`.
  const RealQuery = Parse['Query'] as new (className: string) => unknown;
  class FakeQuery {
    private className: string;
    private field = '';
    constructor(className: string) {
      this.className = className;
    }
    exists(field: string) {
      this.field = field;
      return this;
    }
    async count(options: {useMasterKey: boolean}) {
      assert.equal(options.useMasterKey, true, 'the data check must use the master key');
      return rowsWithField[`${this.className}.${this.field}`] ?? 0;
    }
  }
  Parse['Query'] = FakeQuery;
  void RealQuery;

  drift = await import('../src/cloudCode/startup/schemaDrift');
});

after(() => clearTrackedIntervals());

function reset(): void {
  calls = [];
  stored = {};
  rowsWithField = {};
}

describe('reconciling a stored schema', () => {
  test('removes a required field no model declares and no row uses', async () => {
    // This is the exact shape of the real failure.
    reset();
    stored['BatchResource'] = {
      objectId: {type: 'String'},
      title: {type: 'String', required: true},
      storageKey: {type: 'String', required: true},
      file: {type: 'File', required: true},
    };

    const removed = await drift.reconcileSchemaDrift();

    assert.equal(removed, 1);
    const call = calls.find(entry => entry.className === 'BatchResource' && entry.updated);
    assert.ok(call, 'the schema must have been updated');
    assert.deepEqual(call!.deleted, ['file']);
  });

  test('refuses to boot when the stale field still holds data', async () => {
    // Deleting a column somebody's data lives in is a decision for a person.
    reset();
    stored['BatchResource'] = {
      title: {type: 'String', required: true},
      legacyNotes: {type: 'String', required: true},
    };
    rowsWithField['BatchResource.legacyNotes'] = 3;

    await assert.rejects(
      () => drift.reconcileSchemaDrift(),
      (error: unknown) => {
        assert.ok(error instanceof drift.SchemaDriftError);
        assert.equal(error.code, drift.SchemaDriftCode.REQUIRED_FIELD_HAS_DATA);
        assert.equal(error.className, 'BatchResource');
        assert.equal(error.fieldName, 'legacyNotes');
        return true;
      }
    );

    // And it removed nothing on the way to refusing.
    assert.deepEqual(
      calls.flatMap(entry => entry.deleted),
      []
    );
  });

  test('leaves a stale field alone when it is not required', async () => {
    // Only a required leftover makes a class unwritable. An optional one is
    // untidy, and tidying is not this step's job.
    reset();
    stored['BatchResource'] = {
      title: {type: 'String', required: true},
      oldOptional: {type: 'String', required: false},
    };

    assert.equal(await drift.reconcileSchemaDrift(), 0);
    assert.deepEqual(
      calls.flatMap(entry => entry.deleted),
      []
    );
  });

  test('never touches a field the model still declares', async () => {
    reset();
    stored['BatchResource'] = {
      title: {type: 'String', required: true},
      storageKey: {type: 'String', required: true},
      fileSize: {type: 'Number', required: true},
    };

    assert.equal(await drift.reconcileSchemaDrift(), 0);
  });

  test('never touches the fields Parse maintains itself', async () => {
    // `createdAt` and friends are required in every stored schema and are
    // declared by no model. Treating them as drift would delete the class.
    reset();
    stored['BatchResource'] = {
      objectId: {type: 'String', required: true},
      createdAt: {type: 'Date', required: true},
      updatedAt: {type: 'Date', required: true},
      ACL: {type: 'ACL', required: true},
      title: {type: 'String', required: true},
    };

    assert.equal(await drift.reconcileSchemaDrift(), 0);
    assert.deepEqual(
      calls.flatMap(entry => entry.deleted),
      []
    );
  });

  test('a class that does not exist yet is not drift', async () => {
    // The normal first boot: nothing stored, nothing to reconcile, no throw.
    reset();
    assert.equal(await drift.reconcileSchemaDrift(), 0);
  });

  test('a count that cannot be taken is treated as "there might be data"', async () => {
    // Deleting a column on the strength of a failed query is exactly the wrong
    // way to be wrong.
    reset();
    stored['BatchResource'] = {ghost: {type: 'String', required: true}};

    const Parse = parseSdk() as unknown as Record<string, unknown>;
    const working = Parse['Query'];
    class FailingQuery {
      exists() {
        return this;
      }
      async count() {
        throw new Error('count failed');
      }
    }
    Parse['Query'] = FailingQuery;

    await assert.rejects(
      () => drift.reconcileSchemaDrift(),
      (error: unknown) =>
        error instanceof drift.SchemaDriftError &&
        error.code === drift.SchemaDriftCode.REQUIRED_FIELD_HAS_DATA
    );

    Parse['Query'] = working;
  });
});

describe('what an operator is told', () => {
  test('the guidance names the class and the field', () => {
    const message = drift.schemaDriftGuidance(
      new drift.SchemaDriftError(
        drift.SchemaDriftCode.REQUIRED_FIELD_HAS_DATA,
        'BatchResource',
        'file'
      )
    );
    assert.match(message, /BatchResource\.file/);
    assert.match(message, /required/);
    // Without a remedy it is a complaint, not guidance.
    assert.match(message, /remove the column|restart/);
  });

  test('a repair failure says what to check', () => {
    const message = drift.schemaDriftGuidance(
      new drift.SchemaDriftError(drift.SchemaDriftCode.REPAIR_FAILED, 'BatchResource', 'file')
    );
    assert.match(message, /master key|writable/);
  });

  test('the error message carries the code and the identity, and nothing else', () => {
    // It is what gets logged, so it must not grow a driver message.
    const error = new drift.SchemaDriftError(
      drift.SchemaDriftCode.REPAIR_FAILED,
      'BatchResource',
      'file'
    );
    assert.equal(error.message, 'SCHEMA_REPAIR_FAILED (BatchResource.file)');
  });
});
