/**
 * What a Student can see and do in a Live session ⟨CP6⟩.
 *
 * ── The whole surface is "me" ───────────────────────────────────────────────
 * Every operation here resolves the Student from **their session token**. No
 * signature accepts a `studentId` or a `studentProfileId`, so none of them can
 * be pointed at somebody else even by mistake — and nothing any of them returns
 * mentions another Student's name, answer, or existence. A Student sitting in
 * the room sees the same slide as everybody else and their own answer; that is
 * the entire contract.
 *
 * ── Submitting is once, and the database is what enforces it ────────────────
 * `submitLiveResponse` checks everything it can and then relies on a unique
 * index for the thing checks cannot do: two taps, two devices, or two racing
 * requests produce exactly one row, and the loser is told `ALREADY_SUBMITTED`
 * and shown what they actually submitted.
 */

import {CloudFunction, Route} from '@90soft/parse-server-kit';

import {rejectPrivilegedParams, requireStudent} from '../../utils/auth/authorize';
import {findEnrollment} from '../Batch/repository';
import {batchOf, describeViewer, requireEnrolled} from './access';
import {SESSION_STATUS, SLIDE_TYPE, SessionStatus} from './constants';
import {
  StudentResponseDto,
  toStudentResponseDto,
  toStudentSlideDto,
} from './dto';
import {LiveSlidesError, liveSlidesError} from './errors';
import {liveLog} from './logging';
import {
  createResponse,
  findProfileForStudent,
  findResponse,
  findResponsesForStudentInSession,
  findSessionById,
  findSlidesForSession,
  findStudentVisibleSession,
} from './repository';
import {findPrivilegedLiveFields, validateAnswer} from './validation';

/** A calendar date as `YYYY-MM-DD`. */
function calendarDate(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : undefined;
}

/**
 * The session metadata a Student may see.
 *
 * Title, description, date, status. No creator, no presenter, no counts of who
 * has answered — a Student learning that nineteen of twenty have submitted is
 * being told something about the other nineteen.
 */
function studentSessionDto(session: Parse.Object, slideCount: number) {
  return {
    id: session.id,
    title: String(session.get('title') ?? ''),
    description: session.get('description') ? String(session.get('description')) : undefined,
    sessionDate: calendarDate(session.get('sessionDate')),
    status: session.get('status') as SessionStatus,
    slideCount,
  };
}

@Route('student-live')
class StudentLiveFunctions {
  /**
   * Everything this Student's live page needs, in one answer.
   *
   * Their client asks for this on a timer, and the answer is authoritative: the
   * current Slide, whether it is still open, and their own submission if they
   * made one. A reconnecting Student therefore needs no other call and no page
   * refresh — the next tick simply tells them the truth.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Get my live session state',
      description:
        'The session for a Batch this Student has joined, the current Slide, ' +
        'and their own response. Requires a live enrollment.',
      tags: ['Live Slides'],
      responses: {
        '200': {description: 'Safe state for this Student'},
        '404': {description: 'No such Batch, or the caller is not in it'},
      },
    },
  })
  async getMyLiveState(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'getMyLiveState');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batchId = typeof params['batchId'] === 'string' ? params['batchId'].trim() : '';
    if (batchId.length === 0) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    const viewer = await describeViewer(student);
    await requireEnrolled(viewer, batchId, 'getMyLiveState');

    const session = await findStudentVisibleSession(batchId);
    if (!session) return {session: undefined};

    const slides = await findSlidesForSession(session.id);
    const status = session.get('status') as SessionStatus;
    const base = {session: studentSessionDto(session, slides.length)};

    if (status !== SESSION_STATUS.LIVE) {
      // Ready: waiting. Completed: their own answers, and nobody else's.
      if (status !== SESSION_STATUS.COMPLETED) return base;

      const mine = await findResponsesForStudentInSession(session.id, student);
      const byId = new Map(slides.map(slide => [slide.id, slide]));
      return {
        ...base,
        questions: slides
          .filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION)
          .map(slide => toStudentSlideDto(slide)),
        myResponses: mine.map(response =>
          toStudentResponseDto(
            response,
            byId.get((response.get('slide') as Parse.Object | undefined)?.id ?? '')
          )
        ),
      };
    }

    const currentId = (session.get('currentSlide') as Parse.Object | undefined)?.id;
    const index = slides.findIndex(slide => slide.id === currentId);
    const slide = index >= 0 ? slides[index] : slides[0];
    if (!slide) return base;

    let myResponse: StudentResponseDto | undefined;
    if (slide.get('type') === SLIDE_TYPE.QUESTION) {
      const existing = await findResponse(session.id, slide.id, student);
      if (existing) myResponse = toStudentResponseDto(existing, slide);
    }

    return {
      ...base,
      currentSlide: toStudentSlideDto(slide),
      currentIndex: index >= 0 ? index : 0,
      myResponse,
    };
  }

  /**
   * Submit one final answer.
   *
   * Every condition is checked here, in this order, because the order is what
   * makes the refusals meaningful: who you are, whether this session is running,
   * whether this is the Slide on the wall, whether it is still open, and only
   * then what you actually said.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {sessionId: {required: true, type: String}, slideId: {required: true, type: String}},
    },
    swagger: {
      summary: 'Submit my answer',
      description:
        'One answer, once, to the Question currently being presented. Cannot ' +
        'be changed or withdrawn afterwards.',
      tags: ['Live Slides'],
      responses: {
        '200': {description: 'The stored answer, read-only'},
        '400': {description: 'Closed, mismatched, or already submitted'},
      },
    },
  })
  async submitLiveResponse(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'submitLiveResponse');
    rejectPrivilegedParams(req, 'submitLiveResponse');

    const params = (req.params ?? {}) as Record<string, unknown>;

    // A request naming a Student or a profile is refused outright rather than
    // ignored: it means something upstream believes it can choose who answered.
    const privileged = findPrivilegedLiveFields(params);
    if (privileged.length > 0) {
      throw liveSlidesError(
        LiveSlidesError.LIVE_SESSION_VALIDATION_FAILED,
        Object.fromEntries(privileged.map(field => [field, 'NOT_ALLOWED']))
      );
    }

    const session = await findSessionById(params['sessionId']);
    if (!session) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    const batch = batchOf(session);
    if (!batch) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    // Enrollment, live from the database on every submission.
    const enrollment = await findEnrollment(batch.id as string, student);
    if (!enrollment) {
      liveLog.warn('Response refused for a non-member', {
        op: 'submitLiveResponse',
        stage: 'authorize',
        ok: false,
        userId: student.id,
        sessionId: session.id,
        code: LiveSlidesError.NOT_ENROLLED,
      });
      throw liveSlidesError(LiveSlidesError.NOT_ENROLLED);
    }

    if (session.get('status') !== SESSION_STATUS.LIVE) {
      throw liveSlidesError(
        session.get('status') === SESSION_STATUS.COMPLETED
          ? LiveSlidesError.LIVE_SESSION_COMPLETED
          : LiveSlidesError.LIVE_SESSION_NOT_ACTIVE
      );
    }

    // The profile must exist and be complete. A Live answer becomes part of a
    // profile's history, and a history needs somebody to belong to.
    const profile = await findProfileForStudent(student);
    if (!profile || profile.get('isComplete') !== true) {
      throw liveSlidesError(LiveSlidesError.PROFILE_INCOMPLETE);
    }

    const slides = await findSlidesForSession(session.id);
    const slideId = typeof params['slideId'] === 'string' ? params['slideId'].trim() : '';
    const slide = slides.find(item => item.id === slideId);
    if (!slide) throw liveSlidesError(LiveSlidesError.LIVE_SLIDE_NOT_FOUND);

    if (slide.get('type') !== SLIDE_TYPE.QUESTION) {
      // An Information slide takes no answer. Saying "closed" would suggest it
      // once did.
      throw liveSlidesError(LiveSlidesError.ANSWER_TYPE_MISMATCH);
    }

    // The Slide on the wall, and only that one. A previous Slide is locked; a
    // future one has not been asked yet, and both answer the same way.
    const currentId = (session.get('currentSlide') as Parse.Object | undefined)?.id;
    if (currentId !== slide.id) throw liveSlidesError(LiveSlidesError.QUESTION_CLOSED);

    // Re-read the lock immediately before writing. This is the race with the
    // Admin's navigation: whichever reaches the database first decides, and
    // both outcomes leave the same final state.
    if (slide.get('lockedAt')) throw liveSlidesError(LiveSlidesError.QUESTION_CLOSED);

    const check = validateAnswer(slide, params);
    if (!check.ok) {
      liveLog.warn('Response refused', {
        op: 'submitLiveResponse',
        stage: 'validate',
        ok: false,
        userId: student.id,
        sessionId: session.id,
        slideId: slide.id,
        answerType: String(slide.get('answerType') ?? ''),
        code: check.code,
      });
      throw liveSlidesError(LiveSlidesError[check.code], check.fields);
    }

    const result = await createResponse({
      sessionId: session.id,
      slideId: slide.id,
      batchId: batch.id as string,
      student,
      studentProfileId: profile.id,
      // From the Slide, never from the request.
      answerType: String(slide.get('answerType')),
      ...check.values,
    });

    if (!result.created) {
      // The unique index refused it: this Student already answered. Their first
      // answer stands, and they are shown it rather than an error about it.
      const existing = await findResponse(session.id, slide.id, student);
      liveLog.info('Response already submitted', {
        op: 'submitLiveResponse',
        stage: 'submit',
        ok: true,
        userId: student.id,
        sessionId: session.id,
        slideId: slide.id,
        code: LiveSlidesError.ALREADY_SUBMITTED,
      });
      return {
        alreadySubmitted: true,
        myResponse: existing ? toStudentResponseDto(existing, slide) : undefined,
      };
    }

    liveLog.info('Response submitted', {
      op: 'submitLiveResponse',
      stage: 'submit',
      ok: true,
      userId: student.id,
      sessionId: session.id,
      slideId: slide.id,
      responseId: result.response.id,
      answerType: String(slide.get('answerType') ?? ''),
    });

    return {
      alreadySubmitted: false,
      myResponse: toStudentResponseDto(result.response, slide),
    };
  }

  /**
   * This Student's own answers for one completed session.
   *
   * Read-only, and only ever their own: the query is filtered by the Student
   * resolved from the session token, so there is no id to get wrong.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {sessionId: {required: true, type: String}}},
    swagger: {
      summary: 'List my own answers',
      description: 'This Student’s submitted answers for one session. Read-only.',
      tags: ['Live Slides'],
      responses: {'200': {description: 'This Student’s own answers'}},
    },
  })
  async listMyLiveResponses(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudent(req, 'listMyLiveResponses');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const session = await findSessionById(params['sessionId']);
    if (!session) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    const batch = batchOf(session);
    if (!batch) throw liveSlidesError(LiveSlidesError.LIVE_SESSION_NOT_FOUND);

    const viewer = await describeViewer(student);
    await requireEnrolled(viewer, batch.id as string, 'listMyLiveResponses');

    const slides = await findSlidesForSession(session.id);
    const byId = new Map(slides.map(slide => [slide.id, slide]));
    const mine = await findResponsesForStudentInSession(session.id, student);

    liveLog.info('Own responses listed', {
      op: 'listMyLiveResponses',
      stage: 'load',
      ok: true,
      userId: student.id,
      sessionId: session.id,
      count: mine.length,
    });

    return {
      questions: slides
        .filter(slide => slide.get('type') === SLIDE_TYPE.QUESTION)
        .map(slide => toStudentSlideDto(slide)),
      myResponses: mine.map(response =>
        toStudentResponseDto(
          response,
          byId.get((response.get('slide') as Parse.Object | undefined)?.id ?? '')
        )
      ),
    };
  }
}

export {StudentLiveFunctions};
