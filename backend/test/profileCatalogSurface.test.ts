/**
 * The profile catalog surface: the registered operations, the model's access
 * rules, the safe DTO, the logging allow-list, and the shared constants.
 *
 * The load-bearing check is that this is a **closed, typed catalog** and not a
 * generic key/value store. Four categories, no class name in any signature, no
 * arbitrary query, and no configuration or secret anywhere near it — if any of
 * that drifts, this file fails.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

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

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let dto: typeof import('../src/cloudCode/modules/ProfileCatalog/dto');
let logging: typeof import('../src/cloudCode/modules/ProfileCatalog/logging');
let constants: typeof import('../src/cloudCode/modules/ProfileCatalog/constants');
let errors: typeof import('../src/cloudCode/modules/ProfileCatalog/errors');
let validation: typeof import('../src/cloudCode/modules/ProfileCatalog/validation');
let schema: {
  className: string;
  fields: Record<string, {type?: string; targetClass?: string}>;
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
  await import('../src/cloudCode/models/StudentProfile');
  const model = (await import('../src/cloudCode/models/ProfileCatalogItem')).default;
  await import('../src/cloudCode/modules/ProfileCatalog/functions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/ProfileCatalog/dto');
  logging = await import('../src/cloudCode/modules/ProfileCatalog/logging');
  constants = await import('../src/cloudCode/modules/ProfileCatalog/constants');
  errors = await import('../src/cloudCode/modules/ProfileCatalog/errors');
  validation = await import('../src/cloudCode/modules/ProfileCatalog/validation');

  const decorators = await import('@90soft/parse-server-kit');
  schema = (
    decorators as unknown as {getSchemaDefinition: (target: unknown) => typeof schema}
  ).getSchemaDefinition(model);

  assert.ok(schema, 'the ProfileCatalogItem schema must be discoverable');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('the closed category list', () => {
  test('is exactly four values', () => {
    assert.deepEqual([...constants.CATALOG_TYPES], ['CITY', 'INSTITUTION', 'MAJOR', 'TARGET_ROLE']);
  });

  test('narrows anything else to undefined', () => {
    for (const value of ['city', 'STUDENT', '_User', '', null, undefined, 42, {}]) {
      assert.equal(constants.toCatalogType(value), undefined, `${String(value)} must not resolve`);
    }
  });

  test('only institutions support the Other escape hatch', () => {
    assert.deepEqual([...constants.TYPES_SUPPORTING_OTHER], ['INSTITUTION']);
  });

  test('institution kinds are exactly three values', () => {
    assert.deepEqual([...constants.INSTITUTION_KINDS], ['UNIVERSITY', 'INSTITUTE', 'OTHER']);
  });
});

describe('code normalisation', () => {
  const cases: [string, string][] = [
    ['Damascus University', 'DAMASCUS_UNIVERSITY'],
    ['  damascus   univ.  ', 'DAMASCUS_UNIV'],
    ['Al-Baath', 'AL_BAATH'],
    ['HIAST', 'HIAST'],
    ['___trim___', 'TRIM'],
    ['a1', 'A1'],
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} becomes ${expected}`, () => {
      assert.equal(constants.normaliseCatalogCode(input), expected);
    });
  }

  test('a normalised code always matches the stored pattern', () => {
    for (const [input] of cases) {
      assert.match(constants.normaliseCatalogCode(input), constants.CATALOG_CODE_PATTERN);
    }
  });

  test('two spellings of one name collapse to one code', () => {
    assert.equal(
      constants.normaliseCatalogCode('Damascus University'),
      constants.normaliseCatalogCode('damascus  university')
    );
  });
});

describe('the registered operations', () => {
  test('are exactly the five Admin operations and one Student read', () => {
    const names = registry
      .getFunctions()
      .map(fn => fn.name)
      .filter(name => name.toLowerCase().includes('catalog'))
      .sort();

    assert.deepEqual(names, [
      'createProfileCatalogItem',
      'deleteProfileCatalogItem',
      'getProfileCatalog',
      'listProfileCatalogItems',
      'setProfileCatalogItemActive',
      'updateProfileCatalogItem',
    ]);
  });

  test('every one requires a session', () => {
    for (const fn of registry.getFunctions()) {
      if (!fn.name.toLowerCase().includes('catalog')) continue;
      assert.equal(fn.config.validation?.requireUser, true, `${fn.name} must require a user`);
    }
  });

  test('no operation takes a class name or an arbitrary query', () => {
    for (const fn of registry.getFunctions()) {
      if (!fn.name.toLowerCase().includes('catalog')) continue;
      const fields = Object.keys(fn.config.validation?.fields ?? {});
      for (const forbidden of ['className', 'class', 'where', 'query', 'filter', 'keys']) {
        assert.ok(!fields.includes(forbidden), `${fn.name} declares ${forbidden}`);
      }
    }
  });

  test('there is no generic CRUD name', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'getsettings',
      'savesettings',
      'setappsetting',
      'getconfig',
      'saveconfig',
      'listall',
      'query',
      'find',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  test('the source names no class but its own', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'ProfileCatalog', 'repository.ts'),
      'utf8'
    );
    // StudentProfile appears once, for the reference count that protects a
    // Student's stored answer from a delete.
    const classNames = source.match(/new Parse\.Query\(([^)]+)\)/g) ?? [];
    for (const usage of classNames) {
      assert.ok(
        /CLASS_NAME|'StudentProfile'/.test(usage),
        `unexpected class in a catalog query: ${usage}`
      );
    }
  });
});

describe('the model is deny-by-default', () => {
  const operations = ['find', 'get', 'count', 'create', 'update', 'delete'] as const;

  for (const operation of operations) {
    test(`${operation} grants nobody`, () => {
      const clp = schema.classLevelPermissions as Record<string, unknown>;
      assert.deepEqual(clp[operation], {}, `${operation} must be empty`);
    });
  }

  test('the default object ACL is empty', () => {
    const acl = schema.classLevelPermissions?.ACL ?? {};
    assert.deepEqual(acl, {});
  });

  test('every column is a protected field for the public and for authenticated callers', () => {
    const protectedFields = schema.classLevelPermissions?.protectedFields ?? {};
    const columns = Object.keys(schema.fields);

    for (const audience of ['*', 'authenticated']) {
      const hidden = protectedFields[audience] ?? [];
      for (const column of columns) {
        assert.ok(hidden.includes(column), `${column} must be hidden from ${audience}`);
      }
    }
  });

  test('a code is unique within its category, enforced by the database', () => {
    const index = (schema.compoundIndexes ?? []).find(
      entry => entry.fields.includes('type') && entry.fields.includes('code')
    );
    assert.ok(index, 'a unique (type, code) index must exist');
    assert.equal(index!.unique, true);
  });

  test('the stored columns are exactly the approved fields', () => {
    assert.deepEqual(Object.keys(schema.fields).sort(), [
      'active',
      'code',
      'institutionKind',
      'isOther',
      'nameAr',
      'nameEn',
      'sortOrder',
      'type',
    ]);
  });

  test('this is not a settings store', () => {
    const declared = Object.keys(schema.fields).map(name => name.toLowerCase());
    for (const forbidden of [
      'value',
      'key',
      'setting',
      'settings',
      'config',
      'secret',
      'token',
      'json',
      'data',
      'payload',
    ]) {
      assert.ok(!declared.includes(forbidden), `${forbidden} must not be a catalog column`);
    }
  });

  test('the trigger refuses a client write and freezes the category', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'models', 'ProfileCatalogItem.ts'),
      'utf8'
    );
    assert.match(source, /if \(!request\.master\)/);
    assert.match(source, /object\.dirty\('type'\)/);
    assert.match(source, /getPublicReadAccess\(\) \|\| acl\.getPublicWriteAccess\(\)/);
  });
});

describe('the safe DTO', () => {
  function fakeItem(attrs: Record<string, unknown>): Parse.Object {
    const Parse = parseSdk();
    const object = new Parse.Object('ProfileCatalogItem');
    object.id = 'k1';
    for (const [key, value] of Object.entries(attrs)) object.set(key, value);
    return object;
  }

  test('carries only the allow-listed keys', () => {
    const result = dto.toCatalogItemDto(
      fakeItem({
        type: 'CITY',
        code: 'DAMASCUS',
        nameEn: 'Damascus',
        nameAr: 'دمشق',
        active: true,
        sortOrder: 10,
      })
    );

    assert.deepEqual(Object.keys(result).sort(), [
      'active',
      'code',
      'id',
      'nameAr',
      'nameEn',
      'sortOrder',
      'type',
    ]);
  });

  test('omits every forbidden key', () => {
    const result = dto.toCatalogItemDto(
      fakeItem({type: 'CITY', code: 'X', nameEn: 'X', nameAr: 'س', active: true, sortOrder: 0})
    ) as unknown as Record<string, unknown>;

    for (const forbidden of dto.FORBIDDEN_CATALOG_DTO_KEYS) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
  });

  test('carries the institution kind only for an institution', () => {
    const city = dto.toCatalogItemDto(
      fakeItem({type: 'CITY', code: 'X', nameEn: 'X', nameAr: 'س', active: true, sortOrder: 0})
    );
    assert.equal(city.institutionKind, undefined);

    const institution = dto.toCatalogItemDto(
      fakeItem({
        type: 'INSTITUTION',
        code: 'X',
        nameEn: 'X',
        nameAr: 'س',
        active: true,
        sortOrder: 0,
        institutionKind: 'INSTITUTE',
      })
    );
    assert.equal(institution.institutionKind, 'INSTITUTE');
  });

  test('carries isOther only when it is true', () => {
    const plain = dto.toCatalogItemDto(
      fakeItem({type: 'INSTITUTION', code: 'X', nameEn: 'X', nameAr: 'س', isOther: false})
    );
    assert.equal('isOther' in plain, false);

    const other = dto.toCatalogItemDto(
      fakeItem({type: 'INSTITUTION', code: 'X', nameEn: 'X', nameAr: 'س', isOther: true})
    );
    assert.equal(other.isOther, true);
  });
});

describe('the error contract', () => {
  test('the codes are exactly the five the product defines', () => {
    assert.deepEqual([...errors.CATALOG_ERROR_CODES].sort(), [
      'CATALOG_DUPLICATE',
      'CATALOG_IN_USE',
      'CATALOG_NOT_FOUND',
      'CATALOG_SAVE_FAILED',
      'CATALOG_VALIDATION_FAILED',
    ]);
  });

  test('an error message is the code and nothing else', () => {
    for (const code of errors.CATALOG_ERROR_CODES) {
      const error = errors.catalogError(code);
      assert.equal(error.message, code);
    }
  });

  test('a validation failure carries field names and reason codes only', () => {
    const error = errors.catalogError('CATALOG_VALIDATION_FAILED', {
      nameEn: 'REQUIRED',
      code: 'TOO_SHORT',
    });
    const [prefix, payload] = error.message.split(/:(.+)/);
    assert.equal(prefix, 'CATALOG_VALIDATION_FAILED');

    const fields = JSON.parse(payload) as Record<string, string>;
    for (const reason of Object.values(fields)) {
      // A fixed vocabulary this repository defines — never a submitted value.
      assert.ok(
        ['REQUIRED', 'TOO_SHORT', 'TOO_LONG', 'INVALID', 'NOT_ALLOWED', 'OUT_OF_RANGE', 'WRONG_DOMAIN'].includes(
          reason
        )
      );
    }
  });
});

describe('the logging allow-list', () => {
  test('accepts only its fixed shape', () => {
    const safe = logging.toSafeCatalogFields({
      op: 'createProfileCatalogItem',
      type: 'CITY',
      count: 3,
      // None of these may survive.
      nameEn: 'Damascus',
      search: 'dam',
      item: {className: 'ProfileCatalogItem'},
      ACL: {},
    });

    assert.deepEqual(safe, {op: 'createProfileCatalogItem', type: 'CITY', count: 3});
  });

  test('a search term is never loggable', () => {
    assert.ok(!(logging.ALLOWED_CATALOG_LOG_FIELDS as readonly string[]).includes('search'));
  });

  test('the allowed fields are only operation-shaped metadata', () => {
    assert.deepEqual([...logging.ALLOWED_CATALOG_LOG_FIELDS].sort(), [
      'code',
      'count',
      'fieldCount',
      'itemId',
      'ok',
      'op',
      'stage',
      'type',
      'userId',
    ]);
  });
});

describe('validation is pure and never echoes a value', () => {
  test('rejects a code that is too short', () => {
    const {errors: found} = validation.validateCatalogInput({
      type: 'CITY',
      code: 'A',
      nameEn: 'A',
      nameAr: 'أ',
    });
    assert.equal(found['code'], 'TOO_SHORT');
  });

  test('rejects a sort order that is not an integer', () => {
    for (const sortOrder of ['abc', 1.5, -1, 999999]) {
      const {errors: found} = validation.validateCatalogInput({
        type: 'CITY',
        code: 'HOMS',
        nameEn: 'Homs',
        nameAr: 'حمص',
        sortOrder,
      });
      assert.ok(found['sortOrder'], `${sortOrder} must be refused`);
    }
  });

  test('accepts a sort order at each bound', () => {
    for (const sortOrder of [constants.CATALOG_SORT_ORDER.min, constants.CATALOG_SORT_ORDER.max]) {
      const {errors: found} = validation.validateCatalogInput({
        type: 'CITY',
        code: 'HOMS',
        nameEn: 'Homs',
        nameAr: 'حمص',
        sortOrder,
      });
      assert.equal(found['sortOrder'], undefined);
    }
  });

  test('a new item defaults to active', () => {
    const {values} = validation.validateCatalogInput({
      type: 'CITY',
      code: 'HOMS',
      nameEn: 'Homs',
      nameAr: 'حمص',
    });
    assert.equal(values.active, true);
  });

  test('the category cannot be changed on an edit', () => {
    const {errors: found} = validation.validateCatalogInput(
      {type: 'MAJOR', code: 'HOMS', nameEn: 'Homs', nameAr: 'حمص'},
      'CITY'
    );
    assert.equal(found['type'], 'NOT_ALLOWED');
  });

  test('no rejection ever contains a submitted value', () => {
    const {errors: found} = validation.validateCatalogInput({
      type: 'NOPE',
      code: 'x',
      nameEn: '',
      nameAr: '',
      sortOrder: 'abc',
    });
    const serialised = JSON.stringify(found);
    for (const submitted of ['NOPE', 'abc']) {
      assert.ok(!serialised.includes(submitted), `${submitted} leaked into a rejection`);
    }
  });

  test('a search term is bounded and never used as a pattern', () => {
    const long = 'x'.repeat(500);
    assert.equal(validation.normaliseSearch(long).length, constants.CATALOG_LIMITS.search.max);
    // Regex metacharacters survive as literal text; nothing compiles them.
    assert.equal(validation.normaliseSearch('.*(a|b)'), '.*(a|b)');
  });
});

describe('the backend and the browser share one catalog vocabulary', () => {
  const frontendSource = readFileSync(
    join(REPO_ROOT, 'frontend', 'src', 'app', 'utils', 'profile-catalog-constants.ts'),
    'utf8'
  );

  test('the four categories are identical', () => {
    for (const type of constants.CATALOG_TYPES) {
      assert.ok(frontendSource.includes(`${type}: '${type}'`), `the browser is missing: ${type}`);
    }
  });

  test('the browser declares no fifth category', () => {
    const declared = frontendSource.match(/^\s{2}([A-Z_]+): '\1',$/gm) ?? [];
    assert.equal(declared.length, constants.CATALOG_TYPES.length + constants.INSTITUTION_KINDS.length);
  });

  test('the institution kinds are identical', () => {
    for (const kind of constants.INSTITUTION_KINDS) {
      assert.ok(frontendSource.includes(`${kind}: '${kind}'`), `the browser is missing: ${kind}`);
    }
  });

  test('the code pattern is identical', () => {
    assert.ok(frontendSource.includes(String(constants.CATALOG_CODE_PATTERN)));
  });

  test('the bounds are identical', () => {
    for (const [field, bounds] of Object.entries(constants.CATALOG_LIMITS)) {
      const max = (bounds as {max: number}).max;
      assert.ok(
        new RegExp(`${field}:\\s*\\{[^}]*max:\\s*${max}`).test(frontendSource),
        `${field}.max must match on both sides`
      );
    }
    assert.ok(
      frontendSource.includes(`max: ${constants.CATALOG_SORT_ORDER.max}`),
      'the sort-order bound must match'
    );
  });

  test('the browser normalises a code exactly as the server does', () => {
    // The preview an Admin sees before saving must be what is actually stored.
    const serverSource = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'ProfileCatalog', 'constants.ts'),
      'utf8'
    );
    const steps = [
      ".toUpperCase()",
      ".replace(/[^A-Z0-9]+/g, '_')",
      ".replace(/^_+|_+$/g, '')",
    ];
    for (const step of steps) {
      assert.ok(serverSource.includes(step), `the server is missing: ${step}`);
      assert.ok(frontendSource.includes(step), `the browser is missing: ${step}`);
    }
  });
});
