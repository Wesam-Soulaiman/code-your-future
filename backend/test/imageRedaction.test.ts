/**
 * Image content must never reach a log — at any level, in any shape.
 *
 * This is a privacy defect that was real: Parse Server logs every cloud-function
 * call with its serialised input and result, so a base64 photograph appeared
 * verbatim inside `Input: {"data":"..."}` the moment a Student picked one.
 *
 * Two things fixed it, and both are tested here:
 *
 *   1. the bytes no longer travel through a cloud function at all — they go to
 *      a dedicated binary route, which is where the cause was;
 *   2. redaction treats file and image keys as content, so even if a future
 *      change puts an image back on that path, the log does not carry it.
 *
 * The one nuance worth keeping straight: a **byte count** is safe and useful,
 * and the rules below keep it. The bytes themselves never survive at any length,
 * because a "harmless" 64-character preview of a JPEG is still the beginning of
 * a photograph of a person.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let redact: typeof import('../src/cloudCode/utils/logging/redact');
let safeLogger: typeof import('../src/cloudCode/utils/logging/safeLogger');

/**
 * A recognisable stand-in for image bytes.
 *
 * Long enough to be a real payload and distinctive enough that a partial leak
 * is impossible to miss.
 */
const IMAGE = `iVBORw0KGgoAAAANSUhEUg${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(40)}`;
const PREFIX = IMAGE.slice(0, 24);

before(async () => {
  installParseTestGlobal();
  redact = await import('../src/cloudCode/utils/logging/redact');
  safeLogger = await import('../src/cloudCode/utils/logging/safeLogger');
});

after(() => clearTrackedIntervals());

function serialise(value: unknown): string {
  return JSON.stringify(value);
}

/** The keys the brief names, plus the shapes they appear in. */
const BINARY_KEYS = [
  'data',
  'base64',
  'photo',
  'photoData',
  'image',
  'imageData',
  'file',
  'fileData',
  'buffer',
  'bytes',
  'binary',
  'contents',
  'payload',
  // Same rule, different spellings and nestings the codebase might produce.
  'fileName',
  'photo_data',
  'X-Image-Data',
  'thumbnail',
  'avatar',
  'attachment',
];

describe('binary keys are recognised', () => {
  for (const key of BINARY_KEYS) {
    test(`'${key}' carries file content`, () => {
      assert.equal(redact.isBinaryKey(key), true);
    });
  }

  for (const key of ['op', 'stage', 'ok', 'code', 'userId', 'profileId', 'count', 'mimeType']) {
    test(`'${key}' is safe metadata`, () => {
      assert.equal(redact.isBinaryKey(key), false);
      assert.equal(redact.isSensitiveKey(key), false);
    });
  }
});

describe('object redaction', () => {
  for (const key of BINARY_KEYS) {
    test(`drops the value of '${key}' entirely`, () => {
      const output = serialise(redact.redactMeta({[key]: IMAGE}));
      assert.ok(!output.includes(PREFIX), `${key} leaked image content`);
      assert.ok(output.includes(redact.REDACTED));
    });
  }

  test('keeps a byte count, which is the useful part', () => {
    const output = redact.redactMeta({op: 'uploadMyProfilePhoto', bytes: 48213, ok: true});
    assert.deepEqual(output, {op: 'uploadMyProfilePhoto', bytes: 48213, ok: true});
  });

  test('keeps a boolean flag such as hasPhoto', () => {
    assert.deepEqual(redact.redactMeta({hasPhoto: true}), {hasPhoto: true});
  });

  test('drops a byte count that is not a number', () => {
    // A string in a numeric field is exactly how a payload sneaks through.
    const output = serialise(redact.redactMeta({bytes: IMAGE}));
    assert.ok(!output.includes(PREFIX));
  });

  test('reaches image content nested several levels down', () => {
    const output = serialise(
      redact.redactMeta({op: 'x', request: {body: {upload: {photoData: IMAGE}}}})
    );
    assert.ok(!output.includes(PREFIX));
  });

  test('reaches image content inside an array', () => {
    const output = serialise(redact.redactMeta({uploads: [{data: IMAGE}, {data: IMAGE}]}));
    assert.ok(!output.includes(PREFIX));
  });

  test('reaches image content inside a Map', () => {
    const output = serialise(redact.redactMeta({entries: new Map([['imageData', IMAGE]])}));
    assert.ok(!output.includes(PREFIX));
  });

  test('reaches image content inside a Set', () => {
    const output = serialise(redact.redactMeta({entries: new Set([{photo: IMAGE}])}));
    assert.ok(!output.includes(PREFIX));
  });

  test('reaches image content hung off an Error', () => {
    const error = Object.assign(new Error('upload failed'), {
      request: {data: IMAGE},
      fileName: 'lina-haddad-passport.png',
    });
    const output = serialise(redact.redactMeta({error}));
    assert.ok(!output.includes(PREFIX));
    // A filename is personal too: people name photographs after themselves.
    assert.ok(!output.includes('lina-haddad'));
  });

  test('never emits a truncated prefix of image content', () => {
    const output = serialise(redact.redactMeta({data: IMAGE}));
    for (const length of [8, 16, 32, 64, 128]) {
      assert.ok(
        !output.includes(IMAGE.slice(0, length)),
        `a ${length}-character prefix survived`
      );
    }
  });

  test('a Buffer never becomes its contents', () => {
    const output = serialise(redact.redactMeta({photo: Buffer.from(IMAGE)}));
    assert.ok(!output.includes(PREFIX));
  });
});

describe("Parse's own Input and Result lines", () => {
  test('an Input line carrying an image is masked', () => {
    const line = safeLogger.buildParseLogLine(
      'info',
      `Ran cloud function uploadMyProfilePhoto for user u1 with:\\n  Input: {"data":"${IMAGE}","fileName":"me.png","mimeType":"image/png"}`
    );
    assert.ok(!line.includes(PREFIX), 'the image survived the Input line');
    assert.ok(!line.includes('me.png'));
    assert.ok(line.includes(redact.REDACTED));
  });

  test('a Result line carrying an image is masked', () => {
    const line = safeLogger.buildParseLogLine(
      'info',
      `Result: {"data":"${IMAGE}","mimeType":"image/webp"}`
    );
    assert.ok(!line.includes(PREFIX), 'the image survived the Result line');
  });

  test('an error line carrying an image is masked', () => {
    const line = safeLogger.buildParseLogLine(
      'error',
      `Failed running cloud function uploadMyProfilePhoto for user u1 with:\\n  Input: {"data":"${IMAGE}"}\\n  Error: {"code":141,"message":"PHOTO_REJECTED"}`
    );
    assert.ok(!line.includes(PREFIX));
    // The stable code is not sensitive and stays, so the line is still useful.
    assert.ok(line.includes('PHOTO_REJECTED'));
  });

  test('a whole data: URI is masked, with no prefix kept', () => {
    const line = safeLogger.buildParseLogLine('info', `preview=data:image/png;base64,${IMAGE}`);
    assert.ok(!line.includes(PREFIX));
    assert.ok(!line.includes('data:image/png;base64,'));
  });

  test('a byte count in a message survives', () => {
    const line = safeLogger.buildParseLogLine('info', 'stored photo bytes=48213 ok=true');
    assert.ok(line.includes('48213'));
  });

  test('masking a multi-megabyte payload completes promptly', () => {
    // The value pattern is written to be unambiguous rather than merely
    // correct: the alternation form of the same rule backtracks exponentially
    // on a large unterminated string, which an image is.
    const huge = 'A'.repeat(6 * 1024 * 1024);
    const started = process.hrtime.bigint();
    const line = safeLogger.buildParseLogLine('info', `Input: {"data":"${huge}`);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(elapsedMs < 3000, `redaction took ${Math.round(elapsedMs)}ms`);
    assert.ok(!line.includes('A'.repeat(1024)));
  });
});

describe('the profile logging allow-list', () => {
  test('accepts only its fixed shape, whatever a call site passes', async () => {
    const logging = await import('../src/cloudCode/modules/StudentProfile/logging');
    const safe = logging.toSafeProfileFields({
      op: 'uploadMyProfilePhoto',
      bytes: 48213,
      // None of these may survive, whether or not redaction would also catch
      // them: the allow-list refuses them before redaction is even consulted.
      data: IMAGE,
      photoData: IMAGE,
      fileName: 'lina.png',
      verifiedEmail: 'lina@example.com',
      phone: '+963944123456',
    });

    assert.deepEqual(safe, {op: 'uploadMyProfilePhoto', bytes: 48213});
  });

  test('the allowed fields are only operation-shaped metadata', async () => {
    const logging = await import('../src/cloudCode/modules/StudentProfile/logging');
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

describe('the photo bytes never enter the cloud-function pipeline', () => {
  test('no profile cloud function reads an image payload from its request', async () => {
    const module = await import('../src/cloudCode/modules/StudentProfile/functions');
    const FunctionClass = module.default as unknown as new () => Record<string, unknown>;
    const instance = new FunctionClass();

    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
      if (name === 'constructor') continue;
      const body = String((instance as Record<string, unknown>)[name]);
      for (const forbidden of ["params['data']", "params['fileName']", 'decodePhotoUpload']) {
        assert.ok(!body.includes(forbidden), `${name} must not handle image bytes`);
      }
    }
  });

  test('no registered cloud function declares an image field', async () => {
    await import('../src/cloudCode/modules/StudentProfile/functions');
    const {CloudFunctionRegistry} = await import('@90soft/parse-server-kit');

    for (const fn of CloudFunctionRegistry.getFunctions()) {
      const fields = Object.keys(
        (fn.config as {validation?: {fields?: Record<string, unknown>}}).validation?.fields ?? {}
      );
      for (const field of fields) {
        assert.equal(
          redact.isBinaryKey(field),
          false,
          `${fn.name} declares the image-shaped field ${field}`
        );
      }
    }
  });
});
