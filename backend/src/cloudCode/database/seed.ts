/**
 * Startup seeding and legacy-role migration.
 *
 * Everything here is idempotent: re-running it creates no duplicate role, no
 * duplicate membership, and no second Admin account.
 *
 * The master key is used deliberately and only here plus the other startup
 * routines — `_Role` and `_User` are closed to clients by CLP, so provisioning
 * is a trusted server operation by definition.
 *
 * Safety rules that must not be relaxed:
 *   - the seeded Admin account is never deleted;
 *   - Admin credentials are never logged;
 *   - `Employee` members are never silently promoted to Admin;
 *   - `Employee` members are never silently deleted;
 *   - a populated legacy role is reported, never guessed about.
 */

import {catchError} from '@90soft/parse-server-kit';
import {
  APP_ROLES,
  AppRole,
  LEGACY_ADMIN_ROLE_NAME,
  LEGACY_MEMBER_ROLE_NAME,
} from '../utils/constants/roles';
import {safeLog} from '../utils/logging/safeLogger';

export interface SeedReport {
  rolesCreated: AppRole[];
  rolesAlreadyPresent: AppRole[];
  adminUserCreated: boolean;
  migratedFromLegacyAdmin: number;
  legacyRolesRemoved: string[];
  legacyRolesRetained: {name: string; memberCount: number}[];
  staleCollections: string[];
}

async function findRoleByName(name: string): Promise<Parse.Role | undefined> {
  const query = new Parse.Query(Parse.Role);
  query.equalTo('name', name);
  const [error, role] = await catchError(query.first({useMasterKey: true}));
  if (error) {
    safeLog.error('Role lookup failed during seeding', {
      op: 'findRoleByName',
      ok: false,
      roleName: name,
    });
    throw error;
  }
  return role as Parse.Role | undefined;
}

/**
 * Create the two application roles if absent.
 *
 * The role ACL grants read+write to Admin only and no public access, so the role
 * graph is not readable by a client even if a future CLP change slipped.
 */
async function seedRoles(report: SeedReport): Promise<void> {
  for (const roleName of APP_ROLES) {
    const existing = await findRoleByName(roleName);

    if (existing) {
      report.rolesAlreadyPresent.push(roleName);
      continue;
    }

    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess(AppRole.ADMIN, true);
    acl.setRoleWriteAccess(AppRole.ADMIN, true);

    const role = new Parse.Role(roleName, acl);
    await role.save(null, {useMasterKey: true});
    report.rolesCreated.push(roleName);
  }

  safeLog.info('Application roles seeded', {
    op: 'seedRoles',
    ok: true,
    created: report.rolesCreated,
    alreadyPresent: report.rolesAlreadyPresent,
  });
}

/**
 * Seed the Admin account from the environment, idempotently.
 *
 * Presence is decided by username. Neither the username nor the password nor the
 * email is ever logged — only whether creation happened.
 */
async function seedAdminUser(report: SeedReport): Promise<void> {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL;

  const query = new Parse.Query(Parse.User);
  query.equalTo('username', username);
  const [lookupError, existing] = await catchError(
    query.first({useMasterKey: true})
  );

  if (lookupError) {
    safeLog.error('Admin lookup failed', {op: 'seedAdminUser', ok: false});
    throw lookupError;
  }

  const adminRole = await findRoleByName(AppRole.ADMIN);
  if (!adminRole) {
    safeLog.error('Admin role missing; cannot provision Admin account', {
      op: 'seedAdminUser',
      ok: false,
    });
    return;
  }

  if (existing) {
    // Never delete or recreate the seeded Admin. Only ensure membership, which
    // is itself idempotent — Parse relations ignore a duplicate add.
    const alreadyMember = await isRoleMember(adminRole, existing as Parse.User);
    if (!alreadyMember) {
      adminRole.getUsers().add(existing as Parse.User);
      await adminRole.save(null, {useMasterKey: true});
      safeLog.info('Existing account granted the Admin role', {
        op: 'seedAdminUser',
        ok: true,
        userId: existing.id,
      });
    } else {
      safeLog.info('Admin account already present', {
        op: 'seedAdminUser',
        ok: true,
        userId: existing.id,
      });
    }
    return;
  }

  if (!password) {
    // Fail loudly but safely: no default password is invented, because a
    // predictable Admin credential is a security hole.
    safeLog.warn('No Admin account exists and ADMIN_PASSWORD is not set — skipping', {
      op: 'seedAdminUser',
      ok: false,
      stage: 'missing-ADMIN_PASSWORD',
    });
    return;
  }

  const user = new Parse.User();
  user.setUsername(username);
  user.setPassword(password);
  if (email) user.setEmail(email);

  const [saveError, saved] = await catchError(
    user.save(null, {useMasterKey: true})
  );
  if (saveError || !saved) {
    safeLog.error('Admin account creation failed', {
      op: 'seedAdminUser',
      ok: false,
    });
    return;
  }

  adminRole.getUsers().add(saved as Parse.User);
  await adminRole.save(null, {useMasterKey: true});

  report.adminUserCreated = true;
  safeLog.info('Admin account created and granted the Admin role', {
    op: 'seedAdminUser',
    ok: true,
    userId: saved.id,
  });
}

async function isRoleMember(role: Parse.Role, user: Parse.User): Promise<boolean> {
  const query = role.getUsers().query();
  query.equalTo('objectId', user.id);
  const [error, found] = await catchError(query.first({useMasterKey: true}));
  if (error) return false;
  return Boolean(found);
}

async function countRoleMembers(role: Parse.Role): Promise<number> {
  const [error, count] = await catchError(
    role.getUsers().query().count({useMasterKey: true})
  );
  return error ? -1 : (count as number);
}

/**
 * Retire the legacy template roles.
 *
 *   - `SuperAdmin` members are migrated into `Admin`. That is a safe widening of
 *     an already-privileged account and preserves the seeded administrator.
 *   - `Employee` is NEVER migrated. Employee membership carries no Code Your
 *     Future meaning, so promoting those accounts to Admin would be an
 *     escalation and deleting them would be data loss. If the role is populated
 *     it is reported and left alone for a human decision.
 *   - An empty legacy role is deleted, so a clean database ends up with exactly
 *     `Admin` and `Student`.
 */
async function migrateLegacyRoles(report: SeedReport): Promise<void> {
  const adminRole = await findRoleByName(AppRole.ADMIN);

  // ── SuperAdmin → Admin ────────────────────────────────────────────────
  const legacyAdmin = await findRoleByName(LEGACY_ADMIN_ROLE_NAME);
  if (legacyAdmin && adminRole) {
    const [listError, legacyMembers] = await catchError(
      legacyAdmin.getUsers().query().limit(1000).find({useMasterKey: true})
    );

    if (listError) {
      report.legacyRolesRetained.push({name: LEGACY_ADMIN_ROLE_NAME, memberCount: -1});
      safeLog.error('Could not read legacy SuperAdmin membership; role retained', {
        op: 'migrateLegacyRoles',
        ok: false,
        roleName: LEGACY_ADMIN_ROLE_NAME,
      });
    } else {
      let migrated = 0;
      for (const legacyMember of legacyMembers as Parse.User[]) {
        if (!(await isRoleMember(adminRole, legacyMember))) {
          adminRole.getUsers().add(legacyMember);
          migrated++;
        }
      }
      if (migrated > 0) {
        await adminRole.save(null, {useMasterKey: true});
      }
      report.migratedFromLegacyAdmin = migrated;

      // Membership is now represented by Admin, so the legacy role object can go.
      await legacyAdmin.destroy({useMasterKey: true});
      report.legacyRolesRemoved.push(LEGACY_ADMIN_ROLE_NAME);

      safeLog.info('Legacy SuperAdmin role migrated to Admin and removed', {
        op: 'migrateLegacyRoles',
        ok: true,
        roleName: LEGACY_ADMIN_ROLE_NAME,
        migratedMemberCount: migrated,
      });
    }
  }

  // ── Employee: never promote, never delete members ─────────────────────
  const legacyMemberRole = await findRoleByName(LEGACY_MEMBER_ROLE_NAME);
  if (legacyMemberRole) {
    const memberCount = await countRoleMembers(legacyMemberRole);

    if (memberCount === 0) {
      await legacyMemberRole.destroy({useMasterKey: true});
      report.legacyRolesRemoved.push(LEGACY_MEMBER_ROLE_NAME);
      safeLog.info('Empty legacy Employee role removed', {
        op: 'migrateLegacyRoles',
        ok: true,
        roleName: LEGACY_MEMBER_ROLE_NAME,
      });
    } else {
      report.legacyRolesRetained.push({
        name: LEGACY_MEMBER_ROLE_NAME,
        memberCount,
      });
      safeLog.warn(
        'Legacy Employee role is not empty — retained for manual review. ' +
          'Its members are NOT Admins and hold no Code Your Future access.',
        {
          op: 'migrateLegacyRoles',
          ok: false,
          roleName: LEGACY_MEMBER_ROLE_NAME,
          memberCount,
          action: 'manual-decision-required',
        }
      );
    }
  }
}

/**
 * Report obsolete template collections without touching them.
 *
 * Source removal and data deletion are different actions: `AppSettings` is gone
 * from the source, but an existing collection in a developer's database is their
 * data to drop. Only the collection name and document count are reported —
 * never any document contents.
 */
async function reportStaleCollections(report: SeedReport): Promise<void> {
  const obsoleteClasses = ['AppSettings'];

  for (const className of obsoleteClasses) {
    const query = new Parse.Query(className);
    const [error, count] = await catchError(query.count({useMasterKey: true}));

    // A missing class throws (or returns 0) — either way there is nothing stale.
    if (error || !count) continue;

    report.staleCollections.push(className);
    safeLog.warn(
      `Stale template collection '${className}' still exists in the database. ` +
        'It is no longer referenced by any source code. Drop it manually when ready — ' +
        'startup will not delete data.',
      {
        op: 'reportStaleCollections',
        className,
        documentCount: count,
        action: 'manual-drop-optional',
      }
    );
  }
}

/**
 * Startup entry point. Awaited by the caller so seeding completes before the
 * server is considered ready.
 */
export async function seedAll(): Promise<SeedReport> {
  const report: SeedReport = {
    rolesCreated: [],
    rolesAlreadyPresent: [],
    adminUserCreated: false,
    migratedFromLegacyAdmin: 0,
    legacyRolesRemoved: [],
    legacyRolesRetained: [],
    staleCollections: [],
  };

  await seedRoles(report);
  await migrateLegacyRoles(report);
  await seedAdminUser(report);
  await reportStaleCollections(report);

  safeLog.info('Seeding complete', {
    op: 'seedAll',
    ok: true,
    rolesCreated: report.rolesCreated,
    legacyRolesRemoved: report.legacyRolesRemoved,
    legacyRolesRetainedCount: report.legacyRolesRetained.length,
    staleCollectionCount: report.staleCollections.length,
    adminUserCreated: report.adminUserCreated,
  });

  return report;
}
