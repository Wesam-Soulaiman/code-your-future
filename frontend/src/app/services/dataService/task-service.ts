import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AdminTaskSubmission,
  BatchTask,
  StudentTaskDetail,
  StudentTaskList,
  SubmissionInput,
  TalentReelPublication,
  TaskCopyResult,
  TaskDeleteResult,
  TaskHistoryPage,
  TaskInput,
  TaskList,
  TaskStudentList,
  TaskSubmission,
} from '../../models/BatchTask';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';

/** The multipart field the attachment route reads. Mirrors the server. */
const ATTACHMENT_FILE_FIELD = 'file';

/**
 * Batch Tasks, Submissions, and Talent Reels ⟨CP7⟩.
 *
 * ── The audiences are separate endpoints, deliberately ──────────────────────
 * `batch-tasks` is the Admin surface, `student-tasks` is the Student one, and
 * `talent-reels` and `task-history` are Admin-only. They could have shared
 * routes with a role branch inside; they do not, because a shared entry point
 * is where an authorisation branch eventually gets the wrong default — and here
 * the wrong default shows one Student another Student's work.
 *
 * ── No Student method can name a Student ────────────────────────────────────
 * The Student calls take a Batch or a Task and nothing else. Whose submission
 * it is gets resolved from the session token on the server, so there is no
 * parameter to get wrong and no id to tamper with.
 *
 * ── Bytes do not travel through a cloud function ────────────────────────────
 * The attachment uses a dedicated authenticated route, because Parse logs every
 * cloud-function call with its serialised input and result, and a base64
 * document in a parameter is a document in the log. Nothing here returns a
 * link, a storage key, or a path: a download is an authenticated request that
 * resolves to a `Blob`, which the caller hands to the browser's save flow.
 * Nothing here can be pasted into an address bar.
 *
 * All calls opt out of the interceptor's global toast: these pages render their
 * own translated messages, so a raw server string is never shown and a failure
 * is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class TaskApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  /**
   * The binary route sits beside the cloud-function routes rather than under
   * them, because it is not a cloud function. See
   * `modules/BatchTask/attachmentRoute.ts`.
   */
  private get attachmentURL(): string {
    return `${this.baseURL}/task-attachment`;
  }

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

  // ══ Admin — Tasks ═════════════════════════════════════════════════════════

  /**
   * Every Task of one Batch, in creation order, with what the Admin may do.
   *
   * Works on a completed or archived Batch: read-only is not invisible, and the
   * response says which through `canCreate` and `canPublish`.
   */
  listTasks(batchId: string): Observable<TaskList> {
    return this.get<TaskList>('batch-tasks/listBatchTasks', { batchId });
  }

  /** One Task, with the counts the detail page shows. */
  getTask(taskId: string): Observable<BatchTask> {
    return this.get<BatchTask>('batch-tasks/getBatchTask', { taskId });
  }

  /**
   * Create a Task.
   *
   * A Batch holds at most one Final Task, and that is guaranteed by a unique
   * index rather than by a check here — two Admins creating one at the same
   * moment end with exactly one Task and one clear refusal.
   */
  createTask(batchId: string, input: TaskInput): Observable<BatchTask> {
    return this.post<BatchTask>('batch-tasks/createBatchTask', { batchId, ...input });
  }

  /**
   * Change a Task's own fields.
   *
   * `type` is never sent: a Task does not change type, and the server keeps the
   * existing one whatever a request claims. Requirements are frozen once any
   * Submission exists — the response's `requirementsFrozen` says so, and the
   * server refuses regardless.
   */
  updateTask(taskId: string, input: TaskInput): Observable<BatchTask> {
    const { type: _ignored, ...fields } = input;
    return this.post<BatchTask>('batch-tasks/updateBatchTask', { taskId, ...fields });
  }

  /**
   * Move a Task through its lifecycle.
   *
   * The legal steps are in `task-constants`, but two of them carry conditions
   * this app cannot see — returning to Draft needs no Submission to exist, and
   * reopening needs an active Batch and an unexpired deadline. The server
   * decides both.
   */
  setTaskStatus(taskId: string, status: string): Observable<BatchTask> {
    return this.post<BatchTask>('batch-tasks/setBatchTaskStatus', { taskId, status });
  }

  /** Delete a Draft Task that nobody has submitted to. */
  deleteTask(taskId: string): Observable<TaskDeleteResult> {
    return this.post<TaskDeleteResult>('batch-tasks/deleteBatchTask', { taskId });
  }

  /**
   * Copy a Task into another Batch as a Draft.
   *
   * The attachment does not travel. The response says so explicitly through
   * `attachmentCopied`, so the Admin can be told rather than left to notice the
   * missing brief later.
   */
  copyTask(taskId: string, targetBatchId: string): Observable<TaskCopyResult> {
    return this.post<TaskCopyResult>('batch-tasks/copyBatchTask', { taskId, targetBatchId });
  }

  // ══ Admin — the attachment ════════════════════════════════════════════════

  /**
   * Attach or replace a Task's brief.
   *
   * Multipart, so the 20 MiB limit is applied at the socket and an oversized
   * file is refused mid-stream rather than buffered whole and then rejected.
   *
   * Replacing is safe in the order that matters: the new bytes are stored, the
   * metadata is swapped, and only then are the old bytes removed. A failure
   * before the swap leaves the existing brief exactly as it was.
   */
  uploadTaskAttachment(taskId: string, file: File): Observable<BatchTask> {
    const body = new FormData();
    body.append('taskId', taskId);
    body.append(ATTACHMENT_FILE_FIELD, file, file.name);

    return this.httpClient.post<BatchTask>(this.attachmentURL, body, { context: this.context });
  }

  /** Remove a Task's brief and the bytes behind it. */
  removeTaskAttachment(taskId: string): Observable<BatchTask> {
    return this.post<BatchTask>('batch-tasks/removeBatchTaskAttachment', { taskId });
  }

  /**
   * The bytes of a Task's brief.
   *
   * A `Blob`, so the file never becomes a string in this application and never
   * gets an address anybody could share. It always arrives as a download — an
   * `.html` brief rendered inline would run its own script in this origin, with
   * the reader's session attached.
   *
   * The same route serves an Admin and an enrolled Student; the server decides
   * which, from the session, on every request.
   */
  downloadTaskAttachment(taskId: string): Observable<Blob> {
    return this.httpClient.get(`${this.attachmentURL}/${encodeURIComponent(taskId)}`, {
      context: this.context,
      responseType: 'blob',
    });
  }

  // ══ Admin — Submissions ═══════════════════════════════════════════════════

  /**
   * Who has submitted what, for one Task.
   *
   * Every enrolled Student appears, including those who have not started — a
   * missing row is the answer to "who has not submitted", and deriving it from
   * absence is how somebody gets missed.
   */
  listTaskSubmissions(taskId: string): Observable<TaskStudentList> {
    return this.get<TaskStudentList>('batch-tasks/listTaskSubmissions', { taskId });
  }

  /**
   * One Student's Submission, read-only.
   *
   * There is no Admin edit and no Admin delete anywhere in this service,
   * because there is no such operation on the server. A Student's work is
   * theirs.
   */
  getTaskSubmission(submissionId: string): Observable<AdminTaskSubmission> {
    return this.get<AdminTaskSubmission>('batch-tasks/getTaskSubmission', { submissionId });
  }

  // ══ Admin — Talent Reels ══════════════════════════════════════════════════

  /**
   * Hide a published Reel.
   *
   * The suppression is sticky: it survives the Student resubmitting, and only
   * an explicit Publish Again clears it. Otherwise an Admin's decision would be
   * undone by the next save, silently.
   */
  unpublishTalentReel(submissionId: string): Observable<TalentReelPublication> {
    return this.post<TalentReelPublication>('talent-reels/unpublishTalentReel', { submissionId });
  }

  /**
   * Clear an Admin's own suppression and republish, if the work still qualifies.
   *
   * "Still qualifies" is the server's decision and is re-checked here rather
   * than assumed — a Student may have withdrawn consent in the meantime, and
   * republishing over that would publish something nobody agreed to.
   */
  republishTalentReel(submissionId: string): Observable<TalentReelPublication> {
    return this.post<TalentReelPublication>('talent-reels/republishTalentReel', { submissionId });
  }

  /** One Student's Task history across every Batch, for Admin Student Detail. */
  studentTaskHistory(
    studentId: string,
    page: { skip: number; limit: number },
  ): Observable<TaskHistoryPage> {
    return this.get<TaskHistoryPage>('task-history/listStudentTaskHistory', {
      studentId,
      skip: String(page.skip),
      limit: String(page.limit),
    });
  }

  // ══ Student ═══════════════════════════════════════════════════════════════

  /** The Tasks of a Batch this Student has joined. Drafts are not among them. */
  listMyTasks(batchId: string): Observable<StudentTaskList> {
    return this.get<StudentTaskList>('student-tasks/listMyBatchTasks', { batchId });
  }

  /** One Task, with this Student's own Submission if they have one. */
  getMyTask(taskId: string): Observable<StudentTaskDetail> {
    return this.get<StudentTaskDetail>('student-tasks/getMyBatchTask', { taskId });
  }

  /**
   * Save work in progress.
   *
   * A Draft may be incomplete — a draft that refused to save until it was
   * finished would not be a draft — but everything present must still be valid.
   * Storing a malformed URL now and discovering it at the deadline helps nobody.
   */
  saveMyTaskDraft(taskId: string, input: SubmissionInput): Observable<TaskSubmission> {
    return this.post<TaskSubmission>('student-tasks/saveMyTaskDraft', { taskId, ...input });
  }

  /**
   * Hand the work in.
   *
   * Every required field must be present. There is no separate resubmit
   * operation: submitting again updates the one record, because the product has
   * one current submission per Task rather than a version history.
   */
  submitMyTask(taskId: string, input: SubmissionInput): Observable<TaskSubmission> {
    return this.post<TaskSubmission>('student-tasks/submitMyTask', { taskId, ...input });
  }

  /**
   * Discard a Draft that was never submitted.
   *
   * Identified by the **Task**, not by the Submission. The server resolves which
   * row that is from the Task and the session, so there is no submission id for
   * a caller to substitute — naming somebody else's row is not a request this
   * operation can express.
   *
   * A Submission that has ever been submitted cannot be deleted — by anybody,
   * through any route. Handing work in is a fact about what happened, and
   * saving back to Draft must not become a way to erase it.
   */
  deleteMyTaskDraft(taskId: string): Observable<TaskDeleteResult> {
    return this.post<TaskDeleteResult>('student-tasks/deleteMyTaskDraft', { taskId });
  }
}
