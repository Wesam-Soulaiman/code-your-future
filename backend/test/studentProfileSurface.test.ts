/**
 * The Student profile surface: registered functions, the model's access rules,
 * the safe DTO, the logging allow-list, and the shared constants.
 *
 * The constants check is the load-bearing one: the backend and the browser each
 * hold a copy, and a drift between them means the form either blocks something
 * the server accepts or promises something it rejects.
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
let dto: typeof import('../src/cloudCode/modules/StudentProfile/dto');
let logging: typeof import('../src/cloudCode/modules/StudentProfile/logging');
let constants: typeof import('../src/cloudCode/modules/StudentProfile/constants');
let syrianPhone: typeof import('../src/cloudCode/modules/StudentProfile/syrianPhone');
let errors: typeof import('../src/cloudCode/modules/StudentProfile/errors');
let schema: {
  className: string;
  fields: Record<string, unknown>;
  compoundIndexes?: {fields: string[]; unique?: boolean}[];
  classLevelPermissions?: {
    ACL?: Record<string, {read?: boolean; write?: boolean}>;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
};

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/File');
  const model = (await import('../src/cloudCode/models/StudentProfile')).default;
  await import('../src/cloudCode/modules/StudentProfile/functions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/StudentProfile/dto');
  logging = await import('../src/cloudCode/modules/StudentProfile/logging');
  constants = await import('../src/cloudCode/modules/StudentProfile/constants');
  syrianPhone = await import('../src/cloudCode/modules/StudentProfile/syrianPhone');
  errors = await import('../src/cloudCode/modules/StudentProfile/errors');

  const decorators = await import('@90soft/parse-server-kit');
  schema = (
    decorators as unknown as {getSchemaDefinition: (target: unknown) => typeof schema}
  ).getSchemaDefinition(model);
});

after(() => clearTrackedIntervals());

describe('registered operations', () => {
  test('are exactly the three focused profile operations', () => {
    // Reading and replacing the photo moved to a dedicated authenticated
    // binary route, so the image bytes never enter Parse's cloud-function
    // pipeline — which is what logged them. Removing a photo has no payload
    // and stays here.
    const names = registry
      .getFunctions()
      .map(fn => fn.name)
      .filter(name => name.toLowerCase().includes('profile'))
      .sort();
    assert.deepEqual(names, [
      'getMyStudentProfile',
      'removeMyProfilePhoto',
      'saveMyStudentProfile',
    ]);
  });

  test('no cloud function accepts an image payload any more', () => {
    for (const fn of registry.getFunctions()) {
      const fields = Object.keys(
        (fn.config as {validation?: {fields?: Record<string, unknown>}}).validation?.fields ?? {}
      );
      for (const field of ['data', 'fileName', 'mimeType']) {
        assert.ok(!fields.includes(field), `${fn.name} still declares ${field}`);
      }
    }
  });

  test('every one requires a session', () => {
    for (const name of ['getMyStudentProfile', 'saveMyStudentProfile', 'removeMyProfilePhoto']) {
      const fn = registry.getFunction(name);
      assert.equal(fn?.config.validation?.requireUser, true, `${name} must require a user`);
    }
  });

  test('the photo route keeps its own bound on an expensive call', () => {
    // It decodes and re-encodes an image, so it is the one expensive path. The
    // limiter moved with the endpoint rather than being dropped.
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'StudentProfile', 'photoRoute.ts'),
      'utf8'
    );
    assert.match(source, /UPLOAD_MAX\s*=\s*10/);
    assert.match(source, /UPLOAD_WINDOW_MS\s*=\s*60_000/);
    assert.match(source, /limits:\s*\{fileSize: PHOTO\.maxBytes/);
  });

  test('no generic CRUD operation exists', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'listprofiles',
      'getprofile',
      'getstudentprofile',
      'deleteprofile',
      'updateprofile',
      'createprofile',
      'searchprofiles',
      'adminprofile',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  test('every operation is scoped to "my" profile by name', () => {
    // The naming is the contract: there is no operation that takes somebody
    // else's identifier, and the names say so.
    const profileFunctions = registry
      .getFunctions()
      .filter(fn => fn.name.toLowerCase().includes('profile'));
    for (const fn of profileFunctions) {
      assert.ok(/My/.test(fn.name), `${fn.name} must be scoped to the caller`);
    }
  });

  test('no future product operation was added', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const future of ['batch', 'invitation', 'enroll', 'task', 'reel', 'pinned']) {
      assert.ok(!names.some(name => name.includes(future)), `${future} belongs to a later checkpoint`);
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

  test('every personal column is protected from both audiences', () => {
    const protectedFields = schema.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of [
        'user',
        'fullName',
        'verifiedEmail',
        'phone',
        'city',
        'dateOfBirth',
        'photoData',
      ]) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('one profile per Student is enforced by a unique index', () => {
    const found = (schema.compoundIndexes ?? []).find(index => index.fields.includes('_p_user'));
    assert.ok(found, 'a unique index on the user pointer must exist');
    assert.equal(found!.unique, true);
  });

  test('the stored columns are exactly the approved fields', () => {
    assert.deepEqual(Object.keys(schema.fields).sort(), [
      'careerGoal',
      'city',
      'customInstitutionName',
      'dateOfBirth',
      'educationStatus',
      'expectedGraduationDate',
      'fullName',
      'githubUrl',
      'institution',
      'isComplete',
      'linkedinUrl',
      'major',
      'phone',
      'photoData',
      'photoUpdatedAt',
      'portfolioUrl',
      'profileEverComplete',
      'publicProfileSlug',
      'targetRole',
      'targetRoleReason',
      'user',
      'verifiedEmail',
    ]);
  });

  test('the four catalog selections are pointers, not names', () => {
    for (const field of ['city', 'institution', 'major', 'targetRole']) {
      const column = schema.fields[field] as {type?: string; targetClass?: string};
      assert.equal(column.type, 'Pointer', `${field} must be a pointer`);
      assert.equal(column.targetClass, 'ProfileCatalogItem');
    }
  });

  test('no prohibited field is stored', () => {
    const declared = Object.keys(schema.fields).map(name => name.toLowerCase());
    for (const forbidden of [
      'cv',
      'resume',
      'salary',
      'experience',
      'skills',
      'rating',
      'score',
      'evaluation',
      'feedback',
      'recommendation',
      'biography',
      'employmentstatus',
      'workpreference',
    ]) {
      assert.ok(!declared.includes(forbidden), `${forbidden} must not be stored`);
    }
  });

  test('provider identity stays in StudentAuthIdentity', () => {
    const declared = Object.keys(schema.fields).map(name => name.toLowerCase());
    for (const identityField of ['provider', 'providersubject', 'sub', 'credential', 'authdata']) {
      assert.ok(!declared.includes(identityField), `${identityField} belongs to the identity class`);
    }
  });
});

describe('the safe DTO', () => {
  /** A stored catalog item, as the profile query includes it. */
  function catalogItem(type: string, nameEn: string): Parse.Object {
    const Parse = parseSdk();
    const item = new Parse.Object('ProfileCatalogItem');
    item.id = `k-${nameEn.replace(/\s+/g, '-').toLowerCase()}`;
    item.set('type', type);
    item.set('code', nameEn.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    item.set('nameEn', nameEn);
    item.set('nameAr', `ع-${nameEn}`);
    item.set('active', true);
    item.set('sortOrder', 10);
    return item;
  }

  function fakeProfile(attrs: Record<string, unknown>): Parse.Object {
    const Parse = parseSdk();
    const object = new Parse.Object('StudentProfile');
    object.id = 'p1';
    for (const [key, value] of Object.entries(attrs)) object.set(key, value);
    return object;
  }

  test('carries only the allow-listed keys', () => {
    const result = dto.toStudentProfileDto(
      fakeProfile({
        fullName: 'Lina Haddad',
        verifiedEmail: 'lina@example.com',
        phone: '+963944123456',
        city: catalogItem('CITY', 'Damascus'),
        institution: catalogItem('INSTITUTION', 'Damascus University'),
        major: catalogItem('MAJOR', 'Computer Engineering'),
        educationStatus: 'Graduate',
        isComplete: true,
      })
    );

    assert.deepEqual(Object.keys(result).sort(), [
      'city',
      'educationStatus',
      'fullName',
      'hasPhoto',
      'id',
      'institution',
      'isComplete',
      'major',
      'phone',
      'verifiedEmail',
    ]);
  });

  test('a catalog selection is embedded as its localised item, never a pointer', () => {
    const result = dto.toStudentProfileDto(
      fakeProfile({
        fullName: 'Lina Haddad',
        verifiedEmail: 'lina@example.com',
        city: catalogItem('CITY', 'Damascus'),
        isComplete: false,
      })
    );

    assert.deepEqual(Object.keys(result.city ?? {}).sort(), [
      'active',
      'code',
      'id',
      'nameAr',
      'nameEn',
      'sortOrder',
      'type',
    ]);
    assert.equal(result.city?.nameEn, 'Damascus');
    // Not a Parse pointer shape: no __type, no className.
    assert.equal((result.city as unknown as Record<string, unknown>)['__type'], undefined);
    assert.equal((result.city as unknown as Record<string, unknown>)['className'], undefined);
  });

  test('omits every forbidden key', () => {
    const result = dto.toStudentProfileDto(
      fakeProfile({fullName: 'Lina', verifiedEmail: 'lina@example.com', isComplete: false})
    ) as unknown as Record<string, unknown>;

    for (const forbidden of dto.FORBIDDEN_PROFILE_DTO_KEYS) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
  });

  test('the empty shape carries the verified email and nothing personal', () => {
    const result = dto.toEmptyProfileDto('lina@example.com');
    assert.equal(result.verifiedEmail, 'lina@example.com');
    assert.equal(result.isComplete, false);
    assert.equal(result.hasPhoto, false);
    assert.equal(result.phone, undefined);
    assert.equal(result.dateOfBirth, undefined);
  });

  test('renders the date of birth as a plain date', () => {
    const result = dto.toStudentProfileDto(
      fakeProfile({
        fullName: 'Lina',
        verifiedEmail: 'lina@example.com',
        dateOfBirth: new Date('2001-03-14T00:00:00.000Z'),
        isComplete: false,
      })
    );
    assert.equal(result.dateOfBirth, '2001-03-14');
  });
});

describe('logging never carries profile data', () => {
  test('emits only the allow-listed fields', () => {
    const safe = logging.toSafeProfileFields({
      op: 'saveMyStudentProfile',
      stage: 'save',
      ok: true,
      code: 'VALIDATION_FAILED',
      userId: 'u1',
      profileId: 'p1',
      created: true,
      complete: true,
      fieldCount: 2,
      bytes: 1024,
    });
    assert.deepEqual(Object.keys(safe).sort(), [
      'bytes',
      'code',
      'complete',
      'created',
      'fieldCount',
      'ok',
      'op',
      'profileId',
      'stage',
      'userId',
    ]);
  });

  test('drops every private profile value', () => {
    const safe = logging.toSafeProfileFields({
      op: 'saveMyStudentProfile',
      verifiedEmail: 'lina@example.com',
      email: 'lina@example.com',
      phone: '+963944123456',
      dateOfBirth: '2001-03-14',
      city: 'Damascus',
      fullName: 'Lina Haddad',
      careerGoal: 'Backend engineering',
      githubUrl: 'https://github.com/lina',
      photo: 'base64...',
      sessionToken: 'r:abcdef0123456789abcdef',
      providerSubject: '110000000000000000900',
      params: {phone: '+963944123456'},
    });
    assert.deepEqual(Object.keys(safe), ['op']);
  });

  test('drops the field names of a validation failure, keeping only a count', () => {
    // Which answers a person got wrong is theirs, not an operator's.
    const safe = logging.toSafeProfileFields({
      op: 'saveMyStudentProfile',
      fieldCount: 3,
      fields: {phone: 'INVALID', dateOfBirth: 'OUT_OF_RANGE'},
    });
    assert.equal(safe['fieldCount'], 3);
    assert.equal('fields' in safe, false);
  });

  test('the allow-list is the documented ten fields', () => {
    assert.deepEqual([...logging.ALLOWED_PROFILE_LOG_FIELDS].sort(), [
      'bytes',
      'code',
      'complete',
      'created',
      'fieldCount',
      'ok',
      'op',
      'profileId',
      'stage',
      'userId',
    ]);
  });
});

describe('stable error codes', () => {
  test('every code is a plain uppercase token', () => {
    for (const code of errors.PROFILE_ERROR_CODES) {
      assert.match(code, /^[A-Z_]+$/);
    }
  });

  test('a validation failure carries field names and reason codes only', () => {
    const error = errors.profileError('VALIDATION_FAILED', {phone: 'INVALID'});
    assert.ok(error.message.startsWith('VALIDATION_FAILED:'));
    // A reason code, never the submitted value.
    assert.ok(error.message.includes('INVALID'));
    assert.ok(!error.message.includes('+963'));
  });

  test('a non-validation error is the bare code', () => {
    assert.equal(errors.profileError('NOT_A_STUDENT').message, 'NOT_A_STUDENT');
  });
});

describe('the backend and the browser share one set of rules', () => {
  const frontendSource = readFileSync(
    join(REPO_ROOT, 'frontend', 'src', 'app', 'utils', 'student-profile-constants.ts'),
    'utf8'
  );
  const frontendPhoneSource = readFileSync(
    join(REPO_ROOT, 'frontend', 'src', 'app', 'utils', 'syrian-phone.ts'),
    'utf8'
  );

  test('neither side hard-codes an institution list any more', () => {
    // It moved into ProfileCatalogItem, so an Admin edits it rather than a
    // deployment. A leftover array on either side is a second source of truth.
    assert.equal((constants as Record<string, unknown>)['INSTITUTIONS'], undefined);
    assert.ok(!frontendSource.includes('Damascus University'));
    assert.ok(!/export const INSTITUTIONS/.test(frontendSource));
  });

  test('the catalog reference parameter names are identical', () => {
    for (const entry of Object.values(constants.CATALOG_REFERENCE_FIELDS)) {
      assert.ok(
        frontendSource.includes(`param: '${entry.param}'`),
        `the browser is missing: ${entry.param}`
      );
      assert.ok(
        frontendSource.includes(`type: '${entry.type}'`),
        `the browser is missing the ${entry.type} category`
      );
    }
  });

  test('the education statuses are identical', () => {
    for (const status of constants.EDUCATION_STATUSES) {
      assert.ok(frontendSource.includes(`'${status}'`), `the browser is missing: ${status}`);
    }
  });

  test('the length bounds are identical', () => {
    for (const [field, bounds] of Object.entries(constants.LIMITS)) {
      const max = (bounds as {max: number}).max;
      assert.ok(
        new RegExp(`${field}:\\s*\\{[^}]*max:\\s*${max}`).test(frontendSource),
        `${field}.max must match on both sides`
      );
    }
  });

  test('the photo rules are identical', () => {
    assert.ok(frontendSource.includes('5 * 1024 * 1024'));
    for (const mime of constants.PHOTO.mimeTypes) {
      assert.ok(frontendSource.includes(`'${mime}'`), `the browser is missing: ${mime}`);
    }
  });

  test('the writable field list is identical', () => {
    for (const field of constants.WRITABLE_PROFILE_FIELDS) {
      assert.ok(frontendSource.includes(`'${field}'`), `the browser is missing: ${field}`);
    }
  });

  test('the Syrian phone rule is mirrored in the browser', () => {
    assert.ok(frontendPhoneSource.includes(String(syrianPhone.SYRIAN_MOBILE_PATTERN)));
    assert.ok(frontendPhoneSource.includes('normaliseSyrianPhone'));
  });
});
