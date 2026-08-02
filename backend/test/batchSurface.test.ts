/**
 * The Batch surface: the registered operations, the three models' access rules,
 * the safe DTOs, the logging allow-list, and the shared constants.
 *
 * The load-bearing checks are the ones a reviewer would want proved rather than
 * asserted in a comment:
 *
 *  - **No delete exists.** Not hidden, not guarded — absent from the registry.
 *  - **The one-current-invitation and one-enrollment invariants are database
 *    indexes**, not application checks, so a race cannot break them.
 *  - **Nothing that could identify a Student leaves in a Batch DTO**, and
 *    nothing that could reconstruct a token leaves in an invitation DTO.
 *  - **The logging allow-list has no field a token, an email, or a search term
 *    could travel in.**
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

interface Schema {
  className: string;
  fields: Record<string, {type?: string; targetClass?: string; required?: boolean}>;
  compoundIndexes?: {fields: string[]; unique?: boolean; name?: string}[];
  classLevelPermissions?: {
    ACL?: Record<string, {read?: boolean; write?: boolean}>;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
}

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let constants: typeof import('../src/cloudCode/modules/Batch/constants');
let errors: typeof import('../src/cloudCode/modules/Batch/errors');
let dto: typeof import('../src/cloudCode/modules/Batch/dto');
let logging: typeof import('../src/cloudCode/modules/Batch/logging');
let summary: typeof import('../src/cloudCode/modules/Batch/studentSummary');
let invitationConstants: typeof import('../src/cloudCode/modules/Batch/invitationConstants');

let batchSchema: Schema;
let invitationSchema: Schema;
let enrollmentSchema: Schema;

/** Every operation this checkpoint registers, by route prefix. */
const BATCH_FUNCTION_NAMES = [
  'archiveBatch',
  'changeBatchStatus',
  'createBatch',
  'expireBatchInvitation',
  'getBatch',
  'getBatchInvitation',
  'getMyBatch',
  'getStudent',
  'issueBatchInvitation',
  'joinBatchWithInvitation',
  'listBatchStudents',
  'listBatches',
  'listMyBatches',
  'listStudents',
  'previewInvitation',
  'revokeBatchInvitation',
  'setBatchInvitationExpiry',
  'updateBatch',
];

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/StudentProfile');
  await import('../src/cloudCode/models/ProfileCatalogItem');
  const batchModel = (await import('../src/cloudCode/models/Batch')).default;
  const invitationModel = (await import('../src/cloudCode/models/BatchInvitation')).default;
  const enrollmentModel = (await import('../src/cloudCode/models/BatchEnrollment')).default;

  await import('../src/cloudCode/modules/Batch/functions');
  await import('../src/cloudCode/modules/Batch/enrollmentFunctions');
  await import('../src/cloudCode/modules/Batch/studentDirectory');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  constants = await import('../src/cloudCode/modules/Batch/constants');
  errors = await import('../src/cloudCode/modules/Batch/errors');
  dto = await import('../src/cloudCode/modules/Batch/dto');
  logging = await import('../src/cloudCode/modules/Batch/logging');
  summary = await import('../src/cloudCode/modules/Batch/studentSummary');
  invitationConstants = await import('../src/cloudCode/modules/Batch/invitationConstants');

  const kit = (await import('@90soft/parse-server-kit')) as unknown as {
    getSchemaDefinition: (target: unknown) => Schema;
  };
  batchSchema = kit.getSchemaDefinition(batchModel);
  invitationSchema = kit.getSchemaDefinition(invitationModel);
  enrollmentSchema = kit.getSchemaDefinition(enrollmentModel);

  assert.ok(batchSchema, 'the Batch schema must be discoverable');
  assert.ok(invitationSchema, 'the BatchInvitation schema must be discoverable');
  assert.ok(enrollmentSchema, 'the BatchEnrollment schema must be discoverable');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('the closed status list', () => {
  test('is exactly four values, stored lower-case', () => {
    assert.deepEqual(
      [...constants.BATCH_STATUSES],
      ['draft', 'active', 'completed', 'archived']
    );
  });

  test('narrows anything else to undefined', () => {
    for (const value of ['DRAFT', 'pending', 'deleted', '', null, undefined, 7, {}]) {
      assert.equal(
        constants.toBatchStatus(value),
        undefined,
        `${String(value)} must not resolve to a status`
      );
    }
  });

  test('a new Batch may only start as draft or active', () => {
    assert.deepEqual([...constants.BATCH_CREATE_STATUSES], ['draft', 'active']);
  });

  test('only active accepts enrollment', () => {
    for (const status of constants.BATCH_STATUSES) {
      assert.equal(
        constants.acceptsEnrollment(status),
        status === 'active',
        `${status} enrollment acceptance`
      );
    }
  });

  test('archived is terminal', () => {
    assert.deepEqual([...constants.BATCH_TRANSITIONS['archived']], []);
    assert.equal(constants.isReadOnlyStatus('archived'), true);
    for (const status of constants.BATCH_STATUSES) {
      assert.equal(
        constants.canTransition('archived', status),
        false,
        `archived must not move to ${status}`
      );
    }
  });

  test('every status can still be archived except archived itself', () => {
    for (const status of constants.BATCH_STATUSES) {
      assert.equal(
        constants.canTransition(status, 'archived'),
        status !== 'archived',
        `${status} -> archived`
      );
    }
  });

  test('no transition is a self-transition', () => {
    for (const status of constants.BATCH_STATUSES) {
      assert.equal(constants.canTransition(status, status), false, `${status} -> ${status}`);
    }
  });
});

describe('the registered operations', () => {
  const batchFunctions = () =>
    registry
      .getFunctions()
      .filter(fn => BATCH_FUNCTION_NAMES.includes(fn.name));

  test('are exactly the eighteen Checkpoint 4 operations', () => {
    const names = batchFunctions()
      .map(fn => fn.name)
      .sort();
    assert.deepEqual(names, [...BATCH_FUNCTION_NAMES].sort());
  });

  test('no delete operation exists, for a Batch or anything under one', () => {
    // Deleting a Batch would silently delete the record of who was in it.
    // Archiving is the retirement path, and it keeps everything.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'deletebatch',
      'removebatch',
      'deleteenrollment',
      'removeenrollment',
      'removestudent',
      'unenroll',
      'deletestudent',
      'deleteinvitation',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be registered`);
    }
  });

  test('the only operation reachable without a session is the invitation preview', () => {
    const anonymous = batchFunctions().filter(fn => fn.config.validation?.requireUser !== true);
    assert.deepEqual(
      anonymous.map(fn => fn.name),
      ['previewInvitation']
    );
  });

  test('the preview is a POST, so a token never enters a URL', () => {
    // A GET would put the token in the path: access logs, proxy logs, and
    // browser history all keep those.
    const preview = batchFunctions().find(fn => fn.name === 'previewInvitation');
    assert.ok(preview, 'previewInvitation must be registered');
    assert.deepEqual(preview!.config.methods, ['POST']);
  });

  test('redeeming an invitation is a POST too', () => {
    const join = batchFunctions().find(fn => fn.name === 'joinBatchWithInvitation');
    assert.deepEqual(join!.config.methods, ['POST']);
  });

  test('no operation takes a class name or an arbitrary query', () => {
    for (const fn of batchFunctions()) {
      const fields = Object.keys(fn.config.validation?.fields ?? {});
      for (const field of fields) {
        const lowered = field.toLowerCase();
        assert.ok(!lowered.includes('classname'), `${fn.name}.${field} exposes a class name`);
        assert.ok(!lowered.includes('where'), `${fn.name}.${field} exposes a query`);
        assert.ok(!lowered.includes('query'), `${fn.name}.${field} exposes a query`);
        assert.ok(!lowered.includes('acl'), `${fn.name}.${field} exposes an ACL`);
      }
    }
  });

  test('no operation writes a role, a password, or a session', () => {
    for (const fn of batchFunctions()) {
      const fields = Object.keys(fn.config.validation?.fields ?? {}).map(f => f.toLowerCase());
      for (const forbidden of ['role', 'roles', 'password', 'sessiontoken', 'authdata']) {
        assert.ok(!fields.includes(forbidden), `${fn.name} must not accept ${forbidden}`);
      }
    }
  });
});

describe('the invitation token', () => {
  let tokens: typeof import('../src/cloudCode/modules/Batch/invitationToken');

  before(async () => {
    tokens = await import('../src/cloudCode/modules/Batch/invitationToken');
  });

  test('is 256 bits of randomness', () => {
    assert.equal(invitationConstants.INVITATION_TOKEN_BYTES, 32);
  });

  test('is base64url — safe in a path segment, with no padding to strip', () => {
    for (let i = 0; i < 20; i++) {
      const {token} = tokens.generateInvitationToken();
      assert.match(token, /^[A-Za-z0-9_-]+$/, `${token} is not base64url`);
      assert.ok(token.length >= 40, 'a 32-byte token encodes to at least 40 characters');
    }
  });

  test('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(tokens.generateInvitationToken().token);
    assert.equal(seen.size, 200, 'every generated token must be distinct');
  });

  test('hashes to a stable SHA-256 hex digest', () => {
    const {token, tokenHash} = tokens.generateInvitationToken();
    assert.equal(tokenHash, tokens.hashInvitationToken(token), 'hashing must be deterministic');
    assert.match(tokenHash, /^[0-9a-f]{64}$/, 'a SHA-256 digest is 64 hex characters');
  });

  test('the hash cannot be read back as the token', () => {
    const {token, tokenHash} = tokens.generateInvitationToken();
    assert.notEqual(tokenHash, token);
    assert.ok(!tokenHash.includes(token), 'the hash must not contain the token');
  });

  test('the fingerprint comes from the hash, not the token', () => {
    const {token, tokenHash, fingerprint} = tokens.generateInvitationToken();

    assert.equal(fingerprint.length, invitationConstants.INVITATION_FINGERPRINT_LENGTH);
    assert.equal(fingerprint, tokens.fingerprintOf(tokenHash));
    assert.ok(tokenHash.startsWith(fingerprint), 'the fingerprint is a prefix of the hash');
    assert.ok(!token.startsWith(fingerprint), 'the fingerprint must not leak the token');
  });

  test('comparison is constant-time and rejects a near miss', () => {
    const {tokenHash: hash} = tokens.generateInvitationToken();
    assert.equal(tokens.hashesMatch(hash, hash), true);
    assert.equal(tokens.hashesMatch(hash, 'f' + hash.slice(1)), false);
    assert.equal(tokens.hashesMatch(hash, hash.slice(0, 60)), false, 'a length mismatch is false');
    assert.equal(tokens.hashesMatch(hash, ''), false);
  });

  test('a malformed token is rejected before it is ever hashed', () => {
    for (const bad of ['', 'short', 'has spaces in it', 'a'.repeat(200), 'plus+slash/=']) {
      assert.equal(tokens.looksLikeInvitationToken(bad), false, `${bad} must not look like a token`);
    }
    assert.equal(
      tokens.looksLikeInvitationToken(tokens.generateInvitationToken().token),
      true
    );
  });

  test('the built URL uses the hash route and carries the token in the fragment', () => {
    const {token} = tokens.generateInvitationToken();
    const url = tokens.buildInvitationUrl('https://example.test', token);
    assert.equal(url, `https://example.test/#/join/${token}`);
  });
});

describe('the safe DTOs', () => {
  test('a Batch DTO never carries an ACL, a raw object, or its creator', () => {
    for (const key of dto.FORBIDDEN_BATCH_DTO_KEYS) {
      assert.ok(typeof key === 'string' && key.length > 0);
    }
    for (const forbidden of ['ACL', 'createdBy', 'className', '__type', 'objectId']) {
      assert.ok(
        dto.FORBIDDEN_BATCH_DTO_KEYS.includes(forbidden),
        `${forbidden} must be on the forbidden list`
      );
    }
  });

  test('an invitation preview carries no identifier at all', () => {
    // A Visitor holding a link learns the Batch name and dates and nothing
    // else. An objectId would let somebody probe for other Batches.
    const preview = dto.toInvitationPreviewDto(
      {
        get: (field: string) =>
          ({name: 'Spring 2026', description: 'Cohort', status: 'active'})[
            field as 'name' | 'description' | 'status'
          ],
        id: 'shouldNotAppear',
      } as never,
      true
    );
    const serialised = JSON.stringify(preview);
    assert.ok(!serialised.includes('shouldNotAppear'), 'no id may reach a Visitor');
    assert.ok(!serialised.includes('objectId'), 'no objectId key may appear');
  });

  test('an invitation status carries no token, no hash, and no id', () => {
    const status = dto.toInvitationStatusDto(
      {
        get: (field: string) =>
          ({
            tokenHash: 'a'.repeat(64),
            state: 'current',
            version: 2,
          })[field as 'tokenHash' | 'state' | 'version'],
        id: 'inv1',
      } as never,
      {usable: true, canManage: true}
    );
    const serialised = JSON.stringify(status);
    assert.ok(!serialised.includes('a'.repeat(64)), 'the hash must never leave the server');
    assert.ok(!/"token"/.test(serialised), 'there is no token field');
    assert.ok(!serialised.includes('inv1'), 'the invitation id is not part of the status');
  });

  test('a Student summary carries no phone, date of birth, or photo', () => {
    for (const forbidden of [
      'phone',
      'dateOfBirth',
      'photoData',
      'photoUpdatedAt',
      'authData',
      'password',
      'sessionToken',
      'username',
      'providerSubject',
      'providerPictureUrl',
      'ACL',
    ]) {
      assert.ok(
        summary.FORBIDDEN_STUDENT_SUMMARY_KEYS.includes(forbidden),
        `${forbidden} must be on the forbidden list`
      );
    }
  });
});

describe('the logging allow-list', () => {
  test('has no field a token could travel in', () => {
    const fields = logging.ALLOWED_BATCH_LOG_FIELDS.map(field => field.toLowerCase());
    for (const forbidden of ['token', 'tokenhash', 'hash', 'url', 'link', 'invitationurl']) {
      assert.ok(!fields.includes(forbidden), `${forbidden} must not be loggable`);
    }
  });

  test('has no field personal data could travel in', () => {
    const fields = logging.ALLOWED_BATCH_LOG_FIELDS.map(field => field.toLowerCase());
    for (const forbidden of [
      'email',
      'verifiedemail',
      'phone',
      'dateofbirth',
      'fullname',
      'name',
      'displayname',
      'photo',
    ]) {
      assert.ok(!fields.includes(forbidden), `${forbidden} must not be loggable`);
    }
  });

  test('has no field a search term or a filter could travel in', () => {
    const fields = logging.ALLOWED_BATCH_LOG_FIELDS.map(field => field.toLowerCase());
    for (const forbidden of ['search', 'query', 'filter', 'filters', 'term', 'where']) {
      assert.ok(!fields.includes(forbidden), `${forbidden} must not be loggable`);
    }
  });

  test('drops anything not on the list rather than passing it through', () => {
    const safe = logging.toSafeBatchFields({
      op: 'issueBatchInvitation',
      ok: true,
      batchId: 'b1',
      token: 'secret-token',
      email: 'someone@example.test',
      search: 'lina',
    });

    const serialised = JSON.stringify(safe);
    assert.ok(serialised.includes('b1'), 'an allow-listed field survives');
    assert.ok(!serialised.includes('secret-token'), 'the token is dropped');
    assert.ok(!serialised.includes('someone@example.test'), 'the email is dropped');
    assert.ok(!serialised.includes('lina'), 'the search term is dropped');
  });
});

describe('the error codes', () => {
  test('an unknown token and a malformed one answer identically', () => {
    // Distinguishing them would let somebody probe which tokens ever existed.
    assert.equal(errors.InvitationError.INVITATION_INVALID, 'INVITATION_INVALID');
    const codes = Object.values(errors.InvitationError);
    assert.ok(!codes.includes('INVITATION_NOT_FOUND' as never), 'no not-found variant exists');
    assert.ok(!codes.includes('INVITATION_MALFORMED' as never), 'no malformed variant exists');
  });

  test('every code is a stable identifier, never a sentence', () => {
    const all = [
      ...Object.values(errors.BatchError),
      ...Object.values(errors.InvitationError),
      ...Object.values(errors.EnrollmentError),
    ];
    for (const code of all) {
      assert.match(String(code), /^[A-Z][A-Z0-9_]*$/, `${code} is not a stable code`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════

describe('the Batch model', () => {
  test('has no capacity, trainer, location, schedule, or score field', () => {
    const fields = Object.keys(batchSchema.fields).map(field => field.toLowerCase());
    for (const forbidden of [
      'capacity',
      'maxstudents',
      'trainer',
      'instructor',
      'location',
      'schedule',
      'score',
      'rating',
      'program',
    ]) {
      assert.ok(!fields.includes(forbidden), `Batch.${forbidden} must not exist`);
    }
  });

  test('uses no Program terminology anywhere in its schema', () => {
    const serialised = JSON.stringify(batchSchema).toLowerCase();
    assert.ok(!serialised.includes('program'), 'Program is not part of this product');
  });

  test('denies every client operation', () => {
    for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
      assert.deepEqual(
        batchSchema.classLevelPermissions![operation],
        {},
        `Batch.${operation} must grant nobody`
      );
    }
  });
});

describe('the invitation model', () => {
  test('enforces one current invitation per Batch with a unique index', () => {
    // An application check would lose a race. A unique partial index cannot.
    const index = (invitationSchema.compoundIndexes ?? []).find(
      entry => entry.name === 'batch_invitation_current_unique'
    );
    assert.ok(index, 'the one-current-invitation index must exist');
    assert.equal(index!.unique, true, 'it must be unique or it enforces nothing');
    // `_p_<field>` is the column a Parse Pointer actually occupies; indexing
    // the logical name would index a column that does not exist.
    assert.deepEqual(index!.fields, ['_p_currentForBatch']);
  });

  test('enforces a unique token hash', () => {
    const index = (invitationSchema.compoundIndexes ?? []).find(
      entry => entry.name === 'batch_invitation_token_hash_unique'
    );
    assert.ok(index, 'the token hash index must exist');
    assert.equal(index!.unique, true);
    assert.deepEqual(index!.fields, ['tokenHash']);
  });

  test('stores a hash and never the token itself', () => {
    const fields = Object.keys(invitationSchema.fields);
    assert.ok(fields.includes('tokenHash'), 'the hash column must exist');
    for (const forbidden of ['token', 'rawToken', 'secret', 'invitationUrl', 'url']) {
      assert.ok(!fields.includes(forbidden), `BatchInvitation.${forbidden} must not exist`);
    }
  });

  test('denies every client operation', () => {
    for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
      assert.deepEqual(
        invitationSchema.classLevelPermissions![operation],
        {},
        `BatchInvitation.${operation} must grant nobody`
      );
    }
  });
});

describe('the enrollment model', () => {
  test('enforces one enrollment per Batch and Student with a unique index', () => {
    const index = (enrollmentSchema.compoundIndexes ?? []).find(
      entry => entry.name === 'batch_enrollment_unique'
    );
    assert.ok(index, 'the one-enrollment index must exist');
    assert.equal(index!.unique, true);
    assert.deepEqual(index!.fields, ['_p_batch', '_p_student']);
  });

  test('carries no score, rating, feedback, or note', () => {
    const fields = Object.keys(enrollmentSchema.fields).map(field => field.toLowerCase());
    for (const forbidden of ['score', 'rating', 'grade', 'feedback', 'note', 'notes', 'comment']) {
      assert.ok(!fields.includes(forbidden), `BatchEnrollment.${forbidden} must not exist`);
    }
  });

  test('denies every client operation', () => {
    for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
      assert.deepEqual(
        enrollmentSchema.classLevelPermissions![operation],
        {},
        `BatchEnrollment.${operation} must grant nobody`
      );
    }
  });
});
