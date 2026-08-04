/**
 * What a Task, a Submission, and a submitted link are allowed to be ⟨CP7⟩.
 *
 * The load-bearing group is the URL validation. Those functions decide what a
 * Student may publish, and they do it **without touching the network** — a
 * server that fetched a URL a stranger supplied would be making requests from
 * inside our network on somebody else's instruction. So the tests check shape
 * and refusal, and there is a test asserting no fetching happens at all.
 *
 * The second load-bearing group is the deadline boundary, where "at exactly the
 * deadline" has to be decided one way and stay decided.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let urls: typeof import('../src/cloudCode/modules/BatchTask/urls');
let validation: typeof import('../src/cloudCode/modules/BatchTask/validation');
let availability: typeof import('../src/cloudCode/modules/BatchTask/availability');
let constants: typeof import('../src/cloudCode/modules/BatchTask/constants');

before(async () => {
  installParseTestGlobal();
  urls = await import('../src/cloudCode/modules/BatchTask/urls');
  validation = await import('../src/cloudCode/modules/BatchTask/validation');
  availability = await import('../src/cloudCode/modules/BatchTask/availability');
  constants = await import('../src/cloudCode/modules/BatchTask/constants');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════

describe('the closed vocabularies', () => {
  test('there are exactly two Task types', () => {
    assert.deepEqual([...constants.TASK_TYPES], ['ASSIGNMENT', 'FINAL_TASK']);
  });

  test('there are exactly four Task statuses', () => {
    assert.deepEqual([...constants.TASK_STATUSES], ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED']);
  });

  test('there are exactly two Submission statuses', () => {
    // No UNDER_REVIEW, ACCEPTED, REJECTED, CHANGES_REQUESTED, or LATE. The
    // product has no review workflow, so a status implying judgement would need
    // somebody to make it.
    assert.deepEqual([...constants.SUBMISSION_STATUSES], ['DRAFT', 'SUBMITTED']);
  });

  test('there are exactly three requirement levels', () => {
    assert.deepEqual([...constants.REQUIREMENTS], ['NOT_USED', 'OPTIONAL', 'REQUIRED']);
  });

  test('there are exactly two publication statuses', () => {
    assert.deepEqual([...constants.PUBLICATION_STATUSES], ['PUBLISHED', 'UNPUBLISHED']);
  });

  test('there are exactly five configurable submission fields', () => {
    assert.deepEqual(
      constants.SUBMISSION_FIELDS.map(spec => spec.field),
      ['githubUrl', 'liveDemoUrl', 'googleDriveUrl', 'youtubeVideoId', 'studentNote']
    );
  });

  test('the Task transitions match the product, and Archived is terminal', () => {
    const {TASK_TRANSITIONS: t} = constants;
    assert.deepEqual([...t.DRAFT], ['PUBLISHED', 'ARCHIVED']);
    assert.deepEqual([...t.PUBLISHED], ['DRAFT', 'CLOSED', 'ARCHIVED']);
    assert.deepEqual([...t.CLOSED], ['PUBLISHED', 'ARCHIVED']);
    assert.deepEqual([...t.ARCHIVED], []);
  });

  test('a Student never sees a Draft Task', () => {
    assert.ok(!constants.STUDENT_VISIBLE_TASK_STATUSES.includes('DRAFT' as never));
    assert.deepEqual(
      [...constants.STUDENT_VISIBLE_TASK_STATUSES],
      ['PUBLISHED', 'CLOSED', 'ARCHIVED']
    );
  });

  test('an invented value is not a value', () => {
    for (const invented of ['PROJECT', 'assignment', '', null, 'REVIEW']) {
      assert.equal(constants.isTaskType(invented), false, String(invented));
    }
    for (const invented of ['ACCEPTED', 'LATE', 'draft', '']) {
      assert.equal(constants.isSubmissionStatus(invented), false, String(invented));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('GitHub URLs', () => {
  test('an ordinary repository, tree, or pull request is accepted', () => {
    for (const url of [
      'https://github.com/lina/portfolio',
      'https://github.com/lina/portfolio/tree/feature-branch',
      'https://github.com/lina/portfolio/pull/12',
      'https://gist.github.com/lina/abc123',
    ]) {
      assert.equal(urls.validateGithubUrl(url).ok, true, url);
    }
  });

  test('another host is refused, however plausible', () => {
    for (const url of [
      'https://gitlab.com/lina/portfolio',
      'https://github.com.evil.example/lina',
      'https://notgithub.com/lina',
      'https://bitbucket.org/lina/portfolio',
    ]) {
      assert.equal(urls.validateGithubUrl(url).ok, false, url);
    }
  });

  test('the bare host with no path is refused', () => {
    assert.equal(urls.validateGithubUrl('https://github.com').ok, false);
    assert.equal(urls.validateGithubUrl('https://github.com/').ok, false);
  });

  test('http is refused — a published link must not downgrade a reader', () => {
    assert.equal(urls.validateGithubUrl('http://github.com/lina/portfolio').ok, false);
  });

  test('credentials in the authority are refused', () => {
    // A password in a field somebody will screenshot, and the classic way to
    // make a hostile host look familiar.
    assert.equal(
      urls.validateGithubUrl('https://user:pass@github.com/lina/portfolio').ok,
      false
    );
    assert.equal(urls.validateGithubUrl('https://github.com@evil.example/x').ok, false);
  });
});

describe('live demo URLs', () => {
  test('any public HTTPS host is accepted, including GitHub Pages', () => {
    for (const url of [
      'https://lina.github.io/portfolio/',
      'https://my-project.vercel.app',
      'https://example.com/demo',
      'https://sub.domain.example.co.uk/path?x=1',
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, true, url);
    }
  });

  test('loopback is refused by every spelling', () => {
    for (const url of [
      'https://localhost/demo',
      'https://localhost:443/demo',
      'https://127.0.0.1/demo',
      'https://127.1.2.3/demo',
      'https://[::1]/demo',
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }
  });

  test('private and reserved ranges are refused', () => {
    for (const url of [
      'https://10.0.0.5/demo', // 10/8
      'https://172.16.0.1/demo', // 172.16/12
      'https://172.31.255.254/demo', // upper end of the same block
      'https://192.168.1.1/demo', // 192.168/16
      'https://169.254.169.254/demo', // link-local — the cloud metadata address
      'https://100.64.0.1/demo', // carrier-grade NAT
      'https://0.0.0.0/demo', // "this network"
      'https://224.0.0.1/demo', // multicast
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }
  });

  test('a public address that merely looks private is still accepted', () => {
    // 172.32 is outside 172.16/12, and 11.0.0.1 is not 10/8. A rule that
    // refused these would be guessing rather than reading the RFC.
    assert.equal(urls.validateLiveDemoUrl('https://172.32.0.1/demo').ok, true);
    assert.equal(urls.validateLiveDemoUrl('https://11.0.0.1/demo').ok, true);
  });

  test('private IPv6 is refused', () => {
    for (const url of [
      'https://[::1]/demo',
      'https://[fe80::1]/demo',
      'https://[fc00::1]/demo',
      'https://[fd12:3456::1]/demo',
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }
  });

  test('an IPv4-mapped IPv6 address is refused after the parser rewrites it', () => {
    // The URL parser normalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so
    // the readable spelling is not what the validator sees. Both are here
    // because a check that only knew the dotted form would miss every mapped
    // address that arrives through a URL — which is all of them.
    for (const url of [
      'https://[::ffff:127.0.0.1]/demo', // → ::ffff:7f00:1
      'https://[::ffff:10.0.0.1]/demo', // → ::ffff:a00:1
      'https://[::ffff:192.168.1.1]/demo', // → ::ffff:c0a8:101
      'https://[::ffff:169.254.169.254]/demo', // → ::ffff:a9fe:a9fe — metadata
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }

    // And the mapped form of a genuinely public address still passes, so the
    // fix is not "refuse anything mapped".
    assert.equal(urls.validateLiveDemoUrl('https://[::ffff:8.8.8.8]/demo').ok, true);
  });

  test('internal-looking names are refused', () => {
    for (const url of [
      'https://intranet.local/demo',
      'https://api.internal/demo',
      'https://box.home.arpa/demo',
      'https://buildserver/demo', // a bare label is a machine on a LAN
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }
  });

  test('a non-standard port is refused', () => {
    // A "public" link on :8080 is almost always somebody's dev machine.
    assert.equal(urls.validateLiveDemoUrl('https://example.com:8080/demo').ok, false);
    assert.equal(urls.validateLiveDemoUrl('https://example.com:443/demo').ok, true);
  });

  test('a dangerous scheme is refused', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/abc',
      'ftp://example.com/x',
    ]) {
      assert.equal(urls.validateLiveDemoUrl(url).ok, false, url);
    }
  });
});

describe('Google Drive URLs', () => {
  test('Google document hosts are accepted', () => {
    assert.equal(urls.validateDriveUrl('https://drive.google.com/file/d/abc/view').ok, true);
    assert.equal(urls.validateDriveUrl('https://docs.google.com/document/d/abc/edit').ok, true);
  });

  test('anything else is refused', () => {
    for (const url of [
      'https://dropbox.com/s/abc',
      'https://google.com/drive',
      'https://drive.google.com.evil.example/file',
      'https://evil.example/drive.google.com',
    ]) {
      assert.equal(urls.validateDriveUrl(url).ok, false, url);
    }
  });
});

describe('YouTube URLs', () => {
  test('every approved form yields the same eleven-character id', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    ]) {
      const result = urls.validateYoutubeUrl(url);
      assert.ok(result.ok, url);
      assert.equal(result.value, 'dQw4w9WgXcQ');
    }
  });

  test('only the id is stored — never the URL, never an embed', () => {
    const result = urls.validateYoutubeUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&utm_source=x'
    );
    assert.ok(result.ok);
    // The tracking query string and the playlist go with it. Keeping the URL
    // would mean storing whatever somebody happened to paste.
    assert.equal(result.value, 'dQw4w9WgXcQ');
    assert.ok(!result.value.includes('utm_source'));
  });

  test('embed HTML is not a URL and is refused', () => {
    for (const value of [
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      '<script>alert(1)</script>',
      'https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><script>x</script>',
    ]) {
      assert.equal(urls.validateYoutubeUrl(value).ok, false);
    }
  });

  test('another provider is refused', () => {
    for (const url of [
      'https://vimeo.com/123456789',
      'https://player.vimeo.com/video/123',
      'https://www.dailymotion.com/video/x123',
    ]) {
      assert.equal(urls.validateYoutubeUrl(url).ok, false, url);
    }
  });

  test('a channel or playlist is not a video', () => {
    for (const url of [
      'https://www.youtube.com/channel/UCabcdefghijk',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@somebody',
    ]) {
      assert.equal(urls.validateYoutubeUrl(url).ok, false, url);
    }
  });

  test('an id of the wrong length is refused', () => {
    assert.equal(urls.validateYoutubeUrl('https://youtu.be/tooshort').ok, false);
    assert.equal(urls.validateYoutubeUrl('https://youtu.be/waytoolongforanid123').ok, false);
  });
});

describe('the URL validators never touch the network', () => {
  test('the validation module imports nothing that could make a request', () => {
    // The whole SSRF defence is that these functions judge shape and stop. A
    // server that checked a stranger-supplied URL by fetching it would be
    // making requests on their instruction, from inside our network.
    //
    // Asserted against the source rather than by watching for a socket,
    // because a fetch added later would be added in this file and this catches
    // it at the moment it is written.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/cloudCode/modules/BatchTask/urls.ts'),
      'utf8'
    );

    assert.ok(source.length > 0, 'the source must be readable for this test to mean anything');
    for (const forbidden of [
      'fetch(',
      'node:http',
      'node:https',
      'node:dns',
      'node:net',
      'axios',
      'request(',
    ]) {
      assert.ok(!source.includes(forbidden), `urls.ts must not reference ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the deadline boundary', () => {
  const published = {status: 'PUBLISHED' as const};

  test('no deadline means open while the Batch is active', () => {
    const result = availability.availabilityOf(published, 'active');
    assert.equal(result.isSubmissionOpen, true);
    assert.equal(result.availabilityReason, 'OPEN');
  });

  test('one millisecond before the deadline is open', () => {
    const deadline = new Date('2026-09-01T17:00:00.000Z');
    const result = availability.availabilityOf(
      {...published, deadline},
      'active',
      new Date('2026-09-01T16:59:59.999Z')
    );
    assert.equal(result.isSubmissionOpen, true);
  });

  test('exactly at the deadline is closed', () => {
    // The boundary is `>=`. "Due by 17:00" means at 17:00 the time is up;
    // giving the boundary instant to whoever hits it is arbitrary and
    // impossible to explain.
    const deadline = new Date('2026-09-01T17:00:00.000Z');
    const result = availability.availabilityOf(
      {...published, deadline},
      'active',
      new Date('2026-09-01T17:00:00.000Z')
    );
    assert.equal(result.isSubmissionOpen, false);
    assert.equal(result.availabilityReason, 'DEADLINE_PASSED');
  });

  test('one millisecond after the deadline is closed', () => {
    const deadline = new Date('2026-09-01T17:00:00.000Z');
    const result = availability.availabilityOf(
      {...published, deadline},
      'active',
      new Date('2026-09-01T17:00:00.001Z')
    );
    assert.equal(result.isSubmissionOpen, false);
  });

  test('the Task status is decided before the deadline', () => {
    // An archived Task past its deadline says archived: that is the thing that
    // will not change, so it is the more useful explanation.
    const deadline = new Date('2020-01-01T00:00:00.000Z');
    assert.equal(
      availability.availabilityOf({status: 'ARCHIVED', deadline}, 'active').availabilityReason,
      'ARCHIVED'
    );
    assert.equal(
      availability.availabilityOf({status: 'CLOSED', deadline}, 'active').availabilityReason,
      'CLOSED'
    );
    assert.equal(
      availability.availabilityOf({status: 'DRAFT', deadline}, 'active').availabilityReason,
      'NOT_PUBLISHED'
    );
  });

  test('the Batch is decided before the deadline', () => {
    assert.equal(
      availability.availabilityOf(published, 'draft').availabilityReason,
      'BATCH_NOT_ACTIVE'
    );
    for (const status of ['completed', 'archived']) {
      assert.equal(
        availability.availabilityOf(published, status).availabilityReason,
        'BATCH_CLOSED'
      );
    }
  });

  test('a completed Batch closes submissions even with no deadline', () => {
    assert.equal(availability.availabilityOf(published, 'completed').isSubmissionOpen, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('Task validation', () => {
  const base = {title: 'Build a portfolio', description: 'Ship something.', type: 'ASSIGNMENT'};

  test('a valid Task passes and defaults every requirement to NOT_USED', () => {
    const {values, errors} = validation.validateTask(base);
    assert.deepEqual(errors, {});
    assert.equal(values.type, 'ASSIGNMENT');
    for (const level of Object.values(values.requirements)) {
      assert.equal(level, 'NOT_USED');
    }
  });

  test('a title and a description are both required', () => {
    const {errors} = validation.validateTask({type: 'ASSIGNMENT'});
    assert.equal(errors['title'], 'REQUIRED');
    assert.equal(errors['description'], 'REQUIRED');
  });

  test('an invented type is refused', () => {
    assert.equal(validation.validateTask({...base, type: 'PROJECT'}).errors['type'], 'NOT_ALLOWED');
  });

  test('an existing Task keeps its type whatever the request says', () => {
    const {values} = validation.validateTask(
      {...base, type: 'ASSIGNMENT'},
      {existingType: 'FINAL_TASK'}
    );
    assert.equal(values.type, 'FINAL_TASK');
  });

  test('an invented requirement level is refused', () => {
    const {errors} = validation.validateTask({...base, githubRequirement: 'MAYBE'});
    assert.equal(errors['githubRequirement'], 'NOT_ALLOWED');
  });

  test('a deadline is optional but must be a real instant', () => {
    assert.equal(validation.validateTask(base).values.deadline, undefined);
    assert.ok(validation.validateTask({...base, deadline: '2026-09-01T17:00:00.000Z'}).values.deadline);
    assert.equal(
      validation.validateTask({...base, deadline: 'next Friday'}).errors['deadline'],
      'INVALID'
    );
    // A deadline centuries away is a typo, not a policy.
    assert.equal(
      validation.validateTask({...base, deadline: '1899-01-01T00:00:00.000Z'}).errors['deadline'],
      'INVALID'
    );
  });

  test('a rejection never carries the value that was rejected', () => {
    const {errors} = validation.validateTask({
      title: 'x'.repeat(400),
      description: 'y'.repeat(9000),
      type: 'NONSENSE',
      deadline: 'garbage',
    });
    const serialised = JSON.stringify(errors);
    assert.ok(!serialised.includes('xxx'));
    assert.ok(!serialised.includes('yyy'));
    assert.ok(!serialised.includes('garbage'));
  });

  test('nothing the server owns may be set from a request', () => {
    const found = validation.findPrivilegedTaskFields({
      studentId: 'x',
      status: 'PUBLISHED',
      submittedAt: 'x',
      hasEverBeenSubmitted: true,
      attachmentStorageKey: 'x',
      adminSuppressed: true,
      publicProfileSlug: 'x',
      publicConsentAt: 'x',
      title: 'fine',
    });
    for (const field of [
      'studentId',
      'status',
      'submittedAt',
      'hasEverBeenSubmitted',
      'attachmentStorageKey',
      'adminSuppressed',
      'publicProfileSlug',
      'publicConsentAt',
    ]) {
      assert.ok(found.includes(field), `${field} must be refused`);
    }
    assert.ok(!found.includes('title'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('Submission validation against the Task requirements', () => {
  const requirements = (over: Record<string, string> = {}) => ({
    githubRequirement: 'NOT_USED',
    liveDemoRequirement: 'NOT_USED',
    driveRequirement: 'NOT_USED',
    videoRequirement: 'NOT_USED',
    studentNoteRequirement: 'NOT_USED',
    ...over,
  });

  const assignment = (over: Record<string, string> = {}) => ({
    type: 'ASSIGNMENT' as const,
    requirements: requirements(over) as never,
  });

  test('a NOT_USED field is refused, not ignored', () => {
    // A stale browser must not store something the Admin decided not to collect.
    const result = validation.validateSubmission(
      {githubUrl: 'https://github.com/lina/x'},
      assignment(),
      false
    );
    assert.deepEqual(result.notUsed, ['githubUrl']);
  });

  test('a Draft may be missing required fields', () => {
    const result = validation.validateSubmission(
      {},
      assignment({githubRequirement: 'REQUIRED'}),
      false
    );
    assert.deepEqual(result.missing, []);
  });

  test('a Submit may not', () => {
    const result = validation.validateSubmission(
      {},
      assignment({githubRequirement: 'REQUIRED'}),
      true
    );
    assert.deepEqual(result.missing, ['githubUrl']);
  });

  test('a supplied field must be valid even in a Draft', () => {
    const result = validation.validateSubmission(
      {githubUrl: 'https://gitlab.com/lina/x'},
      assignment({githubRequirement: 'OPTIONAL'}),
      false
    );
    assert.equal(result.errors['githubUrl'], 'NOT_ALLOWED');
  });

  test('the stored value is the canonical one', () => {
    const result = validation.validateSubmission(
      {youtubeVideoId: 'https://youtu.be/dQw4w9WgXcQ'},
      assignment({videoRequirement: 'OPTIONAL'}),
      false
    );
    assert.equal(result.values.youtubeVideoId, 'dQw4w9WgXcQ');
  });

  test('a note is bounded at 2000 characters', () => {
    const ok = validation.validateSubmission(
      {studentNote: 'x'.repeat(2000)},
      assignment({studentNoteRequirement: 'OPTIONAL'}),
      false
    );
    assert.deepEqual(ok.errors, {});

    const tooLong = validation.validateSubmission(
      {studentNote: 'x'.repeat(2001)},
      assignment({studentNoteRequirement: 'OPTIONAL'}),
      false
    );
    assert.equal(tooLong.errors['studentNote'], 'TOO_LONG');
  });

  test('an Assignment refuses the public project fields', () => {
    const result = validation.validateSubmission(
      {
        publicProjectTitle: 'My project',
        publicProjectDescription: 'About it',
        technologies: ['Angular'],
        myContribution: 'I built it',
        publicConsent: true,
      },
      assignment(),
      false
    );
    for (const field of [
      'publicProjectTitle',
      'publicProjectDescription',
      'technologies',
      'myContribution',
      'publicConsent',
    ]) {
      assert.ok(result.notUsed.includes(field), `${field} belongs to a Final Task only`);
    }
  });

  test('a Final Task accepts them', () => {
    const result = validation.validateSubmission(
      {
        publicProjectTitle: 'My project',
        publicProjectDescription: 'What it does',
        technologies: ['Angular', 'Parse'],
        myContribution: 'I built the frontend',
        publicConsent: true,
      },
      {type: 'FINAL_TASK', requirements: requirements() as never},
      false
    );
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.notUsed, []);
    assert.equal(result.values.publicConsent, true);
    assert.deepEqual(result.values.technologies, ['Angular', 'Parse']);
  });

  test('consent must be a boolean — anything else is not consent', () => {
    const result = validation.validateSubmission(
      {publicConsent: 'yes'},
      {type: 'FINAL_TASK', requirements: requirements() as never},
      false
    );
    assert.equal(result.errors['publicConsent'], 'INVALID');
  });
});

describe('technologies', () => {
  test('a plain list is accepted and trimmed', () => {
    const result = validation.validateTechnologies(['  Angular ', 'Parse Server']);
    assert.equal(result.reason, undefined);
    assert.deepEqual(result.items, ['Angular', 'Parse Server']);
  });

  test('duplicates are refused case-insensitively', () => {
    for (const list of [
      ['React', 'react'],
      ['React', 'REACT'],
      ['React', ' react '],
    ]) {
      assert.equal(validation.validateTechnologies(list).reason, 'NOT_ALLOWED', String(list));
    }
  });

  test('an empty item is refused', () => {
    assert.equal(validation.validateTechnologies(['Angular', '  ']).reason, 'REQUIRED');
  });

  test('more than ten is refused', () => {
    const many = Array.from({length: 11}, (_, i) => `Tech ${i}`);
    assert.equal(validation.validateTechnologies(many).reason, 'TOO_LONG');
  });

  test('an over-long item is refused', () => {
    assert.equal(validation.validateTechnologies(['x'.repeat(51)]).reason, 'TOO_LONG');
  });

  test('something that is not a list is refused', () => {
    for (const bad of ['Angular', {}, null, 42]) {
      assert.equal(validation.validateTechnologies(bad).reason, 'INVALID', String(bad));
    }
  });
});
