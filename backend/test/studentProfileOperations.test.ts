/**
 * Profile and catalog operations — behaviour tests against an in-memory store.
 *
 * `Parse.Query`, `Parse.User`, `Parse.Role`, `Parse.Session`, and the two
 * classes' `save` are backed by a small in-memory store, so the **real** cloud
 * functions run end to end: authorisation, catalog resolution, validation,
 * persistence, completion, and the safe DTO.
 *
 * The photo endpoint is exercised differently, and deliberately: it is not a
 * cloud function but a real Express route, so these tests mount it on a real
 * server bound to an ephemeral loopback port and post real multipart bodies.
 * That is the only way multer's size limit, the signature checks, and sharp are
 * actually run rather than described.
 *
 * No database, no network beyond loopback, and no external service.
 */

import {test, describe, before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {AddressInfo} from 'node:net';
import {Server} from 'node:http';
import express = require('express');

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

interface StoredUser {
  id: string;
  attrs: Record<string, unknown>;
}

interface StoredProfile {
  id: string;
  userId: string;
  attrs: Record<string, unknown>;
  acl?: unknown;
}

interface StoredCatalogItem {
  id: string;
  attrs: Record<string, unknown>;
  acl?: unknown;
}

const store = {
  users: new Map<string, StoredUser>(),
  sessions: new Map<string, string>(),
  sessionExpiry: new Map<string, Date>(),
  roleMembers: new Map<string, Set<string>>(),
  profiles: [] as StoredProfile[],
  catalog: [] as StoredCatalogItem[],
  nextId: 1,
};

let functions: {
  getMyStudentProfile(req: unknown): Promise<unknown>;
  saveMyStudentProfile(req: unknown): Promise<unknown>;
  removeMyProfilePhoto(req: unknown): Promise<unknown>;
};
let catalogAdmin: {
  listProfileCatalogItems(req: unknown): Promise<unknown>;
  createProfileCatalogItem(req: unknown): Promise<unknown>;
  updateProfileCatalogItem(req: unknown): Promise<unknown>;
  setProfileCatalogItemActive(req: unknown): Promise<unknown>;
  deleteProfileCatalogItem(req: unknown): Promise<unknown>;
};
let catalogStudent: {getProfileCatalog(req: unknown): Promise<unknown>};
let completion: typeof import('../src/cloudCode/modules/StudentProfile/completion');
let photoRoute: typeof import('../src/cloudCode/modules/StudentProfile/photoRoute');
let seedModule: typeof import('../src/cloudCode/modules/ProfileCatalog/seed');
let saved: {Query: unknown; Role: unknown; User: unknown; Session: unknown; extend: unknown};

/** A 1x1 PNG — a real image, so signature checks and sharp both succeed. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** A 1x1 JPEG. */
const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const JPEG_BYTES = Buffer.from(JPEG_BASE64, 'base64');

function reset(): void {
  store.users.clear();
  store.sessions.clear();
  store.sessionExpiry.clear();
  store.roleMembers.clear();
  store.profiles.length = 0;
  store.catalog.length = 0;
  store.nextId = 1;
  store.roleMembers.set('Admin', new Set());
  store.roleMembers.set('Student', new Set());
}

function addUser(attrs: Record<string, unknown>): StoredUser {
  const user: StoredUser = {id: `u${store.nextId++}`, attrs: {...attrs}};
  store.users.set(user.id, user);
  return user;
}

function grantRole(role: string, userId: string): void {
  store.roleMembers.get(role)!.add(userId);
}

/** A Student with a verified email, exactly as Google sign-in leaves them. */
function makeStudent(email = 'lina@example.com'): StoredUser {
  const user = addUser({username: `gid_${store.nextId}`, email, firstName: 'Lina'});
  grantRole('Student', user.id);
  return user;
}

function makeAdmin(): StoredUser {
  const user = addUser({username: 'admin', email: 'admin@example.com'});
  grantRole('Admin', user.id);
  return user;
}

/** Issue a session token for a user, as `/loginAs` would. */
function issueSession(user: StoredUser, expiresAt?: Date): string {
  const token = `r:${user.id}${store.nextId++}`;
  store.sessions.set(token, user.id);
  if (expiresAt) store.sessionExpiry.set(token, expiresAt);
  return token;
}

/** Add a catalog item directly, as seeding or an Admin create would. */
function addCatalogItem(
  type: string,
  code: string,
  overrides: Record<string, unknown> = {}
): StoredCatalogItem {
  const item: StoredCatalogItem = {
    id: `k${store.nextId++}`,
    attrs: {
      type,
      code,
      nameEn: code,
      nameAr: `ع-${code}`,
      active: true,
      sortOrder: 10,
      ...overrides,
    },
  };
  store.catalog.push(item);
  return item;
}

/** A user handle carrying only the surface the production code touches. */
function userHandle(stored: StoredUser) {
  return {
    id: stored.id,
    get: (key: string) => stored.attrs[key],
    className: '_User',
  };
}

function request(user: StoredUser | undefined, params: Record<string, unknown> = {}) {
  return {user: user ? userHandle(user) : undefined, params};
}

interface Selections {
  city: StoredCatalogItem;
  institution: StoredCatalogItem;
  major: StoredCatalogItem;
}

/** The three required selections, created once per test. */
function seedSelections(): Selections {
  return {
    city: addCatalogItem('CITY', 'DAMASCUS'),
    institution: addCatalogItem('INSTITUTION', 'DAMASCUS_UNIVERSITY', {
      institutionKind: 'UNIVERSITY',
    }),
    major: addCatalogItem('MAJOR', 'COMPUTER_ENGINEERING'),
  };
}

function validPayload(
  selections: Selections,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    fullName: 'Lina Haddad',
    phone: '+963 944 123 456',
    cityId: selections.city.id,
    institutionId: selections.institution.id,
    majorId: selections.major.id,
    educationStatus: 'Graduate',
    ...overrides,
  };
}

/** Columns on StudentProfile that hold a catalog pointer. */
const REFERENCE_FIELDS = ['city', 'institution', 'major', 'targetRole'];

function installDoubles(): void {
  const Parse = parseSdk();
  saved = {
    Query: Parse.Query,
    Role: Parse.Role,
    User: Parse.User,
    Session: (Parse as unknown as {Session: unknown}).Session,
    extend: Parse.Object.extend,
  };

  /** Wrap a stored catalog item in a Parse-like object. */
  function catalogHandle(stored: StoredCatalogItem) {
    const handle = {
      id: stored.id,
      className: 'ProfileCatalogItem',
      attributes: stored.attrs,
      get: (key: string) => stored.attrs[key],
      set(key: string, value: unknown) {
        stored.attrs[key] = value;
        return handle;
      },
      unset(key: string) {
        delete stored.attrs[key];
        return handle;
      },
      setACL(acl: unknown) {
        stored.acl = acl;
        return handle;
      },
      getACL: () => stored.acl,
      async save() {
        return handle;
      },
      async destroy() {
        const index = store.catalog.indexOf(stored);
        if (index >= 0) store.catalog.splice(index, 1);
        return handle;
      },
    };
    return handle;
  }

  /** Wrap a stored profile in a Parse-like object. */
  function profileHandle(stored: StoredProfile) {
    const handle = {
      id: stored.id,
      className: 'StudentProfile',
      attributes: stored.attrs,
      get(key: string) {
        if (key === 'user') return {id: stored.userId, className: '_User'};
        if (REFERENCE_FIELDS.includes(key)) {
          const id = stored.attrs[key] as string | undefined;
          const item = store.catalog.find(entry => entry.id === id);
          return item ? catalogHandle(item) : undefined;
        }
        return stored.attrs[key];
      },
      set(key: string, value: unknown) {
        if (key === 'user') stored.userId = (value as {id: string}).id;
        // A pointer is stored as its id, which is what a pointer is.
        else if (REFERENCE_FIELDS.includes(key)) stored.attrs[key] = (value as {id: string}).id;
        else stored.attrs[key] = value;
        return handle;
      },
      unset(key: string) {
        delete stored.attrs[key];
        return handle;
      },
      setACL(acl: unknown) {
        stored.acl = acl;
        return handle;
      },
      getACL: () => stored.acl,
      async save() {
        return handle;
      },
    };
    return handle;
  }

  class StubQuery {
    private filters: Record<string, unknown> = {};
    private contained: {key: string; values: unknown[]} | undefined;
    constructor(private target: unknown) {}

    private get className(): string {
      if (typeof this.target === 'string') return this.target;
      if (this.target === (Parse as unknown as {Role: unknown}).Role) return '_Role';
      if (this.target === (Parse as unknown as {User: unknown}).User) return '_User';
      if (this.target === (Parse as unknown as {Session: unknown}).Session) return '_Session';
      return String((this.target as {className?: string})?.className ?? 'unknown');
    }

    equalTo(key: string, value: unknown) {
      this.filters[key] = value;
      return this;
    }
    containedIn(key: string, values: unknown[]) {
      this.contained = {key, values};
      return this;
    }
    select() {
      return this;
    }
    include() {
      return this;
    }
    limit() {
      return this;
    }
    async first() {
      return (await this.find())[0];
    }
    async count(): Promise<number> {
      return (await this.find()).length;
    }
    async find(): Promise<any[]> {
      if (this.className === 'StudentProfile') {
        const owner = this.filters['user'] as {id?: string} | undefined;
        if (owner) {
          return store.profiles
            .filter(profile => profile.userId === owner.id)
            .map(profileHandle);
        }
        // A reference count: which profiles point at this catalog item.
        for (const field of REFERENCE_FIELDS) {
          const pointer = this.filters[field] as {id?: string} | undefined;
          if (pointer) {
            return store.profiles
              .filter(profile => profile.attrs[field] === pointer.id)
              .map(profileHandle);
          }
        }
        return [];
      }

      if (this.className === 'ProfileCatalogItem') {
        let items = [...store.catalog];
        if (this.contained?.key === 'objectId') {
          const wanted = new Set(this.contained.values as string[]);
          items = items.filter(item => wanted.has(item.id));
        }
        if (typeof this.filters['objectId'] === 'string') {
          items = items.filter(item => item.id === this.filters['objectId']);
        }
        for (const key of ['type', 'code', 'active']) {
          if (this.filters[key] !== undefined) {
            items = items.filter(item => item.attrs[key] === this.filters[key]);
          }
        }
        return items.map(catalogHandle);
      }

      if (this.className === '_Session') {
        const token = this.filters['sessionToken'] as string | undefined;
        const userId = token ? store.sessions.get(token) : undefined;
        if (!userId) return [];
        const expiresAt = token ? store.sessionExpiry.get(token) : undefined;
        return [
          {
            get: (key: string) => {
              if (key === 'user') return userHandle(store.users.get(userId)!);
              if (key === 'expiresAt') return expiresAt;
              return undefined;
            },
          },
        ];
      }

      if (this.className === '_Role') {
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

  const originalExtend = Parse.Object.extend;
  (Parse.Object as unknown as {extend: unknown}).extend = (className: string) => {
    if (className === 'StudentProfile') {
      return class {
        constructor() {
          const stored: StoredProfile = {id: `p${store.nextId++}`, userId: '', attrs: {}};
          store.profiles.push(stored);
          return profileHandle(stored) as never;
        }
      };
    }
    if (className === 'ProfileCatalogItem') {
      return class {
        constructor() {
          const stored: StoredCatalogItem = {id: `k${store.nextId++}`, attrs: {}};
          store.catalog.push(stored);
          return catalogHandle(stored) as never;
        }
      };
    }
    return (originalExtend as (name: string) => unknown)(className);
  };

  (Parse as unknown as Record<string, unknown>)['Query'] = StubQuery;
}

function restoreDoubles(): void {
  const Parse = parseSdk();
  (Parse as unknown as Record<string, unknown>)['Query'] = saved.Query;
  (Parse as unknown as Record<string, unknown>)['Role'] = saved.Role;
  (Parse as unknown as Record<string, unknown>)['User'] = saved.User;
  (Parse as unknown as Record<string, unknown>)['Session'] = saved.Session;
  (Parse.Object as unknown as {extend: unknown}).extend = saved.extend;
}

// ── The photo endpoint runs on a real server ────────────────────────────────

let server: Server;
let origin: string;

before(async () => {
  installParseTestGlobal();
  await import('../src/cloudCode/models/StudentProfile');
  await import('../src/cloudCode/models/ProfileCatalogItem');

  const profileModule = await import('../src/cloudCode/modules/StudentProfile/functions');
  const ProfileFunctions = profileModule.default as unknown as new () => typeof functions;
  functions = new ProfileFunctions();

  const catalogModule = await import('../src/cloudCode/modules/ProfileCatalog/functions');
  const AdminFunctions = catalogModule.default as unknown as new () => typeof catalogAdmin;
  catalogAdmin = new AdminFunctions();
  const StudentFunctions =
    catalogModule.ProfileCatalogStudentFunctions as unknown as new () => typeof catalogStudent;
  catalogStudent = new StudentFunctions();

  completion = await import('../src/cloudCode/modules/StudentProfile/completion');
  photoRoute = await import('../src/cloudCode/modules/StudentProfile/photoRoute');
  seedModule = await import('../src/cloudCode/modules/ProfileCatalog/seed');

  const app = express();
  app.use(photoRoute.studentProfilePhotoRouter());
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  reset();
  installDoubles();
  photoRoute.resetPhotoUploadLimits();
});

afterEach(() => restoreDoubles());

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  clearTrackedIntervals();
});

/** POST an image to the real endpoint. */
async function uploadPhoto(
  token: string | undefined,
  bytes: Buffer,
  fileName = 'me.png',
  mimeType = 'image/png'
): Promise<{status: number; body: Record<string, unknown>}> {
  const form = new FormData();
  form.append(
    photoRoute.PROFILE_PHOTO_FIELD,
    new Blob([new Uint8Array(bytes)], {type: mimeType}),
    fileName
  );

  const response = await fetch(`${origin}${photoRoute.PROFILE_PHOTO_PATH}`, {
    method: 'POST',
    headers: token ? {'X-Parse-Session-Token': token} : {},
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {status: response.status, body};
}

/** GET the owner's photo from the real endpoint. */
async function readPhoto(token: string | undefined): Promise<{
  status: number;
  contentType: string | null;
  bytes: Buffer;
}> {
  const response = await fetch(`${origin}${photoRoute.PROFILE_PHOTO_PATH}`, {
    headers: token ? {'X-Parse-Session-Token': token} : {},
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {status: response.status, contentType: response.headers.get('content-type'), bytes: buffer};
}

/** Run an operation and return the stable error code it produced. */
async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as {message?: unknown}).message).split(':')[0];
  }
  throw new Error('expected the operation to fail');
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorisation
// ═══════════════════════════════════════════════════════════════════════════

describe('who may reach the profile surface', () => {
  test('a Visitor is refused', async () => {
    const code = await failureCode(() => functions.getMyStudentProfile(request(undefined)));
    assert.ok(code.length > 0);
  });

  test('an Admin is refused, not quietly given an empty profile', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() => functions.getMyStudentProfile(request(admin))),
      'NOT_A_STUDENT'
    );
  });

  test('an Admin cannot save a profile', async () => {
    const admin = makeAdmin();
    const selections = seedSelections();
    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(request(admin, validPayload(selections)))
      ),
      'NOT_A_STUDENT'
    );
    assert.equal(store.profiles.length, 0);
  });

  test('a Student is allowed', async () => {
    const student = makeStudent();
    const dto = (await functions.getMyStudentProfile(request(student))) as {verifiedEmail: string};
    assert.equal(dto.verifiedEmail, 'lina@example.com');
  });

  test('a user whose Student role was withdrawn is refused immediately', async () => {
    const student = makeStudent();
    store.roleMembers.get('Student')!.delete(student.id);
    assert.equal(
      await failureCode(() => functions.getMyStudentProfile(request(student))),
      'NOT_A_STUDENT'
    );
  });
});

describe('who may reach the catalog surface', () => {
  test('a Visitor cannot read the Student catalog', async () => {
    const code = await failureCode(() => catalogStudent.getProfileCatalog(request(undefined)));
    assert.ok(code.length > 0);
  });

  test('a Visitor cannot list catalog items as an Admin would', async () => {
    const code = await failureCode(() =>
      catalogAdmin.listProfileCatalogItems(request(undefined, {type: 'CITY'}))
    );
    assert.ok(code.length > 0);
  });

  test('a Student cannot reach the Admin operations', async () => {
    const student = makeStudent();
    for (const run of [
      () => catalogAdmin.listProfileCatalogItems(request(student, {type: 'CITY'})),
      () =>
        catalogAdmin.createProfileCatalogItem(
          request(student, {type: 'CITY', code: 'HOMS', nameEn: 'Homs', nameAr: 'حمص'})
        ),
      () => catalogAdmin.deleteProfileCatalogItem(request(student, {type: 'CITY', id: 'k1'})),
    ]) {
      assert.equal(await failureCode(run), 'Not authorized');
    }
  });

  test('an Admin cannot read the Student catalog operation', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() => catalogStudent.getProfileCatalog(request(admin))),
      'Not authorized'
    );
  });

  test('an Admin can list every category', async () => {
    const admin = makeAdmin();
    addCatalogItem('CITY', 'DAMASCUS');
    const result = (await catalogAdmin.listProfileCatalogItems(
      request(admin, {type: 'CITY'})
    )) as {items: unknown[]};
    assert.equal(result.items.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The catalog
// ═══════════════════════════════════════════════════════════════════════════

describe('the catalog type allow-list', () => {
  test('accepts exactly the four approved categories', async () => {
    const admin = makeAdmin();
    for (const type of ['CITY', 'INSTITUTION', 'MAJOR', 'TARGET_ROLE']) {
      const result = (await catalogAdmin.listProfileCatalogItems(request(admin, {type}))) as {
        type: string;
      };
      assert.equal(result.type, type);
    }
  });

  for (const type of ['StudentProfile', '_User', 'ANYTHING', '', 'city']) {
    test(`refuses the category ${JSON.stringify(type)}`, async () => {
      const admin = makeAdmin();
      assert.equal(
        await failureCode(() => catalogAdmin.listProfileCatalogItems(request(admin, {type}))),
        'CATALOG_VALIDATION_FAILED'
      );
    });
  }

  test('a missing category is refused rather than defaulted', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() => catalogAdmin.listProfileCatalogItems(request(admin, {}))),
      'CATALOG_VALIDATION_FAILED'
    );
  });

  test('a Student asking for an unknown category is refused', async () => {
    const student = makeStudent();
    assert.equal(
      await failureCode(() =>
        catalogStudent.getProfileCatalog(request(student, {types: 'CITY,SECRETS'}))
      ),
      'CATALOG_VALIDATION_FAILED'
    );
  });
});

describe('creating catalog items', () => {
  test('an Admin creates one and gets a safe DTO back', async () => {
    const admin = makeAdmin();
    const dto = (await catalogAdmin.createProfileCatalogItem(
      request(admin, {type: 'CITY', code: 'homs city', nameEn: 'Homs', nameAr: 'حمص'})
    )) as Record<string, unknown>;

    assert.equal(dto['type'], 'CITY');
    assert.equal(dto['nameEn'], 'Homs');
    // Normalised, so two spellings of the same code cannot both exist.
    assert.equal(dto['code'], 'HOMS_CITY');
    assert.equal(dto['active'], true);
    for (const forbidden of ['ACL', 'className', 'objectId', 'attributes']) {
      assert.ok(!(forbidden in dto), `${forbidden} must never appear in a catalog DTO`);
    }
  });

  test('a duplicate code within a category is refused', async () => {
    const admin = makeAdmin();
    addCatalogItem('CITY', 'HOMS');
    assert.equal(
      await failureCode(() =>
        catalogAdmin.createProfileCatalogItem(
          request(admin, {type: 'CITY', code: 'Homs', nameEn: 'Homs', nameAr: 'حمص'})
        )
      ),
      'CATALOG_DUPLICATE'
    );
  });

  test('the same code in a different category is allowed', async () => {
    const admin = makeAdmin();
    addCatalogItem('CITY', 'DESIGN');
    const dto = (await catalogAdmin.createProfileCatalogItem(
      request(admin, {type: 'MAJOR', code: 'DESIGN', nameEn: 'Design', nameAr: 'تصميم'})
    )) as {code: string};
    assert.equal(dto.code, 'DESIGN');
  });

  test('both names are required', async () => {
    const admin = makeAdmin();
    for (const missing of ['nameEn', 'nameAr']) {
      const params: Record<string, unknown> = {
        type: 'CITY',
        code: 'HOMS',
        nameEn: 'Homs',
        nameAr: 'حمص',
      };
      params[missing] = '';
      assert.equal(
        await failureCode(() => catalogAdmin.createProfileCatalogItem(request(admin, params))),
        'CATALOG_VALIDATION_FAILED'
      );
    }
  });

  test('an institution must declare its kind', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() =>
        catalogAdmin.createProfileCatalogItem(
          request(admin, {type: 'INSTITUTION', code: 'X_UNI', nameEn: 'X', nameAr: 'س'})
        )
      ),
      'CATALOG_VALIDATION_FAILED'
    );
  });

  test('a city may not carry an institution kind', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() =>
        catalogAdmin.createProfileCatalogItem(
          request(admin, {
            type: 'CITY',
            code: 'HOMS',
            nameEn: 'Homs',
            nameAr: 'حمص',
            institutionKind: 'UNIVERSITY',
          })
        )
      ),
      'CATALOG_VALIDATION_FAILED'
    );
  });

  test('only an institution may be the Other escape hatch', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() =>
        catalogAdmin.createProfileCatalogItem(
          request(admin, {
            type: 'CITY',
            code: 'OTHER',
            nameEn: 'Other',
            nameAr: 'أخرى',
            isOther: true,
          })
        )
      ),
      'CATALOG_VALIDATION_FAILED'
    );

    const dto = (await catalogAdmin.createProfileCatalogItem(
      request(admin, {
        type: 'INSTITUTION',
        code: 'OTHER',
        nameEn: 'Other',
        nameAr: 'أخرى',
        institutionKind: 'OTHER',
        isOther: true,
      })
    )) as {isOther?: boolean};
    assert.equal(dto.isOther, true);
  });

  test('a privileged field in the payload is refused', async () => {
    const admin = makeAdmin();
    assert.equal(
      await failureCode(() =>
        catalogAdmin.createProfileCatalogItem(
          request(admin, {
            type: 'CITY',
            code: 'HOMS',
            nameEn: 'Homs',
            nameAr: 'حمص',
            objectId: 'k1',
          })
        )
      ),
      'CATALOG_VALIDATION_FAILED'
    );
  });
});

describe('editing catalog items', () => {
  test('a category cannot be changed after creation', async () => {
    const admin = makeAdmin();
    const item = addCatalogItem('CITY', 'HOMS');

    // Addressed by id **and** category, so a mismatched pair does not resolve.
    assert.equal(
      await failureCode(() =>
        catalogAdmin.updateProfileCatalogItem(
          request(admin, {
            id: item.id,
            type: 'MAJOR',
            code: 'HOMS',
            nameEn: 'Homs',
            nameAr: 'حمص',
          })
        )
      ),
      'CATALOG_NOT_FOUND'
    );
    assert.equal(item.attrs['type'], 'CITY');
  });

  test('an id from another category does not resolve', async () => {
    const admin = makeAdmin();
    const major = addCatalogItem('MAJOR', 'DESIGN');
    assert.equal(
      await failureCode(() =>
        catalogAdmin.updateProfileCatalogItem(
          request(admin, {id: major.id, type: 'CITY', code: 'X_CITY', nameEn: 'X', nameAr: 'س'})
        )
      ),
      'CATALOG_NOT_FOUND'
    );
  });

  test('a rename takes effect and stays unique', async () => {
    const admin = makeAdmin();
    const item = addCatalogItem('CITY', 'HOMS');
    addCatalogItem('CITY', 'HAMA');

    const dto = (await catalogAdmin.updateProfileCatalogItem(
      request(admin, {id: item.id, type: 'CITY', code: 'HOMS', nameEn: 'Homs City', nameAr: 'حمص'})
    )) as {nameEn: string};
    assert.equal(dto.nameEn, 'Homs City');

    assert.equal(
      await failureCode(() =>
        catalogAdmin.updateProfileCatalogItem(
          request(admin, {id: item.id, type: 'CITY', code: 'HAMA', nameEn: 'x', nameAr: 'س'})
        )
      ),
      'CATALOG_DUPLICATE'
    );
  });
});

describe('activation and deletion', () => {
  test('an unused item is deleted', async () => {
    const admin = makeAdmin();
    const item = addCatalogItem('CITY', 'HOMS');

    const result = (await catalogAdmin.deleteProfileCatalogItem(
      request(admin, {id: item.id, type: 'CITY'})
    )) as {deleted: boolean};
    assert.equal(result.deleted, true);
    assert.equal(store.catalog.length, 0);
  });

  test('a referenced item cannot be deleted', async () => {
    const admin = makeAdmin();
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    assert.equal(
      await failureCode(() =>
        catalogAdmin.deleteProfileCatalogItem(request(admin, {id: selections.city.id, type: 'CITY'}))
      ),
      'CATALOG_IN_USE'
    );
    // Nothing was cascaded or blanked.
    assert.equal(store.profiles[0].attrs['city'], selections.city.id);
  });

  test('a referenced item may be deactivated instead', async () => {
    const admin = makeAdmin();
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    const dto = (await catalogAdmin.setProfileCatalogItemActive(
      request(admin, {id: selections.city.id, type: 'CITY', active: false})
    )) as {active: boolean};
    assert.equal(dto.active, false);
  });

  test('a deactivated item disappears from the Student catalog', async () => {
    const student = makeStudent();
    const admin = makeAdmin();
    const item = addCatalogItem('CITY', 'HOMS');

    let catalog = (await catalogStudent.getProfileCatalog(request(student, {types: 'CITY'}))) as {
      CITY: unknown[];
    };
    assert.equal(catalog.CITY.length, 1);

    await catalogAdmin.setProfileCatalogItemActive(
      request(admin, {id: item.id, type: 'CITY', active: false})
    );

    catalog = (await catalogStudent.getProfileCatalog(request(student, {types: 'CITY'}))) as {
      CITY: unknown[];
    };
    assert.equal(catalog.CITY.length, 0);
  });

  test('an Admin still sees a deactivated item', async () => {
    const admin = makeAdmin();
    const item = addCatalogItem('CITY', 'HOMS', {active: false});
    const result = (await catalogAdmin.listProfileCatalogItems(request(admin, {type: 'CITY'}))) as {
      items: {id: string; active: boolean}[];
    };
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, item.id);
    assert.equal(result.items[0].active, false);
  });
});

describe('the Student catalog read', () => {
  test('returns all four categories by default', async () => {
    const student = makeStudent();
    seedSelections();
    addCatalogItem('TARGET_ROLE', 'FRONTEND');

    const catalog = (await catalogStudent.getProfileCatalog(request(student))) as Record<
      string,
      unknown[]
    >;
    assert.deepEqual(Object.keys(catalog).sort(), [
      'CITY',
      'INSTITUTION',
      'MAJOR',
      'TARGET_ROLE',
    ]);
  });

  test('returns only active items', async () => {
    const student = makeStudent();
    addCatalogItem('CITY', 'A_CITY');
    addCatalogItem('CITY', 'B_CITY', {active: false});

    const catalog = (await catalogStudent.getProfileCatalog(request(student, {types: 'CITY'}))) as {
      CITY: {code: string}[];
    };
    assert.deepEqual(
      catalog.CITY.map(item => item.code),
      ['A_CITY']
    );
  });

  test('sorts by sortOrder, then by the localised name', async () => {
    const student = makeStudent();
    addCatalogItem('CITY', 'Z_LAST', {sortOrder: 20, nameEn: 'Zebra'});
    addCatalogItem('CITY', 'B_FIRST', {sortOrder: 10, nameEn: 'Beta'});
    addCatalogItem('CITY', 'A_FIRST', {sortOrder: 10, nameEn: 'Alpha'});

    const catalog = (await catalogStudent.getProfileCatalog(
      request(student, {types: 'CITY', lang: 'en'})
    )) as {CITY: {nameEn: string}[]};
    assert.deepEqual(
      catalog.CITY.map(item => item.nameEn),
      ['Alpha', 'Beta', 'Zebra']
    );
  });

  test('carries no ACL, class name, or raw Parse internals', async () => {
    const student = makeStudent();
    addCatalogItem('CITY', 'HOMS');

    const catalog = (await catalogStudent.getProfileCatalog(request(student, {types: 'CITY'}))) as {
      CITY: Record<string, unknown>[];
    };
    assert.deepEqual(Object.keys(catalog.CITY[0]).sort(), [
      'active',
      'code',
      'id',
      'nameAr',
      'nameEn',
      'sortOrder',
      'type',
    ]);
  });

  test('an empty category comes back empty rather than absent', async () => {
    const student = makeStudent();
    const catalog = (await catalogStudent.getProfileCatalog(request(student))) as Record<
      string,
      unknown[]
    >;
    for (const type of ['CITY', 'INSTITUTION', 'MAJOR', 'TARGET_ROLE']) {
      assert.deepEqual(catalog[type], []);
    }
  });
});

describe('institution seeding', () => {
  test('creates the Checkpoint 3A list once and never twice', async () => {
    const first = await seedModule.seedInstitutionCatalog();
    assert.equal(first.created, seedModule.SEED_INSTITUTIONS.length);

    const second = await seedModule.seedInstitutionCatalog();
    assert.equal(second.created, 0);
    assert.equal(store.catalog.length, seedModule.SEED_INSTITUTIONS.length);
  });

  test('every seeded institution carries both names and a kind', () => {
    for (const values of seedModule.seedInstitutionValues()) {
      assert.equal(values.type, 'INSTITUTION');
      assert.ok(values.nameEn.length > 0, 'an English name is required');
      assert.ok(values.nameAr.length > 0, 'an Arabic name is required');
      assert.ok(['UNIVERSITY', 'INSTITUTE', 'OTHER'].includes(String(values.institutionKind)));
      assert.ok(/^[A-Z0-9][A-Z0-9_]*$/.test(values.code), `bad code: ${values.code}`);
    }
  });

  test('exactly one seeded institution is the Other escape hatch, and it is last', () => {
    const values = seedModule.seedInstitutionValues();
    const others = values.filter(entry => entry.isOther);
    assert.equal(others.length, 1);
    assert.equal(values[values.length - 1].code, others[0].code);
  });

  test('no city, major, or target role is invented', async () => {
    await seedModule.seedInstitutionCatalog();
    for (const type of ['CITY', 'MAJOR', 'TARGET_ROLE']) {
      assert.equal(store.catalog.filter(item => item.attrs['type'] === type).length, 0);
    }
  });

  test('an Admin edit survives a re-seed', async () => {
    await seedModule.seedInstitutionCatalog();
    const admin = makeAdmin();
    const item = store.catalog[0];

    await catalogAdmin.updateProfileCatalogItem(
      request(admin, {
        id: item.id,
        type: 'INSTITUTION',
        code: String(item.attrs['code']),
        nameEn: 'Renamed By Admin',
        nameAr: 'مُعاد التسمية',
        institutionKind: 'UNIVERSITY',
      })
    );

    await seedModule.seedInstitutionCatalog();
    assert.equal(item.attrs['nameEn'], 'Renamed By Admin');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Saving a profile against the catalog
// ═══════════════════════════════════════════════════════════════════════════

describe('first save', () => {
  test('creates exactly one profile and stores catalog pointers', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections))
    )) as {city?: {id: string; nameEn: string}; isComplete: boolean};

    assert.equal(store.profiles.length, 1);
    assert.equal(store.profiles[0].attrs['city'], selections.city.id);
    // The DTO carries the resolved item, not a bare id and not a raw pointer.
    assert.equal(dto.city?.id, selections.city.id);
    assert.equal(dto.city?.nameEn, 'DAMASCUS');
    assert.equal(dto.isComplete, true);
  });

  test('derives the verified email from the session, not the request', async () => {
    const student = makeStudent('real@example.com');
    const selections = seedSelections();

    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {verifiedEmail: 'attacker@example.com'}))
        )
      ),
      'VALIDATION_FAILED'
    );

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections))
    )) as {verifiedEmail: string};
    assert.equal(dto.verifiedEmail, 'real@example.com');
  });

  test('refuses a name sent in place of an id', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    for (const field of ['city', 'institution', 'major', 'targetRole']) {
      assert.equal(
        await failureCode(() =>
          functions.saveMyStudentProfile(
            request(student, validPayload(selections, {[field]: 'Damascus'}))
          )
        ),
        'VALIDATION_FAILED',
        `${field} must be refused as a name`
      );
    }
  });

  test('the owning ACL grants read to the Student and nobody else', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    const acl = store.profiles[0].acl as Parse.ACL;
    assert.equal(acl.getPublicReadAccess(), false);
    assert.equal(acl.getPublicWriteAccess(), false);
    assert.equal(acl.getReadAccess(student.id), true);
    // Read only: a Student edits by calling the operation, never by writing.
    assert.equal(acl.getWriteAccess(student.id), false);
  });
});

describe('catalog references are validated server-side', () => {
  test('each required selection must be present', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    for (const field of ['cityId', 'institutionId', 'majorId']) {
      assert.equal(
        await failureCode(() =>
          functions.saveMyStudentProfile(request(student, validPayload(selections, {[field]: ''})))
        ),
        'VALIDATION_FAILED',
        `${field} must be required`
      );
    }
  });

  test('an unknown id is refused', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(request(student, validPayload(selections, {cityId: 'nope'})))
      ),
      'VALIDATION_FAILED'
    );
  });

  test('an id from the wrong category is refused', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {cityId: selections.major.id}))
        )
      ),
      'VALIDATION_FAILED'
    );
  });

  test('a newly chosen inactive item is refused', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const retired = addCatalogItem('CITY', 'RETIRED', {active: false});

    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {cityId: retired.id}))
        )
      ),
      'VALIDATION_FAILED'
    );
  });

  test('an already-chosen item stays valid after it is retired', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    // An Admin retires the city this Student already chose.
    selections.city.attrs['active'] = false;

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {fullName: 'Lina H'}))
    )) as {city?: {active: boolean}; isComplete: boolean};

    assert.equal(dto.city?.active, false);
    assert.equal(dto.isComplete, true, 'a retired value must not un-complete a profile');
  });

  test('but it can only be changed to an active one', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    const retired = addCatalogItem('CITY', 'ALSO_RETIRED', {active: false});
    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {cityId: retired.id}))
        )
      ),
      'VALIDATION_FAILED'
    );
  });
});

describe('the Other institution', () => {
  test('demands a typed name', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const other = addCatalogItem('INSTITUTION', 'OTHER', {
      institutionKind: 'OTHER',
      isOther: true,
    });

    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {institutionId: other.id}))
        )
      ),
      'VALIDATION_FAILED'
    );

    const dto = (await functions.saveMyStudentProfile(
      request(
        student,
        validPayload(selections, {
          institutionId: other.id,
          customInstitutionName: 'Aleppo Technical Institute',
        })
      )
    )) as {customInstitutionName?: string; isComplete: boolean};
    assert.equal(dto.customInstitutionName, 'Aleppo Technical Institute');
    assert.equal(dto.isComplete, true);
  });

  test('an ordinary institution drops any typed name', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {customInstitutionName: 'Left over'}))
    )) as {customInstitutionName?: string};
    assert.equal(dto.customInstitutionName, undefined);
  });
});

describe('the optional target role', () => {
  test('a profile is complete without one', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections))
    )) as {isComplete: boolean; targetRole?: unknown};
    assert.equal(dto.isComplete, true);
    assert.equal(dto.targetRole, undefined);
  });

  test('a chosen role comes back resolved', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const role = addCatalogItem('TARGET_ROLE', 'FRONTEND', {nameEn: 'Frontend Developer'});

    const dto = (await functions.saveMyStudentProfile(
      request(
        student,
        validPayload(selections, {
          targetRoleId: role.id,
          targetRoleReason: 'I enjoy building interfaces.',
        })
      )
    )) as {targetRole?: {nameEn: string}; targetRoleReason?: string; isComplete: boolean};

    assert.equal(dto.targetRole?.nameEn, 'Frontend Developer');
    assert.equal(dto.targetRoleReason, 'I enjoy building interfaces.');
    assert.equal(dto.isComplete, true);
  });

  test('the reason is dropped when the role is cleared', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const role = addCatalogItem('TARGET_ROLE', 'FRONTEND');

    await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {targetRoleId: role.id, targetRoleReason: 'Why'}))
    );

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {targetRoleReason: 'Left over'}))
    )) as {targetRole?: unknown; targetRoleReason?: string};

    assert.equal(dto.targetRole, undefined);
    assert.equal(dto.targetRoleReason, undefined);
    assert.equal(store.profiles[0].attrs['targetRoleReason'], undefined);
  });

  test('an overlong reason is refused', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const role = addCatalogItem('TARGET_ROLE', 'FRONTEND');

    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(
            student,
            validPayload(selections, {targetRoleId: role.id, targetRoleReason: 'x'.repeat(501)})
          )
        )
      ),
      'VALIDATION_FAILED'
    );
  });

  test('neither the role nor its reason affects completion', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const role = addCatalogItem('TARGET_ROLE', 'FRONTEND');

    const withRole = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {targetRoleId: role.id}))
    )) as {isComplete: boolean};
    const withoutRole = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections))
    )) as {isComplete: boolean};

    assert.equal(withRole.isComplete, true);
    assert.equal(withoutRole.isComplete, true);
  });
});

describe('graduation normalisation', () => {
  test('a month becomes the first of that month at 00:00 UTC', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    await functions.saveMyStudentProfile(
      request(
        student,
        validPayload(selections, {
          educationStatus: 'Current Student',
          expectedGraduationMonth: '2027-06',
        })
      )
    );

    const stored = store.profiles[0].attrs['expectedGraduationDate'] as Date;
    assert.equal(stored.toISOString(), '2027-06-01T00:00:00.000Z');
  });

  test('a Current Student must supply one', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    assert.equal(
      await failureCode(() =>
        functions.saveMyStudentProfile(
          request(student, validPayload(selections, {educationStatus: 'Current Student'}))
        )
      ),
      'VALIDATION_FAILED'
    );
  });

  test('switching to Graduate clears a stored month', async () => {
    const student = makeStudent();
    const selections = seedSelections();

    await functions.saveMyStudentProfile(
      request(
        student,
        validPayload(selections, {
          educationStatus: 'Current Student',
          expectedGraduationMonth: '2027-06',
        })
      )
    );
    assert.ok(store.profiles[0].attrs['expectedGraduationDate']);

    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {expectedGraduationMonth: '2027-06'}))
    )) as {expectedGraduationMonth?: string};

    assert.equal(store.profiles[0].attrs['expectedGraduationDate'], undefined);
    assert.equal(dto.expectedGraduationMonth, undefined);
  });
});

describe('updating a profile', () => {
  test('reuses the same record', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));
    const first = store.profiles[0].id;

    await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {fullName: 'Lina H'}))
    );
    assert.equal(store.profiles.length, 1);
    assert.equal(store.profiles[0].id, first);
  });

  test('never creates a second profile for one Student', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    for (let attempt = 0; attempt < 3; attempt++) {
      await functions.saveMyStudentProfile(request(student, validPayload(selections)));
    }
    assert.equal(store.profiles.length, 1);
  });

  test('the owner never changes', async () => {
    const student = makeStudent();
    const other = makeStudent('other@example.com');
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    await failureCode(() =>
      functions.saveMyStudentProfile(request(student, validPayload(selections, {user: other.id})))
    );
    assert.equal(store.profiles[0].userId, student.id);
  });

  test('clearing an optional field really clears it', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(
      request(student, validPayload(selections, {careerGoal: 'Ship good software.'}))
    );
    assert.ok(store.profiles[0].attrs['careerGoal']);

    await functions.saveMyStudentProfile(request(student, validPayload(selections)));
    assert.equal(store.profiles[0].attrs['careerGoal'], undefined);
  });
});

describe('one Student cannot reach another', () => {
  test('each Student sees only their own profile', async () => {
    const lina = makeStudent('lina@example.com');
    const omar = makeStudent('omar@example.com');
    const selections = seedSelections();

    await functions.saveMyStudentProfile(request(lina, validPayload(selections)));

    const dto = (await functions.getMyStudentProfile(request(omar))) as {
      id: string;
      verifiedEmail: string;
    };
    assert.equal(dto.id, '');
    assert.equal(dto.verifiedEmail, 'omar@example.com');
  });

  test('no operation reads a profile id from the request', () => {
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(functions))) {
      if (name === 'constructor') continue;
      const body = String((functions as unknown as Record<string, () => unknown>)[name]);
      assert.ok(!/profileId/.test(body), `${name} must not read a profileId`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The photo endpoint — a real server, real multipart, real sharp
// ═══════════════════════════════════════════════════════════════════════════

describe('the photo endpoint', () => {
  async function studentWithProfile(email = 'lina@example.com') {
    const student = makeStudent(email);
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));
    return {student, token: issueSession(student), selections};
  }

  test('refuses a request with no session token', async () => {
    assert.equal((await uploadPhoto(undefined, PNG_BYTES)).status, 401);
  });

  test('refuses an unknown session token', async () => {
    assert.equal((await uploadPhoto('r:not-a-real-token', PNG_BYTES)).status, 401);
  });

  test('refuses an expired session', async () => {
    const student = makeStudent();
    const token = issueSession(student, new Date(Date.now() - 1000));
    assert.equal((await uploadPhoto(token, PNG_BYTES)).status, 401);
  });

  test('refuses an Admin', async () => {
    const admin = makeAdmin();
    const result = await uploadPhoto(issueSession(admin), PNG_BYTES);
    assert.equal(result.status, 403);
    assert.equal(result.body['error'], 'NOT_A_STUDENT');
  });

  test('refuses a Student whose profile does not exist yet', async () => {
    // The form saves first for exactly this reason.
    const student = makeStudent();
    const result = await uploadPhoto(issueSession(student), PNG_BYTES);
    assert.equal(result.status, 400);
    assert.equal(result.body['error'], 'PROFILE_UNAVAILABLE');
  });

  test('accepts a real PNG once the profile exists, and re-encodes it to WebP', async () => {
    const {token} = await studentWithProfile();
    const result = await uploadPhoto(token, PNG_BYTES);

    assert.equal(result.status, 200);
    assert.equal(result.body['mimeType'], 'image/webp');
    assert.ok(Number(result.body['bytes']) > 0);

    const bytes = Buffer.from(store.profiles[0].attrs['photoData'] as string, 'base64');
    // A real WebP: "RIFF" .... "WEBP".
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  });

  test('accepts a real JPEG', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await uploadPhoto(token, JPEG_BYTES, 'me.jpg', 'image/jpeg')).status, 200);
  });

  test('the whole first-save flow works: save, then upload, then read', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const token = issueSession(student);

    // 1. The profile does not exist, so an upload now would be refused.
    assert.equal((await uploadPhoto(token, PNG_BYTES)).body['error'], 'PROFILE_UNAVAILABLE');

    // 2. Save creates it.
    const dto = (await functions.saveMyStudentProfile(
      request(student, validPayload(selections))
    )) as {isComplete: boolean; hasPhoto: boolean};
    assert.equal(dto.isComplete, true);
    assert.equal(dto.hasPhoto, false);

    // 3. The upload now succeeds — no PROFILE_UNAVAILABLE anywhere in the
    //    order the form actually uses.
    assert.equal((await uploadPhoto(token, PNG_BYTES)).status, 200);

    // 4. And the owner can read it back.
    const read = await readPhoto(token);
    assert.equal(read.status, 200);
    assert.equal(read.contentType, 'image/webp');
    assert.equal(read.bytes.toString('ascii', 0, 4), 'RIFF');

    // 5. The profile reports it without ever carrying the bytes.
    const refreshed = (await functions.getMyStudentProfile(request(student))) as Record<
      string,
      unknown
    >;
    assert.equal(refreshed['hasPhoto'], true);
    assert.equal(refreshed['photoData'], undefined);
  });

  test('a failed upload leaves the saved profile untouched', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    const token = issueSession(student);
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    const before = {...store.profiles[0].attrs};
    const result = await uploadPhoto(token, Buffer.from('<?php echo 1; ?>'), 'x.png', 'image/png');
    assert.equal(result.status, 400);
    assert.equal(result.body['error'], 'PHOTO_REJECTED');

    // Every profile field is exactly as it was; nothing was rolled back
    // because nothing needed to be.
    assert.equal(store.profiles[0].attrs['fullName'], before['fullName']);
    assert.equal(store.profiles[0].attrs['isComplete'], before['isComplete']);
    assert.equal(store.profiles[0].attrs['photoData'], undefined);
  });

  test('rejects a file whose bytes contradict its declared type', async () => {
    const {token} = await studentWithProfile();
    // A PNG magic-byte prefix on a script — the disguise a MIME check misses.
    const disguised = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<?php system($_GET["c"]); ?>'),
    ]);
    const result = await uploadPhoto(token, disguised, 'shell.png', 'image/png');
    assert.equal(result.status, 400);
    assert.equal(result.body['error'], 'PHOTO_REJECTED');
  });

  test('rejects a real PNG declared as a JPEG', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await uploadPhoto(token, PNG_BYTES, 'me.jpg', 'image/jpeg')).status, 400);
  });

  test('rejects a disallowed extension even with a valid MIME type', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await uploadPhoto(token, PNG_BYTES, 'me.php', 'image/png')).status, 400);
  });

  test('rejects a disallowed MIME type', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await uploadPhoto(token, PNG_BYTES, 'me.svg', 'image/svg+xml')).status, 400);
  });

  test('rejects an empty upload', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await uploadPhoto(token, Buffer.alloc(0))).status, 400);
  });

  test('rejects an oversized upload at the socket, before decoding', async () => {
    const {token} = await studentWithProfile();
    // 6 MiB: multer stops the stream at the 5 MiB limit, so sharp is never
    // reached and the whole payload is never held.
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(6 * 1024 * 1024)]);
    const result = await uploadPhoto(token, oversized);
    assert.equal(result.status, 400);
    assert.equal(result.body['error'], 'PHOTO_REJECTED');
    assert.equal(store.profiles[0].attrs['photoData'], undefined);
  });

  test('replacing a photo leaves no trace of the previous one', async () => {
    const {token} = await studentWithProfile();
    await uploadPhoto(token, PNG_BYTES);
    const first = store.profiles[0].attrs['photoData'];

    await uploadPhoto(token, JPEG_BYTES, 'me.jpg', 'image/jpeg');
    const second = store.profiles[0].attrs['photoData'];

    assert.ok(second);
    assert.notEqual(first, second);
  });

  test('another Student cannot read it', async () => {
    const {token} = await studentWithProfile('lina@example.com');
    await uploadPhoto(token, PNG_BYTES);

    const omar = makeStudent('omar@example.com');
    assert.equal((await readPhoto(issueSession(omar))).status, 404);
  });

  test('the response is never cacheable and never sniffable', async () => {
    const {token} = await studentWithProfile();
    await uploadPhoto(token, PNG_BYTES);
    const response = await fetch(`${origin}${photoRoute.PROFILE_PHOTO_PATH}`, {
      headers: {'X-Parse-Session-Token': token},
    });
    await response.arrayBuffer();

    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('asking for a photo that does not exist fails safely', async () => {
    const {token} = await studentWithProfile();
    assert.equal((await readPhoto(token)).status, 404);
  });

  test('no response ever carries a URL or a storage path', async () => {
    const {token} = await studentWithProfile();
    const upload = await uploadPhoto(token, PNG_BYTES);
    const serialised = JSON.stringify(upload.body).toLowerCase();

    for (const forbidden of ['http', 'url', 'path', 'files/', 'photodata']) {
      assert.ok(
        !serialised.includes(forbidden),
        `${forbidden} must never appear in a photo response`
      );
    }
  });

  test('the upload rate limit holds', async () => {
    const {token} = await studentWithProfile();
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await uploadPhoto(token, PNG_BYTES)).status, 200, `attempt ${attempt}`);
    }
    assert.equal((await uploadPhoto(token, PNG_BYTES)).status, 429);
  });

  test('removing a photo clears the stored bytes', async () => {
    const {student, token} = await studentWithProfile();
    await uploadPhoto(token, PNG_BYTES);
    assert.ok(store.profiles[0].attrs['photoData']);

    const dto = (await functions.removeMyProfilePhoto(request(student))) as {hasPhoto: boolean};
    assert.equal(dto.hasPhoto, false);
    assert.equal(store.profiles[0].attrs['photoData'], undefined);
    assert.equal(store.profiles[0].attrs['photoUpdatedAt'], undefined);

    assert.equal((await readPhoto(token)).status, 404);
  });

  test('the DTO never carries the bytes themselves', async () => {
    const {student, token} = await studentWithProfile();
    await uploadPhoto(token, PNG_BYTES);

    const dto = (await functions.getMyStudentProfile(request(student))) as Record<string, unknown>;
    assert.equal(dto['hasPhoto'], true);
    for (const forbidden of ['photoData', 'photo', 'photoUpdatedAt', 'url', 'file']) {
      assert.equal(dto[forbidden], undefined, `${forbidden} must never appear in the DTO`);
    }
    // The cache key is opaque and cannot be turned into an address.
    assert.match(String(dto['photoVersion']), /^p\d+-\d+$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Completion as the session sees it
// ═══════════════════════════════════════════════════════════════════════════

describe('the session completion flag', () => {
  test('is undefined for an Admin, whose profile does not exist rather than being incomplete', async () => {
    const admin = makeAdmin();
    const result = await completion.isProfileComplete(
      userHandle(admin) as unknown as Parse.User,
      ['Admin'] as never
    );
    assert.equal(result, undefined);
  });

  test('is false for a Student who has not saved', async () => {
    const student = makeStudent();
    const result = await completion.isProfileComplete(
      userHandle(student) as unknown as Parse.User,
      ['Student'] as never
    );
    assert.equal(result, false);
  });

  test('is true once the server says the profile is complete', async () => {
    const student = makeStudent();
    const selections = seedSelections();
    await functions.saveMyStudentProfile(request(student, validPayload(selections)));

    const result = await completion.isProfileComplete(
      userHandle(student) as unknown as Parse.User,
      ['Student'] as never
    );
    assert.equal(result, true);
  });
});
