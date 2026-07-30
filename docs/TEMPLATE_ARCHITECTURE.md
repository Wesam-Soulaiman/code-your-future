# Template Architecture

What this codebase actually is, traced from source. The template baseline was recorded at
commit `c1517e4`; **Checkpoint 1 changes are folded in and marked ⟨CP1⟩**. Every claim was
verified against source or observed at runtime — not taken from README.

Planned Code Your Future models and features are marked **Not implemented**.

> ⟨CP1⟩ summary — what changed from the template: `AppSettings` removed; roles are now
> `Admin`/`Student`; `_User`, `File`, and `IMG` are deny-by-default; a repository-owned
> schema guard neutralises the kit's public-wildcard ACL fallback; user management retired
> down to login / current-user / logout; master key restricted to localhost; anonymous users
> and direct file upload disabled; raw file routes blocked; all logging routed through a
> recursive redaction boundary; DTOs are hand-built allow-lists; and both test suites exist.

---

## 1. Repository map

```
code-your-future/
├── package.json                 root orchestration (concurrently)
├── pnpm-lock.yaml               TRACKED (root project: concurrently only)
├── create-project.js            standalone template-cloning bootstrapper (290 lines)
├── .gitlab-ci.yml               CI: build+deploy on branch `dev`
├── .claude/settings.json        90soft-toolkit plugin enrolment (protected)
├── CLAUDE.md / PROJECT.md / GENERATE.md / README.md
├── docs/                        five context documents — TRACKED
│   └── prototypes/              index.html (1278 L), slides.html (1005 L) — TRACKED, read-only refs
├── backend/
│   ├── package.json             Parse Server 9.x + Express 5 + TS 5.2 (+ `test` script ⟨CP1⟩)
│   ├── test/                    ⟨CP1⟩ node:test suites (131 tests)
│   ├── pnpm-lock.yaml           TRACKED
│   ├── pnpm-workspace.yaml      allowBuilds decisions (see §14)
│   ├── tsconfig.json            extends gts/tsconfig-google.json
│   ├── setup.js                 interactive .env generator
│   ├── .env                     UNTRACKED (git-ignored) — 12 keys
│   ├── dashboard.json           UNTRACKED (git-ignored)
│   └── src/
│       ├── app.ts               Express + Parse Server bootstrap
│       ├── types/web-push.d.ts
│       └── cloudCode/
│           ├── main.ts          Cloud Code entry (auto-imports models + modules)
│           ├── cron.ts          empty CronJobs class
│           ├── database/seed.ts ⟨CP1⟩ role seeding + legacy migration + stale reporting
│           ├── models/          ⟨CP1⟩ File, IMG, User  (AppSettings deleted)
│           ├── modules/         ⟨CP1⟩ User/functions.ts only
│           └── utils/           auth/authorize ⟨CP1⟩, config/{parseConfig,env,schemaGuard} ⟨CP1⟩,
│                                constants/roles ⟨CP1⟩, dto/userDto ⟨CP1⟩,
│                                logging/{redact,safeLogger} ⟨CP1⟩,
│                                fileAdapter, handleFile, handleImage,
│                                imageProcessing, sharedGetFields
└── frontend/
    ├── angular.json             project `code-your-future-frontend`
    ├── package.json             Angular 21 + PrimeNG 21 + Tailwind 4 + vitest
    ├── pnpm-lock.yaml           TRACKED
    ├── tsconfig{,.app,.spec}.json
    ├── public/                  i18n/{en,ar}.json, Cairo fonts, images/empty-grid.svg, sw-push.js
    └── src/
        ├── main.ts, index.html, styles.css (482 L)
        ├── environments/environment{,.prod}.ts
        └── app/
            ├── app.ts, app.config.ts, app.routes.ts, theme.ts
            ├── components/layout/shell.component.*
            ├── components/shared/  data-table (1051 L), base-dialog,
            │                       image-uploader, image-cropper-dialog
            ├── config/user-roles.ts
            ├── directives/if-role.directive.ts
            ├── guards/auth.guard.ts, role.guard.ts
            ├── models/User.ts, IMG.ts, public/MultiLang.ts
            ├── pages/auth, pages/dashboard   ⟨CP1⟩ pages/users removed
            ├── pipes/relative-time.pipe.ts, time12h.pipe.ts
            ├── services/          api.ts, http.interceptor.ts, session.service.ts,
            │                      live-query.service.ts, change-lang, switch-theme,
            │                      toast, confirm, export, page-title, shared-vars,
            │                      dataService/user-service.ts
            └── utils/catchError.ts, palette-generator.ts
```

**Tracked at `a796aa0`: 133 files.** ⟨CP1⟩ adds 13 source/test files and removes 3
(`models/AppSettings.ts`, `modules/AppSettings/functions.ts`, `pages/users/*`). Test files:
**197 tests across two suites** (131 backend, 66 frontend), where the template had none.

## 2. Root orchestration

`package.json` (name `code-your-future`, private):

| Script | Command |
|---|---|
| `start` | `concurrently -n backend,frontend "pnpm run start:backend" "pnpm run start:frontend"` |
| `dev` | `concurrently -n backend,frontend "pnpm run dev:backend" "pnpm run start:frontend"` |
| `start:backend` | `cd backend && pnpm run start` |
| `dev:backend` | `cd backend && pnpm run dev` |
| `start:frontend` | `cd frontend && pnpm run start` |
| `build:frontend` | `cd frontend && pnpm run build` |
| `install:all` | `cd backend && pnpm install && cd ../frontend && pnpm install --shamefully-hoist` |
| `setup` | `cd backend && pnpm run setup` |

There is **no root `test` script** and no root build for the backend.

Backend scripts (`backend/package.json`):

| Script | Command |
|---|---|
| `compile` | ⟨CP1⟩ `rimraf build && tsc` |
| `test` | ⟨CP1⟩ `rimraf build && tsc && node --test "build/test/*.test.js"` |
| `watch` | `tsc --watch` |
| `clean` | `rimraf build` |
| `start` | `rimraf build && tsc && node --max-old-space-size=1024 ./build/src/app.js` |
| `dev` | `nodemon --watch src --ext ts --exec "npx kill-port 1337 && rimraf build && tsc && node … app.js" && npm run db` |
| `setup` | `node setup.js` |
| `db` | `parse-dashboard --config backend/dashboard.json` |
| `deploy` | `node deploy.js` |

Frontend scripts: `start` → `ng serve`, `build` → `ng build` (defaults to `production`),
`test` → `ng test`, `watch`, `ng`.

⟨CP1⟩ **`compile` and `test` now clean `build/` first.** Plain `tsc` does not delete orphaned
output, so after `models/AppSettings.ts` was removed the stale `build/src/.../AppSettings.js`
kept being auto-discovered and re-registered at runtime. Runtime validation caught it; the
`rimraf` prefix makes the class of bug impossible.

⟨CP1⟩ The backend test suite uses Node's built-in `node:test` — **no new dependency**, so the
committed lockfiles stay valid under `--frozen-lockfile`.

## 3. The toolkit package — `@90soft/parse-server-kit`

Almost all backend machinery lives in this dependency, not in the repo. Declared `^2.5.0`,
**installed 2.6.0**, resolved from `backend/node_modules/@90soft/parse-server-kit/dist`.

Exports used by this template (`dist/index.d.ts`):

| Group | Symbols |
|---|---|
| Model decorators | `ParseClass`, `ParseField`, `getSchemaDefinition`, `BaseModel` |
| Cloud functions | `CloudFunction`, `ProtectedCloudFunction`, `CloudFunctionRegistry` |
| Routing | `Route`, `RouteRegistry` |
| Triggers | `BeforeSave`, `AfterSave`, `BeforeDelete`, `AfterDelete`, `BeforeFind`, `AfterFind`, `BeforeLogin`, `AfterLogin`, `AfterLogout`, `BeforeSaveFile`, `AfterSaveFile`, `BeforeDeleteFile`, `AfterDeleteFile`, `BeforeConnect`, `BeforeSubscribe`, `AfterEvent`, `TriggerRegistry` |
| Cron | `Cron`, `CronSchedule`, `CronRegistry` |
| Schema / DB | `createSchemaConfig`, `applyAllIndexes`, `applyUniqueIndexes`, `getUniqueIndexes`, `getCompoundIndexes`, `getFieldIndexes`, `applyMongoValidators`, `validateObject`, `validateOrThrow` |
| Middleware | `validateEntityRoutes`, `validateFunctionRoutes`, `restrictRoutes`, `removeResultMiddleware`, `conditionalJsonMiddleware`, `checkRateLimit` |
| ACL / auth | `implementACL`, `syncImageAcl`, `cloneAcl`, `getUserRoles`, `getUsersRoles`, `UserRoles`, `roleKey` |
| Helpers | `catchError`, `formatCount`, `generateRandomString`, `generateRandomPassword`, `generateRandomInteger`, `sleep`, `importFiles`, `MAX_QUERY_LIMIT` (10000) |
| Swagger | `setupSwagger`, `SwaggerRegistry`, `generateSwaggerSpec`, `getSwaggerJson` |

`backend/CLAUDE.md` states the local `decorator/` and `utils/helper` paths "were removed in the
migration" — confirmed: they do not exist.

## 4. Backend boot flow — `backend/src/app.ts`

Module scope, in order:

1. `require('dotenv').config()` — loads `backend/.env`.
2. `importFiles(join(__dirname,'cloudCode/models'))` (line 36) — **pre-loads models before
   Parse Server reads the schema**, so `@ParseClass` has pushed every class name into the kit's
   `classNames` array by the time `createSchemaConfig()` runs.
3. `import './cloudCode/cron'` (line 49) — cron definitions must load before `CronRegistry.initialize()`.

`main()`:

| Step | Code | Effect |
|---|---|---|
| 1 | `await initializeParseServer()` | `new ParseServer(createParseConfig())` then `await parseServer.start()`. `start()` loads Cloud Code from `./build/src/cloudCode/main.js`. |
| 2 | `Parse.masterKey = process.env.masterKey` | Master key available to Cloud Code. |
| 3 | `app.use(removeResultMiddleware)` | Unwraps `{result: …}` from every JSON response. |
| 4 | ⟨CP1⟩ `app.use(cors(buildCorsOptions()))` | Fails closed — see §11a. Never a wildcard. |
| 5 | `app.use(mountPath, validateEntityRoutes)` | `/api/{entity}/{action}` → 404/405 check → rewrite to `/functions/{name}` → merge GET query into body → force `POST`. |
| 6 | `app.use(mountPath + '/functions', validateFunctionRoutes)` | Legacy path; registry + method check, force `POST`. |
| 7 | `app.use(conditionalJsonMiddleware)` | `express.json({limit:'10mb', type:['text/plain'], verify: extractMasterKey})`; skipped for `${mountPath}/files`. |
| 8 | `app.use(mountPath, restrictRoutes)` | Blocks everything except `/health`, `/serverInfo`, `/files`, registered entity prefixes, and `/functions*`. Body master key bypasses it. |
| 9 | `app.use(mountPath, parseServer.app)` | Mounts the Parse REST API at `/api`. |
| 10 | ⟨CP1⟩ *removed* | The template served `backend/files` at the web root, unauthenticated. Gone. |
| 11 | `app.use('/.well-known', express.static(…))` | Domain-verification files. |
| 12 | `CloudFunctionRegistry.initialize()` | `Parse.Cloud.define(name, handler, validation)` per function, then `RouteRegistry.initialize()` builds the route map. |
| 13 | `TriggerRegistry.initialize()` | Registers all decorator-declared triggers. |
| 14 | `CronRegistry.initialize()` | No jobs in this template. |
| 15 | `setupSwagger(app, {basePath: mountPath})` | Serves `/api-docs` and `/api-docs/json`. |
| 16 | ⟨CP1⟩ `server.listen(PORT, …)` | `PORT` env or 1337. **Awaits** `seedAll()`, then `applyUniqueIndexes()` and `applyMongoValidators()`. |
| 17 | `ParseServer.createLiveQueryServer(server)` | LiveQuery WebSocket server on the same HTTP server. |
| 18 | `server.on('upgrade', …)` | Logs every WebSocket upgrade URL. |

⟨CP1⟩ Port comes from `PORT` (default 1337). `blockRawFileRoutes` is mounted before route
validation, and `sanitizedErrorHandler` is registered last. `serverURL` must still be kept
consistent with `PORT` manually.

`main()` is called with `.then/.catch` — a boot failure is logged and the process stays alive.

### Cloud Code entry — `backend/src/cloudCode/main.ts`
`importFiles(models)` then `importFiles(modules)`; **no index files** — discovery is by directory
scan. The `beforeSubscribe` LiveQuery guard block is present but fully commented out.

### Parse Server config — `utils/config/parseConfig.ts`

| Option | Value |
|---|---|
| `databaseURI`, `appName`, `appId`, `restAPIKey`, `masterKey`, `javascriptKey`, `serverURL`, `publicServerURL`, `mountPath` | from `.env` |
| `cloud` | `'./build/src/cloudCode/main.js'` |
| `masterKeyIps` | ⟨CP1⟩ `['127.0.0.1','::1']`, or `MASTER_KEY_IPS` (was `['::/0','0.0.0.0/0']`) |
| `readOnlyMasterKeyIps` | ⟨CP1⟩ `['127.0.0.1','::1']` (Parse default is any IP) |
| `allowOrigin` | ⟨CP1⟩ `parseAllowOrigin()` — same allow-list as the Express layer (Parse defaults to `'*'`) |
| `allowClientClassCreation` | ⟨CP1⟩ `false` (explicit) |
| `enableAnonymousUsers` | ⟨CP1⟩ `false` (Parse default is `true`) |
| `allowCustomObjectId` | ⟨CP1⟩ `false` (explicit) |
| `protectedFieldsTriggerExempt` | `true` |
| `requestComplexity.batchRequestLimit` | `50` |
| `fileUpload` | ⟨CP1⟩ all three flags `false` |
| `loggerAdapter` | ⟨CP1⟩ `parseLoggerAdapter` — redacts Parse's own logs |
| `logLevel` | ⟨CP1⟩ `LOG_LEVEL` or `info` |
| `liveQuery.classNames` | `[]` (empty) |
| `schema` | ⟨CP1⟩ `createHardenedSchemaConfig()` — deny-by-default, `adminRole: 'Admin'` |

`utils/fileAdapter.ts` defines a full local-disk `FileAdapter` (create/delete/read/stream with
HTTP Range support) but **is never referenced** — no `filesAdapter` key is passed, so Parse
Server uses its default GridFS adapter.

### Environment validation ⟨CP1⟩
`utils/config/env.ts` → `assertEnv()` runs at the very top of `app.ts`. It requires
`databaseURI`, `appId`, `masterKey`, `serverURL`, `mountPath`, treats a whitespace-only value as
absent, and on failure throws listing the **missing key names only** — no value, no partial value,
no length. Optional keys are counted, never echoed. 8 tests assert that no configured value can
appear in the message.

## 5. Decorator architecture

### `@ParseClass(className, options)` — `dist/decorators/parseDecorators.js`
Stores `parse:className`, `parse:clp`, `parse:protectedFields`, `parse:defaultACL`,
`parse:compoundIndexes` via `Reflect.defineMetadata`; calls
`Parse.Object.registerSubclass()` and pushes into `classNames` (skipped for `Parse.Role`
subclasses); registers the Swagger model; drains `parse:pendingTriggers` into `TriggerRegistry`.

### `@ParseField(options)`
Validates the field type against 12 allowed Parse types and validates option combinations
(`min`/`max` Number-only, `minLength`/`maxLength` String-only, `enum`/`pattern` String-only,
`geo` GeoPoint-only, `ttlSeconds` Date-only, `targetClass` required for Pointer/Relation), stores
`parse:fields` metadata, and defines a get/set property pair proxying `this.get/set`.

### `getSchemaDefinition(target)` — the ACL default that matters
```js
classLevelPermissions.ACL = defaultACL || { '*': { read: true, write: true } };
```
**A `@ParseClass` without an explicit `ACL` option gets a public read+write default object ACL.**

⟨CP1⟩ This insecure fallback is **neutralised** by `utils/config/schemaGuard.ts`. The kit lives in
`node_modules` and must not be patched, so hardening happens at the boundary where this project
builds its schema — `createHardenedSchemaConfig()` wraps `createSchemaConfig({adminRole: 'Admin'})`
and enforces two rules on every definition:

1. **A class with no explicit CLP, or with any of the six operations left undecided, aborts
   startup** (`InsecureSchemaError`). Silence never means public.
2. **A public wildcard grant (`'*'` with read or write) is rewritten to `{}`**, and a missing ACL
   template likewise becomes `{}`.

`_Role`, `_Session`, and `_Installation` are exempted from rule 1's operation check because Parse
Server owns them. Net effect: forget the ACL on a new private class and the server refuses to boot
instead of publishing the collection.

### `@CloudFunction(config)` — `dist/decorators/cloudDecorator.js`
Wraps the method; if `config.requireRoles` is set, runs `checkUserRoles()` (a `_Role` query with
`useMasterKey`, honouring `requireAllRoles`) before the handler. Registers in
`CloudFunctionRegistry` and `SwaggerRegistry`. `config.validation` is handed to
`Parse.Cloud.define` — so `requireUser`, `fields`, and `requireAnyUserRoles` are enforced by
**Parse Server's** native validator, not by the kit.

### `@Route(ModelOrString)` — `dist/decorators/routeDecorator.js`
Derives a prefix from the **JS class name** via `toKebabPlural()` and records the class's method
names. At init, each registered cloud function is matched to the owning class and mapped to
`/{prefix}/{functionName}`.

`toKebabPlural` is naive: a name already ending in `s` gets `es` appended — `AppSettings` →
**`app-settingses`**. Observed at runtime.

### Trigger decorators / `TriggerRegistry`
16 trigger decorators map onto the matching `Parse.Cloud.*` registration. Keyed by
`className:type`, so a second trigger of the same type on the same class **overwrites** the
first (with a console warning).

### `@Cron` / `CronRegistry`
Present; `cron.ts` declares an empty `CronJobs` class. Runtime logs `[Cron] No cron jobs to register`.

## 6. Current template data models

### `_User` — `backend/src/cloudCode/models/User.ts` (protected)
Extends `Parse.User`.

| Field | Type | Notes |
|---|---|---|
| `username` | String | login identifier |
| `email` | String | |
| `firstName` | String | |
| `lastName` | String | |
| `phoneNumber` | String | |

⟨CP1⟩ **rewritten to deny-by-default.**
- **CLP:** `find`, `get`, `count`, `create`, `update`, `delete` → **all `{}`**. No client session
  can enumerate, read, create, or modify a user. `create: {}` closes the unauthenticated `_User`
  creation hole the template shipped with.
- **protectedFields:** `'*'` → `email, username, emailVerified, authData, phoneNumber, firstName,
  lastName`; `authenticated` → `email, username, emailVerified, authData, phoneNumber`. A signed-in
  user learns nothing about another account from this class.
- **ACL:** `role:Admin` read+write. Never public.
- **Triggers:** none.
- **Exposure:** hand-built DTOs in `utils/dto/userDto.ts` — `toCurrentUserDto()` →
  `{id, username, firstName?, lastName?, roles[]}` (**no** session token, email, or phone) and
  `toLoginDto()` which adds `sessionToken` for the single successful-login response.
  `User.map()` was deleted.

### `AppSettings` — REMOVED ⟨CP1⟩

Deleted in Checkpoint 1 (resolved decision OQ-13): `models/AppSettings.ts` and
`modules/AppSettings/functions.ts` are gone, along with the `getAppSetting` cloud function, the
mis-pluralised `/api/app-settingses/getAppSetting` route, the `AppSettings` Swagger schema, and
the `key_unique` index — the only unique index the project had, so startup now logs
`[Indexes] No indexes to apply`.

A generic key-value settings store is a **prohibited pattern**: future configuration needs use
narrowly scoped, typed, sanitised endpoints.

An `AppSettings` **collection** may still exist in a developer's database. Source removal and data
deletion are separate actions: startup reports the collection name and document count and never
deletes it (`reportStaleCollections` in `database/seed.ts`).

### `IMG` — `models/IMG.ts` (protected)

| Field | Type |
|---|---|
| `image` | File |
| `imageThumbNail` | File |
| `blurHash` | String |

⟨CP1⟩ **now fully private.**
- **CLP:** all six operations → **`{}`**.
- **ACL:** **`{}`** — deny-by-default. (Was: none declared, which the kit turned into public
  read+write.)
- **protectedFields:** `image`, `imageThumbNail` hidden from non-master callers.
- **Triggers:** `beforeSave` **rejects a client-supplied ACL** and then runs the unchanged
  pipeline (WebP conversion, thumbnail, blurhash via `processImage`; skipped unless `image` is
  dirty); `afterSave` destroys superseded files; `afterDelete` destroys both files. Failures log
  through the redacting logger instead of printing the raw error.
- **Extension point (Checkpoint 4):** the StudentProfile photo is uploaded via a cloud function
  that authorises the caller, saves with the master key, and stamps a per-record ACL; reads go
  through a function that authorises then streams bytes. No public URL. See OQ-10.

### `File` — `models/File.ts` (protected)

| Field | Type |
|---|---|
| `file` | File |
| `fileSize` | Number |
| `type` | String |

⟨CP1⟩ **now fully private.**
- **CLP:** all six operations → **`{}`** (the template also omitted `count` entirely).
- **ACL:** **`{}`** — deny-by-default.
- **protectedFields:** `file` hidden from non-master callers.
- **Triggers:** `beforeSave` **rejects a client-supplied ACL**, then sets `type` from the filename
  extension on create. `fileSize` is still declared but never populated.
- **Extension point (Checkpoint 7):** Batch Resources add controlled read access via a cloud
  function that authorises against the owning record and streams the bytes. See OQ-10.

### Planned Code Your Future models — **Not implemented**
`StudentProfile`, `Batch`, `BatchInvitation`, `Enrollment`, `Resource`, `LiveSlidesSession`,
`Slide`, `SlideResponse`, `Task`, `Submission`, `PinnedStudent`, `TalentReel`. None of these
exist in any form.

## 7. Migrations, indexes, validators

- **Migrations:** none in this repo. The runtime `info: Running Migrations` lines come from
  Parse Server's own internal migration step.
- **Indexes:** `applyUniqueIndexes(parseServer)` is called after `listen`. `applyAllIndexes`,
  `getFieldIndexes` (B-tree / `2dsphere` / TTL) and `getCompoundIndexes` exist in the kit but
  are **not called** by `app.ts` — only unique indexes are applied. The only unique field in the
  template is `AppSettings.key`.
- **MongoDB validators:** `applyMongoValidators(parseServer)` derives a `$jsonSchema` per class
  from `@ParseField` constraints (`bsonType`, `minimum`/`maximum`, `minLength`/`maxLength`,
  `enum`, `pattern`). The template declares almost no constraints, so validators are effectively empty.

## 8. Roles, seeding, sessions, ACL, CLP, Master Key

### Roles ⟨CP1⟩
Application roles are **exactly `Admin` and `Student`**, defined in
`backend/src/cloudCode/utils/constants/roles.ts` (`AppRole` enum) and mirrored in
`frontend/src/app/config/user-roles.ts`. A **Visitor** is an unauthenticated caller and is
deliberately not a stored role.

The kit still exports a template `UserRoles` enum with `SuperAdmin`/`Employee`. **It is not
imported anywhere in this project** — a project-local constants module was added instead, exactly
as the plan required, because the package must not be edited. The legacy names appear in
`roles.ts` only as `LEGACY_ROLE_NAMES`, used by startup migration and by tests that assert the
names authorise nothing. There is **no compatibility alias**: `toAppRole('SuperAdmin')` returns
`undefined`, so a legacy membership resolves to an empty role list.

### Seeding and legacy migration — `database/seed.ts` ⟨CP1⟩
`seedAll()` → `seedRoles()` → `migrateLegacyRoles()` → `seedAdminUser()` →
`reportStaleCollections()`, and returns a structured `SeedReport`. It is now **awaited** in the
`listen` callback before indexes and validators run.

- **`seedRoles()`** creates any missing `Admin` / `Student` role with an ACL granting `Admin`
  read+write and no public access. Idempotent.
- **`migrateLegacyRoles()`**
  - `SuperAdmin` → members are added to `Admin` (a safe widening of an already-privileged
    account, and it preserves the seeded administrator), then the legacy role object is deleted.
  - `Employee` → **never migrated.** Employee membership carries no Code Your Future meaning, so
    promoting those accounts would be an escalation and deleting them would be data loss. An
    **empty** `Employee` role is deleted; a **populated** one is retained and reported with its
    member count for a human decision. Members are never touched.
- **`seedAdminUser()`** is keyed on username. If the account exists it is never deleted or
  recreated — only membership is ensured. If it does not exist and `ADMIN_PASSWORD` is unset,
  seeding **skips with a warning rather than inventing a default password** (the template
  hardcoded `ChangeMe!2024`). No credential is ever logged; only `userId` and whether creation
  happened.
- **`reportStaleCollections()`** reports an obsolete `AppSettings` collection — name and document
  count only, never contents — and never deletes data.
- `seedLookupTable()` was removed along with the rest of the lookup-table scaffolding.

**On a clean database the stored application roles are exactly `Admin` and `Student`** (verified at
runtime).

### Sessions
Standard Parse `_Session`. `loginUser` calls `User.logIn(username, password, {installationId:
generateRandomString(10)})` and returns the session token in the response body. `logout` queries
`_Session` by token with the master key and destroys it. The frontend stores the token in
`localStorage`.

### ACL
`implementACL({publicRead, publicWrite, roleRules, excludedRoles, owner}, existingACL)` builds a
`Parse.ACL` imperatively; `syncImageAcl` / `cloneAcl` propagate a parent's ACL onto an `IMG`.
`handleImage.ts` prefers the parent record's per-record ACL and falls back to the parent class's
`parse:defaultACL` template. **No template model uses `implementACL`** — all ACL is static.

### CLP
Declared per class in `@ParseClass({clp})` and emitted into the Parse Server `schema` config.
`_Role` CLP is generated by `createSchemaConfig()`. ⟨CP1⟩ `adminRole: 'Admin'` is passed, so all
six operations are restricted to **`role:Admin`** — the legacy `role:SuperAdmin` grant is gone.

### Master Key ⟨CP1⟩
- `Parse.masterKey` is still set globally in `app.ts` (Cloud Code needs it).
- **`masterKeyIps` now defaults to `['127.0.0.1', '::1']`** — localhost only, failing closed.
  Deployments override with the `MASTER_KEY_IPS` env var (comma-separated); no production topology
  is hardcoded. Was `['::/0','0.0.0.0/0']`, i.e. any address on the internet.
- **`readOnlyMasterKeyIps: ['127.0.0.1','::1']`** — Parse Server defaults this to *any* IP, and the
  read-only key still bypasses CLP, ACL, and `protectedFields` on reads.
- **Master-key audit of every call site.** Remaining uses, all trusted server operations:

  | Site | Classification | Kept because |
  |---|---|---|
  | `seedRoles`, `migrateLegacyRoles`, `seedAdminUser` | required | `_Role`/`_User` are closed to clients; provisioning is server-only |
  | `reportStaleCollections` | required | counts a collection no client may query |
  | `getAppRoles` (`_Role` lookup) | required | `_Role` CLP grants clients nothing; this is the authorization primitive itself |
  | `loginUser` / `logout` session destroy | required | `_Session` is closed to clients |
  | `IMG`/`File` trigger file cleanup | required | server-side trigger context |
  | `handleImage` / `handleFile` uploads | required | server-controlled creation path |

  Removed with their functions: the master-key reads and writes in `listUsers`, `getUser`,
  `createUser`, `updateUser`, `deleteUser`, `signupUser`, and `searchEmployees` — seven
  client-facing operations that bypassed CLP and depended entirely on a `requireAnyUserRoles`
  declaration being present and correct.
- The master key is never returned, never sent to Angular, never logged (the redaction key list
  covers `masterkey` and `readonlymasterkey`), never placed in a DTO, and
  `rejectPrivilegedParams` refuses `masterKey` / `_MasterKey` as request parameters.
- `extractMasterKey` (the kit's `express.json` verify hook) still lifts `masterKey` / `_MasterKey`
  from the request **body** into `req['x-master-key']`, and the kit's `restrictRoutes` treats a
  match as a bypass. Re-probed at runtime after CP1: a `text/plain` body carrying the key against
  `/api/classes/AppSettings` returns **403**, so it is not exploitable here. The mechanism lives in
  the kit and cannot be removed from this repository; it is tracked as a residual gap.

## 9. Cloud functions and REST routes ⟨CP1⟩

**3 functions, 3 routes** (was 11 and 11). Observed at runtime and in `/api-docs/json`.

| Route | Function | Methods | Guard |
|---|---|---|---|
| `/api/users/loginUser` | `loginUser` | POST | `requireUser: false`; `username`+`password` required; **rate limited 10/min**; rejects privileged params; verifies the Admin role after authentication and revokes the session otherwise |
| `/api/users/getCurrentUser` | `getCurrentUser` | GET | `requireUser: true` |
| `/api/users/logout` | `logout` | POST | `requireUser: true`; rejects privileged params; idempotent |

**Retired**, with the reason recorded in the module header:

| Removed | Why |
|---|---|
| `signupUser` | open unauthenticated self-signup that granted a role — there is no public email/password signup |
| `createUser` | manual creation with a client-chosen role — manual Student creation and manual role assignment are both forbidden |
| `updateUser` | arbitrary field and role reassignment (privilege-escalation surface) |
| `deleteUser` | account deletion with no product requirement |
| `listUsers` | user enumeration with no product requirement |
| `getUser` | arbitrary user read by id |
| `searchEmployees` | built on the retired `Employee` role |
| `getAppSetting` | `AppSettings` removed (OQ-13) |

**Blocked at runtime** (verified): `GET /api/classes/_User`, `/classes/File`, `/classes/IMG`,
`/classes/_Role`, `/classes/_Session`, `/api/schemas`, `/api/requestPasswordReset`, and
`/api/app-settingses/getAppSetting` all return **403**; Parse's `POST /api/users` signup returns
**404** because `/users` is a registered entity prefix that resolves no such function; raw
`/api/files/*` returns **403** from `blockRawFileRoutes`.

Cloud functions return data **directly**; `removeResultMiddleware` strips Parse's `{result: …}`
wrapper server-side, so the frontend must not unwrap it again.

Authorization helpers live in `utils/auth/authorize.ts`: `requireUser`, `requireAdmin`,
`requireStudent`, `getAppRoles`, `hasAppRole`, and `rejectPrivilegedParams`. Every role decision
reads live `_Role` membership; a client-sent role value is never consulted.
`rejectPrivilegedParams` refuses `role`, `roles`, `ACL`, `acl`, `CLP`, `clp`, `sessionToken`,
`authData`, `masterKey`, `_MasterKey`, `protectedFields`, `owner`, `user`, `userId`, `studentId`.

## 10. Files and images

- **Storage:** Parse Server's default **GridFS** adapter (Mongo). The bespoke local-disk
  `FileAdapter` in `utils/fileAdapter.ts` is dead code.
- ⟨CP1⟩ **`/api/files/*` is now blocked.** `blockRawFileRoutes` in `app.ts` returns **403** for
  `/files` and `/files/*` before any routing, closing Parse's unauthenticated file endpoint.
  Verified at runtime.
- ⟨CP1⟩ **`express.static('../../files')` was removed** — the template served `backend/files/` at
  the web root with no auth. Only `/.well-known` is still served statically.
- ⟨CP1⟩ **Direct upload is closed for every caller class**: `fileUpload.enableForAnonymousUser`,
  `enableForAuthenticatedUser`, and `enableForPublic` are all `false`.
- ⟨CP1⟩ **Extension point for controlled access** (documented on both models): a cloud function
  authorises the caller against the owning record, then streams the bytes itself. No public
  download route, and no signed-URL scheme is committed to before the requirement exists (OQ-10).
- **Image pipeline** (`utils/imageProcessing.ts`): `axios` downloads the uploaded file by URL,
  `sharp` produces a 1000 px WebP at quality 70 (`large`) and quality 30 (`thumbnail`), and
  `blurhash.encode` produces a 4×4 hash. Triggered from `IMG.beforeSave`.
- **Upload entry points:** `handleFileLogic` / `handleFileArrayLogic` and `handleImageLogic` /
  `handleImageArrayLogic` accept `{base64, name}` payloads and save with `useMasterKey`.
  **No MIME check, no extension check, no size limit, no magic-byte check** anywhere.
- `fileAdapter.validateFilename()` *returns* a `Parse.Error` instead of throwing, `createFile`
  ignores the return value, and the character-class check is commented out — the validation is
  a no-op even if the adapter were wired in.

## 11a. CORS policy ⟨CP1⟩ — fails closed

`utils/config/cors.ts` is the single source of truth. **There is no wildcard fallback on any
code path.**

| Situation | Allow-list |
|---|---|
| `CORS_ORIGINS` set | exactly those origins (dev and production alike) |
| unset, `NODE_ENV !== 'production'` | `http://localhost:4200`, `http://127.0.0.1:4200`, `http://localhost:1337`, `http://127.0.0.1:1337` |
| unset, **`NODE_ENV === 'production'`** | **empty** — every cross-origin browser request denied, error logged at startup |

- A request with **no `Origin` header** is allowed through (curl, server-to-server, health
  probes); CORS is a browser mechanism and does not apply.
- `credentials: false` is explicit — this API authenticates with `X-Parse-Session-Token`, not
  cookies.
- Methods are `GET, POST, OPTIONS`; allowed headers are an explicit list. Neither is a wildcard.
- No production domain is hardcoded.

### Two layers are required, and why

The Express `cors()` middleware alone is **not sufficient**. Parse Server's mounted app runs its
own `allowCrossDomain` middleware, which unconditionally writes
`Access-Control-Allow-Origin` and defaults it to `'*'` — overwriting whatever the upstream
middleware decided. Runtime validation caught exactly this: with only the Express layer in place,
`/api/*` still answered `Access-Control-Allow-Origin: *` to an arbitrary origin.

The fix feeds the same list into Parse Server's supported **`allowOrigin`** option
(`parseAllowOrigin()` in `parseConfig.ts`). Parse then echoes the request origin when it is in the
list, and otherwise returns the list's first entry — which a browser rejects because it does not
match the requesting origin.

Because Parse always emits the header and picks `baseOrigins[0]` on a miss, the list must never be
empty (an empty array makes Parse emit `undefined`). When nothing is allowed, `parseAllowOrigin()`
returns a single sentinel, `https://cors-disallowed.invalid` — `.invalid` is a reserved TLD
(RFC 2606), so no real browser origin can ever match it.

**Observed at runtime:**

| Request origin | Response header |
|---|---|
| `http://localhost:4200` (allowed) | `Access-Control-Allow-Origin: http://localhost:4200` → allowed |
| `https://evil.example.test` (not allowed) | `Access-Control-Allow-Origin: http://localhost:4200` → browser blocks |
| none | header present but irrelevant; request succeeds |
| any origin, production without `CORS_ORIGINS` | `Access-Control-Allow-Origin: https://cors-disallowed.invalid` → browser blocks |

No response in any configuration contains `Access-Control-Allow-Origin: *`.

One residual: Parse's own `Access-Control-Allow-Methods` / `-Headers` are broader than this
project's (they include `X-Parse-Master-Key`) and are baked into the package. That is a list of
*permitted request headers*, not an authorisation grant — sending a master key still requires
knowing it, and `masterKeyIps` restricts it to localhost.

## 11. Logging and errors ⟨CP1⟩

### The redaction boundary
`utils/logging/redact.ts` + `utils/logging/safeLogger.ts` are the only sanctioned way to write a
log line. The template had `console.log` everywhere and **no redaction at all**.

- **Key-name deny-list, applied recursively.** A key whose normalised form (non-alphanumerics
  stripped, lower-cased) contains a sensitive fragment is replaced with `[REDACTED]` regardless of
  nesting depth or casing — so `sessionToken`, `session_token`, `SESSION-TOKEN`, and
  `X-Parse-Session-Token` all match. Covered fragments include passwords, all Parse keys
  (`masterkey`, `readonlymasterkey`, `restapikey`, `javascriptkey`, …), tokens, `authdata`,
  `authorization`, `cookie`, `databaseuri`, `email`, `phone`, `dateofbirth`, `base64`, and buffer
  payloads.
- **Whole subtrees dropped:** `body`, `params`, `headers`, `request`, `response` → `[OMITTED]`.
- **Handles** nested objects, arrays (capped), `Map`, `Set`, `Date`, `Buffer` (summarised as a byte
  count), circular graphs, depth (capped at 8), long strings (truncated), and `Error` — including
  request data hung off an axios-style error.
- **Raw Parse objects never printed:** anything Parse-shaped becomes
  `[ParseObject _User#abc123]`.
- **`redactMessage()`** scrubs free text, and matters more than it looks: Parse Server logs every
  cloud-function call as a message containing serialised `Input:` and `Result:` bodies, and Parse
  masks only `password`. `redactMessage` masks any `"sensitiveKey": value` pair inside embedded
  JSON (reusing the same key rules), Mongo URIs, and bare `r:` session tokens. Verified live:
  `Input: {"username":"admin","password":"[REDACTED]"}` and
  `Result: {…,"sessionToken":"[REDACTED]"} {"functionName":"loginUser","params":"[OMITTED]"}`.
- **`parseLoggerAdapter`** is wired via Parse Server's supported `loggerAdapter` option, so Parse's
  own logs pass through the same redaction. **`node_modules` is not patched.**
- **Safe fields** a log line may carry: `op`, `route`, `userId` (opaque objectId, never an email),
  `code`, `stage`, `ok`, and counts. `LOG_LEVEL` controls verbosity.
- 20 redaction tests plant canary secrets at each of these locations and assert absence.

### Errors
- `catchError(promise)` → `[error, result]`; `backend/CLAUDE.md` forbids `try/catch` with `await`
  outside synchronous code and whole-function boundaries.
- ⟨CP1⟩ `sanitizedErrorHandler` in `app.ts` is registered last: clients receive
  `{"error":"Request failed"}` with 403 or 500 and **never** a stack trace, a Mongo error, a Parse
  internal, an ACL, a CLP, or a raw object. Detail goes to the redacting logger.
- ⟨CP1⟩ Login failure is deliberately opaque — unknown username and wrong password produce the
  same `Invalid credentials`, so the endpoint cannot enumerate accounts. A non-Admin account gets a
  distinct `This account cannot sign in with a password` **after** its transient session is
  revoked.
- Unauthenticated calls to a `requireUser: true` function still surface as **HTTP 400** from
  Parse's validator (not 401). `requireUser()` in `authorize.ts` throws
  `INVALID_SESSION_TOKEN` so the client can distinguish "not signed in" from "forbidden".

## 12. Frontend architecture

### Bootstrap
`main.ts` → `bootstrapApplication(App, appConfig)`. `App` is a standalone component whose
template is `<router-outlet/>` + `<p-toast/>`, `OnPush`.

`app.config.ts` providers:
- `provideBrowserGlobalErrorListeners()`
- `provideHttpClient(withInterceptors([httpInterceptor]))`
- `MessageService`, `ConfirmationService` (PrimeNG)
- `provideAppInitializer(…)` — **session restoration**: if `SessionService.isLoggedIn()`, calls
  `getCurrentUser()`, re-saves the session on success, clears it on any error.
- `provideRouter(routes, withHashLocation(), withViewTransitions())` — **hash-based URLs**
- `providePrimeNG({theme: {preset: MyPreset, options: {darkModeSelector: '.dark'}}})`
- `provideTranslateService({loader: provideTranslateHttpLoader({prefix:'./i18n/', suffix:'.json'}), fallbackLang:'en', lang:'en'})`

### Routing and guards — `app.routes.ts` ⟨CP2A⟩
```
/auth              canActivate:[guestGuard]
  ''                 → redirect to admin
  /auth/admin        canActivate:[guestGuard]  AuthComponent (lazy)
  /auth/student      canActivate:[guestGuard]  StudentAuthComponent (lazy)  — UI only
  **                 → redirect to admin
''                 canActivate:[authGuard]     ShellComponent (lazy)
  ''                 → redirect to dashboard
  dashboard                                    DashboardComponent (lazy)
**                 → redirect to ''
```
Every route is lazy and carries a meaningful `title`. `/users` was removed in Checkpoint 1.

`guestGuard` sends an authenticated user to `/` by returning a `UrlTree`, so the router resolves the
redirect **before** the auth component is created — no sign-in form flashes for a signed-in Admin.

> **Why the guard is on the parent *and* both children.** Angular does not re-run a parent route's
> `canActivate` when only the child changes. With the guard on the parent alone, a sibling
> navigation (`/auth/admin` → `/auth/student`) kept the branch activated and skipped the check
> entirely. Found by a routing test, not by inspection.

Every redirect target is a fixed internal path — none is read from a query parameter or any other
user input, so none can become an open redirect (asserted by test).

`authGuard` redirects to `/auth` when no token. ⟨CP1⟩ `roleGuard(...roles)` is now **role-set
aware** — it checks `sessionService.hasAnyRole()` across the whole role list instead of comparing
only `roles[0]`, sends a Visitor to `/auth`, and an authenticated user without a permitted role to
`/dashboard`. `adminGuard` is a convenience wrapper. The same fix was applied to the `appIfRole`
directive. Guards are UI routing only; the backend re-authorises independently.

### Session handling — `services/session.service.ts` ⟨CP1⟩
Signals `user` / `token` hydrated from `localStorage` keys `currentUser` and `sessionToken`;
computed `isLoggedIn`, `roles`, `isAdmin`, `isStudent`, `userDisplayName`, plus `hasAnyRole()`.

`saveSession()` and the loader both run the payload through `sanitize()`, which keeps **only** the
five allow-listed DTO fields and **only recognised role names**. Two consequences: a field the API
stops sending cannot be depended on by a component, and a stale or tampered cached session naming
`SuperAdmin` or `Employee` resolves to an empty role list (`isAdmin() === false`). Corrupt JSON
yields `null` rather than throwing. `userRole()` (first-role-only) was removed.

### API layer
- `ApiService<T>` — generic `getList` / `getSingle` / `add` / `update` / `edit` / `delete`,
  built on `HttpClient`, base URL from `SharedVarsService` → `environment.apiUrl`.
- ⟨CP1⟩ `services/dataService/user-service.ts` — renamed export **`AuthApiService`**, reduced to
  `login`, `getCurrentUser`, `logout`, and switched to the **entity routes**
  (`/users/loginUser` etc.) instead of the legacy `/functions/{name}` paths. The six
  user-management methods were deleted along with their backend functions. There is deliberately
  no Student login, signup, reset, or change method.
- `http.interceptor.ts` — injects `X-Parse-Application-Id` and `X-Parse-REST-API-Key` on every
  request, adds `X-Parse-Session-Token` from `localStorage`, converts every Parse `{__type:'Date',
  iso}` value to a `YYYY-MM-DD` **string** (dropping the time component), toasts every error, and
  on Parse error codes 142/209 clears the token and routes to `/auth`. ⟨CP1⟩ its login exemption
  now matches `loginUser` — the template checked for `/functions/login`, which never matched the
  real route, so the session header was attached even to the login call.

### State, forms, UI
- **State:** Angular signals throughout (`signal`, `computed`, `effect`, `input()`, `output()`),
  `ChangeDetectionStrategy.OnPush` everywhere, `inject()` instead of constructor injection,
  `takeUntilDestroyed(destroyRef)` for component subscriptions.
- **RxJS 7.8** for HTTP only.
- **Typed reactive forms:** still none. `AuthComponent` uses `FormsModule` with `signal()`-backed
  bindings. Typed `FormGroup` usage begins with Complete Profile (Checkpoint 4).
- ⟨CP2A⟩ **Auth error handling.** `utils/auth-error.ts` maps a failed login to a translation key
  (`invalidCredentials` / `notPermitted` / `rateLimited` / `unavailable` / `unexpected`) entirely on
  the client, so no backend string is ever rendered. Unknown-username and wrong-password both map to
  `invalidCredentials`, matching the backend's opaque response so the UI cannot enumerate accounts.
  The login request sets the `HANDLES_OWN_ERRORS` `HttpContextToken`, which suppresses the
  interceptor's global toast so the page shows one inline, translated panel instead of a raw
  server string.
- **PrimeNG 21** + `@primeuix/themes` Aura preset, customised in `app/theme.ts` from a single
  `PRIMARY_BASE = '#6096bb'` via `utils/palette-generator.ts` (320 lines).
- **Tailwind CSS 4** via `@tailwindcss/postcss` (`.postcssrc.json`), entry `src/styles.css` (482 lines).
- **Shared components:** `data-table` (1051 lines — server-side pagination, debounced search,
  table/grid modes, column toggle, preview panel, bulk select, Excel export, skeletons;
  25 inputs, 4 outputs), `base-dialog` (+ `DialogBodyDirective`, `DialogActionsDirective`),
  `image-uploader` (accepts `.jpg .jpeg .png .webp`), `image-cropper-dialog` (`ngx-image-cropper`).
- **Dialogs / confirms / toasts:** `ConfirmService.confirm()` / `confirmDelete()` wrap PrimeNG
  `ConfirmationService` as promises; `ToastService` wraps `MessageService` (clears before each add).
- **Other services:** `ExportService` (xlsx), `PageTitleService` (title bar, back button, search
  and bulk-selection state), `LiveQueryService`.
- **Pipes:** `relative-time`, `time12h`. **Directive:** `appIfRole`.

### LiveQuery client
`services/live-query.service.ts` — a hand-rolled `WebSocket` client to `environment.wsUrl`.
Sends `sessionToken` in both `connect` and `subscribe`, tracks `requestId` subscriptions,
reconnects after 3 s unless the close was intentional, and disconnects when the last subscription
is removed. **No backend class is LiveQuery-enabled** (`liveQuery.classNames` is empty and no
`beforeSubscribe` hook exists), so the service is currently unused.

## 13. Internationalisation, RTL, theming

- `@ngx-translate/core` 17 + `@ngx-translate/http-loader` 17, files `public/i18n/en.json` and
  `ar.json`. Verified: **77 keys each, no drift in either direction.**
- `ChangeLangService` — `currentLang` signal seeded from `localStorage.lang` (default `en`, with an
  unsupported value falling back to `en`); `currentDirection` computed (`ar` → `rtl`); a constructor
  `effect` keeps `<html lang>`, `<html dir>`, and `<body dir>` synchronized; `changeLang()` persists
  and calls `translate.use()`.
- ⟨CP1⟩ **The auth-page initialization defect is fixed.** `initLang()` (and `initTheme()`) now run
  in a `provideAppInitializer` in `app.config.ts`, i.e. during bootstrap **before the router
  activates any route** — previously it ran only in `ShellComponent.ngOnInit`, so a cold load of
  `/auth` with `lang=ar` applied RTL while leaving the text in English. `applyLang()` also writes
  the attributes eagerly rather than waiting for the first effect flush, so there is no direction
  flash. 15 tests cover English init, Arabic init, `dir`/`lang` synchronization, switching, and the
  fallback paths.
- Cairo Arabic webfont shipped in `public/Cairo/` (woff/woff2/ttf + 8 static weights).
- `SwitchThemeService` toggles a `dark` class on `<html>`/`<body>`, persisted to
  `localStorage.theme`, **defaulting to `dark`**; `index.html` ships `class="dark"` on both
  elements to avoid a flash.

## 14. Package management, build, CI

### Package manager — pinned to pnpm 10.33.0

**One version repository-wide: `pnpm@10.33.0`**, declared via the Corepack-compatible
`packageManager` field in all three manifests:

| File | `packageManager` |
|---|---|
| `package.json` | `pnpm@10.33.0` |
| `backend/package.json` | `pnpm@10.33.0` |
| `frontend/package.json` | `pnpm@10.33.0` *(pre-existing)* |

**Why 10.33.0:** it was already the most restrictive pin in the repository (the frontend's), so
adopting it changes the fewest moving parts. It was validated against every consumer before being
adopted — see [CURRENT_STATE.md §7](CURRENT_STATE.md). Critically, pnpm 10.33.0 honours the
`allowBuilds` block in `backend/pnpm-workspace.yaml`: the backend install exits 0, records
`pendingBuilds: []` in `node_modules/.modules.yaml`, emits no ignored-builds warning, and `sharp`
performs a real WebP encode afterwards.

Before this pin, root and backend commands ran under the globally installed **pnpm 11.15.1** while
the frontend silently switched to 10.33.0 — two package-manager versions in one repository, and the
same `pnpm install` producing different outcomes depending on the directory. That split is closed:
all three directories now report `pnpm -v` → `10.33.0`.

**How future developers install dependencies.** No global pnpm version needs to match — the
`packageManager` field makes pnpm (or Corepack) select 10.33.0 automatically per directory. The
three projects install independently:

```bash
# from the repository root
pnpm install                                  # root: concurrently only
cd backend  && pnpm install                   # backend
cd ../frontend && pnpm install --shamefully-hoist   # frontend REQUIRES the flat layout
```

or, equivalently, `pnpm run install:all` from the root (which does exactly the last two steps).
For reproducible/CI installs add `--frozen-lockfile` to each; all three were verified to pass with
it. In a non-TTY environment pnpm may ask to purge `node_modules`; set `CI=true` to let it proceed.

### Lockfile policy — three tracked lockfiles (Policy B)

**Three independent pnpm projects, three committed lockfiles**, all `lockfileVersion: '9.0'`:

| Lockfile | Covers | Size |
|---|---|---|
| `pnpm-lock.yaml` | root — a single importer `.` with `concurrently ^9.1.2` | ~6 KB |
| `backend/pnpm-lock.yaml` | Parse Server / Express / TypeScript backend | ~216 KB |
| `frontend/pnpm-lock.yaml` | Angular / PrimeNG / Tailwind frontend | ~196 KB |

**Why Policy B and not a single root workspace**, from source evidence:
1. **There is no root `pnpm-workspace.yaml`** — the root is not a pnpm workspace, and its
   `pnpm-lock.yaml` contains exactly one importer (`.`) for its one devDependency.
2. `backend/pnpm-workspace.yaml` has **no `packages:` key** — it exists solely to carry the
   `allowBuilds` decisions, which pnpm only reads at a workspace root. Backend is therefore its own
   independent project root.
3. **The frontend requires `--shamefully-hoist`** (a flat `node_modules`). That is a root-level
   layout setting; folding the frontend into a shared workspace would impose the flat layout on the
   backend too.
4. Both the root scripts (`install:all`, `start:backend`, `start:frontend`) and `.gitlab-ci.yml`
   install **per directory** (`cd backend && pnpm install`, `cd frontend && pnpm install
   --shamefully-hoist`). Converting to one workspace would mean rewriting the root scripts, the CI
   file, and the README — a broad refactor with no functional gain.

None of the three lockfiles is a duplicate: each resolves a distinct `package.json` with a distinct
dependency set. All three were validated under the pinned pnpm version and came out **byte-identical**
— pnpm 10.33.0 rewrote nothing, so they were already in the pinned version's format.

The root `.gitignore` no longer carries a `pnpm-lock.yaml` rule; `package-lock.json` stays ignored
because npm is not used here. Neither `backend/.gitignore` nor `frontend/.gitignore` ever had a
lockfile rule.
- `backend/pnpm-workspace.yaml` carries `allowBuilds` decisions for the seven dependencies with
  install scripts. **At baseline all seven values were the literal placeholder string
  `set this to true or false`**, which pnpm 10+ treats as undecided → `ERR_PNPM_IGNORED_BUILDS`
  → `pnpm install` exits 1 → pnpm's pre-script dependency check aborts **every** backend script
  (`compile`, `start`, `dev`). Corrected in Phase 0 to real booleans (`sharp: true`,
  `parse-server: true`, the rest `false`). See [CURRENT_STATE.md §6](CURRENT_STATE.md).
- **Frontend build:** `@angular/build:application` builder, `browser: src/main.ts`,
  `tsConfig: tsconfig.app.json`, assets from `public/`, styles `src/styles.css` +
  Font Awesome. Production config swaps in `environment.prod.ts`, hashes output, and sets budgets
  (initial warn 500 kB / error 1 MB; component style warn 4 kB / error 8 kB).
  `defaultConfiguration: production`. Output `frontend/dist/code-your-future-frontend/browser/`.
  Angular cache in `frontend/.angular/cache` (ignored).
- **Frontend test:** `@angular/build:unit-test` with `vitest` ^4 and `jsdom` ^27;
  `tsconfig.spec.json` includes `src/**/*.spec.ts` and types `vitest/globals`. All
  `angular.json` schematics set `skipTests: true`.

### ⟨CP1⟩ Test foundation — 197 tests, zero new dependencies

**Backend — `node:test`** (`backend/test/`, run by `pnpm run test`, 131 tests):

| File | Covers |
|---|---|
| `roles.test.ts` | role constants; legacy names resolve to `undefined`; Visitor is not a role |
| `authBoundaries.test.ts` | `requireUser`/`requireAdmin`/`requireStudent` against live membership; Student refused Admin; Visitor refused; legacy membership grants nothing; unknown roles discarded; every privileged param rejected; the registered function surface is exactly login/current-user/logout; no Student password flow; no `getAppSetting` |
| `schemaAccess.test.ts` | registered classes are exactly `_Role`,`_User`,`File`,`IMG`; no `AppSettings`; no future model; `_Role` is Admin-scoped; deny-by-default CLP; no public wildcard ACL; protected fields; the schema guard rewrites and aborts correctly |
| `seeding.test.ts` | clean-DB seeding; idempotency across three runs; `SuperAdmin`→`Admin` migration; empty `Employee` removed; populated `Employee` retained, never promoted, never deleted; stale collection reported not deleted |
| `redaction.test.ts` | 20 canary tests — top level, deep nesting, arrays, mixed casing, dropped bodies, errors with request data, Parse objects, buffers, circular graphs, Parse `Input:`/`Result:` lines, query strings |
| `userDto.test.ts` | DTO key allow-lists; no session token on the routine DTO; no email/phone/authData/ACL anywhere; role names only |
| `env.test.ts` | missing-key reporting by name; no value ever in the failure message |

`test/support/parseTestGlobal.ts` installs the **real** Parse JS SDK (resolved through
`parse-server`, so no new dependency) as the `Parse` global, rather than a stub, so decorators and
`Parse.Object.extend`/`registerSubclass` behave as in production. It also tracks and `unref`s the
interval the kit starts at import and clears it in an `after()` hook — the suite therefore exits
cleanly with **no `--test-force-exit` and no hidden open handle**.

**Frontend — Vitest** (`pnpm run test`, 85 tests): `user-roles.spec.ts`, `role.guard.spec.ts`
(Admin allowed, Student/Visitor refused, role-set awareness, legacy roles refused),
`session.service.spec.ts` (safe-DTO sanitisation, legacy-role stripping, logout clears state),
`change-lang.service.spec.ts` (EN/AR init, `dir`/`lang` sync, no flash), `user-service.spec.ts`
(surface, safe restore, logout), `auth.component.spec.ts` (exactly one password field, no Student
credential UI, no signup/reset/change, no non-functional OAuth button),
`app.branding.spec.ts` (EN/AR parity, branding, retired vocabulary, approved copy, route surface),
and `security.credentials.spec.ts` (frontend credential audit — see §16a).

Backend suites added in the closeout: `cors.test.ts` (allow-list resolution, rejected origins,
missing-Origin, production-without-config, development fallback, no-wildcard, Parse `allowOrigin`
semantics, explicit credentials/methods/headers) and `generatorCredentials.test.ts` (no hardcoded
Admin-password fallback, weak/missing values rejected, password never printed, written only to the
ignored `.env`, existing `.env` never overwritten, secure RNG for server keys).
- **CI — `.gitlab-ci.yml`** (GitLab, while the remote is GitHub): stages `build` → `deploy`,
  every job gated on `$CI_COMMIT_BRANCH == "dev"`, image `node:20-alpine`.
  `build:backend` → `pnpm install`, `rm -rf build/src/cloudCode build/src/app.js`, `npx tsc`.
  `build:frontend` → `sed` patches `appVersion` to `0.1.$CI_PIPELINE_IID`,
  `pnpm install --shamefully-hoist`, `npx ng build --configuration=production`.
  `deploy:backend` → rsync `backend/build/src/`, md5-compare `package.json`, `docker compose up
  --build -d` or `docker restart`. `deploy:frontend` → wipe and rsync
  `frontend/dist/$FRONTEND_BUILD_NAME/browser/`. Requires `SSH_PRIVATE_KEY`,
  `STAGING_SERVER_IP`, `STAGING_SERVER_USER`, `COMPOSE_DIR`, `BACKEND_DEPLOY_DIR`,
  `BACKEND_CONTAINER`, `FRONTEND_BUILD_NAME`, `FRONTEND_DEPLOY_DIR`.

## 15. Protected and generated files

**Protected (per `CLAUDE.md`) — never modify:**
`backend/src/cloudCode/utils/`, `backend/src/cloudCode/database/`,
`backend/src/cloudCode/models/User.ts`, `models/IMG.ts`, `models/File.ts`,
`backend/src/cloudCode/modules/User/`, `.claude/settings.json`, and the skills/agents that live
in the `90soft-toolkit` plugin repo (not in this repo).

**Untracked / generated / environment:** `backend/.env`, `backend/dashboard.json`,
`backend/build/`, `backend/logs/`, `backend/files/`, `frontend/dist/`, `frontend/.angular/cache`,
`frontend/out-tsc/`, `frontend/tmp/`, all `node_modules/`, and `package-lock.json`.

**Tracked as source (previously ignored, corrected in the Phase 0 closeout):** all three
`pnpm-lock.yaml` files, the five `docs/*.md` context documents, and both
`docs/prototypes/*.html` references.

**Skills and agents:** delivered by the `90soft-toolkit@90soft` plugin declared in
`.claude/settings.json`. `.claude/skills/` and `.claude/agents/` **do not exist in this repo**,
contrary to `README.md`.

## 16. Extension guidance

Adding a backend entity:
1. `backend/src/cloudCode/models/{Name}.ts` — `@ParseClass('{Name}', {clp, ACL, description,
   compoundIndexes})` extending `BaseModel`, fields via `@ParseField`. **Always declare `ACL`
   explicitly** — omitting it yields a public read+write default (§5).
2. `backend/src/cloudCode/modules/{Name}/functions.ts` — a `@Route({Name})`-decorated class with
   `@CloudFunction`-decorated methods. Never create index files; discovery is by directory scan.
3. Use `catchError()` for all async work; import `UserRoles` and `MAX_QUERY_LIMIT` from the kit
   rather than hard-coding.
4. For LiveQuery, add the class to `liveQuery.classNames` in `parseConfig.ts` **and** a
   `beforeSubscribe` hook in `main.ts`.
5. Beware `toKebabPlural` when the class name already ends in `s` — pass an explicit string to
   `@Route('…')` instead.

Adding a frontend entity: interface in `app/models/`, service in `app/services/dataService/`,
pages under `app/pages/{feature}/`, a lazy route in `app.routes.ts`, a nav entry in
`shell.component.ts` (`allNavItems`), and keys in **both** `public/i18n/en.json` and `ar.json`.

## 16a. Credentials — what is public, what is not ⟨CP1⟩

### `parseApiKey` in frontend source is **public client configuration, not a secret**

`frontend/src/environments/environment{,.prod}.ts` declare `parseApiKey`, which is the Parse
**REST API key** (verified: it equals the backend's `restAPIKey`, and is neither the `masterKey`
nor the `javascriptKey`). It is sent as the `X-Parse-REST-API-Key` header on every browser request.

Parse client keys — `restAPIKey`, `javascriptKey`, `clientKey`, `dotNetKey` — **identify an
application; they do not authorise anything.** They are designed to ship inside client
applications. In this product all authority comes from the session token plus live `_Role`
membership, on top of deny-by-default CLP, so possession of this key grants a caller nothing they
could not already attempt.

An earlier Phase 0 note classified this as a committed secret requiring rotation (gap "S-13").
**That classification was wrong and is corrected here.** It is not a Master Key and does not
require rotation on security grounds. The only remaining observation is hygiene: development and
production currently use the same value, which is worth differentiating but is not a
vulnerability.

### What must never appear in frontend source

`masterKey`, `readOnlyMasterKey`, `maintenanceKey`, any database URI, any OAuth client secret, and
any Admin password. `security.credentials.spec.ts` enforces this: it asserts the environment
objects declare only an allow-list of keys, contain no key name matching a backend-credential
fragment, and contain no Mongo URI, embedded URL credentials, or Parse session token. It also
checks that production is not left pointing at localhost and that the production websocket uses TLS.

### The project generator ⟨CP1 closeout⟩

`create-project.js` previously prompted for the Admin password with a hardcoded, publicly-known
default, echoed the chosen password to stdout twice on success, and overwrote any existing `.env`.
All three are fixed:

- **No default and no fallback.** `resolveAdminPassword()` reads `CYF_ADMIN_PASSWORD` or prompts
  with terminal echo suppressed. `validateAdminPassword()` requires ≥ 12 characters, no
  surrounding whitespace, and rejects a deny-list of well-known placeholders. Failure aborts with
  a message that states the rule, never the value.
- **Never printed.** The completion summary shows the username only; no `console.*` call
  interpolates the password; the top-level catch prints `err.message` rather than the error
  object; and the value is never passed to a shell command.
- **Written to exactly one place** — the generated `backend/.env`, which the template git-ignores.
- **An existing `.env` is never overwritten** — the generator stops instead. `backend/setup.js`
  now does the same.
- `backend/setup.js` also generated the `masterKey` and `restAPIKey` with **`Math.random()`**,
  which is predictable and unsuitable for secrets. Both generators now use `crypto.randomBytes`.

`create-project.js` only runs under `require.main === module`, and its readline interface is
created lazily, so the credential rules can be imported and tested without launching the generator.

## 16b. UI/UX design system ⟨CP2A⟩

### Direction
Premium, calm, professional educational SaaS. Restrained radii, three elevation steps, one accent
family, no gradients or glassmorphism, no decorative filler. The prototypes informed composition
only; the product requirements governed content.

### Layers — strictly additive
Three new stylesheets are imported at the top of `styles.css`. **Nothing was removed from it.**

| File | Contains |
|---|---|
| `src/styles/tokens.css` | semantic tokens for colour, surface, text, border, focus, status, disabled, spacing, radius, shadow, layout widths, control/touch sizes, motion — all derived from PrimeNG `--p-*`, plus a `.dark` scale |
| `src/styles/typography.css` | type scale (`--cyf-text-*`), line heights, weights, tracking, the `.cyf-*` type classes, language-aware font stacks, and the `prefers-reduced-motion` reset |
| `src/styles/layout.css` | page/container/auth scaffolding, surfaces, form fields, alerts, buttons, language switch, focus ring, `.cyf-sr-only`, skip link, spinner, and the global overflow guard |

Rule for new code: use `--cyf-*` tokens; do not reach for `--p-surface-###` directly. Existing
template styles that already use `--p-*` were left untouched.

### Typography
Hierarchy: `.cyf-display`, `.cyf-page-title`, `.cyf-section-title`, `.cyf-card-title`, `.cyf-body`,
`.cyf-body-sm`, `.cyf-lead`, `.cyf-label`, `.cyf-helper`, `.cyf-meta`, `.cyf-error-text`,
`.cyf-nav-text`, `.cyf-button-text`.

English uses a system UI stack; Arabic keeps **Cairo**, which is already self-hosted in
`public/Cairo/` — **no remote font CDN is introduced**, so nothing becomes a runtime network
dependency. Arabic also gets larger line heights.

> **Documented conflict and the minimal adjustment.** `styles.css` contains
> `*, body { font-family: 'Cairo', sans-serif; }`. Cairo is an Arabic-first face and remains the
> right default for Arabic, so **that rule was left exactly as it is**. For English a single scoped
> override applies — `html[lang='en'] *:not([class*='fa-']):not([class*='pi-'])`. Icon-bearing
> elements are *excluded* rather than re-declared, so Font Awesome's and PrimeNG's own
> `font-family` rules apply whatever version is installed.
>
> An earlier revision instead re-asserted `font-family: 'Font Awesome 6 Free'` after the override.
> That broke **every icon in English**: the installed package is Font Awesome **7.3.1**, the named
> family did not exist, and each glyph fell back to a missing-character box. Arabic was unaffected,
> which is precisely how the bug hid. Caught by visual inspection, not by any test — see
> [HANDOFF.md](HANDOFF.md).

### Layout
`.cyf-container` with responsive gutters (1rem → 1.5rem → 2rem) and width caps
(`--cyf-width-form|narrow|content|wide`). Auth uses a single centred column, switching to a balanced
two-column split at 1024px. Everything is expressed with **CSS logical properties**
(`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, `text-align: start`), so one
stylesheet serves LTR and RTL — there is no duplicated RTL stylesheet. `html, body` carry
`overflow-x: hidden` as a global overflow guard.

### Primitives
Deliberately few: `cyf-brand-mark`, `cyf-auth-layout` (header + main + decorative aside + skip
link), `cyf-language-switch`, `cyf-alert`. Plus CSS-only patterns (`.cyf-card`, `.cyf-field`,
`.cyf-input`, `.cyf-btn-outline`, `.cyf-link`, `.cyf-sr-only`). PrimeNG's `p-button` is used for the
primary action rather than re-implemented. No component library was built and no existing template
component was removed.

### Accessibility baseline
One `h1` per page (verified at runtime across all 20 viewport/language combinations) · `<header>` /
`<main>` / `<aside>` landmarks · skip link · real `<label for>` on every field (no placeholder-only
labelling) · `autocomplete="username"` / `current-password` · accessible password toggle
(`<button type="button">` with `aria-pressed` and a state-dependent `aria-label`) · `role="alert"` +
`aria-live="assertive"` for errors, `role="status"` + `polite` for notices · status never by colour
alone (icon + visually hidden "Error:" / "Note:" prefix) · `:focus-visible` ring on every
interactive element · 44px minimum control and touch target · decorative aside `aria-hidden` · no
autofocus · reduced-motion honoured.

## 17. Known limitations of the template

1. No environment validation; missing `.env` keys fail at runtime.
2. Port 1337 is hard-coded.
3. ~~No lockfile is tracked~~ — **fixed in the Phase 0 closeout**: all three `pnpm-lock.yaml`
   files are trackable and the package manager is pinned to `pnpm@10.33.0` (§14).
4. **Zero tests in the clean template.** There are no `*.spec.ts` / `*.test.ts` files anywhere in
   `backend/src` or `frontend/src`; `backend/package.json` has **no `test` script** at all (its
   `tsconfig.json` includes a `test/**/*.ts` path for a directory that does not exist); and
   `pnpm run test` in the frontend exits 1 with `No tests found matching the following patterns` —
   that is **test absence, not test failure**. The Vitest runner itself is functional (proved in
   Phase 0 with a temporary probe spec that passed and was then deleted). Standing up both harnesses
   is Checkpoint 1 work.
5. ⟨CP1⟩ **Fixed** — `masterKeyIps` is localhost-only and CORS fails closed (§11a). No wildcard
   remains on any path; production without `CORS_ORIGINS` denies every cross-origin request.
6. ⟨CP1⟩ **Fixed** — `IMG` and `File` are deny-by-default with an empty ACL.
7. ⟨CP1⟩ **Fixed** — `/api/files/*` returns 403 and the static `backend/files/` mount is removed.
8. No MIME / extension / size / magic-byte validation on any upload path. Deliberately deferred:
   no upload path is reachable by a client today (`fileUpload.*` all `false`), and the real rules
   arrive with StudentProfile photos (5 MiB, image-only) and Resources (20 MiB, PDF + `%PDF-`
   signature).
9. ⟨CP1⟩ **Fixed** — recursive redaction boundary covering Parse Server's own logs.
10. `fileAdapter.ts` is dead code with a broken `validateFilename`.
11. `toKebabPlural` mis-pluralises names ending in `s` (`app-settingses`).
12. ⟨CP1⟩ **Fixed** — `seedAll()` is awaited.
13. Only unique indexes are applied; `applyAllIndexes` is never called. Moot today: removing
    `AppSettings` removed the only unique index, so startup logs `No indexes to apply`.
14. Hash-based routing (`withHashLocation`) makes deep links `…/#/path`.
15. ⟨CP1⟩ **Fixed** — `roleGuard` and `appIfRole` are role-set aware.
16. The interceptor truncates every Parse `Date` to `YYYY-MM-DD`, losing the time component.
17. ⟨CP1⟩ **Fixed** — `signupUser` deleted; `_User` `create` CLP is `{}` and Parse's `POST /users`
    returns 404.
18. Unused dependency surface: `nodemailer`, `pdfkit`, `multer`, `web-push`, `node-cron`,
    `node-geocoder`, `node-schedule` are declared but imported nowhere in `backend/src`.
19. ⟨CP1⟩ The six `login*.webp` references were removed (they always 404'd). `favicon.ico` is still
    referenced by `index.html` and still absent.
20. `PROJECT.md`, `GENERATE.md`, `README.md`, and `backend/CLAUDE.md` reference paths and
    entities that do not exist (`.claude/skills/`, `.claude/agents/`, `models/Employee.ts`,
    `decorator/`, `swagger/`, `database/schema.ts`, `backend/.env.example`, `deploy.js`).
21. `backend/package.json` declares `parse-server: ^9.9.0`; **9.10.0** is installed.
22. ⟨CP1⟩ Residual: the kit's `extractMasterKey` still accepts a master key from the request body
    and its `rateLimit` module starts a non-`unref`'d `setInterval` at import. Both live in
    `@90soft/parse-server-kit`, which must not be patched; the interval is neutralised in the test
    harness and the body-key path is not exploitable in this configuration.
