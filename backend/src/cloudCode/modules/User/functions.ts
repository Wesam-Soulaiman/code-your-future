/**
 * Authentication surface — deliberately minimal.
 *
 * Checkpoint 1 retired the template's generic user administration. What remains
 * is the smallest set the product actually needs today:
 *
 *   - `loginUser`      Admin password login
 *   - `getCurrentUser` session restoration
 *   - `logout`         session invalidation
 *
 * Removed, and why:
 *   - `signupUser`      open unauthenticated self-signup granting a role —
 *                       Code Your Future has no public email/password signup.
 *   - `createUser`      manual user creation with a client-chosen role — manual
 *                       Student creation and manual role assignment are both
 *                       forbidden.
 *   - `updateUser`      arbitrary field and role reassignment (privilege
 *                       escalation surface).
 *   - `deleteUser`      account deletion with no product requirement.
 *   - `listUsers`       user enumeration with no product requirement.
 *   - `getUser`         arbitrary user read by id.
 *   - `searchEmployees` built on the retired `Employee` role.
 *
 * Student authentication is NOT implemented here. There is deliberately no
 * Student password login, signup, reset, or change path — Students authenticate
 * with Google OAuth in Checkpoint 3, provisioned server-side.
 */

import {CloudFunction, Route, catchError, generateRandomString} from '@90soft/parse-server-kit';
import User from '../../models/User';
import {AppRole} from '../../utils/constants/roles';
import {getAppRoles, rejectPrivilegedParams, requireUser} from '../../utils/auth/authorize';
import {toCurrentUserDto, toLoginDto} from '../../utils/dto/userDto';
import {safeLog} from '../../utils/logging/safeLogger';

@Route(User)
class UserFunctions {
  /**
   * Password login. Admin accounts only.
   *
   * A Student account has no password and must never obtain a session this way,
   * so the role is checked *after* authentication and the session is destroyed
   * again if the account is not an Admin. Failure is always reported as the same
   * opaque message so the endpoint cannot be used to enumerate usernames or
   * discover which accounts are Students.
   */
  @CloudFunction({
    methods: ['POST'],
    rateLimit: {windowMs: 60_000, max: 10},
    validation: {
      requireUser: false,
      fields: {
        username: {required: true, type: String},
        password: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Admin login',
      description:
        'Authenticate an Admin with username and password. Returns a safe user DTO ' +
        'plus the session token. Student accounts cannot authenticate here.',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Login successful'},
        '401': {description: 'Invalid credentials'},
        '403': {description: 'Account is not permitted to use password login'},
      },
    },
  })
  async loginUser(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'loginUser');

    const {username, password} = req.params as {username: string; password: string};

    const [error, user] = await catchError<User>(
      User.logIn(username, password, {
        installationId: generateRandomString(10),
      })
    );

    if (error || !user) {
      // Same response for unknown user and wrong password.
      safeLog.warn('Login failed', {op: 'loginUser', ok: false, code: 'INVALID_CREDENTIALS'});
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        'Invalid credentials'
      );
    }

    const roles = await getAppRoles(user);

    if (!roles.includes(AppRole.ADMIN)) {
      // Not an Admin: revoke the session that logIn just created, then refuse.
      const sessionToken = user.getSessionToken();
      if (sessionToken) {
        const sessionQuery = new Parse.Query('_Session');
        sessionQuery.equalTo('sessionToken', sessionToken);
        const [, session] = await catchError(sessionQuery.first({useMasterKey: true}));
        if (session) await catchError(session.destroy({useMasterKey: true}));
      }

      safeLog.warn('Password login refused for a non-Admin account', {
        op: 'loginUser',
        ok: false,
        userId: user.id,
        code: 'PASSWORD_LOGIN_NOT_PERMITTED',
      });

      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'This account cannot sign in with a password'
      );
    }

    safeLog.info('Admin login succeeded', {op: 'loginUser', ok: true, userId: user.id});

    return toLoginDto(user, roles, user.getSessionToken());
  }

  /**
   * Current authenticated user, for session restoration.
   *
   * Returns the routine DTO, which deliberately carries **no session token** —
   * the client already holds it.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {
      requireUser: true,
    },
    swagger: {
      summary: 'Get current user',
      description:
        'Return the authenticated user as a safe DTO with their application roles. ' +
        'No session token, email, or phone number is included.',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Safe current-user DTO'},
        '401': {description: 'Not authenticated'},
      },
    },
  })
  async getCurrentUser(req: Parse.Cloud.FunctionRequest) {
    const user = requireUser(req);
    const roles = await getAppRoles(user);
    return toCurrentUserDto(user, roles);
  }

  /**
   * Invalidate the caller's own session. A client cannot pass a session token to
   * destroy — only the one it is authenticated with.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
    },
    swagger: {
      summary: 'Logout',
      description: "Invalidate the caller's current session.",
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Logout successful'},
        '401': {description: 'Not authenticated'},
      },
    },
  })
  async logout(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'logout');

    const user = requireUser(req);
    const sessionToken = user.getSessionToken();

    if (!sessionToken) {
      return {success: true};
    }

    const sessionQuery = new Parse.Query('_Session');
    sessionQuery.equalTo('sessionToken', sessionToken);

    const [error, session] = await catchError(
      sessionQuery.first({useMasterKey: true})
    );

    if (error) {
      safeLog.error('Session lookup failed during logout', {
        op: 'logout',
        ok: false,
        userId: user.id,
      });
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Logout failed');
    }

    if (session) {
      await session.destroy({useMasterKey: true});
    }

    safeLog.info('Logout succeeded', {op: 'logout', ok: true, userId: user.id});

    // Idempotent: an already-expired session is still a successful logout.
    return {success: true};
  }
}

export default UserFunctions;
