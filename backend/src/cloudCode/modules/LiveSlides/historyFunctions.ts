/**
 * One Student's Live Slides answers, across every completed session ⟨CP6⟩.
 *
 * ── Why this is not an array on the profile ─────────────────────────────────
 * The product says a Student's answers are *part of their profile history*, and
 * the obvious reading of that is a `liveAnswers` array on `StudentProfile`. It
 * is the wrong shape for three reasons, and they compound:
 *
 *   - it is **unbounded** — every lecture appends, so the row grows without a
 *     ceiling and is loaded whole on every read of the profile, including the
 *     reads that only wanted a name;
 *   - it cannot carry a **unique index**, so "one answer per Student per
 *     Question" would go back to being an application check two requests can
 *     race past;
 *   - it makes an answer **editable** by anybody who can write the profile,
 *     which is precisely the promise this checkpoint exists to keep.
 *
 * So the link runs the other way: each `LiveResponse` carries a `studentProfile`
 * pointer, indexed with `submittedAt`, and this operation reads that index. The
 * profile stays bounded, the answers stay immutable, and the history is a query
 * rather than a column.
 *
 * Completed sessions only. A running lecture's answers belong on the presenter's
 * panel, not in a permanent record that is still changing.
 */

import {CloudFunction, Route} from '@90soft/parse-server-kit';

import {requireAdmin} from '../../utils/auth/authorize';
import {AnswerType, HISTORY_PAGE, SESSION_STATUS} from './constants';
import {labelsFor, selectedIdsOf} from './dto';
import {LiveSlidesError, liveSlidesError} from './errors';
import {liveLog} from './logging';
import {findHistoryForProfile, findProfileForStudent} from './repository';

/** One answer, flattened for a table row. */
export interface AnswerHistoryRow {
  id: string;
  batchName: string;
  sessionId: string;
  sessionTitle: string;
  sessionDate?: string;
  question: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

function iso(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

function calendarDate(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : undefined;
}

function bounded(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

@Route('live-history')
class LiveHistoryFunctions {
  /**
   * The Live Slides answers stored against one Student's profile.
   *
   * Admin only, and read-only: there is no edit operation, no delete operation,
   * and no score. The response carries what was asked and what was said, and
   * nothing that looks like a judgement of it.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {studentId: {required: true, type: String}}},
    swagger: {
      summary: 'List a Student’s Live Slide answers',
      description:
        'Completed sessions only, newest first, paged. Admins only. Read-only ' +
        '— there is no edit, delete, score, or feedback anywhere in this surface.',
      tags: ['Live Slides'],
      responses: {
        '200': {description: 'Safe answer-history rows'},
        '404': {description: 'No such Student, or not an Admin'},
      },
    },
  })
  async listStudentLiveAnswers(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listStudentLiveAnswers');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const studentId = typeof params['studentId'] === 'string' ? params['studentId'].trim() : '';
    if (studentId.length === 0) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    // The profile is resolved from the Student, so a caller naming a profile id
    // directly gets nowhere.
    const student = new Parse.User();
    student.id = studentId;
    const profile = await findProfileForStudent(student);
    if (!profile) return {items: [], total: 0};

    const skip = bounded(params['skip'], 0, 10_000);
    const limit = bounded(params['limit'], HISTORY_PAGE.defaultLimit, HISTORY_PAGE.maxLimit);

    const page = await findHistoryForProfile(profile.id, {skip, limit: limit || HISTORY_PAGE.defaultLimit});

    const items: AnswerHistoryRow[] = [];
    for (const response of page.items) {
      const session = response.get('session') as Parse.Object | undefined;
      // Completed sessions only. Filtered here rather than in the query because
      // the status lives on the session, not on the response.
      if (session?.get('status') !== SESSION_STATUS.COMPLETED) continue;

      const slide = response.get('slide') as Parse.Object | undefined;
      const batch = session?.get('batch') as Parse.Object | undefined;
      const ids = selectedIdsOf(response);

      const row: AnswerHistoryRow = {
        id: response.id,
        batchName: String(batch?.get('name') ?? ''),
        sessionId: String(session?.id ?? ''),
        sessionTitle: String(session?.get('title') ?? ''),
        question: String(slide?.get('question') ?? ''),
        answerType: response.get('answerType') as AnswerType,
      };

      const sessionDate = calendarDate(session?.get('sessionDate'));
      if (sessionDate) row.sessionDate = sessionDate;

      const text = response.get('textAnswer');
      if (typeof text === 'string' && text.length > 0) row.textAnswer = text;

      if (ids.length > 0) row.selectedOptionLabels = labelsFor(slide, ids);

      const submittedAt = iso(response.get('submittedAt'));
      if (submittedAt) row.submittedAt = submittedAt;

      items.push(row);
    }

    liveLog.info('Student live answers listed', {
      op: 'listStudentLiveAnswers',
      stage: 'load',
      ok: true,
      userId: admin.id,
      count: items.length,
    });

    return {items, total: page.total};
  }
}

export {LiveHistoryFunctions};
