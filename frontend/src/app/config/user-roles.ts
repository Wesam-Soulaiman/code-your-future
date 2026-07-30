/**
 * Code Your Future application roles.
 *
 * Authenticated roles are exactly Admin and Student. A Visitor is an
 * unauthenticated caller and is deliberately NOT a role value — it is the
 * absence of a session.
 *
 * These names must match the roles seeded by the backend
 * (`backend/src/cloudCode/utils/constants/roles.ts`).
 *
 * IMPORTANT: these values drive UI visibility only. They are never a source of
 * authorization — the backend re-checks live `_Role` membership on every
 * request, so a tampered local value grants nothing.
 */
export enum AppRole {
  ADMIN = 'Admin',
  STUDENT = 'Student',
}

/** Every application role, for iteration. */
export const APP_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.STUDENT];

/**
 * Legacy template role names, retired in Checkpoint 1. Exported only so tests
 * can assert they never authorise anything; never use them in a guard.
 */
export const LEGACY_ROLE_NAMES: readonly string[] = ['SuperAdmin', 'Employee'];

/** Narrow an arbitrary value to an application role, or `undefined`. */
export function toAppRole(value: unknown): AppRole | undefined {
  return APP_ROLES.find(role => role === value);
}
