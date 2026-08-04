/**
 * The Admin's Talent Reel controls, and the Student Detail history ⟨CP7⟩.
 *
 * ── Two levers, and neither is an approval ──────────────────────────────────
 * An Admin can take a Reel down and put it back. They cannot edit the project
 * title, the description, the technologies, the contribution, or the video, and
 * they cannot grant consent on a Student's behalf — every one of those is the
 * Student's account of their own work, and an Admin editing it would publish
 * words the Student never wrote under the Student's name.
 *
 * Unpublish is a **safety control**, so it works even when everything else about
 * the Batch has closed. Publish Again is not: it needs the latest Submission to
 * still be submitted, complete, and consented, because it publishes that
 * Submission rather than restoring an old snapshot.
 */

import {CloudFunction, Route} from '@90soft/parse-server-kit';

import {requireAdmin} from '../../utils/auth/authorize';
import {PUBLICATION_SOURCE, PUBLICATION_STATUS, TASK_PAGE} from './constants';
import {
  PublicationDto,
  TaskHistoryRowDto,
  toPublicationDto,
} from './dto';
import {TaskError, taskError} from './errors';
import {taskLog} from './logging';
import {evaluateEligibility, ensurePublicSlug} from './publication';
import {
  findProfileForStudent,
  findPublicationForSubmission,
  findPublicationsForSubmissions,
  findSubmissionById,
  findSubmissionsForProfile,
  savePublication,
} from './repository';
import {SubmissionStatus, TaskType} from './constants';

function bounded(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

@Route('talent-reels')
class TalentReelAdminFunctions {
  /**
   * Take a Reel down.
   *
   * Allowed at any time, including after the Batch is completed or archived —
   * that is the point of a safety control. It changes nothing about the
   * Student's Submission; it only sets the record's status and the sticky
   * `adminSuppressed` flag that stops the automatic path putting it back.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {submissionId: {required: true, type: String}}},
    swagger: {
      summary: 'Unpublish a Talent Reel',
      description:
        'A safety control. Works in any Batch state, survives a Student ' +
        'resubmitting, and changes nothing about the Submission. Admins only.',
      tags: ['Talent Reels'],
      responses: {
        '200': {description: 'The suppressed publication'},
        '404': {description: 'No publication for that Submission'},
      },
    },
  })
  async unpublishTalentReel(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'unpublishTalentReel');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const submission = await findSubmissionById(params['submissionId']);
    if (!submission) throw taskError(TaskError.SUBMISSION_NOT_FOUND);

    const publication = await findPublicationForSubmission(submission.id);
    if (!publication) throw taskError(TaskError.TALENT_REEL_NOT_FOUND);

    const saved = await savePublication(publication, {
      status: PUBLICATION_STATUS.UNPUBLISHED,
      adminSuppressed: true,
      unpublishedAt: new Date(),
      unpublishedBy: admin,
    });

    taskLog.info('Talent Reel unpublished by an Admin', {
      op: 'unpublishTalentReel',
      stage: 'reel',
      ok: true,
      userId: admin.id,
      submissionId: submission.id,
      publicationId: saved.id,
      published: false,
    });

    return toPublicationDto(saved);
  }

  /**
   * Put a Reel back.
   *
   * Re-checks eligibility against the **latest** Submission rather than trusting
   * the stored snapshot: a Student may have withdrawn consent or removed the
   * video since it was suppressed, and republishing then would show something
   * nobody currently agrees to.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {submissionId: {required: true, type: String}}},
    swagger: {
      summary: 'Publish a Talent Reel again',
      description:
        'Clears the Admin suppression and refreshes the snapshot, but only if ' +
        'the latest Submission is still submitted, complete, and consented.',
      tags: ['Talent Reels'],
      responses: {
        '200': {description: 'The published publication'},
        '400': {description: 'The latest Submission is not eligible'},
      },
    },
  })
  async republishTalentReel(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'republishTalentReel');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const submission = await findSubmissionById(params['submissionId']);
    if (!submission) throw taskError(TaskError.SUBMISSION_NOT_FOUND);

    const publication = await findPublicationForSubmission(submission.id);
    if (!publication) throw taskError(TaskError.TALENT_REEL_NOT_FOUND);

    const task = submission.get('task') as Parse.Object | undefined;
    if (!task) throw taskError(TaskError.TASK_NOT_FOUND);

    const student = submission.get('student') as Parse.User | undefined;
    const profile = student ? await findProfileForStudent(student) : undefined;

    // The Student's current position, not the snapshot's. An Admin cannot
    // publish something the Student has since withdrawn.
    const eligibility = evaluateEligibility(submission, task, profile);
    if (!eligibility.eligible) {
      taskLog.warn('Republish refused: the latest Submission is not eligible', {
        op: 'republishTalentReel',
        stage: 'reel',
        ok: false,
        userId: admin.id,
        submissionId: submission.id,
        code: eligibility.reason,
      });
      throw taskError(TaskError.TALENT_REEL_NOT_ELIGIBLE);
    }

    if (profile) await ensurePublicSlug(profile);

    const technologies = submission.get('technologies');
    const github = String(submission.get('githubUrl') ?? '').trim();
    const demo = String(submission.get('liveDemoUrl') ?? '').trim();

    const saved = await savePublication(publication, {
      // Suppression is cleared first, because the model refuses a published
      // record that is still suppressed.
      adminSuppressed: false,
      status: PUBLICATION_STATUS.PUBLISHED,
      publicationSource: PUBLICATION_SOURCE.ADMIN_REPUBLISH,
      projectTitle: String(submission.get('publicProjectTitle') ?? '').trim(),
      projectDescription: String(submission.get('publicProjectDescription') ?? '').trim(),
      contribution: String(submission.get('myContribution') ?? '').trim(),
      technologies: Array.isArray(technologies) ? technologies : [],
      youtubeVideoId: String(submission.get('youtubeVideoId') ?? '').trim(),
      githubUrl: github.length > 0 ? github : undefined,
      liveDemoUrl: demo.length > 0 ? demo : undefined,
      unpublishedAt: undefined,
      unpublishedBy: undefined,
    });

    taskLog.info('Talent Reel published again by an Admin', {
      op: 'republishTalentReel',
      stage: 'reel',
      ok: true,
      userId: admin.id,
      submissionId: submission.id,
      publicationId: saved.id,
      published: true,
    });

    return toPublicationDto(saved);
  }
}

@Route('task-history')
class TaskHistoryFunctions {
  /**
   * One Student's Tasks and Submissions, across every Batch.
   *
   * Admin only, and read-only: there is no edit, no delete, no score, no
   * feedback, and no version history. The response carries what was asked and
   * what was handed in, and nothing that looks like a judgement of it.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {studentId: {required: true, type: String}}},
    swagger: {
      summary: 'List a Student’s Tasks and Submissions',
      description:
        'Every Batch, newest first, paged. Admins only. Read-only — there is ' +
        'no edit, delete, score, or feedback anywhere in this surface.',
      tags: ['Tasks'],
      responses: {
        '200': {description: 'Safe history rows'},
        '404': {description: 'No such Student, or not an Admin'},
      },
    },
  })
  async listStudentTaskHistory(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listStudentTaskHistory');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const studentId = typeof params['studentId'] === 'string' ? params['studentId'].trim() : '';
    if (studentId.length === 0) throw taskError(TaskError.SUBMISSION_NOT_FOUND);

    // The profile is resolved from the Student, so a caller naming a profile id
    // directly gets nowhere.
    const student = new Parse.User();
    student.id = studentId;
    const profile = await findProfileForStudent(student);
    if (!profile) return {items: [], total: 0};

    const skip = bounded(params['skip'], 0, 10_000);
    const limit = bounded(params['limit'], TASK_PAGE.defaultLimit, TASK_PAGE.maxLimit);

    const page = await findSubmissionsForProfile(profile.id, {
      skip,
      limit: limit || TASK_PAGE.defaultLimit,
    });

    const publications = await findPublicationsForSubmissions(page.items.map(row => row.id));

    const items: TaskHistoryRowDto[] = [];
    for (const submission of page.items) {
      const task = submission.get('task') as Parse.Object | undefined;
      const batch = task?.get('batch') as Parse.Object | undefined;
      if (!task) continue;

      const row: TaskHistoryRowDto = {
        id: submission.id,
        batchId: String(batch?.id ?? ''),
        batchName: String(batch?.get('name') ?? ''),
        taskId: task.id,
        taskTitle: String(task.get('title') ?? ''),
        taskType: task.get('type') as TaskType,
        submissionStatus: submission.get('status') as SubmissionStatus,
      };

      const deadline = task.get('deadline');
      if (deadline instanceof Date) row.deadline = deadline.toISOString();

      const submittedAt = submission.get('submittedAt');
      if (submittedAt instanceof Date) row.submittedAt = submittedAt.toISOString();

      const updatedAt = submission.get('updatedAt');
      if (updatedAt instanceof Date) row.updatedAt = updatedAt.toISOString();

      const publication = publications.get(submission.id);
      if (publication) row.talentReelStatus = publication.get('status');

      items.push(row);
    }

    taskLog.info('Student Task history listed', {
      op: 'listStudentTaskHistory',
      stage: 'load',
      ok: true,
      userId: admin.id,
      count: items.length,
    });

    return {items, total: page.total};
  }
}

export {TalentReelAdminFunctions, TaskHistoryFunctions};
export type {PublicationDto};
