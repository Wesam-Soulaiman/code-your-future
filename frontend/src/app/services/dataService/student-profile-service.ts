import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ProfilePhotoResult,
  StudentProfile,
  StudentProfileInput,
} from '../../models/StudentProfile';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { PROFILE_PHOTO_FIELD } from '../../utils/student-profile-constants';
import { SharedVarsService } from '../shared-vars';

/**
 * The Student's own profile.
 *
 * Every call is scoped to the authenticated caller by the backend — there is no
 * profile id in any signature, so this service cannot be pointed at somebody
 * else's data even by mistake.
 *
 * All calls opt out of the interceptor's global toast: the profile page renders
 * its own translated messages, including per-field ones, so a raw server string
 * is never shown and a failure is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class StudentProfileApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  /**
   * The photo endpoint sits beside the cloud-function routes rather than under
   * them, because it is not a cloud function: it is an authenticated binary
   * route. See `modules/StudentProfile/photoRoute.ts` for why.
   */
  private get photoURL(): string {
    return `${this.baseURL}/profile-photo`;
  }

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  /** The caller's profile, or the empty shape carrying their verified email. */
  getMyProfile(): Observable<StudentProfile> {
    return this.httpClient.get<StudentProfile>(
      `${this.baseURL}/student-profile/getMyStudentProfile`,
      { context: this.context },
    );
  }

  /** Create or update the profile. The backend re-validates everything. */
  saveMyProfile(input: StudentProfileInput): Observable<StudentProfile> {
    return this.httpClient.post<StudentProfile>(
      `${this.baseURL}/student-profile/saveMyStudentProfile`,
      input,
      { context: this.context },
    );
  }

  /**
   * Replace the photo.
   *
   * The image is posted as **multipart**, not base64 in a JSON body: it is a
   * third smaller on the wire, and — the reason this changed — it never enters
   * Parse's cloud-function pipeline, which logs every call with its serialised
   * input and result. The file itself is the only thing sent; the backend
   * resolves the profile from the session, so there is no id to pass.
   */
  uploadPhoto(file: File): Observable<ProfilePhotoResult> {
    const body = new FormData();
    body.append(PROFILE_PHOTO_FIELD, file, file.name);

    return this.httpClient.post<ProfilePhotoResult>(this.photoURL, body, {
      context: this.context,
    });
  }

  removePhoto(): Observable<StudentProfile> {
    return this.httpClient.post<StudentProfile>(
      `${this.baseURL}/student-profile/removeMyProfilePhoto`,
      {},
      { context: this.context },
    );
  }

  /**
   * The caller's own photo, as image bytes.
   *
   * A `Blob`, so the page can render it through an object URL without the image
   * ever becoming a string. There is no public URL to fetch and no storage path
   * in the response.
   */
  getMyPhoto(): Observable<Blob> {
    return this.httpClient.get(this.photoURL, {
      context: this.context,
      responseType: 'blob',
    });
  }
}
