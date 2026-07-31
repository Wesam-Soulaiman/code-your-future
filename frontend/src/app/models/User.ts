import { AppRole } from '../config/user-roles';

/**
 * The safe session DTO returned by `/api/student-auth/getSession`.
 *
 * Mirrors `backend/src/cloudCode/modules/StudentAuth/dto.ts` exactly. It is
 * role-agnostic: an Admin and a Student receive the same three fields.
 *
 * Notably absent, and absent on purpose: the session token, the username,
 * email, phone number, `authData`, ACL, the Google subject, and anything from
 * `StudentAuthIdentity`. A Student's username is server-generated and internal,
 * so no response carries it and no component can depend on it.
 */
export interface CurrentUser {
  id: string;
  /** Live application roles. UI visibility only — never authorization. */
  roles: AppRole[];
  /**
   * A name safe to greet the user with: the verified Google names for a
   * Student, the login name for an Admin. Absent when nothing safe exists.
   */
  displayName?: string;
}

/**
 * A successful sign-in response — the session shape plus the session token.
 * The token appears in this response only; restoration never returns one.
 */
export interface LoginResponse extends CurrentUser {
  sessionToken: string;
}

/**
 * Where session restoration has got to.
 *
 * `restoring` exists so a guard can wait rather than guess: it is the state
 * between "a token is present in storage" and "the server has confirmed who
 * that token belongs to".
 */
export type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';
