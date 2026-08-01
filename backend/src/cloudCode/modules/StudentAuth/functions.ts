/**
 * Student authentication surface.
 *
 * Two functions, both mounted under `/api/student-auth`:
 *
 *   - `loginWithGoogle`  verify a Google credential, provision or reuse the
 *                        Student, and return the one response that carries a
 *                        session token;
 *   - `getSession`       role-agnostic session restoration, carrying no token
 *                        and no internal username.
 *
 * `getSession` is the frontend's restoration call for **every** role. The
 * existing `/api/users/getCurrentUser` is untouched, still registered, and still
 * tested; it is simply no longer what the browser calls, because its DTO
 * includes `username` — see `dto.ts` for the full reasoning.
 *
 * There is deliberately no function here that reads, lists, or returns a
 * `StudentAuthIdentity`, and none that accepts a provider subject, an email, or
 * a role from a client.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {getAppRoles, rejectPrivilegedParams, requireUser} from '../../utils/auth/authorize';
import {StudentAuthError, isStudentAuthErrorCode, studentAuthError} from './errors';
import {GOOGLE_PROVIDER, isGoogleAuthConfigured} from './googleConfig';
import {verifyGoogleCredential} from './googleVerifier';
import {issueStudentSession, provisionStudentFromGoogle} from './provisioning';
import {toSessionDto, toSessionWithTokenDto} from './dto';
import {authLog} from './logging';
import {isProfileComplete} from '../StudentProfile/completion';

/**
 * Re-throw a stable code, or collapse anything unexpected into
 * `SIGN_IN_FAILED`.
 *
 * This is the last gate before a message reaches the client. An internal error —
 * a database failure, a verifier stack trace, a Google response body — is never
 * allowed through; only one of the five stable tokens is.
 */
function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (isStudentAuthErrorCode(message)) {
    return studentAuthError(message);
  }
  return studentAuthError(StudentAuthError.SIGN_IN_FAILED);
}

@Route('student-auth')
class StudentAuthFunctions {
  /**
   * Sign in a Student with a Google credential.
   *
   * The request carries exactly one meaningful field: `credential`, the ID token
   * Google issued to the browser. Identity comes from that token and nowhere
   * else — an `email`, `name`, `sub`, or `profileStatus` sent alongside it is
   * simply never read, so it cannot influence which account is created or
   * matched. `role`, `roles`, `userId`, `sessionToken`, and `authData` are
   * refused outright by the shared privileged-parameter gate.
   *
   * Rate limited at the same 10/minute as Admin login: an unauthenticated
   * endpoint that creates accounts must not be cheap to hammer.
   */
  @CloudFunction({
    methods: ['POST'],
    rateLimit: {windowMs: 60_000, max: 10},
    validation: {
      requireUser: false,
      fields: {
        credential: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Student sign-in with Google',
      description:
        'Verify a Google ID token, provision or reuse the Student account, and ' +
        'return a safe session DTO plus the session token. The credential is ' +
        'never stored, logged, or returned.',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Sign-in successful'},
        '403': {description: 'Account is not eligible to sign in as a Student'},
        '404': {description: 'The credential could not be verified'},
      },
    },
  })
  async loginWithGoogle(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'loginWithGoogle');

    if (!isGoogleAuthConfigured()) {
      // Fail safe and loudly, without naming the variable's value. Admin login
      // is unaffected — only this endpoint refuses.
      authLog.warn('Google sign-in is not configured', {
        op: 'loginWithGoogle',
        provider: GOOGLE_PROVIDER,
        stage: 'config',
        ok: false,
        code: StudentAuthError.GOOGLE_NOT_CONFIGURED,
      });
      throw studentAuthError(StudentAuthError.GOOGLE_NOT_CONFIGURED);
    }

    // Only this parameter is ever read.
    const {credential} = req.params as {credential: string};

    const [verifyError, claims] = await catchError(verifyGoogleCredential(credential));
    if (verifyError || !claims) {
      authLog.warn('Google credential verification failed', {
        op: 'loginWithGoogle',
        provider: GOOGLE_PROVIDER,
        stage: 'verify',
        ok: false,
        code: (verifyError as {message?: string} | null)?.message,
      });
      throw toClientError(verifyError);
    }

    const [provisionError, provisioned] = await catchError(
      provisionStudentFromGoogle(claims)
    );
    if (provisionError || !provisioned) {
      throw toClientError(provisionError);
    }

    const [sessionError, sessionToken] = await catchError(
      issueStudentSession(provisioned.user.id as string)
    );
    if (sessionError || !sessionToken) {
      authLog.error('Session issuance failed', {
        op: 'loginWithGoogle',
        provider: GOOGLE_PROVIDER,
        stage: 'session',
        ok: false,
        userId: provisioned.user.id,
        code: StudentAuthError.SIGN_IN_FAILED,
      });
      throw toClientError(sessionError);
    }

    const roles = await getAppRoles(provisioned.user);
    const profileComplete = await isProfileComplete(provisioned.user, roles);

    authLog.info('Student signed in with Google', {
      op: 'loginWithGoogle',
      provider: GOOGLE_PROVIDER,
      stage: 'complete',
      ok: true,
      userId: provisioned.user.id,
      created: provisioned.userCreated,
    });

    return toSessionWithTokenDto(provisioned.user, roles, sessionToken, profileComplete);
  }

  /**
   * Restore the caller's session.
   *
   * Works for any authenticated user and returns the same safe shape for both
   * roles: id, live role names, and a display name. **No session token** — the
   * client already holds it — and no username, so a Student's internal login
   * identifier never reaches the browser.
   *
   * Roles are read live from `_Role` on every call, so withdrawing the Student
   * role takes effect on the next restoration as well as on every request.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {
      requireUser: true,
    },
    swagger: {
      summary: 'Get the current session',
      description:
        'Return the authenticated caller as a safe session DTO with live ' +
        'application roles. No session token, username, email, or phone number.',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Safe session DTO'},
        '401': {description: 'Not authenticated'},
      },
    },
  })
  async getSession(req: Parse.Cloud.FunctionRequest) {
    const user = requireUser(req);
    const roles = await getAppRoles(user);

    // One boolean, read live. The profile itself never travels on this call.
    const profileComplete = await isProfileComplete(user, roles);

    authLog.info('Session restored', {
      op: 'getSession',
      stage: 'restore',
      ok: true,
      userId: user.id,
    });

    return toSessionDto(user, roles, profileComplete);
  }
}

export default StudentAuthFunctions;
