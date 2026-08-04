/**
 * What a real log line says about a Task, a Submission, and a Talent Reel ⟨CP7⟩.
 *
 * The other CP7 suites assert the allow-list. This one asserts the thing the
 * allow-list exists for: that log lines built the way Parse Server actually
 * builds them — with the payload attached, the way a driver quotes a value back
 * — carry none of a Student's work.
 *
 * The sensitive set here is unusually broad. A Student's submission is a link
 * to their code, a link to their portfolio, a note about how the work went, and
 * the description they wrote for a public page. None of it belongs in a file an
 * operator tails, and several of the URLs are private links that the product
 * never publishes at all.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let redact: typeof import('../src/cloudCode/utils/logging/redact');
let buildParseLogLine: typeof import('../src/cloudCode/utils/logging/safeLogger').buildParseLogLine;
let taskLogging: typeof import('../src/cloudCode/modules/BatchTask/logging');

/** Everything a CP7 log line must never contain, and where it comes from. */
const SECRETS = {
  githubUrl: 'https://github.com/lina-h/final-capstone-private',
  liveDemoUrl: 'https://lina-h.github.io/capstone/',
  googleDriveUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view',
  youtubeVideoId: 'dQw4w9WgXcQ',
  studentNote: 'I ran out of time on the tests and the deadline was hard for me.',
  publicProjectTitle: 'Neighbourhood Recipe Exchange',
  publicProjectDescription: 'A place for people on one street to swap recipes.',
  myContribution: 'I designed the schema and wrote the whole Angular front end.',
  technologies: ['Angular', 'Parse Server', 'MongoDB'],
  publicConsent: true,
  attachmentFilename: 'capstone-brief-final-v3.pdf',
  attachmentStorageKey: 'task_9f2c1b7a4e6d8c0f3a5b2d4e6f8a0c1b',
  publicProfileSlug: 'k3mq7wz2ptx9',
};

/** The literal substrings that must never appear in any output. */
const FORBIDDEN_SUBSTRINGS = [
  'final-capstone-private',
  'lina-h.github.io',
  '1AbCdEfGhIjKlMnOp',
  'dQw4w9WgXcQ',
  'ran out of time',
  'Neighbourhood Recipe Exchange',
  'swap recipes',
  'wrote the whole Angular front end',
  'capstone-brief-final-v3',
  '9f2c1b7a4e6d8c0f3a5b2d4e6f8a0c1b',
  'k3mq7wz2ptx9',
];

function assertClean(output: string, context: string): void {
  for (const secret of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!output.includes(secret), `${context} leaked "${secret}"`);
  }
}

before(async () => {
  installParseTestGlobal();
  redact = await import('../src/cloudCode/utils/logging/redact');
  buildParseLogLine = (await import('../src/cloudCode/utils/logging/safeLogger')).buildParseLogLine;
  taskLogging = await import('../src/cloudCode/modules/BatchTask/logging');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('the key names are recognised as sensitive', () => {
  test('every CP7 field that carries the work of a Student is masked by name', () => {
    for (const key of Object.keys(SECRETS)) {
      assert.equal(redact.isSensitiveKey(key), true, `${key} must be treated as sensitive`);
    }
  });

  test('case and casing style do not matter', () => {
    // Parse and Mongo both hand back keys in shapes this code did not choose.
    for (const key of [
      'githubURL',
      'GITHUBURL',
      'student_note',
      'youtube_video_id',
      'attachment_storage_key',
      'publicProfileSLUG',
    ]) {
      assert.equal(redact.isSensitiveKey(key), true, key);
    }
  });

  test('the identifiers an operator needs are not masked', () => {
    // Redaction that swallowed the ids would make every failure undiagnosable,
    // which is its own kind of broken.
    for (const key of ['taskId', 'submissionId', 'batchId', 'studentId', 'status', 'op', 'code']) {
      assert.equal(redact.isSensitiveKey(key), false, `${key} must stay readable`);
    }
  });
});

describe('a whole payload', () => {
  test('survives redaction with nothing readable left', () => {
    const output = JSON.stringify(redact.redactMeta({...SECRETS}));
    assertClean(output, 'redactMeta');
  });

  test('is masked however deeply it is nested', () => {
    // Parse Server attaches request bodies at depths this code does not pick.
    const output = JSON.stringify(
      redact.redactMeta({
        request: {body: {params: {submission: {...SECRETS}}}},
        results: [{fields: {...SECRETS}}],
      })
    );
    assertClean(output, 'nested redactMeta');
  });

  test('is masked when the whole thing arrives as one string', () => {
    // A driver error quotes the offending document back as text, where key-based
    // masking has nothing to key on.
    const line = `Error saving TaskSubmission: ${JSON.stringify(SECRETS)}`;
    assertClean(redact.redactMessage(line), 'redactMessage');
  });
});

describe('a Parse Server log line', () => {
  test('omits the payload of every CP7 operation', () => {
    const operations = [
      'listBatchTasks',
      'getBatchTask',
      'createBatchTask',
      'updateBatchTask',
      'setBatchTaskStatus',
      'deleteBatchTask',
      'copyBatchTask',
      'removeBatchTaskAttachment',
      'listTaskSubmissions',
      'getTaskSubmission',
      'listMyBatchTasks',
      'getMyBatchTask',
      'saveMyTaskDraft',
      'submitMyTask',
      'deleteMyTaskDraft',
      'unpublishTalentReel',
      'republishTalentReel',
      'listStudentTaskHistory',
    ];

    for (const operation of operations) {
      const line = buildParseLogLine(
        'info',
        [
          `Ran cloud function ${operation} for user student1 with:`,
          `  Input: ${JSON.stringify(SECRETS)}`,
          `  Result: ${JSON.stringify({submission: SECRETS})}`,
        ].join('\n'),
        {}
      );
      assertClean(JSON.stringify(line), operation);
    }
  });

  test('omits a trigger payload for all three classes', () => {
    for (const className of ['BatchTask', 'TaskSubmission', 'TalentReelPublication']) {
      const line = buildParseLogLine(
        'info',
        [
          `beforeSave triggered for ${className} for user admin1:`,
          `  Input: ${JSON.stringify(SECRETS)}`,
        ].join('\n'),
        {}
      );
      assertClean(JSON.stringify(line), className);
    }
  });

  test('every CP7 operation is on the omission list', () => {
    // The list is explicit rather than a pattern, because a pattern that
    // *nearly* matches is how `getPresenterState` slipped through in CP6.
    for (const subject of [
      'BatchTask',
      'TaskSubmission',
      'TalentReelPublication',
      'saveMyTaskDraft',
      'submitMyTask',
      'listStudentTaskHistory',
      'unpublishTalentReel',
      'republishTalentReel',
    ]) {
      assert.ok(
        redact.OMITTED_PAYLOAD_SUBJECTS.includes(subject),
        `${subject} must have its payload omitted`
      );
    }
  });
});

describe('the module logger', () => {
  test('drops a whole submission and keeps only the identifiers', () => {
    const safe = taskLogging.toSafeTaskFields({
      op: 'submitMyTask',
      stage: 'submit',
      ok: true,
      taskId: 'task1',
      submissionId: 'sub1',
      studentId: 'student1',
      batchId: 'batch1',
      status: 'SUBMITTED',
      taskType: 'FINAL_TASK',
      ...SECRETS,
    });

    assert.deepEqual(Object.keys(safe).sort(), [
      'batchId',
      'ok',
      'op',
      'stage',
      'status',
      'studentId',
      'submissionId',
      'taskId',
      'taskType',
    ]);
    assertClean(JSON.stringify(safe), 'toSafeTaskFields');
  });

  test('an attachment failure names the operation, not the file', () => {
    const described = taskLogging.describeFailure(
      new Error(
        'E11000 duplicate key error collection: cyf.BatchTask ' +
          'index: batch_task_attachment_key_unique dup key: ' +
          `{ attachmentStorageKey: "${SECRETS.attachmentStorageKey}" }`
      )
    );
    assertClean(JSON.stringify(described), 'describeFailure');
    // Still useful: an operator can tell a duplicate key from a timeout.
    assert.match(String(described.reason), /duplicate key/i);
  });

  test('a validation failure quoting a URL back is scrubbed', () => {
    const described = taskLogging.describeFailure(
      new Error(`Invalid value for liveDemoUrl: ${SECRETS.liveDemoUrl}`)
    );
    assertClean(JSON.stringify(described), 'describeFailure with a URL');
  });
});

describe('the things that must never be logged at all', () => {
  test('a consent decision is not a log field', () => {
    // Whether a Student agreed to be published is about them, not about the
    // request, and a log is the wrong place to keep a record of it.
    const safe = taskLogging.toSafeTaskFields({publicConsent: true, publicConsentAt: new Date()});
    assert.deepEqual(safe, {});
  });

  test('a technology list is not a log field', () => {
    const safe = taskLogging.toSafeTaskFields({technologies: SECRETS.technologies});
    assert.deepEqual(safe, {});
  });

  test('an extension is loggable but a filename is not', () => {
    // `.pdf` says which validator ran; the filename is the Student's own.
    const safe = taskLogging.toSafeTaskFields({
      extension: '.pdf',
      attachmentFilename: SECRETS.attachmentFilename,
    });
    assert.deepEqual(safe, {extension: '.pdf'});
  });

  test('a byte count is loggable but the bytes are not', () => {
    const safe = taskLogging.toSafeTaskFields({
      bytes: 1048576,
      buffer: Buffer.from('pretend this is a PDF'),
      file: 'raw content',
    });
    assert.deepEqual(safe, {bytes: 1048576});
  });
});
