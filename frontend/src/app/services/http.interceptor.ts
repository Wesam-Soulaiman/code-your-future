import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { HANDLES_OWN_ERRORS } from '../utils/auth-error';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, throwError } from 'rxjs';
import { ToastService } from './toast.service';
import { environment } from '../../environments/environment';

function convertParseDates(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertParseDates);
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    if (record['__type'] === 'Date' && typeof record['iso'] === 'string') {
      return (record['iso'] as string).split('T')[0];
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      result[key] = convertParseDates(record[key]);
    }
    return result;
  }
  return obj;
}

export const httpInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);
  const router = inject(Router);

  const headers: Record<string, string> = {
    'X-Parse-REST-API-Key': environment.parseApiKey,
    'X-Parse-Application-Id': environment.parseAppId,
  };

  // Attach the session token to every request except login, which is the call
  // that establishes the session. The template checked for '/functions/login',
  // which never matched the real 'loginUser' route.
  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken && !req.url.includes('loginUser')) {
    headers['X-Parse-Session-Token'] = sessionToken;
  }

  const clonedRequest = req.clone({ setHeaders: headers });

  return next(clonedRequest).pipe(
    map((event) => {
      if (event instanceof HttpResponse) {
        return event.clone({ body: convertParseDates(event.body) });
      }
      return event;
    }),
    catchError((error: HttpErrorResponse) => {
      // Callers that render their own translated message (the auth pages) opt
      // out of the global toast, so a raw server string is never surfaced and
      // the same failure is not reported twice.
      if (!req.context.get(HANDLES_OWN_ERRORS)) {
        const message = error.error?.error || error.statusText || 'An unexpected error occurred';
        toastService.error(message);
      }

      // Handle session expired
      if ([142, 209].includes(error.error?.code)) {
        localStorage.removeItem('sessionToken');
        router.navigate(['/auth/admin']);
      }

      return throwError(() => error);
    })
  );
};
