/**
 * The Live Slides surface ⟨CP6⟩: registered operations, the three models' access
 * rules, the DTOs, the logging allow-list, and the immutability triggers.
 *
 * The triggers are exercised directly rather than through a database. They are
 * the whole immutability guarantee — "a submitted answer can never be changed"
 * is a property of `LiveResponse.onBeforeSave`, not of the operation that
 * happens to call it — so they deserve to be asserted where they live.
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
const MODULE_DIR = join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'LiveSlides');

function moduleSource(name: string): string {
  return readFileSync(join(MODULE_DIR, `${name}.ts`), 'utf8');
}

/** The same source with its comments removed — see the note in the CP5 suite. */
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
  compoundIndexes?: {fields: string[]; unique?: boolean; name?: string; partialFilterNulls?: boolean}[];
  classLevelPermissions?: {
    ACL?: Record<string, unknown>;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
};

let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;
let dto: typeof import('../src/cloudCode/modules/LiveSlides/dto');
let logging: typeof import('../src/cloudCode/modules/LiveSlides/logging');
let errors: typeof import('../src/cloudCode/modules/LiveSlides/errors');
let buildParseLogLine: typeof import('../src/cloudCode/utils/logging/safeLogger').buildParseLogLine;
let sessionSchema: Schema;
let slideSchema: Schema;
let responseSchema: Schema;
let SessionModel: {onBeforeSave(request: unknown): Promise<void>};
let SlideModel: {onBeforeSave(request: unknown): Promise<void>};
let ResponseModel: {
  onBeforeSave(request: unknown): Promise<void>;
  onBeforeDelete(): Promise<void>;
};

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  await import('../src/cloudCode/models/StudentProfile');
  const session = (await import('../src/cloudCode/models/LiveSlideSession')).default;
  const slide = (await import('../src/cloudCode/models/LiveSlide')).default;
  const response = (await import('../src/cloudCode/models/LiveResponse')).default;

  await import('../src/cloudCode/modules/LiveSlides/adminFunctions');
  await import('../src/cloudCode/modules/LiveSlides/presenterFunctions');
  await import('../src/cloudCode/modules/LiveSlides/studentFunctions');
  await import('../src/cloudCode/modules/LiveSlides/historyFunctions');

  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
  dto = await import('../src/cloudCode/modules/LiveSlides/dto');
  logging = await import('../src/cloudCode/modules/LiveSlides/logging');
  errors = await import('../src/cloudCode/modules/LiveSlides/errors');
  buildParseLogLine = (await import('../src/cloudCode/utils/logging/safeLogger')).buildParseLogLine;

  const kit = await import('@90soft/parse-server-kit');
  const get = (kit as unknown as {getSchemaDefinition: (t: unknown) => Schema}).getSchemaDefinition;
  sessionSchema = get(session);
  slideSchema = get(slide);
  responseSchema = get(response);

  SessionModel = session as unknown as typeof SessionModel;
  SlideModel = slide as unknown as typeof SlideModel;
  ResponseModel = response as unknown as typeof ResponseModel;
});

after(() => clearTrackedIntervals());

/** A trigger request double. */
function saveRequest(object: Parse.Object, master = true) {
  return {object, master, user: undefined};
}

function liveObject(className: string, attrs: Record<string, unknown>, id?: string): Parse.Object {
  const Parse = parseSdk();
  const object = new Parse.Object(className);
  if (id) object.id = id;
  for (const [key, value] of Object.entries(attrs)) object.set(key, value);
  return object;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('registered operations', () => {
  test('are exactly the eighteen the checkpoint calls for', () => {
    const names = registry.getFunctions().map(fn => fn.name).sort();
    assert.deepEqual(names, [
      'addLiveSlide',
      'createLiveSession',
      'deleteLiveSlide',
      'duplicateLiveSession',
      'duplicateLiveSlide',
      'endLiveSession',
      'getLiveSession',
      'getMyLiveState',
      'getPresenterState',
      'getResultsByQuestion',
      'getResultsByStudent',
      'listLiveResponses',
      'listLiveSessions',
      'listMyLiveResponses',
      'listStudentLiveAnswers',
      'markLiveSessionReady',
      'nextLiveSlide',
      'previousLiveSlide',
      'reorderLiveSlides',
      'returnLiveSessionToDraft',
      'startLiveSession',
      'submitLiveResponse',
      'updateLiveSession',
      'updateLiveSlide',
    ]);
  });

  test('every one of them requires a session', () => {
    for (const fn of registry.getFunctions()) {
      assert.equal(fn.config.validation?.requireUser, true, `${fn.name} must require a user`);
    }
  });

  test('there is no way to edit or delete a submitted answer', () => {
    // The whole product promise, asserted against the registered surface.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'updateliveresponse',
      'editliveresponse',
      'deleteliveresponse',
      'removeliveresponse',
      'withdrawresponse',
      'correctresponse',
      'amendresponse',
      'deletelivesession',
      'deleteresponses',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  test('no operation scores, grades, or evaluates anything', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'score',
      'grade',
      'evaluate',
      'mark',
      'rank',
      'feedback',
      'correct',
      'recommend',
      'analyse',
      'analyze',
      'export',
      'attendance',
    ]) {
      // `markLiveSessionReady` legitimately contains "mark"; the check is for a
      // name that is *about* marking work.
      const offenders = names.filter(
        name => name.includes(forbidden) && name !== 'marklivesessionready'
      );
      assert.deepEqual(offenders, [], `${forbidden} belongs to no part of this product`);
    }
  });

  test('no Student-facing operation accepts another Student', () => {
    // The Student surface resolves the caller from their session token, so
    // there is no id to point at somebody else.
    for (const name of ['getMyLiveState', 'submitLiveResponse', 'listMyLiveResponses']) {
      const fields = Object.keys(registry.getFunction(name)?.config.validation?.fields ?? {});
      for (const forbidden of ['studentId', 'studentProfileId', 'userId', 'student']) {
        assert.ok(!fields.includes(forbidden), `${name} must not accept ${forbidden}`);
      }
    }
  });

  test('no operation accepts a server-owned field', () => {
    for (const fn of registry.getFunctions()) {
      const fields = Object.keys(fn.config.validation?.fields ?? {});
      for (const forbidden of ['submittedAt', 'lockedAt', 'startedBy', 'status', 'liveForBatch']) {
        assert.ok(!fields.includes(forbidden), `${fn.name} must not accept ${forbidden}`);
      }
    }
  });

  test('no future product operation was added', () => {
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const future of ['task', 'pinned', 'reel', 'chat', 'reaction', 'meeting', 'qrcode']) {
      assert.ok(!names.some(name => name.includes(future)), `${future} is a later checkpoint`);
    }
  });
});

describe('model access rules', () => {
  const schemas = () => [
    ['LiveSlideSession', sessionSchema],
    ['LiveSlide', slideSchema],
    ['LiveResponse', responseSchema],
  ] as const;

  test('every class denies every client operation', () => {
    for (const [name, schema] of schemas()) {
      const clp = schema.classLevelPermissions!;
      for (const operation of ['find', 'get', 'count', 'create', 'update', 'delete']) {
        assert.deepEqual(clp[operation], {}, `${name}.${operation} must grant nobody`);
      }
    }
  });

  test('every class has an empty default object ACL', () => {
    for (const [name, schema] of schemas()) {
      assert.deepEqual(schema.classLevelPermissions!.ACL ?? {}, {}, name);
    }
  });

  test('every column of every class is protected from both audiences', () => {
    for (const [name, schema] of schemas()) {
      const protectedFields = schema.classLevelPermissions!.protectedFields!;
      const declared = Object.keys(schema.fields);
      for (const audience of ['*', 'authenticated']) {
        for (const field of declared) {
          assert.ok(
            protectedFields[audience].includes(field),
            `${name}.${field} must be hidden from '${audience}'`
          );
        }
      }
    }
  });

  test('a Student answer is unreadable even to an authenticated query', () => {
    const protectedFields = responseSchema.classLevelPermissions!.protectedFields!;
    for (const field of ['textAnswer', 'selectedOptionId', 'selectedOptionIds', 'student']) {
      assert.ok(protectedFields['authenticated'].includes(field), field);
    }
  });

  test('no model declares a score, a correct answer, or an image', () => {
    for (const [name, schema] of schemas()) {
      const declared = Object.keys(schema.fields).map(field => field.toLowerCase());
      for (const forbidden of [
        'score',
        'grade',
        'correctanswer',
        'iscorrect',
        'feedback',
        'evaluation',
        'rating',
        'image',
        'file',
        'attachment',
        'notes',
        'metadata',
        'extra',
      ]) {
        assert.ok(!declared.includes(forbidden), `${name} must not store ${forbidden}`);
      }
    }
  });

  test('the session stores exactly the approved columns', () => {
    assert.deepEqual(Object.keys(sessionSchema.fields).sort(), [
      'batch',
      'completedAt',
      'createdBy',
      'currentSlide',
      'currentSlideIndex',
      'description',
      'liveForBatch',
      'sessionDate',
      'startedAt',
      'startedBy',
      'status',
      'title',
    ]);
  });

  test('the response stores exactly the approved columns', () => {
    assert.deepEqual(Object.keys(responseSchema.fields).sort(), [
      'answerType',
      'batch',
      'selectedOptionId',
      'selectedOptionIds',
      'session',
      'slide',
      'student',
      'studentProfile',
      'submittedAt',
      'textAnswer',
    ]);
  });
});

describe('the physical guarantees', () => {
  test('one LIVE session per Batch is a unique partial index', () => {
    const index = (sessionSchema.compoundIndexes ?? []).find(entry =>
      entry.fields.includes('_p_liveForBatch')
    );
    assert.ok(index, 'the live sentinel must be indexed');
    assert.equal(index!.unique, true, 'it must be unique, or two starts could both win');
    assert.equal(
      index!.partialFilterNulls,
      true,
      'every non-live row must sit outside the index or it would collide'
    );
  });

  test('one response per Student per Question is a unique compound index', () => {
    const index = (responseSchema.compoundIndexes ?? []).find(
      entry => entry.name === 'live_response_unique'
    );
    assert.ok(index, 'the uniqueness index must exist');
    assert.equal(index!.unique, true);
    assert.deepEqual(index!.fields, ['_p_session', '_p_slide', '_p_student']);
  });

  test('the profile answer history is indexed for its own query', () => {
    const index = (responseSchema.compoundIndexes ?? []).find(entry =>
      entry.fields.includes('_p_studentProfile')
    );
    assert.ok(index, 'the history query must be backed by an index');
    assert.deepEqual(index!.fields, ['_p_studentProfile', 'submittedAt']);
  });

  test('the presenter and results queries are indexed', () => {
    assert.ok(
      (slideSchema.compoundIndexes ?? []).some(
        entry => entry.fields.join() === '_p_session,displayOrder'
      ),
      'slides by session and order'
    );
    assert.ok(
      (responseSchema.compoundIndexes ?? []).some(
        entry => entry.fields.join() === '_p_session,_p_slide'
      ),
      'responses by session and slide'
    );
    assert.ok(
      (sessionSchema.compoundIndexes ?? []).some(
        entry => entry.fields.join() === '_p_batch,status'
      ),
      'sessions by batch and status'
    );
  });

  test('every pointer index names the MongoDB column, not the logical field', () => {
    // Indexing `session` rather than `_p_session` indexes a column that does
    // not exist — an index that looks present and does nothing.
    for (const schema of [sessionSchema, slideSchema, responseSchema]) {
      for (const index of schema.compoundIndexes ?? []) {
        for (const field of index.fields) {
          for (const pointer of ['session', 'slide', 'student', 'batch', 'studentProfile']) {
            assert.notEqual(field, pointer, `${field} must be indexed as _p_${field}`);
          }
        }
      }
    }
  });
});

describe('a submitted answer can never change', () => {
  test('the trigger refuses an update, even with the master key', () => {
    const existing = liveObject('LiveResponse', {textAnswer: 'edited'}, 'response-1');
    // Not "refused for clients" — refused. An Admin cannot do this either.
    return assert.rejects(
      () => ResponseModel.onBeforeSave(saveRequest(existing, true)),
      (error: unknown) => {
        assert.match((error as Error).message, /can never be changed/);
        return true;
      }
    );
  });

  test('the trigger refuses every deletion', () =>
    assert.rejects(
      () => ResponseModel.onBeforeDelete(),
      (error: unknown) => {
        assert.match((error as Error).message, /can never be deleted/);
        return true;
      }
    ));

  test('a client write is refused outright', () => {
    const fresh = liveObject('LiveResponse', {});
    return assert.rejects(() => ResponseModel.onBeforeSave(saveRequest(fresh, false)));
  });

  test('a new response must carry every pointer and a server timestamp', async () => {
    const Parse = parseSdk();
    const incomplete = liveObject('LiveResponse', {answerType: 'POLL'});
    await assert.rejects(() => ResponseModel.onBeforeSave(saveRequest(incomplete)));

    const complete = liveObject('LiveResponse', {
      session: liveObject('LiveSlideSession', {}, 's1'),
      slide: liveObject('LiveSlide', {}, 'sl1'),
      batch: liveObject('Batch', {}, 'b1'),
      student: liveObject('_User', {}, 'u1'),
      studentProfile: liveObject('StudentProfile', {}, 'p1'),
      answerType: 'POLL',
      submittedAt: new Date(),
    });
    await ResponseModel.onBeforeSave(saveRequest(complete));
    assert.ok(complete.getACL() instanceof Parse.ACL, 'the record ACL must be locked down');
  });

  test('an unapproved answer type cannot be stored', async () => {
    const bad = liveObject('LiveResponse', {
      session: liveObject('LiveSlideSession', {}, 's1'),
      slide: liveObject('LiveSlide', {}, 'sl1'),
      batch: liveObject('Batch', {}, 'b1'),
      student: liveObject('_User', {}, 'u1'),
      studentProfile: liveObject('StudentProfile', {}, 'p1'),
      answerType: 'ESSAY',
      submittedAt: new Date(),
    });
    await assert.rejects(() => ResponseModel.onBeforeSave(saveRequest(bad)));
  });
});

describe('the session and slide triggers', () => {
  test('a session refuses a client write', () =>
    assert.rejects(() =>
      SessionModel.onBeforeSave(saveRequest(liveObject('LiveSlideSession', {}), false))
    ));

  test('a session must carry a known status', async () => {
    const base = {
      batch: liveObject('Batch', {}, 'b1'),
      createdBy: liveObject('_User', {}, 'u1'),
      title: 'First meeting',
      sessionDate: new Date(),
    };
    await assert.rejects(() =>
      SessionModel.onBeforeSave(saveRequest(liveObject('LiveSlideSession', {...base, status: 'paused'})))
    );
    await SessionModel.onBeforeSave(
      saveRequest(liveObject('LiveSlideSession', {...base, status: 'draft'}))
    );
  });

  test('only a live session may hold the Batch live sentinel', async () => {
    const base = {
      batch: liveObject('Batch', {}, 'b1'),
      createdBy: liveObject('_User', {}, 'u1'),
      title: 'First meeting',
      sessionDate: new Date(),
    };

    // Live without the sentinel would escape the uniqueness index.
    await assert.rejects(
      () => SessionModel.onBeforeSave(saveRequest(liveObject('LiveSlideSession', {...base, status: 'live'}))),
      /live sentinel/
    );

    // Completed while still holding it would keep the Batch's slot occupied
    // for good.
    await assert.rejects(
      () =>
        SessionModel.onBeforeSave(
          saveRequest(
            liveObject('LiveSlideSession', {
              ...base,
              status: 'completed',
              liveForBatch: liveObject('Batch', {}, 'b1'),
            })
          )
        ),
      /sentinel/
    );
  });

  test('a Slide carries the fields of its own type and no others', async () => {
    const information = liveObject('LiveSlide', {
      session: liveObject('LiveSlideSession', {}, 's1'),
      type: 'INFORMATION',
      title: 'How today works',
      content: 'The Admin controls the slides.',
      displayOrder: 0,
      // Left over from an earlier edit.
      question: 'stale',
      answerType: 'POLL',
      options: [{id: 'x', text: 'y'}],
      lockedAt: new Date(),
    });
    await SlideModel.onBeforeSave(saveRequest(information));

    for (const foreign of ['question', 'answerType', 'options', 'lockedAt']) {
      assert.equal(information.get(foreign), undefined, `${foreign} must be cleared`);
    }

    const question = liveObject('LiveSlide', {
      session: liveObject('LiveSlideSession', {}, 's1'),
      type: 'QUESTION',
      question: 'Which role interests you?',
      answerType: 'SINGLE_CHOICE',
      options: [{id: 'a', text: 'Frontend'}, {id: 'b', text: 'Backend'}],
      displayOrder: 1,
      title: 'stale',
      content: 'stale',
    });
    await SlideModel.onBeforeSave(saveRequest(question));
    assert.equal(question.get('title'), undefined);
    assert.equal(question.get('content'), undefined);
  });

  test('a choice Question cannot be stored with fewer than two options', () =>
    assert.rejects(() =>
      SlideModel.onBeforeSave(
        saveRequest(
          liveObject('LiveSlide', {
            session: liveObject('LiveSlideSession', {}, 's1'),
            type: 'QUESTION',
            question: 'Which role?',
            answerType: 'POLL',
            options: [{id: 'a', text: 'Only one'}],
            displayOrder: 0,
          })
        )
      )
    ));
});

describe('the safe DTOs', () => {
  function fakeSlide(attrs: Record<string, unknown>): Parse.Object {
    return liveObject('LiveSlide', attrs, 'slide-1');
  }

  const questionSlide = () =>
    fakeSlide({
      type: 'QUESTION',
      question: 'Which role interests you?',
      description: 'Pick one',
      answerType: 'SINGLE_CHOICE',
      options: [{id: 'opt_a', text: 'Frontend'}, {id: 'opt_b', text: 'Backend'}],
      displayOrder: 2,
      lockedAt: new Date(),
    });

  test('a Slide DTO carries no ACL, no raw object, and no session pointer', () => {
    const result = dto.toSlideDto(questionSlide()) as unknown as Record<string, unknown>;
    for (const forbidden of dto.FORBIDDEN_LIVE_DTO_KEYS) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
  });

  test("a Student's Slide DTO carries no counts and no lock instant", () => {
    const result = dto.toStudentSlideDto(questionSlide()) as unknown as Record<string, unknown>;
    for (const forbidden of ['lockedAt', 'displayOrder', 'submitted', 'unanswered', 'responses']) {
      assert.equal(forbidden in result, false, `${forbidden} must not reach a Student`);
    }
    // They do learn whether it is closed, which is the one state they need.
    assert.equal(result['locked'], true);
  });

  test("a Student's own response DTO names nobody", () => {
    const response = liveObject('LiveResponse', {
      slide: fakeSlide({}),
      answerType: 'SINGLE_CHOICE',
      selectedOptionId: 'opt_a',
      submittedAt: new Date(),
    });
    const result = dto.toStudentResponseDto(response, questionSlide()) as unknown as Record<
      string,
      unknown
    >;
    for (const forbidden of ['studentId', 'studentName', 'student', 'id', 'studentProfile']) {
      assert.equal(forbidden in result, false, `${forbidden} must not appear`);
    }
    assert.deepEqual(result['selectedOptionLabels'], ['Frontend']);
  });

  test('an Admin response DTO carries a display name and never an email', () => {
    const response = liveObject(
      'LiveResponse',
      {
        slide: fakeSlide({}),
        student: liveObject('_User', {email: 'lina@example.com'}, 'u1'),
        answerType: 'SHORT_ANSWER',
        textAnswer: 'Backend Developer',
        submittedAt: new Date(),
      },
      'r1'
    );
    const result = dto.toAdminResponseDto(response, questionSlide(), 'Lina Haddad');
    assert.equal(result.studentName, 'Lina Haddad');
    assert.ok(!JSON.stringify(result).includes('lina@example.com'));
  });

  test('a tally reports counts and whole-number percentages of answers given', () => {
    const slide = questionSlide();
    const rows = [
      liveObject('LiveResponse', {selectedOptionId: 'opt_a'}),
      liveObject('LiveResponse', {selectedOptionId: 'opt_a'}),
      liveObject('LiveResponse', {selectedOptionId: 'opt_b'}),
    ];
    const tally = dto.tallyOptions(slide, rows);
    assert.deepEqual(
      tally.map(entry => [entry.text, entry.count, entry.percent]),
      [
        ['Frontend', 2, 67],
        ['Backend', 1, 33],
      ]
    );
  });

  test('a tally with no answers is zero, not a division by zero', () => {
    const tally = dto.tallyOptions(questionSlide(), []);
    assert.deepEqual(
      tally.map(entry => entry.percent),
      [0, 0]
    );
  });

  test('a multiple-choice tally counts every selection', () => {
    const slide = questionSlide();
    const rows = [
      liveObject('LiveResponse', {selectedOptionIds: ['opt_a', 'opt_b']}),
      liveObject('LiveResponse', {selectedOptionIds: ['opt_a']}),
    ];
    const tally = dto.tallyOptions(slide, rows);
    // Two people, three selections. Percentages are of people, so they sum past
    // 100 — which is correct, and why the reader is told the count separately.
    assert.deepEqual(
      tally.map(entry => [entry.count, entry.percent]),
      [
        [2, 100],
        [1, 50],
      ]
    );
  });
});

describe('the logging allow-list', () => {
  test('names no field a question or an answer could travel in', () => {
    for (const forbidden of [
      'question',
      'content',
      'description',
      'options',
      'answer',
      'textAnswer',
      'selectedOptionId',
      'selectedOptionIds',
      'title',
      'studentName',
      'email',
      'responses',
      'unansweredNames',
    ]) {
      assert.ok(
        !logging.ALLOWED_LIVE_LOG_FIELDS.includes(forbidden),
        `${forbidden} must never be loggable`
      );
    }
  });

  test('an answer type is loggable; an answer is not', () => {
    // Knowing a poll was answered tells an operator what happened and tells
    // them nothing about who voted for what.
    assert.ok(logging.ALLOWED_LIVE_LOG_FIELDS.includes('answerType'));
    assert.ok(!logging.ALLOWED_LIVE_LOG_FIELDS.includes('answerValue'));
  });

  test('drops anything not on the list rather than passing it through', () => {
    const safe = logging.toSafeLiveFields({
      op: 'submitLiveResponse',
      sessionId: 's1',
      textAnswer: 'I want to become a backend developer',
      question: 'Why software development?',
      options: [{id: 'a', text: 'Frontend'}],
      studentName: 'Lina Haddad',
    });
    assert.deepEqual(Object.keys(safe).sort(), ['op', 'sessionId']);
  });

  test('the failure reason is scrubbed before it can be written', () => {
    const driver = Object.assign(
      new Error('E11000 duplicate key … dup key: { textAnswer: "I chose backend" }'),
      {code: 11000}
    );
    const described = logging.describeFailure(driver);
    assert.equal(described.parseCode, 11000);

    const line = buildParseLogLine('error', 'Storing a response failed', {
      op: 'submitLiveResponse',
      ...described,
    });
    assert.ok(!line.includes('I chose backend'), `an answer leaked: ${line}`);
    assert.ok(line.includes('11000'), 'the code stays diagnosable');
  });
});

describe('failure codes', () => {
  test('are exactly the sixteen the checkpoint specifies', () => {
    assert.deepEqual([...errors.LIVE_SLIDES_ERROR_CODES].sort(), [
      'ALREADY_SUBMITTED',
      'ANSWER_OPTION_INVALID',
      'ANSWER_TYPE_MISMATCH',
      'LIVE_RESPONSE_FAILED',
      'LIVE_SESSION_ALREADY_ACTIVE',
      'LIVE_SESSION_COMPLETED',
      'LIVE_SESSION_NOT_ACTIVE',
      'LIVE_SESSION_NOT_EDITABLE',
      'LIVE_SESSION_NOT_FOUND',
      'LIVE_SESSION_NOT_READY',
      'LIVE_SESSION_VALIDATION_FAILED',
      'LIVE_SLIDE_NOT_FOUND',
      'LIVE_SLIDE_VALIDATION_FAILED',
      'NOT_ENROLLED',
      'PROFILE_INCOMPLETE',
      'QUESTION_CLOSED',
    ]);
  });

  test('a raised error carries the code and nothing a driver said', () => {
    const raised = errors.liveSlidesError(errors.LiveSlidesError.QUESTION_CLOSED);
    assert.equal(raised.message, 'QUESTION_CLOSED');
  });

  test('a validation failure carries field names and reasons, never values', () => {
    const raised = errors.liveSlidesError(errors.LiveSlidesError.LIVE_SLIDE_VALIDATION_FAILED, {
      question: 'TOO_LONG',
    });
    assert.ok(raised.message.startsWith('LIVE_SLIDE_VALIDATION_FAILED:'));
    assert.ok(raised.message.includes('TOO_LONG'));
  });
});

describe('what the source guarantees', () => {
  test('the Student surface never queries another Student', () => {
    const source = codeOnly(moduleSource('studentFunctions'));
    // Every response query is scoped by the resolved `student` object.
    assert.ok(
      !/params\[['"]studentId['"]\]/.test(source),
      'the Student surface must not read a studentId parameter'
    );
    assert.ok(source.includes('requireStudent'), 'it must resolve the caller from their session');
  });

  test('locking happens before the slide moves', () => {
    // Scoped to `moveSlide`, which is the function that navigates. Comparing
    // indices across the whole file would instead find `startLiveSession`'s
    // pointer — which is earlier in the file and has nothing to do with this.
    const source = codeOnly(moduleSource('presenterFunctions'));
    const start = source.indexOf('async function moveSlide');
    assert.ok(start > 0, 'the navigation function must exist');

    const body = source.slice(start);
    const lockAt = body.indexOf('await lockSlide');
    const moveAt = body.indexOf('currentSlide: pointerTo');

    assert.ok(lockAt > 0, 'navigation must lock the current Question');
    assert.ok(moveAt > 0, 'navigation must move the current Slide');
    assert.ok(lockAt < moveAt, 'the question must close before the slide changes');
  });

  test('ending a session locks the current Question and frees the Batch slot', () => {
    const source = codeOnly(moduleSource('presenterFunctions'));
    const start = source.indexOf('async endLiveSession');
    const body = source.slice(start, source.indexOf('/** Every submitted answer', start));

    assert.ok(body.includes('await lockSlide'), 'ending must close the open Question');
    assert.ok(
      body.includes('liveForBatch: undefined'),
      'completing must release the sentinel, or the Batch keeps its one live slot forever'
    );
  });

  test('the submission path re-reads the lock immediately before writing', () => {
    const source = codeOnly(moduleSource('studentFunctions'));
    const lockCheck = source.indexOf("slide.get('lockedAt')");
    const write = source.indexOf('await createResponse');
    assert.ok(lockCheck > 0 && write > lockCheck, 'the lock must be checked before the write');
  });

  test('the answer type is copied from the Slide, never from the request', () => {
    const source = codeOnly(moduleSource('studentFunctions'));
    assert.ok(
      source.includes("answerType: String(slide.get('answerType'))"),
      'the stored type must come from the Slide'
    );
  });

  test('nothing in the module creates a response for a Student who said nothing', () => {
    // "No Answer" is derived. Empty rows would make the uniqueness index
    // meaningless and turn silence into something that looks like a submission.
    for (const name of ['presenterFunctions', 'studentFunctions', 'repository']) {
      const source = codeOnly(moduleSource(name));
      assert.ok(
        !/createResponse\([^)]*unanswered/s.test(source),
        `${name} must not write empty responses`
      );
    }
  });

  test('every registered operation has its payload omitted from Parse logs', async () => {
    // The list in `redact.ts` is what keeps questions and answers out of Parse
    // Server's own call logs. This assertion is what keeps the list complete:
    // add a nineteenth operation without adding it there and the build fails,
    // rather than the operation quietly logging everything it returns.
    //
    // An earlier version of that code matched names with a regular expression
    // and silently missed `getPresenterState` and `getResultsByQuestion` —
    // whose results carry every answer in the room and the name of the Student
    // who gave each one.
    const {OMITTED_PAYLOAD_SUBJECTS} = await import('../src/cloudCode/utils/logging/redact');

    for (const fn of registry.getFunctions()) {
      assert.ok(
        OMITTED_PAYLOAD_SUBJECTS.includes(fn.name),
        `${fn.name} must be listed in OMITTED_PAYLOAD_SUBJECTS, or Parse will log its payload`
      );
    }
  });

  test('every model class has its trigger payload omitted too', async () => {
    const {OMITTED_PAYLOAD_SUBJECTS} = await import('../src/cloudCode/utils/logging/redact');
    for (const className of ['LiveSlideSession', 'LiveSlide', 'LiveResponse']) {
      assert.ok(OMITTED_PAYLOAD_SUBJECTS.includes(className), className);
    }
  });

  test('no realtime subscription exposes a raw class', () => {
    // LiveQuery would deliver raw Parse objects, which §11 forbids outright.
    for (const name of ['adminFunctions', 'presenterFunctions', 'studentFunctions']) {
      const source = codeOnly(moduleSource(name));
      for (const forbidden of ['Parse.LiveQuery', 'subscribe(', 'liveQueryClient']) {
        assert.ok(!source.includes(forbidden), `${name} must not open a raw subscription`);
      }
    }
  });
});
