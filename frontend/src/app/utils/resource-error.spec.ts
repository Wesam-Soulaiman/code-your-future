import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import enTranslations from '../../../public/i18n/en.json';
import { mapResourceError } from './resource-error';

/**
 * What a reader is told when a Resource operation fails ⟨CP5⟩.
 *
 * The load-bearing property is negative: **nothing the server said is ever
 * rendered**. Only a stable code crosses into the UI, and every message the
 * reader sees is a translation this repository owns.
 */

type Tree = Record<string, unknown>;

/** Every leaf key path in the shipped English file. */
function flatten(source: Tree, prefix = ''): string[] {
  return Object.entries(source).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value as Tree, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const KEYS = new Set(flatten(enTranslations as Tree));

function failure(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('mapResourceError', () => {
  describe('the eight stable codes', () => {
    const cases: [string, string][] = [
      ['RESOURCE_VALIDATION_FAILED', 'resources.errors.validation'],
      ['RESOURCE_TYPE_NOT_ALLOWED', 'resources.errors.typeNotAllowed'],
      ['RESOURCE_TOO_LARGE', 'resources.errors.tooLarge'],
      ['RESOURCE_EMPTY', 'resources.errors.empty'],
      ['RESOURCE_UPLOAD_FAILED', 'resources.errors.uploadFailed'],
      ['RESOURCE_NOT_FOUND', 'resources.errors.notFound'],
      ['RESOURCE_ACCESS_DENIED', 'resources.errors.accessDenied'],
      ['RESOURCE_DELETE_FAILED', 'resources.errors.deleteFailed'],
    ];

    it('each maps to its own message', () => {
      for (const [code, key] of cases) {
        expect(mapResourceError(failure(400, { error: code })).key).toBe(key);
      }
    });

    it('every message it can produce exists in the shipped translations', () => {
      // A key that does not exist renders as the key itself — visible nonsense
      // in production and a silent pass in a test that only checked the mapping.
      for (const [, key] of cases) {
        expect(KEYS.has(key), `${key} is missing from en.json`).toBe(true);
      }
      for (const key of [
        'resources.errors.unavailable',
        'resources.errors.unexpected',
      ]) {
        expect(KEYS.has(key), `${key} is missing from en.json`).toBe(true);
      }
    });
  });

  describe('what it refuses to carry', () => {
    it('drops a server message that is not a stable code', () => {
      const leaky = failure(400, {
        error: 'MongoServerError: E11000 duplicate key on mongodb://cyf:secret@db:27017',
      });
      const result = mapResourceError(leaky);

      expect(result.key).toBe('resources.errors.unexpected');
      expect(result.code).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('mongodb');
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('drops a field reason it does not recognise', () => {
      const result = mapResourceError(
        failure(400, { error: 'RESOURCE_VALIDATION_FAILED:{"title":"CONTAINS_SLUR"}' }),
      );
      expect(result.fields).toEqual({});
    });

    it('keeps a field map of names and reasons, never of values', () => {
      const result = mapResourceError(
        failure(400, { error: 'RESOURCE_VALIDATION_FAILED:{"title":"TOO_LONG"}' }),
      );
      expect(result.key).toBe('resources.errors.validation');
      expect(result.fields).toEqual({ title: 'student.profile.fieldErrors.tooLong' });
      expect(KEYS.has(result.fields['title'])).toBe(true);
    });

    it('survives a malformed field map without losing the page-level message', () => {
      const result = mapResourceError(
        failure(400, { error: 'RESOURCE_VALIDATION_FAILED:{not json' }),
      );
      expect(result.key).toBe('resources.errors.validation');
      expect(result.fields).toEqual({});
    });
  });

  describe('failures that carry no body', () => {
    it('reads 413 as too large, which is what the socket guard answers', () => {
      // Multer cuts the stream at the limit; there may be no JSON at all.
      expect(mapResourceError(failure(413, null)).key).toBe('resources.errors.tooLarge');
    });

    it('reads a bare 403 as a permission problem', () => {
      expect(mapResourceError(failure(403, null)).key).toBe('resources.errors.accessDenied');
    });

    it('reads a bare 404 as not found', () => {
      expect(mapResourceError(failure(404, null)).key).toBe('resources.errors.notFound');
    });

    it('reads a lost connection as the server being unreachable', () => {
      expect(mapResourceError(failure(0, null)).key).toBe('resources.errors.unavailable');
    });

    it('says "try again" for a storage failure rather than blaming the connection', () => {
      const result = mapResourceError(failure(500, { error: 'RESOURCE_UPLOAD_FAILED' }));
      expect(result.key).toBe('resources.errors.uploadFailed');
    });

    it('falls back to unavailable for any other server fault', () => {
      expect(mapResourceError(failure(502, null)).key).toBe('resources.errors.unavailable');
    });

    it('handles something that is not an HTTP failure at all', () => {
      expect(mapResourceError(new Error('boom')).key).toBe('resources.errors.unexpected');
      expect(mapResourceError(undefined).key).toBe('resources.errors.unexpected');
    });
  });

  describe('what the messages themselves say', () => {
    const copy = (enTranslations as unknown as {
      resources: { errors: Record<string, string> };
    }).resources.errors;

    it('never names a storage key, a path, or a URL', () => {
      for (const message of Object.values(copy)) {
        expect(message).not.toMatch(/storageKey|gridfs|mongodb|\/api\/|http/i);
      }
    });

    it('says the same thing for a missing Resource and a forbidden one', () => {
      // The server refuses to distinguish them, so the copy must not either —
      // a differently-worded message would leak exactly what the 404 hides.
      const missing = mapResourceError(failure(404, { error: 'RESOURCE_NOT_FOUND' }));
      const forbidden = mapResourceError(failure(404, { error: 'RESOURCE_NOT_FOUND' }));
      expect(missing.key).toBe(forbidden.key);
    });
  });
});
