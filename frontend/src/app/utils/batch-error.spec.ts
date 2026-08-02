import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { mapBatchError } from './batch-error';

/**
 * Turning a failure into copy.
 *
 * Two things are being protected here. The first is ordinary: nothing
 * untranslated and nothing the server said verbatim may reach a page. The
 * second is the reason the invitation codes exist at all — "expired", "revoked",
 * and "replaced" are genuinely useful to somebody holding a link, while "this
 * token never existed" and "this token is malformed" must stay
 * indistinguishable so nobody can probe which strings were ever real.
 */

function failure(status: number, body?: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('mapBatchError', () => {
  describe('invitation codes', () => {
    it('distinguishes the three states worth distinguishing', () => {
      expect(mapBatchError(failure(400, { error: 'INVITATION_EXPIRED' })).key).toBe(
        'join.errors.expired',
      );
      expect(mapBatchError(failure(400, { error: 'INVITATION_REVOKED' })).key).toBe(
        'join.errors.revoked',
      );
      expect(mapBatchError(failure(400, { error: 'INVITATION_REPLACED' })).key).toBe(
        'join.errors.replaced',
      );
    });

    it('renders one message for every unusable-and-unexplained link', () => {
      // The server refuses to distinguish "never existed" from "malformed", so
      // there is only one code to map and only one thing this can say.
      expect(mapBatchError(failure(400, { error: 'INVITATION_INVALID' })).key).toBe(
        'join.errors.invalid',
      );
    });

    it('exposes the raw code for a page that has to branch on it', () => {
      const result = mapBatchError(failure(400, { error: 'INVITATION_EXPIRED' }));
      expect(result.code).toBe('INVITATION_EXPIRED');
    });
  });

  describe('Batch codes', () => {
    it('maps each one to its own message', () => {
      const cases: [string, string][] = [
        ['BATCH_NOT_FOUND', 'batch.errors.notFound'],
        ['BATCH_READ_ONLY', 'batch.errors.readOnly'],
        ['BATCH_INVALID_STATUS', 'batch.errors.invalidStatus'],
        ['BATCH_VALIDATION_FAILED', 'batch.errors.validation'],
      ];
      for (const [code, key] of cases) {
        expect(mapBatchError(failure(400, { error: code })).key, code).toBe(key);
      }
    });

    it('reads the field map out of a validation failure', () => {
      const result = mapBatchError(
        failure(400, { error: 'BATCH_VALIDATION_FAILED:{"name":"TOO_SHORT"}' }),
      );
      expect(result.key).toBe('batch.errors.validation');
      expect(result.fields['name']).toBe('student.profile.fieldErrors.tooShort');
    });

    it('drops a field reason it does not recognise rather than rendering it raw', () => {
      const result = mapBatchError(
        failure(400, { error: 'BATCH_VALIDATION_FAILED:{"name":"SOMETHING_NEW"}' }),
      );
      expect(result.fields['name']).toBeUndefined();
      // The page-level message still appears, so the save does not fail silently.
      expect(result.key).toBe('batch.errors.validation');
    });

    it('survives a malformed field map', () => {
      const result = mapBatchError(failure(400, { error: 'BATCH_VALIDATION_FAILED:{not json' }));
      expect(result.key).toBe('batch.errors.validation');
      expect(result.fields).toEqual({});
    });
  });

  describe('transport conditions', () => {
    it('treats an unreachable server and a 5xx as the same thing', () => {
      expect(mapBatchError(failure(0)).key).toBe('batch.errors.unavailable');
      expect(mapBatchError(failure(500)).key).toBe('batch.errors.unavailable');
      expect(mapBatchError(failure(503)).key).toBe('batch.errors.unavailable');
    });

    it('decides transport before body, because there may be no body', () => {
      // A 500 carrying an HTML error page must not be parsed for a code.
      expect(mapBatchError(failure(500, '<html>Gateway error</html>')).key).toBe(
        'batch.errors.unavailable',
      );
    });

    it('reads a bare 403 as the authorisation gate, not a product rule', () => {
      expect(mapBatchError(failure(403)).key).toBe('batch.errors.forbidden');
    });

    it('falls back to one unexpected message for anything unrecognised', () => {
      expect(mapBatchError(failure(400, { error: 'SOMETHING_ELSE' })).key).toBe(
        'batch.errors.unexpected',
      );
      expect(mapBatchError(new Error('boom')).key).toBe('batch.errors.unexpected');
      expect(mapBatchError(undefined).key).toBe('batch.errors.unexpected');
    });
  });

  describe('what never reaches the page', () => {
    it('never returns the server text itself', () => {
      const result = mapBatchError(
        failure(400, { error: 'Cannot read property token of undefined at line 42' }),
      );
      expect(result.key).toBe('batch.errors.unexpected');
      expect(JSON.stringify(result)).not.toContain('line 42');
    });

    it('never returns a value the user submitted', () => {
      // The backend sends reason codes, not values. If one ever appeared, it
      // would end up rendered on a page and possibly in a screenshot.
      const result = mapBatchError(
        failure(400, { error: 'BATCH_VALIDATION_FAILED:{"name":"TOO_LONG"}' }),
      );
      expect(JSON.stringify(result)).not.toMatch(/Spring|2026|@/);
    });

    it('every key it can produce is a translation key, never a sentence', () => {
      const codes = [
        'BATCH_NOT_FOUND',
        'INVITATION_EXPIRED',
        'PROFILE_INCOMPLETE',
        'NOT_A_STUDENT',
        'ENROLLMENT_FAILED',
        'ALREADY_ENROLLED',
        'BATCH_NOT_ACTIVE',
      ];
      for (const code of codes) {
        const { key } = mapBatchError(failure(400, { error: code }));
        expect(key, code).toMatch(/^(batch|join)\.errors\.[a-zA-Z]+$/);
      }
    });
  });
});
