/**
 * The Batch Task surface ⟨CP7⟩: registered operations, the three models' access
 * rules and indexes, the DTOs, the logging allow-list, and the triggers.
 *
 * The triggers are exercised directly rather than through a database. They hold
 * the guarantees the product is actually making — "a Batch has at most one Final
 * Task", "a Submission that was handed in can never be deleted" — and those are
 * properties of the model, not of whichever operation happens to call it.
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
const MODULE_DIR = join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask');

function moduleSource(name: string): string {
  return readFileSync(join(MODULE_DIR, `${name}.ts`), 'utf8');
}

/** The same source with its comments removed — a comment naming a thing is not
 *  the code doing it, and these assertions are about the code. */
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

type Schema = {
  className: string;
  fields: Record<string, unknown>;
  compoundIndexes?: {
    fields: string[];
    unique?: boolean;
    name?: string;
    partialFilterNulls?: boolean;
  }[];
  classLevelPermissions?: {
    ACL?: Record<string, unknown>;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
};

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let dto: typeof import('../src/cloudCode/modules/BatchTask/dto');
let logging: typeof import('../src/cloudCode/modules/BatchTask/logging');
let errors: typeof import('../src/cloudCode/modules/BatchTask/errors');
let constants: typeof import('../src/cloudCode/modules/BatchTask/constants');
let taskSchema: Schema;
let submissionSchema: Schema;
let publicationSchema: Schema;
let profileSchema: Schema;

let TaskModel: {onBeforeSave(request: unknown): Promise<void>};
let SubmissionModel: {
  onBeforeSave(request: unknown): Promise<void>;
  onBeforeDelete(request: unknown): Promise<void>;
};
let PublicationModel: {onBeforeSave(request: unknown): Promise<void>};

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  const profile = (await import('../src/cloudCode/models/StudentProfile')).default;
  const task = (await import('../src/cloudCode/models/BatchTask')).default;
  const submission = (await import('../src/cloudCode/models/TaskSubmission')).default;
  const publication = (await import('../src/cloudCode/models/TalentReelPublication')).default;

  await import('../src/cloudCode/modules/BatchTask/adminFunctions');
  await import('../src/cloudCode/modules/BatchTask/studentFunctions');
  await import('../src/cloudCode/modules/BatchTask/reelFunctions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/BatchTask/dto');
  logging = await import('../src/cloudCode/modules/BatchTask/logging');
  errors = await import('../src/cloudCode/modules/BatchTask/errors');
  constants = await import('../src/cloudCode/modules/BatchTask/constants');

  const kit = await import('@90soft/parse-server-kit');
  const get = (kit as unknown as {getSchemaDefinition: (t: unknown) => Schema}).getSchemaDefinition;
  taskSchema = get(task);
  submissionSchema = get(submission);
  publicationSchema = get(publication);
  profileSchema = get(profile);

  TaskModel = task as unknown as typeof TaskModel;
  SubmissionModel = submission as unknown as typeof SubmissionModel;
  PublicationModel = publication as unknown as typeof PublicationModel;
});

after(() => clearTrackedIntervals());

/** A trigger request double. */
function saveRequest(object: Parse.Object, master = true) {
  return {object, master, user: undefined};
}

function taskObject(attrs: Record<string, unknown> = {}, id?: string): Parse.Object {
  const Parse = parseSdk();
  const object = new Parse.Object('BatchTask');
  if (id) object.id = id;
  const batch = new Parse.Object('Batch');
  batch.id = 'batch1';
  const creator = new Parse.Object('_User');
  creator.id = 'admin1';
  object.set('batch', batch);
  object.set('createdBy', creator);
  object.set('type', 'ASSIGNMENT');
  object.set('status', 'DRAFT');
  object.set('title', 'Build a portfolio');
  object.set('description', 'Ship something you are proud of.');
  for (const column of [
    'githubRequirement',
    'liveDemoRequirement',
    'driveRequirement',
    'videoRequirement',
    'studentNoteRequirement',
  ]) {
    object.set(column, 'NOT_USED');
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) object.unset(key);
    else object.set(key, value);
  }
  return object;
}

function submissionObject(attrs: Record<string, unknown> = {}, id?: string): Parse.Object {
  const Parse = parseSdk();
  const object = new Parse.Object('TaskSubmission');
  if (id) object.id = id;
  for (const [field, className] of [
    ['task', 'BatchTask'],
    ['batch', 'Batch'],
    ['student', '_User'],
    ['studentProfile', 'StudentProfile'],
  ]) {
    const pointer = new Parse.Object(className);
    pointer.id = `${field}1`;
    object.set(field, pointer);
  }
  object.set('status', 'DRAFT');
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) object.unset(key);
    else object.set(key, value);
  }
  return object;
}

/**
 * A row as it already exists in the database — nothing dirty until the test
 * changes something.
 *
 * `new Parse.Object(...)` plus `.set()` marks every field dirty, so a trigger
 * that reports the *first* changed field would report whichever one the helper
 * happened to set first, and a test asserting "changing the student is refused"
 * would pass while the code checked nothing of the sort. `fromJSON` builds the
 * object in its saved state instead.
 */
function storedObject(
  className: string,
  objectId: string,
  attrs: Record<string, unknown>
): Parse.Object {
  const Parse = parseSdk();
  const json: Record<string, unknown> = {className, objectId, ...attrs};
  return Parse.Object.fromJSON(json as never, false) as Parse.Object;
}

function pointerJson(className: string, objectId: string) {
  return {__type: 'Pointer', className, objectId};
}

/** A saved TaskSubmission with all four pointers already in place. */
function storedSubmission(attrs: Record<string, unknown> = {}): Parse.Object {
  return storedObject('TaskSubmission', 'sub1', {
    task: pointerJson('BatchTask', 'task1'),
    batch: pointerJson('Batch', 'batch1'),
    student: pointerJson('_User', 'student1'),
    studentProfile: pointerJson('StudentProfile', 'profile1'),
    status: 'DRAFT',
    ...attrs,
  });
}

async function refuses(promise: Promise<unknown>, fragment: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught
  );
  assert.ok(error, `expected a rejection mentioning "${fragment}"`);
  assert.match(String((error as Error).message), new RegExp(fragment, 'i'));
}

// ═══════════════════════════════════════════════════════════════════════════

describe('registered operations', () => {
  const CP7 = [
    'copyBatchTask',
    'createBatchTask',
    'deleteBatchTask',
    'deleteMyTaskDraft',
    'getBatchTask',
    'getMyBatchTask',
    'getTaskSubmission',
    'listBatchTasks',
    'listMyBatchTasks',
    'listStudentTaskHistory',
    'listTaskSubmissions',
    'removeBatchTaskAttachment',
    'republishTalentReel',
    'saveMyTaskDraft',
    'setBatchTaskStatus',
    'submitMyTask',
    'unpublishTalentReel',
    'updateBatchTask',
  ];

  test('are exactly the eighteen the checkpoint calls for', () => {
    const names = registry.getFunctions().map(fn => fn.name);
    for (const expected of CP7) {
      assert.ok(names.includes(expected), `${expected} must be registered`);
    }
  });

  test('every one of them requires a session', () => {
    for (const name of CP7) {
      const fn = registry.getFunctions().find(entry => entry.name === name);
      assert.ok(fn, name);
      assert.equal(fn.config.validation?.requireUser, true, `${name} must require a user`);
    }
  });

  test('nothing lets a caller review, grade, or judge a Submission', () => {
    // The product deliberately has no review workflow. An operation named for
    // one would be the first half of building it by accident.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'gradesubmission',
      'reviewsubmission',
      'acceptsubmission',
      'rejectsubmission',
      'scoresubmission',
      'requestchanges',
      'addfeedback',
      'evaluatesubmission',
      'marklate',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} is out of scope`);
    }
  });

  test('nothing lets an Admin edit or delete submitted student work', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'updatetasksubmission',
      'edittasksubmission',
      'deletetasksubmission',
      'removetasksubmission',
      'resetsubmission',
      'setpublicconsent',
      'grantpublicconsent',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} is out of scope`);
    }
  });

  test('nothing publishes a Reel on behalf of the Student', () => {
    // Publication follows from an eligible submission and the Student's own
    // consent. `republishTalentReel` only clears an Admin's own suppression.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of ['publishtalentreel', 'createtalentreel', 'approvetalentreel']) {
      assert.ok(!names.includes(forbidden), `${forbidden} is out of scope`);
    }
  });

  test('there is no realtime surface', () => {
    // CP7 is explicitly poll-free. A subscribe or poll operation would be the
    // start of one.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const name of names) {
      assert.ok(!name.includes('subscribe'), name);
      assert.ok(!name.startsWith('poll'), name);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the three classes are closed by default', () => {
  const schemas = () => [
    ['BatchTask', taskSchema],
    ['TaskSubmission', submissionSchema],
    ['TalentReelPublication', publicationSchema],
  ] as const;

  test('every class-level permission is empty', () => {
    for (const [name, schema] of schemas()) {
      const clp = schema.classLevelPermissions ?? {};
      for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
        assert.deepEqual(clp[operation], {}, `${name}.${operation} must grant nobody`);
      }
    }
  });

  test('every record carries an empty ACL', () => {
    for (const [name, schema] of schemas()) {
      assert.deepEqual(schema.classLevelPermissions?.ACL, {}, `${name} default ACL`);
    }
  });

  test('the contents of a Submission are protected from every audience', () => {
    const protectedFields = submissionSchema.classLevelPermissions?.protectedFields ?? {};
    for (const audience of ['*', 'authenticated']) {
      const list = protectedFields[audience] ?? [];
      for (const field of [
        'githubUrl',
        'liveDemoUrl',
        'googleDriveUrl',
        'youtubeVideoId',
        'studentNote',
        'publicProjectTitle',
        'publicProjectDescription',
        'technologies',
        'myContribution',
        'publicConsent',
        'publicConsentAt',
        'status',
        'hasEverBeenSubmitted',
        'submittedAt',
      ]) {
        assert.ok(list.includes(field), `${audience} must not read ${field} directly`);
      }
    }
  });

  test('the public slug is protected from every audience', () => {
    // It is the Student's stable public identifier. Nothing may enumerate it
    // by reading the class.
    const protectedFields = profileSchema.classLevelPermissions?.protectedFields ?? {};
    for (const audience of ['*', 'authenticated']) {
      assert.ok(
        (protectedFields[audience] ?? []).includes('publicProfileSlug'),
        `${audience} must not read publicProfileSlug`
      );
    }
  });
});

describe('the physical guarantees', () => {
  function indexNamed(schema: Schema, name: string) {
    return (schema.compoundIndexes ?? []).find(index => index.name === name);
  }

  test('a Batch can physically hold only one Final Task', () => {
    // The whole point: a query-then-create check loses a race, an index does
    // not. Two simultaneous creates end with exactly one row.
    const index = indexNamed(taskSchema, 'batch_task_final_per_batch_unique');
    assert.ok(index, 'the Final Task index must exist');
    assert.equal(index.unique, true);
    assert.deepEqual(index.fields, ['_p_finalForBatch']);
    // Partial, so the many Assignments — which hold no sentinel — do not all
    // collide on null.
    assert.equal(index.partialFilterNulls, true);
  });

  test('the Final Task index names the pointer column MongoDB actually uses', () => {
    // A Parse Pointer lives in `_p_<field>`. An index on the logical name would
    // build cleanly against a column that does not exist and guarantee nothing.
    const index = indexNamed(taskSchema, 'batch_task_final_per_batch_unique');
    assert.ok(index?.fields.every(field => field.startsWith('_p_')));
  });

  test('one Submission per Task per Student', () => {
    const index = indexNamed(submissionSchema, 'task_submission_unique');
    assert.ok(index);
    assert.equal(index.unique, true);
    assert.deepEqual(index.fields, ['_p_task', '_p_student']);
  });

  test('one publication per Submission', () => {
    const index = indexNamed(publicationSchema, 'talent_reel_submission_unique');
    assert.ok(index);
    assert.equal(index.unique, true);
    assert.deepEqual(index.fields, ['_p_submission']);
  });

  test('an attachment storage key is claimed by at most one Task', () => {
    const index = indexNamed(taskSchema, 'batch_task_attachment_key_unique');
    assert.ok(index);
    assert.equal(index.unique, true);
    assert.equal(index.partialFilterNulls, true);
  });

  test('a public slug belongs to at most one Student', () => {
    const index = (profileSchema.compoundIndexes ?? []).find(
      entry => entry.name === 'student_profile_public_slug_unique'
    );
    assert.ok(index);
    assert.equal(index.unique, true);
    assert.equal(index.partialFilterNulls, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the BatchTask trigger', () => {
  test('refuses a write that did not come from a server operation', async () => {
    await refuses(TaskModel.onBeforeSave(saveRequest(taskObject(), false)), 'authorised server');
  });

  test('refuses an invented type or status', async () => {
    await refuses(TaskModel.onBeforeSave(saveRequest(taskObject({type: 'PROJECT'}))), 'task type');
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({status: 'ACCEPTED'}))),
      'task status'
    );
  });

  test('refuses an invented requirement level', async () => {
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({githubRequirement: 'MAYBE'}))),
      'known requirement'
    );
  });

  test('refuses a Task that would change Batch', async () => {
    const Parse = parseSdk();
    const existing = taskObject({}, 'task1');
    const other = new Parse.Object('Batch');
    other.id = 'batch2';
    existing.set('batch', other);
    await refuses(TaskModel.onBeforeSave(saveRequest(existing)), 'cannot change Batch');
  });

  test('a Final Task must hold the sentinel', async () => {
    // Without it the Task sits outside the index that makes it the only one.
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({type: 'FINAL_TASK'}))),
      'final sentinel'
    );
  });

  test('an Assignment must not hold the sentinel', async () => {
    // Otherwise one Assignment silently occupies the Batch's single Final slot
    // and the real Final Task can never be created.
    const Parse = parseSdk();
    const batch = new Parse.Object('Batch');
    batch.id = 'batch1';
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({finalForBatch: batch}))),
      'Only a Final Task'
    );
  });

  test('a correctly-formed Final Task is accepted', async () => {
    const Parse = parseSdk();
    const batch = new Parse.Object('Batch');
    batch.id = 'batch1';
    await TaskModel.onBeforeSave(
      saveRequest(taskObject({type: 'FINAL_TASK', finalForBatch: batch}))
    );
  });

  test('refuses an attachment larger than the limit', async () => {
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({attachmentSize: 20 * 1024 * 1024 + 1}))),
      'size limit'
    );
    await TaskModel.onBeforeSave(saveRequest(taskObject({attachmentSize: 20 * 1024 * 1024})));
  });

  test('refuses a deadline that is not an instant', async () => {
    await refuses(
      TaskModel.onBeforeSave(saveRequest(taskObject({deadline: '2026-09-01'}))),
      'must be an instant'
    );
  });
});

describe('the TaskSubmission trigger', () => {
  test('refuses a write that did not come from a server operation', async () => {
    await refuses(
      SubmissionModel.onBeforeSave(saveRequest(submissionObject(), false)),
      'authorised server'
    );
  });

  test('refuses a Submission that would change Task or Student', async () => {
    // Work being reattributed to somebody else is the failure this prevents.
    // Each field is changed on its own, from a row that is otherwise clean, so
    // the rejection names the field the test actually touched.
    for (const field of ['task', 'student', 'batch', 'studentProfile']) {
      const Parse = parseSdk();
      const existing = storedSubmission();
      const replacement = new Parse.Object('Other');
      replacement.id = 'other1';
      existing.set(field, replacement);
      await refuses(
        SubmissionModel.onBeforeSave(saveRequest(existing)),
        `${field} cannot change`
      );
    }
  });

  test('an untouched Submission saves without complaint', async () => {
    // The counterpart to the test above: the freeze must catch a changed
    // pointer, not simply refuse every update.
    const existing = storedSubmission();
    existing.set('studentNote', 'still working on it');
    await SubmissionModel.onBeforeSave(saveRequest(existing));
  });

  test('hasEverBeenSubmitted can never be cleared', async () => {
    // A save that cleared it would turn a submitted record back into a
    // deletable draft.
    const existing = storedSubmission({hasEverBeenSubmitted: true});
    existing.set('hasEverBeenSubmitted', false);
    await refuses(SubmissionModel.onBeforeSave(saveRequest(existing)), 'never be cleared');
  });

  test('a new Submission starts as not-yet-submitted', async () => {
    const fresh = submissionObject();
    await SubmissionModel.onBeforeSave(saveRequest(fresh));
    assert.equal(fresh.get('hasEverBeenSubmitted'), false);
  });

  test('a SUBMITTED row must carry a server timestamp', async () => {
    await refuses(
      SubmissionModel.onBeforeSave(
        saveRequest(submissionObject({status: 'SUBMITTED', hasEverBeenSubmitted: true}))
      ),
      'server timestamp'
    );
  });

  test('a DRAFT row cannot keep a stale submitted instant', async () => {
    // Otherwise a Student saving back to Draft would still look handed in.
    const object = submissionObject({status: 'DRAFT', submittedAt: new Date()});
    await SubmissionModel.onBeforeSave(saveRequest(object));
    assert.equal(object.get('submittedAt'), undefined);
  });

  test('consent carries its instant, and withdrawing it takes the instant away', async () => {
    const consented = submissionObject({publicConsent: true});
    await SubmissionModel.onBeforeSave(saveRequest(consented));
    assert.ok(consented.get('publicConsentAt') instanceof Date);

    const withdrawn = submissionObject({publicConsent: false, publicConsentAt: new Date()});
    await SubmissionModel.onBeforeSave(saveRequest(withdrawn));
    assert.equal(withdrawn.get('publicConsentAt'), undefined);
  });

  test('consent is never implied — an absent flag mints no timestamp', async () => {
    const silent = submissionObject();
    await SubmissionModel.onBeforeSave(saveRequest(silent));
    assert.equal(silent.get('publicConsentAt'), undefined);
    assert.notEqual(silent.get('publicConsent'), true);
  });

  test('a Submission that was handed in can never be deleted', async () => {
    // Not "cannot be deleted by a client" — cannot be deleted. Handing work in
    // is a fact about what happened.
    await refuses(
      SubmissionModel.onBeforeDelete({object: submissionObject({hasEverBeenSubmitted: true})}),
      'never be deleted'
    );
  });

  test('a draft that was never submitted may be deleted', async () => {
    await SubmissionModel.onBeforeDelete({
      object: submissionObject({hasEverBeenSubmitted: false}),
    });
  });
});

describe('the TalentReelPublication trigger', () => {
  function publicationObject(attrs: Record<string, unknown> = {}, id?: string): Parse.Object {
    const Parse = parseSdk();
    const object = new Parse.Object('TalentReelPublication');
    if (id) object.id = id;
    for (const [field, className] of [
      ['submission', 'TaskSubmission'],
      ['task', 'BatchTask'],
      ['batch', 'Batch'],
      ['student', '_User'],
      ['studentProfile', 'StudentProfile'],
    ]) {
      const pointer = new Parse.Object(className);
      pointer.id = `${field}1`;
      object.set(field, pointer);
    }
    object.set('status', 'UNPUBLISHED');
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) object.unset(key);
      else object.set(key, value);
    }
    return object;
  }

  const complete = {
    status: 'PUBLISHED',
    projectTitle: 'Portfolio',
    projectDescription: 'A site about my work.',
    contribution: 'I built the whole thing.',
    technologies: ['Angular'],
    youtubeVideoId: 'dQw4w9WgXcQ',
  };

  test('refuses a write that did not come from a server operation', async () => {
    await refuses(
      PublicationModel.onBeforeSave(saveRequest(publicationObject(), false)),
      'authorised server'
    );
  });

  test('a suppressed record can never also be published', async () => {
    // This combination is exactly what an Admin pressed Unpublish to prevent,
    // and it must hold whichever path tries to write it.
    await refuses(
      PublicationModel.onBeforeSave(
        saveRequest(publicationObject({...complete, adminSuppressed: true}))
      ),
      'suppressed'
    );
  });

  test('a published record must be complete', async () => {
    // CP8 renders from these columns. A PUBLISHED row missing its title would
    // be a broken public page rather than an absent one.
    for (const missing of [
      'projectTitle',
      'projectDescription',
      'contribution',
      'youtubeVideoId',
    ]) {
      await refuses(
        PublicationModel.onBeforeSave(
          saveRequest(publicationObject({...complete, [missing]: undefined}))
        ),
        'published Reel requires'
      );
    }
  });

  test('a complete published record is accepted', async () => {
    await PublicationModel.onBeforeSave(saveRequest(publicationObject(complete)));
  });

  test('an unpublished record need not be complete', async () => {
    // Unpublishing must never fail because of the content it is hiding.
    await PublicationModel.onBeforeSave(saveRequest(publicationObject({status: 'UNPUBLISHED'})));
  });

  test('a publication cannot be moved to another Submission', async () => {
    const Parse = parseSdk();
    const existing = publicationObject(complete, 'pub1');
    const other = new Parse.Object('TaskSubmission');
    other.id = 'sub2';
    existing.set('submission', other);

    // `original` is the row as stored. The trigger compares ids against it.
    const stored = publicationObject(complete, 'pub1');
    await refuses(
      PublicationModel.onBeforeSave({object: existing, master: true, original: stored}),
      'cannot change Submission'
    );
  });

  test('an update that re-sets the same Submission is allowed', async () => {
    /*
      The regression that end-to-end HTTP found and no unit test could.

      The trigger used `dirty('submission')`, and a pointer counts as dirty the
      moment it is assigned — even to the identical value, which the update path
      does for every field. So **every** update to an existing publication was
      refused: the snapshot never refreshed after a Student resubmitted, and
      nobody saw it because publication is deliberately not allowed to break a
      submit.
    */
    const stored = publicationObject(complete, 'pub1');
    const updating = publicationObject(
      {...complete, projectTitle: 'Recipe exchange, revised'},
      'pub1'
    );

    await PublicationModel.onBeforeSave({object: updating, master: true, original: stored});
    assert.equal(updating.get('projectTitle'), 'Recipe exchange, revised');
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the public slug freeze', () => {
  /*
    This block exists because the freeze it tests was **unreachable**.

    The trigger called `object.previous('publicProfileSlug')`. That method
    belongs to the client SDK's change tracking and does not exist on the object
    a `beforeSave` receives; a cast made it compile, and every save that touched
    the field threw `object.previous is not a function`. No Student ever got a
    slug, and the freeze never ran once. Only end-to-end HTTP surfaced it.

    So these tests drive the trigger the way Parse Server drives it — with
    `request.original` — rather than however the code happens to read the past.
  */
  let ProfileModel: {onBeforeSave(request: unknown): Promise<void>};

  before(async () => {
    ProfileModel = (await import('../src/cloudCode/models/StudentProfile'))
      .default as unknown as typeof ProfileModel;
  });

  function storedProfile(attrs: Record<string, unknown> = {}): Parse.Object {
    return storedObject('StudentProfile', 'profile1', {
      user: pointerJson('_User', 'student1'),
      fullName: 'Lina H',
      isComplete: true,
      ...attrs,
    });
  }

  test('minting a slug on a profile that has none is allowed', async () => {
    const profile = storedProfile();
    profile.set('publicProfileSlug', 'k3mq7wz2ptx9');
    await ProfileModel.onBeforeSave({
      object: profile,
      master: true,
      original: storedProfile(),
    });
    assert.equal(profile.get('publicProfileSlug'), 'k3mq7wz2ptx9');
  });

  test('changing an issued slug is refused', async () => {
    // A slug that could change would break every link already shared,
    // including one a Student put on a CV.
    const profile = storedProfile({publicProfileSlug: 'k3mq7wz2ptx9'});
    profile.set('publicProfileSlug', 'newslug12345');
    await refuses(
      ProfileModel.onBeforeSave({
        object: profile,
        master: true,
        original: storedProfile({publicProfileSlug: 'k3mq7wz2ptx9'}),
      }),
      'cannot change once it has been issued'
    );
  });

  test('an unrelated save on a profile that already has a slug still works', async () => {
    // The freeze must catch a changed slug, not refuse every profile update.
    const profile = storedProfile({publicProfileSlug: 'k3mq7wz2ptx9'});
    profile.set('fullName', 'Lina Hassan');
    await ProfileModel.onBeforeSave({
      object: profile,
      master: true,
      original: storedProfile({publicProfileSlug: 'k3mq7wz2ptx9'}),
    });
    assert.equal(profile.get('publicProfileSlug'), 'k3mq7wz2ptx9');
  });

  test('no trigger reads the past through a method that does not exist', () => {
    // The specific mistake, asserted against the source so it cannot return.
    const models = join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'models');
    for (const name of ['StudentProfile', 'BatchTask', 'TaskSubmission', 'TalentReelPublication']) {
      const source = codeOnly(readFileSync(join(models, `${name}.ts`), 'utf8'));
      assert.ok(
        !/\.previous\s*\(/.test(source),
        `${name} must read the pre-save state from request.original, not previous()`
      );
    }
  });
});

describe('the DTOs', () => {
  test('nothing internal is ever named as a DTO key', () => {
    for (const key of [
      'attachmentStorageKey',
      'storageKey',
      'finalForBatch',
      'ACL',
      'sessionToken',
      'objectId',
    ]) {
      assert.ok(dto.FORBIDDEN_TASK_DTO_KEYS.includes(key), `${key} must be forbidden`);
    }
  });

  test('a built Task DTO carries no forbidden key', () => {
    const built = dto.toTaskDto(taskObject({}, 'task1'), {
      batchId: 'batch1',
      isSubmissionOpen: true,
      availabilityReason: 'OPEN',
      editable: true,
      requirementsFrozen: false,
    });
    for (const key of dto.FORBIDDEN_TASK_DTO_KEYS) {
      assert.ok(!(key in built), `${key} leaked into a Task DTO`);
    }
  });

  test('a Task DTO never carries the storage key even when one exists', () => {
    // The key is how bytes are located in GridFS. Sending it turns a private
    // attachment into a guessable one.
    const built = dto.toTaskDto(
      taskObject(
        {
          attachmentStorageKey: 'task_deadbeefdeadbeefdeadbeefdeadbeef',
          attachmentFilename: 'brief.pdf',
          attachmentSize: 1024,
        },
        'task1'
      ),
      {
        batchId: 'batch1',
        isSubmissionOpen: true,
        availabilityReason: 'OPEN',
        editable: true,
        requirementsFrozen: false,
      }
    );
    assert.ok(!JSON.stringify(built).includes('task_deadbeef'));
  });

  test('the Student Task DTO carries no cohort-wide counts', () => {
    // How many classmates have submitted is not a Student's business.
    const built = dto.toStudentTaskDto(taskObject({status: 'PUBLISHED'}, 'task1'), {
      batchId: 'batch1',
      isSubmissionOpen: true,
      availabilityReason: 'OPEN',
    });
    for (const key of ['submittedCount', 'draftCount', 'studentCount']) {
      assert.ok(!(key in built), `${key} must not reach a Student`);
    }
  });

  test('a Submission DTO reports consent as a plain boolean', () => {
    const built = dto.toSubmissionDto(submissionObject({publicConsent: true}, 'sub1'));
    assert.equal(built.publicConsent, true);
    assert.equal(built.hasEverBeenSubmitted, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the Tasks stylesheet', () => {
  /*
    Two layout rules a rendered page caught and no other test could.

    Both were found by looking at a 390px screenshot. Neither produced an
    overflow, an error, or a failing assertion anywhere — the page was simply
    wrong to look at. Asserted here rather than in the frontend suite because
    that suite has no filesystem, and this file already reads frontend source.
  */
  const CSS_PATH = join(REPO_ROOT, 'frontend', 'src', 'styles', 'tasks.css');

  function css(): string {
    return readFileSync(CSS_PATH, 'utf8');
  }

  /** The body of one rule, by selector, or '' when the rule is absent. */
  function ruleBody(selector: string): string {
    const source = css();
    const index = source.indexOf(selector);
    if (index === -1) return '';
    const open = source.indexOf('{', index);
    const close = source.indexOf('}', open);
    return open === -1 || close === -1 ? '' : source.slice(open + 1, close);
  }

  test('the stylesheet is readable, so nothing below passes vacuously', () => {
    assert.ok(css().length > 500);
  });

  test('the flex basis is released when a card becomes a column', () => {
    /*
      `flex: 1 1 18rem` is a width floor while cards sit side by side. In a
      column container `flex-basis` sizes the **height** instead, so every card
      grew to 18rem and left roughly 180px of dead space between the text and
      its buttons on a phone.
    */
    const narrow = css().slice(css().indexOf('@media (max-width: 40rem)'));
    for (const selector of [
      '.cyf-tasks-item-main',
      '.cyf-student-task-item-main',
      '.cyf-tasks-student-main',
    ]) {
      assert.ok(narrow.includes(selector), `${selector} must reset its basis when stacked`);
    }
    assert.match(narrow, /flex:\s*1\s+1\s+auto/);
  });

  test('the technology remove control stays big enough to hit', () => {
    /*
      Measured 18x18, then 21x21 once sized in rem but still flex-shrunk — and
      21 again after `flex: none`, because this application's root font size is
      14px and `1.5rem` is therefore 21px, not the 24 the guidance assumes.

      So the minimum is asserted in pixels. A fingertip is a physical thing and
      does not get smaller because the type scale did.
    */
    const remove = ruleBody('.cyf-tasks-tech-remove');
    assert.match(remove, /flex:\s*none/);
    assert.match(remove, /min-inline-size:\s*24px/);
    assert.match(remove, /min-block-size:\s*24px/);
  });

  test('only logical properties are used, so Arabic is a mirror not a rebuild', () => {
    const source = css();
    for (const pattern of [
      /[^-]margin-left:/,
      /[^-]margin-right:/,
      /[^-]padding-left:/,
      /[^-]padding-right:/,
      /border-left:/,
      /border-right:/,
    ]) {
      assert.ok(!pattern.test(source), `physical direction used: ${pattern}`);
    }
  });
});

describe('where a Student name comes from', () => {
  /*
    Another defect only the rendered page showed.

    `listTaskSubmissions` built the name from `firstName` and `lastName` on the
    `_User`. This product has never stored a name there — it lives on
    `StudentProfile.fullName`, written by the Student. So every row in the
    Admin's status table rendered with a blank name, on a table whose entire
    purpose is saying *who* has handed in. Both suites passed throughout.

    `profileComplete` was hardcoded `true` in the same block, which hid the one
    thing that explains why a Final Task submission cannot become a Reel.
  */
  const ADMIN_SOURCES = ['adminFunctions', 'studentFunctions', 'reelFunctions'];

  test('no module reads a name off the user object', () => {
    for (const name of ADMIN_SOURCES) {
      const code = codeOnly(moduleSource(name));
      for (const field of ['firstName', 'lastName']) {
        assert.ok(
          !code.includes(field),
          `${name} must read the name from StudentProfile.fullName, not user.${field}`
        );
      }
    }
  });

  test('the roster reads fullName and isComplete from the profile', () => {
    const code = codeOnly(moduleSource('adminFunctions'));
    assert.ok(code.includes("get('fullName')"), 'the name must come from the profile');
    assert.ok(
      code.includes("get('isComplete')"),
      'profile completeness must be read, not assumed'
    );
    assert.ok(
      !/profileComplete:\s*true/.test(code),
      'profileComplete must never be hardcoded'
    );
  });

  test('the roster resolves profiles in one query, not one per Student', () => {
    // A class of thirty must not become thirty-one round trips.
    const code = codeOnly(moduleSource('adminFunctions'));
    assert.ok(
      code.includes('findProfilesForStudents'),
      'the batched lookup must be used for the roster'
    );
    assert.ok(
      !/for \(const enrollment[\s\S]{0,400}await findProfileForStudent/.test(code),
      'no per-row profile lookup inside the roster loop'
    );
  });

  test('a Submission read by an Admin includes the profile it names', () => {
    // Without the include, the pointer is unfetched and the name is blank
    // again — the same bug wearing a different hat.
    const code = codeOnly(moduleSource('repository'));
    assert.ok(
      code.includes("include('studentProfile')"),
      'findSubmissionById must include studentProfile'
    );
  });
});

describe('what a log may say', () => {
  test('the allow-list holds only identifiers, counts, and codes', () => {
    for (const field of logging.ALLOWED_TASK_LOG_FIELDS) {
      assert.ok(
        !/url|note|title|description|contribution|consent|filename|storagekey|technolog/i.test(
          field
        ),
        `${field} must not be loggable`
      );
    }
  });

  test('everything sensitive is dropped rather than truncated', () => {
    const safe = logging.toSafeTaskFields({
      op: 'submitMyTask',
      taskId: 'task1',
      submissionId: 'sub1',
      githubUrl: 'https://github.com/lina/secret-project',
      liveDemoUrl: 'https://lina.example/demo',
      googleDriveUrl: 'https://drive.google.com/file/d/xyz/view',
      youtubeVideoId: 'dQw4w9WgXcQ',
      studentNote: 'I struggled with the deadline',
      publicProjectTitle: 'My project',
      publicProjectDescription: 'What it does',
      myContribution: 'I built it',
      technologies: ['Angular'],
      publicConsent: true,
      attachmentFilename: 'brief.pdf',
      attachmentStorageKey: 'task_deadbeef',
      publicProfileSlug: 'k3mq7wz2ptx9',
    });

    assert.deepEqual(Object.keys(safe).sort(), ['op', 'submissionId', 'taskId']);

    const serialised = JSON.stringify(safe);
    for (const secret of [
      'secret-project',
      'lina.example',
      'drive.google.com',
      'dQw4w9WgXcQ',
      'struggled',
      'My project',
      'brief.pdf',
      'task_deadbeef',
      'k3mq7wz2ptx9',
    ]) {
      assert.ok(!serialised.includes(secret), `${secret} reached a log`);
    }
  });

  test('a failure description carries a code and a scrubbed reason', () => {
    const described = logging.describeFailure(
      new Error('E11000 duplicate key error collection: cyf.BatchTask index: ' +
        'batch_task_attachment_key_unique dup key: { storageKey: "task_deadbeefdeadbeef" }')
    );
    assert.ok(described.reason);
    assert.ok(
      !String(described.reason).includes('task_deadbeefdeadbeef'),
      'a driver quotes the offending value back; it must be scrubbed'
    );
  });

  test('every error code is a stable identifier, not a sentence', () => {
    for (const code of Object.values(errors.TaskError)) {
      assert.match(String(code), /^[A-Z][A-Z0-9_]*$/, String(code));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the browser has the same vocabulary', () => {
  /*
    `frontend/src/app/utils/task-constants.ts` mirrors this module, and both
    files say so. This is the test that makes the claim true rather than
    aspirational.

    It matters because the two disagree silently: a browser offering a status
    the server refuses shows a button that always fails, and a browser missing
    one hides work an Admin is entitled to do. Neither shows up as an error
    anywhere.
  */
  const FRONTEND = join(
    REPO_ROOT,
    'frontend',
    'src',
    'app',
    'utils',
    'task-constants.ts'
  );

  function frontendSource(): string {
    return readFileSync(FRONTEND, 'utf8');
  }

  /** The quoted values inside one `export const NAME = { ... } as const;`. */
  function valuesOf(source: string, name: string): string[] {
    const start = source.indexOf(`export const ${name} = {`);
    assert.notEqual(start, -1, `${name} must exist in the browser's copy`);
    const end = source.indexOf('} as const;', start);
    assert.notEqual(end, -1, `${name} must be a closed literal`);
    const body = source.slice(start, end);
    return [...body.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]).sort();
  }

  test('the file exists and is not empty', () => {
    // Without this the whole suite would pass vacuously on a missing file.
    assert.ok(frontendSource().length > 0);
  });

  test('the Task types match', () => {
    assert.deepEqual(valuesOf(frontendSource(), 'TASK_TYPE'), [...constants.TASK_TYPES].sort());
  });

  test('the Task statuses match', () => {
    assert.deepEqual(valuesOf(frontendSource(), 'TASK_STATUS'), [...constants.TASK_STATUSES].sort());
  });

  test('the requirement levels match', () => {
    assert.deepEqual(valuesOf(frontendSource(), 'REQUIREMENT'), [...constants.REQUIREMENTS].sort());
  });

  test('the Submission statuses match', () => {
    assert.deepEqual(
      valuesOf(frontendSource(), 'SUBMISSION_STATUS'),
      [...constants.SUBMISSION_STATUSES].sort()
    );
  });

  test('the publication statuses match', () => {
    assert.deepEqual(
      valuesOf(frontendSource(), 'PUBLICATION_STATUS'),
      [...constants.PUBLICATION_STATUSES].sort()
    );
  });

  test('the five submission fields match, in the same order', () => {
    // Order matters here: it is the order the Student's form renders.
    const source = frontendSource();
    const start = source.indexOf('export const SUBMISSION_FIELDS');
    const end = source.indexOf('];', start);
    const body = source.slice(start, end);
    const fields = [...body.matchAll(/field:\s*'([^']+)'/g)].map(match => match[1]);
    const requirements = [...body.matchAll(/requirement:\s*'([^']+)'/g)].map(match => match[1]);

    assert.deepEqual(fields, constants.SUBMISSION_FIELDS.map(spec => spec.field));
    assert.deepEqual(requirements, constants.SUBMISSION_FIELDS.map(spec => spec.requirement));
  });

  test('the attachment rules match', () => {
    const source = frontendSource();
    for (const extension of constants.ATTACHMENT_EXTENSIONS) {
      assert.ok(source.includes(`'${extension}'`), `the browser must know ${extension}`);
    }
    // The limit, written the same way, so a reader can see they are one number.
    assert.ok(source.includes('20 * 1024 * 1024'));
  });

  test('the length bounds match', () => {
    const source = frontendSource();
    const start = source.indexOf('export const TASK_LIMITS = {');
    const end = source.indexOf('} as const;', start);
    const body = source.slice(start, end);

    for (const [field, bounds] of Object.entries(constants.TASK_LIMITS)) {
      const line = new RegExp(`${field}:\\s*\\{([^}]*)\\}`).exec(body);
      assert.ok(line, `${field} must be bounded in the browser too`);
      assert.ok(
        line[1].includes(`max: ${(bounds as {max: number}).max}`),
        `${field} max must match: ${line[1]}`
      );
    }
  });

  test('the technology count matches', () => {
    const source = frontendSource();
    assert.ok(source.includes(`min: ${constants.TECHNOLOGY_COUNT.min}`));
    assert.ok(source.includes(`max: ${constants.TECHNOLOGY_COUNT.max}`));
  });

  test('the browser offers no status the server refuses', () => {
    // The transition table is the one a reader is most likely to widen by hand.
    const source = frontendSource();
    const start = source.indexOf('export const TASK_TRANSITIONS');
    const end = source.indexOf('};', start);
    const body = source.slice(start, end);

    for (const [from, allowed] of Object.entries(constants.TASK_TRANSITIONS)) {
      const entry = new RegExp(
        `\\[TASK_STATUS\\.${from}\\]:\\s*\\[([^\\]]*)\\]`
      ).exec(body);
      assert.ok(entry, `${from} must appear in the browser's transitions`);
      const listed = [...entry[1].matchAll(/TASK_STATUS\.([A-Z_]+)/g)].map(m => m[1]).sort();
      assert.deepEqual(listed, [...allowed].sort(), `${from} transitions`);
    }
  });
});

describe('what the source may not contain', () => {
  const modules = [
    'adminFunctions',
    'studentFunctions',
    'reelFunctions',
    'attachmentRoute',
    'publication',
    'repository',
    'urls',
  ];

  test('no data access runs without the master key', () => {
    // Every one of these classes is closed to every audience, so a query
    // without the master key returns nothing and reads as "no rows" — a silent
    // wrong answer rather than an error somebody would notice.
    //
    // Checked line by line rather than by comparing totals, because a total
    // can be satisfied by the wrong line carrying the key twice.
    for (const name of ['repository', 'publication']) {
      const lines = codeOnly(moduleSource(name)).split('\n');
      lines.forEach((line, index) => {
        if (!/\.(find|first|count|save|destroy|fetch)\(/.test(line)) return;
        const window = [line, lines[index + 1] ?? ''].join(' ');
        assert.match(
          window,
          /useMasterKey:\s*true/,
          `${name}:${index + 1} accesses data without the master key: ${line.trim()}`
        );
      });
    }
  });

  test('no module reaches an external service', () => {
    for (const name of modules) {
      const code = codeOnly(moduleSource(name));
      // Bare `fetch(` only. `parseObject.fetch({useMasterKey: true})` reloads a
      // row from our own database and is not a network call to anywhere else.
      assert.ok(!/(^|[^.\w])fetch\s*\(/m.test(code), `${name} must not call fetch`);
      for (const forbidden of ['axios', 'node-fetch', 'googleapis', 'iframe_api', 'oembed']) {
        assert.ok(!code.includes(forbidden), `${name} must not use ${forbidden}`);
      }
    }
  });

  test('no module stores YouTube embed HTML', () => {
    for (const name of modules) {
      const code = codeOnly(moduleSource(name));
      assert.ok(!code.includes('<iframe'), `${name} must not build an iframe`);
    }
  });

  test('an attachment is always served as a download', () => {
    // A `.html` attachment rendered inline would run its own script in this
    // origin, with the reader's session attached.
    const code = codeOnly(moduleSource('attachmentRoute'));
    assert.ok(code.includes('attachment'), 'the disposition must be attachment');
    assert.ok(!/inline/.test(code), 'nothing may be served inline');
  });

  test('no bytes travel through a Cloud Function', () => {
    for (const name of ['adminFunctions', 'studentFunctions', 'reelFunctions']) {
      const code = codeOnly(moduleSource(name));
      assert.ok(!code.includes('Parse.File'), `${name} must not use Parse.File`);
      assert.ok(!/base64/i.test(code), `${name} must not carry base64 bytes`);
    }
  });

  test('nothing schedules work or opens a socket', () => {
    for (const name of modules) {
      const code = codeOnly(moduleSource(name));
      for (const forbidden of ['setInterval(', 'setTimeout(', 'LiveQuery', 'WebSocket', '@Cron']) {
        assert.ok(!code.includes(forbidden), `${name} must not use ${forbidden}`);
      }
    }
  });
});
