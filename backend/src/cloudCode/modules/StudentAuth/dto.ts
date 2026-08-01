/**
 * Session DTOs for the authentication surface used by the browser.
 *
 * These are hand-built allow-lists, exactly like `utils/dto/userDto.ts`. They
 * exist alongside it rather than replacing it, for one specific reason:
 *
 *   `toCurrentUserDto` includes `username`. For an Admin that is their real
 *   login identifier and is fine to show. For a Student it is the **internal,
 *   server-generated** username that Parse requires, which must never be
 *   available to the frontend. `utils/` is a protected path in `CLAUDE.md`, so
 *   the existing builder is left untouched and this role-agnostic shape is added
 *   here instead. It carries a `displayName` computed server-side and no
 *   username at all.
 *
 * Never present in either shape: password, `authData`, ACL, raw Parse objects,
 * raw role objects, email, phone, the Google subject, the Google credential, any
 * provider claim, the internal username, any master key, or anything from
 * `StudentAuthIdentity`.
 */

import {AppRole} from '../../utils/constants/roles';

/** The routine authenticated-session shape. Carries **no** token. */
export interface SessionDto {
  id: string;
  /** Live application role names only — never `_Role` objects. */
  roles: AppRole[];
  /** Safe name for greeting the user. Absent when nothing safe is available. */
  displayName?: string;
  /**
   * Whether the Student's profile is complete ⟨CP3A⟩.
   *
   * One boolean, calculated server-side from the stored profile — **not** the
   * profile itself. Routing needs to know whether to send a Student to Complete
   * Profile, and that is all it needs; shipping the whole profile on every
   * session restoration would put a phone number and a date of birth on the
   * wire for a question that a single bit answers.
   *
   * Absent for an Admin, who has no profile and never will.
   */
  profileComplete?: boolean;
}

/**
 * The single successful-sign-in response. The session token appears here and
 * nowhere else — the client needs it exactly once, to establish its session.
 */
export interface SessionWithTokenDto extends SessionDto {
  sessionToken: string;
}

/** Keys that must never appear in either DTO. Exported for the tests. */
export const FORBIDDEN_SESSION_DTO_KEYS: readonly string[] = [
  'username',
  'password',
  'authData',
  'ACL',
  'acl',
  'email',
  'emailVerified',
  'phoneNumber',
  'provider',
  'providerSubject',
  'sub',
  'subject',
  'credential',
  'id_token',
  'idToken',
  'masterKey',
  'objectId',
  'className',
  '_hashed_password',
];

/**
 * Build the display name.
 *
 * For a Student these names come from the **verified** Google claims stored at
 * provisioning time. For an Admin the username is a real, human-chosen login
 * name and is an acceptable fallback; for a Student no fallback is used, because
 * the only thing available would be the internal username.
 */
function displayNameFor(user: Parse.User, roles: AppRole[]): string | undefined {
  const first = String(user.get('firstName') ?? '').trim();
  const last = String(user.get('lastName') ?? '').trim();
  const full = `${first} ${last}`.trim();
  if (full.length > 0) return full;

  if (roles.includes(AppRole.ADMIN)) {
    const username = String(user.get('username') ?? '').trim();
    if (username.length > 0) return username;
  }

  return undefined;
}

/**
 * Build the routine session DTO.
 *
 * `profileComplete` is passed in by the caller, which has already resolved it
 * from the stored profile. It is only meaningful for a Student, so it is omitted
 * entirely for anyone else rather than reported as `false` — an Admin's profile
 * is not incomplete, it does not exist.
 */
export function toSessionDto(
  user: Parse.User,
  roles: AppRole[],
  profileComplete?: boolean
): SessionDto {
  const dto: SessionDto = {
    id: user.id as string,
    roles: [...roles],
  };

  const displayName = displayNameFor(user, roles);
  if (displayName) dto.displayName = displayName;

  if (roles.includes(AppRole.STUDENT)) {
    dto.profileComplete = profileComplete === true;
  }

  return dto;
}

/** Build the sign-in DTO: the routine shape plus the session token. */
export function toSessionWithTokenDto(
  user: Parse.User,
  roles: AppRole[],
  sessionToken: string,
  profileComplete?: boolean
): SessionWithTokenDto {
  return {...toSessionDto(user, roles, profileComplete), sessionToken};
}
