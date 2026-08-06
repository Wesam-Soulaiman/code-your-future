/**
 * The public talent surface ⟨CP8⟩.
 *
 * This suite is stricter than the others in the repository, and deliberately.
 * Every other surface sits behind a session and a role, so a mistake there
 * leaks to somebody who was already allowed in. These four endpoints sit behind
 * nothing at all — a field that escapes here escapes to the internet.
 *
 * So the load-bearing assertions are the negative ones: what the DTOs cannot
 * contain, what an unpublished Student cannot be distinguished from, and what a
 * YouTube validator will not accept.
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
const MODULE_DIR = join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'PublicTalent');

function moduleSource(name: string): string {
  return readFileSync(join(MODULE_DIR, `${name}.ts`), 'utf8');
}

let dto: typeof import('../src/cloudCode/modules/PublicTalent/dto');
let repository: typeof import('../src/cloudCode/modules/PublicTalent/repository');
let constants: typeof import('../src/cloudCode/modules/PublicTalent/constants');
let urls: typeof import('../src/cloudCode/modules/BatchTask/urls');
let publication: typeof import('../src/cloudCode/modules/BatchTask/publication');
let registry: typeof import('@90soft/parse-server-kit').CloudFunctionRegistry;

before(async () => {
  installParseTestGlobal();

  await import('../src/cloudCode/models/User');
  await import('../src/cloudCode/models/Batch');
  await import('../src/cloudCode/models/StudentProfile');
  await import('../src/cloudCode/models/BatchTask');
  await import('../src/cloudCode/models/TaskSubmission');
  await import('../src/cloudCode/models/TalentReelPublication');
  await import('../src/cloudCode/modules/PublicTalent/functions');

  dto = await import('../src/cloudCode/modules/PublicTalent/dto');
  repository = await import('../src/cloudCode/modules/PublicTalent/repository');
  constants = await import('../src/cloudCode/modules/PublicTalent/constants');
  urls = await import('../src/cloudCode/modules/BatchTask/urls');
  publication = await import('../src/cloudCode/modules/BatchTask/publication');
  registry = (await import('@90soft/parse-server-kit')).CloudFunctionRegistry;
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function object(className: string, attrs: Record<string, unknown>, id = 'x1'): Parse.Object {
  const Parse = parseSdk();
  const row = new Parse.Object(className);
  row.id = id;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) row.set(key, value);
  }
  return row;
}

/** A profile carrying every private field a leak could take with it. */
function profileObject(attrs: Record<string, unknown> = {}): Parse.Object {
  return object(
    'StudentProfile',
    {
      fullName: 'Lina Haddad',
      publicProfileSlug: 'k3mq7wz2ptx9',
      careerGoal: 'I want to build accessible interfaces people actually enjoy.',
      githubUrl: 'https://github.com/lina',
      linkedinUrl: 'https://www.linkedin.com/in/lina',
      portfolioUrl: 'https://lina.example',
      educationStatus: 'GRADUATE',
      photoData: 'UklGRh4AAABXRUJQ',
      photoUpdatedAt: new Date('2026-05-01T10:00:00.000Z'),
      // Everything below must never cross the boundary.
      verifiedEmail: 'lina@example.test',
      phone: '+963912345678',
      dateOfBirth: new Date('2001-04-02T00:00:00.000Z'),
      customInstitutionName: 'Damascus University',
      expectedGraduationDate: new Date('2026-07-01T00:00:00.000Z'),
      targetRoleReason: 'Because I like design systems.',
      isComplete: true,
      profileEverComplete: true,
      ...attrs,
    },
    'profile1'
  );
}

function publicationObject(attrs: Record<string, unknown> = {}): Parse.Object {
  return object(
    'TalentReelPublication',
    {
      status: 'PUBLISHED',
      projectTitle: 'Neighbourhood Recipe Exchange',
      projectDescription: 'A place for one street to swap recipes.',
      contribution: 'I built the whole front end.',
      technologies: ['Angular', 'Parse Server'],
      youtubeVideoId: 'dQw4w9WgXcQ',
      reelVideoId: 'dQw4w9WgXcQ',
      githubUrl: 'https://github.com/lina/recipes',
      liveDemoUrl: 'https://recipes.example',
      publishedAt: new Date('2026-06-01T09:00:00.000Z'),
      // Internal machinery that a public page must never carry.
      adminSuppressed: false,
      publicationSource: 'AUTOMATIC',
      ...attrs,
    },
    'pub1'
  );
}

/** Every string in a payload, however deeply nested. */
function allText(payload: unknown): string {
  return JSON.stringify(payload ?? {});
}

/** Every key in a payload, at every depth. */
function allKeys(payload: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(payload)) {
    for (const item of payload) allKeys(item, found);
  } else if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      found.add(key);
      allKeys(value, found);
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('the public endpoints', () => {
  const PUBLIC = [
    'listTalentDiscovery',
    'getTalentProfile',
    'listTalentReels',
    'getTalentFilters',
  ];

  test('all four are registered', () => {
    const names = registry.getFunctions().map(fn => fn.name);
    for (const name of PUBLIC) {
      assert.ok(names.includes(name), `${name} must be registered`);
    }
  });

  test('none of them requires a session', () => {
    // The whole point of the checkpoint. A guard here would make the public
    // pages unreachable to the people they exist for.
    for (const name of PUBLIC) {
      const fn = registry.getFunctions().find(entry => entry.name === name);
      assert.ok(fn, name);
      assert.notEqual(fn.config.validation?.requireUser, true, `${name} must be public`);
    }
  });

  test('every one of them is rate limited', () => {
    // Unauthenticated does not mean unbounded: there is no session to throttle,
    // so the endpoint has to throttle itself.
    for (const name of PUBLIC) {
      const fn = registry.getFunctions().find(entry => entry.name === name);
      assert.ok(fn?.config.rateLimit, `${name} must be rate limited`);
      assert.ok((fn.config.rateLimit as {max: number}).max <= 120, `${name} limit is too generous`);
    }
  });

  test('nothing public writes anything', () => {
    // A public mutation is a public mutation however carefully it is written.
    const names = registry.getFunctions().map(fn => fn.name.toLowerCase());
    for (const forbidden of [
      'createpublicstudent',
      'updatepublicstudent',
      'deletepublicstudent',
      'publishpublicstudent',
      'reportpublicstudent',
      'likepublicstudent',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  test('the source accepts no arbitrary query from a caller', () => {
    // A public endpoint taking a `where` clause is a public endpoint taking a
    // query for anything on the class.
    const source = moduleSource('functions');
    for (const forbidden of ['params[\'where\']', 'Parse.Query.fromJSON', 'JSON.parse(']) {
      assert.ok(!source.includes(forbidden), `functions.ts must not use ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('what a public DTO may contain', () => {
  const PRIVATE_VALUES = [
    'lina@example.test',
    '+963912345678',
    '2001-04-02',
    '2026-07-01',
    'design systems',
    'UklGRh4AAABXRUJQ',
    'AUTOMATIC',
    'profile1',
    'pub1',
  ];

  test('a directory card carries nothing private', () => {
    const card = dto.toPublicCard(publicationObject(), profileObject(), {
      targetRole: 'Frontend Developer',
      city: 'Damascus',
    });

    const text = allText(card);
    for (const secret of PRIVATE_VALUES) {
      assert.ok(!text.includes(secret), `a card leaked ${secret}`);
    }
    for (const key of dto.FORBIDDEN_PUBLIC_KEYS) {
      assert.ok(!(key in card), `a card carried ${key}`);
    }
  });

  test('a profile carries nothing private', () => {
    const profile = dto.toPublicProfile(profileObject(), [publicationObject()], {
      targetRole: 'Frontend Developer',
      city: 'Damascus',
      educationStatus: 'GRADUATE',
    });

    const text = allText(profile);
    for (const secret of PRIVATE_VALUES) {
      assert.ok(!text.includes(secret), `a profile leaked ${secret}`);
    }
    for (const key of allKeys(profile)) {
      assert.ok(
        !dto.FORBIDDEN_PUBLIC_KEYS.includes(key),
        `a profile carried the forbidden key ${key}`
      );
    }
  });

  test('a reel item carries nothing private', () => {
    const item = dto.toPublicReelItem(publicationObject(), profileObject(), {
      targetRole: 'Frontend Developer',
      city: 'Damascus',
    });

    const text = allText(item);
    for (const secret of PRIVATE_VALUES) {
      assert.ok(!text.includes(secret), `a reel item leaked ${secret}`);
    }
    for (const key of allKeys(item)) {
      assert.ok(!dto.FORBIDDEN_PUBLIC_KEYS.includes(key), `a reel item carried ${key}`);
    }
  });

  test('the private submission fields never reach a public shape', () => {
    // A Drive link and a note written for staff are private by construction.
    // The publication row does not carry them, and this is the assertion that
    // says so rather than assuming it.
    const profile = dto.toPublicProfile(
      profileObject(),
      [
        publicationObject({
          studentNote: 'I struggled with the deadline',
          googleDriveUrl: 'https://drive.google.com/file/d/secret/view',
        }),
      ],
      {}
    );

    const text = allText(profile);
    assert.ok(!text.includes('struggled'));
    assert.ok(!text.includes('drive.google.com'));
  });

  test('a photo is a path, never the bytes', () => {
    const card = dto.toPublicCard(publicationObject(), profileObject(), {});
    assert.ok(card.photoUrl?.startsWith('/talent/photo/'));
    assert.ok(!allText(card).includes('UklGRh4AAABXRUJQ'));
    // The slug addresses it, not an internal id.
    assert.ok(card.photoUrl?.includes('k3mq7wz2ptx9'));
    assert.ok(!card.photoUrl?.includes('profile1'));
  });

  test('a Student with no photo gets no photo field at all', () => {
    // An empty string would render as a broken image.
    const card = dto.toPublicCard(publicationObject(), profileObject({photoData: undefined}), {});
    assert.equal('photoUrl' in card, false);
  });

  test('the slug is the only identifier that crosses', () => {
    const profile = dto.toPublicProfile(profileObject(), [publicationObject()], {});
    assert.equal(profile.slug, 'k3mq7wz2ptx9');
    // Not derived from a name, so a rename cannot break a shared link, and not
    // derived from an objectId, so it exposes nothing about the database.
    assert.ok(!profile.slug.toLowerCase().includes('lina'));
    assert.ok(!profile.slug.includes('profile1'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the embedded video', () => {
  test('an embed URL is built from the id alone', () => {
    assert.equal(
      urls.embedUrlFor('dQw4w9WgXcQ'),
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  test('an id that is not an id produces no embed at all', () => {
    // Rather than a malformed URL that a template would happily put in a `src`.
    for (const bad of ['', 'short', '"><script>alert(1)</script>', 'dQw4w9WgXcQ&a=b']) {
      assert.equal(urls.embedUrlFor(bad), '', bad);
    }
  });

  test('the DTO exposes an embed and a watch URL, both constructed', () => {
    const video = dto.toPublicVideo('dQw4w9WgXcQ');
    assert.equal(video.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    assert.equal(video.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(video.videoId, 'dQw4w9WgXcQ');
  });

  test('no module builds an embed by string-joining user input', () => {
    // The one shape this must never take is `'...embed/' + whateverTheySent`.
    for (const name of ['dto', 'functions', 'repository']) {
      const source = moduleSource(name);
      assert.ok(
        !/embed\/['"`]\s*\+/.test(source),
        `${name}.ts must not concatenate an embed URL`
      );
    }
  });

  test('the Reel plays the demo when there is one, the project video otherwise', () => {
    const withDemo = dto.toPublicProject(
      publicationObject({demoVideoId: 'AAAAAAAAAAA', reelVideoId: 'AAAAAAAAAAA', demoTitle: 'My demo'})
    );
    assert.equal(withDemo.video.videoId, 'AAAAAAAAAAA');
    assert.equal(withDemo.title, 'My demo');
    assert.equal(withDemo.isDemo, true);

    const without = dto.toPublicProject(publicationObject());
    assert.equal(without.video.videoId, 'dQw4w9WgXcQ');
    assert.equal(without.title, 'Neighbourhood Recipe Exchange');
    assert.equal(without.isDemo, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the demo video URL', () => {
  test('every accepted YouTube shape yields the same id', () => {
    for (const url of [
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      // Shorts and embed joined the list in CP8B. Accepting an embed link is
      // not the same as trusting one: only the id survives, and every embed
      // this product renders is rebuilt from that id.
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      const result = urls.validateDemoVideoUrl(url);
      assert.ok(result.ok, url);
      assert.equal(result.value, 'dQw4w9WgXcQ');
    }
  });

  test('every other provider is refused', () => {
    // Named in the brief, one by one, because "we only take YouTube" is the
    // kind of claim that deserves to be checked rather than asserted.
    for (const url of [
      'https://drive.google.com/file/d/abc/view',
      'https://www.dropbox.com/s/abc/video.mp4',
      'https://onedrive.live.com/?id=abc',
      'https://vimeo.com/123456789',
      'https://www.loom.com/share/abc123',
      'https://www.tiktok.com/@someone/video/123',
      'https://www.facebook.com/watch/?v=123',
      'https://www.instagram.com/reel/abc/',
      'https://player.vimeo.com/video/123',
    ]) {
      assert.equal(urls.validateDemoVideoUrl(url).ok, false, url);
    }
  });

  test('a local file is refused', () => {
    for (const value of [
      'file:///C:/Users/lina/demo.mp4',
      '/home/lina/demo.mp4',
      'C:\\Users\\lina\\demo.mp4',
      'demo.mp4',
    ]) {
      assert.equal(urls.validateDemoVideoUrl(value).ok, false, value);
    }
  });

  test('a YouTube URL that is not a video is still refused', () => {
    // A playlist, a channel, and a handle are not videos, and `m.`/`music.`
    // are not on the list the public pages were specified against.
    for (const url of [
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@someone',
      'https://www.youtube.com/channel/UCabcdefghijk',
    ]) {
      assert.equal(urls.validateDemoVideoUrl(url).ok, false, url);
    }
  });

  test('the CP7 validator is untouched and still accepts what it always did', () => {
    // Narrowing it instead of keeping a second one would have retroactively
    // rejected values Students already stored.
    for (const url of [
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      assert.equal(urls.validateYoutubeUrl(url).ok, true, url);
    }
  });

  test('a hostile string is refused rather than reshaped', () => {
    for (const value of [
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>alert(1)</script>',
      'javascript:alert(1)',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com@evil.example/watch?v=dQw4w9WgXcQ',
    ]) {
      assert.equal(urls.validateDemoVideoUrl(value).ok, false, value);
    }
  });

  test('a stored URL is rebuilt, never kept as pasted', () => {
    const result = urls.validateDemoVideoUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&utm_source=newsletter'
    );
    assert.ok(result.ok);
    const rebuilt = urls.watchUrlFor(result.value);
    assert.equal(rebuilt, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.ok(!rebuilt.includes('utm_source'));
    assert.ok(!rebuilt.includes('list='));
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the publication lifecycle', () => {
  function taskObject(status = 'PUBLISHED'): Parse.Object {
    return object('BatchTask', {type: 'FINAL_TASK', status}, 'task1');
  }

  function submissionObject(attrs: Record<string, unknown> = {}): Parse.Object {
    return object(
      'TaskSubmission',
      {
        status: 'SUBMITTED',
        publicConsent: true,
        youtubeVideoId: 'dQw4w9WgXcQ',
        publicProjectTitle: 'Recipe exchange',
        publicProjectDescription: 'Swap recipes on one street.',
        myContribution: 'I built the front end.',
        technologies: ['Angular'],
        ...attrs,
      },
      'sub1'
    );
  }

  test('a complete consented Final Task on a published Task is eligible', () => {
    const result = publication.evaluateEligibility(
      submissionObject(),
      taskObject(),
      profileObject()
    );
    assert.equal(result.eligible, true);
  });

  test('removing consent makes it ineligible', () => {
    // The publication does not vanish from the database; its status changes and
    // every public query filters on that. To a Visitor it has disappeared.
    const result = publication.evaluateEligibility(
      submissionObject({publicConsent: false}),
      taskObject(),
      profileObject()
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'NO_CONSENT');
  });

  test('restoring consent makes it eligible again', () => {
    const withdrawn = publication.evaluateEligibility(
      submissionObject({publicConsent: false}),
      taskObject(),
      profileObject()
    );
    assert.equal(withdrawn.eligible, false);

    const restored = publication.evaluateEligibility(
      submissionObject({publicConsent: true}),
      taskObject(),
      profileObject()
    );
    assert.equal(restored.eligible, true);
  });

  test('a Final Task that is not published takes its Reels with it', () => {
    // An Admin closing or archiving a Final Task is withdrawing that piece of
    // work; the public pages built from it should not outlive it.
    for (const status of ['DRAFT', 'CLOSED', 'ARCHIVED']) {
      const result = publication.evaluateEligibility(
        submissionObject(),
        taskObject(status),
        profileObject()
      );
      assert.equal(result.eligible, false, status);
      assert.equal(result.reason, 'TASK_NOT_PUBLISHED', status);
    }
  });

  test('a draft submission is never published', () => {
    const result = publication.evaluateEligibility(
      submissionObject({status: 'DRAFT'}),
      taskObject(),
      profileObject()
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'NOT_SUBMITTED');
  });

  test('an Assignment is never published', () => {
    const result = publication.evaluateEligibility(
      submissionObject(),
      object('BatchTask', {type: 'ASSIGNMENT', status: 'PUBLISHED'}, 'task1'),
      profileObject()
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'NOT_FINAL_TASK');
  });

  test('consent is checked before the content', () => {
    // A complete project without consent is not a near miss; it is somebody
    // who said no, and the reason should say so.
    const result = publication.evaluateEligibility(
      submissionObject({publicConsent: false, publicProjectTitle: ''}),
      taskObject(),
      profileObject()
    );
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, 'NO_CONSENT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('a Final Task status change sweeps its Reels', () => {
  /*
    The gap runtime validation found, and no unit test would have.

    `evaluateEligibility` requires the Task to be published — but publication is
    otherwise re-decided only when a Student *submits*, and a Student cannot
    submit to a Task that was just closed. So the rule was true in the checker
    and false in the database: closing a Final Task left its Reels on the
    internet.
  */
  test('the sweep exists and is wired to the status change', () => {
    const publicationSource = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    assert.ok(
      publicationSource.includes('export async function reevaluateTaskPublications'),
      'the sweep must exist'
    );

    const adminSource = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'adminFunctions.ts'),
      'utf8'
    );
    assert.ok(
      adminSource.includes('reevaluateTaskPublications'),
      'setBatchTaskStatus must call it'
    );
  });

  test('the sweep refuses to override an Admin suppression', () => {
    // Re-publishing a Task must not quietly undo a Reel an Admin took down.
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    const sweep = source.slice(source.indexOf('export async function reevaluateTaskPublications'));
    assert.ok(sweep.includes("get('adminSuppressed') === true"));
  });

  test('the sweep never throws into the caller', () => {
    // An Admin closing a Task should not fail because a Reel could not be
    // updated, so every write inside it goes through `catchError`.
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    const sweep = source.slice(source.indexOf('export async function reevaluateTaskPublications'));
    const saves = (sweep.match(/savePublication\(/g) ?? []).length;
    const guarded = (sweep.match(/catchError\(/g) ?? []).length;
    assert.ok(saves > 0, 'the sweep should write something');
    assert.ok(guarded >= saves, `${saves} writes but only ${guarded} guarded`);
  });
});

describe('visibility is derived, and every input has a trigger ⟨CP8B⟩', () => {
  /*
    The product rule is "a Student is public only while every condition holds".
    A condition nobody re-checks is not a condition, so each input needs
    something that notices when it changes.
  */
  function taskObject(status = 'PUBLISHED'): Parse.Object {
    return object('BatchTask', {type: 'FINAL_TASK', status}, 'task1');
  }

  function submissionObject(attrs: Record<string, unknown> = {}): Parse.Object {
    return object(
      'TaskSubmission',
      {
        status: 'SUBMITTED',
        publicConsent: true,
        youtubeVideoId: 'dQw4w9WgXcQ',
        publicProjectTitle: 'Recipe exchange',
        publicProjectDescription: 'Swap recipes on one street.',
        myContribution: 'I built the front end.',
        technologies: ['Angular'],
        ...attrs,
      },
      'sub1'
    );
  }

  test('a profile that has never been complete is not public', () => {
    // A half-filled profile makes a poor public page.
    const result = publication.evaluateEligibility(
      submissionObject(),
      taskObject(),
      profileObject({isComplete: false, profileEverComplete: false})
    );
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, 'PROFILE_INCOMPLETE');
  });

  test('a profile that was complete once stays public while it is edited ⟨CP8C⟩', () => {
    /*
      The whole point of the latch.

      `isComplete` is false here — the Student has cleared a field, which is what
      happens the moment somebody starts retyping their About. Before CP8C that
      took them off the public pages mid-edit and put them back when they
      finished. Publication now reads the latch, so it does not move.
    */
    const result = publication.evaluateEligibility(
      submissionObject(),
      taskObject(),
      profileObject({isComplete: false, profileEverComplete: true})
    );
    assert.equal(result.eligible, true);
  });

  test('a complete profile with everything else in place is', () => {
    const result = publication.evaluateEligibility(
      submissionObject(),
      taskObject(),
      profileObject()
    );
    assert.equal(result.eligible, true);
  });

  test('every input that can change visibility has something watching it', () => {
    /*
      Task status, consent, submission content, submission deletion, and the
      profile. The first three are re-decided on submit; the last two needed
      their own sweeps, because a Student who deletes a draft or empties their
      profile never touches a Task.
    */
    const publicationSource = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    for (const sweep of [
      'reevaluatePublication',
      'reevaluateTaskPublications',
      'reevaluateProfilePublications',
      'withdrawPublicationForSubmission',
    ]) {
      assert.ok(publicationSource.includes(`export async function ${sweep}`), `${sweep} must exist`);
    }

    const student = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'studentFunctions.ts'),
      'utf8'
    );
    assert.ok(student.includes('withdrawPublicationForSubmission'), 'delete must withdraw');

    const profileFunctions = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'StudentProfile', 'functions.ts'),
      'utf8'
    );
    assert.ok(
      profileFunctions.includes('reevaluateProfilePublications'),
      'saving a profile must re-decide publication'
    );
  });

  test('no sweep can be talked into overriding an Admin suppression', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    for (const sweep of ['reevaluateTaskPublications', 'reevaluateProfilePublications']) {
      const body = source.slice(source.indexOf(`export async function ${sweep}`));
      const next = body.indexOf('\nexport ', 10);
      const scoped = next === -1 ? body : body.slice(0, next);
      assert.ok(
        scoped.includes("get('adminSuppressed') === true"),
        `${sweep} must respect suppression`
      );
    }
  });

  test('no sweep throws into the operation that triggered it', () => {
    // Saving a profile, closing a Task, and deleting a draft are all reasonable
    // things to do; none should fail because a Reel could not be updated.
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    for (const sweep of [
      'reevaluateTaskPublications',
      'reevaluateProfilePublications',
      'withdrawPublicationForSubmission',
    ]) {
      const body = source.slice(source.indexOf(`export async function ${sweep}`));
      const next = body.indexOf('\nexport ', 10);
      const scoped = next === -1 ? body : body.slice(0, next);
      const saves = (scoped.match(/savePublication\(/g) ?? []).length;
      const guarded = (scoped.match(/catchError\(/g) ?? []).length;
      assert.ok(guarded >= saves, `${sweep}: ${saves} writes but only ${guarded} guarded`);
    }
  });

  test('there is no manual publish or unpublish on the public surface', () => {
    // Publication is a consequence. The only Admin levers are CP7's, and they
    // live behind a session.
    const source = moduleSource('functions');
    for (const forbidden of ['publish', 'approve', 'moderate', 'review']) {
      assert.ok(
        !new RegExp(`async \w*${forbidden}`, 'i').test(source),
        `the public surface must not expose a ${forbidden} operation`
      );
    }
  });
});

describe('search and sort ⟨CP8B⟩', () => {
  test('a search term is escaped before it becomes a pattern', () => {
    // It reaches a regular expression. An unescaped `(` from a search box is at
    // best an error and at worst a pattern that costs the database real time.
    const source = moduleSource('repository');
    // Asserted as "escape, then compile, in that order" rather than by matching
    // the character class character-for-character — a test that pinned the exact
    // escape set would fail the day somebody correctly added one to it.
    const escapeAt = source.indexOf('const escaped = filters.search.replace(');
    const compileAt = source.indexOf('new RegExp(escaped');
    assert.ok(escapeAt !== -1, 'the term must be escaped');
    assert.ok(compileAt !== -1, 'and only then compiled');
    assert.ok(escapeAt < compileAt, 'escaping must happen before compiling');
    // The raw term must never reach the query.
    assert.ok(!source.includes('new RegExp(filters.search'), 'the raw term must not be compiled');
  });

  test('a search term is bounded', () => {
    const source = moduleSource('functions');
    assert.ok(/search\.slice\(0, \d+\)/.test(source), 'the term must be length-capped');
  });

  test('sort accepts exactly two values and defaults to newest', () => {
    const source = moduleSource('functions');
    assert.ok(source.includes("params['sort'] === 'oldest' ? 'oldest' : 'newest'"));
  });

  test('the reel and the directory share one ordering rule', () => {
    // Two orderings would mean the reel and the grid disagreeing about what is
    // newest, which is the kind of thing nobody notices until they do. Both
    // read `publishedQuery`, so there is exactly one place the order is set.
    const source = moduleSource('repository');
    assert.equal((source.match(/Descending\('publishedAt'\)/g) ?? []).length, 1);
    assert.equal((source.match(/Ascending\('publishedAt'\)/g) ?? []).length, 1);
  });

  test('pinned rows come first, ahead of the Visitor’s own sort ⟨CP8C⟩', () => {
    const source = moduleSource('repository');
    const pin = source.indexOf("descending('pinnedAt')");
    assert.ok(pin > -1, 'the public query must order on the pin');

    // Ahead of publishedAt in the source, which is what decides precedence:
    // Parse applies the first sort key first.
    for (const later of ["addAscending('publishedAt')", "addDescending('publishedAt')"]) {
      assert.ok(source.indexOf(later) > pin, `${later} must come after the pin`);
    }

    // Ordering on the Date, not the Boolean. MongoDB ranks a missing field below
    // a Boolean, so descending on `pinned` would split the unpinned tail into
    // never-pinned and once-pinned — and an unpin would not fully undo itself.
    assert.ok(!/descending\('pinned'\)/.test(source));
  });
});

describe('the public slug', () => {
  test('is twelve characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const slug = publication.newPublicSlug();
      assert.equal(slug.length, 12);
      // No `l`, `1`, `0`, or `i`: a slug gets read aloud and typed from a
      // screenshot, and those four are where that goes wrong.
      assert.match(slug, /^[abcdefghijkmnopqrstuvwxyz23456789]+$/);
    }
  });

  test('two slugs in a row are not the same', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(publication.newPublicSlug());
    // 500 draws from ~60 bits should collide never; anything less than 500
    // distinct values means it is not actually random.
    assert.equal(seen.size, 500);
  });

  test('it is not derived from a name or an id', () => {
    // Which is what makes a rename safe and an internal id unguessable.
    const source = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', 'publication.ts'),
      'utf8'
    );
    const slugFunction = source.slice(
      source.indexOf('export function newPublicSlug'),
      source.indexOf('export async function ensurePublicSlug')
    );
    for (const forbidden of ['fullName', 'objectId', '.id', 'email']) {
      assert.ok(!slugFunction.includes(forbidden), `the slug must not use ${forbidden}`);
    }
    assert.ok(slugFunction.includes('randomBytes'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('pagination and filters', () => {
  test('a page is always bounded, whatever was asked for', () => {
    assert.deepEqual(repository.boundPage(0, 24), {skip: 0, limit: 24});
    // A request for everything gets one page.
    assert.equal(repository.boundPage(0, 100000).limit, constants.PUBLIC_PAGE.maxLimit);
    assert.equal(repository.boundPage(0, -5).limit, constants.PUBLIC_PAGE.defaultLimit);
    assert.equal(repository.boundPage(-10, 10).skip, 0);
    assert.equal(repository.boundPage('nonsense', 'nonsense').limit, constants.PUBLIC_PAGE.defaultLimit);
  });

  test('the default page is small enough to send and large enough to fill a grid', () => {
    assert.ok(constants.PUBLIC_PAGE.defaultLimit >= 12);
    assert.ok(constants.PUBLIC_PAGE.maxLimit <= 100);
  });

  test('every public read filters on published status', () => {
    // One rule, in one place, with no second path to forget.
    const source = moduleSource('repository');
    const reads = source.split('new Parse.Query(PUBLICATION_CLASS)').length - 1;
    const gated = source.split("equalTo('status', PUBLICATION_STATUS.PUBLISHED)").length - 1;
    assert.ok(reads >= 1, 'there should be at least one publication query');
    assert.ok(
      gated >= 1 && source.includes('publishedQuery'),
      'publication queries must go through the published-only helper'
    );
  });

  test('public reads never include the private submission', () => {
    // Everything a public page needs is snapshotted onto the publication, so
    // the read never has to touch `TaskSubmission` — and an `include` that did
    // would carry the note and the Drive link out with it.
    const source = moduleSource('repository');
    assert.ok(!source.includes("include('submission')"));
    assert.ok(!source.includes('TaskSubmission'));
  });

  test('a caching header cannot outlive a withdrawal by long', () => {
    // A Student who removes consent expects to disappear. A long cache would
    // leave them on a CDN for as long as it lasted.
    assert.ok(constants.PUBLIC_CACHE_SECONDS <= 300);
    assert.ok(constants.PUBLIC_PHOTO_CACHE_SECONDS <= 600);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('the public stylesheet', () => {
  /*
    Two touch targets a rendered phone viewport caught and nothing else could.

    Both measured under 24px at 390px wide. Neither overflowed, errored, or
    failed an assertion — they were simply too small to hit, which is only
    visible when something actually lays the page out.
  */
  const CSS_PATH = join(REPO_ROOT, 'frontend', 'src', 'styles', 'public-talent.css');

  function css(): string {
    return readFileSync(CSS_PATH, 'utf8');
  }

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

  test('the demo checkbox is big enough to hit', () => {
    // Measured 20x20 at 390px. Stated in pixels: a fingertip does not scale
    // with the type ramp, and this application's root font size is 14px.
    const rule = ruleBody('.cyf-public-check input');
    assert.match(rule, /min-inline-size:\s*24px/);
    assert.match(rule, /min-block-size:\s*24px/);
  });

  test('the way back off a profile is big enough to hit', () => {
    // Measured 92x19 at 390px — the only navigation a public page has.
    const rule = ruleBody('.cyf-public-breadcrumb a');
    assert.match(rule, /min-block-size:\s*44px/);
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

  test('the reel scroller snaps in CSS rather than by intercepting scrolling', () => {
    // A wheel handler would break a trackpad, a keyboard, and a screen reader.
    const rule = ruleBody('.cyf-reel-scroller');
    assert.match(rule, /scroll-snap-type/);
    assert.match(rule, /overscroll-behavior:\s*contain/);
  });

  test('somebody who asked for less motion does not get a snapping scroll', () => {
    const source = css();
    const reduced = source.slice(source.indexOf('prefers-reduced-motion'));
    assert.ok(reduced.includes('scroll-snap-type: none'));
  });
});

describe('the public photo route', () => {
  test('is addressed by slug, never by an internal id', () => {
    const source = moduleSource('photoRoute');
    assert.ok(source.includes('/talent/photo/:slug'));
    assert.ok(!source.includes(':profileId'));
    assert.ok(!source.includes('objectId'));
  });

  test('re-checks publication rather than trusting the URL', () => {
    // A Visitor can type this address directly, and a Student who withdrew
    // consent must stop having a face on the internet.
    const source = moduleSource('photoRoute');
    assert.ok(source.includes('findPublishedPhoto'));
  });

  test('an unknown slug and an unpublished one answer identically', () => {
    // Distinguishing them would let somebody enumerate which slugs are real.
    const source = moduleSource('photoRoute');
    const bodies = [...source.matchAll(/res\.status\(404\)\.json\(([^)]*)\)/g)].map(m => m[1]);
    assert.ok(bodies.length >= 1);
    assert.equal(new Set(bodies).size, 1, 'every 404 must carry the same body');
  });

  test('the bytes are served with a type and no sniffing', () => {
    const source = moduleSource('photoRoute');
    assert.ok(source.includes('X-Content-Type-Options'));
    assert.ok(source.includes('STORED_PHOTO_MIME'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CP8C — stable visibility, and the Admin's highlight
// ═══════════════════════════════════════════════════════════════════════════

const batchTask = (name: string): string =>
  readFileSync(
    join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'BatchTask', `${name}.ts`),
    'utf8'
  );

const modelSource = (name: string): string =>
  readFileSync(join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'models', `${name}.ts`), 'utf8');

/** The body of one exported function, so a check cannot match a neighbour. */
function exportedBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const at = start === -1 ? source.indexOf(`export function ${name}`) : start;
  assert.ok(at > -1, `${name} must exist`);
  const rest = source.slice(at);
  const next = rest.indexOf('\nexport ', 10);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('public visibility does not flicker while a profile is edited ⟨CP8C⟩', () => {
  /*
    The bug this closes.

    Publication used to read `isComplete`, which describes the profile *right
    now*. Clearing one field to retype it made that false, and the profile-save
    sweep then withdrew the Student — so editing your About took you off the
    public pages until you finished, and put you back when you did. Publication
    now reads a latch that only ever goes true.
  */

  test('the latch exists, is a real column, and is never cleared', () => {
    const source = modelSource('StudentProfile');
    assert.ok(source.includes('profileEverComplete'), 'the latch must be a stored field');

    // Exactly one write, and it writes true. Setting it false anywhere would
    // make this a state again rather than a latch.
    const writes = [...source.matchAll(/set\('profileEverComplete',\s*([a-z]+)\)/g)].map(m => m[1]);
    assert.deepEqual(writes, ['true'], 'the latch may only ever be set to true');
    assert.ok(!source.includes("unset('profileEverComplete')"), 'the latch is never unset');
  });

  test('it is latched in the trigger, so no write path can skip it', () => {
    // In the trigger rather than in the save operation: a future write path that
    // forgot would otherwise silently never publish anybody.
    const source = modelSource('StudentProfile');
    const trigger = source.slice(source.indexOf('static async onBeforeSave'));
    assert.ok(trigger.includes('profileEverComplete'), 'the latch belongs in the trigger');
  });

  test('eligibility reads the latch and not the live flag', () => {
    const body = exportedBody(batchTask('publication'), 'evaluateEligibility');
    assert.ok(body.includes('profileEverComplete'), 'eligibility must read the latch');
    assert.ok(
      !/get\('isComplete'\)/.test(body),
      'reading isComplete here is what made an in-progress edit unpublish somebody'
    );
  });

  test('saving a profile can publish but can never unpublish', () => {
    /*
      The sweep is one-directional on purpose. Saving a profile is not a decision
      to stop being public — the things that are (consent, the Final Task, an
      Admin) each have their own path.
    */
    const body = exportedBody(batchTask('publication'), 'reevaluateProfilePublications');
    assert.ok(!body.includes('UNPUBLISHED'), 'the profile sweep must not withdraw anybody');
  });

  test('the ways to lose visibility are still exactly the intended ones', () => {
    // Consent and the Final Task both still withdraw. Without this check, the
    // stability CP8C adds could be read as "nothing ever unpublishes".
    const source = batchTask('publication');
    for (const sweep of ['reevaluatePublication', 'reevaluateTaskPublications']) {
      assert.ok(
        exportedBody(source, sweep).includes('UNPUBLISHED'),
        `${sweep} must still be able to withdraw`
      );
    }
    assert.ok(source.includes('export async function withdrawPublicationForSubmission'));
  });

  test('the latch is not readable by a client, and not in the Student own DTO', () => {
    // It is publication machinery. A Student seeing two completeness flags would
    // have two answers to one question and no way to tell which one is theirs.
    const source = modelSource('StudentProfile');
    const clp = source.slice(source.indexOf('protectedFields'), source.indexOf('ACL:'));
    assert.equal(
      (clp.match(/'profileEverComplete'/g) ?? []).length,
      2,
      'both audiences must be denied the latch'
    );

    const profileDto = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'modules', 'StudentProfile', 'dto.ts'),
      'utf8'
    );
    assert.ok(!profileDto.includes('profileEverComplete'), 'the Student DTO must not carry it');
  });
});

describe('the Admin pin ⟨CP8C⟩', () => {
  test('it lives on the publication, not on the profile', () => {
    // A pin is a fact about a published piece of work. On the profile it would
    // also outlive the publication it highlights.
    assert.ok(modelSource('TalentReelPublication').includes('pinned'));
    assert.ok(!modelSource('StudentProfile').includes('pinned'));
  });

  test('both controls exist and are Admin-only', () => {
    const source = batchTask('reelFunctions');
    for (const fn of ['pinTalentReel', 'unpinTalentReel']) {
      assert.ok(source.includes(`async ${fn}(`), `${fn} must exist`);
    }
    // One shared implementation, so authorisation cannot be right in one control
    // and missing in the other.
    const body = source.slice(source.indexOf('async function setPinned'));
    assert.ok(body.includes('requireAdmin'), 'pinning is an Admin action');
  });

  test('pinning refuses a Student who is not currently public', () => {
    /*
      The rule the brief is most specific about: pinning must never publish
      anybody. Refusing is the honest answer — the alternative is a control that
      appears to work and changes nothing a Visitor can see.
    */
    const source = batchTask('reelFunctions');
    const body = source.slice(source.indexOf('async function setPinned'));

    assert.ok(body.includes('TALENT_REEL_NOT_FOUND'), 'no publication is a refusal');
    assert.ok(
      /if \(pinned &&[\s\S]{0,80}PUBLICATION_STATUS\.PUBLISHED\)/.test(body),
      'pinning must be conditional on being published'
    );
    // Nothing in here creates or publishes a record.
    for (const forbidden of ['snapshotOf', 'ensurePublicSlug']) {
      assert.ok(!body.includes(forbidden), `pinning must not touch ${forbidden}`);
    }
  });

  test('unpinning is always allowed, so a stale pin can be cleared', () => {
    // The publication check is guarded, so the unpin path skips it.
    const source = batchTask('reelFunctions');
    assert.ok(/if \(pinned &&/.test(source.slice(source.indexOf('async function setPinned'))));
  });

  test('a pin cannot outlive the publication it highlights', () => {
    // Enforced on the model rather than at each call site: there are several
    // ways to stop being published and every one would have to remember.
    const source = modelSource('TalentReelPublication');
    const trigger = source.slice(source.indexOf('static async onBeforeSave'));
    assert.ok(trigger.includes("set('pinned', false)"), 'losing publication clears the pin');
    assert.ok(trigger.includes("unset('pinnedAt')"), 'and clears the sort key with it');
  });

  test('the public surface exposes the boolean and never the sort key', () => {
    const source = moduleSource('dto');
    assert.equal(
      (source.match(/pinned: publication\.get\('pinned'\) === true/g) ?? []).length,
      2,
      'both the card and the reel item carry the boolean'
    );
    assert.ok(!source.includes('pinnedAt:'), 'pinnedAt must never be built into a DTO');
    assert.ok(
      dto.FORBIDDEN_PUBLIC_KEYS.includes('pinnedAt'),
      'pinnedAt belongs on the forbidden list'
    );
    assert.ok(!dto.FORBIDDEN_PUBLIC_KEYS.includes('pinned'));
  });

  test('a Student is never told they were pinned', () => {
    /*
      The Student DTO is what somebody reads about their own work. A Student who
      could see the flag would reasonably start asking to be pinned, and one who
      watched it disappear would read a decision into a page being reordered.
    */
    const taskDto = batchTask('dto');
    const student = taskDto.slice(
      taskDto.indexOf('export interface SubmissionDto'),
      taskDto.indexOf('export interface AdminSubmissionDto')
    );
    assert.ok(!student.includes('Pinned'), 'the Student DTO must not carry the pin');
    assert.ok(
      taskDto
        .slice(taskDto.indexOf('export interface AdminSubmissionDto'))
        .includes('talentReelPinned'),
      'the Admin DTO must'
    );
  });

  test('an index backs the order the public pages actually ask for', () => {
    // A sort with no index behind it is a table scan on the one surface with no
    // session in front of it.
    const source = modelSource('TalentReelPublication');
    assert.ok(source.includes("fields: ['status', 'pinnedAt', 'publishedAt']"));
  });

  test('the controls call the shared implementation unbound', () => {
    /*
      The bug runtime validation found, and the reason this assertion exists.

      `setPinned` began as a private method and both controls called it as
      `this.setPinned(...)`. That compiles, and it satisfies every check above —
      the authorisation really is in the body. But the kit invokes a registered
      cloud function unbound, so `this` is undefined inside one, and the first
      real request answered `Cannot read properties of undefined`. Nothing
      source-shaped could catch that; only a live call could.
    */
    // Comments stripped first: the note above the function names the very call
    // it warns against, and matching prose would fail this forever.
    const source = batchTask('reelFunctions')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(
      !/this\.\w+\(/.test(source),
      'a cloud function cannot reach anything through `this`'
    );
    assert.ok(
      source.includes('async function setPinned('),
      'the shared implementation must be a module-level function'
    );
  });

  test('pinning did not bring an approval workflow with it', () => {
    // The brief was explicit: reuse the existing publication panel, add nothing.
    const source = batchTask('reelFunctions');

    // Names, not prose: this file's own header says in words that these levers
    // are not approvals, and matching that sentence proved nothing.
    for (const absent of ['approve', 'reject', 'moderat', 'Queue', 'pendingReview']) {
      const declared = new RegExp(`(async|function|const|let)\s+\w*${absent}`, 'i');
      assert.ok(!declared.test(source), `pinning must not introduce ${absent}`);
    }
  });
});
