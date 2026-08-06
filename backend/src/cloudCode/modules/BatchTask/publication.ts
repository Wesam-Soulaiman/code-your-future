/**
 * Deciding whether a project may be shown publicly ⟨CP7⟩.
 *
 * ── Publication is a consequence, not a decision ────────────────────────────
 * Nobody approves a Talent Reel. A Final Task Submission either meets every
 * condition — submitted, consented, and complete — or it does not, and this
 * module works out which after every submit. That is the whole point of the
 * product goal: an Admin who has to approve each one is an Admin doing work the
 * Student already did.
 *
 * ── Admin suppression is the one exception, and it must be sticky ───────────
 * An Admin can take a Reel down for safety at any time. That decision has to
 * **survive the Student resubmitting**, or the thing an Admin removed would come
 * back on its own the next time the Student edited a typo. So suppression is a
 * separate flag that the automatic path reads and refuses to override; only an
 * explicit Publish Again clears it.
 *
 * ── The snapshot is copied, not referenced ──────────────────────────────────
 * When a Reel publishes, the public fields are copied onto the publication row.
 * Reading them back from the Submission would mean every later edit silently
 * changed what the public sees, with no moment at which anybody consented to the
 * new words.
 */

import {randomBytes} from 'crypto';

import {catchError} from '@90soft/parse-server-kit';

import {
  PUBLICATION_SOURCE,
  PUBLICATION_STATUS,
  PUBLIC_SLUG_ALPHABET,
  PUBLIC_SLUG_LENGTH,
  SUBMISSION_STATUS,
  TASK_STATUS,
  TASK_TYPE,
  TECHNOLOGY_COUNT,
} from './constants';
import {taskLog} from './logging';
import {
  findPublicationForSubmission,
  findPublicationsForProfile,
  findPublicationsForTask,
  findSubmissionById,
  findProfileForStudent,
  savePublication,
} from './repository';

/** Why a Submission is not publishable. Diagnostic, never shown to a Visitor. */
export type IneligibleReason =
  | 'NOT_FINAL_TASK'
  | 'TASK_NOT_PUBLISHED'
  | 'NOT_SUBMITTED'
  | 'NO_CONSENT'
  | 'NO_VIDEO'
  | 'INCOMPLETE_PROJECT'
  | 'NO_PROFILE'
  | 'PROFILE_INCOMPLETE';

export type Eligibility =
  | {eligible: true}
  | {eligible: false; reason: IneligibleReason};

/**
 * Does this Submission meet every condition for publication?
 *
 * Checked in the order a person would explain them: what kind of Task it is,
 * whether it was handed in, whether the Student agreed, and only then whether
 * the content is complete.
 */
export function evaluateEligibility(
  submission: Parse.Object,
  task: Parse.Object,
  profile: Parse.Object | undefined
): Eligibility {
  if (task.get('type') !== TASK_TYPE.FINAL_TASK) {
    return {eligible: false, reason: 'NOT_FINAL_TASK'};
  }

  /*
    The Final Task itself must be published ⟨CP8⟩.

    A Student can only submit to a published Task, so in the ordinary run of
    things this is already true by the time anybody gets here. It is checked
    anyway, because the Task can move afterwards: an Admin who closes or
    archives a Final Task is taking that piece of work out of circulation, and
    the public Reels built from it should go with it rather than outliving the
    thing they came from.

    This is not an approval step. Nothing new is asked of an Admin, and there is
    no queue, no review, and no decision to make — publishing the Task is the
    same action that let Students submit to it in the first place.
  */
  if (task.get('status') !== TASK_STATUS.PUBLISHED) {
    return {eligible: false, reason: 'TASK_NOT_PUBLISHED'};
  }
  if (submission.get('status') !== SUBMISSION_STATUS.SUBMITTED) {
    return {eligible: false, reason: 'NOT_SUBMITTED'};
  }
  // Consent is checked before the content: a complete project without consent
  // is not a near miss, it is a Student who said no.
  if (submission.get('publicConsent') !== true) {
    return {eligible: false, reason: 'NO_CONSENT'};
  }

  const video = String(submission.get('youtubeVideoId') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(video)) {
    return {eligible: false, reason: 'NO_VIDEO'};
  }

  const title = String(submission.get('publicProjectTitle') ?? '').trim();
  const description = String(submission.get('publicProjectDescription') ?? '').trim();
  const contribution = String(submission.get('myContribution') ?? '').trim();
  const technologies = submission.get('technologies');

  if (
    title.length === 0 ||
    description.length === 0 ||
    contribution.length === 0 ||
    !Array.isArray(technologies) ||
    technologies.length < TECHNOLOGY_COUNT.min
  ) {
    return {eligible: false, reason: 'INCOMPLETE_PROJECT'};
  }

  // A public page belongs to a profile. Without one there is nowhere to show it
  // and nobody to attribute it to.
  if (!profile) return {eligible: false, reason: 'NO_PROFILE'};
  if (String(profile.get('fullName') ?? '').trim().length === 0) {
    return {eligible: false, reason: 'NO_PROFILE'};
  }

  /*
    The profile must have been complete **at least once** ⟨CP8C⟩.

    Deliberately not `isComplete`. That flag describes the profile right now,
    and it goes false the moment a Student clears a field — so publication that
    depended on it would drop somebody out of the public pages while they were
    rewording their About, and put them back when they finished. Nobody asked to
    be unpublished by editing.

    `profileEverComplete` latches true the first time the profile is genuinely
    complete and never goes back, so publication is gated on the Student having
    finished the form once. After that, only a real decision withdraws them:
    losing consent, the Final Task being taken down, or an Admin suppressing it.
  */
  if (profile.get('profileEverComplete') !== true) {
    return {eligible: false, reason: 'PROFILE_INCOMPLETE'};
  }

  return {eligible: true};
}

/**
 * A URL-safe public identifier.
 *
 * The alphabet deliberately omits `l`, `1`, `0`, and `i` — a slug ends up read
 * aloud and typed from a screenshot, and those four are where that goes wrong.
 * Twelve characters of the remaining thirty-three is about 60 bits, which is
 * not guessable.
 */
export function newPublicSlug(): string {
  const bytes = randomBytes(PUBLIC_SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < PUBLIC_SLUG_LENGTH; i += 1) {
    slug += PUBLIC_SLUG_ALPHABET[bytes[i] % PUBLIC_SLUG_ALPHABET.length];
  }
  return slug;
}

/**
 * Give this profile a public slug if it has none.
 *
 * Called only when a Reel actually publishes, so a Student who never publishes
 * never gets one — the column is not a public handle for everybody who signs up.
 *
 * A collision loses the unique index and is retried; after a few attempts the
 * publication proceeds without minting, because failing somebody's publication
 * over a slug is worse than deferring the slug to their next one.
 */
export async function ensurePublicSlug(profile: Parse.Object): Promise<string | undefined> {
  const existing = String(profile.get('publicProfileSlug') ?? '').trim();
  if (existing.length > 0) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = newPublicSlug();
    profile.set('publicProfileSlug', slug);
    const [error] = await catchError(profile.save(null, {useMasterKey: true}));
    if (!error) return slug;

    // Someone else took it, or the save failed. Re-read and try again.
    profile.set('publicProfileSlug', existing || undefined);
    const [refetchError, fresh] = await catchError(profile.fetch({useMasterKey: true}));
    if (!refetchError && fresh) {
      const now = String((fresh as Parse.Object).get('publicProfileSlug') ?? '').trim();
      if (now.length > 0) return now;
    }
  }

  taskLog.warn('Could not mint a public slug; publication continues without one', {
    op: 'ensurePublicSlug',
    stage: 'reel',
    ok: false,
  });
  return undefined;
}

/** The public snapshot, copied from a Submission at the moment it publishes. */
function snapshotOf(submission: Parse.Object, task: Parse.Object): Record<string, unknown> {
  const technologies = submission.get('technologies');
  const github = String(submission.get('githubUrl') ?? '').trim();
  const demo = String(submission.get('liveDemoUrl') ?? '').trim();
  const projectVideo = String(submission.get('youtubeVideoId') ?? '').trim();
  const demoVideo = String(submission.get('demoVideoId') ?? '').trim();
  const demoTitle = String(submission.get('demoTitle') ?? '').trim();

  return {
    submission,
    task,
    batch: submission.get('batch'),
    student: submission.get('student'),
    studentProfile: submission.get('studentProfile'),
    projectTitle: String(submission.get('publicProjectTitle') ?? '').trim(),
    projectDescription: String(submission.get('publicProjectDescription') ?? '').trim(),
    contribution: String(submission.get('myContribution') ?? '').trim(),
    technologies: Array.isArray(technologies) ? technologies : [],
    youtubeVideoId: projectVideo,
    // Published only when the Student actually supplied one. Absent is absent,
    // not an empty string on a public page.
    githubUrl: github.length > 0 ? github : undefined,
    liveDemoUrl: demo.length > 0 ? demo : undefined,

    /*
      The demo ⟨CP8⟩, and the one video the Reel plays.

      `reelVideoId` is resolved here, once, rather than left to each page: the
      demo when the Student gave one, the project video otherwise. A page that
      chose for itself would be a page that could choose differently from the
      next one, and the "Has demo" badge would stop meaning anything.
    */
    demoTitle: demoTitle.length > 0 ? demoTitle : undefined,
    demoVideoId: demoVideo.length > 0 ? demoVideo : undefined,
    reelVideoId: demoVideo.length > 0 ? demoVideo : projectVideo,
  };
}

export interface PublicationOutcome {
  publication?: Parse.Object;
  published: boolean;
  reason?: IneligibleReason | 'ADMIN_SUPPRESSED';
}

/**
 * Re-evaluate a Submission's publication after it changed.
 *
 * Called after every Final Task submit **and** after a submitted row is saved
 * back to Draft. The second case is the one that matters most: a Student who
 * pulls their work back must stop being published immediately, without an Admin
 * noticing.
 *
 * Never throws into the caller's path. A Submission succeeding must not depend
 * on a Reel publishing — the product says an incomplete Talent Reel is a fine
 * outcome for a Final Task, and a failure here is an operational problem, not
 * the Student's.
 */
export async function reevaluatePublication(
  submission: Parse.Object,
  task: Parse.Object,
  profile: Parse.Object | undefined
): Promise<PublicationOutcome> {
  const existing = await findPublicationForSubmission(submission.id);
  const eligibility = evaluateEligibility(submission, task, profile);

  // ── Not eligible: unpublish if there is anything to unpublish ─────────────
  if (!eligibility.eligible) {
    if (!existing) return {published: false, reason: eligibility.reason};
    if (existing.get('status') === PUBLICATION_STATUS.UNPUBLISHED) {
      return {publication: existing, published: false, reason: eligibility.reason};
    }

    const [error, saved] = await catchError(
      savePublication(existing, {
        status: PUBLICATION_STATUS.UNPUBLISHED,
        unpublishedAt: new Date(),
      })
    );
    if (error) return {publication: existing, published: false, reason: eligibility.reason};

    taskLog.info('Talent Reel unpublished by a change to the Submission', {
      op: 'reevaluatePublication',
      stage: 'reel',
      ok: true,
      submissionId: submission.id,
      publicationId: (saved as Parse.Object).id,
      published: false,
      code: eligibility.reason,
    });
    return {publication: saved as Parse.Object, published: false, reason: eligibility.reason};
  }

  /*
    Eligible — but an Admin may have taken it down.

    This is the sticky bit. A suppressed record keeps its snapshot refreshed so
    that a later Publish Again shows the Student's latest consented work, but it
    stays UNPUBLISHED no matter how many times they resubmit.
  */
  if (existing?.get('adminSuppressed') === true) {
    const [error, saved] = await catchError(
      savePublication(existing, {
        ...snapshotOf(submission, task),
        status: PUBLICATION_STATUS.UNPUBLISHED,
      })
    );

    taskLog.info('Talent Reel stayed suppressed after a resubmission', {
      op: 'reevaluatePublication',
      stage: 'reel',
      ok: true,
      submissionId: submission.id,
      publicationId: existing.id,
      published: false,
      code: 'ADMIN_SUPPRESSED',
    });
    return {
      publication: error ? existing : (saved as Parse.Object),
      published: false,
      reason: 'ADMIN_SUPPRESSED',
    };
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  if (profile) await ensurePublicSlug(profile);

  const [error, saved] = await catchError(
    savePublication(existing, {
      ...snapshotOf(submission, task),
      status: PUBLICATION_STATUS.PUBLISHED,
      adminSuppressed: false,
      publicationSource: PUBLICATION_SOURCE.AUTOMATIC,
      unpublishedAt: undefined,
    })
  );
  if (error) {
    // The Submission already succeeded. A publication that could not be written
    // is an operational failure, reported and not raised.
    taskLog.error('Talent Reel publication failed after an eligible submit', {
      op: 'reevaluatePublication',
      stage: 'reel',
      ok: false,
      submissionId: submission.id,
      published: false,
    });
    return {publication: existing, published: false};
  }

  taskLog.info('Talent Reel published', {
    op: 'reevaluatePublication',
    stage: 'reel',
    ok: true,
    submissionId: submission.id,
    publicationId: (saved as Parse.Object).id,
    published: true,
  });
  return {publication: saved as Parse.Object, published: true};
}


/**
 * Re-decide every publication a Final Task produced ⟨CP8⟩.
 *
 * Called when an Admin moves a Final Task's status. It exists because
 * `evaluateEligibility` requires the Task to be published, and nothing else
 * would ever notice that it stopped being: publication is otherwise re-decided
 * only when a Student submits, and a Student cannot submit to a Task that has
 * just been closed.
 *
 * Without this the rule would be true in the checker and false in the database
 * — the worst kind of half-implemented guarantee, because the code reads as
 * though it holds.
 *
 * Never throws into the caller. An Admin closing a Task is doing something
 * reasonable, and failing that operation because a Reel could not be updated
 * would be a worse outcome than a Reel that lags by one edit.
 */
export async function reevaluateTaskPublications(task: Parse.Object): Promise<void> {
  if (task.get('type') !== TASK_TYPE.FINAL_TASK) return;

  const [findError, publications] = await catchError(findPublicationsForTask(task.id));
  if (findError || !publications) return;

  const nowPublished = task.get('status') === TASK_STATUS.PUBLISHED;

  for (const publication of publications) {
    // A suppressed record stays suppressed. An Admin took it down deliberately,
    // and re-publishing a Task must not quietly undo that.
    if (publication.get('adminSuppressed') === true) continue;

    if (!nowPublished) {
      if (publication.get('status') !== PUBLICATION_STATUS.PUBLISHED) continue;
      await catchError(
        savePublication(publication, {
          status: PUBLICATION_STATUS.UNPUBLISHED,
          unpublishedAt: new Date(),
        })
      );
      continue;
    }

    // Back to published: the Student's own conditions still have to hold, so
    // this asks the same question the submit path asks rather than assuming.
    const submissionPointer = publication.get('submission') as Parse.Object | undefined;
    if (!submissionPointer?.id) continue;

    const [submissionError, submission] = await catchError(
      findSubmissionById(submissionPointer.id)
    );
    if (submissionError || !submission) continue;

    const student = submission.get('student') as Parse.User | undefined;
    if (!student) continue;

    const [profileError, profile] = await catchError(findProfileForStudent(student));
    if (profileError) continue;

    const eligibility = evaluateEligibility(submission, task, profile);
    if (!eligibility.eligible) continue;

    await catchError(
      savePublication(publication, {
        ...snapshotOf(submission, task),
        status: PUBLICATION_STATUS.PUBLISHED,
        publishedAt: publication.get('publishedAt') ?? new Date(),
      })
    );
  }

  taskLog.info('Talent Reels re-evaluated after a Task status change', {
    op: 'reevaluateTaskPublications',
    stage: 'reel',
    ok: true,
    taskId: task.id,
    status: String(task.get('status') ?? ''),
    count: publications.length,
  });
}


/**
 * Re-decide every publication belonging to one Student ⟨CP8B⟩.
 *
 * Called when their profile is saved, and it can only ever **publish** ⟨CP8C⟩.
 *
 * Publication is gated on the profile having been complete once. A Student who
 * submits an eligible Final Task before finishing their profile becomes
 * publishable the moment they finish it, and no submit would notice that — so
 * this does.
 *
 * It never withdraws. The public profile reads a Student's name, About, links,
 * city, and role **live** from the profile row, so ordinary edits already reach
 * the public page without anything being republished. There is nothing an edit
 * can do here except make somebody visible who was entitled to be.
 *
 * Never throws into the caller. Saving a profile must not fail because a Reel
 * could not be updated.
 */
export async function reevaluateProfilePublications(profile: Parse.Object): Promise<void> {
  const [findError, publications] = await catchError(findPublicationsForProfile(profile.id));
  if (findError || !publications || publications.length === 0) return;

  let changed = 0;

  for (const publication of publications) {
    if (publication.get('adminSuppressed') === true) continue;

    /*
      This sweep can only ever **publish** ⟨CP8C⟩.

      There is deliberately no branch here that unpublishes. Saving a profile is
      not a decision to stop being public, and an earlier version of this
      function withdrew anybody whose profile was momentarily incomplete — which
      meant clearing one field to retype it took you off the internet.

      What it is still for: a Student who submitted an eligible Final Task
      *before* finishing their profile becomes publishable the moment they
      finish it, and nothing else would notice that.
    */
    const submissionPointer = publication.get('submission') as Parse.Object | undefined;
    const taskPointer = publication.get('task') as Parse.Object | undefined;
    if (!submissionPointer?.id || !taskPointer?.id) continue;

    const [submissionError, submission] = await catchError(
      findSubmissionById(submissionPointer.id)
    );
    if (submissionError || !submission) continue;

    const task = submission.get('task') as Parse.Object | undefined;
    if (!task) continue;

    const eligibility = evaluateEligibility(submission, task, profile);
    if (!eligibility.eligible) continue;

    await catchError(
      savePublication(publication, {
        ...snapshotOf(submission, task),
        status: PUBLICATION_STATUS.PUBLISHED,
        publishedAt: publication.get('publishedAt') ?? new Date(),
      })
    );
    changed += 1;
  }

  taskLog.info('Talent Reels re-evaluated after a profile change', {
    op: 'reevaluateProfilePublications',
    stage: 'reel',
    ok: true,
    count: changed,
  });
}

/**
 * Withdraw the publication a deleted Submission produced ⟨CP8B⟩.
 *
 * Only a never-submitted Draft can be deleted, so in practice this fires for a
 * row that was never published. It exists anyway because the rule is "no
 * Submission, no public page", and a rule that depends on a delete path
 * happening to be unreachable is a rule waiting to break.
 */
export async function withdrawPublicationForSubmission(submissionId: string): Promise<void> {
  const [findError, publication] = await catchError(findPublicationForSubmission(submissionId));
  if (findError || !publication) return;
  if (publication.get('status') !== PUBLICATION_STATUS.PUBLISHED) return;

  await catchError(
    savePublication(publication, {
      status: PUBLICATION_STATUS.UNPUBLISHED,
      unpublishedAt: new Date(),
    })
  );

  taskLog.info('Talent Reel withdrawn with its Submission', {
    op: 'withdrawPublicationForSubmission',
    stage: 'reel',
    ok: true,
    submissionId,
  });
}
