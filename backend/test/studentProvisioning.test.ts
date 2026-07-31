/**
 * Student provisioning — behaviour tests.
 *
 * `Parse.Query`, `Parse.User`, `Parse.Role`, and `StudentAuthIdentity.save` are
 * backed by a small in-memory store, so the real `provisionStudentFromGoogle()`
 * runs end to end: first sign-in, returning sign-in, role checks, conflict
 * handling, and the concurrent-race recovery path.
 *
 * The store enforces the same unique constraints the MongoDB indexes do —
 * (provider, providerSubject) and (provider, user) — so the duplicate-key
 * recovery is exercised as behaviour rather than asserted from source text. No
 * database, no network, and nothing to clean up.
 */

import {test, describe, before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

interface StoredUser {
  id: string;
  attrs: Record<string, unknown>;
  destroyed: boolean;
}

interface StoredIdentity {
  id: string;
  provider: string;
  providerSubject: string;
  userId: string;
}

const store = {
  users: new Map<string, StoredUser>(),
  roleMembers: new Map<string, Set<string>>(),
  identities: [] as StoredIdentity[],
  nextId: 1,
  /** When set, the first identity save loses a race to this rival. */
  raceRival: undefined as {subject: string; userId: string} | undefined,
  identitySaveAttempts: 0,
};

let provisioning: typeof import('../src/cloudCode/modules/StudentAuth/provisioning');
let errors: typeof import('../src/cloudCode/modules/StudentAuth/errors');
let StudentAuthIdentity: typeof import('../src/cloudCode/models/StudentAuthIdentity').default;

let saved: {Query: unknown; Role: unknown; User: unknown; identitySave: unknown};

const CLAIMS = {
  subject: '110000000000000000001',
  email: 'learner@example.com',
  givenName: 'Lina',
  familyName: 'Haddad',
};

function reset(): void {
  store.users.clear();
  store.roleMembers.clear();
  store.identities.length = 0;
  store.nextId = 1;
  store.raceRival = undefined;
  store.identitySaveAttempts = 0;
  store.roleMembers.set('Admin', new Set());
  store.roleMembers.set('Student', new Set());
}

function addUser(attrs: Record<string, unknown>): StoredUser {
  const user: StoredUser = {id: `u${store.nextId++}`, attrs: {...attrs}, destroyed: false};
  store.users.set(user.id, user);
  return user;
}

function addIdentity(subject: string, userId: string): StoredIdentity {
  const identity: StoredIdentity = {
    id: `i${store.nextId++}`,
    provider: 'google',
    providerSubject: subject,
    userId,
  };
  store.identities.push(identity);
  return identity;
}

function grantRole(role: string, userId: string): void {
  store.roleMembers.get(role)!.add(userId);
}

function duplicateKeyError(): Parse.Error {
  const Parse = parseSdk();
  return new Parse.Error(137, 'E11000 duplicate key error');
}

function emailTakenError(): Parse.Error {
  const Parse = parseSdk();
  return new Parse.Error(203, 'Account already exists for this email address.');
}

function installDoubles(): void {
  const Parse = parseSdk();
  saved = {
    Query: Parse.Query,
    Role: Parse.Role,
    User: Parse.User,
    identitySave: StudentAuthIdentity.prototype.save,
  };

  /** Wraps a stored user in the small surface the production code touches. */
  function userHandle(stored: StoredUser) {
    return {
      id: stored.id,
      get: (key: string) => stored.attrs[key],
      set: (key: string, value: unknown) => {
        stored.attrs[key] = value;
      },
      async destroy() {
        stored.destroyed = true;
        store.users.delete(stored.id);
        for (const members of store.roleMembers.values()) members.delete(stored.id);
        return this;
      },
    };
  }

  class UserCtor {
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
    set(key: string, value: unknown) {
      this.attrs[key] = value;
    }
    get(key: string) {
      return this.attrs[key];
    }
    async save() {
      const email = this.attrs['email'];
      const clash = [...store.users.values()].some(user => user.attrs['email'] === email);
      if (clash) throw emailTakenError();

      const created = addUser(this.attrs);
      this.id = created.id;
      const handle = userHandle(created);
      // The production code keeps using the object it saved.
      (this as unknown as Record<string, unknown>)['destroy'] = handle.destroy.bind(handle);
      return this;
    }
    async destroy() {
      if (!this.id) return this;
      const stored = store.users.get(this.id);
      if (stored) await userHandle(stored).destroy();
      return this;
    }
  }

  class RoleHandle {
    constructor(public name: string) {}
    get id() {
      return `role_${this.name}`;
    }
    getName() {
      return this.name;
    }
    getUsers() {
      const name = this.name;
      return {
        add(user: {id?: string}) {
          if (user.id) store.roleMembers.get(name)?.add(user.id);
        },
      };
    }
    async save() {
      return this;
    }
  }

  class StubQuery {
    private filters: Record<string, unknown> = {};
    constructor(private target: unknown) {}

    private get className(): string {
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
    async get(id: string) {
      const stored = store.users.get(id);
      if (!stored) throw new Parse.Error(101, 'Object not found');
      return userHandle(stored);
    }
    async first() {
      return (await this.find())[0];
    }
    async find(): Promise<any[]> {
      if (this.className === 'StudentAuthIdentity') {
        return store.identities
          .filter(
            identity =>
              identity.provider === this.filters['provider'] &&
              identity.providerSubject === this.filters['providerSubject']
          )
          .map(identity => ({
            id: identity.id,
            get: (key: string) =>
              key === 'user'
                ? {id: identity.userId}
                : (identity as unknown as Record<string, unknown>)[key],
          }));
      }

      if (this.className === '_Role') {
        // getAppRoles filters by membership; ensureStudentRole filters by name.
        const byName = this.filters['name'];
        if (typeof byName === 'string') {
          return store.roleMembers.has(byName) ? [new RoleHandle(byName)] : [];
        }
        const member = this.filters['users'] as {id?: string} | undefined;
        const userId = member?.id;
        if (!userId) return [];
        return [...store.roleMembers.entries()]
          .filter(([, members]) => members.has(userId))
          .map(([name]) => ({get: (key: string) => (key === 'name' ? name : undefined)}));
      }

      return [];
    }
  }

  /**
   * Identity save with the same uniqueness the MongoDB indexes enforce.
   * `raceRival` simulates a concurrent writer that committed first.
   */
  async function identitySave(this: InstanceType<typeof StudentAuthIdentity>) {
    store.identitySaveAttempts += 1;

    if (store.raceRival) {
      // The rival committed between this request's lookup and its write.
      addIdentity(store.raceRival.subject, store.raceRival.userId);
      store.raceRival = undefined;
    }

    const provider = this.get('provider') as string;
    const subject = this.get('providerSubject') as string;
    const user = this.get('user') as {id?: string};
    const userId = String(user?.id ?? '');

    const subjectClash = store.identities.some(
      identity => identity.provider === provider && identity.providerSubject === subject
    );
    const userClash = store.identities.some(
      identity => identity.provider === provider && identity.userId === userId
    );
    if (subjectClash || userClash) throw duplicateKeyError();

    const created = addIdentity(subject, userId);
    (this as unknown as {id: string}).id = created.id;
    return this;
  }

  (Parse as unknown as Record<string, unknown>)['Query'] = StubQuery;
  (Parse as unknown as Record<string, unknown>)['Role'] = RoleHandle;
  (Parse as unknown as Record<string, unknown>)['User'] = UserCtor;
  (StudentAuthIdentity.prototype as unknown as Record<string, unknown>)['save'] = identitySave;
}

function restoreDoubles(): void {
  const Parse = parseSdk();
  (Parse as unknown as Record<string, unknown>)['Query'] = saved.Query;
  (Parse as unknown as Record<string, unknown>)['Role'] = saved.Role;
  (Parse as unknown as Record<string, unknown>)['User'] = saved.User;
  (StudentAuthIdentity.prototype as unknown as Record<string, unknown>)['save'] =
    saved.identitySave;
}

before(async () => {
  installParseTestGlobal();
  StudentAuthIdentity = (await import('../src/cloudCode/models/StudentAuthIdentity')).default;
  provisioning = await import('../src/cloudCode/modules/StudentAuth/provisioning');
  errors = await import('../src/cloudCode/modules/StudentAuth/errors');
});

beforeEach(() => {
  reset();
  installDoubles();
});

afterEach(() => {
  restoreDoubles();
  provisioning.resetSessionIssuer();
});

after(() => clearTrackedIntervals());

async function failureCode(claims = CLAIMS): Promise<string> {
  try {
    await provisioning.provisionStudentFromGoogle(claims);
  } catch (error) {
    return String((error as {message?: unknown}).message);
  }
  throw new Error('expected provisioning to fail');
}

describe('first sign-in', () => {
  test('creates exactly one Student account', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(result.userCreated, true);
    assert.equal(store.users.size, 1);
    assert.equal(store.users.get(result.user.id as string)?.destroyed, false);
  });

  test('assigns the Student role server-side', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.ok(store.roleMembers.get('Student')!.has(result.user.id as string));
  });

  test('never assigns the Admin role', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.roleMembers.get('Admin')!.has(result.user.id as string), false);
  });

  test('creates exactly one identity record for the Google subject', async () => {
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.identities.length, 1);
    assert.equal(store.identities[0].provider, 'google');
    assert.equal(store.identities[0].providerSubject, CLAIMS.subject);
  });

  test('stores the verified email on the account', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.users.get(result.user.id as string)?.attrs['email'], CLAIMS.email);
  });

  test('stores the verified names for a display name', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const attrs = store.users.get(result.user.id as string)!.attrs;
    assert.equal(attrs['firstName'], 'Lina');
    assert.equal(attrs['lastName'], 'Haddad');
  });

  test('omits absent optional names rather than storing empty strings', async () => {
    const result = await provisioning.provisionStudentFromGoogle({
      subject: 'sub-no-names',
      email: 'anon@example.com',
    });
    const attrs = store.users.get(result.user.id as string)!.attrs;
    assert.equal('firstName' in attrs, false);
    assert.equal('lastName' in attrs, false);
  });
});

describe('the internal credentials Parse requires', () => {
  test('the username is server-generated and is not the email', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const username = String(store.users.get(result.user.id as string)!.attrs['username']);
    assert.match(username, /^gid_/);
    assert.equal(username.includes('@'), false);
    assert.equal(username.includes(CLAIMS.email), false);
    assert.equal(username.includes(CLAIMS.subject), false);
  });

  test('the username is unpredictable — two accounts never collide', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const second = await provisioning.provisionStudentFromGoogle({
      subject: 'another-subject',
      email: 'other@example.com',
    });
    const a = store.users.get(first.user.id as string)!.attrs['username'];
    const b = store.users.get(second.user.id as string)!.attrs['username'];
    assert.notEqual(a, b);
    assert.ok(String(a).length >= 20);
  });

  test('the generated password is long, random, and different every time', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const second = await provisioning.provisionStudentFromGoogle({
      subject: 'another-subject',
      email: 'other@example.com',
    });
    const a = String(store.users.get(first.user.id as string)!.attrs['password']);
    const b = String(store.users.get(second.user.id as string)!.attrs['password']);
    assert.ok(a.length >= 40);
    assert.notEqual(a, b);
  });

  test('neither the username nor the password is returned to the caller', async () => {
    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const stored = store.users.get(result.user.id as string)!.attrs;
    const returned = JSON.stringify({
      user: result.user.id,
      userCreated: result.userCreated,
      identityCreated: result.identityCreated,
    });
    assert.equal(returned.includes(String(stored['username'])), false);
    assert.equal(returned.includes(String(stored['password'])), false);
  });
});

describe('returning Student', () => {
  test('reuses the same account', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const second = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(second.user.id, first.user.id);
    assert.equal(second.userCreated, false);
  });

  test('creates no duplicate Student', async () => {
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.users.size, 1);
  });

  test('creates no duplicate identity record', async () => {
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.identities.length, 1);
    assert.equal(store.identitySaveAttempts, 1);
  });

  test('a different Google subject gets its own Student', async () => {
    await provisioning.provisionStudentFromGoogle(CLAIMS);
    await provisioning.provisionStudentFromGoogle({
      subject: 'a-different-subject',
      email: 'second@example.com',
    });
    assert.equal(store.users.size, 2);
    assert.equal(store.identities.length, 2);
  });

  test('is refused once the Student role has been withdrawn', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    store.roleMembers.get('Student')!.delete(first.user.id as string);
    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  });

  test('is refused when the account behind the identity no longer exists', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    store.users.delete(first.user.id as string);
    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  });

  test('a withdrawn role does not silently re-grant itself', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    store.roleMembers.get('Student')!.delete(first.user.id as string);
    await failureCode();
    assert.equal(store.roleMembers.get('Student')!.has(first.user.id as string), false);
  });
});

describe('identity conflicts', () => {
  test('an Admin account is never converted to a Student', async () => {
    const admin = addUser({username: 'admin', email: CLAIMS.email});
    grantRole('Admin', admin.id);
    addIdentity(CLAIMS.subject, admin.id);

    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    assert.equal(store.roleMembers.get('Student')!.has(admin.id), false);
    assert.equal(store.users.get(admin.id)?.destroyed, false);
  });

  test('an existing account with the same email is not silently merged', async () => {
    const admin = addUser({username: 'admin', email: CLAIMS.email});
    grantRole('Admin', admin.id);

    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    // No Student created, no identity created, the Admin untouched.
    assert.equal(store.users.size, 1);
    assert.equal(store.identities.length, 0);
    assert.equal(store.roleMembers.get('Student')!.size, 0);
  });

  test('a Google identity linked to one Student cannot link to another', async () => {
    const first = await provisioning.provisionStudentFromGoogle(CLAIMS);
    // A second account tries to claim the same subject.
    const other = addUser({username: 'gid_other', email: 'other@example.com'});
    grantRole('Student', other.id);

    const again = await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(again.user.id, first.user.id);
    assert.notEqual(again.user.id, other.id);
    assert.equal(store.identities.length, 1);
  });

  test('a legacy role grants no Student access', async () => {
    store.roleMembers.set('SuperAdmin', new Set());
    store.roleMembers.set('Employee', new Set());
    const legacy = addUser({username: 'legacy', email: 'legacy@example.com'});
    grantRole('SuperAdmin', legacy.id);
    grantRole('Employee', legacy.id);
    addIdentity(CLAIMS.subject, legacy.id);

    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  });

  test('no failure path leaves a half-provisioned account behind', async () => {
    const admin = addUser({username: 'admin', email: CLAIMS.email});
    grantRole('Admin', admin.id);
    await failureCode();

    const orphans = [...store.users.values()].filter(user => user.id !== admin.id);
    assert.deepEqual(orphans, []);
  });
});

describe('concurrent first sign-in — the account-creation race', () => {
  /**
   * Two requests for the *same* Google identity both find no identity and both
   * try to create a `_User`. The email index rejects the second one **before**
   * the identity index ever sees it, so recovery has to start from the account
   * conflict — not from the identity conflict.
   *
   * Runtime validation is what surfaced this: three simultaneous sign-ins
   * produced one account, but two of them were told the account was ineligible.
   */
  test('an email clash for the same identity resolves to the winner', async () => {
    const rival = addUser({username: 'gid_rival', email: CLAIMS.email});
    grantRole('Student', rival.id);
    addIdentity(CLAIMS.subject, rival.id);

    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);

    assert.equal(result.user.id, rival.id);
    assert.equal(result.userCreated, false);
    assert.equal(store.users.size, 1);
    assert.equal(store.identities.length, 1);
  });

  test('an email clash with a different account is still refused', async () => {
    // The Admin owns this address and holds no identity for the subject, so
    // there is nothing to resolve to — it must fail closed, not merge.
    const admin = addUser({username: 'admin', email: CLAIMS.email});
    grantRole('Admin', admin.id);

    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    assert.equal(store.users.size, 1);
    assert.equal(store.identities.length, 0);
  });

  test('an email clash never grants the Student role to the other account', async () => {
    const admin = addUser({username: 'admin', email: CLAIMS.email});
    grantRole('Admin', admin.id);
    await failureCode();
    assert.equal(store.roleMembers.get('Student')!.has(admin.id), false);
  });
});

describe('concurrent first sign-in', () => {
  test('a losing writer resolves to the winner rather than duplicating', async () => {
    const rival = addUser({username: 'gid_rival', email: 'rival@example.com'});
    grantRole('Student', rival.id);
    store.raceRival = {subject: CLAIMS.subject, userId: rival.id};

    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);

    assert.equal(result.user.id, rival.id);
    assert.equal(result.userCreated, false);
    assert.equal(result.identityCreated, false);
  });

  test('the loser deletes the account it had just created', async () => {
    const rival = addUser({username: 'gid_rival', email: 'rival@example.com'});
    grantRole('Student', rival.id);
    store.raceRival = {subject: CLAIMS.subject, userId: rival.id};

    await provisioning.provisionStudentFromGoogle(CLAIMS);

    // Exactly the rival survives — no orphaned Student.
    assert.equal(store.users.size, 1);
    assert.ok(store.users.has(rival.id));
  });

  test('exactly one identity record exists after the race', async () => {
    const rival = addUser({username: 'gid_rival', email: 'rival@example.com'});
    grantRole('Student', rival.id);
    store.raceRival = {subject: CLAIMS.subject, userId: rival.id};

    await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.identities.length, 1);
    assert.equal(store.identities[0].userId, rival.id);
  });

  test('the race is decided by the store, not by the earlier lookup', async () => {
    // The lookup at the start of the call found nothing; the rival appeared
    // afterwards. The duplicate-key rejection is what redirects the flow.
    const rival = addUser({username: 'gid_rival', email: 'rival@example.com'});
    grantRole('Student', rival.id);
    store.raceRival = {subject: CLAIMS.subject, userId: rival.id};

    await provisioning.provisionStudentFromGoogle(CLAIMS);
    assert.equal(store.identitySaveAttempts, 1);
  });

  test('a winner that is not eligible is still refused', async () => {
    const rivalAdmin = addUser({username: 'admin', email: 'admin@example.com'});
    grantRole('Admin', rivalAdmin.id);
    store.raceRival = {subject: CLAIMS.subject, userId: rivalAdmin.id};

    assert.equal(await failureCode(), errors.StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  });
});

describe('session issuance', () => {
  test('is delegated to the injected issuer', async () => {
    let seenUserId: string | undefined;
    provisioning.setSessionIssuer({
      async issue(userId: string) {
        seenUserId = userId;
        return 'r:test-session-token';
      },
    });

    const result = await provisioning.provisionStudentFromGoogle(CLAIMS);
    const token = await provisioning.issueStudentSession(result.user.id as string);

    assert.equal(seenUserId, result.user.id);
    assert.equal(token, 'r:test-session-token');
  });

  test('a failing issuer surfaces as a stable code, not an internal error', async () => {
    provisioning.setSessionIssuer({
      async issue() {
        throw new Error('mongo connection reset at 10.0.0.5:27017');
      },
    });

    try {
      await provisioning.issueStudentSession('u1');
      assert.fail('expected issuance to fail');
    } catch (error) {
      const message = String((error as {message?: unknown}).message);
      assert.equal(message, errors.StudentAuthError.SIGN_IN_FAILED);
      assert.equal(message.includes('10.0.0.5'), false);
      assert.equal(message.includes('27017'), false);
    }
  });

  test('a synchronous issuer failure is sanitised too', async () => {
    // Regression: the production issuer called `Parse.User.loginAs` directly, so
    // a synchronous throw (a missing method on a misconfigured SDK) escaped the
    // error wrapper and carried its internal message all the way out.
    provisioning.setSessionIssuer({
      issue() {
        throw new Error('userClass.loginAs is not a function');
      },
    } as unknown as import('../src/cloudCode/modules/StudentAuth/provisioning').SessionIssuer);

    try {
      await provisioning.issueStudentSession('u1');
      assert.fail('expected issuance to fail');
    } catch (error) {
      assert.equal(
        String((error as {message?: unknown}).message),
        errors.StudentAuthError.SIGN_IN_FAILED
      );
    }
  });

  test('the production issuer never leaks the underlying failure', async () => {
    // `Parse.User.loginAs` is absent from the double, so the call throws.
    provisioning.resetSessionIssuer();
    try {
      await provisioning.issueStudentSession('u1');
      assert.fail('expected issuance to fail');
    } catch (error) {
      assert.equal(
        String((error as {message?: unknown}).message),
        errors.StudentAuthError.SIGN_IN_FAILED
      );
    }
  });
});
