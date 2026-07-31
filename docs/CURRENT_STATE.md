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
| **Backend tests** | `pnpm run test` → **315 pass, 0 fail**, exits cleanly with no force-exit |
| Frontend production build | `pnpm run build` → exit 0, initial bundle 676.47 kB |
| **Frontend tests** | `pnpm run test` → **305 pass, 0 fail** (15 spec files) |
| sharp | real WebP encode after install (44 bytes) |

### Runtime — observed against a clean isolated database
| Check | Result |
|---|---|
| Backend starts | Yes, `Server listening {"port":1338}` |
| Frontend dev server | `GET /` → 200, `<title>Code Your Future</title>` |
| Swagger | `/api-docs/json` → 200, OpenAPI 3.0.3 |
| **`AppSettings` absent** | 0 occurrences in the Swagger document; no model, no route |
| Registered models | **exactly `_Role`, `_User`, `File`, `IMG`, `StudentAuthIdentity`** (schema guard log) |
| Registered routes | **exactly 5** — `loginUser`, `getCurrentUser`, `logout`, `loginWithGoogle`, `getSession` |
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
| `File` / `IMG` | Private and server-controlled, but **no client-reachable path creates or reads one**. The controlled-access extension points are documented, not implemented (OQ-10). |
| `LiveQueryService` (frontend) | Fully implemented; `liveQuery.classNames` is still `[]` and no `beforeSubscribe` hook exists, so no class is subscribable. |
| `fileAdapter.ts` | Still dead code — never passed to Parse Server. Its `validateFilename()` still returns instead of throwing. |
| `File.fileSize` | Declared, never populated. |
| `@Cron` infrastructure | Works; `cron.ts` declares an empty class. |
| Index application | `applyAllIndexes` still never called. Moot: no unique or compound index is declared. |
| MongoDB validators | `applyMongoValidators` runs; almost no field constraints are declared, so validators are effectively empty. |
| `data-table` component | Retained and functional, but unused — no list page exists. |
| Web Push | `sw-push.js` and the `web-push` dependency exist; `vapidPublicKey` empty, no push function. |
| Dashboard page | Intentionally empty — a placeholder with no fake statistics, charts, or product data. Content arrives with the Admin workspace checkpoints. |
| Student auth page | **Live** ⟨CP2B⟩. Google Identity Services renders Google's own button; a verified credential creates or reuses a Student and establishes a session. Still no email, username, password, signup, reset, or invitation-token field. |
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

## 8. Product features not implemented

None of the following exists in any form — no model, no cloud function, no route, no page, no DTO:

Apple OAuth · StudentProfile · institution list ·
`expectedGraduationDate` normalisation · private profile photo · Complete Profile · Student
dashboard · Batch · Batch lifecycle · BatchInvitation · invitation tokens · QR generation ·
`/join/:token` · Enrollment · the pending-invitation flow · Resources · PDF validation · resource
ordering · authorised file download · Live Slides · Tasks · Assignment · Final Task · Submission ·
one-submission locking · Accept-for-publication · Pinned Students · Talent Reels · sanitised public
DTOs for Visitors.

The frontend ships two pages: `/auth` (Admin sign-in) and `/dashboard` (placeholder).
