/**
 * Authorization boundary.
 *
 * Every check here resolves the caller from the authenticated Parse session on
 * the request and then reads *live* `_Role` membership from the database. A role
 * name supplied by a client — in a body field, a header, or a cached DTO — is
 * never consulted. Legacy `SuperAdmin` / `Employee` names authorise nothing:
 * membership is matched against `AppRole` only.
 */

import {catchError} from '@90soft/parse-server-kit';
import {AppRole, APP_ROLES, toAppRole} from '../constants/roles';
import {safeLog} from '../logging/safeLogger';

/**
 * Live application-role names for a user, read with the master key because
 * `_Role` is not client-readable. Only recognised application roles are
 * returned; anything else (including legacy names) is discarded.
 */
export async function getAppRoles(user: Parse.User): Promise<AppRole[]> {
  const query = new Parse.Query('_Role');
  query.equalTo('users', user);
  query.select('name');
  query.limit(APP_ROLES.length + 8);

  const [error, roles] = await catchError(query.find({useMasterKey: true}));
  if (error) {
    safeLog.error('Role lookup failed', {
      op: 'getAppRoles',
      ok: false,
      userId: user.id,
    });
    throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Authorization check failed');
  }

  const resolved: AppRole[] = [];
  for (const role of roles) {
    const appRole = toAppRole(role.get('name'));
    if (appRole && !resolved.includes(appRole)) resolved.push(appRole);
  }
  return resolved;
}

/** True when the user currently holds the given application role. */
export async function hasAppRole(user: Parse.User, role: AppRole): Promise<boolean> {
  return (await getAppRoles(user)).includes(role);
}

/**
 * Require an authenticated session. Throws `INVALID_SESSION_TOKEN` for a
 * Visitor so the client can distinguish "not signed in" from "forbidden".
 */
export function requireUser(request: Parse.Cloud.FunctionRequest): Parse.User {
  const user = request.user;
  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }
  return user as Parse.User;
}

async function requireRole(
  request: Parse.Cloud.FunctionRequest,
  role: AppRole,
  op: string
): Promise<Parse.User> {
  const user = requireUser(request);
  const granted = await hasAppRole(user, role);

  if (!granted) {
    safeLog.warn('Authorization denied', {
      op,
      ok: false,
      userId: user.id,
      requiredRole: role,
    });
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not authorized');
  }

  return user;
}

/** Require the caller to hold the Admin role. */
export function requireAdmin(
  request: Parse.Cloud.FunctionRequest,
  op = 'requireAdmin'
): Promise<Parse.User> {
  return requireRole(request, AppRole.ADMIN, op);
}

/** Require the caller to hold the Student role. */
export function requireStudent(
  request: Parse.Cloud.FunctionRequest,
  op = 'requireStudent'
): Promise<Parse.User> {
  return requireRole(request, AppRole.STUDENT, op);
}

/**
 * Reject any client attempt to set a privileged field. Checkpoint 1 forbids a
 * client choosing its own role, ACL, session, auth payload, or owner pointer;
 * this is the shared gate every future write path calls first.
 */
const FORBIDDEN_CLIENT_PARAMS: readonly string[] = [
  'role',
  'roles',
  'ACL',
  'acl',
  'CLP',
  'clp',
  'sessionToken',
  'authData',
  'masterKey',
  '_MasterKey',
  'protectedFields',
  'owner',
  'user',
  'userId',
  'studentId',
];

export function rejectPrivilegedParams(
  request: Parse.Cloud.FunctionRequest,
  op: string
): void {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const offending = FORBIDDEN_CLIENT_PARAMS.filter(key =>
    Object.prototype.hasOwnProperty.call(params, key)
  );

  if (offending.length > 0) {
    safeLog.warn('Rejected privileged client parameters', {
      op,
      ok: false,
      rejectedKeys: offending,
    });
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      `These parameters are not accepted from clients: ${offending.join(', ')}`
    );
  }
}

export {FORBIDDEN_CLIENT_PARAMS};
