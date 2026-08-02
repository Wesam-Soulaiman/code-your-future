import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AdminStudentSummary,
  Batch,
  BatchInput,
  InvitationPreview,
  InvitationStatus,
  IssuedInvitation,
  JoinResult,
  Page,
  StudentBatch,
} from '../../models/Batch';
import { BatchStatus } from '../../utils/batch-constants';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';

/** The filters the Student directory accepts. All optional. */
export interface StudentDirectoryFilters {
  search?: string;
  skip?: number;
  limit?: number;
  batchId?: string;
  cityId?: string;
  institutionId?: string;
  majorId?: string;
  targetRoleId?: string;
  profileComplete?: boolean;
}

/**
 * Batches, invitations, enrollment, and the Student directory.
 *
 * Three audiences share one service because they share one domain, but the
 * endpoints do not overlap: `admin*` requires a live Admin, `my*` and `join*`
 * resolve the Student from their session, and `previewInvitation` is the only
 * public call in the file.
 *
 * ── The token is never stored here ──────────────────────────────────────────
 * `issueInvitation` returns the one copy of a raw token. This service hands it
 * straight to the caller and keeps nothing: no field, no cache, no replay. A
 * component holds it for as long as its page is open and then it is gone —
 * which is exactly what the backend promises, so the UI must not quietly make
 * it untrue.
 *
 * All calls opt out of the interceptor's global toast: these pages render their
 * own translated messages, so a raw server string is never shown and a failure
 * is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class BatchApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  // ── Admin: Batches ────────────────────────────────────────────────────────

  adminListBatches(options: {
    search?: string;
    status?: BatchStatus | '';
    skip?: number;
    limit?: number;
  }): Observable<Page<Batch>> {
    let params = new HttpParams()
      .set('skip', String(options.skip ?? 0))
      .set('limit', String(options.limit ?? 10));
    if (options.search?.trim()) params = params.set('search', options.search.trim());
    if (options.status) params = params.set('status', options.status);

    return this.httpClient.get<Page<Batch>>(`${this.baseURL}/batches/listBatches`, {
      context: this.context,
      params,
    });
  }

  adminGetBatch(batchId: string): Observable<{ batch: Batch; invitation: InvitationStatus }> {
    return this.httpClient.get<{ batch: Batch; invitation: InvitationStatus }>(
      `${this.baseURL}/batches/getBatch`,
      { context: this.context, params: new HttpParams().set('batchId', batchId) },
    );
  }

  adminCreateBatch(input: BatchInput): Observable<Batch> {
    return this.httpClient.post<Batch>(`${this.baseURL}/batches/createBatch`, input, {
      context: this.context,
    });
  }

  adminUpdateBatch(batchId: string, input: BatchInput): Observable<Batch> {
    return this.httpClient.post<Batch>(
      `${this.baseURL}/batches/updateBatch`,
      { ...input, batchId },
      { context: this.context },
    );
  }

  adminChangeStatus(batchId: string, status: BatchStatus): Observable<Batch> {
    return this.httpClient.post<Batch>(
      `${this.baseURL}/batches/changeBatchStatus`,
      { batchId, status },
      { context: this.context },
    );
  }

  /** Terminal and irreversible. The Batch becomes read-only. */
  adminArchiveBatch(batchId: string): Observable<Batch> {
    return this.httpClient.post<Batch>(
      `${this.baseURL}/batches/archiveBatch`,
      { batchId },
      { context: this.context },
    );
  }

  adminListBatchStudents(
    batchId: string,
    options: { search?: string; skip?: number; limit?: number },
  ): Observable<Page<AdminStudentSummary>> {
    let params = new HttpParams()
      .set('batchId', batchId)
      .set('skip', String(options.skip ?? 0))
      .set('limit', String(options.limit ?? 10));
    if (options.search?.trim()) params = params.set('search', options.search.trim());

    return this.httpClient.get<Page<AdminStudentSummary>>(
      `${this.baseURL}/batches/listBatchStudents`,
      { context: this.context, params },
    );
  }

  // ── Admin: invitations ────────────────────────────────────────────────────

  /**
   * Generate or rotate the join link.
   *
   * The response carries the **only** copy of the raw token. Rotating
   * invalidates the previous one before this one exists.
   */
  adminIssueInvitation(batchId: string, expiresAt?: string): Observable<IssuedInvitation> {
    const body: Record<string, unknown> = { batchId };
    if (expiresAt) body['expiresAt'] = expiresAt;

    return this.httpClient.post<IssuedInvitation>(
      `${this.baseURL}/batches/issueBatchInvitation`,
      body,
      { context: this.context },
    );
  }

  adminGetInvitation(batchId: string): Observable<InvitationStatus> {
    return this.httpClient.get<InvitationStatus>(
      `${this.baseURL}/batches/getBatchInvitation`,
      { context: this.context, params: new HttpParams().set('batchId', batchId) },
    );
  }

  adminRevokeInvitation(batchId: string): Observable<InvitationStatus> {
    return this.httpClient.post<InvitationStatus>(
      `${this.baseURL}/batches/revokeBatchInvitation`,
      { batchId },
      { context: this.context },
    );
  }

  adminExpireInvitation(batchId: string): Observable<InvitationStatus> {
    return this.httpClient.post<InvitationStatus>(
      `${this.baseURL}/batches/expireBatchInvitation`,
      { batchId },
      { context: this.context },
    );
  }

  adminSetInvitationExpiry(batchId: string, expiresAt?: string): Observable<InvitationStatus> {
    const body: Record<string, unknown> = { batchId };
    if (expiresAt) body['expiresAt'] = expiresAt;

    return this.httpClient.post<InvitationStatus>(
      `${this.baseURL}/batches/setBatchInvitationExpiry`,
      body,
      { context: this.context },
    );
  }

  // ── Admin: the Student directory ──────────────────────────────────────────

  adminListStudents(filters: StudentDirectoryFilters): Observable<Page<AdminStudentSummary>> {
    let params = new HttpParams()
      .set('skip', String(filters.skip ?? 0))
      .set('limit', String(filters.limit ?? 10));

    for (const key of [
      'search',
      'batchId',
      'cityId',
      'institutionId',
      'majorId',
      'targetRoleId',
    ] as const) {
      const value = filters[key];
      if (typeof value === 'string' && value.trim()) params = params.set(key, value.trim());
    }
    if (typeof filters.profileComplete === 'boolean') {
      params = params.set('profileComplete', String(filters.profileComplete));
    }

    return this.httpClient.get<Page<AdminStudentSummary>>(
      `${this.baseURL}/student-directory/listStudents`,
      { context: this.context, params },
    );
  }

  adminGetStudent(
    studentId: string,
  ): Observable<{ student: AdminStudentSummary; batches: StudentBatch[] }> {
    return this.httpClient.get<{ student: AdminStudentSummary; batches: StudentBatch[] }>(
      `${this.baseURL}/student-directory/getStudent`,
      { context: this.context, params: new HttpParams().set('studentId', studentId) },
    );
  }

  // ── Public ────────────────────────────────────────────────────────────────

  /**
   * Inspect a join link.
   *
   * A POST, so the token travels in the body: a GET would put it in the URL,
   * and URLs end up in access logs, proxy logs, and browser history.
   */
  previewInvitation(token: string): Observable<InvitationPreview> {
    return this.httpClient.post<InvitationPreview>(
      `${this.baseURL}/join/previewInvitation`,
      { token },
      { context: this.context },
    );
  }

  // ── Student ───────────────────────────────────────────────────────────────

  /** Redeem a link. Idempotent: a repeat returns the existing membership. */
  joinBatch(token: string): Observable<JoinResult> {
    return this.httpClient.post<JoinResult>(
      `${this.baseURL}/student-batches/joinBatchWithInvitation`,
      { token },
      { context: this.context },
    );
  }

  listMyBatches(): Observable<{ items: StudentBatch[] }> {
    return this.httpClient.get<{ items: StudentBatch[] }>(
      `${this.baseURL}/student-batches/listMyBatches`,
      { context: this.context },
    );
  }

  getMyBatch(batchId: string): Observable<StudentBatch> {
    return this.httpClient.get<StudentBatch>(`${this.baseURL}/student-batches/getMyBatch`, {
      context: this.context,
      params: new HttpParams().set('batchId', batchId),
    });
  }
}
