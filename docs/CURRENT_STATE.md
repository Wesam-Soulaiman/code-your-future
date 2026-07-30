# Current State

The repository as it exists now: baseline commit `a796aa0` on branch `master` plus the
uncommitted Checkpoint 1 changes listed in §7. Verified on 2026-07-30, Windows 11,
Node v24.18.0, **pnpm 10.33.0 pinned repository-wide**, MongoDB 7.0 (isolated instance on
port 27018 for validation).

Authoritative product behaviour is [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).
This document describes **only what is implemented**.

Nothing shown in `docs/prototypes/` is implemented — the prototypes are static HTML/JS mockups
with hard-coded state, not application code.

---

## 1. Working — verified

### Build, install, test
| Item | Evidence |
|---|---|
| Reproducible install | `pnpm install --frozen-lockfile` → exit 0 in root, `backend/`, `frontend/` |
| Single pnpm version | `pnpm -v` → `10.33.0` in all three directories |
| Backend type-check | `npx tsc --noEmit` → exit 0, zero diagnostics |
| Backend compile | `pnpm run compile` → exit 0 (now cleans `build/` first) |
| **Backend tests** | `pnpm run test` → **184 pass, 0 fail**, exits cleanly with no force-exit |
| Frontend production build | `pnpm run build` → exit 0, initial bundle 654.87 kB |
| **Frontend tests** | `pnpm run test` → **85 pass, 0 fail** (8 spec files) |
| sharp | real WebP encode after install (44 bytes) |

### Runtime — observed against a clean isolated database
| Check | Result |
|---|---|
| Backend starts | Yes, `Server listening {"port":1338}` |
| Frontend dev server | `GET /` → 200, `<title>Code Your Future</title>` |
| Swagger | `/api-docs/json` → 200, OpenAPI 3.0.3 |
| **`AppSettings` absent** | 0 occurrences in the Swagger document; no model, no route |
| Registered models | **exactly `_Role`, `_User`, `File`, `IMG`** (schema guard log) |
| Registered routes | **exactly 3** — `loginUser`, `getCurrentUser`, `logout` |
| Triggers | 4 (`File.beforeSave`, `IMG.beforeSave`/`afterSave`/`afterDelete`) |
| Indexes | `No indexes to apply` (the only unique index went with `AppSettings`) |
| Roles on a clean DB | `{"created":["Admin","Student"]}` — exactly these two |
| Admin account | created once, granted the Admin role; `adminUserCreated:false` on re-run |
| No Student seeded | Student role created with 0 members |
| Admin login | 200; DTO keys `id,roles,sessionToken,username`; `roles:["Admin"]` |
| Session restore | DTO keys `id,roles,username` — **no** `sessionToken`, **no** `email` |
| Wrong password | 404 `Invalid credentials` (same response as unknown user) |
| Logout | `{"success":true}`; reusing the token afterwards → 400 |
| Privileged param | `role` in the login body → `119 These parameters are not accepted from clients: role` |
| **Student password login** | **refused with the correct password** — `119 This account cannot sign in with a password`, and `_Session` count back to **0** (transient session revoked) |
| Direct `_User` create | `POST /api/users` → **404** (route resolves nothing) |
| `/classes/_User` | **403** |
| `/classes/File`, `/classes/IMG` | **403** each |
| `/classes/_Role`, `/classes/_Session` | **403** each |
| `/schemas` | **403** |
| `/requestPasswordReset` | **403** |
| Raw file route | `/api/files/{appId}/x.pdf` → **403** |
| `app-settingses` route | **403** |
| Master key in body | 403 (not exploitable in this configuration) |
| Logs | no master key, no admin password, no REST key, no database URI, no session token; Parse's own `Input:`/`Result:` lines show `password:"[REDACTED]"`, `sessionToken:"[REDACTED]"`, `params:"[OMITTED]"` |
| EN/AR | 71 keys each, no drift; `app.name` = `Code Your Future`; no `users` block |
| **CORS — allowed origin** | `Origin: http://localhost:4200` → `Access-Control-Allow-Origin: http://localhost:4200` |
| **CORS — rejected origin** | `Origin: https://evil.example.test` → header does not match the requester → browser blocks |
| **CORS — no wildcard** | no response in any configuration contains `Access-Control-Allow-Origin: *` |
| **CORS — production, unset** | error logged at startup; every origin receives `https://cors-disallowed.invalid` → blocked |
| **CORS — no Origin header** | request succeeds (server-to-server unaffected) |

## 2. Partially working

| Item | State |
|---|---|
| `Student` role | Seeded and enforced, but **no Student can authenticate** — Google OAuth is Checkpoint 3. A Student provisioned server-side is correctly refused password login. |
| `File` / `IMG` | Private and server-controlled, but **no client-reachable path creates or reads one**. The controlled-access extension points are documented, not implemented (OQ-10). |
| `LiveQueryService` (frontend) | Fully implemented; `liveQuery.classNames` is still `[]` and no `beforeSubscribe` hook exists, so no class is subscribable. |
| `fileAdapter.ts` | Still dead code — never passed to Parse Server. Its `validateFilename()` still returns instead of throwing. |
| `File.fileSize` | Declared, never populated. |
| `@Cron` infrastructure | Works; `cron.ts` declares an empty class. |
| Index application | `applyAllIndexes` still never called. Moot: no unique or compound index is declared. |
| MongoDB validators | `applyMongoValidators` runs; almost no field constraints are declared, so validators are effectively empty. |
| `data-table` component | Retained and functional, but unused — no list page exists. |
| Web Push | `sw-push.js` and the `web-push` dependency exist; `vapidPublicKey` empty, no push function. |
| CORS | **Resolved in the closeout.** Fails closed on every path — see [TEMPLATE_ARCHITECTURE.md §11a](TEMPLATE_ARCHITECTURE.md). Production still requires `CORS_ORIGINS` to be set before any browser client can reach the API. |

## 3. Failing

Nothing introduced by this checkpoint fails.

| Item | Result | Classification |
|---|---|---|
| `favicon.ico` | Referenced by `index.html`, absent from `public/` → 404 | Pre-existing code defect (missing asset) |
| `pnpm run db` (backend) | Resolves `backend/backend/dashboard.json` | Pre-existing code defect |
| `backend` `dev` script tail | `&& npm run db` after `nodemon` is unreachable | Pre-existing code defect |
| `pnpm run deploy` (backend) | `node deploy.js` — file does not exist | Pre-existing code defect |
| `tsconfig.json` include | Lists `src/cloudCode/utils/verifiyFile.ts` (misspelled, absent) | Harmless config defect |

**Defect found and fixed during this checkpoint:** `pnpm run compile` used bare `tsc`, which does
not delete orphaned output. After `models/AppSettings.ts` was removed, the stale
`build/src/cloudCode/models/AppSettings.js` was still auto-discovered and **re-registered at
runtime** — the first runtime validation showed 5 classes and an `app-settingses` route despite the
sources being gone. `compile` and `test` now `rimraf build` first. This is exactly why runtime
validation is not optional.

## 4. Environment-dependent / untested

| Item | Note |
|---|---|
| MongoDB | Required. Validation used an isolated `mongod` on port 27018 with a scratch dbpath; the developer's configured database was never touched, and that instance was stopped afterwards. The Windows `MongoDB` service (port 27017) is owned by the developer — it could not be started or stopped from this session without elevation and was left exactly as found. |
| Port | `PORT` env or 1337. `serverURL` must be kept consistent manually. |
| `MASTER_KEY_IPS` | Unset locally, so the master key is localhost-only. Untested with an explicit allow-list. |
| `CORS_ORIGINS` | Unset locally, so the development localhost list applies. The configured branch and the production-without-config branch are covered by unit tests, and production-without-config was additionally verified at runtime with `NODE_ENV=production`. |
| CI | `.gitlab-ci.yml` targets GitLab and branch `dev`; the remote is GitHub/`master`. Not executed. The CI file still has no test step (OQ-14). |
| Deployment | Requires eight CI variables plus Docker. Untested. |
| Windows specifics | Two Angular compiler-cli paths under `frontend/node_modules/.pnpm/` exceed the Windows path limit — `git status --ignored` warns "Filename too long" (cosmetic). |
| Legacy-role migration against real data | Exercised by unit tests with an in-memory store and on a clean database at runtime. **Not** exercised against a database that actually contains a populated `Employee` role. |
| `parse-server` version | `^9.9.0` declared; **9.10.0** installed. |
| Parse deprecation warnings | 13 at boot; all future-default changes, none fatal. |

## 5. Security posture

### Closed in this checkpoint
| # | Was | Now |
|---|---|---|
| S-2 | Parse file URLs unauthenticated | `/api/files/*` → 403 (`blockRawFileRoutes`) |
| S-3 | `backend/files/` served statically at web root | Static mount removed |
| S-5 | `masterKeyIps: ['::/0','0.0.0.0/0']` | `['127.0.0.1','::1']`, or `MASTER_KEY_IPS` |
| S-7 | `IMG`/`File` public read+write default ACL | Deny-by-default `{}` + schema guard that aborts on missing metadata |
| S-8 | `fileUpload.enableForAnonymousUser: true` | All three upload flags `false` |
| S-9 (partial) | No ACL protection on file records | `beforeSave` rejects client-supplied ACL on `File` and `IMG` |
| S-10 | Open `signupUser` granting a role | Deleted; `_User` `create` CLP `{}`; `POST /users` → 404 |
| S-11 | `protectedFields: {'*':['email']}` — any authenticated user could read every email | `email`, `username`, `emailVerified`, `authData`, `phoneNumber` protected for `*` **and** `authenticated` |
| S-12 | No log redaction | Recursive redaction boundary + Parse `loggerAdapter` |
| S-14 | Master key on nearly every user query | Seven client-facing master-key operations deleted with their functions; remaining uses audited and listed |
| — | Anonymous Parse users enabled by default | `enableAnonymousUsers: false` |
| — | Read-only master key usable from any IP | `readOnlyMasterKeyIps: ['127.0.0.1','::1']` |
| — | Stack traces / internals reachable in error bodies | `sanitizedErrorHandler` returns `{"error":"Request failed"}` |
| — | Client could pass `role`, `ACL`, `sessionToken`, … | `rejectPrivilegedParams` refuses 15 parameter names |

### Remaining gaps
| # | Gap | Owner |
|---|---|---|
| S-4 | Session token and user DTO in `localStorage` (XSS-readable) | Checkpoint 11 — storage decision |
| S-6 | The kit's `extractMasterKey` still accepts a master key from the request **body**, and its `restrictRoutes` treats a match as a bypass. Not exploitable in this configuration (403 observed). Lives in `node_modules`; cannot be fixed here | Report upstream / Checkpoint 11 |
| S-9 | No MIME / extension / size / magic-byte validation. Deliberately deferred: no client-reachable upload path exists today | Checkpoints 4 and 7 |
| ~~S-13~~ | **Withdrawn — misclassified.** The committed `parseApiKey` is the Parse **REST API key**, a *client* key that identifies the application and authorises nothing. It is public browser configuration by design, not a secret, and needs no rotation on security grounds. See [TEMPLATE_ARCHITECTURE.md §16a](TEMPLATE_ARCHITECTURE.md). Residual hygiene note only: dev and prod share one value. |
| **S-17** | **Partly fixed.** `create-project.js` no longer carries a default Admin password (see §7), so no *new* environment can inherit one. **The local `backend/.env` still holds the old publicly-known value** — that file is out of bounds for this work, so **rotating the local and any deployed Admin password remains a manual action for the owner.** | Owner action, before Checkpoint 2 |
| **S-18** | **Fixed in the closeout.** `backend/setup.js` generated the `masterKey` and `restAPIKey` with `Math.random()`, which is predictable and unsuitable for secrets. Both generators now use `crypto.randomBytes`. **Any environment whose keys were produced by the old generator should have them regenerated.** | Owner action for existing environments |
| S-15 | Unauthenticated calls to `requireUser: true` functions surface as HTTP 400 from Parse's validator, not 401 | Cosmetic; Checkpoint 11 |
| S-16 | The kit's trigger registry silently overwrites a same-type trigger on the same class | Upstream |
| — | The kit's `rateLimit` module starts a non-`unref`'d `setInterval` at import (blocks clean process exit). Neutralised in the test harness only | Report upstream |

## 6. Legacy template behaviour

### Retired in this checkpoint
`SuperAdmin` / `Employee` as application roles · `signupUser` · `createUser` · `updateUser` ·
`deleteUser` · `listUsers` · `getUser` · `searchEmployees` · `getAppSetting` · `AppSettings` model
and module · `/users` management page and route · `User.map()` · `seedLookupTable()` ·
`userRole()` (first-role-only) · the `nav.users` entry · the `users.*` and `assignUser.*`
translation blocks · six `login*.webp` references that always 404'd · the interceptor's
never-matching `/functions/login` exemption · the hardcoded `ChangeMe!2024` default Admin password.

### Still present
| # | Item | Note |
|---|---|---|
| L-3 | `PROJECT.md` | ⟨updated⟩ now describes the real role model and implemented surface |
| L-4 | `GENERATE.md` | Permission table still defaults to `SuperAdmin, Employee` — **stale**, not yet updated |
| L-5 | `README.md` | ⟨updated⟩ product identification corrected; skills/agents note fixed |
| L-6 | `backend/CLAUDE.md` | Still references `models/Employee.ts` as the ACL example and the kit's `UserRoles` enum — **stale** |
| L-7 | `toKebabPlural` mis-pluralisation | Moot for now: `User` → `/users` is correct, and the one class it broke (`AppSettings`) is gone. Still a trap for a future class ending in `s` |
| L-9 | Parse `Date` truncation in the interceptor | Every `{__type:'Date'}` still becomes `YYYY-MM-DD`, discarding time. Will matter from Checkpoint 4 |
| L-10 | Unused backend dependencies | `nodemailer`, `pdfkit`, `multer`, `web-push`, `node-cron`, `node-geocoder`, `node-schedule` imported nowhere |
| L-12 | `create-project.js` | 290-line template bootstrapper, irrelevant to this project |
| L-14 | Hash routing | `withHashLocation()` still active; deep links are `/#/path` (OQ-12) |
| L-15 | No typed reactive forms | Begins at Checkpoint 4 |
| L-16 | Dark theme default | Unchanged; now initialised at bootstrap |

## 7. Working-tree changes (uncommitted)

```
 M CLAUDE.md  PROJECT.md  README.md
 M docs/CURRENT_STATE.md  docs/HANDOFF.md
 M docs/IMPLEMENTATION_PLAN.md  docs/TEMPLATE_ARCHITECTURE.md
 M backend/package.json
 M backend/setup.js
 M create-project.js
 M backend/src/app.ts
 M backend/src/cloudCode/database/seed.ts
 M backend/src/cloudCode/models/File.ts
 M backend/src/cloudCode/models/IMG.ts
 M backend/src/cloudCode/models/User.ts
 M backend/src/cloudCode/modules/User/functions.ts
 M backend/src/cloudCode/utils/config/parseConfig.ts
 M frontend/public/i18n/ar.json  frontend/public/i18n/en.json
 M frontend/src/app/app.config.ts  frontend/src/app/app.routes.ts
 M frontend/src/app/components/layout/shell.component.html
 M frontend/src/app/components/layout/shell.component.ts
 M frontend/src/app/config/user-roles.ts
 M frontend/src/app/directives/if-role.directive.ts
 M frontend/src/app/guards/role.guard.ts
 M frontend/src/app/models/User.ts
 M frontend/src/app/pages/auth/auth.component.html
 M frontend/src/app/pages/auth/auth.component.ts
 M frontend/src/app/services/change-lang.service.ts
 M frontend/src/app/services/dataService/user-service.ts
 M frontend/src/app/services/http.interceptor.ts
 M frontend/src/app/services/session.service.ts
 D backend/src/cloudCode/models/AppSettings.ts
 D backend/src/cloudCode/modules/AppSettings/functions.ts
 D frontend/src/app/pages/users/users.component.html
 D frontend/src/app/pages/users/users.component.ts
?? backend/src/cloudCode/utils/auth/           (authorize.ts)
?? backend/src/cloudCode/utils/config/cors.ts
?? backend/src/cloudCode/utils/config/env.ts
?? backend/src/cloudCode/utils/config/schemaGuard.ts
?? backend/src/cloudCode/utils/constants/      (roles.ts)
?? backend/src/cloudCode/utils/dto/            (userDto.ts)
?? backend/src/cloudCode/utils/logging/        (redact.ts, safeLogger.ts)
?? backend/test/                               (7 suites + support)
?? frontend/src/app/app.branding.spec.ts
?? frontend/src/app/config/user-roles.spec.ts
?? frontend/src/app/guards/role.guard.spec.ts
?? frontend/src/app/pages/auth/auth.component.spec.ts
?? frontend/src/app/services/change-lang.service.spec.ts
?? frontend/src/app/services/dataService/user-service.spec.ts
?? frontend/src/app/services/session.service.spec.ts
?? frontend/src/app/security.credentials.spec.ts
```

**Not modified:** `backend/.env`, `backend/dashboard.json`, `docs/prototypes/*`, all three
lockfiles, `.gitignore`, `.gitlab-ci.yml`, `docs/PRODUCT_REQUIREMENTS.md`,
`frontend/package.json`, root `package.json`.

## 8. Product features not implemented

None of the following exists in any form — no model, no cloud function, no route, no page, no DTO:

Google/Apple OAuth · StudentAuthIdentity · StudentProfile · institution list ·
`expectedGraduationDate` normalisation · private profile photo · Complete Profile · Student
dashboard · Batch · Batch lifecycle · BatchInvitation · invitation tokens · QR generation ·
`/join/:token` · Enrollment · the pending-invitation flow · Resources · PDF validation · resource
ordering · authorised file download · Live Slides · Tasks · Assignment · Final Task · Submission ·
one-submission locking · Accept-for-publication · Pinned Students · Talent Reels · sanitised public
DTOs for Visitors.

The frontend ships two pages: `/auth` (Admin sign-in) and `/dashboard` (placeholder).
