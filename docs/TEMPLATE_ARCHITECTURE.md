# Template Architecture

What the full-stack template actually is, traced from source at baseline commit `c1517e4`.
Every claim below was verified against source or observed at runtime — not taken from README.

Planned Code Your Future models and features are marked **Not implemented**.

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
│   ├── package.json             Parse Server 9.x + Express 5 + TS 5.2
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
│           ├── database/seed.ts seedRoles + seedAdminUser + seedLookupTable helper
│           ├── models/          AppSettings, File, IMG, User
│           ├── modules/         AppSettings/functions.ts, User/functions.ts
│           └── utils/           fileAdapter, handleFile, handleImage,
│                                imageProcessing, sharedGetFields, config/parseConfig
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
            ├── pages/auth, pages/dashboard, pages/users
            ├── pipes/relative-time.pipe.ts, time12h.pipe.ts
            ├── services/          api.ts, http.interceptor.ts, session.service.ts,
            │                      live-query.service.ts, change-lang, switch-theme,
            │                      toast, confirm, export, page-title, shared-vars,
            │                      dataService/user-service.ts
            └── utils/catchError.ts, palette-generator.ts
```

**126 files tracked at baseline `c1517e4`. Zero test files.** The Phase 0 closeout makes three
`pnpm-lock.yaml` files (root, `backend/`, `frontend/`), five `docs/*.md` documents, and two
prototypes trackable. They are untracked-but-no-longer-ignored, awaiting the first Phase 0 commit —
nothing has been staged or committed.

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
| `compile` | `tsc` |
| `watch` | `tsc --watch` |
| `clean` | `rimraf build` |
| `start` | `rimraf build && tsc && node --max-old-space-size=1024 ./build/src/app.js` |
| `dev` | `nodemon --watch src --ext ts --exec "npx kill-port 1337 && rimraf build && tsc && node … app.js" && npm run db` |
| `setup` | `node setup.js` |
| `db` | `parse-dashboard --config backend/dashboard.json` |
| `deploy` | `node deploy.js` |

Frontend scripts: `start` → `ng serve`, `build` → `ng build` (defaults to `production`),
`test` → `ng test`, `watch`, `ng`.

**No backend `test` script exists.**

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
| 4 | `app.use(cors())` | **All origins allowed.** |
| 5 | `app.use(mountPath, validateEntityRoutes)` | `/api/{entity}/{action}` → 404/405 check → rewrite to `/functions/{name}` → merge GET query into body → force `POST`. |
| 6 | `app.use(mountPath + '/functions', validateFunctionRoutes)` | Legacy path; registry + method check, force `POST`. |
| 7 | `app.use(conditionalJsonMiddleware)` | `express.json({limit:'10mb', type:['text/plain'], verify: extractMasterKey})`; skipped for `${mountPath}/files`. |
| 8 | `app.use(mountPath, restrictRoutes)` | Blocks everything except `/health`, `/serverInfo`, `/files`, registered entity prefixes, and `/functions*`. Body master key bypasses it. |
| 9 | `app.use(mountPath, parseServer.app)` | Mounts the Parse REST API at `/api`. |
| 10 | `app.use(express.static('../../files'))` | Serves `backend/files` at the **web root**, unauthenticated. |
| 11 | `app.use('/.well-known', express.static(…))` | Domain-verification files. |
| 12 | `CloudFunctionRegistry.initialize()` | `Parse.Cloud.define(name, handler, validation)` per function, then `RouteRegistry.initialize()` builds the route map. |
| 13 | `TriggerRegistry.initialize()` | Registers all decorator-declared triggers. |
| 14 | `CronRegistry.initialize()` | No jobs in this template. |
| 15 | `setupSwagger(app, {basePath: mountPath})` | Serves `/api-docs` and `/api-docs/json`. |
| 16 | `server.listen(1337, …)` | Then `seedAll()` (**not awaited**), `await applyUniqueIndexes()`, `await applyMongoValidators()`. |
| 17 | `ParseServer.createLiveQueryServer(server)` | LiveQuery WebSocket server on the same HTTP server. |
| 18 | `server.on('upgrade', …)` | Logs every WebSocket upgrade URL. |

Port `1337` is **hard-coded** in `app.ts:118`; only `mountPath` comes from the environment.

`main()` is called with `.then/.catch` — a boot failure is logged and the process stays alive.

### Cloud Code entry — `backend/src/cloudCode/main.ts`
`importFiles(models)` then `importFiles(modules)`; **no index files** — discovery is by directory
scan. The `beforeSubscribe` LiveQuery guard block is present but fully commented out.

### Parse Server config — `utils/config/parseConfig.ts`

| Option | Value |
|---|---|
| `databaseURI`, `appName`, `appId`, `restAPIKey`, `masterKey`, `javascriptKey`, `serverURL`, `publicServerURL`, `mountPath` | from `.env` |
| `cloud` | `'./build/src/cloudCode/main.js'` |
| `masterKeyIps` | `['::/0','0.0.0.0/0']` — **all IPs** |
| `protectedFieldsTriggerExempt` | `true` |
| `requestComplexity.batchRequestLimit` | `50` |
| `fileUpload` | `enableForAnonymousUser: true`, `enableForAuthenticatedUser: true`, `enableForPublic: false` |
| `liveQuery.classNames` | `[]` (empty) |
| `schema` | `createSchemaConfig()` |

`utils/fileAdapter.ts` defines a full local-disk `FileAdapter` (create/delete/read/stream with
HTTP Range support) but **is never referenced** — no `filesAdapter` key is passed, so Parse
Server uses its default GridFS adapter.

### Environment validation
**There is none.** `parseConfig.ts` reads `process.env` directly; `app.ts` casts
`process.env.mountPath as string`. Missing keys surface as runtime failures, not startup errors.

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
`IMG` and `File` are both in that state.

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

- **CLP:** `find`/`get`/`count` → SuperAdmin + Employee; `create`/`delete` → SuperAdmin;
  `update` → SuperAdmin + Employee.
- **protectedFields:** `{'*': ['email'], authenticated: []}` — any authenticated user can read
  every user's email.
- **ACL:** SuperAdmin read+write, Employee read.
- **Triggers:** none.
- **Exposure:** via `User.map()` → `{id, email, username, firstName, lastName, phoneNumber, createdAt, updatedAt, sessionToken, role}`.

### `AppSettings` — `models/AppSettings.ts`
Extends `BaseModel`.

| Field | Type | Notes |
|---|---|---|
| `key` | String | `required: true`, `unique: true` → index `key_unique` |
| `value` | String | ISO string / JSON / plain text |

- **CLP:** `find`/`get` → SuperAdmin + Employee; `count`/`create`/`update`/`delete` → `{}` (no one but master key).
- **ACL:** SuperAdmin read+write, Employee read.
- **Triggers:** none. **Exposure:** `getAppSetting` returns `setting.value` only.
- **Route:** `/api/app-settingses/getAppSetting` — mis-pluralised by the kit's `toKebabPlural` (§5).

> **Decision note — scheduled for removal (OQ-13, resolved).** The product owner has decided this
> legacy feature will be **removed during Phase 1 (Checkpoint 1)**: it has no consumer (the only
> reference to `getAppSetting` in `backend/src` or `frontend/src` is its own definition), Code Your
> Future has no confirmed requirement for a generic settings model, retaining it needlessly widens
> the API and security surface, and its route prefix is legacy behaviour. Future configuration needs
> must use narrowly scoped, typed, sanitised endpoints instead of a generic settings store.
>
> **It is still present as described above** — this section documents the template as it exists
> today. Nothing has been removed yet; the route prefix therefore needs no `@Route('app-settings')`
> fix, since the class goes away with it. After removal the registered classes will be `_User`,
> `File`, and `IMG`.

### `IMG` — `models/IMG.ts` (protected)

| Field | Type |
|---|---|
| `image` | File |
| `imageThumbNail` | File |
| `blurHash` | String |

- **CLP:** all six operations → SuperAdmin + Employee.
- **ACL:** **none declared → public read+write default object ACL.**
- **Triggers:** `beforeSave` (WebP conversion, thumbnail, blurhash via `processImage`; skipped
  unless the `image` field is dirty), `afterSave` (destroys the previous files when the name
  changed), `afterDelete` (destroys both files).

### `File` — `models/File.ts` (protected)

| Field | Type |
|---|---|
| `file` | File |
| `fileSize` | Number |
| `type` | String |

- **CLP:** `find`/`get`/`create`/`update`/`delete` → SuperAdmin + Employee (**no `count` entry**).
- **ACL:** **none declared → public read+write default object ACL.**
- **Triggers:** `beforeSave` sets `type` from the filename extension on create. `fileSize` is
  declared but never populated.

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

### Roles
`UserRoles` in the kit: `ADMIN = 'SuperAdmin'`, `EMPLOYEE = 'Employee'`. The frontend mirrors
this in `frontend/src/app/config/user-roles.ts`. **Neither `Admin` nor `Student` exists.**

### Seeding — `database/seed.ts`
`seedAll()` → `seedRoles()` then `seedAdminUser()`.
- `seedRoles()` creates any missing `_Role` from `Object.values(UserRoles)` with an ACL granting
  SuperAdmin read+write and no public access.
- `seedAdminUser()` creates a user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`,
  defaulting to `admin` / `ChangeMe!2024` / `admin@example.com`, then adds it to the SuperAdmin role.
- `seedLookupTable()` is a private helper, currently unused (declared-but-unused).
- `seedAll()` is invoked **without `await`** inside the `listen` callback, so seeding races with
  `applyUniqueIndexes` / `applyMongoValidators`.

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
`_Role` CLP is generated by `createSchemaConfig()`: all six operations restricted to
`role:SuperAdmin`.

### Master Key
- `Parse.masterKey` is set globally in `app.ts`.
- `masterKeyIps: ['::/0','0.0.0.0/0']` — no IP restriction.
- Every read/write in `modules/User/functions.ts` uses `{useMasterKey: true}`, so CLP is bypassed
  and authorisation depends entirely on `validation.requireAnyUserRoles`. The one exception is
  `searchEmployees`, whose final `find()` uses `{sessionToken}`.
- `extractMasterKey` (the `express.json` verify hook) lifts `masterKey` / `_MasterKey` out of the
  request **body** into `req['x-master-key']`, and `restrictRoutes` treats a match as a full
  bypass. Probed at runtime: a `text/plain` body carrying the master key against
  `/api/classes/AppSettings` returned **403**, so the path is not exploitable in this
  configuration — but the code path exists.

## 9. Cloud functions and REST routes

11 functions, 11 routes. Observed at runtime and in `/api-docs/json`.

| Route | Function | Methods | Validation |
|---|---|---|---|
| `/api/users/loginUser` | `loginUser` | POST | `requireUser: false`; `username`, `password` required |
| `/api/users/signupUser` | `signupUser` | POST | `requireUser: false`; `username`, `email`, `password` required → assigns `Employee` |
| `/api/users/getCurrentUser` | `getCurrentUser` | GET | `requireUser: true` |
| `/api/users/logout` | `logout` | POST | *(no validation block)* |
| `/api/users/listUsers` | `listUsers` | GET | `requireUser`, `requireAnyUserRoles: ['SuperAdmin','Employee']` |
| `/api/users/getUser` | `getUser` | POST | `requireAnyUserRoles: ['SuperAdmin']` |
| `/api/users/createUser` | `createUser` | POST | `requireAnyUserRoles: ['SuperAdmin']` |
| `/api/users/updateUser` | `updateUser` | POST | `requireAnyUserRoles: ['SuperAdmin']` |
| `/api/users/deleteUser` | `deleteUser` | POST | `requireAnyUserRoles: ['SuperAdmin']` |
| `/api/users/searchEmployees` | `searchEmployees` | GET | `requireUser: true` |
| `/api/app-settingses/getAppSetting` | `getAppSetting` | POST | `requireUser: true`; `key` required |

Both the entity route and the legacy `/api/functions/{name}` path work and both correctly pass
GET query parameters through (verified: `?limit=1&withCount=true&searchString=…` returned
`{"results":[],"count":0}` on both paths).

Cloud functions return data **directly**; `removeResultMiddleware` strips Parse's `{result: …}`
wrapper server-side, so the frontend must not unwrap it again.

## 10. Files and images

- **Storage:** Parse Server's default **GridFS** adapter (Mongo). The bespoke local-disk
  `FileAdapter` in `utils/fileAdapter.ts` is dead code.
- **Public URL shape:** `/api/files/{appId}/{filename}` — served by Parse Server, allowed through
  `restrictRoutes` (`/files` is a system route), and **unauthenticated**. Verified: an
  unauthenticated GET for a non-existent file returns 404, i.e. it is reachable, not blocked.
- `express.static(join(__dirname,'../../files'))` additionally serves `backend/files/` at the web
  root with no auth.
- **Image pipeline** (`utils/imageProcessing.ts`): `axios` downloads the uploaded file by URL,
  `sharp` produces a 1000 px WebP at quality 70 (`large`) and quality 30 (`thumbnail`), and
  `blurhash.encode` produces a 4×4 hash. Triggered from `IMG.beforeSave`.
- **Upload entry points:** `handleFileLogic` / `handleFileArrayLogic` and `handleImageLogic` /
  `handleImageArrayLogic` accept `{base64, name}` payloads and save with `useMasterKey`.
  **No MIME check, no extension check, no size limit, no magic-byte check** anywhere.
- `fileAdapter.validateFilename()` *returns* a `Parse.Error` instead of throwing, `createFile`
  ignores the return value, and the character-class check is commented out — the validation is
  a no-op even if the adapter were wired in.

## 11. Logging and errors

- **Logging** is `console.log` / `console.error` plus Parse Server's own winston logger
  (`backend/logs/`, git-ignored). Startup prints every model path, every registered function,
  every route, and every WebSocket upgrade URL. **There is no redaction layer** — nothing strips
  tokens or keys from log output.
- **Errors:** `catchError(promise)` returns `[error, result]`; `backend/CLAUDE.md` forbids
  `try/catch` with `await` outside synchronous code and whole-function boundaries. Handlers throw
  `Parse.Error` with explicit codes. Middleware returns bare JSON (`{message}`) with 403/404/405.
- Unauthenticated calls to a `requireUser: true` function return **HTTP 400** (Parse validation),
  not 401.

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

### Routing and guards — `app.routes.ts`
```
/auth                        AuthComponent (public, lazy)
''      canActivate:[authGuard]  ShellComponent (lazy)
  ''        → redirect to dashboard
  dashboard                  DashboardComponent (lazy)
  users     canActivate:[roleGuard(ADMIN, EMPLOYEE)]  UsersComponent (lazy)
```
Every route is lazy (`loadComponent`). `authGuard` redirects to `/auth` when no token;
`roleGuard(...roles)` compares against `sessionService.userRole()` (**the first role only**) and
redirects to `/dashboard` on failure.

### Session handling — `services/session.service.ts`
Signals `user` / `token` hydrated from `localStorage` keys `currentUser` and `sessionToken`;
`isLoggedIn` / `userRole` / `userDisplayName` computed. `saveSession` / `clearSession` write
through to `localStorage`.

### API layer
- `ApiService<T>` — generic `getList` / `getSingle` / `add` / `update` / `edit` / `delete`,
  built on `HttpClient`, base URL from `SharedVarsService` → `environment.apiUrl`.
- `services/dataService/user-service.ts` — calls the **legacy `/functions/{name}` paths**, not
  the entity routes.
- `http.interceptor.ts` — injects `X-Parse-Application-Id` and `X-Parse-REST-API-Key` on every
  request, adds `X-Parse-Session-Token` from `localStorage`, converts every Parse `{__type:'Date',
  iso}` value to a `YYYY-MM-DD` **string** (dropping the time component), toasts every error, and
  on Parse error codes 142/209 clears the token and routes to `/auth`.

### State, forms, UI
- **State:** Angular signals throughout (`signal`, `computed`, `effect`, `input()`, `output()`),
  `ChangeDetectionStrategy.OnPush` everywhere, `inject()` instead of constructor injection,
  `takeUntilDestroyed(destroyRef)` for component subscriptions.
- **RxJS 7.8** for HTTP only.
- **Typed reactive forms:** *none in the template.* `AuthComponent` uses `FormsModule` with
  `signal()`-backed `[(ngModel)]`-style bindings. There is no `FormGroup` anywhere.
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
- `ChangeLangService` — `currentLang` signal seeded from `localStorage.lang` (default `en`);
  `currentDirection` computed (`ar` → `rtl`); a constructor `effect` writes `dir` onto
  `<html>` and `<body>`; `changeLang()` persists and calls `translate.use()`.
- `initLang()` is called **only** from `ShellComponent.ngOnInit`. On a cold load of `/auth`, the
  direction effect applies RTL from `localStorage` but `translate.use()` is never called, so
  strings stay English until the user toggles.
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
5. `cors()` allows all origins; `masterKeyIps` allows all IPs.
6. `IMG` and `File` default to a public read+write object ACL.
7. Parse file URLs are unauthenticated, and `backend/files/` is also served statically.
8. No MIME / extension / size / magic-byte validation on any upload path.
9. No log redaction.
10. `fileAdapter.ts` is dead code with a broken `validateFilename`.
11. `toKebabPlural` mis-pluralises names ending in `s` (`app-settingses`).
12. `seedAll()` is not awaited.
13. Only unique indexes are applied; `applyAllIndexes` is never called.
14. Hash-based routing (`withHashLocation`) makes deep links `…/#/path`.
15. `roleGuard` and `appIfRole` consider only the user's **first** role.
16. The interceptor truncates every Parse `Date` to `YYYY-MM-DD`, losing the time component.
17. `signupUser` is an open, unauthenticated self-signup endpoint that grants the `Employee` role.
18. Unused dependency surface: `nodemailer`, `pdfkit`, `multer`, `web-push`, `node-cron`,
    `node-geocoder`, `node-schedule` are declared but imported nowhere in `backend/src`.
19. `frontend/public/images/login1..6.webp` and `favicon.ico` are referenced but absent (404).
20. `PROJECT.md`, `GENERATE.md`, `README.md`, and `backend/CLAUDE.md` reference paths and
    entities that do not exist (`.claude/skills/`, `.claude/agents/`, `models/Employee.ts`,
    `decorator/`, `swagger/`, `database/schema.ts`, `backend/.env.example`, `deploy.js`).
21. `backend/package.json` declares `parse-server: ^9.9.0`; **9.10.0** is installed, and
    documentation says 9.9.0.
