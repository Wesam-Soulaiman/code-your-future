import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  BatchResource,
  BatchResourceList,
  ResourceMetadataInput,
  StudentResourceList,
} from '../../models/BatchResource';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { RESOURCE_FILE_FIELD } from '../../utils/resource-constants';
import { SharedVarsService } from '../shared-vars';

/**
 * Private Batch Resources ⟨CP5⟩.
 *
 * ── Two kinds of call, and they are not the same shape ──────────────────────
 * Metadata — listing, editing, reordering, deleting — goes through cloud
 * functions. The **bytes** do not: uploading and downloading use a dedicated
 * authenticated route, because Parse logs every cloud-function call with its
 * serialised input and result, and a base64 document in a parameter is a
 * document in the log.
 *
 * ── There is no URL for a Resource, and this service cannot make one ────────
 * No method returns a link, a storage key, or a path. A download is an
 * authenticated request that resolves to a `Blob`, which the caller hands to
 * the browser's save flow. Nothing here can be pasted into an address bar, and
 * nothing here can be shared with somebody who is not in the Batch.
 *
 * ── The audiences are separate endpoints, deliberately ──────────────────────
 * `admin*` calls the Admin surface and `listMyBatchResources` calls the Student
 * one. They could have shared a route with a role branch inside; they do not,
 * because a shared entry point is where an authorisation branch eventually gets
 * the wrong default.
 *
 * All calls opt out of the interceptor's global toast: these pages render their
 * own translated messages, so a raw server string is never shown and a failure
 * is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class BatchResourceApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  /**
   * The binary route sits beside the cloud-function routes rather than under
   * them, because it is not a cloud function. See
   * `modules/BatchResource/resourceRoute.ts`.
   */
  private get binaryURL(): string {
    return `${this.baseURL}/batch-resource`;
  }

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * Every Resource of one Batch, in display order, with the upload rules.
   *
   * Works on an archived Batch: archived is read-only, not invisible, and the
   * response says which through `readOnly`.
   */
  adminListResources(batchId: string): Observable<BatchResourceList> {
    return this.httpClient.get<BatchResourceList>(
      `${this.baseURL}/batch-resources/listBatchResources`,
      { context: this.context, params: new HttpParams().set('batchId', batchId) },
    );
  }

  /**
   * Upload a file.
   *
   * Multipart, so the 20 MiB limit can be applied at the socket and an
   * oversized file is refused mid-stream rather than buffered whole and then
   * rejected. The Batch travels in the body beside the file; the uploader is
   * resolved from the session, so there is no user id to pass.
   */
  adminUploadResource(
    batchId: string,
    metadata: ResourceMetadataInput,
    file: File,
  ): Observable<BatchResource> {
    const body = new FormData();
    body.append('batchId', batchId);
    body.append('title', metadata.title);
    if (metadata.description) body.append('description', metadata.description);
    body.append(RESOURCE_FILE_FIELD, file, file.name);

    return this.httpClient.post<BatchResource>(this.binaryURL, body, {
      context: this.context,
    });
  }

  /**
   * Change a Resource's title and description.
   *
   * The file is not touched and cannot be: there is no replacement operation,
   * and the stored bytes are immutable from the moment they land.
   */
  adminUpdateResource(
    resourceId: string,
    metadata: ResourceMetadataInput,
  ): Observable<BatchResource> {
    return this.httpClient.post<BatchResource>(
      `${this.baseURL}/batch-resources/updateBatchResource`,
      { resourceId, title: metadata.title, description: metadata.description ?? '' },
      { context: this.context },
    );
  }

  /**
   * Put a Batch's Resources in a new order.
   *
   * The whole sequence is sent, not a single move, so two people reordering at
   * once cannot interleave into an order neither of them chose.
   */
  adminReorderResources(
    batchId: string,
    orderedIds: string[],
  ): Observable<{ items: BatchResource[] }> {
    return this.httpClient.post<{ items: BatchResource[] }>(
      `${this.baseURL}/batch-resources/reorderBatchResources`,
      { batchId, orderedIds },
      { context: this.context },
    );
  }

  /** Delete a Resource and the bytes behind it. */
  adminDeleteResource(resourceId: string): Observable<{ id: string; deleted: boolean }> {
    return this.httpClient.post<{ id: string; deleted: boolean }>(
      `${this.baseURL}/batch-resources/deleteBatchResource`,
      { resourceId },
      { context: this.context },
    );
  }

  // ── Student ───────────────────────────────────────────────────────────────

  /** The Resources of a Batch this Student has joined. */
  listMyBatchResources(batchId: string): Observable<StudentResourceList> {
    return this.httpClient.get<StudentResourceList>(
      `${this.baseURL}/student-resources/listMyBatchResources`,
      { context: this.context, params: new HttpParams().set('batchId', batchId) },
    );
  }

  // ── Both ──────────────────────────────────────────────────────────────────

  /**
   * The bytes of one Resource.
   *
   * A `Blob`, so the file never becomes a string in this application and never
   * gets an address anybody could share. The same route serves an Admin and an
   * enrolled Student; the server decides which, from the session, on every
   * request.
   */
  downloadResource(resourceId: string): Observable<Blob> {
    return this.httpClient.get(`${this.binaryURL}/${encodeURIComponent(resourceId)}`, {
      context: this.context,
      responseType: 'blob',
    });
  }
}
