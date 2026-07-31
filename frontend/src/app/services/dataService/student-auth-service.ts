import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { CurrentUser, LoginResponse } from '../../models/User';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';
import { SessionService } from '../session.service';

/**
 * Student Google sign-in and session restoration.
 *
 * `getSession()` is the restoration call for **every** role: it returns the safe
 * role-agnostic DTO with no session token and no username. The older
 * `/users/getCurrentUser` still exists on the backend and is still tested; it is
 * simply not what the browser calls, because its DTO includes the username —
 * which for a Student is an internal, server-generated value.
 *
 * There is deliberately no Student password, signup, reset, or change method
 * here, and no method that reads or writes an identity record.
 */
@Injectable({
  providedIn: 'root',
})
export class StudentAuthApiService {
  private httpClient = inject(HttpClient);
  private sharedVarService = inject(SharedVarsService);
  private sessionService = inject(SessionService);
  private baseURL = this.sharedVarService.baseURL;

  /** In-flight restoration, shared so concurrent callers issue one request. */
  private restoreInFlight: Promise<CurrentUser | null> | null = null;

  /**
   * Exchange a Google credential for a Code Your Future session.
   *
   * The credential is sent once, in the request body, over the same channel as
   * every other call. It is never written to storage, never logged, and never
   * placed in a URL — a query parameter would land in browser history and in
   * server access logs.
   *
   * Opts out of the interceptor's global toast: the page renders its own
   * translated message, so no backend string is ever shown.
   */
  loginWithGoogle(credential: string): Observable<LoginResponse> {
    return this.httpClient.post<LoginResponse>(
      `${this.baseURL}/student-auth/loginWithGoogle`,
      { credential },
      { context: new HttpContext().set(HANDLES_OWN_ERRORS, true) },
    );
  }

  /** Restore the session. Returns the safe DTO — no token, no username. */
  getSession(): Observable<CurrentUser> {
    return this.httpClient.get<CurrentUser>(`${this.baseURL}/student-auth/getSession`, {
      context: new HttpContext().set(HANDLES_OWN_ERRORS, true),
    });
  }

  /**
   * Restore the session once, no matter how many callers ask.
   *
   * Two things can trigger restoration at almost the same moment — the app
   * initializer and a guard on the first navigation. Sharing one promise means
   * the server sees a single request and both callers see the same answer.
   * A rejected token clears local state rather than leaving a half-signed-in
   * client behind.
   */
  restoreSession(): Promise<CurrentUser | null> {
    if (this.restoreInFlight) return this.restoreInFlight;

    const token = this.sessionService.token();
    if (!token) {
      this.sessionService.clearSession();
      return Promise.resolve(null);
    }

    this.sessionService.markRestoring();

    this.restoreInFlight = firstValueFrom(
      this.getSession().pipe(
        tap((user) => this.sessionService.saveSession(user, token)),
        catchError(() => {
          this.sessionService.clearSession();
          return of(null);
        }),
      ),
    ).finally(() => {
      this.restoreInFlight = null;
    });

    return this.restoreInFlight;
  }
}
