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
| **Backend tests** | `pnpm run test` → **987 pass, 0 fail**, exits cleanly with no force-exit |
| Frontend production build | `pnpm run build` → exit 0, initial bundle 715.51 kB (over the 500 kB budget, as the template already was) |
| **Frontend tests** | `pnpm run test` → **707 pass, 0 fail** (29 spec files) |
| sharp | real WebP encode after install (44 bytes) |

### Runtime — observed against a clean isolated database
| Check | Result |
|---|---|
| Backend starts | Yes, `Server listening {"port":1338}` |
| Frontend dev server | `GET /` → 200, `<title>Code Your Future</title>` |
| Swagger | `/api-docs/json` → 200, OpenAPI 3.0.3 |
| **`AppSettings` absent** | 0 occurrences in the Swagger document; no model, no route |
| Registered models | **exactly `_Role`, `_User`, `File`, `IMG`, `StudentAuthIdentity`, `StudentProfile`, `ProfileCatalogItem`** (schema guard log) |
| Registered routes | **exactly 14** — five authentication functions, three `student-profile` operations, five `profile-catalogs` Admin operations, and one `student-catalog` Student read — plus one non-Parse binary route, `/api/profile-photo` |
| Triggers | 4 (`File.beforeSave`, `IMG.beforeSave`/`afterSave`/`afterDelete`) |
| Indexes | **2 unique compound indexes created** on `StudentAuthIdentity`: `(provider, providerSubject)` and `(provider, _p_user)` |
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
| Logs | no master key, no admin password, no REST key, no database URI, no session token; Parse's own `Input:`/`Result:` lines show `password:"[REDACTED]"`, `sessionToken:"[REDACTED]"`, `params:"[OMITTED]"`, and ⟨CP2B closeout⟩ `providerSubject:"[REDACTED]"` |
| EN/AR | 71 keys each, no drift; `app.name` = `Code Your Future`; no `users` block |
| **CORS — allowed origin** | `Origin: http://localhost:4200` → `Access-Control-Allow-Origin: http://localhost:4200` |
| **CORS — rejected origin** | `Origin: https://evil.example.test` → header does not match the requester → browser blocks |
| **CORS — no wildcard** | no response in any configuration contains `Access-Control-Allow-Origin: *` |
| **CORS — production, unset** | error logged at startup; every origin receives `https://cors-disallowed.invalid` → blocked |
| **CORS — no Origin header** | request succeeds (server-to-server unaffected) |
| **⟨CP2A⟩ Auth pages render** | `/auth/admin` and `/auth/student` inspected in a real headless Chrome at 1440 / 1024 / 768 / 390 / 360 px in **both** English and Arabic — 20 combinations |
| **⟨CP2A⟩ Horizontal overflow** | **zero** in all 20 combinations (`scrollWidth - clientWidth === 0`) |
| **⟨CP2A⟩ Document lang/dir** | `lang=en`/`dir=ltr` and `lang=ar`/`dir=rtl` correct in all 20 |
| **⟨CP2A⟩ Heading structure** | exactly one `h1` on every page in all 20 |
| **⟨CP2A⟩ Google button** | `disabled === true` on every Student render; no click handler, no HTTP request, no session write |
| **⟨CP2A⟩ Real Admin login** | typed into the redesigned form and submitted → `#/dashboard`, `roles: ["Admin"]`; cached user object holds only `id, username, roles` |
| **⟨CP2A⟩ Admin shell** | inspected signed-in at 1440 EN, 1440 AR, 390 EN — nav is exactly `["Dashboard"]` / `["لوحة التحكم"]`, zero overflow |
| **⟨CP2A⟩ Guest guard** | signed-in Admin navigating to `/auth/admin` lands on `#/dashboard` |

## 2. Partially working

| Item | State |
|---|---|
| `Student` role | Seeded, enforced, and **now reachable**: a verified Google identity provisions a Student ⟨CP2B⟩. A Student still cannot use password login. |
| `File` / `IMG` | Private and server-controlled, and still with **no client-reachable path**. Deliberately untouched by Checkpoint 5: Batch Resources have their own private storage and never go through `Parse.File`. OQ-10 is answered without them — see §7i. |
| `LiveQueryService` (frontend) | Fully implemented; `liveQuery.classNames` is still `[]` and no `beforeSubscribe` hook exists, so no class is subscribable. |
| `fileAdapter.ts` | Still dead code — never passed to Parse Server. Its `validateFilename()` still returns instead of throwing. |
| `File.fileSize` | Declared, never populated. |
| `@Cron` infrastructure | Works; `cron.ts` declares an empty class. |
| Index application | **Resolved in the closeout.** Applied and physically verified during normal startup, before the port opens; a missing or non-unique index fails the boot. See §7h. |
| MongoDB validators | `applyMongoValidators` runs; almost no field constraints are declared, so validators are effectively empty. |
| `data-table` component | The original reusable component now renders all six table surfaces. Server-backed pages use its `loadData` contract; whole-list APIs are searched and paged locally. Grid view, previews, column visibility, refresh, and skeletons are active, while unsupported bulk-delete/export actions remain hidden. The interim `cyf-record-table` adapter was removed. |
| Web Push | `sw-push.js` and the `web-push` dependency exist; `vapidPublicKey` empty, no push function. |
| Dashboard page | Intentionally empty — a placeholder with no fake statistics, charts, or product data. The Admin workspace now has two real pages beside it (Batches, Students); the dashboard itself stays empty rather than inventing numbers. |
| Student auth page | **Live** ⟨CP2B⟩. Google Identity Services renders Google's own button; a verified credential creates or reuses a Student and establishes a session. Still no email, username, password, signup, reset, or invitation-token field. |
| Invitation rotation under contention | The invariant holds — see §7g. The losers of a simultaneous rotation get `BATCH_SAVE_FAILED` rather than an automatic retry, so an Admin who happens to lose the race has to click again. Correct and safe; not yet pleasant. |
| Invitation expiry | Evaluated at presentation time and retired lazily. There is no sweep, so an expired row keeps `state: current` until somebody presents it. Deliberate: a cron sweep's failure mode is an expired link that still works. |
| Enrollment concurrency | Enforced by a unique `(batch, student)` index and exercised by the duplicate-key path in code, but **not** observed under real simultaneous redemption — that needs two live Google sessions, which the automated validation cannot produce. |
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
| **S-19** | **Closed ⟨CP2B closeout⟩.** Parse Server logs each trigger's `Input`/`Result`, so saving a `StudentAuthIdentity` wrote the Google subject into the line. `redact.ts` now treats `sub` (whole word), `subject` (fragment, covering `providerSubject` / `googleSubject` / `oauthSubject`), `claims`, `authorizationcode`, and `authentication` as sensitive. **Closed at every log level — `LOG_LEVEL=warn` is no longer required.** Verified at runtime with the level unset: the trigger line reads `providerSubject":"[REDACTED]"` while `objectId` survives. `id`, `objectId`, `userId`, and stable error codes are unaffected, and `submission` / `subtotal` / `subscription` are not swallowed. |
| — | Anonymous Parse users enabled by default | `enableAnonymousUsers: false` |
| — | Read-only master key usable from any IP | `readOnlyMasterKeyIps: ['127.0.0.1','::1']` |
| — | Stack traces / internals reachable in error bodies | `sanitizedErrorHandler` returns `{"error":"Request failed"}` |
| — | Client could pass `role`, `ACL`, `sessionToken`, … | `rejectPrivilegedParams` refuses 15 parameter names |

### Remaining gaps
| # | Gap | Owner |
|---|---|---|
| ~~**S-20**~~ | **CLOSED in Checkpoint 5.** `Parse.File` still cannot be written from cloud code — Parse's `FilesRouter` is not in the router `directAccess` uses, so `Parse.File.save()` falls back to an HTTP call against the server's own `serverURL` and `blockRawFileRoutes` refuses it, correctly. That was never worked around; it was **routed around**. Batch Resources reach the configured `GridFSBucketAdapter` **in-process**, so the blocked HTTP surface is never involved, and every download is authorised per request and streamed. No security control was weakened and `/api/files/*` is still 403. See §7i and OQ-10. | Closed |
| S-4 | Session token and user DTO in `localStorage` (XSS-readable) | Checkpoint 11 — storage decision |
| S-6 | The kit's `extractMasterKey` still accepts a master key from the request **body**, and its `restrictRoutes` treats a match as a bypass. Not exploitable in this configuration (403 observed). Lives in `node_modules`; cannot be fixed here | Report upstream / Checkpoint 11 |
| ~~S-9~~ | **Closed in Checkpoint 5.** Both client-reachable upload paths validate. The profile photo bounds and re-encodes an image ⟨CP3A⟩; a Batch Resource is checked by extension against a closed allow-list, cross-checked against the browser's MIME claim, and finally judged on its own bytes — including reading a ZIP's central directory so a renamed `.jar` cannot pass as a `.docx`. Empty and oversized files are refused, the latter at the socket. | Closed |
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

## 7b. Checkpoint 2A — UI/UX foundation ⟨implemented⟩

**Design system.** Three additive stylesheet layers — `src/styles/tokens.css` (semantic tokens
derived from PrimeNG, light + dark), `src/styles/typography.css` (type scale, language-aware font
stacks, reduced-motion reset), `src/styles/layout.css` (layout, form, alert, focus, and a11y
primitives, all in CSS logical properties). Imported at the top of `styles.css`; **nothing was
removed from it**.

**Primitives.** `cyf-brand-mark`, `cyf-auth-layout`, `cyf-language-switch`, `cyf-alert`, plus
CSS-only card/field/input/button/link patterns.

**Auth routes.** `/auth` → `/auth/admin`; `/auth/admin`; `/auth/student`; `/auth/**` → `/auth/admin`.
`guestGuard` on the parent **and** both children keeps a signed-in Admin off the auth pages without
a flash. All redirect targets are fixed internal paths.

**Admin auth page.** Redesigned on the token system with a password visibility toggle, translated
inline error states (invalid credentials / not permitted / rate limited / backend unavailable /
unexpected), duplicate-submit prevention, Enter submission, `autocomplete` hints, reserved message
space so validation causes no layout shift, and a link to Student sign-in. **Login, session
restoration, guards, logout, and rate limiting are unchanged from Checkpoint 1.**

**Student auth page.** UI only. No service, no HTTP call, no navigation, no session write, and no
click handler; the Google button is `disabled`. Carries the approved invitation copy verbatim in
both languages, a privacy note, and a link to Admin sign-in. **No email, username, password,
signup, reset, invitation-token field, or Apple button.**

**Preserved template capabilities — not currently used, deliberately retained:** FullCalendar
theming, Timeline theming, Editor theming, ProgressBar / Avatar / Divider / scrollbar overrides,
`.app-card` / `.app-card-nested` and the `--app-*` surface variables, the `data-table` component
suite, `base-dialog`, `image-uploader`, `image-cropper-dialog`, `LiveQueryService`, `ExportService`,
`PageTitleService`, the pipes, the `appIfRole` directive, and every dependency in
`frontend/package.json`. A regression test (`backend/test/templatePreservation.test.ts`) fails if any
of the stylesheet sections is removed.

## 7c. Checkpoint 2B — Student Google authentication ⟨implemented⟩

**Backend.** `StudentAuthIdentity` (provider · providerSubject · user pointer, nothing else),
`POST /api/student-auth/loginWithGoogle`, and `GET /api/student-auth/getSession`. Verification is
delegated to Parse Server's bundled Google adapter with this repository's own `email_verified` rule
on top; the credential is never stored, logged, returned, or placed in a URL. Sessions come from
Parse's `/loginAs`, so a Student account carries no usable password. Full design in
[TEMPLATE_ARCHITECTURE.md §16c](TEMPLATE_ARCHITECTURE.md).

**Frontend.** Google's own button on the existing Student page, `/student/welcome` behind
`studentGuard`, role-aware `authGuard` and `guestGuard`, explicit `restoring` / `authenticated` /
`unauthenticated` session states, single-flight restoration, and a translated message for every
failure state. `SessionService` no longer stores a username at all.

### Runtime — observed end to end against MongoDB

Google's *token verification* was substituted through the module's own injectable seam; every other
layer is genuine — Express, `restrictRoutes`, the cloud function, provisioning, the unique indexes,
`/loginAs`, and the DTO over the wire.

| Check | Result |
|---|---|
| Missing `GOOGLE_CLIENT_ID` | endpoint refuses with `GOOGLE_NOT_CONFIGURED`; **Admin login unaffected** |
| Forged/unsigned token (real verifier, over HTTP) | `INVALID_CREDENTIAL` — signature checking is genuinely enforced |
| First sign-in | 1 `_User`, 1 identity, `roles:["Student"]`, a real `r:` session token |
| Sign-in response keys | exactly `displayName, id, roles, sessionToken` — no username, email, subject, or credential |
| Returning sign-in | same account; no new `_User`, no new identity |
| Three concurrent first sign-ins | **3 succeeded → 1 account, 1 identity** |
| Admin email conflict | `ACCOUNT_NOT_ELIGIBLE`; nothing created, Admin untouched |
| Session restoration | `{displayName, id, roles}` — no token, no username |
| Logout | `{"success":true}`; the old token then fails with `209` |
| Student role withdrawn | roles come back `[]`; the next sign-in is refused |
| Identity columns in MongoDB | `provider`, `providerSubject`, `_p_user` only |
| Duplicate identity insert | rejected by MongoDB with `11000` on **both** unique indexes |
| Student password login | still refused |
| `/classes/StudentAuthIdentity` | **403** (also 403 with a master key header) |
| Logs | no credential, no email, no internal username, no session token, **and no Google subject** — scanned at the default `info` level after the closeout, 0 occurrences of every canary |
| Google's button in a real browser | loads and renders at 1440 EN / 1440 AR / 390 EN — zero overflow, one `h1`, no inputs, no console errors |
| **⟨closeout⟩ COOP on the document** | `Cross-Origin-Opener-Policy: same-origin-allow-popups`, exactly one value, set by the Angular dev server; no COEP |
| **⟨closeout⟩ postMessage warning** | **gone** — 0 opener/postMessage warnings on `http://localhost:4200` |
| **⟨closeout⟩ Google origin** | `gsi/button` returns **403** — `http://localhost:4200` is not yet an *Authorised JavaScript origin* for the client. **No session is created**, no navigation happens, and no raw GSI text is rendered |

## 7d. Checkpoint 3A — Complete Student Profile ⟨implemented⟩

**Backend.** `StudentProfile` (one row per Student behind a unique index on the
user pointer) and five focused operations under `/api/student-profile`. The
verified email is derived from the Google identity, completion is calculated
server-side, and the graduation month is normalised to the first of the month at
00:00 UTC. Full design in
[TEMPLATE_ARCHITECTURE.md §16e](TEMPLATE_ARCHITECTURE.md).

**Frontend.** Complete Profile — the first real product page — in four sections
on the Checkpoint 2A design system, plus profile-aware routing and a welcome page
that now shows the Student's real name and an Edit action. The profile form is a
standalone onboarding route outside `ShellComponent`; the entire Student shell
is completion-guarded, so its navigation is never activated for an unfinished
profile. The onboarding page supplies a compact header, language and logout
controls, setup steps, privacy guidance, and a sticky save bar.

### Runtime — observed end to end against MongoDB

| Check | Result |
|---|---|
| Admin login | still works; **no** `profileComplete` on an Admin session |
| Admin reading a Student profile | `NOT_A_STUDENT` |
| Visitor | refused |
| New Student | `profileComplete: false`; empty profile carries the verified email |
| Save | one row created; `isComplete: true` |
| Refresh | session returns `profileComplete: true` |
| Graduation date stored | `2027-06-01T00:00:00.000Z` |
| Edit | same row; still one profile |
| Request carrying `verifiedEmail` | `VALIDATION_FAILED`; stored email unchanged |
| Current Student without a month | `VALIDATION_FAILED` |
| `Other` without a custom name | `VALIDATION_FAILED`; with one, accepted |
| Photo upload / read / replace / remove | all succeed; bytes stored inline, re-encoded to WebP |
| A script disguised as a PNG | `PHOTO_REJECTED` |
| Another Student | sees an empty profile and `PHOTO_NOT_FOUND` |
| `/classes/StudentProfile`, `/classes/File`, `/classes/IMG`, `/schemas` | **403** each |
| Raw file route | **403** — unchanged |
| CORS | allow-listed origin echoed; foreign origin not; no wildcard |
| Logs | `verifiedEmail` and `phone` appear as `[REDACTED]`; no profile value at any level |

### Visual — 12 combinations inspected in a real browser

Complete Profile and the welcome page at **1440 / 768 / 390 px** in **English and
Arabic**. Zero horizontal overflow everywhere, exactly one `h1` per page, four
labelled sections on the form, no percentage anywhere, and **no console errors**.
Reviewed by eye at 1440 EN, 1440 AR, and 390 AR.

## 7e. Checkpoint 3A — Profile Catalog ⟨implemented⟩

**Backend.** `ProfileCatalogItem` — one closed, typed vocabulary restricted to `CITY`,
`INSTITUTION`, `MAJOR`, and `TARGET_ROLE`, with a unique `(type, code)` index, an immutable
category, deny-by-default CLP, and every column in `protectedFields`. Five Admin operations under
`/api/profile-catalogs` and one Student read under `/api/student-catalog`. `StudentProfile`'s
`city`, `institution`, and `major` became **pointers** into it, and `targetRole` /
`targetRoleReason` were added as optional fields that never affect completion. Full design in
[TEMPLATE_ARCHITECTURE.md §16f](TEMPLATE_ARCHITECTURE.md).

**The photo moved off the cloud-function path.** Uploading and reading an image now use a dedicated
authenticated binary route, `/api/profile-photo` — because Parse logs every cloud-function call with
its serialised input and result, which wrote a whole photograph to the log on every upload. No file
route was opened; see §16g.

**Frontend.** Four searchable PrimeNG Selects, two polished DatePickers (a full date for the date of
birth, month and year only for graduation), a save-then-upload photo flow with a partial-success
message, and **Profile Catalogs** — one Admin page with four tabs at
`/dashboard/profile-catalogs`, reachable from one new navigation item.

### Runtime — 65 checks observed end to end against MongoDB

| Check | Result |
|---|---|
| Admin login, and an Admin session carrying no `profileComplete` | works |
| Admin creates, lists, edits, activates, deactivates, deletes across all four categories | works |
| An unknown category, or a class name in its place | `CATALOG_VALIDATION_FAILED` |
| A duplicate code within a category | `CATALOG_DUPLICATE` |
| Student reads the catalog | active items only, all four categories |
| Visitor reads the catalog; Student uses an Admin operation; Admin uses the Student read | each refused |
| Photo uploaded **before** the profile exists | `PROFILE_UNAVAILABLE` — the reason the form saves first |
| One Save: profile created, **then** photo uploaded, then read back | works; **no `PROFILE_UNAVAILABLE`** |
| Base64, `data:` URIs, or any long blob in the log | **none** |
| Any personal profile value in the log | **none** — name, email, and phone all `[REDACTED]` |
| A photo log line | a byte count and nothing more |
| City / institution / major stored | resolved catalog references, never raw pointers |
| A name sent in place of an id, a wrong-category id, a newly chosen inactive item | each `VALIDATION_FAILED` |
| Target role and its reason | optional; completion ignores both |
| A reason over 500 characters | `VALIDATION_FAILED` |
| Deleting a referenced item | `CATALOG_IN_USE`; the profile is untouched |
| Deactivating it instead | stays on the profile, disappears from new options |
| `Other` institution without a custom name | `VALIDATION_FAILED`; accepted with one |
| Date of birth stored | `2001-05-09T00:00:00.000Z` |
| Graduation stored | `2027-06-01T00:00:00.000Z`; cleared when switching to Graduate |
| Photo replace / remove / read; a disguised script; a 6 MiB upload | works / works / works / rejected / rejected |
| Another Student reading the photo or profile | `404` / their own empty profile |
| `/classes/*`, `/schemas`, `/files/*` | **403** each |
| CORS | allow-listed origin only; no wildcard; a foreign origin never echoed |
| Country, timezone, remote-attendance, or evaluation column | **none exists** |
| Classes in the database | only the eight approved |

### Visual — 23 captures inspected in a real browser

Complete Profile and Profile Catalogs at **1440 / 768 / 390 px** in **English and Arabic**, plus
both date pickers open, and a searchable select open, in both languages. Zero horizontal overflow,
zero clipped text, **no native date input or `<select>` anywhere**, no percentage, exactly one `h1`
per page, and **no console errors**. Reviewed by eye at profile EN/AR 1440 and AR 390, the Arabic
graduation picker, the Arabic institution select, and the Admin page at 1440 AR and 390 EN.

## 7f. Checkpoint 3A — Google name and photo ⟨implemented⟩

A Student's name and avatar are already known and verified at sign-in, so both
are taken **once** and both are theirs to change. Full design in
[TEMPLATE_ARCHITECTURE.md §16h](TEMPLATE_ARCHITECTURE.md).

- The **name** is prefilled into the form from the verified claims and is never
  written by itself; the form says where it came from until the Student edits it.
- The **photo** is imported on the save that creates the profile: fetched
  server-side from a host pinned to Google's own domains over HTTPS, with
  redirects refused, no credentials, a 4-second timeout, and a 5 MiB bound
  checked against both the declared and the actual length — then put through the
  same MIME / extension / signature / `sharp` validation an upload gets, and
  re-encoded to a bounded WebP.
- The avatar URL lives on `StudentAuthIdentity` beside the provider subject, in
  `protectedFields`. It reaches no DTO, no browser, and no log.
- **Neither is ever re-applied.** A later edit or removal is permanent.
- Choosing a photo by hand opens the template's `image-cropper-dialog`, so the
  Student frames the square that becomes their circular avatar. Verified end to
  end through the real cropper in a browser: pick, crop, save — what lands in
  the database is a `RIFF...WEBP` the cropper produced.

### Runtime — 20 checks observed end to end

| Check | Result |
|---|---|
| The empty profile carries the Google name and says so | works |
| The Student overrides it, and the override is stored | works |
| The override survives a re-read **and a second sign-in** | works |
| A pinned-host avatar URL is captured on the identity | works |
| An avatar URL on an unpinned host | **never stored**; sign-in still succeeds |
| An avatar that cannot be downloaded | no photo, **not** a failed save |
| Any DTO carrying an avatar URL, provider field, or subject | **none** |
| Any avatar URL or personal value in the log | **none** |
| Removing the photo, then saving again | stays removed — the import runs only at creation |

### Visual

The prefilled name and its hint at 1440 px in **English and Arabic**, and the
hint disappearing on edit. No horizontal overflow, no console errors, and **no
Google URL anywhere in the rendered markup**.

## 7g. Checkpoint 4 — Batches, invitations, enrollment, and the Student directory ⟨implemented⟩

A Batch is a group of Students going through the programme together. An Admin
creates one, generates a link, and sends it; a Student opens the link and joins.
Full design in [TEMPLATE_ARCHITECTURE.md §17](TEMPLATE_ARCHITECTURE.md).

### What exists

- **Three models** — `Batch`, `BatchInvitation`, `BatchEnrollment`. All three are
  deny-by-default: every CLP operation grants nobody, the class ACL is empty, and
  every column is in `protectedFields`. Nothing is readable off the class; every
  read goes through a cloud function that authorises the caller.
- **Eighteen operations** across four routes — `batches` (Admin), `join`
  (public preview), `student-batches` (the Student's own), and
  `student-directory` (Admin, read-only). **There is no delete**, for a Batch or
  for anything under one.
- **Four statuses** — `draft`, `active`, `completed`, `archived`. Only `active`
  accepts enrollment. Archived is terminal and read-only. No status ever changes
  by itself.
- **Invitation tokens** — 32 bytes from the OS CSPRNG, base64url. Only a SHA-256
  hash is stored; the raw token exists in exactly one response and then nowhere.
- **A public `/join/:token` page** that works for a Visitor, a Student with an
  unfinished profile, a Student who can join, an Admin who opened the wrong link,
  and anybody holding a link that has expired, been revoked, or been replaced.

### The two concurrency invariants are database indexes

Not application checks. `BatchInvitation` carries a unique partial index on
`_p_currentForBatch`, and `BatchEnrollment` a unique index on
`(_p_batch, _p_student)`. A race cannot produce two live links for one Batch or
two memberships for one pair, because the database refuses the second write.

### Runtime — 51 checks observed end to end against MongoDB

| Check | Result |
|---|---|
| `Batch` / `BatchInvitation` / `BatchEnrollment` read straight off the class | **refused**, with and without an Admin session |
| A Batch created with `startDate: 2026-03-03` | stored and returned as `2026-03-03` — no timezone shift |
| An end date before the start | refused, naming the field and **not** echoing the value |
| A Batch created already `archived` | refused |
| An `ACL` smuggled into the create input | refused, not silently ignored |
| `draft` → `completed` | refused (`BATCH_INVALID_STATUS`) |
| The issued token | 43 characters of base64url; **no hash in the response** |
| Re-reading the invitation afterwards | never returns the token again |
| A Visitor previewing a valid link | works; carries the Batch name and **no identifier of any kind** |
| An unknown token vs a malformed one | **byte-identical answers** — nothing can be probed |
| Rotation | old link dead immediately, new link live, version incremented |
| A Visitor creating a Batch / listing Batches / issuing a link / reading the directory / redeeming | all **refused** |
| An Admin redeeming a link | **refused** — an Admin cannot join a Batch |
| An archived Batch: edit, un-archive, issue a link | all **refused** |
| `deleteBatch`, `removeBatch`, `deleteEnrollment`, `DELETE /classes/Batch/:id` | **none exist** |
| `limit=100000` | capped, not served |

### Concurrency — observed under real contention

Ten simultaneous rotations against one Batch: **three writes landed, seven were
refused by the unique index, and exactly one link was live afterwards.** Five
simultaneous archive requests left the Batch archived exactly once. The losing
rotations answer `BATCH_SAVE_FAILED` — honest (the write did fail) and safe (the
invariant held); a retry would be a nicer outcome and is noted in §2.

### Logging — read from a real log file, not asserted in a test

| What Parse would have printed | What the log actually contains |
|---|---|
| `Input: {"token":"<43 chars>"}` for every preview and redemption | `Input: {"token":"[REDACTED]"}` |
| The stored hash on an invitation `beforeSave` | `"tokenHash":"[REDACTED]"` |
| `"invitationUrl":"http://.../#/join/<token>"` | `"invitationUrl":"http://.../#/join/[REDACTED]"` |
| Any 40+ character base64url string anywhere in the file | **none** |

The fingerprint (`1c4e64ee`) does appear, by design: it is the first eight
characters of the *hash*, it identifies which link is being discussed, and it
reveals nothing about the token.

## 7h. Checkpoint 4 closeout ⟨implemented⟩

Three things the checkpoint left behind, plus the spacing work that came with
them.

### Index application is part of startup

The handoff recorded `applyAllIndexes` as "never called". That was half right,
and the half that was wrong mattered more.

It *was* called — under its deprecated alias, **inside the `server.listen`
callback**. So the port was open while the indexes were still being built, and
the two indexes that are the sole enforcement of a concurrency invariant had a
window in which they did not exist. Worse, the kit's applier cannot fail (every
`createIndex` is wrapped and stepped over) and never reads its work back, so a
boot with a missing unique index was indistinguishable from a healthy one.

`cloudCode/startup/indexes.ts` now wraps it: ping the database, run the applier,
then **read every declared index back out of MongoDB** and refuse to continue if
one is absent or is not unique. `app.ts` awaits that before `server.listen`, and
a failure exits non-zero without opening the port. Design in
[TEMPLATE_ARCHITECTURE.md §17l](TEMPLATE_ARCHITECTURE.md).

### The kit's index logging leaked duplicate values

Found by reading a real log. On a duplicate-key failure the kit prints
`createErr.message` with `console.error`, and a driver's E11000 message contains
the colliding value — on these collections that is a token hash, a verified
email, or a Google subject. The applier is now called with `console` captured;
each line is redacted and replayed at debug level. §17m.

### Runtime — 51 checks against an isolated database

| Check | Result |
|---|---|
| Indexes applied and verified during normal startup | works |
| The port opens **after** the indexes are ready | 4287 ms → 4368 ms |
| All seven unique indexes physically present, and unique | works |
| The current-invitation index is on `_p_currentForBatch`, partial | works |
| The enrollment index is on `(_p_batch, _p_student)` | works |
| A second startup | succeeds; **no index dropped or recreated** |
| Ten simultaneous rotations | exactly one live invitation; one current row in MongoDB |
| A duplicate enrollment inserted directly | **refused by MongoDB** |
| A unique index blocked by planted duplicate rows | **startup refused**, exit 1, port never opened |
| That failure's diagnostic | names the collection and index, tells an operator to clean up by hand, prints **no** duplicate row |
| The offending rows afterwards | untouched — nothing deleted |
| Database URI, master key, admin password, invitation token in any log | **none** |
| Any unmasked 64-hex token hash in any log | **none** |

### The reusable data table, used everywhere

All six table surfaces now render through the original `app-data-table`: Admin
Batches, the Student directory, the roster inside a Batch, Profile Catalogs,
Admin Batch Resources, and Student Batch Resources. The interim
`cyf-record-table` adapter and its duplicate PrimeNG table were removed.

The common behaviour is now real on every list: debounced in-table search,
page-number navigation, rows-per-page selection, refresh, table/grid views,
column visibility, loading skeletons, and row previews. Each page supplies its
own cell, grid-card, and preview templates, so existing status, navigation,
download, reorder, edit, and read-only rules are preserved.

Server-backed lists pass `skip`, `limit`, search, and filters through
`loadData`. Profile Catalogs and Batch Resources are returned whole by their
APIs, so those pages search and page their in-memory result instead. The shared
component and paginator match the source template; PrimeNG therefore formats
paginator digits using the viewer environment when no locale is supplied.

### One shell for both workspaces

The Student area had its own header with its own navigation. Both workspaces now
load the same `ShellComponent`, which picks its items from the session's roles.
Admin sees Dashboard · Batches · Students · Profile Catalogs; a Student sees
Home · My Batches in primary navigation. Profile editing moved to the Avatar
menu directly above Logout; an unrecognised role sees nothing, because every
primary item carries explicit roles and the filter denies by default.

### Visual — 24 page visits, all clean

1440 / 1024 / 768 / 390 / 360 px, English and Arabic, light and dark. No console
error, no horizontal page overflow, no untranslated key, one `main` landmark, one
primary navigation, no navigation in the top bar, and content clear of the
sidebar in both directions.

**A false pass was caught here, which is the more useful finding.** A 390 px
screenshot suggested the table was clipped with no way to reach the last three
columns. The check meant to prove it was written as "if a scroller exists, is it
reachable" — and passed silently on a build where the component had failed to
compile and the element did not exist. Rewritten to fail when the element is
absent, it showed that **PrimeNG already scrolls the table**: 633 px of content
inside a 333 px card, and scrolling it brings Status, Students, and Actions into
view. The container added in response was redundant and was removed.

What is genuinely missing is keyboard access to that scroll region — PrimeNG's
container has no `tabindex` and no accessible name. Recorded as a gap.

## 7i. Checkpoint 5 — Private Batch Resources ⟨implemented⟩

### What exists

`BatchResource` — metadata only, deny-by-default CLP, an empty class ACL, and **every** column in
`protectedFields`. A query that somehow reached the class reads an empty shell, `storageKey`
included. Two indexes: `(_p_batch, displayOrder)` for the list, and a unique index on `storageKey`.

Five cloud functions across two routes — `batch-resources/*` for Admins,
`student-resources/listMyBatchResources` for Students — and one binary route with two paths,
`POST /api/batch-resource` and `GET /api/batch-resource/:resourceId`.

The two audiences are separate routes on purpose. They could have been one with a role branch
inside; they are not, because a shared entry point is where an authorisation branch eventually
gets the wrong default.

### The bytes never touch a cloud function

Parse Server logs every cloud-function call with its serialised input **and** result. In
Checkpoint 3A that wrote a whole base64 photograph into the log on every upload. So Resources move
metadata through cloud functions and bytes through a dedicated authenticated Express route — which
also lets the 20 MiB limit apply **at the socket**, refusing an oversized upload mid-stream rather
than buffering it whole and then rejecting it.

### Private storage — the OQ-10 / S-20 answer

`modules/BatchResource/storage.ts` uses the `GridFSBucketAdapter` Parse Server already has,
in-process. No new dependency, no second connection, no new operational surface, and the HTTP file
route that S-20 blocks is never involved. Writes are piped in; reads are streamed out.

Neither of the adapter's public read methods fits — `getFileData` buffers the whole file, and
`handleFileStream` demands a `Range` header, always answers 206, and sets no
`Content-Disposition`. Reads therefore open the bucket directly. That is feature-detected once at
startup, the server logs a warning if the capability is ever missing, and it is recorded in §2.

### Ordering of writes, in both directions

Uploading stores **bytes first, row second**, and every failure path after the bytes land removes
them again. Deleting is the mirror image — **row first, bytes second**. The asymmetry is the point:
bytes with no row are invisible and reclaimable, while a row pointing at bytes that are not there
is a broken Resource people can see and click.

### Runtime — 75 checks observed end to end against MongoDB

Against a running server on an isolated database (`cyf_cp5_validation` on port 27018, dropped
afterwards; the developer's own database and their server on 1337 were never touched).

| Area | Result |
|---|---|
| All eight formats, built byte by byte and uploaded | accepted; the stored MIME comes from the table, not the browser |
| An `.exe`; an executable renamed `.pdf`; an executable renamed `.txt` | refused, `RESOURCE_TYPE_NOT_ALLOWED` |
| A **JAR renamed `.docx`** and a plain ZIP renamed `.xlsx` | refused — the package-contents check, which magic bytes cannot make |
| A MIME type contradicting the extension | refused |
| An empty file | refused as `RESOURCE_EMPTY`, not as the wrong type |
| 20 MiB + 1 KiB | refused **413** `RESOURCE_TOO_LARGE` at the socket |
| GridFS rows vs metadata rows after every refusal | equal — nothing orphaned |
| Download headers | `Content-Disposition: attachment`, `nosniff`, `private, no-store`, sandbox CSP, and the stored MIME |
| An uploaded `.html` | served as an attachment, never inline |
| Bytes returned | byte-for-byte identical to what was uploaded |
| Enrolled Student | lists and downloads; the DTO omits `displayOrder`, `updatedAt`, and the uploader |
| Student outside the Batch | refused, and the download answers **404**, not 403 |
| Visitor | 401 on the download, refused on the list |
| Student calling the Admin route, or uploading | refused |
| Metadata edit | the title changes; `storageKey`, `filename`, and `fileSize` do not |
| A smuggled `storageKey` in an edit | refused with a field error, and the stored key is unchanged |
| Reorder | the whole order applied, `displayOrder` rewritten 0..n; a partial list keeps every Resource |
| Delete | row gone, **binary gone**, and a later download is a clean 404 |
| Archived Batch | list works and says `readOnly`; upload, edit, reorder, and delete all refused; download still works; an enrolled Student still reads it |
| `/classes/BatchResource` | unreadable with no session **and** with an Admin session; unwritable |
| `/api/files/*` | still refused |
| A storage key used as a resource id | 404 — it is not an address |
| The log file, read | no storage key, no filename value, no file bytes; uploads logged with a byte **count** and refusals with their code |
| Profile, photo route, Batches, Student Batches | all still answer |

### The log was read, not assumed — and it had a leak

The first run failed one check: `storageKey` appeared verbatim in Parse Server's own `beforeSave`
line on every upload. `filename` was already masked; the storage key was not. It is the one value
that would matter most in a log, because it is how the bytes are addressed.

`storagekey` was added to the redaction key list — the same fix, found the same way, as `fullName`
in Checkpoint 3A. Three tests now pin it: the key is masked through the Parse logger adapter, a
filename is masked in the Resource shape, and a harmless key that merely mentions storage
(`storageIsUsable`) still survives.

### Visual — six inspections in a real browser

Headless Chrome, on the isolated server, at 1440 px and 390 px, in English and Arabic.

| # | What | Result |
|---|---|---|
| 1 | Admin → Resources tab of a live Batch | five Resources listed with title, description, filename, type, binary size, and date; all write controls present |
| 2 | The upload dialog | states the accepted formats and the 20 MiB limit **as the server sent them**; the picker's `accept` is the server's list |
| 3 | Admin → Resources of an **archived** Batch | the Resource is listed and downloadable; Upload, Edit, Delete, Move Up and Move Down are **absent**, and the panel says why |
| 4 | Student → Resources tab | two tabs only; every row offers a download; no control a Student cannot use is drawn |
| 5 | Arabic, RTL | `dir="rtl"`, translated, no English leaked into the panel, file sizes in **Latin** digits |
| 6 | 390 px phone | the list renders, the document does not scroll sideways, and the wide table scrolls inside its own container |

Every inspection also asserted: no console error, no `<a href>` pointing at a file, and no
`resource_` storage key anywhere in the rendered HTML.

---

## 7j. Schema reconciliation at startup ⟨CP5 fix⟩

Found by a real upload against a real database, not by a suite.

`BatchResource` carried a `file` column marked `required` that no model declares.
Parse Server's `RestWrite.setRequiredFieldsIfNeeded` therefore threw
`VALIDATION_ERROR (142) / "file is required"` on **every** create, so the class
read fine, counted fine, and would not accept a single row. Parse never removes a
field from `_SCHEMA`, so the state was permanent.

A database created by this code does not have it — which is exactly why 999
backend tests, 707 frontend tests, and 75 runtime checks all passed while one
real database could not store a file.

`startup/schemaDrift.ts` now runs before the port opens and, per declared class:

| Stored field | Action |
|---|---|
| required, model does not declare it, **no row uses it** | removed through `Parse.Schema`, logged at `warn` with the class and field |
| required, model does not declare it, **rows hold values** | **boot fails**, naming the field, with the remedy in the message |
| optional and undeclared | left alone — untidy, not fatal |
| declared by the model, or Parse's own (`objectId`, `createdAt`, `updatedAt`, `ACL`) | never touched |

Verified end to end: the exact `file` column was injected into an isolated
database's `BatchResource` schema, the server was booted, and it logged

```
[warn] Removed a stale required field that no model declares and no row used.
       {"op":"reconcileSchemaDrift","className":"BatchResource","fieldName":"file"}
```

after which the full 75-check runtime validation passed again.

Ten unit tests cover the repair, the refusal, the three cases it must not touch,
and the "a failed count means there might be data" rule.

---

## 7k. Live Slides ⟨CP6⟩

| Concern | Where it lives |
|---|---|
| Session lifecycle | `modules/LiveSlides/constants.ts` — four statuses, four legal moves |
| One live session per Batch | `LiveSlideSession` unique partial index on `_p_liveForBatch` |
| Immutable answers | `LiveResponse.onBeforeSave` (create-only) and `onBeforeDelete` (always refuses) |
| One answer per Student per Question | `LiveResponse` unique index on `(_p_session, _p_slide, _p_student)` |
| Locking + navigation | `presenterFunctions.moveSlide` — lock first, then move, one operation |
| No Answer | Derived from the roster; no row is written |
| Profile history | `LiveResponse.studentProfile` + `(_p_studentProfile, submittedAt)` index |
| Realtime | `LiveSessionPollService` — an authenticated poll of one sanitized endpoint |

### Two bugs the runtime validation found that the unit tests could not

**`markLiveSessionReady` refused every session containing a text question.**
Rebuilding a stored Slide as validator input always passed `options`, and for a
Short or Long Answer that is `[]` — which trips the "a text answer carries no
options" rule. The unit tests called `validateSlide` with hand-written input
that never contained the empty array. Fixed by a single `slideAsInput` helper
used by all three rebuild sites.

**The payload omission redacted `Input:` and not `Result:`.** The first version
matched a balanced `{…}` with a lazy quantifier; it worked on a small payload
and silently failed on a large one, leaving five questions and their option
labels in the log while the line above them was correctly masked. Replaced with
a line walk, which cannot be defeated by nesting, escaping, or length.

### Runtime validation

**79 checks, all passing**, against the real backend on an isolated database:
every answer type submits, an invented option is refused, a submitted response
cannot be updated or deleted even with the master key, a second live session for
one Batch is refused, locking is one-way, No Answer is derived, results and
history are correct, all six physical indexes exist, and no question, answer,
option label, slide content, or Student email appears anywhere in the real log.

---

## 7l. The Complete Profile layout jump, and what it actually was

Reported as "selecting Education Status makes the page glitch and not work".

**The first diagnosis was wrong.** Measuring `getBoundingClientRect().top`
around the click showed the control moving 452px, and the reflow of the
two-column `.cyf-profile-grid` looked like the obvious culprit — a conditional
field changing CSS Grid auto-placement. It was written up as that, and it was
not that.

`offsetTop` is the measurement that settled it. Every child of the Education
grid had an **identical `offsetTop` before and after** the click; the grid simply
grew downwards by the height of the new field. Nothing reflowed. What moved was
a scroll — and not the one anybody was watching:

```
before: anyScrolled = [ DIV.shell-scroll = 822 ]
after : anyScrolled = [ MAIN.shell-content = 452, DIV.shell-scroll = 822 ]
```

Every section moved by exactly −452 with unchanged heights, which is a scroll,
not a layout change.

### Root cause

`.cyf-sr-only` — the standard visually-hidden recipe — is `position: absolute`.
The labels wrapping the education-status radios and the photo-upload input were
`position: static`, so those hidden inputs' containing block was the **shell's
`main`**, which is `position: fixed` and therefore the nearest positioned
ancestor.

Clicking a label focuses its hidden radio. The browser scrolls the nearest
scrollable ancestor to reveal a focused element, and `main` carries Tailwind's
`overflow-hidden` — which still scrolls programmatically but shows no scrollbar
and takes no wheel input. So the page moved and **nobody could move it back**.
That is the whole of "glitches and doesn't work".

### The fix

`position: relative` on the two labels that wrap a focusable `.cyf-sr-only`
control, giving each hidden input its own containing block. Two declarations, no
grid changes, no scroll manipulation, no fixed heights, no negative margins.

Measured after the fix, with a real dispatched mouse click and no harness
scrolling:

| | jump | `offsetTop` | graduation field |
|---|---|---|---|
| English 1440 | **0px** | 1142 → 1142 | appears, clears |
| Arabic 1440 (RTL) | **0px** | 1191 → 1191 | appears, clears |
| English 390 | **0px** | 1568 → 1568 | appears, clears |
| Arabic 390 (RTL) | **0px** | 1557 → 1557 | appears, clears |
| Arabic 360 (RTL) | **0px** | 1593 → 1593 | appears, clears |

Five regression tests assert the containing block on both labels, the general
rule for any future visually-hidden control, that the fieldset does not move
when the graduation field appears, and that no duplicate control is rendered.

## 7m. The Expected Graduation DatePicker was a dead control

It was the only picker in the application with **both** `readonlyInput=true` and
`showOnFocus=false`: it could not be typed into and would not open, so clicking
it did nothing at all. The other four are typeable, where clicking to type is
the correct behaviour and the icon opens the calendar.

Set `showOnFocus=true` on that one picker, so the whole control opens. Verified
in a browser: clicking the input opens the month panel, Escape closes it, and no
scroll side-effect. Date of Birth still focuses for typing, unchanged.

## 7n. Live Slides visual validation

Walked in the real application against seeded Draft, Ready, Live, and Completed
sessions, across English and Arabic × 1440/390/360 × light and dark, covering
the Admin session list, session view, presenter, results, the Student live view,
and Complete Profile.

**No console errors, no failed requests, no horizontal overflow, no clipped
text** in any combination. The only reported item was `A.nav-item` sitting
outside the viewport at 390 and 360 — the collapsed off-canvas mobile sidebar,
which is correct and appears on every page including ones this checkpoint did
not touch.

---

## 8. Product features not implemented

None of the following exists in any form — no model, no cloud function, no route, no page, no DTO:

Apple OAuth ·
Live Slides · Tasks ·
Assignment · Final Task · Submission · one-submission locking · Accept-for-publication ·
Pinned Students · Talent Reels · sanitised public DTOs for Visitors · Batch capacity · trainers ·
locations · schedules · scores · ratings · feedback · Student export · any Student write an Admin
could perform · Resource preview, viewer, conversion, folders, tags, comments, ratings, progress
tracking, download analytics, bulk actions, Student uploads, and file replacement.

Batch, Batch lifecycle, BatchInvitation, invitation tokens, QR generation, `/join/:token`,
Enrollment, and the pending-invitation flow **were** on this list and shipped in Checkpoint 4.
Resources, format validation, resource ordering, and authorised file download shipped in
Checkpoint 5.

The frontend ships: `/auth/admin`, `/auth/student`, `/join/:token`, `/student/profile`,
`/student/profile/edit`, `/student/welcome`, `/student/batches`, `/student/batches/:batchId`, `/dashboard`,
`/dashboard/profile-catalogs`, `/dashboard/batches` (+ `new`, `:batchId`, `:batchId/edit`),
`/dashboard/students`, and `/dashboard/students/:studentId`.
