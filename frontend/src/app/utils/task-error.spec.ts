import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { mapTaskError } from './task-error';

/**
 * Turning a Task failure into copy somebody can read ⟨CP7⟩.
 *
 * The load-bearing assertions are the ones about what never comes out. A
 * rejected submission is a link to somebody's work and a note about how it
 * went; an error message that echoed either back would render one straight onto
 * the page and put it in front of whoever is watching the screen.
 */

/** A cloud-function failure: `{error: 'CODE'}` or `{error: 'CODE:{fields}'}`. */
function parseFailure(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: '/parse/batch-tasks/createBatchTask' });
}

describe('mapTaskError ⟨CP7⟩', () => {
  it('maps every stable Task code to its own message', () => {
    const cases: Record<string, string> = {
      TASK_NOT_FOUND: 'tasks.errors.notFound',
      TASK_NOT_PUBLISHED: 'tasks.errors.notPublished',
      TASK_NOT_OPEN: 'tasks.errors.notOpen',
      TASK_DEADLINE_PASSED: 'tasks.errors.deadlinePassed',
      TASK_ARCHIVED: 'tasks.errors.archived',
      TASK_INVALID_STATUS: 'tasks.errors.invalidStatus',
      TASK_NOT_EDITABLE: 'tasks.errors.notEditable',
      FINAL_TASK_ALREADY_EXISTS: 'tasks.errors.finalExists',
      TASK_DELETE_FORBIDDEN: 'tasks.errors.deleteForbidden',
      BATCH_NOT_ACTIVE: 'tasks.errors.batchNotActive',
      NOT_ENROLLED: 'tasks.errors.notEnrolled',
      PROFILE_INCOMPLETE: 'tasks.errors.profileIncomplete',
      TASK_ATTACHMENT_INVALID: 'tasks.errors.attachmentInvalid',
      TASK_ATTACHMENT_TOO_LARGE: 'tasks.errors.attachmentTooLarge',
      SUBMISSION_FIELD_NOT_USED: 'tasks.errors.fieldNotUsed',
      SUBMISSION_REQUIRED_FIELD_MISSING: 'tasks.errors.requiredFieldMissing',
      SUBMISSION_DELETE_FORBIDDEN: 'tasks.errors.submissionDeleteForbidden',
      TALENT_REEL_NOT_ELIGIBLE: 'tasks.errors.reelNotEligible',
      TALENT_REEL_NOT_FOUND: 'tasks.errors.reelNotFound',
    };

    for (const [code, key] of Object.entries(cases)) {
      expect(mapTaskError(parseFailure(400, { error: code })).key, code).toBe(key);
    }
  });

  it('carries the raw code through for callers that branch on it', () => {
    const failure = mapTaskError(parseFailure(409, { error: 'FINAL_TASK_ALREADY_EXISTS' }));
    expect(failure.code).toBe('FINAL_TASK_ALREADY_EXISTS');
  });

  it('translates a field map into translation keys', () => {
    const failure = mapTaskError(
      parseFailure(
        400,
        { error: 'TASK_VALIDATION_FAILED:{"title":"TOO_LONG","deadline":"INVALID"}' },
      ),
    );
    expect(failure.key).toBe('tasks.errors.validation');
    expect(failure.fields).toEqual({
      title: 'student.profile.fieldErrors.tooLong',
      deadline: 'student.profile.fieldErrors.invalid',
    });
  });

  it('drops a reason it does not recognise rather than rendering it raw', () => {
    const failure = mapTaskError(
      parseFailure(400, { error: 'TASK_VALIDATION_FAILED:{"title":"SOMETHING_NEW"}' }),
    );
    expect(failure.fields).toEqual({});
    // The page-level message still shows, so the form is not silently fine.
    expect(failure.key).toBe('tasks.errors.validation');
  });

  it('survives a malformed field map', () => {
    const failure = mapTaskError(parseFailure(400, { error: 'TASK_VALIDATION_FAILED:{not json' }));
    expect(failure.key).toBe('tasks.errors.validation');
    expect(failure.fields).toEqual({});
  });

  it('never returns anything but a known translation key', () => {
    // A driver quoting a Student's URL back is the exact failure this prevents.
    const hostile = [
      'E11000 duplicate key { githubUrl: "https://github.com/lina/secret" }',
      'Cannot read property of undefined at /srv/app/build/src/cloudCode/x.js:42',
      '<script>alert(1)</script>',
      'Invalid liveDemoUrl: https://lina.example/private-demo',
    ];

    for (const message of hostile) {
      const failure = mapTaskError(parseFailure(400, { error: message }));
      expect(failure.key).toBe('tasks.errors.unexpected');
      expect(failure.code).toBeUndefined();
      expect(JSON.stringify(failure)).not.toContain('github.com/lina');
      expect(JSON.stringify(failure)).not.toContain('lina.example');
      expect(JSON.stringify(failure)).not.toContain('<script>');
      expect(JSON.stringify(failure)).not.toContain('/srv/app');
    }
  });

  it('decides transport conditions before the body', () => {
    // A 500 may carry no usable body at all, and a 0 carries none by definition.
    expect(mapTaskError(parseFailure(0, null)).key).toBe('tasks.errors.unavailable');
    expect(mapTaskError(parseFailure(503, null)).key).toBe('tasks.errors.unavailable');
  });

  it('says "storage failed" rather than "check your connection" for a failed upload', () => {
    // "Try again" is the right advice here and "check your connection" is not.
    const failure = mapTaskError(parseFailure(500, { error: 'TASK_ATTACHMENT_FAILED' }));
    expect(failure.key).toBe('tasks.errors.attachmentFailed');
  });

  it('reads a bodyless 413 as the size limit', () => {
    // The multipart guard answers before anything is parsed.
    expect(mapTaskError(parseFailure(413, null)).key).toBe('tasks.errors.attachmentTooLarge');
  });

  it('reads a bodyless 403 as the authorisation gate', () => {
    expect(mapTaskError(parseFailure(403, null)).key).toBe('tasks.errors.accessDenied');
  });

  it('reads a bodyless 404 as not found', () => {
    expect(mapTaskError(parseFailure(404, null)).key).toBe('tasks.errors.notFound');
  });

  it('gives a missing Task and a forbidden one the same words', () => {
    // Wording them differently would confirm that the Task exists, which is
    // exactly what the server refuses to say.
    const missing = mapTaskError(parseFailure(404, { error: 'TASK_NOT_FOUND' }));
    const notEnrolled = mapTaskError(parseFailure(404, { error: 'TASK_NOT_FOUND' }));
    expect(missing.key).toBe(notEnrolled.key);
  });

  it('handles something that is not an HTTP failure at all', () => {
    expect(mapTaskError(new Error('boom')).key).toBe('tasks.errors.unexpected');
    expect(mapTaskError(undefined).key).toBe('tasks.errors.unexpected');
  });
});
