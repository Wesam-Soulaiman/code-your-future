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
  // Binary responses are not JSON and have no enumerable keys: walking one
  // would return an empty object and silently discard the payload. The profile
  // photo arrives as a Blob, so this guard is load-bearing ⟨CP3A catalog⟩.
  if (obj instanceof Blob || obj instanceof ArrayBuffer) return obj;
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

/**
 * Which sign-in page an expired session should return to.
 *
 * Read straight from storage rather than from `SessionService`, because an
 * interceptor must not inject a service that may itself be mid-teardown. The
 * cached role is only used to choose a *page*; it grants nothing.
 */
function isCachedStudent(): boolean {
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return false;
    const roles = (JSON.parse(raw) as { roles?: unknown }).roles;
    return Array.isArray(roles) && roles.includes('Student') && !roles.includes('Admin');
  } catch {
    return false;
  }
}

export const httpInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);
  const router = inject(Router);

  const headers: Record<string, string> = {
    'X-Parse-REST-API-Key': environment.parseApiKey,
    'X-Parse-Application-Id': environment.parseAppId,
  };

  // Attach the session token to every request except the two calls that
  // *establish* a session. The template checked for '/functions/login', which
  // never matched the real 'loginUser' route.
  const sessionToken = localStorage.getItem('sessionToken');
  const isSignIn = req.url.includes('loginUser') || req.url.includes('loginWithGoogle');
  if (sessionToken && !isSignIn) {
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

      // Session expired or revoked. Clear both stored values — leaving the
      // cached user behind would keep stale roles visible to the guards — and
      // send the visitor to the sign-in page that matches the session they had.
      if ([142, 209].includes(error.error?.code)) {
        const wasStudent = isCachedStudent();
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('currentUser');
        router.navigate([wasStudent ? '/auth/student' : '/auth/admin']);
      }

      return throwError(() => error);
    })
  );
};
