/**
 * The Batch Resource surface ⟨CP5⟩: registered operations, the model's access
 * rules, the two DTOs, the logging allow-list, the metadata rules, and the
 * binary route's promises.
 *
 * The route is asserted against its **source**, deliberately. Its guarantees are
 * header decisions and an ordering of two writes — properties of the code as
 * written, not of a value it returns. A test that mocked Express and multer to
 * observe them would mostly be asserting that the mock matches the real thing.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let buildParseLogLine: typeof import('../src/cloudCode/utils/logging/safeLogger').buildParseLogLine;

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'create-project.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repository root not found');
}

const REPO_ROOT = findRepoRoot();
const MODULE_DIR = join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchResource');

function moduleSource(name: string): string {
  return readFileSync(join(MODULE_DIR, `${name}.ts`), 'utf8');
}

/**
 * The same source with its comments removed.
 *
 * These files explain at length what they deliberately do *not* do — "there is
 * no inline mode, no preview endpoint" — so a check for the word `preview`
 * against the whole file finds the sentence promising it is absent. Only the
 * code is scanned when the question is what the code does.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('*/')
      );
    })
    .join('\n');
}

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let dto: typeof import('../src/cloudCode/modules/BatchResource/dto');
let logging: typeof import('../src/cloudCode/modules/BatchResource/logging');
let constants: typeof import('../src/cloudCode/modules/BatchResource/constants');
let errors: typeof import('../src/cloudCode/modules/BatchResource/errors');
let validation: typeof import('../src/cloudCode/modules/BatchResource/validation');
let storage: typeof import('../src/cloudCode/modules/BatchResource/storage');
let route: typeof import('../src/cloudCode/modules/BatchResource/resourceRoute');
let schema: {
  className: string;
  fields: Record<string, unknown>;
  compoundIndexes?: {fields: string[]; unique?: boolean; name?: string}[];
  classLevelPermissions?: {
    ACL?: Record<string, {read?: boolean; write?: boolean}>;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
};

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  const model = (await import('../src/cloudCode/models/BatchResource')).default;
  await import('../src/cloudCode/modules/BatchResource/functions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/BatchResource/dto');
  logging = await import('../src/cloudCode/modules/BatchResource/logging');
  constants = await import('../src/cloudCode/modules/BatchResource/constants');
  errors = await import('../src/cloudCode/modules/BatchResource/errors');
  validation = await import('../src/cloudCode/modules/BatchResource/validation');
  storage = await import('../src/cloudCode/modules/BatchResource/storage');
  route = await import('../src/cloudCode/modules/BatchResource/resourceRoute');
  buildParseLogLine = (await import('../src/cloudCode/utils/logging/safeLogger')).buildParseLogLine;

  const decorators = await import('@90soft/parse-server-kit');
  schema = (
    decorators as unknown as {getSchemaDefinition: (target: unknown) => typeof schema}
  ).getSchemaDefinition(model);
});

after(() => clearTrackedIntervals());

/**
 * A stand-in Resource row, so the DTOs can be exercised without a database.
 *
 * Built through `fromJSON`, which is how a real query result is assembled, so
 * `createdAt` and the pointers behave exactly as they do in production rather
 * than as a hand-set attribute would.
 */
function fakeResource(overrides: Record<string, unknown> = {}): Parse.Object {
  const Parse = parseSdk();
  const object = Parse.Object.fromJSON({
    className: 'BatchResource',
    objectId: 'resource-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    title: 'Week one reading',
    description: 'The first chapter',
    filename: 'week-1.pdf',
    extension: '.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    displayOrder: 0,
    storageKey: 'resource_deadbeefdeadbeefdeadbeefdeadbeef',
    batch: {__type: 'Pointer', className: 'Batch', objectId: 'batch-1'},
    uploadedBy: {__type: 'Pointer', className: '_User', objectId: 'admin-1'},
  });
  for (const [key, value] of Object.entries(overrides)) object.set(key, value);
  return object;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('registered operations', () => {
  test('are exactly the five the checkpoint calls for', () => {
    const names = registry
      .getFunctions()
      .map(fn => fn.name)
      .sort();
    assert.deepEqual(names, [
      'deleteBatchResource',
      'listBatchResources',
      'listMyBatchResources',
      'reorderBatchResources',
      'updateBatchResource',
    ]);
  });

  test('every one of them requires a session', () => {
    for (const fn of registry.getFunctions()) {
      assert.equal(fn.config.validation?.requireUser, true, `${fn.name} must require a user`);
    }
  });

  test('no cloud function accepts file bytes, in either direction', () => {
    // Parse Server logs every cloud-function call with its serialised input and
    // result. A base64 document in a parameter is a document in the log — which
    // is exactly what happened to a profile photograph in Checkpoint 3A.
    for (const fn of registry.getFunctions()) {
      const fields = Object.keys(fn.config.validation?.fields ?? {}).map(name =>
        name.toLowerCase()
      );
      for (const forbidden of ['data', 'file', 'bytes', 'buffer', 'base64', 'content', 'blob']) {
        assert.ok(!fields.includes(forbidden), `${fn.name} must not declare ${forbidden}`);
      }
    }
  });

  test('no operation accepts a storage key', () => {
    // The key addresses the bytes directly. A caller that could name one could
    // ask for somebody else's file.
    for (const fn of registry.getFunctions()) {
      const fields = Object.keys(fn.config.validation?.fields ?? {});
      assert.ok(!fields.includes('storageKey'), `${fn.name} must not accept a storage key`);
    }
  });

  test('the Student operation is scoped to the caller by name', () => {
    // There is no `listStudentResources(studentId)`. The one Student-facing
    // operation says whose Resources it returns in its name.
    const studentFunctions = registry
      .getFunctions()
      .filter(fn => fn.name.toLowerCase().includes('my'));
    assert.deepEqual(studentFunctions.map(fn => fn.name), ['listMyBatchResources']);
  });

  test('no generic CRUD operation exists', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'getresource',
      'createresource',
      'saveresource',
      'searchresources',
      'listresources',
      'listallresources',
      // Replacement, previewing, and analytics are all explicitly out of scope.
      'replaceresource',
      'previewresource',
      'renderresource',
      'resourceurl',
      'getresourceurl',
      'trackresourcedownload',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  test('nothing from a later checkpoint was added along the way', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const future of ['slide', 'task', 'submission', 'pinned', 'reel', 'comment', 'progress']) {
      assert.ok(!names.some(name => name.includes(future)), `${future} is a later checkpoint`);
    }
  });
});

describe('model access rules', () => {
  test('every class-level operation is denied', () => {
    const clp = schema.classLevelPermissions!;
    for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[operation], {}, `${operation} must grant nobody`);
    }
  });

  test('the default object ACL grants nobody', () => {
    assert.deepEqual(schema.classLevelPermissions!.ACL ?? {}, {});
  });

  test('the storage key is protected from both audiences', () => {
    const protectedFields = schema.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      assert.ok(
        protectedFields[audience].includes('storageKey'),
        `storageKey must be hidden from '${audience}'`
      );
    }
  });

  test('so is every other column', () => {
    // Not just the sensitive-looking ones. A query that reached this class reads
    // an empty shell.
    const protectedFields = schema.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of Object.keys(schema.fields)) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('the stored columns are exactly the approved fields', () => {
    assert.deepEqual(Object.keys(schema.fields).sort(), [
      'batch',
      'description',
      'displayOrder',
      'extension',
      'fileSize',
      'filename',
      'mimeType',
      'storageKey',
      'title',
      'uploadedBy',
    ]);
  });

  test('no column exists for a feature that was ruled out', () => {
    const declared = Object.keys(schema.fields).map(name => name.toLowerCase());
    for (const forbidden of [
      'folder',
      'tag',
      'tags',
      'category',
      'comment',
      'comments',
      'rating',
      'progress',
      'downloadcount',
      'views',
      'url',
      'link',
      'ispublic',
      'public',
      'metadata',
      'data',
    ]) {
      assert.ok(!declared.includes(forbidden), `${forbidden} must not be stored`);
    }
  });

  test('the bytes are not stored on the row', () => {
    // A 20 MiB document inline would be loaded whole on every read of the row,
    // including reads that only wanted the title.
    for (const [name, column] of Object.entries(schema.fields)) {
      const type = (column as {type?: string}).type;
      assert.ok(type !== 'File', `${name} must not be a File column`);
      assert.ok(type !== 'Bytes', `${name} must not be a Bytes column`);
    }
  });

  test('a Resource belongs to exactly one Batch, by pointer', () => {
    const batch = schema.fields['batch'] as {type?: string; targetClass?: string};
    assert.equal(batch.type, 'Pointer');
    assert.equal(batch.targetClass, 'Batch');
  });

  test('the list query is indexed on the pointer column, not the logical name', () => {
    // `_p_batch` is the column a Parse Pointer actually occupies. Indexing
    // `batch` would create an index on a column that does not exist — which
    // succeeds silently and helps nothing.
    const index = (schema.compoundIndexes ?? []).find(entry =>
      entry.fields.includes('_p_batch')
    );
    assert.ok(index, 'the batch/displayOrder index must exist');
    assert.deepEqual(index!.fields, ['_p_batch', 'displayOrder']);
  });

  test('two rows cannot share a storage key', () => {
    // They would mean deleting one destroys the other's bytes.
    const index = (schema.compoundIndexes ?? []).find(entry =>
      entry.fields.includes('storageKey')
    );
    assert.ok(index, 'a unique index on the storage key must exist');
    assert.equal(index!.unique, true);
  });

  test('the file fields are frozen after creation, so there is no replacement', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'models', 'BatchResource.ts'),
      'utf8'
    );
    for (const immutable of [
      'batch',
      'storageKey',
      'filename',
      'extension',
      'mimeType',
      'fileSize',
      'uploadedBy',
    ]) {
      assert.match(source, new RegExp(`'${immutable}'`), `${immutable} must be listed as immutable`);
    }
    assert.match(source, /object\.dirty\(immutable\)/);
  });

  test('the trigger refuses a write that is not the server', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'models', 'BatchResource.ts'),
      'utf8'
    );
    assert.match(source, /if \(!request\.master\)/);
    assert.match(source, /object\.setACL\(new Parse\.ACL\(\)\)/);
  });
});

describe('the DTOs a browser receives', () => {
  test('the Admin DTO carries no storage key and no URL of any kind', () => {
    const keys = Object.keys(dto.toResourceDto(fakeResource()));
    for (const forbidden of dto.FORBIDDEN_RESOURCE_DTO_KEYS) {
      assert.ok(!keys.includes(forbidden), `${forbidden} must not be in the Admin DTO`);
    }
  });

  test('the Admin DTO is exactly the approved shape', () => {
    assert.deepEqual(Object.keys(dto.toResourceDto(fakeResource())).sort(), [
      'createdAt',
      'description',
      'displayOrder',
      'extension',
      'fileSize',
      'filename',
      'id',
      'kind',
      'title',
      'updatedAt',
    ]);
  });

  test('the Student DTO does not name the Admin who uploaded the file', () => {
    const keys = Object.keys(dto.toStudentResourceDto(fakeResource()));
    for (const forbidden of dto.FORBIDDEN_RESOURCE_DTO_KEYS) {
      assert.ok(!keys.includes(forbidden), `${forbidden} must not be in the Student DTO`);
    }
    assert.ok(!keys.includes('uploadedBy'));
    // A Student reads the list in the order it arrives; neither of these means
    // anything to them.
    assert.ok(!keys.includes('displayOrder'));
    assert.ok(!keys.includes('updatedAt'));
  });

  test('the Student DTO is exactly the approved shape', () => {
    assert.deepEqual(Object.keys(dto.toStudentResourceDto(fakeResource())).sort(), [
      'createdAt',
      'description',
      'extension',
      'fileSize',
      'filename',
      'id',
      'kind',
      'title',
    ]);
  });

  test('neither DTO is built by spreading the Parse object', () => {
    // A hand-built allow-list is the point: a column added to the model later
    // cannot appear in a response by accident.
    const source = moduleSource('dto');
    assert.ok(!source.includes('...resource'), 'nothing may be spread from the row');
    assert.ok(!source.includes('.toJSON()'), 'toJSON would carry every column');
    assert.ok(!source.includes('.attributes'), 'attributes would carry every column');
  });

  test('an absent description is omitted rather than sent as an empty string', () => {
    const dtoWithout = dto.toResourceDto(fakeResource({description: '   '}));
    assert.ok(!('description' in dtoWithout));
  });

  test('the upload rules the browser is told match the ones enforced', () => {
    // A hint that disagrees with the server is worse than no hint: it teaches
    // people to distrust the one they are shown.
    const rules = dto.uploadRules();
    assert.equal(rules.maxBytes, constants.RESOURCE_MAX_BYTES);
    assert.deepEqual([...rules.extensions], [...constants.RESOURCE_EXTENSIONS]);
  });
});

describe('the logging allow-list', () => {
  test('drops everything it does not name', () => {
    const safe = logging.toSafeResourceFields({
      op: 'uploadResource',
      userId: 'user-1',
      batchId: 'batch-1',
      bytes: 2048,
      // None of these may survive.
      storageKey: 'resource_deadbeef',
      filename: 'offer-letter-lina-haddad.pdf',
      title: 'Week one reading',
      description: 'The first chapter',
      email: 'student@example.com',
      sessionToken: 'r:abc',
      buffer: Buffer.from('%PDF'),
      url: 'https://example.com/file',
    });

    assert.deepEqual(safe, {op: 'uploadResource', userId: 'user-1', batchId: 'batch-1', bytes: 2048});
  });

  test('the failure reason is diagnostic, redacted, and server-only ⟨CP5⟩', () => {
    // A failure that logs only `RESOURCE_UPLOAD_FAILED` is a failure nobody can
    // diagnose. The reason is written to the log — and only to the log; the
    // caller still gets the stable code and nothing else.
    const duplicate = Object.assign(
      new Error(
        'E11000 duplicate key error collection: cyf.BatchResource ' +
          'index: batch_resource_storage_key_unique dup key: ' +
          '{ storageKey: "resource_deadbeefdeadbeefdeadbeefdeadbeef" }'
      ),
      {code: 11000}
    );

    const described = logging.describeFailure(duplicate);
    assert.equal(described.parseCode, 11000);
    assert.ok(described.reason?.includes('E11000'), 'the reason must be useful');
    assert.ok((described.reason?.length ?? 0) <= 300, 'a driver can throw a page');

    // Whatever the driver quoted back, the storage key does not survive the
    // redaction boundary the log writes through.
    const line = buildParseLogLine('error', 'Creating a resource row failed', {
      op: 'createResource',
      ...described,
    });
    assert.ok(
      !line.includes('resource_deadbeefdeadbeefdeadbeefdeadbeef'),
      `the storage key leaked through a failure reason: ${line}`
    );
    assert.ok(line.includes('11000'), 'the code stays diagnosable');
  });

  test('describeFailure handles something that is not an Error', () => {
    assert.deepEqual(logging.describeFailure(undefined), {});
    assert.equal(logging.describeFailure('plain string').reason, 'plain string');
  });

  test('names no field that could carry content or a name', () => {
    for (const forbidden of [
      'filename',
      'title',
      'description',
      'storageKey',
      'url',
      'data',
      'buffer',
      'preview',
      'sample',
      'email',
      'fullName',
    ]) {
      assert.ok(
        !logging.ALLOWED_RESOURCE_LOG_FIELDS.includes(forbidden),
        `${forbidden} must not be loggable`
      );
    }
  });

  test('a byte count is allowed; a byte sample is not', () => {
    assert.ok(logging.ALLOWED_RESOURCE_LOG_FIELDS.includes('bytes'));
    const safe = logging.toSafeResourceFields({bytes: Buffer.from('%PDF-1.7')});
    // Only a number survives, so `bytes` can never become a document.
    assert.deepEqual(safe, {});
  });

  test('no operation passes a filename or a title to a log', () => {
    for (const name of ['functions', 'resourceRoute', 'storage', 'access']) {
      const source = moduleSource(name);
      for (const forbidden of ['filename:', 'title:', 'storageKey:', 'description:']) {
        const inLogCall = new RegExp(`resourceLog\\.[a-z]+\\([^)]*${forbidden}`, 's');
        assert.ok(!inLogCall.test(source), `${name}.ts logs ${forbidden}`);
      }
    }
  });
});

describe('failure codes', () => {
  test('are exactly the eight the checkpoint specifies', () => {
    assert.deepEqual([...errors.RESOURCE_ERROR_CODES].sort(), [
      'RESOURCE_ACCESS_DENIED',
      'RESOURCE_DELETE_FAILED',
      'RESOURCE_EMPTY',
      'RESOURCE_NOT_FOUND',
      'RESOURCE_TOO_LARGE',
      'RESOURCE_TYPE_NOT_ALLOWED',
      'RESOURCE_UPLOAD_FAILED',
      'RESOURCE_VALIDATION_FAILED',
    ]);
  });

  test('a raised error carries the code and nothing a driver said', () => {
    const raised = errors.resourceError(errors.ResourceError.RESOURCE_NOT_FOUND);
    assert.equal(raised.message, 'RESOURCE_NOT_FOUND');
  });

  test('a validation failure carries field names and reasons, never values', () => {
    const raised = errors.resourceError(errors.ResourceError.RESOURCE_VALIDATION_FAILED, {
      title: 'TOO_LONG',
    });
    assert.equal(raised.message, 'RESOURCE_VALIDATION_FAILED:{"title":"TOO_LONG"}');
  });
});

describe('metadata rules', () => {
  test('a title is required, and whitespace is not a title', () => {
    assert.equal(validation.validateResourceMetadata({title: '   '}).errors['title'], 'REQUIRED');
  });

  test('a title that is too short or too long is rejected by name, not by value', () => {
    const short = validation.validateResourceMetadata({title: 'a'});
    assert.equal(short.errors['title'], 'TOO_SHORT');

    const long = validation.validateResourceMetadata({
      title: 'a'.repeat(constants.RESOURCE_LIMITS.title.max + 1),
    });
    assert.equal(long.errors['title'], 'TOO_LONG');
    // The offending text is not echoed anywhere in the reason.
    assert.ok(!JSON.stringify(long.errors).includes('aaaa'));
  });

  test('a title at either boundary is accepted', () => {
    for (const length of [constants.RESOURCE_LIMITS.title.min, constants.RESOURCE_LIMITS.title.max]) {
      const result = validation.validateResourceMetadata({title: 'a'.repeat(length)});
      assert.deepEqual(result.errors, {});
    }
  });

  test('a description is optional and bounded', () => {
    assert.deepEqual(validation.validateResourceMetadata({title: 'Week one'}).errors, {});
    const long = validation.validateResourceMetadata({
      title: 'Week one',
      description: 'a'.repeat(constants.RESOURCE_LIMITS.description.max + 1),
    });
    assert.equal(long.errors['description'], 'TOO_LONG');
  });

  test('a privileged field is reported rather than quietly ignored', () => {
    // A request sending `storageKey` deserves to learn it was refused, instead
    // of believing it worked.
    const found = validation.findPrivilegedResourceFields({
      title: 'Week one',
      storageKey: 'resource_deadbeef',
      uploadedBy: 'someone',
      fileSize: 1,
    });
    assert.deepEqual(found.sort(), ['fileSize', 'storageKey', 'uploadedBy']);
  });

  test('an ordinary edit reports nothing privileged', () => {
    assert.deepEqual(
      validation.findPrivilegedResourceFields({
        resourceId: 'resource-1',
        title: 'Week one',
        description: 'Chapter 1',
      }),
      []
    );
  });

  test('a reorder list must be a real list, and a bounded one', () => {
    assert.equal(validation.parseOrderedIds(undefined), undefined);
    assert.equal(validation.parseOrderedIds('a,b,c'), undefined);
    assert.equal(validation.parseOrderedIds([]), undefined);
    assert.equal(
      validation.parseOrderedIds(new Array(constants.REORDER_MAX_ITEMS + 1).fill('id')),
      undefined
    );
    assert.deepEqual(validation.parseOrderedIds([' a ', 'b']), ['a', 'b']);
  });

  test('a reorder list drops entries that are not usable ids', () => {
    assert.deepEqual(validation.parseOrderedIds(['a', 42, null, {}, 'b']), ['a', 'b']);
    assert.equal(validation.parseOrderedIds(['x'.repeat(65)]), undefined);
  });
});

describe('storage keys', () => {
  test('are random, prefixed, and long enough not to be guessed', () => {
    const key = storage.newStorageKey();
    assert.ok(key.startsWith(constants.STORAGE_KEY_PREFIX));
    assert.equal(
      key.length,
      constants.STORAGE_KEY_PREFIX.length + constants.STORAGE_KEY_BYTES * 2
    );
    assert.match(key, /^resource_[0-9a-f]{32}$/);
  });

  test('two keys are never the same', () => {
    const keys = new Set(Array.from({length: 200}, () => storage.newStorageKey()));
    assert.equal(keys.size, 200);
  });

  test('a key encodes nothing about the file, the Batch, or the uploader', () => {
    // A key that encodes anything is a key that leaks it.
    const source = moduleSource('storage');
    assert.match(source, /randomBytes\(STORAGE_KEY_BYTES\)/);
    assert.ok(!/newStorageKey\([^)]+\)/.test(source), 'the generator takes no input');
  });

  test('storage is unusable until an adapter is wired, and says so rather than guessing', () => {
    // Nothing has been wired in this process, which is the point: the module
    // refuses to invent a fallback.
    assert.equal(storage.storageIsUsable(), false);
  });

  test('a missing binary on delete is success, not a failure', () => {
    // A second delete of an already-deleted Resource is ordinary: a retried
    // request, a cleanup after a half-finished upload.
    const source = moduleSource('storage');
    assert.match(source, /message\.includes\('FileNotFound'\)/);
  });
});

describe('the binary route', () => {
  const source = () => readFileSync(join(MODULE_DIR, 'resourceRoute.ts'), 'utf8');

  test('every download is an attachment, including HTML', () => {
    // An uploaded `.html` served inline would run its own script in this
    // application's origin, with the reader's session in scope.
    assert.match(source(), /Content-Disposition/);
    assert.match(route.contentDisposition('week-1.pdf'), /^attachment;/);
  });

  test('there is no inline mode and no parameter that creates one', () => {
    const code = codeOnly(source());
    assert.ok(!code.includes('inline'), 'no inline disposition');
    assert.ok(!/preview/i.test(code), 'no preview path');
    assert.ok(!/render/i.test(code), 'no render path');
    // And nothing reads a query parameter that could switch behaviour.
    assert.ok(!code.includes('req.query'), 'no query parameter changes a download');
  });

  test('the browser is told not to second-guess the type', () => {
    assert.match(source(), /X-Content-Type-Options'?,\s*'nosniff'/);
  });

  test('a download is private and uncached, and sandboxed if anything renders it', () => {
    const text = source();
    assert.match(text, /Cache-Control'?,\s*'private, no-store'/);
    assert.match(text, /default-src 'none'; sandbox/);
  });

  test('the disposition survives an Arabic filename without breaking the header', () => {
    const value = route.contentDisposition('الأسبوع-الأول.pdf');
    assert.match(value, /^attachment; filename="/);
    assert.match(value, /filename\*=UTF-8''/);
    // The plain parameter is ASCII-only, so the real name travels in `filename*`.
    assert.ok(!value.includes('\r') && !value.includes('\n'));
    assert.ok(value.includes(encodeURIComponent('الأسبوع-الأول.pdf')));
  });

  test('a filename cannot terminate the header parameter', () => {
    const value = route.contentDisposition('week"1.pdf');
    assert.equal((value.match(/"/g) ?? []).length, 2, 'exactly the two delimiting quotes');
  });

  test('the 20 MiB limit is applied at the socket, not after buffering', () => {
    assert.match(source(), /limits:\s*\{fileSize: RESOURCE_MAX_BYTES/);
    assert.match(source(), /files: 1/);
  });

  test('an oversized upload gets its own status, so the UI can explain it', () => {
    assert.match(source(), /LIMIT_FILE_SIZE/);
    assert.match(source(), /413, ResourceError\.RESOURCE_TOO_LARGE/);
  });

  test('a multer failure is never echoed back to the caller', () => {
    // The message names somebody's file. Only a stable code leaves.
    const text = source();
    assert.ok(!/error\.message/.test(text), 'no driver message is echoed');
  });

  test('the bytes are stored before the row, and cleaned up if the row fails', () => {
    const text = source();
    const store = text.indexOf('storeBinary(');
    const create = text.indexOf('createResource(');
    assert.ok(store > 0 && create > store, 'bytes must be stored first');
    // Every failure path after the bytes landed removes them again.
    assert.equal((text.match(/removeBinaryQuietly\(storageKey\)/g) ?? []).length, 2);
  });

  test('deleting goes the other way: the row first, then the bytes', () => {
    // A row pointing at bytes that are not there is a broken Resource people can
    // see and click. Bytes with no row are invisible and reclaimable.
    const text = moduleSource('functions');
    const row = text.indexOf('deleteResourceRow(');
    const bytes = text.indexOf('removeBinary(storageKey)');
    assert.ok(row > 0 && bytes > row, 'the row must be deleted first');
  });

  test('the Batch is read from the Resource, never from what the caller sent', () => {
    // A request naming both a Resource and a Batch invites the two to disagree,
    // and the caller chooses which.
    assert.match(source(), /const batch = batchOf\(resource\)/);
  });

  test('a Resource the caller may not read answers 404, not 403', () => {
    // "You may not have this" confirms it exists.
    assert.match(source(), /404, ResourceError\.RESOURCE_NOT_FOUND/);
  });

  test('neither path is reachable without a session', () => {
    const text = source();
    assert.equal((text.match(/requireUser\(req, res\)/g) ?? []).length, 2);
    assert.match(text, /resolveSessionUser\(req\)/);
  });

  test('no public URL is ever produced', () => {
    const text = source();
    for (const forbidden of ['publicUrl', 'getFileUrl', 'fileUrl', 'signedUrl', 'presigned']) {
      assert.ok(!text.includes(forbidden), `${forbidden} must not appear`);
    }
  });

  test('the storage key never reaches a response', () => {
    const text = source();
    assert.ok(!/json\([^)]*storageKey/.test(text), 'no response carries the key');
    assert.ok(!/setHeader\([^)]*storageKey/.test(text), 'no header carries the key');
  });

  test('the paths do not reopen Parse raw file routes', () => {
    assert.equal(route.RESOURCE_UPLOAD_PATH, '/batch-resource');
    assert.equal(route.RESOURCE_DOWNLOAD_PATH, '/batch-resource/:resourceId');
    for (const path of [route.RESOURCE_UPLOAD_PATH, route.RESOURCE_DOWNLOAD_PATH]) {
      assert.ok(!path.includes('files'), `${path} must not look like a file route`);
    }
  });
});

describe('who is allowed what', () => {
  const source = () => moduleSource('access');

  test('roles are read live from the database, never from the request', () => {
    assert.match(source(), /getUserRoles\(user\)/);
    const text = source();
    assert.ok(!/params\[/.test(text), 'nothing about a role comes from the caller');
  });

  test('a Student needs a live enrollment, not an invitation', () => {
    // Being invited is permission to join, not permission to read.
    assert.match(source(), /findEnrollment\(batchId, viewer\.user\)/);
    assert.ok(!source().includes('Invitation'), 'an invitation grants nothing here');
  });

  test('a Visitor is refused before any query runs', () => {
    assert.match(source(), /if \(!viewer\.isStudent\) return false/);
  });

  test('an archived Batch is read-only, and says so plainly', () => {
    // The Admin can already see the Batch, so its existence is not the secret —
    // only the action is refused, and saying why is what lets the UI explain it.
    const text = source();
    assert.match(text, /isReadOnlyStatus\(status\)/);
    assert.match(text, /RESOURCE_ACCESS_DENIED/);
  });

  test('a refused read answers not-found, so ids cannot be probed', () => {
    assert.match(source(), /throw resourceError\(ResourceError\.RESOURCE_NOT_FOUND\)/);
  });

  test('every write path goes through the same check', () => {
    const text = moduleSource('functions');
    assert.equal((text.match(/requireWriteAccess\(/g) ?? []).length, 3);
    // Plus the upload, which is on the binary route.
    assert.match(moduleSource('resourceRoute'), /requireWriteAccess\(viewer/);
  });

  test('listing works on an archived Batch, and says it is read-only', () => {
    // Archived is read-only, not invisible: a cohort that finished does not lose
    // the material it was given.
    assert.match(moduleSource('functions'), /readOnly: Boolean\(batch\.get\('status'\) === 'archived'\)/);
  });
});
