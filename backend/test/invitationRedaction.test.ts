/**
 * An invitation token must never survive a log line ⟨CP4⟩.
 *
 * The threat is mundane and real: Parse Server prints the parameters of every
 * cloud-function call at info level, and two of this checkpoint's operations
 * take a raw token as a parameter. Without redaction, `previewInvitation` and
 * `joinBatchWithInvitation` would write a working credential into the
 * application log on every single call — where it would be picked up by log
 * shipping, retained for months, and readable by anybody with log access.
 *
 * The token also travels inside a URL, so the URL form is covered separately:
 * a link a page renders can end up in an error message, and `/join/<token>` is
 * a credential wearing a URL's clothes.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {REDACTED, redact, redactMessage} from '../src/cloudCode/utils/logging/redact';
import {buildParseLogLine} from '../src/cloudCode/utils/logging/safeLogger';

/** A realistic 32-byte base64url token — the exact shape the server mints. */
const TOKEN = 'Qm9vbXNoYWxha2FfY2FuYXJ5X3Rva2VuX3ZhbHVl';
const TOKEN_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function assertGone(output: string, secret = TOKEN): void {
  assert.ok(!output.includes(secret), `the token leaked into output: ${output}`);
}

describe('a token in a cloud-function parameter', () => {
  test('is redacted from the params Parse would otherwise print', () => {
    const line = buildParseLogLine('info', 'Ran cloud function joinBatchWithInvitation', {
      params: {token: TOKEN},
    });
    assertGone(line);
    // The operation name stays readable — the point is a usable log, not a
    // blank one.
    assert.ok(line.includes('joinBatchWithInvitation'));
  });

  test('is redacted from a nested object, leaving its safe siblings', () => {
    const output = JSON.stringify(redact({invitation: {token: TOKEN, batchId: 'b1'}}));
    assertGone(output);
    assert.ok(output.includes('b1'), 'a Batch id is safe and stays');
  });

  test('a whole payload subtree is omitted rather than walked', () => {
    // `payload`, `body`, and `request` are themselves treated as sensitive, so
    // everything under one goes at once. Coarser than the field-level rule, and
    // correct: a raw payload may carry keys nobody enumerated.
    for (const wrapper of ['request', 'payload', 'body', 'data']) {
      const output = JSON.stringify(redact({[wrapper]: {token: TOKEN, batchId: 'b1'}}));
      assertGone(output);
    }
  });

  test('is redacted whatever the key is called', () => {
    for (const key of ['token', 'Token', 'TOKEN', 'invitationToken', 'rawToken', 'joinToken']) {
      const output = JSON.stringify(redact({[key]: TOKEN}));
      assertGone(output);
      assert.ok(output.includes(REDACTED), `${key} must be masked, not dropped silently`);
    }
  });

  test('the stored hash is redacted too', () => {
    // The hash is not the token, but it is what a redemption is checked
    // against — a leaked hash plus a database write is a working invitation.
    const output = JSON.stringify(redact({tokenHash: TOKEN_HASH}));
    assertGone(output, TOKEN_HASH);
  });
});

describe('a token inside a join URL', () => {
  test('is stripped from an absolute link', () => {
    const line = redactMessage(`invitation ready: https://app.example.test/#/join/${TOKEN}`);
    assertGone(line);
    // The shape of the URL survives, so a line still says what kind of thing
    // was being handled.
    assert.ok(line.includes('/join/'), 'the route is kept; only the secret goes');
    assert.ok(line.includes('app.example.test'), 'the host is not a secret');
  });

  test('is stripped from a relative link', () => {
    const line = redactMessage(`redirecting to /join/${TOKEN}`);
    assertGone(line);
    assert.ok(line.includes('/join/'));
  });

  test('is stripped from a hash-routed link with no origin', () => {
    const line = redactMessage(`#/join/${TOKEN}`);
    assertGone(line);
  });

  test('is stripped from a link inside a serialised payload', () => {
    const line = redactMessage(
      `  Result: ${JSON.stringify({
        invitationUrl: `https://app.example.test/#/join/${TOKEN}`,
        invitationPath: `/#/join/${TOKEN}`,
      })}`
    );
    assertGone(line);
  });

  test('leaves an unrelated path that merely contains the word alone', () => {
    // `/joined` is not `/join/<token>`. Over-eager scrubbing makes logs useless
    // and teaches people to turn redaction off.
    const line = redactMessage('GET /api/joined?limit=10');
    assert.ok(line.includes('/api/joined'), line);
    assert.ok(line.includes('limit=10'), line);
  });

  test('leaves a short path segment alone — it cannot be a token', () => {
    const line = redactMessage('GET /join/help');
    assert.ok(line.includes('/join/help'), line);
  });
});

describe('what a Batch operation may still log', () => {
  test('an objectId, a count, and a status survive', () => {
    const line = redactMessage(
      JSON.stringify({op: 'issueBatchInvitation', batchId: 'aBcD1234', count: 3, status: 'active'})
    );
    for (const kept of ['issueBatchInvitation', 'aBcD1234', '3', 'active']) {
      assert.ok(line.includes(kept), `${kept} is safe and must stay readable`);
    }
  });

  test('a fingerprint survives — it is derived from the hash and reveals nothing', () => {
    const line = redactMessage(JSON.stringify({op: 'getBatchInvitation', fingerprint: 'e3b0c442'}));
    assert.ok(line.includes('e3b0c442'), 'the fingerprint is the whole point of having one');
  });

  test("a Student's email in a Batch context is still redacted", () => {
    // Nothing about Batches relaxes the existing rules.
    const line = redactMessage(
      JSON.stringify({op: 'listBatchStudents', email: 'student.canary@example.com'})
    );
    assertGone(line, 'student.canary@example.com');
  });
});
