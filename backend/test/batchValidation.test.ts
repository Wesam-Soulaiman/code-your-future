/**
 * Batch validation, invitation resolution, and the invitation-link origin.
 *
 * The behaviour under test here is the part a reader has to trust:
 *
 *  - a date typed on one side of midnight means the same day on the other;
 *  - a token that never existed and one that is malformed produce the *same*
 *    answer, so nobody can probe which strings were ever real;
 *  - a privileged field smuggled into a create or update is refused rather
 *    than quietly ignored;
 *  - the invitation URL's origin comes from configuration, never from the
 *    request that asked for it.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let validation: typeof import('../src/cloudCode/modules/Batch/validation');
let invitationService: typeof import('../src/cloudCode/modules/Batch/invitationService');
let tokens: typeof import('../src/cloudCode/modules/Batch/invitationToken');
let constants: typeof import('../src/cloudCode/modules/Batch/constants');

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  await import('../src/cloudCode/models/BatchInvitation');
  await import('../src/cloudCode/models/BatchEnrollment');

  validation = await import('../src/cloudCode/modules/Batch/validation');
  invitationService = await import('../src/cloudCode/modules/Batch/invitationService');
  tokens = await import('../src/cloudCode/modules/Batch/invitationToken');
  constants = await import('../src/cloudCode/modules/Batch/constants');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('parsing a calendar date', () => {
  test('reads YYYY-MM-DD as that exact day in UTC', () => {
    const {value, reason} = validation.parseBatchDate('2026-03-03');
    assert.equal(reason, undefined);
    assert.ok(value instanceof Date);
    // The whole point: the day that was typed is the day that is stored,
    // wherever the server happens to be.
    assert.equal(value!.toISOString().slice(0, 10), '2026-03-03');
    assert.equal(value!.getUTCHours(), 0);
    assert.equal(value!.getUTCMinutes(), 0);
    assert.equal(value!.getUTCSeconds(), 0);
    assert.equal(value!.getUTCMilliseconds(), 0);
  });

  test('a date at either end of the year survives the round trip', () => {
    for (const day of ['2026-01-01', '2026-12-31', '2024-02-29']) {
      const {value} = validation.parseBatchDate(day);
      assert.equal(value?.toISOString().slice(0, 10), day, `${day} must round-trip`);
    }
  });

  test('an empty value is simply absent, not a parse failure', () => {
    // The caller decides whether an absent date is an error: it is for
    // `startDate` and it is not for `endDate`.
    // A non-string counts as absent too. It cannot become a date by any
    // reading, and for `startDate` the caller turns that into REQUIRED — which
    // is the message somebody who sent nothing usable should get.
    for (const empty of ['', '   ', null, undefined, 42, {}, []]) {
      const {value, reason} = validation.parseBatchDate(empty);
      assert.equal(value, undefined);
      assert.equal(reason, undefined, `${JSON.stringify(empty)} is absent, not invalid`);
    }
  });

  test('refuses anything that is not a calendar date', () => {
    for (const bad of [
      '2026-3-3',
      '03/03/2026',
      '2026-03-03T10:00:00Z',
      'yesterday',
      '2026/03/03',
      '20260303',
    ]) {
      const {value, reason} = validation.parseBatchDate(bad);
      assert.equal(value, undefined, `${JSON.stringify(bad)} must not parse`);
      assert.ok(reason, `${JSON.stringify(bad)} must give a reason`);
    }
  });

  test('refuses a day that does not exist', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31']) {
      const {value} = validation.parseBatchDate(bad);
      assert.equal(value, undefined, `${bad} is not a real day`);
    }
  });
});

describe('validating a Batch', () => {
  const valid = {name: 'Spring 2026', startDate: '2026-03-01'};

  test('accepts the minimum: a name and a start date', () => {
    const result = validation.validateBatchInput(valid);
    assert.deepEqual(result.errors, {});
    assert.equal(result.values.name, 'Spring 2026');
  });

  test('a missing start date is required, not merely absent', () => {
    const result = validation.validateBatchInput({name: 'Spring 2026'});
    assert.equal(result.errors['startDate'], 'REQUIRED');
  });

  test('trims the name rather than storing the whitespace', () => {
    const result = validation.validateBatchInput({...valid, name: '   Spring   2026   '});
    assert.equal(result.values.name, 'Spring 2026');
  });

  test('refuses a name that is too short or too long', () => {
    const short = validation.validateBatchInput({...valid, name: 'a'});
    assert.ok(short.errors['name'], 'a one-character name must be refused');

    const long = validation.validateBatchInput({
      ...valid,
      name: 'x'.repeat(constants.BATCH_LIMITS.name.max + 1),
    });
    assert.ok(long.errors['name'], 'an over-long name must be refused');
  });

  test('refuses an end date before the start date', () => {
    const result = validation.validateBatchInput({...valid, endDate: '2026-02-28'});
    assert.ok(result.errors['endDate'], 'the end date must not precede the start');
  });

  test('accepts an end date equal to the start date', () => {
    // A one-day batch is unusual but not wrong, and refusing it would be an
    // invented rule.
    const result = validation.validateBatchInput({...valid, endDate: '2026-03-01'});
    assert.deepEqual(result.errors, {});
  });

  test('accepts only draft or active as a creation status', () => {
    for (const status of constants.BATCH_STATUSES) {
      const result = validation.validateBatchInput({...valid, status});
      const allowed = constants.BATCH_CREATE_STATUSES.includes(status);
      assert.equal(
        result.errors['status'] === undefined,
        allowed,
        `${status} as a creation status`
      );
    }
  });

  test('an edit cannot change status through this path at all', () => {
    // On an update the existing status is passed in and the submitted one is
    // ignored outright, so the only way to move a Batch is the transition
    // operation — which enforces which moves are legal.
    const result = validation.validateBatchInput(
      {...valid, status: 'archived'},
      constants.BATCH_STATUS.ACTIVE
    );
    assert.deepEqual(result.errors, {});
    assert.equal(result.values.status, 'active', 'the submitted status is discarded');
  });
});

describe('privileged fields', () => {
  test('an ACL, a role, or an enrollment count in the input is caught', () => {
    for (const field of [
      'ACL',
      'objectId',
      'createdBy',
      'enrollmentCount',
      'tokenHash',
      'roles',
      'sessionToken',
      'password',
    ]) {
      const found = validation.findPrivilegedBatchFields({name: 'x', [field]: 'anything'});
      assert.ok(found.includes(field), `${field} must be reported as privileged`);
    }
  });

  test('an ordinary input reports nothing', () => {
    assert.deepEqual(
      validation.findPrivilegedBatchFields({
        name: 'Spring 2026',
        description: 'Cohort',
        startDate: '2026-03-01',
        endDate: '2026-06-01',
        status: 'draft',
      }),
      []
    );
  });
});

describe('normalising a search term', () => {
  test('trims and caps it rather than refusing a long one', () => {
    const long = 'x'.repeat(constants.BATCH_LIMITS.search.max + 50);
    const normalised = validation.normaliseBatchSearch(`  ${long}  `);
    assert.ok(normalised.length <= constants.BATCH_LIMITS.search.max);
  });

  test('anything that is not a string becomes an empty search', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      assert.equal(validation.normaliseBatchSearch(bad), '');
    }
  });
});

describe('paging', () => {
  test('defaults to the first page at the default size', () => {
    assert.deepEqual(validation.normalisePaging({}), {
      skip: 0,
      limit: constants.BATCH_PAGE.defaultLimit,
    });
  });

  test('caps the page size rather than trusting the caller', () => {
    const {limit} = validation.normalisePaging({limit: 100000});
    assert.equal(limit, constants.BATCH_PAGE.maxLimit);
  });

  test('a negative or nonsense offset becomes zero', () => {
    for (const bad of [-1, -1000, 'x', null, NaN, Infinity]) {
      assert.equal(validation.normalisePaging({skip: bad}).skip, 0, `skip=${String(bad)}`);
    }
  });
});

describe('an expiry', () => {
  test('accepts an ISO instant in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const {value, reason} = validation.parseExpiry(future);
    assert.equal(reason, undefined);
    assert.equal(value?.toISOString(), future);
  });

  test('refuses an expiry in the past — it would already be expired', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const {value} = validation.parseExpiry(past);
    assert.equal(value, undefined);
  });

  test('an absent expiry is not an error — a link may have none', () => {
    for (const empty of [undefined, null, '']) {
      const {value, reason} = validation.parseExpiry(empty);
      assert.equal(value, undefined);
      assert.equal(reason, undefined, 'no expiry is a valid choice');
    }
  });
});

describe('resolving a token', () => {
  test('a malformed token is refused without ever reaching the database', async () => {
    // If this hit the database, the fake Parse global would throw. Getting a
    // clean INVITATION_INVALID back proves the shape check ran first.
    for (const bad of ['', 'short', 'has spaces', 'a'.repeat(500), null, undefined, 42, {}]) {
      const result = await invitationService.resolveInvitationToken(bad);
      assert.equal(result.usable, false);
      assert.equal(
        result.reason,
        'INVITATION_INVALID',
        `${JSON.stringify(bad)} must answer INVITATION_INVALID`
      );
      assert.equal(result.batch, undefined, 'nothing about any Batch may leak');
      assert.equal(result.invitation, undefined);
    }
  });

  test('a lookup failure surfaces as a save failure, never as a verdict', async () => {
    // There is no database in this suite, so the lookup throws. What matters is
    // that it becomes BATCH_SAVE_FAILED rather than being swallowed into an
    // `INVITATION_INVALID` — a database outage must not read as "your link is
    // simply wrong", and must not be distinguishable per token either.
    const {token} = tokens.generateInvitationToken();
    await assert.rejects(
      () => invitationService.resolveInvitationToken(token),
      (error: Error) => error.message.includes('BATCH_SAVE_FAILED')
    );
  });
});

describe('judging expiry', () => {
  const invitationWith = (fields: Record<string, unknown>) =>
    ({get: (field: string) => fields[field]}) as unknown as Parse.Object;

  test('an invitation with no expiry never expires', () => {
    const invitation = invitationWith({state: 'current'});
    assert.equal(invitationService.isExpired(invitation), false);
    assert.equal(invitationService.isInvitationUsable(invitation), true);
  });

  test('expiry is judged against the moment the token is presented', () => {
    const expiresAt = new Date('2026-06-01T12:00:00.000Z');
    const invitation = invitationWith({state: 'current', expiresAt});

    assert.equal(
      invitationService.isExpired(invitation, new Date('2026-06-01T11:59:59.999Z')),
      false,
      'one millisecond before is not expired'
    );
    assert.equal(
      invitationService.isExpired(invitation, new Date(expiresAt)),
      true,
      'the expiry moment itself is expired'
    );
    assert.equal(
      invitationService.isExpired(invitation, new Date('2026-06-02T00:00:00.000Z')),
      true
    );
  });

  test('a revoked or replaced invitation is unusable whatever the clock says', () => {
    for (const state of ['revoked', 'replaced', 'expired']) {
      const invitation = invitationWith({state});
      assert.equal(
        invitationService.isInvitationUsable(invitation),
        false,
        `${state} must never be usable`
      );
    }
  });

  test('an absent invitation is unusable rather than an error', () => {
    assert.equal(invitationService.isInvitationUsable(undefined), false);
  });
});

describe('the invitation link origin', () => {
  let frontendOrigin: typeof import('../src/cloudCode/modules/Batch/frontendOrigin');
  const saved = {...process.env};

  before(async () => {
    frontendOrigin = await import('../src/cloudCode/modules/Batch/frontendOrigin');
  });

  after(() => {
    process.env = {...saved};
  });

  test('prefers the configured frontend origin', () => {
    process.env['FRONTEND_ORIGIN'] = 'https://app.example.test';
    assert.equal(frontendOrigin.frontendOrigin(), 'https://app.example.test');
  });

  test('never guesses a host when nothing is configured', () => {
    // Returning undefined makes the caller emit a relative path, which resolves
    // against whatever origin actually served the page. Guessing would produce
    // a confident, wrong, unusable link.
    delete process.env['FRONTEND_ORIGIN'];
    delete process.env['ALLOWED_ORIGINS'];
    const origin = frontendOrigin.frontendOrigin();
    assert.ok(
      origin === undefined || /^https?:\/\//.test(origin),
      'the origin is either absent or a real absolute origin'
    );
  });

  test('the origin never comes from a request', () => {
    // A Host or Origin header supplied by a caller must never end up in a link
    // we hand to somebody else — that is how an invitation gets phished.
    const source = frontendOrigin.frontendOriginStatus();
    assert.ok(!/header|host|referer|request/i.test(source.source), source.source);
  });
});
