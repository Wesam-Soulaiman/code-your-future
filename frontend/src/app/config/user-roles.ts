/**
 * User Roles
 *
 * Defines the application roles. These must match the role names
 * seeded in the backend (see backend/src/cloudCode/database/seed.ts).
 *
 * Used for:
 *   - Route guards: roleGuard(UserRoles.ADMIN)
 *   - Conditional UI: *ngIf="hasRole(UserRoles.ADMIN)"
 *   - Menu visibility in shell.component.ts
 *
 * To add a new role:
 *   1. Add the enum value here
 *   2. Add the matching role name to the backend's UserRoles (from @90soft/parse-server-kit)
 *   3. The backend seed function will auto-create it on next server start
 */
export enum UserRoles {
  ADMIN = 'SuperAdmin',
  EMPLOYEE = 'Employee',
}
