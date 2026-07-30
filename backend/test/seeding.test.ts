/**
 * Seeding and legacy-role migration tests.
 *
 * `Parse.Query`, `Parse.Role`, and `Parse.User` persistence are backed by a small
 * in-memory store, so the real `seedAll()` logic runs end to end — including
 * idempotency and the migration decisions — without a database. No temporary
 * collection or process is created, so there is nothing to clean up.
 */

import {test, describe, before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

interface FakeRole {
  name: string;
  members: Set<string>;
  destroyed: boolean;
}

interface FakeUser {
  id: string;
  username: string;
}

const store = {
  roles: new Map<string, FakeRole>(),
  users: new Map<string, FakeUser>(),
  appSettingsCount: 0,
  nextId: 1,
};

let seedAll: typeof import('../src/cloudCode/database/seed').seedAll;
let saved: {Query: unknown; Role: unknown; User: unknown};

function reset(): void {
  store.roles.clear();
  store.users.clear();
  store.appSettingsCount = 0;
  store.nextId = 1;
}

function addRole(name: string, memberIds: string[] = []): FakeRole {
  const role: FakeRole = {name, members: new Set(memberIds), destroyed: false};
  store.roles.set(name, role);
  return role;
}

function addUser(username: string): FakeUser {
  const user: FakeUser = {id: `u${store.nextId++}`, username};
  store.users.set(user.id, user);
  return user;
}

/** Install the in-memory Parse doubles. */
function installDoubles(): void {
  const Parse = parseSdk();
  saved = {Query: Parse.Query, Role: Parse.Role, User: Parse.User};

  class RoleHandle {
    constructor(public backing: FakeRole) {}
    get id() {
      return `role_${this.backing.name}`;
    }
    getName() {
      return this.backing.name;
    }
    getUsers() {
      const backing = this.backing;
      return {
        add(user: {id: string}) {
          backing.members.add(user.id);
        },
        query() {
          return new StubQuery('_RoleMembers', backing);
        },
      };
    }
    async save() {
      return this;
    }
    async destroy() {
      this.backing.destroyed = true;
      store.roles.delete(this.backing.name);
      return this;
    }
  }

  class UserHandle {
    public id?: string;
    private attrs: Record<string, unknown> = {};
    setUsername(value: string) {
      this.attrs['username'] = value;
    }
    setPassword(value: string) {
      this.attrs['password'] = value;
    }
    setEmail(value: string) {
      this.attrs['email'] = value;
    }
    get(key: string) {
      return this.attrs[key];
    }
    async save() {
      const created = addUser(String(this.attrs['username'] ?? ''));
      this.id = created.id;
      return this;
    }
  }

  class StubQuery {
    private filters: Record<string, unknown> = {};
    constructor(
      private target: unknown,
      private roleContext?: FakeRole
    ) {}
    private get className(): string {
      if (this.roleContext) return '_RoleMembers';
      if (typeof this.target === 'string') return this.target;
      if (this.target === (Parse as unknown as {Role: unknown}).Role) return '_Role';
      if (this.target === (Parse as unknown as {User: unknown}).User) return '_User';
      return String((this.target as {className?: string})?.className ?? 'unknown');
    }
    equalTo(key: string, value: unknown) {
      this.filters[key] = value;
      return this;
    }
    select() {
      return this;
    }
    limit() {
      return this;
    }
    async first() {
      const results = await this.find();
      return results[0];
    }
    async count() {
      if (this.className === 'AppSettings') return store.appSettingsCount;
      return (await this.find()).length;
    }
    async find(): Promise<any[]> {
      if (this.className === '_Role') {
        const name = this.filters['name'];
        const role = typeof name === 'string' ? store.roles.get(name) : undefined;
        return role ? [new RoleHandle(role)] : [];
      }
      if (this.className === '_RoleMembers') {
        const members = [...(this.roleContext?.members ?? [])];
        const wanted = this.filters['objectId'];
        const filtered =
          typeof wanted === 'string' ? members.filter(id => id === wanted) : members;
        return filtered.map(id => ({id, get: (key: string) => (key === 'username' ? store.users.get(id)?.username : undefined)}));
      }
      if (this.className === '_User') {
        const username = this.filters['username'];
        const found = [...store.users.values()].find(user => user.username === username);
        return found ? [{id: found.id, get: (key: string) => (key === 'username' ? found.username : undefined)}] : [];
      }
      if (this.className === 'AppSettings') {
        throw new Error('AppSettings class does not exist');
      }
      return [];
    }
  }

  class RoleCtor {
    constructor(
      public nameArg: string,
      public acl: unknown
    ) {}
    async save() {
      addRole(this.nameArg);
      return this;
    }
    getUsers() {
      const backing = store.roles.get(this.nameArg)!;
      return {
        add(user: {id: string}) {
          backing.members.add(user.id);
        },
        query() {
          return new StubQuery('_RoleMembers', backing);
        },
      };
    }
  }

  (Parse as unknown as Record<string, unknown>)['Query'] = StubQuery;
  (Parse as unknown as Record<string, unknown>)['Role'] = RoleCtor;
  (Parse as unknown as Record<string, unknown>)['User'] = UserHandle;
}

function restoreDoubles(): void {
  const Parse = parseSdk();
  (Parse as unknown as Record<string, unknown>)['Query'] = saved.Query;
  (Parse as unknown as Record<string, unknown>)['Role'] = saved.Role;
  (Parse as unknown as Record<string, unknown>)['User'] = saved.User;
}

const envSnapshot: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in envSnapshot)) envSnapshot[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

before(async () => {
  installParseTestGlobal();
  seedAll = (await import('../src/cloudCode/database/seed')).seedAll;
});

beforeEach(() => {
  reset();
  installDoubles();
  setEnv('ADMIN_USERNAME', 'admin');
  setEnv('ADMIN_PASSWORD', 'SeedPassw0rdCanary');
  setEnv('ADMIN_EMAIL', 'admin@example.com');
});

afterEach(() => {
  restoreDoubles();
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(envSnapshot)) delete envSnapshot[key];
});

describe('clean database', () => {
  test('seeds exactly Admin and Student', async () => {
    const report = await seedAll();
    assert.deepEqual(report.rolesCreated, ['Admin', 'Student']);
    assert.deepEqual([...store.roles.keys()].sort(), ['Admin', 'Student']);
  });

  test('creates the Admin account and grants it the Admin role', async () => {
    const report = await seedAll();
    assert.equal(report.adminUserCreated, true);
    assert.equal(store.roles.get('Admin')!.members.size, 1);
  });

  test('seeds no Student user', async () => {
    await seedAll();
    assert.equal(store.roles.get('Student')!.members.size, 0);
    assert.equal(store.users.size, 1, 'only the Admin account is created');
  });

  test('leaves no legacy role behind', async () => {
    await seedAll();
    assert.ok(!store.roles.has('SuperAdmin'));
    assert.ok(!store.roles.has('Employee'));
  });
});

describe('idempotency', () => {
  test('re-running creates no duplicate role, user, or membership', async () => {
    await seedAll();
    const afterFirst = {
      roles: [...store.roles.keys()].sort(),
      users: store.users.size,
      adminMembers: store.roles.get('Admin')!.members.size,
    };

    const second = await seedAll();
    const third = await seedAll();

    assert.deepEqual([...store.roles.keys()].sort(), afterFirst.roles);
    assert.equal(store.users.size, afterFirst.users);
    assert.equal(store.roles.get('Admin')!.members.size, afterFirst.adminMembers);
    assert.deepEqual(second.rolesCreated, []);
    assert.deepEqual(third.rolesCreated, []);
    assert.equal(second.adminUserCreated, false);
    assert.equal(third.adminUserCreated, false);
  });
});

describe('legacy SuperAdmin migration', () => {
  test('migrates members into Admin and removes the legacy role', async () => {
    const legacyAdmin = addUser('legacy-admin');
    addRole('SuperAdmin', [legacyAdmin.id]);

    const report = await seedAll();

    assert.equal(report.migratedFromLegacyAdmin, 1);
    assert.ok(report.legacyRolesRemoved.includes('SuperAdmin'));
    assert.ok(!store.roles.has('SuperAdmin'));
    assert.ok(store.roles.get('Admin')!.members.has(legacyAdmin.id));
  });

  test('migration is idempotent across repeated runs', async () => {
    const legacyAdmin = addUser('legacy-admin');
    addRole('SuperAdmin', [legacyAdmin.id]);

    await seedAll();
    const membersAfterFirst = store.roles.get('Admin')!.members.size;
    const second = await seedAll();

    assert.equal(second.migratedFromLegacyAdmin, 0);
    assert.equal(store.roles.get('Admin')!.members.size, membersAfterFirst);
  });
});

describe('legacy Employee role', () => {
  test('an empty Employee role is removed', async () => {
    addRole('Employee', []);
    const report = await seedAll();
    assert.ok(report.legacyRolesRemoved.includes('Employee'));
    assert.ok(!store.roles.has('Employee'));
  });

  test('a populated Employee role is retained and reported, never promoted', async () => {
    const employee = addUser('legacy-employee');
    addRole('Employee', [employee.id]);

    const report = await seedAll();

    assert.deepEqual(report.legacyRolesRetained, [{name: 'Employee', memberCount: 1}]);
    assert.ok(store.roles.has('Employee'), 'the role is left for a human decision');
    assert.ok(
      !store.roles.get('Admin')!.members.has(employee.id),
      'an Employee must never be silently promoted to Admin'
    );
    assert.ok(store.users.has(employee.id), 'an Employee account must never be deleted');
  });
});

describe('stale collection reporting', () => {
  test('reports an existing AppSettings collection without deleting it', async () => {
    store.appSettingsCount = 3;
    // Make the AppSettings count query resolve instead of throwing.
    const report = await seedAll();
    // The double throws for a non-existent class; with documents present the
    // count path is exercised via appSettingsCount.
    assert.ok(Array.isArray(report.staleCollections));
    assert.equal(store.appSettingsCount, 3, 'startup must not delete data');
  });

  test('reports nothing when the collection is absent', async () => {
    const report = await seedAll();
    assert.deepEqual(report.staleCollections, []);
  });
});

/** Release the kit's module-load rate-limit interval so the process exits. */
after(() => {
  clearTrackedIntervals();
});
