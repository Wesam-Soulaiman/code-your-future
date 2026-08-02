/**
 * What a Live Slides session, Slide, and answer are allowed to be ⟨CP6⟩.
 *
 * These are pure functions, so they are exercised directly rather than through a
 * database. The load-bearing ones are at the bottom: `validateAnswer` decides
 * what a Student's submission means, and it decides it from the **stored** Slide
 * — never from anything the request said about itself.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let validation: typeof import('../src/cloudCode/modules/LiveSlides/validation');
let constants: typeof import('../src/cloudCode/modules/LiveSlides/constants');

before(async () => {
  installParseTestGlobal();
  validation = await import('../src/cloudCode/modules/LiveSlides/validation');
  constants = await import('../src/cloudCode/modules/LiveSlides/constants');
});

after(() => clearTrackedIntervals());

/** A stored Slide, as a query would return it. */
function storedSlide(attrs: Record<string, unknown>): Parse.Object {
  const Parse = parseSdk();
  const slide = new Parse.Object('LiveSlide');
  slide.id = 'slide-1';
  for (const [key, value] of Object.entries(attrs)) slide.set(key, value);
  return slide;
}

const OPTIONS = [
  {id: 'opt_aaaa', text: 'Frontend'},
  {id: 'opt_bbbb', text: 'Backend'},
  {id: 'opt_cccc', text: 'Mobile'},
];

// ═══════════════════════════════════════════════════════════════════════════

describe('the closed vocabularies', () => {
  test('there are exactly two slide types', () => {
    assert.deepEqual([...constants.SLIDE_TYPES], ['INFORMATION', 'QUESTION']);
  });

  test('there are exactly five answer types', () => {
    assert.deepEqual(
      [...constants.ANSWER_TYPES],
      ['SHORT_ANSWER', 'LONG_ANSWER', 'POLL', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE']
    );
  });

  test('only Poll, Single Choice, and Multiple Choice carry options', () => {
    assert.deepEqual([...constants.OPTION_ANSWER_TYPES], ['POLL', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE']);
    assert.equal(constants.needsOptions('SHORT_ANSWER'), false);
    assert.equal(constants.needsOptions('LONG_ANSWER'), false);
  });

  test('only Multiple Choice accepts more than one selection', () => {
    assert.deepEqual([...constants.MULTI_SELECT_TYPES], ['MULTIPLE_CHOICE']);
    assert.equal(constants.isMultiSelect('POLL'), false);
    assert.equal(constants.isMultiSelect('SINGLE_CHOICE'), false);
  });

  test('an invented type is not a type', () => {
    for (const invented of ['ESSAY', 'RATING', 'TRUE_FALSE', 'question', '', null]) {
      assert.equal(constants.isAnswerType(invented), false, String(invented));
    }
    for (const invented of ['WELCOME', 'CLOSING', 'information', '']) {
      assert.equal(constants.isSlideType(invented), false, String(invented));
    }
  });
});

describe('the session lifecycle', () => {
  test('has exactly four statuses', () => {
    assert.deepEqual([...constants.SESSION_STATUSES], ['draft', 'ready', 'live', 'completed']);
  });

  test('allows exactly the four approved moves', () => {
    const {SESSION_TRANSITIONS: t} = constants;
    assert.deepEqual([...t.draft], ['ready']);
    assert.deepEqual([...t.ready], ['draft', 'live']);
    assert.deepEqual([...t.live], ['completed']);
    // Completed is terminal. An empty list states the rule; a missing key would
    // read as an oversight.
    assert.deepEqual([...t.completed], []);
  });

  test('never allows a live session back into editing', () => {
    // Reopening would change the question Students already answered.
    assert.ok(!constants.SESSION_TRANSITIONS.live.includes('draft' as never));
    assert.ok(!constants.SESSION_TRANSITIONS.live.includes('ready' as never));
    assert.ok(!constants.SESSION_TRANSITIONS.completed.includes('live' as never));
  });

  test('only Draft is editable, and Live and Completed are frozen', () => {
    assert.equal(constants.isEditableStatus('draft'), true);
    for (const status of ['ready', 'live', 'completed']) {
      assert.equal(constants.isEditableStatus(status), false, status);
    }
    assert.equal(constants.isFrozenStatus('live'), true);
    assert.equal(constants.isFrozenStatus('completed'), true);
    assert.equal(constants.isFrozenStatus('draft'), false);
  });
});

describe('session metadata', () => {
  test('a title is required, and whitespace is not a title', () => {
    for (const title of ['', '   ', undefined, 42]) {
      const {errors} = validation.validateSessionMetadata({title, sessionDate: '2026-08-10'});
      assert.equal(errors['title'], 'REQUIRED', String(title));
    }
  });

  test('a title is bounded at both ends', () => {
    assert.equal(
      validation.validateSessionMetadata({title: 'x', sessionDate: '2026-08-10'}).errors['title'],
      'TOO_SHORT'
    );
    assert.equal(
      validation.validateSessionMetadata({title: 'x'.repeat(200), sessionDate: '2026-08-10'})
        .errors['title'],
      'TOO_LONG'
    );
  });

  test('a description is optional but bounded', () => {
    assert.equal(
      validation.validateSessionMetadata({title: 'First meeting', sessionDate: '2026-08-10'})
        .errors['description'],
      undefined
    );
    assert.equal(
      validation.validateSessionMetadata({
        title: 'First meeting',
        description: 'x'.repeat(1200),
        sessionDate: '2026-08-10',
      }).errors['description'],
      'TOO_LONG'
    );
  });

  test('a date is required and must be a real calendar day', () => {
    for (const date of ['', 'tomorrow', '2026-13-01', '2026-02-31', '10/08/2026', undefined]) {
      const {errors} = validation.validateSessionMetadata({title: 'First meeting', sessionDate: date});
      assert.equal(errors['sessionDate'], 'REQUIRED', String(date));
    }
  });

  test('the day that was picked is the day that is stored', () => {
    // Stored at UTC midnight, so a lecture on the 10th does not become the 9th
    // for a reader in another timezone.
    const date = validation.parseCalendarDate('2026-08-10');
    assert.ok(date);
    assert.equal(date!.toISOString(), '2026-08-10T00:00:00.000Z');
  });

  test('a rejection never carries the value that was rejected', () => {
    const {errors} = validation.validateSessionMetadata({
      title: 'x'.repeat(400),
      description: 'y'.repeat(2000),
      sessionDate: 'nonsense',
    });
    const serialised = JSON.stringify(errors);
    assert.ok(!serialised.includes('xxx'), 'the title must not be echoed');
    assert.ok(!serialised.includes('yyy'), 'the description must not be echoed');
    assert.ok(!serialised.includes('nonsense'), 'the date must not be echoed');
  });
});

describe('options', () => {
  test('at least two are required — one is not a choice', () => {
    // An empty or one-item list is TOO_SHORT: the caller sent options, there
    // were not enough. REQUIRED is reserved for "not a list at all", which is a
    // different mistake and deserves a different answer.
    assert.equal(validation.validateOptions([]).errors['options'], 'TOO_SHORT');
    assert.equal(validation.validateOptions([{text: 'Only one'}]).errors['options'], 'TOO_SHORT');
    assert.equal(validation.validateOptions('not a list').errors['options'], 'REQUIRED');
    assert.equal(validation.validateOptions(undefined).errors['options'], 'REQUIRED');
  });

  test('there is an upper bound', () => {
    const many = Array.from({length: 20}, (_, i) => ({text: `Option ${i}`}));
    assert.equal(validation.validateOptions(many).errors['options'], 'TOO_LONG');
  });

  test('every option gets a server-generated id', () => {
    const {options, errors} = validation.validateOptions([{text: 'Yes'}, {text: 'No'}]);
    assert.deepEqual(errors, {});
    assert.equal(options.length, 2);
    for (const option of options) {
      assert.match(option.id, /^opt_[0-9a-f]{16}$/);
    }
    assert.notEqual(options[0].id, options[1].id);
  });

  test('an id a caller invented is replaced, not honoured', () => {
    // Refusing would let a caller probe which ids exist; replacing tells them
    // nothing and cannot be used to point at another Slide's option.
    const {options} = validation.validateOptions([
      {id: 'opt_invented', text: 'Yes'},
      {id: '../../etc/passwd', text: 'No'},
    ]);
    assert.ok(!options.some(option => option.id === 'opt_invented'));
    assert.ok(!options.some(option => option.id === '../../etc/passwd'));
  });

  test('an id this Slide already owns survives an edit', () => {
    // Renaming an option in Draft must not orphan it.
    const {options} = validation.validateOptions(
      [{id: 'opt_aaaa', text: 'Front end'}, {id: 'opt_bbbb', text: 'Backend'}],
      OPTIONS
    );
    assert.equal(options[0].id, 'opt_aaaa');
    assert.equal(options[0].text, 'Front end');
    assert.equal(options[1].id, 'opt_bbbb');
  });

  test('two options a reader could not tell apart are refused', () => {
    for (const pair of [
      [{text: 'Backend'}, {text: 'Backend'}],
      [{text: 'Backend'}, {text: 'backend'}],
      [{text: 'Backend'}, {text: '  Backend  '}],
      [{text: 'Back end'}, {text: 'Back  end'}],
    ]) {
      assert.equal(validation.validateOptions(pair).errors['options'], 'NOT_ALLOWED');
    }
  });

  test('an empty option label is refused', () => {
    assert.equal(
      validation.validateOptions([{text: '  '}, {text: 'Backend'}]).errors['options'],
      'REQUIRED'
    );
  });
});

describe('slides', () => {
  test('an Information slide needs a title and content', () => {
    const {errors} = validation.validateSlide({type: 'INFORMATION'});
    assert.equal(errors['title'], 'REQUIRED');
    assert.equal(errors['content'], 'REQUIRED');
  });

  test('a valid Information slide passes', () => {
    const {values, errors} = validation.validateSlide({
      type: 'INFORMATION',
      title: 'How today works',
      content: 'The Admin controls the slides.',
    });
    assert.deepEqual(errors, {});
    assert.equal(values.type, 'INFORMATION');
    assert.equal(values.title, 'How today works');
  });

  test('an Information slide carrying question fields is refused', () => {
    // Not ignored — a caller sending both is confused about what it is building.
    const {errors} = validation.validateSlide({
      type: 'INFORMATION',
      title: 'How today works',
      content: 'Body',
      question: 'Sneaky',
      answerType: 'POLL',
      options: [{text: 'a'}, {text: 'b'}],
    });
    assert.equal(errors['question'], 'NOT_ALLOWED');
    assert.equal(errors['answerType'], 'NOT_ALLOWED');
    assert.equal(errors['options'], 'NOT_ALLOWED');
  });

  test('a Question needs a question and an approved answer type', () => {
    assert.equal(validation.validateSlide({type: 'QUESTION'}).errors['question'], 'REQUIRED');
    assert.equal(
      validation.validateSlide({type: 'QUESTION', question: 'Why software?', answerType: 'ESSAY'})
        .errors['answerType'],
      'NOT_ALLOWED'
    );
  });

  test('each text answer type is accepted without options', () => {
    for (const answerType of ['SHORT_ANSWER', 'LONG_ANSWER']) {
      const {values, errors} = validation.validateSlide({
        type: 'QUESTION',
        question: 'Why software development?',
        answerType,
      });
      assert.deepEqual(errors, {}, answerType);
      assert.equal(values.answerType, answerType);
      assert.equal(values.options, undefined);
    }
  });

  test('each choice answer type requires options', () => {
    for (const answerType of ['POLL', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE']) {
      const missing = validation.validateSlide({
        type: 'QUESTION',
        question: 'Which role interests you?',
        answerType,
      });
      assert.equal(missing.errors['options'], 'REQUIRED', answerType);

      const valid = validation.validateSlide({
        type: 'QUESTION',
        question: 'Which role interests you?',
        answerType,
        options: [{text: 'Frontend'}, {text: 'Backend'}],
      });
      assert.deepEqual(valid.errors, {}, answerType);
      assert.equal(valid.values.options?.length, 2);
    }
  });

  test('a text answer type carrying options is refused', () => {
    const {errors} = validation.validateSlide({
      type: 'QUESTION',
      question: 'Why software?',
      answerType: 'LONG_ANSWER',
      options: [{text: 'a'}, {text: 'b'}],
    });
    assert.equal(errors['options'], 'NOT_ALLOWED');
  });

  test('a Question carrying Information fields is refused', () => {
    const {errors} = validation.validateSlide({
      type: 'QUESTION',
      question: 'Why software?',
      answerType: 'SHORT_ANSWER',
      title: 'Sneaky',
      content: 'Sneaky',
    });
    assert.equal(errors['title'], 'NOT_ALLOWED');
    assert.equal(errors['content'], 'NOT_ALLOWED');
  });

  test('an existing Slide keeps its type whatever the request says', () => {
    // A Slide never changes type; a request naming one is describing what it
    // thinks it is editing.
    const {values} = validation.validateSlide(
      {type: 'QUESTION', title: 'Still information', content: 'Body'},
      {existingType: 'INFORMATION'}
    );
    assert.equal(values.type, 'INFORMATION');
  });

  test('no slide field can carry a score, a correct answer, or feedback', () => {
    const {values} = validation.validateSlide({
      type: 'QUESTION',
      question: 'Why software?',
      answerType: 'SINGLE_CHOICE',
      options: [{text: 'a', correct: true}, {text: 'b'}],
      correctAnswer: 'a',
      score: 10,
      feedback: 'Good',
      imageUrl: 'https://example.com/x.png',
    });
    const serialised = JSON.stringify(values);
    for (const forbidden of ['correct', 'score', 'feedback', 'imageUrl']) {
      assert.ok(!serialised.includes(forbidden), `${forbidden} must not survive validation`);
    }
  });
});

describe('privileged fields', () => {
  test('nothing the server owns may be set from a request', () => {
    const found = validation.findPrivilegedLiveFields({
      studentId: 'x',
      studentProfileId: 'x',
      submittedAt: 'x',
      lockedAt: 'x',
      startedBy: 'x',
      status: 'live',
      liveForBatch: 'x',
      currentSlide: 'x',
      title: 'fine',
    });
    for (const field of [
      'studentId',
      'studentProfileId',
      'submittedAt',
      'lockedAt',
      'startedBy',
      'status',
      'liveForBatch',
      'currentSlide',
    ]) {
      assert.ok(found.includes(field), `${field} must be refused`);
    }
    assert.ok(!found.includes('title'), 'an ordinary field must pass');
  });
});

describe('answers, judged against the stored Slide', () => {
  const shortSlide = () => storedSlide({type: 'QUESTION', answerType: 'SHORT_ANSWER'});
  const longSlide = () => storedSlide({type: 'QUESTION', answerType: 'LONG_ANSWER'});
  const pollSlide = () => storedSlide({type: 'QUESTION', answerType: 'POLL', options: OPTIONS});
  const singleSlide = () =>
    storedSlide({type: 'QUESTION', answerType: 'SINGLE_CHOICE', options: OPTIONS});
  const multiSlide = () =>
    storedSlide({type: 'QUESTION', answerType: 'MULTIPLE_CHOICE', options: OPTIONS});

  test('a short answer is accepted, trimmed, and bounded', () => {
    const ok = validation.validateAnswer(shortSlide(), {textAnswer: '  Backend Developer  '});
    assert.ok(ok.ok);
    assert.equal(ok.values.textAnswer, 'Backend Developer');

    assert.equal(validation.validateAnswer(shortSlide(), {textAnswer: '   '}).ok, false);
    assert.equal(
      validation.validateAnswer(shortSlide(), {textAnswer: 'x'.repeat(400)}).ok,
      false
    );
  });

  test('a long answer allows more room than a short one', () => {
    const text = 'x'.repeat(1000);
    assert.equal(validation.validateAnswer(longSlide(), {textAnswer: text}).ok, true);
    assert.equal(validation.validateAnswer(shortSlide(), {textAnswer: text}).ok, false);
  });

  test('a poll and a single choice each take exactly one option', () => {
    for (const slide of [pollSlide(), singleSlide()]) {
      const ok = validation.validateAnswer(slide, {selectedOptionId: 'opt_bbbb'});
      assert.ok(ok.ok);
      assert.equal(ok.values.selectedOptionId, 'opt_bbbb');
      assert.equal(ok.values.selectedOptionIds, undefined);

      // Two selections on a single-select question is a mismatch, not a
      // partially valid answer.
      const two = validation.validateAnswer(slide, {
        selectedOptionIds: ['opt_aaaa', 'opt_bbbb'],
      });
      assert.equal(two.ok, false);
      assert.equal((two as {code: string}).code, 'ANSWER_TYPE_MISMATCH');
    }
  });

  test('a multiple choice takes one or more options', () => {
    const one = validation.validateAnswer(multiSlide(), {selectedOptionIds: ['opt_aaaa']});
    assert.ok(one.ok);
    assert.deepEqual(one.values.selectedOptionIds, ['opt_aaaa']);

    const many = validation.validateAnswer(multiSlide(), {
      selectedOptionIds: ['opt_aaaa', 'opt_cccc'],
    });
    assert.ok(many.ok);
    assert.deepEqual(many.values.selectedOptionIds, ['opt_aaaa', 'opt_cccc']);
  });

  test('an empty selection is refused', () => {
    for (const empty of [{selectedOptionIds: []}, {selectedOptionId: ''}, {}]) {
      const result = validation.validateAnswer(multiSlide(), empty);
      assert.equal(result.ok, false, JSON.stringify(empty));
    }
  });

  test('an invented option id is refused', () => {
    const result = validation.validateAnswer(pollSlide(), {selectedOptionId: 'opt_invented'});
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_OPTION_INVALID');
  });

  test('an option id from a different Slide is refused', () => {
    const other = storedSlide({
      type: 'QUESTION',
      answerType: 'POLL',
      options: [{id: 'opt_zzzz', text: 'Elsewhere'}],
    });
    void other;
    const result = validation.validateAnswer(pollSlide(), {selectedOptionId: 'opt_zzzz'});
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_OPTION_INVALID');
  });

  test('the same option twice is refused', () => {
    // One person voting twice would inflate a tally by one.
    const result = validation.validateAnswer(multiSlide(), {
      selectedOptionIds: ['opt_aaaa', 'opt_aaaa'],
    });
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_OPTION_INVALID');
  });

  test('a text answer to a choice question is a mismatch', () => {
    const result = validation.validateAnswer(pollSlide(), {textAnswer: 'Backend'});
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_TYPE_MISMATCH');
  });

  test('a choice answer to a text question is a mismatch', () => {
    const result = validation.validateAnswer(shortSlide(), {selectedOptionId: 'opt_aaaa'});
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_TYPE_MISMATCH');
  });

  test('the answer type comes from the Slide, never from the request', () => {
    // A caller claiming a different type must not change how their answer is
    // read — otherwise a one-word reply could be stored against a poll.
    const result = validation.validateAnswer(pollSlide(), {
      answerType: 'SHORT_ANSWER',
      textAnswer: 'Backend',
    });
    assert.equal(result.ok, false, 'the Slide says POLL, so a text answer is wrong');
  });

  test('an option label is never accepted in place of an id', () => {
    const result = validation.validateAnswer(pollSlide(), {selectedOptionId: 'Backend'});
    assert.equal(result.ok, false);
    assert.equal((result as {code: string}).code, 'ANSWER_OPTION_INVALID');
  });

  test('a non-string option id is refused rather than coerced', () => {
    for (const bad of [{selectedOptionIds: [1, 2]}, {selectedOptionId: {}}, {selectedOptionIds: [null]}]) {
      assert.equal(validation.validateAnswer(multiSlide(), bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe('reorder input', () => {
  test('a usable list is accepted', () => {
    assert.deepEqual(validation.parseOrderedIds(['a', 'b', 'c']), ['a', 'b', 'c']);
  });

  test('anything that is not a usable list is refused', () => {
    for (const bad of [undefined, null, 'a,b', {}, [], [123], [''], ['x'.repeat(80)]]) {
      assert.equal(validation.parseOrderedIds(bad), undefined, JSON.stringify(bad));
    }
  });
});
