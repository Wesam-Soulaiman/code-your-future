import {catchError, UserRoles} from '@90soft/parse-server-kit';
import User from '../models/User';

interface SeedItem {
  code: string;
  name: {ar: string; en: string};
  sortOrder: number;
  [key: string]: unknown;
}

/**
 * Main seed function — called on server start.
 * Add your lookup table seeds here.
 */
export async function seedAll() {
  await seedRoles();
  await seedAdminUser();

  // Add your lookup table seeds here:
  // await seedLookupTable('YourClassName', YOUR_ITEMS);

  console.log('Seeding complete.');
}

/**
 * Seed Parse Roles (SuperAdmin, Employee)
 */
async function seedRoles() {
  const roleNames = Object.values(UserRoles);

  for (const roleName of roleNames) {
    const query = new Parse.Query('_Role');
    query.equalTo('name', roleName);
    const exists = await query.first({useMasterKey: true});

    if (!exists) {
      const roleAcl = new Parse.ACL();
      roleAcl.setPublicReadAccess(false);
      roleAcl.setPublicWriteAccess(false);
      roleAcl.setRoleReadAccess('SuperAdmin', true);
      roleAcl.setRoleWriteAccess('SuperAdmin', true);

      const role = new Parse.Role(roleName, roleAcl);
      await role.save(null, {useMasterKey: true});
    }
  }

  console.log('Role seeding completed.');
}

/**
 * Seed admin user from env vars
 */
async function seedAdminUser() {
  const adminData = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe!2024',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
  };

  const query = new Parse.Query('_User');
  query.equalTo('username', adminData.username);
  const exists = await query.first({useMasterKey: true});

  if (!exists) {
    const user = new User();
    user.setUsername(adminData.username);
    user.setPassword(adminData.password);
    user.setEmail(adminData.email);

    const [saveErr] = await catchError(user.save(null, {useMasterKey: true}));
    if (saveErr) {
      console.error(`Failed to create admin user:`, saveErr);
      return;
    }
    console.log(`Created admin user: ${adminData.username}`);

    const roleQuery = new Parse.Query('_Role');
    roleQuery.equalTo('name', UserRoles.ADMIN);
    const adminRole = (await roleQuery.first({useMasterKey: true})) as
      | Parse.Role
      | undefined;

    if (adminRole) {
      adminRole.getUsers().add(user);
      await adminRole.save(null, {useMasterKey: true});
      console.log(`Assigned Admin role to: ${adminData.username}`);
    }
  } else {
    console.log(`Admin user already exists: ${adminData.username}`);
  }
}

/**
 * Reusable: seed a lookup table with code-based items.
 * Skips items that already exist (matched by code).
 *
 * Usage:
 *   const STATUSES: SeedItem[] = [
 *     {code: '1', name: {ar: 'نشط', en: 'Active'}, sortOrder: 1},
 *     {code: '2', name: {ar: 'غير نشط', en: 'Inactive'}, sortOrder: 2},
 *   ];
 *   await seedLookupTable('Status', STATUSES);
 */
async function seedLookupTable(className: string, items: SeedItem[]) {
  for (const item of items) {
    const query = new Parse.Query(className);
    query.equalTo('code', item.code);
    const exists = await query.first({useMasterKey: true});

    if (!exists) {
      const obj = new Parse.Object(className);
      for (const [key, value] of Object.entries(item)) {
        obj.set(key, value);
      }
      await obj.save(null, {useMasterKey: true});
      console.log(`  Created ${className}: ${item.code}`);
    }
  }
}
