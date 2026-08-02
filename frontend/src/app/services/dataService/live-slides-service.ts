import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AnswerHistoryPage,
  LiveSession,
  PresenterState,
  ResultsByQuestion,
  ResultsByStudent,
  SessionInput,
  SessionList,
  SlideInput,
  StudentLiveState,
  SubmitResult,
} from '../../models/LiveSlides';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';

/**
 * Live Slides ⟨CP6⟩.
 *
 * ── The audiences are separate endpoints, deliberately ──────────────────────
 * `live-sessions`, `live-slides`, `live-presenter`, `live-results`, and
 * `live-history` are the Admin surfaces; `student-live` is the Student one.
 * They could have shared routes with a role branch inside; they do not, because
 * a shared entry point is where an authorisation branch eventually gets the
 * wrong default — and here the wrong default shows one Student another
 * Student's answer.
 *
 * ── No method here can name a Student ───────────────────────────────────────
 * The Student calls take a Batch or a session and nothing else. Who is
 * answering is resolved from the session token on the server, so there is no
 * parameter to get wrong and no id to tamper with.
 *
 * All calls opt out of the interceptor's global toast: these pages render their
 * own translated messages, so a raw server string is never shown and a failure
 * is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class LiveSlidesApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  private get<T>(route: string, params: Record<string, string> = {}): Observable<T> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) httpParams = httpParams.set(key, value);
    return this.httpClient.get<T>(`${this.baseURL}/${route}`, {
      context: this.context,
      params: httpParams,
    });
  }

  private post<T>(route: string, body: Record<string, unknown>): Observable<T> {
    return this.httpClient.post<T>(`${this.baseURL}/${route}`, body, { context: this.context });
  }

  // ══ Admin — sessions ══════════════════════════════════════════════════════

  listSessions(batchId: string): Observable<SessionList> {
    return this.get<SessionList>('live-sessions/listLiveSessions', { batchId });
  }

  getSession(sessionId: string): Observable<LiveSession> {
    return this.get<LiveSession>('live-sessions/getLiveSession', { sessionId });
  }

  createSession(batchId: string, input: SessionInput): Observable<LiveSession> {
    return this.post<LiveSession>('live-sessions/createLiveSession', { batchId, ...input });
  }

  updateSession(sessionId: string, input: SessionInput): Observable<LiveSession> {
    return this.post<LiveSession>('live-sessions/updateLiveSession', { sessionId, ...input });
  }

  markReady(sessionId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-sessions/markLiveSessionReady', { sessionId });
  }

  returnToDraft(sessionId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-sessions/returnLiveSessionToDraft', { sessionId });
  }

  duplicateSession(sessionId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-sessions/duplicateLiveSession', { sessionId });
  }

  // ══ Admin — slides ════════════════════════════════════════════════════════

  addSlide(sessionId: string, slide: SlideInput): Observable<LiveSession> {
    return this.post<LiveSession>('live-slides/addLiveSlide', { sessionId, ...slide });
  }

  updateSlide(sessionId: string, slideId: string, slide: SlideInput): Observable<LiveSession> {
    return this.post<LiveSession>('live-slides/updateLiveSlide', {
      sessionId,
      slideId,
      ...slide,
    });
  }

  duplicateSlide(sessionId: string, slideId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-slides/duplicateLiveSlide', { sessionId, slideId });
  }

  deleteSlide(sessionId: string, slideId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-slides/deleteLiveSlide', { sessionId, slideId });
  }

  /**
   * Send the **whole** order, not a move.
   *
   * Two Admins reordering at the same time therefore cannot interleave into a
   * sequence neither of them chose: one wins completely and the other sees the
   * result.
   */
  reorderSlides(sessionId: string, orderedIds: string[]): Observable<LiveSession> {
    return this.post<LiveSession>('live-slides/reorderLiveSlides', { sessionId, orderedIds });
  }

  // ══ Admin — presenting ════════════════════════════════════════════════════

  startSession(sessionId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-presenter/startLiveSession', { sessionId });
  }

  /** The authoritative presenter state. Polled while the session is live. */
  getPresenterState(sessionId: string): Observable<PresenterState> {
    return this.get<PresenterState>('live-presenter/getPresenterState', { sessionId });
  }

  /**
   * Move back, closing the current Question on the way out.
   *
   * Locking and moving are one server operation. A browser that could do the
   * first and not the second would leave a Question off screen and still
   * accepting answers.
   */
  previousSlide(sessionId: string): Observable<PresenterState> {
    return this.post<PresenterState>('live-presenter/previousLiveSlide', { sessionId });
  }

  /** Move forward, closing the current Question on the way out. */
  nextSlide(sessionId: string): Observable<PresenterState> {
    return this.post<PresenterState>('live-presenter/nextLiveSlide', { sessionId });
  }

  endSession(sessionId: string): Observable<LiveSession> {
    return this.post<LiveSession>('live-presenter/endLiveSession', { sessionId });
  }

  // ══ Admin — results ═══════════════════════════════════════════════════════

  resultsByStudent(sessionId: string): Observable<ResultsByStudent> {
    return this.get<ResultsByStudent>('live-results/getResultsByStudent', { sessionId });
  }

  resultsByQuestion(sessionId: string): Observable<ResultsByQuestion> {
    return this.get<ResultsByQuestion>('live-results/getResultsByQuestion', { sessionId });
  }

  /** One Student's permanent answer history, for Admin Student Detail. */
  studentAnswerHistory(
    studentId: string,
    page: { skip: number; limit: number },
  ): Observable<AnswerHistoryPage> {
    return this.get<AnswerHistoryPage>('live-history/listStudentLiveAnswers', {
      studentId,
      skip: String(page.skip),
      limit: String(page.limit),
    });
  }

  // ══ Student ═══════════════════════════════════════════════════════════════

  /**
   * Everything this Student's live page needs, in one answer.
   *
   * Polled while a session is live. The response is authoritative, so a
   * reconnecting Student needs no other call and no page refresh — the next
   * tick simply tells them the truth, including whether they already answered.
   */
  getMyLiveState(batchId: string): Observable<StudentLiveState> {
    return this.get<StudentLiveState>('student-live/getMyLiveState', { batchId });
  }

  /**
   * Submit one final answer.
   *
   * There is no update and no delete anywhere in this service, because there is
   * no such operation on the server. A submitted answer is permanent.
   */
  submitResponse(
    sessionId: string,
    slideId: string,
    answer: { textAnswer?: string; selectedOptionId?: string; selectedOptionIds?: string[] },
  ): Observable<SubmitResult> {
    return this.post<SubmitResult>('student-live/submitLiveResponse', {
      sessionId,
      slideId,
      ...answer,
    });
  }

  /** This Student's own answers for one completed session. Read-only. */
  listMyResponses(sessionId: string): Observable<StudentLiveState> {
    return this.get<StudentLiveState>('student-live/listMyLiveResponses', { sessionId });
  }
}
