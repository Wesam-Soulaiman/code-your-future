import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs/internal/Observable';
import { SharedVarsService } from './shared-vars';
import { inject } from '@angular/core';

export class ApiService<T> {
  baseURL = inject(SharedVarsService).baseURL;

  constructor(private httpClient: HttpClient) {}

  getList(
    endpoint: string,
    params?: Record<string, unknown>,
  ): Observable<T[] | { results: T[]; count: number }> {
    return this.httpClient.get<T[] | { results: T[]; count: number }>(
      `${this.baseURL}/${endpoint}`,
      { params: params as Record<string, string> },
    );
  }

  getSingle(endpoint: string, id: string): Observable<T> {
    return this.httpClient.get<T>(`${this.baseURL}/${endpoint}`, {
      params: { id },
    });
  }

  add(endpoint: string, body: Partial<T>): Observable<T> {
    return this.httpClient.post<T>(`${this.baseURL}/${endpoint}`, body);
  }

  update(endpoint: string, id: string, body: Partial<T>): Observable<T> {
    return this.httpClient.patch<T>(`${this.baseURL}/${endpoint}/${id}`, body);
  }

  edit(endpoint: string, body: Partial<T>): Observable<T> {
    return this.httpClient.patch<T>(`${this.baseURL}/${endpoint}`, body);
  }

  delete(endpoint: string, body: Partial<T>): Observable<T> {
    return this.httpClient.delete<T>(`${this.baseURL}/${endpoint}`, {
      body,
    });
  }
}
