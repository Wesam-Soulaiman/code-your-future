import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { httpInterceptor } from './http.interceptor';
import { ToastService } from './toast.service';

/**
 * When a failed request means "you are signed out" — and when it does not.
 *
 * This distinction had a real cost. Parse code 142 is `VALIDATION_ERROR`, and
 * this application uses it both for the kit's "please log in" and for every
 * product-rule refusal. Matching on the code alone signed people out for being
 * told no: an Admin pressing Publish on a Batch that was not active was
 * redirected to the login page, and the next request went out with no session.
 * It was found in a real backend log, not by a test.
 */
describe('httpInterceptor ⟨session handling⟩', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;


  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        // The interceptor injects the toast service. Without it every request
        // throws before it is even forwarded — which looks exactly like the
        // session being preserved, so the assertions would pass while testing
        // nothing at all.
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
      ],
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    navigate = vi.fn().mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(
      navigate as unknown as Router['navigate'],
    );

    localStorage.setItem('sessionToken', 'r:a-real-session');
    localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', roles: ['Admin'] }));
  });

  afterEach(() => {
    controller.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Fail one request with a Parse-shaped error body. */
  function failWith(body: Record<string, unknown>, status = 400): Promise<void> {
    return new Promise((resolve) => {
      http.get('/api/functions/anything').subscribe({
        next: () => resolve(),
        error: () => resolve(),
      });
      controller.expectOne('/api/functions/anything').flush(body, {
        status,
        statusText: 'Bad Request',
      });
    });
  }

  function stillSignedIn(): boolean {
    return (
      localStorage.getItem('sessionToken') !== null &&
      localStorage.getItem('currentUser') !== null
    );
  }

  // ── A product refusal is not a sign-out ────────────────────────────────────

  it('keeps the session when a product rule refuses the request', async () => {
    // The exact failure from the log that started this.
    await failWith({ code: 142, error: 'BATCH_NOT_ACTIVE' });

    expect(stillSignedIn()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the session for every stable Task refusal', async () => {
    const refusals = [
      'TASK_DEADLINE_PASSED',
      'TASK_NOT_OPEN',
      'TASK_NOT_EDITABLE',
      'FINAL_TASK_ALREADY_EXISTS',
      'SUBMISSION_FIELD_NOT_USED',
      'SUBMISSION_DELETE_FORBIDDEN',
      'TALENT_REEL_NOT_ELIGIBLE',
      'BATCH_READ_ONLY',
      'RESOURCE_TOO_LARGE',
      'PROFILE_INCOMPLETE',
    ];

    for (const code of refusals) {
      await failWith({ code: 142, error: code });
      expect(stillSignedIn(), `${code} signed the user out`).toBe(true);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the session when a refusal carries a field map', async () => {
    // Validation failures append `:{"field":"REASON"}` to the stable code.
    await failWith({
      code: 142,
      error: 'TASK_VALIDATION_FAILED:{"title":"TOO_LONG"}',
    });

    expect(stillSignedIn()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  // ── A genuine session failure still signs out ─────────────────────────────

  it('clears the session when the server says the token is invalid', async () => {
    // 209 is `INVALID_SESSION_TOKEN` and needs no interpretation.
    await failWith({ code: 209, error: 'Invalid session token' });

    expect(stillSignedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/auth/admin']);
  });

  it('clears the session when the kit says nobody is logged in', async () => {
    // The kit answers 142 with prose, not a stable code, when no session was
    // sent. That one really does mean "sign in again".
    await failWith({ code: 142, error: 'Validation failed. Please login to continue.' });

    expect(stillSignedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/auth/admin']);
  });

  it('sends a signed-out Student to the Student sign-in page', async () => {
    localStorage.setItem('currentUser', JSON.stringify({ id: 'u2', roles: ['Student'] }));
    await failWith({ code: 209, error: 'Invalid session token' });

    expect(navigate).toHaveBeenCalledWith(['/auth/student']);
  });

  // ── The token itself ──────────────────────────────────────────────────────

  it('attaches the session token to an ordinary request', async () => {
    http.get('/api/functions/listBatches').subscribe({ next: () => {}, error: () => {} });
    const request = controller.expectOne('/api/functions/listBatches');

    expect(request.request.headers.get('X-Parse-Session-Token')).toBe('r:a-real-session');
    request.flush({});
  });

  it('never attaches it to the calls that establish a session', async () => {
    for (const route of ['/api/student-auth/loginUser', '/api/student-auth/loginWithGoogle']) {
      http.post(route, {}).subscribe({ next: () => {}, error: () => {} });
      const request = controller.expectOne(route);
      expect(request.request.headers.get('X-Parse-Session-Token')).toBeNull();
      request.flush({});
    }
  });
});
