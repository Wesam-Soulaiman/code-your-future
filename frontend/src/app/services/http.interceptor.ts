import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
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

  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken && !req.url.includes('/functions/login')) {
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
      const message = error.error?.error || error.statusText || 'An unexpected error occurred';
      toastService.error(message);

      // Handle session expired
      if ([142, 209].includes(error.error?.code)) {
        localStorage.removeItem('sessionToken');
        router.navigate(['/auth']);
      }

      return throwError(() => error);
    })
  );
};
