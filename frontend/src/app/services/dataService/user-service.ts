import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize, Observable } from 'rxjs';
import { CurrentUser, LoginResponse } from '../../models/User';
import { SharedVarsService } from '../shared-vars';
import { SessionService } from '../session.service';

/**
 * Authentication service — deliberately minimal.
 *
 * Checkpoint 1 retired the template's user-management calls (`listUsers`,
 * `getUser`, `createUser`, `updateUser`, `deleteUser`, `searchEmployees`) along
 * with their backend cloud functions. Code Your Future has no manual user
 * administration requirement: Admins are provisioned server-side and Students
 * arrive through Google OAuth in Checkpoint 3.
 *
 * There is deliberately no Student login, signup, password-reset, or
 * password-change method here.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private httpClient = inject(HttpClient);
  private sharedVarService = inject(SharedVarsService);
  private sessionService = inject(SessionService);
  private baseURL = this.sharedVarService.baseURL;

  /** Admin password login. The only response that carries a session token. */
  login(data: { username: string; password: string }): Observable<LoginResponse> {
    return this.httpClient.post<LoginResponse>(`${this.baseURL}/users/loginUser`, data);
  }

  /** Restore the session. Returns the safe DTO — no session token. */
  getCurrentUser(): Observable<CurrentUser> {
    return this.httpClient.get<CurrentUser>(`${this.baseURL}/users/getCurrentUser`);
  }

  /**
   * Invalidate the server session, then clear local state regardless of the
   * server outcome so a failed call cannot leave a half-signed-in client.
   */
  logout(): Observable<{ success: boolean }> {
    return this.httpClient
      .post<{ success: boolean }>(`${this.baseURL}/users/logout`, {})
      .pipe(finalize(() => this.sessionService.clearSession()));
  }
}
