/**
 * Code Your Future application roles — the single source of truth.
 *
 * Authenticated roles are exactly Admin and Student. An unauthenticated caller
 * is a Visitor, which is NOT a stored Parse Role — it is simply the absence of
 * a session.
 *
 * The toolkit package (`@90soft/parse-server-kit`) still exports a template
 * `UserRoles` enum with the legacy `SuperAdmin` / `Employee` values. That enum
 * MUST NOT be imported anywhere in this project; import from this module
 * instead. The legacy names exist here only so that startup migration can
 * recognise and retire them — never to grant access.
 */

/** Stored Parse Role names. These two are the only application roles. */
export enum AppRole {
  ADMIN = 'Admin',
  STUDENT = 'Student',
}

/** Every role seeded into `_Role`, in seeding order. */
export const APP_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.STUDENT];

/**
 * Legacy template roles. Recognised solely so startup can migrate or report
 * them. They MUST NEVER appear in a CLP, an ACL, a DTO, or an authorization
 * check — there is deliberately no compatibility alias.
 */
export const LEGACY_ROLE_NAMES: readonly string[] = ['SuperAdmin', 'Employee'];

/** The legacy role whose members are migrated to Admin. */
export const LEGACY_ADMIN_ROLE_NAME = 'SuperAdmin';

/** The legacy role that must never be silently promoted or deleted. */
export const LEGACY_MEMBER_ROLE_NAME = 'Employee';

/** CLP/ACL key for a role, e.g. `role:Admin`. */
export function roleKey(role: AppRole): string {
  return `role:${role}`;
}

/** Narrow an arbitrary string to an application role, or `undefined`. */
export function toAppRole(value: unknown): AppRole | undefined {
  return APP_ROLES.find(role => role === value);
}

/**
 * True when `value` is a legacy template role name. Used by migration and by
 * tests that assert legacy names never authorise anything.
 */
export function isLegacyRoleName(value: unknown): boolean {
  return typeof value === 'string' && LEGACY_ROLE_NAMES.includes(value);
}
