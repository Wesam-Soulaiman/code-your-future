import { AppRole } from '../config/user-roles';

/**
 * The safe current-user DTO returned by the backend.
 *
 * Mirrors `backend/src/cloudCode/utils/dto/userDto.ts` exactly. Fields the
 * backend deliberately withholds — email, phone, `authData`, ACL, session
 * internals — are absent here too, so no component can accidentally depend on
 * data the API does not send.
 */
export interface CurrentUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  /** Live application roles. UI visibility only — never authorization. */
  roles: AppRole[];
}

/**
 * The login response: the current-user shape plus the session token. The token
 * appears in this response only; `getCurrentUser` never returns one.
 */
export interface LoginResponse extends CurrentUser {
  sessionToken: string;
}
