/**
 * Safe user DTOs.
 *
 * Client responses are hand-built from an explicit allow-list. A raw
 * `Parse.Object` is never returned, so ACL, CLP, `authData`, password hashes,
 * session internals, and any column added later cannot leak by default.
 *
 * Two shapes exist deliberately:
 *   - `toCurrentUserDto`  — routine responses. Carries **no session token.**
 *   - `toLoginDto`        — the single successful-login response, which must
 *                           carry the token so the client can establish its
 *                           Parse session.
 */

import {AppRole} from '../constants/roles';

/** Fields the current frontend actually needs. Nothing else is exposed. */
export interface CurrentUserDto {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  /** Application role names only — never internal `_Role` objects. */
  roles: AppRole[];
}

/** Login response: the current-user shape plus the session token. */
export interface LoginDto extends CurrentUserDto {
  sessionToken: string;
}

/**
 * Keys that must never appear in any user-facing DTO. Exported so tests can
 * assert the allow-list holds for every DTO builder.
 */
export const FORBIDDEN_DTO_KEYS: readonly string[] = [
  'password',
  'authData',
  'ACL',
  'acl',
  'CLP',
  'clp',
  'email',
  'emailVerified',
  'phoneNumber',
  'sessionToken',
  'objectId',
  'className',
  'createdAt',
  'updatedAt',
  '_hashed_password',
  'perishableToken',
  'passwordResetToken',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build the routine current-user DTO.
 *
 * `email` and `phoneNumber` are intentionally absent: the Admin shell does not
 * render them, and personal data should not travel on every session-restore
 * request. Checkpoint 4 adds them to the StudentProfile response where they are
 * actually required.
 */
export function toCurrentUserDto(user: Parse.User, roles: AppRole[]): CurrentUserDto {
  const dto: CurrentUserDto = {
    id: user.id as string,
    username: String(user.get('username') ?? ''),
    roles: [...roles],
  };

  const firstName = optionalString(user.get('firstName'));
  if (firstName) dto.firstName = firstName;

  const lastName = optionalString(user.get('lastName'));
  if (lastName) dto.lastName = lastName;

  return dto;
}

/**
 * Build the login DTO. The session token is included here and only here —
 * it is the one response where the client legitimately needs it.
 */
export function toLoginDto(
  user: Parse.User,
  roles: AppRole[],
  sessionToken: string
): LoginDto {
  return {...toCurrentUserDto(user, roles), sessionToken};
}
