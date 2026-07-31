import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import enTranslations from '../../../public/i18n/en.json';
import arTranslations from '../../../public/i18n/ar.json';
import { GoogleAuthErrorKey, mapGoogleAuthError } from './google-auth-error';

/**
 * Mapping from the backend's stable codes to translated message keys.
 *
 * The point of the mapping is that no server or provider sentence is ever
 * rendered, so these tests check both halves: the right key is chosen, and every
 * key actually resolves to real copy in both languages.
 */
function parseError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: 'Error',
    error: { code: 101, error: code },
  });
}

function lookup(source: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    source,
  );
}

describe('mapGoogleAuthError', () => {
  it('maps an unverifiable credential', () => {
    expect(mapGoogleAuthError(parseError(404, 'INVALID_CREDENTIAL'))).toBe(
      'auth.student.errors.invalidCredential',
    );
  });

  it('maps an unverified Google email', () => {
    expect(mapGoogleAuthError(parseError(404, 'EMAIL_NOT_VERIFIED'))).toBe(
      'auth.student.errors.emailNotVerified',
    );
  });

  it('maps a blocked account', () => {
    expect(mapGoogleAuthError(parseError(403, 'ACCOUNT_NOT_ELIGIBLE'))).toBe(
      'auth.student.errors.notEligible',
    );
  });

  it('maps a missing server configuration', () => {
    expect(mapGoogleAuthError(parseError(400, 'GOOGLE_NOT_CONFIGURED'))).toBe(
      'auth.student.errors.notConfigured',
    );
  });

  it('maps an internal failure to a neutral message', () => {
    expect(mapGoogleAuthError(parseError(400, 'SIGN_IN_FAILED'))).toBe(
      'auth.student.errors.unexpected',
    );
  });

  it('maps a rate limit', () => {
    const error = new HttpErrorResponse({ status: 429, error: { error: 'Too many requests' } });
    expect(mapGoogleAuthError(error)).toBe('auth.student.errors.rateLimited');
  });

  it('maps an unreachable backend', () => {
    expect(mapGoogleAuthError(new HttpErrorResponse({ status: 0 }))).toBe(
      'auth.student.errors.unavailable',
    );
  });

  it('maps a server error', () => {
    expect(mapGoogleAuthError(new HttpErrorResponse({ status: 503 }))).toBe(
      'auth.student.errors.unavailable',
    );
  });

  it('prefers a transport failure over whatever the body claims', () => {
    // status 0 means the response body cannot be trusted to exist at all.
    const error = new HttpErrorResponse({
      status: 0,
      error: { error: 'ACCOUNT_NOT_ELIGIBLE' },
    });
    expect(mapGoogleAuthError(error)).toBe('auth.student.errors.unavailable');
  });

  it('falls back to a neutral message for an unrecognised code', () => {
    expect(mapGoogleAuthError(parseError(400, 'SOMETHING_NEW'))).toBe(
      'auth.student.errors.unexpected',
    );
  });

  it('falls back to a neutral message for a non-HTTP failure', () => {
    expect(mapGoogleAuthError(new Error('boom'))).toBe('auth.student.errors.unexpected');
  });

  it('never returns a server-supplied string', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { code: 1, error: 'stack trace at /srv/app/google.js:88' },
    });
    const key = mapGoogleAuthError(error);
    expect(key.startsWith('auth.student.errors.')).toBe(true);
    expect(key).not.toContain('/srv');
  });
});

describe('every mapped key has real copy in both languages', () => {
  const keys: GoogleAuthErrorKey[] = [
    'auth.student.errors.notConfigured',
    'auth.student.errors.invalidCredential',
    'auth.student.errors.emailNotVerified',
    'auth.student.errors.notEligible',
    'auth.student.errors.rateLimited',
    'auth.student.errors.unavailable',
    'auth.student.errors.cancelled',
    'auth.student.errors.unexpected',
  ];

  for (const key of keys) {
    it(`${key} is translated in English and Arabic`, () => {
      const en = lookup(enTranslations as Record<string, unknown>, key);
      const ar = lookup(arTranslations as Record<string, unknown>, key);
      expect(typeof en).toBe('string');
      expect(typeof ar).toBe('string');
      expect(String(en).trim().length).toBeGreaterThan(0);
      expect(String(ar).trim().length).toBeGreaterThan(0);
      // The Arabic copy must actually be Arabic, not an English fallback.
      expect(String(ar)).not.toBe(String(en));
    });
  }

  it('no message leaks a backend code to the reader', () => {
    for (const key of keys) {
      const en = String(lookup(enTranslations as Record<string, unknown>, key));
      const ar = String(lookup(arTranslations as Record<string, unknown>, key));
      for (const code of [
        'INVALID_CREDENTIAL',
        'ACCOUNT_NOT_ELIGIBLE',
        'GOOGLE_NOT_CONFIGURED',
        'EMAIL_NOT_VERIFIED',
        'SIGN_IN_FAILED',
      ]) {
        expect(en).not.toContain(code);
        expect(ar).not.toContain(code);
      }
    }
  });
});
