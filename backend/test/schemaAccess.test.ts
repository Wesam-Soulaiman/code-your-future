/**
 * Deny-by-default schema and model access tests.
 *
 * These load the real model modules (which requires a minimal Parse global so
 * the decorators can register) and then assert the generated schema definitions.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

type AclTemplate = Record<string, {read?: boolean; write?: boolean}>;
interface Definition {
  className: string;
  classLevelPermissions?: {
    ACL?: AclTemplate;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
}

const CLP_OPERATIONS = ['find', 'get', 'count', 'create', 'update', 'delete'] as const;

let definitions: Definition[];
let hardenDefinitions: (defs: Definition[]) => string[];
let InsecureSchemaError: new (message: string) => Error;

before(async () => {
  installParseTestGlobal();

  // Importing the models registers them with the kit's decorator metadata.
  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/File');
  await import('../src/cloudCode/models/IMG');
  await import('../src/cloudCode/models/StudentAuthIdentity');
  await import('../src/cloudCode/models/ProfileCatalogItem');
  await import('../src/cloudCode/models/StudentProfile');
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

  const guard = await import('../src/cloudCode/utils/config/schemaGuard');
  hardenDefinitions = guard.hardenDefinitions as typeof hardenDefinitions;
  InsecureSchemaError = guard.InsecureSchemaError as typeof InsecureSchemaError;

  const config = guard.createHardenedSchemaConfig();
  definitions = config.definitions as Definition[];
});

describe('registered class surface', () => {
  test('contains exactly the sixteen approved classes', () => {
    const names = definitions.map(definition => definition.className).sort();
    assert.deepEqual(names, [
      'Batch',
      'BatchEnrollment',
      'BatchInvitation',
      'BatchResource',
      'BatchTask',
      'File',
      'IMG',
      'LiveResponse',
      'LiveSlide',
      'LiveSlideSession',
      'ProfileCatalogItem',
      'StudentAuthIdentity',
      'StudentProfile',
      'TalentReelPublication',
      'TaskSubmission',
      '_Role',
      '_User',
    ]);
  });

  test('AppSettings is no longer registered', () => {
    const names = definitions.map(definition => definition.className);
    assert.ok(
      !names.includes('AppSettings'),
      'AppSettings must not appear in the schema'
    );
  });

  test('no future product model was added', () => {
    const names = definitions.map(definition => definition.className);
    // Batch, BatchInvitation, and BatchEnrollment shipped in Checkpoint 4;
    // BatchResource in Checkpoint 5; LiveSlideSession, LiveSlide, and
    // LiveResponse in Checkpoint 6. Everything below belongs to a checkpoint
    // that has not happened, and a class for one would be a stub.
    //
    // `LiveSlidesSession` — plural `Slides` — stays on this list on purpose:
    // the class that shipped is `LiveSlideSession`, and the near-miss name is
    // exactly the sort of thing that gets created twice.
    const future = [
      'Enrollment',
      'PinnedStudent',
      'LiveSlidesSession',
      // The Checkpoint 7 classes shipped under focused names — `BatchTask`,
      // `TaskSubmission`, `TalentReelPublication`. These bare near-misses stay
      // on the list on purpose: `Task` in particular is a word half the
      // libraries in a Node process already use, and a Parse class competing
      // with one of them is a debugging session nobody needs.
      'Task',
      'Submission',
      'TalentReel',
    ];
    for (const className of future) {
      assert.ok(!names.includes(className), `${className} must not exist yet`);
    }
  });
});

describe('_Role is Admin-scoped', () => {
  test('grants only role:Admin and never a legacy role', () => {
    const roleClass = definitions.find(definition => definition.className === '_Role');
    assert.ok(roleClass, '_Role definition must exist');
    const serialised = JSON.stringify(roleClass!.classLevelPermissions);
    assert.ok(serialised.includes('role:Admin'), '_Role must be Admin-scoped');
    assert.ok(!serialised.includes('SuperAdmin'), 'no SuperAdmin in _Role CLP');
    assert.ok(!serialised.includes('Employee'), 'no Employee in _Role CLP');
  });
});

describe('deny-by-default access', () => {
  for (const className of [
    '_User',
    'File',
    'IMG',
    'StudentAuthIdentity',
    'StudentProfile',
    'ProfileCatalogItem',
    'Batch',
    'BatchInvitation',
    'BatchEnrollment',
    'BatchResource',
    'LiveSlideSession',
    'LiveSlide',
    'LiveResponse',
    'BatchTask',
    'TaskSubmission',
    'TalentReelPublication',
  ]) {
    test(`${className} denies every client operation`, () => {
      const definition = definitions.find(entry => entry.className === className);
      assert.ok(definition, `${className} definition must exist`);
      const clp = definition!.classLevelPermissions!;
      for (const operation of CLP_OPERATIONS) {
        assert.deepEqual(
          clp[operation],
          {},
          `${className}.${operation} must grant nobody`
        );
      }
    });

    test(`${className} has no public wildcard ACL`, () => {
      const definition = definitions.find(entry => entry.className === className);
      const acl = definition!.classLevelPermissions!.ACL ?? {};
      const wildcard = acl['*'];
      assert.ok(
        !wildcard || (!wildcard.read && !wildcard.write),
        `${className} must not be publicly readable or writable`
      );
    });

    test(`${className} CLP mentions no legacy role`, () => {
      const definition = definitions.find(entry => entry.className === className);
      const serialised = JSON.stringify(definition!.classLevelPermissions);
      assert.ok(!serialised.includes('SuperAdmin'), `${className}: no SuperAdmin`);
      assert.ok(!serialised.includes('Employee'), `${className}: no Employee`);
    });
  }

  test('unauthenticated _User creation is denied by CLP', () => {
    const user = definitions.find(entry => entry.className === '_User');
    assert.deepEqual(
      user!.classLevelPermissions!['create'],
      {},
      'public _User creation must be closed'
    );
  });

  test('_User protects identity and auth columns', () => {
    const user = definitions.find(entry => entry.className === '_User');
    const protectedFields = user!.classLevelPermissions!.protectedFields!;
    for (const field of ['email', 'authData']) {
      assert.ok(
        protectedFields['*'].includes(field),
        `${field} must be protected from unauthenticated callers`
      );
      assert.ok(
        protectedFields['authenticated'].includes(field),
        `${field} must be protected from other authenticated callers`
      );
    }
  });

  test('File and IMG hide their storage handles', () => {
    const file = definitions.find(entry => entry.className === 'File');
    assert.ok(file!.classLevelPermissions!.protectedFields!['*'].includes('file'));

    const img = definitions.find(entry => entry.className === 'IMG');
    assert.ok(img!.classLevelPermissions!.protectedFields!['*'].includes('image'));
  });

  test('StudentProfile hides every personal column', () => {
    const profile = definitions.find(entry => entry.className === 'StudentProfile');
    const protectedFields = profile!.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of ['user', 'verifiedEmail', 'phone', 'dateOfBirth', 'photoData']) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('BatchInvitation hides the token hash and every other column ⟨CP4⟩', () => {
    // The hash is the one column that would matter most if it leaked: it is
    // what a redemption is checked against. Nothing at all is readable.
    const invitation = definitions.find(entry => entry.className === 'BatchInvitation');
    const protectedFields = invitation!.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of ['tokenHash', 'batch', 'currentForBatch', 'state', 'expiresAt']) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('Batch and BatchEnrollment hide every column ⟨CP4⟩', () => {
    // An enrollment says which Student is in which Batch. Read through the
    // cloud functions, which authorise per caller — never straight off the
    // class, which would hand anybody the whole roster.
    const batch = definitions.find(entry => entry.className === 'Batch');
    for (const audience of ['*', 'authenticated']) {
      for (const field of ['name', 'status', 'startDate', 'createdBy']) {
        assert.ok(
          batch!.classLevelPermissions!.protectedFields![audience].includes(field),
          `Batch.${field} must be hidden from '${audience}'`
        );
      }
    }

    const enrollment = definitions.find(entry => entry.className === 'BatchEnrollment');
    for (const audience of ['*', 'authenticated']) {
      for (const field of ['batch', 'student', 'joinedAt']) {
        assert.ok(
          enrollment!.classLevelPermissions!.protectedFields![audience].includes(field),
          `BatchEnrollment.${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('BatchResource hides the storage key and every other column ⟨CP5⟩', () => {
    // The storage key is the one column that would matter most if it leaked:
    // it is how the bytes are addressed. Nothing at all is readable.
    const resource = definitions.find(entry => entry.className === 'BatchResource');
    const protectedFields = resource!.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of [
        'storageKey',
        'batch',
        'title',
        'filename',
        'mimeType',
        'fileSize',
        'uploadedBy',
      ]) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });

  test('StudentAuthIdentity hides every identity column', () => {
    const identity = definitions.find(
      entry => entry.className === 'StudentAuthIdentity'
    );
    const protectedFields = identity!.classLevelPermissions!.protectedFields!;
    for (const audience of ['*', 'authenticated']) {
      for (const field of ['provider', 'providerSubject', 'user']) {
        assert.ok(
          protectedFields[audience].includes(field),
          `${field} must be hidden from '${audience}'`
        );
      }
    }
  });
});

describe('schema guard neutralises the insecure fallback', () => {
  test('rewrites a public wildcard ACL to deny-by-default', () => {
    const insecure: Definition[] = [
      {
        className: 'Leaky',
        classLevelPermissions: {
          find: {},
          get: {},
          count: {},
          create: {},
          update: {},
          delete: {},
          // exactly what the kit's fallback produces
          ACL: {'*': {read: true, write: true}},
        },
      },
    ];

    const notes = hardenDefinitions(insecure);
    assert.equal(notes.length, 1);
    assert.deepEqual(insecure[0].classLevelPermissions!.ACL, {});
  });

  test('replaces a missing ACL template with deny-by-default', () => {
    const missing: Definition[] = [
      {
        className: 'NoAcl',
        classLevelPermissions: {
          find: {},
          get: {},
          count: {},
          create: {},
          update: {},
          delete: {},
        },
      },
    ];

    hardenDefinitions(missing);
    assert.deepEqual(missing[0].classLevelPermissions!.ACL, {});
  });

  test('aborts when a class declares no CLP at all', () => {
    assert.throws(
      () => hardenDefinitions([{className: 'Undeclared'}]),
      InsecureSchemaError
    );
  });

  test('aborts when a class leaves an operation undecided', () => {
    assert.throws(
      () =>
        hardenDefinitions([
          {
            className: 'PartiallyDeclared',
            classLevelPermissions: {find: {}, get: {}},
          },
        ]),
      InsecureSchemaError
    );
  });
});

/** Release the kit's module-load rate-limit interval so the process exits. */
after(() => {
  clearTrackedIntervals();
});
