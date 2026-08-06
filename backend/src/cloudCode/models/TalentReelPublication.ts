import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {
  PUBLICATION_STATUS,
  PUBLICATION_STATUSES,
  PublicationStatus,
  TASK_LIMITS,
  TECHNOLOGY_COUNT,
} from '../modules/BatchTask/constants';

/**
 * `TalentReelPublication` — the record of a project being publishable ⟨CP7⟩.
 *
 * This is **not** the public page. Checkpoint 8 adds that. What exists now is
 * the record that decides whether a page may exist, and the snapshot it would
 * show.
 *
 * ── Why it is a snapshot and not a join ────────────────────────────────────
 * The obvious design is to render a Reel by reading the Submission. It is wrong
 * in one specific way: a Student may keep editing after publication, and each
 * save would silently change what the public already sees, with no moment where
 * anybody consented to the new text. Copying the fields at the moment of a valid
 * submit means the public snapshot only ever changes when the Student submits
 * something they have consented to publish.
 *
 * ── `adminSuppressed` is a boolean, not a status ───────────────────────────
 * An Admin unpublishing for safety must **survive** the Student resubmitting.
 * If suppression were a status, the next automatic publication would overwrite
 * it and the thing an Admin took down would come back on its own. As a separate
 * flag, the automatic path can see it and decline, and only an explicit Publish
 * Again clears it.
 *
 * ── What this never stores ─────────────────────────────────────────────────
 * No email, phone, city, date of birth, education, Google Drive URL, Student
 * Note, or any private profile field. The columns here are exactly what the
 * consent text lists, and nothing else — so a future public page physically
 * cannot leak something the Student did not agree to.
 */
@ParseClass('TalentReelPublication', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'submission',
        'task',
        'batch',
        'student',
        'studentProfile',
        'status',
        'adminSuppressed',
        'projectTitle',
        'projectDescription',
        'technologies',
        'contribution',
        'youtubeVideoId',
        'githubUrl',
        'liveDemoUrl',
        'publishedAt',
        'unpublishedAt',
        'unpublishedBy',
        'publicationSource',
        'pinned',
        'pinnedAt',
      ],
      authenticated: [
        'submission',
        'task',
        'batch',
        'student',
        'studentProfile',
        'status',
        'adminSuppressed',
        'projectTitle',
        'projectDescription',
        'technologies',
        'contribution',
        'youtubeVideoId',
        'githubUrl',
        'liveDemoUrl',
        'publishedAt',
        'unpublishedAt',
        'unpublishedBy',
        'publicationSource',
        'pinned',
        'pinnedAt',
      ],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // One publication per Submission. Unique because two records for one
      // Submission would mean two answers to "is this published?".
      fields: ['_p_submission'],
      unique: true,
      name: 'talent_reel_submission_unique',
      partialFilterNulls: true,
    },
    {
      // A Student's own Reels across Batches.
      fields: ['_p_studentProfile', 'status'],
      name: 'talent_reel_profile_status_index',
    },
    {
      // What Checkpoint 8's public listing will read: published, newest first.
      fields: ['status', 'publishedAt'],
      name: 'talent_reel_status_published_index',
    },
    {
      // What it reads since CP8C: published, pinned first, then newest. The
      // public endpoints are the one surface with no session in front of them,
      // so their sort is the one that must not become a scan.
      fields: ['status', 'pinnedAt', 'publishedAt'],
      name: 'talent_reel_status_pinned_published_index',
    },
    {
      // The Admin's per-Batch view.
      fields: ['_p_batch', 'status'],
      name: 'talent_reel_batch_status_index',
    },
  ],
  description:
    'Whether one Final Task project may be shown publicly, and the consented ' +
    'snapshot it would show. Not the public page — that is Checkpoint 8.',
})
export default class TalentReelPublication extends BaseModel {
  constructor() {
    super('TalentReelPublication');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'TaskSubmission',
    required: true,
    description: 'The Submission this publishes. Immutable',
  })
  submission!: Parse.Object;

  @ParseField({type: 'Pointer', targetClass: 'BatchTask', required: true, description: 'The Final Task'})
  task!: Parse.Object;

  @ParseField({type: 'Pointer', targetClass: 'Batch', required: true, description: 'The Batch'})
  batch!: Parse.Object;

  @ParseField({type: 'Pointer', targetClass: '_User', required: true, description: 'The Student'})
  student!: Parse.User;

  @ParseField({
    type: 'Pointer',
    targetClass: 'StudentProfile',
    required: true,
    description: 'The profile a public page would belong to',
  })
  studentProfile!: Parse.Object;

  @ParseField({type: 'String', required: true, description: 'PUBLISHED | UNPUBLISHED'})
  status!: PublicationStatus;

  @ParseField({
    type: 'Boolean',
    required: true,
    description: 'An Admin took it down. Survives a Student resubmit; only Publish Again clears it',
  })
  adminSuppressed!: boolean;

  // ── The consented snapshot ────────────────────────────────────────────────

  @ParseField({type: 'String', required: true, description: 'Public project title'})
  projectTitle!: string;

  @ParseField({type: 'String', required: true, description: 'Public project description'})
  projectDescription!: string;

  @ParseField({type: 'Array', required: true, description: 'Public technology list'})
  technologies!: string[];

  @ParseField({type: 'String', required: true, description: 'What the Student did'})
  contribution!: string;

  @ParseField({type: 'String', required: true, description: 'The video id alone, never embed HTML'})
  youtubeVideoId!: string;

  @ParseField({type: 'String', description: 'Published only when the Student supplied one'})
  githubUrl!: string;

  @ParseField({type: 'String', description: 'Published only when the Student supplied one'})
  liveDemoUrl!: string;

  /*
    The demo, snapshotted ⟨CP8⟩.

    Copied here rather than read through the Submission pointer when a public
    page renders. The Submission is a private record — it holds a note written
    for staff and a Drive link that is never published — and a public query that
    reached into it would be one `include` away from carrying all of that out
    with it. Everything the public pages need lives on this row, so the public
    read never touches `TaskSubmission` at all.

    `demoVideoId` is empty when the Student added no demo. `reelVideoId` is the
    one the page actually plays: the demo when there is one, the project video
    otherwise. Resolving it once here means no page has to choose, and no page
    can choose differently.
  */
  @ParseField({type: 'String', description: 'CP8. The Student’s demo title, when they gave one'})
  demoTitle!: string;

  @ParseField({type: 'String', description: 'CP8. The demo video id, when they gave one'})
  demoVideoId!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'CP8. The id the Reel plays: the demo when present, else the project video',
  })
  reelVideoId!: string;

  /*
    An Admin's highlight ⟨CP8C⟩.

    Ordering only. Pinning does not publish anybody, does not override privacy,
    and does not change a single field a Visitor can read beyond a boolean that
    says "shown first". A Student who is not published cannot be pinned, and
    unpinning changes nothing except where they appear in a list.

    It lives here rather than on `StudentProfile` because it is a fact about a
    *published piece of work*, not about a person: an Admin highlighting a
    capstone is highlighting that project. It also means a publication being
    withdrawn takes its pin out of the ordering with it, without anybody having
    to remember to.
  */
  @ParseField({
    type: 'Boolean',
    description: 'CP8C. Admin highlight. Ordering only — never a publication decision',
  })
  pinned!: boolean;

  /*
    Why the public sort orders on this rather than on `pinned` ⟨CP8C⟩.

    MongoDB ranks a *missing* field below a Boolean, so a descending sort on
    `pinned` yields three groups, not two: pinned, then explicitly-unpinned, then
    rows that were never pinned at all. The newest-first ordering then only holds
    *within* each group, and somebody who was once pinned would sit permanently
    above a newer publication that never was — an unpin that does not really
    undo itself.

    `pinnedAt` is set and unset together with `pinned`, and a missing Date is a
    single group. Ordering on it gives exactly the two the product asks for:
    pinned first, then everybody else in their normal order.
  */
  @ParseField({type: 'Date', description: 'CP8C. When it was pinned. Server clock only. Unset when not pinned'})
  pinnedAt!: Date;

  // ── Stamps ────────────────────────────────────────────────────────────────

  @ParseField({type: 'Date', description: 'When it first became published. Server clock only'})
  publishedAt!: Date;

  @ParseField({type: 'Date', description: 'When it last became unpublished'})
  unpublishedAt!: Date;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    description: 'The Admin who suppressed it. Internal; never in a public DTO',
  })
  unpublishedBy!: Parse.User;

  @ParseField({type: 'String', description: 'AUTOMATIC | ADMIN_REPUBLISH. Operational detail'})
  publicationSource!: string;

  /**
   * The invariants.
   *
   * The strongest is the last one: a **published** record must carry every
   * public field. Checkpoint 8 will render from these columns, and a row that
   * says PUBLISHED with a missing title would be a broken public page rather
   * than an absent one.
   */
  @BeforeSave({description: 'Reject client writes; a published record must be complete'})
  static async onBeforeSave(
    request: Parse.Cloud.BeforeSaveRequest<TalentReelPublication>
  ): Promise<void> {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'TalentReelPublication is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      for (const required of ['submission', 'task', 'batch', 'student', 'studentProfile']) {
        if (!object.get(required)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `A publication requires ${required}`);
        }
      }
    } else {
      /*
        Compare the stored id, not `dirty('submission')`.

        A pointer counts as dirty the moment it is assigned, even when the value
        is identical — and the update path re-sets every field including this
        one. `dirty()` therefore refused **every** update to an existing
        publication: the snapshot never refreshed after a Student resubmitted,
        and the failure was swallowed because publication must never break a
        submit. The invariant that matters is "this row still belongs to the
        same Submission", so that is what is checked.
      */
      const previous = request.original?.get('submission') as Parse.Object | undefined;
      const current = object.get('submission') as Parse.Object | undefined;
      if (previous?.id && current?.id && previous.id !== current.id) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'A publication cannot change Submission'
        );
      }
    }

    const status = object.get('status');
    if (!PUBLICATION_STATUSES.includes(status as PublicationStatus)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported publication status');
    }

    if (object.get('adminSuppressed') === undefined) object.set('adminSuppressed', false);
    if (object.get('pinned') === undefined) object.set('pinned', false);

    if (status === PUBLICATION_STATUS.PUBLISHED) {
      // A suppressed record can never also be published — that combination is
      // what an Admin pressed Unpublish to prevent.
      if (object.get('adminSuppressed') === true) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A suppressed publication cannot be published'
        );
      }

      const title = String(object.get('projectTitle') ?? '').trim();
      const description = String(object.get('projectDescription') ?? '').trim();
      const contribution = String(object.get('contribution') ?? '').trim();
      const video = String(object.get('youtubeVideoId') ?? '').trim();
      const technologies = object.get('technologies');

      if (
        title.length < TASK_LIMITS.publicProjectTitle.min ||
        title.length > TASK_LIMITS.publicProjectTitle.max
      ) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A published Reel requires a title');
      }
      if (
        description.length < TASK_LIMITS.publicProjectDescription.min ||
        description.length > TASK_LIMITS.publicProjectDescription.max
      ) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A published Reel requires a description'
        );
      }
      if (
        contribution.length < TASK_LIMITS.myContribution.min ||
        contribution.length > TASK_LIMITS.myContribution.max
      ) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A published Reel requires a contribution'
        );
      }
      if (!/^[A-Za-z0-9_-]{11}$/.test(video)) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A published Reel requires a video');
      }
      if (
        !Array.isArray(technologies) ||
        technologies.length < TECHNOLOGY_COUNT.min ||
        technologies.length > TECHNOLOGY_COUNT.max
      ) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'A published Reel requires its technologies'
        );
      }

      if (!object.get('publishedAt')) object.set('publishedAt', new Date());
    } else {
      if (!object.get('unpublishedAt')) object.set('unpublishedAt', new Date());

      /*
        A pin cannot outlive the publication it highlights ⟨CP8C⟩.

        Enforced here rather than at each call site because there are several
        ways to stop being published — consent withdrawn, the Final Task closed,
        an Admin suppressing — and every one of them would otherwise have to
        remember to clear the pin. Missing it would leave a highlight pointing at
        a row no public query returns, which is invisible until the Student is
        republished and silently jumps to the front of the page.
      */
      if (object.get('pinned') === true) object.set('pinned', false);
      if (object.get('pinnedAt')) object.unset('pinnedAt');
    }

    object.setACL(new Parse.ACL());
  }
}
