/**
 * Questions and answers must not reach a log ⟨CP6⟩.
 *
 * ── Why this is asserted against Parse's own lines ──────────────────────────
 * The module's own logger takes an allow-list, so its output is safe by
 * construction and a test of it proves little. The real exposure is **Parse
 * Server's** logging: it writes one line per cloud-function call and one per
 * trigger, each carrying the serialised input and result. In Checkpoint 3A that
 * put a whole photograph in the log; here it would put a Student's answer about
 * their background, their goals, and why they want this.
 *
 * So these tests build the actual lines Parse writes and assert the redaction
 * boundary blanks them — and, just as importantly, that it leaves every other
 * surface's logs alone.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let redactMessage: typeof import('../src/cloudCode/utils/logging/redact').redactMessage;

before(async () => {
  installParseTestGlobal();
  redactMessage = (await import('../src/cloudCode/utils/logging/redact')).redactMessage;
});

after(() => clearTrackedIntervals());

/** A Student's answer, of the kind this feature actually collects. */
const ANSWER = 'I am a software engineering student from Aleppo and I enjoy backend systems.';
const QUESTION = 'Why did you choose software development?';
const OPTION = 'UI/UX Designer';

describe("Parse's own cloud-function lines", () => {
  test('a submitted answer does not survive', () => {
    const line = redactMessage(
      `Ran cloud function submitLiveResponse for user abc123 with:\n` +
        `  Input: {"sessionId":"s1","slideId":"sl1","textAnswer":"${ANSWER}"}\n` +
        `  Result: {"alreadySubmitted":false,"myResponse":{"textAnswer":"${ANSWER}"}}`
    );
    assert.ok(!line.includes(ANSWER), `the answer leaked: ${line}`);
    assert.ok(!line.includes('Aleppo'), 'no fragment of it may survive either');
  });

  test('the selected option ids and labels do not survive', () => {
    const line = redactMessage(
      `Ran cloud function submitLiveResponse for user abc123 with:\n` +
        `  Input: {"slideId":"sl1","selectedOptionIds":["opt_aaaa","opt_bbbb"]}\n` +
        `  Result: {"myResponse":{"selectedOptionLabels":["${OPTION}"]}}`
    );
    assert.ok(!line.includes(OPTION), `an option label leaked: ${line}`);
    assert.ok(!line.includes('opt_aaaa'), `an option id leaked: ${line}`);
  });

  test('a question and its options do not survive a slide write', () => {
    const line = redactMessage(
      `Ran cloud function addLiveSlide for user abc123 with:\n` +
        `  Input: {"type":"QUESTION","question":"${QUESTION}","options":[{"text":"${OPTION}"}]}`
    );
    assert.ok(!line.includes(QUESTION), `the question leaked: ${line}`);
    assert.ok(!line.includes(OPTION), `an option leaked: ${line}`);
  });

  test('an Information slide’s content does not survive', () => {
    const content = 'The Admin controls the slides. Write your answer and press Submit.';
    const line = redactMessage(
      `Ran cloud function addLiveSlide for user abc123 with:\n` +
        `  Input: {"type":"INFORMATION","title":"How today works","content":"${content}"}`
    );
    assert.ok(!line.includes(content), `slide content leaked: ${line}`);
  });

  test('a presenter response panel does not put every answer in the log', () => {
    const line = redactMessage(
      `Ran cloud function getPresenterState for user abc123 with:\n` +
        `  Input: {"sessionId":"s1"}\n` +
        `  Result: {"responses":[{"studentName":"Lina Haddad","textAnswer":"${ANSWER}"}]}`
    );
    assert.ok(!line.includes(ANSWER), `an answer leaked: ${line}`);
    assert.ok(!line.includes('Lina Haddad'), `a Student was named: ${line}`);
  });

  test('a results view does not put the whole cohort in the log', () => {
    const line = redactMessage(
      `Ran cloud function getResultsByQuestion for user abc123 with:\n` +
        `  Input: {"sessionId":"s1"}\n` +
        `  Result: {"items":[{"slide":{"question":"${QUESTION}"},"responses":[{"studentName":"Omar Al-Khatib","textAnswer":"${ANSWER}"}]}]}`
    );
    assert.ok(!line.includes(QUESTION));
    assert.ok(!line.includes(ANSWER));
    assert.ok(!line.includes('Omar Al-Khatib'));
  });
});

describe("Parse's own trigger lines", () => {
  test('a LiveResponse beforeSave does not log the answer', () => {
    const line = redactMessage(
      `beforeSave triggered for LiveResponse for user abc123:\n` +
        `  Input: {"answerType":"LONG_ANSWER","textAnswer":"${ANSWER}","submittedAt":"2026-08-10T09:00:00.000Z"}\n` +
        `  Result: {"object":{"textAnswer":"${ANSWER}"}} {"className":"LiveResponse","triggerType":"beforeSave"}`
    );
    assert.ok(!line.includes(ANSWER), `the answer leaked: ${line}`);
    // The trailing metadata object is safe and worth keeping — it says which
    // class and which trigger, which is the whole diagnostic value of the line.
    assert.ok(line.includes('LiveResponse'), 'the class must still be identifiable');
    assert.ok(line.includes('beforeSave'), 'the trigger must still be identifiable');
  });

  test('a LiveSlide beforeSave does not log the question or the options', () => {
    const line = redactMessage(
      `beforeSave triggered for LiveSlide for user abc123:\n` +
        `  Input: {"type":"QUESTION","question":"${QUESTION}","options":[{"id":"opt_a","text":"${OPTION}"}]}`
    );
    assert.ok(!line.includes(QUESTION));
    assert.ok(!line.includes(OPTION));
  });

  test('a LiveSlideSession beforeSave does not log its description', () => {
    const description = 'Getting to know the students and their goals';
    const line = redactMessage(
      `beforeSave triggered for LiveSlideSession for user abc123:\n` +
        `  Input: {"title":"First meeting","description":"${description}"}`
    );
    assert.ok(!line.includes(description), `a session description leaked: ${line}`);
  });
});

describe('every other surface keeps its useful logs', () => {
  test('a Batch trigger line is untouched', () => {
    // `description` is deliberately **not** on the sensitive-key list: it
    // appears in Batch logs, Resource logs, and every `@ParseField`
    // declaration, and masking it globally would blank a great deal of
    // harmless, useful output to protect one module.
    const line = redactMessage(
      `beforeSave triggered for Batch for user abc123:\n` +
        `  Input: {"name":"Summer 2026","description":"The summer cohort","status":"active"}`
    );
    assert.ok(line.includes('Summer 2026'), 'a Batch name must stay readable');
    assert.ok(line.includes('The summer cohort'), 'a Batch description must stay readable');
  });

  test('a Resource trigger line keeps its existing redaction and nothing more', () => {
    const line = redactMessage(
      `beforeSave triggered for BatchResource for user abc123:\n` +
        `  Input: {"title":"Week one reading","filename":"week-1.pdf","storageKey":"resource_deadbeef","extension":".pdf"}`
    );
    assert.ok(!line.includes('resource_deadbeef'), 'the storage key must still be masked');
    assert.ok(!line.includes('week-1.pdf'), 'the filename must still be masked');
    assert.ok(line.includes('Week one reading'), 'a Resource title stays readable as before');
    assert.ok(line.includes('.pdf'), 'the extension stays readable as before');
  });

  test('an ordinary application log line is untouched', () => {
    const line = redactMessage(
      'Indexes applied and verified {"op":"bootstrap","ok":true,"stage":"applyIndexes","count":16}'
    );
    assert.ok(line.includes('applyIndexes'));
    assert.ok(line.includes('16'));
  });

  test('a Batch cloud-function line is untouched', () => {
    const line = redactMessage(
      `Ran cloud function listBatches for user abc123 with:\n  Input: {"search":"summer"}`
    );
    assert.ok(line.includes('summer'), 'an unrelated function keeps its payload');
  });
});

describe('defence in depth', () => {
  test('an answer key is masked even in a line that names no Live Slides subject', () => {
    // The payload omission above is scoped by subject. If an answer somehow
    // reaches a line without one, the key-name rule still catches it.
    const line = redactMessage(`Some unrelated message {"textAnswer":"${ANSWER}"}`);
    assert.ok(!line.includes(ANSWER), `the answer leaked: ${line}`);
  });

  test('selected option ids are masked the same way', () => {
    const line = redactMessage('Some unrelated message {"selectedOptionId":"opt_aaaa"}');
    assert.ok(!line.includes('opt_aaaa'));
  });
});
