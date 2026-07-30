import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize, Observable } from 'rxjs';
import { User } from '../../models/User';
import { ApiService } from '../api';
import { SharedVarsService } from '../shared-vars';
import { SessionService } from '../session.service';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private httpClient = inject(HttpClient);
  private sharedVarService = inject(SharedVarsService);
  private sessionService = inject(SessionService);
  private baseURL = this.sharedVarService.baseURL;
  private api: ApiService<User>;

  constructor() {
    this.api = new ApiService<User>(this.httpClient);
  }

  login(data: { username: string; password: string }): Observable<User> {
    return this.httpClient.post<User>(`${this.baseURL}/functions/loginUser`, data);
  }

  getCurrentUser(): Observable<User> {
    return this.httpClient.get<User>(`${this.baseURL}/functions/getCurrentUser`);
  }

  logout(): Observable<{ message: string }> {
    return this.httpClient
      .post<{ message: string }>(`${this.baseURL}/functions/logout`, {})
      .pipe(finalize(() => this.sessionService.clearSession()));
  }

  listUsers(params?: Record<string, unknown>) {
    return this.api.getList('functions/listUsers', params);
  }

  getUser(id: string): Observable<User> {
    return this.httpClient.post<User>(`${this.baseURL}/functions/getUser`, { id });
  }

  createUser(user: Partial<User>): Observable<User> {
    return this.httpClient.post<User>(`${this.baseURL}/functions/createUser`, user);
  }

  updateUser(user: Partial<User>): Observable<User> {
    return this.httpClient.post<User>(`${this.baseURL}/functions/updateUser`, user);
  }

  deleteUser(id: string): Observable<{ success: boolean; id: string }> {
    return this.httpClient.post<{ success: boolean; id: string }>(`${this.baseURL}/functions/deleteUser`, { id });
  }

  searchEmployees(searchString: string): Observable<User[]> {
    return this.httpClient.get<User[]>(`${this.baseURL}/functions/searchEmployees`, { params: { searchString } });
  }
}
