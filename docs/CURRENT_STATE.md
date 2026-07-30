# Current State

The repository as it exists now. Baseline commit `c1517e4` on branch `master`, plus the working-tree
changes listed in §7. Verified on 2026-07-30, Windows 11, Node v24.18.0, npm 11.6.0,
**pnpm 10.33.0 pinned repository-wide** (Corepack `packageManager` in all three manifests),
local MongoDB on 27017.

Nothing described in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) is implemented.
Nothing shown in `docs/prototypes/` is implemented — the prototypes are static HTML/JS mockups
with hard-coded state, not application code.

---

## 1. Working — verified

| Area | Evidence |
|---|---|
| Root dependency install | `pnpm install` at root → exit 0 (pnpm 10.33.0) |
| Backend dependency install | `pnpm install` in `backend/` → exit 0 (pnpm 10.33.0, *after the §6 correction*) |
| Frozen-lockfile installs | `pnpm install --frozen-lockfile` → **exit 0 in all three projects** — installs are reproducible from the committed lockfiles |
| Single pnpm version | `pnpm -v` → `10.33.0` in root, `backend/`, and `frontend/` |
| `allowBuilds` under the pinned version | backend install records `pendingBuilds: []`, emits no ignored-builds warning, and `sharp` performs a real WebP encode (44 bytes) |
| Backend type-check | `npx tsc --noEmit` → exit 0, zero diagnostics |
| Backend compile | `pnpm run compile` → exit 0, emits `backend/build/src/{app.js,cloudCode/}` *(after §6)* |
| Frontend dependency install | `pnpm install --shamefully-hoist` → exit 0 |
| Frontend production build | `pnpm run build` → exit 0, `dist/code-your-future-frontend/browser/`, 16.07 s |
| Vitest harness | A temporary probe spec ran green (1 file, 1 test, 4.45 s) and was deleted |
| Backend boot | Parse Server starts, registers 4 models, 11 cloud functions, 11 routes, 4 triggers, 0 cron jobs |
| Swagger | `/api-docs` (301 → UI) and `/api-docs/json` (OpenAPI 3.0.3) serve; 11 paths, 6 schemas |
| Route restriction | `GET /api/classes/_User` → **403**, `GET /api/schemas` → **403** |
| Admin login | `POST /api/users/loginUser` returns a session token and `role: ["SuperAdmin"]` |
| Role seeding | Proven by the login response — `seedRoles` + `seedAdminUser` ran and assigned the role |
| Logout | `POST /api/users/logout` → `{"success":true,"message":"Logged out successfully"}` |
| Cloud-function params | `?limit=1&withCount=true&searchString=…` honoured on **both** `/api/users/listUsers` and the legacy `/api/functions/listUsers` |
| Frontend dev server | `http://localhost:4200/` → 200, `<title>Code Your Future</title>` |
| i18n assets | `/i18n/ar.json` → 200; en/ar both have **77 keys, no drift** |
| Static image | `/images/empty-grid.svg` present |
| Sharp native module | `require('sharp')` → 0.33.5 loads |

## 2. Partially working

| Item | State |
|---|---|
| `LiveQueryService` (frontend) | Fully implemented, but `liveQuery.classNames` is `[]` and no `beforeSubscribe` hook exists, so no class is subscribable. Dead until a class is enabled. |
| `fileAdapter.ts` | A complete local-disk adapter with Range support, but never passed to Parse Server. `validateFilename()` *returns* a `Parse.Error` instead of throwing, the caller ignores it, and the character check is commented out. |
| `File.fileSize` | Declared as a Number field; never populated by any code path. |
| `seedLookupTable()` | Implemented but unused (declared-but-unused private function). |
| `@Cron` infrastructure | Registry and decorator work; `cron.ts` declares an empty class. Runtime: `[Cron] No cron jobs to register`. |
| Index application | Only `applyUniqueIndexes` is called. `applyAllIndexes`, `getFieldIndexes` (B-tree/2dsphere/TTL) and `getCompoundIndexes` exist in the kit but are never invoked. |
| MongoDB validators | `applyMongoValidators` runs, but the template declares almost no field constraints, so the generated `$jsonSchema` is effectively empty. |
| Language on `/auth` | `initLang()` is only called from `ShellComponent.ngOnInit`. On a cold load of `/auth` with `localStorage.lang = 'ar'`, the direction effect applies RTL but `translate.use()` is never called, so text stays English until the user toggles. |
| Web Push | `public/sw-push.js` and the `web-push` dependency exist; `vapidPublicKey` is empty and no push cloud function exists. |

## 3. Failing

| Item | Result | Classification |
|---|---|---|
| `pnpm run test` (frontend) | **exit 1 — `No tests found matching the following patterns: **/*.spec.ts, **/*.test.ts`.** This is **test absence, not test failure**: there are zero spec files in the repository, so the runner has nothing to execute. The Vitest runner itself is functional (a temporary Phase 0 probe spec passed, then was deleted) | Test defect — no test suite exists in the clean template |
| Backend tests | **No `test` script in `backend/package.json`** — there is no command to run. `tsconfig.json` includes `test/**/*.ts`, but no `test/` directory exists | Test defect — no test suite exists in the clean template |
| `backend/pnpm-workspace.yaml` at baseline | `pnpm install` → exit 1, `ERR_PNPM_IGNORED_BUILDS`; pnpm's pre-script check then aborted `compile`, `start`, and `dev` | Code defect — **corrected**, see §6 |
| `frontend/public/images/login1..6.webp` | `GET /images/login1.webp` → **404**. `AuthComponent.images` references six files that do not exist | Code defect (missing assets) |
| `favicon.ico` | Referenced by `index.html`, absent from `public/` | Code defect (missing asset) |
| `pnpm run db` (backend) | `parse-dashboard --config backend/dashboard.json` runs from `backend/`, so it resolves `backend/backend/dashboard.json` | Code defect |
| `backend` `dev` script tail | `&& npm run db` after `nodemon` is unreachable — nodemon never exits normally | Code defect |
| `pnpm run deploy` (backend) | `node deploy.js` — `deploy.js` does not exist | Code defect |
| `tsconfig.json` include | Lists `src/cloudCode/utils/verifiyFile.ts` (also misspelled); the file does not exist | Documentation/config defect (harmless — `tsc` tolerates it) |

## 4. Environment-dependent / untested

| Item | Note |
|---|---|
| MongoDB | Required at `databaseURI`. Available locally on 27017 during this validation. No fallback or health gate. |
| Environment validation | **None.** `parseConfig.ts` reads `process.env` directly; `app.ts` casts `process.env.mountPath as string`. Missing keys fail at runtime, not at boot. |
| Port 1337 | Hard-coded in `app.ts:118`. Only `mountPath` is configurable. During the discovery run a **pre-existing** dev stack (started 10:17, not task-created) already held 1337, so a second instance logged `EADDRINUSE`. That stack was stopped by its owner before the closeout, which ran with no Node process active. |
| Windows specifics | `rimraf` and `kill-port` are used instead of shell built-ins, so scripts are portable. Two Angular compiler-cli paths under `frontend/node_modules/.pnpm/` exceed the Windows path limit — `git status --ignored` warns "Filename too long" (cosmetic; `core.longpaths` is not set). |
| CI | `.gitlab-ci.yml` targets GitLab and branch `dev`; the remote is GitHub. Never executed as part of this validation. |
| Deployment | Requires eight CI variables plus Docker on the target host. Untested. |
| Lockfiles | **Resolved in the closeout.** Three `pnpm-lock.yaml` files (root, backend, frontend), all `lockfileVersion: '9.0'`, all now **trackable** and validated with `--frozen-lockfile` under the pinned pnpm 10.33.0. See §7 for the policy. |
| Package manager | **Resolved in the closeout.** Pinned to `pnpm@10.33.0` in all three manifests; previously root/backend ran pnpm 11.15.1 while the frontend silently switched to 10.33.0. |
| Frontend ignored build scripts | `@parcel/watcher`, `esbuild`, `lmdb`, `msgpackr-extract` report as ignored on frontend install. **Warning only** — install exits 0 and the production build succeeds, because all four ship prebuilt platform binaries. Deliberately *not* granted build permission (OQ-16). |
| `parse-server` version | `^9.9.0` declared; **9.10.0** installed. Docs say 9.9.0. |
| `@90soft/parse-server-kit` | `^2.5.0` declared; **2.6.0** installed. Backend behaviour lives almost entirely in this package. |
| Parse Server deprecation warnings | 13 emitted at boot (`fileUpload.*`, `pages.*`, read-only master key, `requestComplexity.*` ×6, protected-field defaults ×2, `installation.*`). All are future-default changes, none fatal. |

## 5. Security gaps

| # | Gap | Location | Impact |
|---|---|---|---|
| S-1 | `cors()` with no options — all origins allowed | `app.ts:65` | Any site can call the API with a user's credentials-free headers |
| S-2 | Parse file URLs are unauthenticated: `/api/files/{appId}/{name}` passes `restrictRoutes` as a system route | `middleware.js` `systemRoutes`, verified 404-not-403 for an anonymous GET | **Blocks the private-photo and private-PDF requirements** (PRODUCT_REQUIREMENTS §5, §10) |
| S-3 | `express.static(join(__dirname,'../../files'))` serves `backend/files/` at the web root with no auth | `app.ts:92` | Second unauthenticated file surface |
| S-4 | Session token and full user object in `localStorage` | `session.service.ts` | XSS-readable session |
| S-5 | `masterKeyIps: ['::/0','0.0.0.0/0']` | `parseConfig.ts:33` | No IP restriction on master-key use |
| S-6 | Master key accepted from the **request body** (`masterKey` / `_MasterKey`) and treated as a full `restrictRoutes` bypass | `middleware.js` `extractMasterKey` + `restrictRoutes` | Code path exists. Probed: a `text/plain` body carrying the key against `/api/classes/AppSettings` returned **403**, so it is not exploitable in this configuration — but the mechanism should be removed |
| S-7 | `IMG` and `File` declare no `ACL`, and `getSchemaDefinition` defaults to `{'*':{read:true,write:true}}` | `parseDecorators.js` `getSchemaDefinition` | New image and file records get a **public read+write** object ACL |
| S-8 | `fileUpload.enableForAnonymousUser: true` | `parseConfig.ts:48` | Anonymous users may upload files |
| S-9 | No MIME, extension, size, or magic-byte validation on any upload path | `handleFile.ts`, `handleImage.ts`, `image-uploader.component.ts` (client-side `accept` only) | Arbitrary content accepted; the PDF/20 MiB and image/5 MiB rules have no server enforcement today |
| S-10 | `signupUser` is an open, unauthenticated endpoint that grants the `Employee` role | `modules/User/functions.ts:80` | Public self-signup — directly contradicts "no public email/password signup" |
| S-11 | `_User` `protectedFields: {'*':['email'], authenticated:[]}` | `models/User.ts:18` | Any authenticated user can read every user's email |
| S-12 | No log redaction; startup logs every route and every WebSocket upgrade URL | `app.ts`, kit registries | "Token must never be logged" (PRODUCT_REQUIREMENTS §7) has no enforcement layer |
| S-13 | REST API key committed to the repo, identical in dev and prod | `environment.ts:25`, `environment.prod.ts:27` | Client key is public by design in Parse, but sharing one value across environments removes any isolation; rotate before launch |
| S-14 | Nearly every user query runs `{useMasterKey: true}`, bypassing CLP | `modules/User/functions.ts` | Authorisation rests entirely on `validation.requireAnyUserRoles`; one missing declaration = full exposure |
| S-15 | Unauthenticated calls to `requireUser: true` functions return **400**, not 401 | Parse validator | Clients cannot distinguish "unauthenticated" from "bad request" |
| S-16 | Trigger registry silently overwrites a same-type trigger on the same class (console warning only) | `triggerRegistry.js` | A second `beforeSave` on a class silently replaces the first |

## 6. Legacy template behaviour

| # | Item | Note |
|---|---|---|
| L-1 | Roles are `SuperAdmin` and `Employee` | Product requires exactly `Admin` and `Student`. Rename is Checkpoint 1. |
| L-2 | `signupUser`, `searchEmployees`, `createUser`/`updateUser`/`deleteUser` | Employee-oriented user administration; no Student concept |
| L-3 | `PROJECT.md` | Documents `SuperAdmin`/`Employee`, a `/employees` nav row that does not exist, and a "Last Updated 2026-05-24 — Removed Microsoft (Entra ID) OAuth login…" note |
| L-4 | `GENERATE.md` | Permission table still defaults to `SuperAdmin, Employee` |
| L-5 | `README.md` | Describes `.claude/skills/` (7 skills) and `.claude/agents/` (6 agents) as being in the repo; they are not — they ship via the `90soft-toolkit@90soft` plugin. Also references `backend/src/cloudCode/decorator/`, `swagger/`, `backend/.env.example`, and `models/Employee.ts`, none of which exist |
| L-6 | `backend/CLAUDE.md` | Points at `models/Employee.ts` as the ACL/CLP example; that file does not exist |
| L-7 | `toKebabPlural` mis-pluralisation | `AppSettings` → route prefix `app-settingses` (observed at runtime) |
| L-8 | `http.interceptor.ts` login exemption | Checks `req.url.includes('/functions/login')`; the real function is `loginUser`, so the check never matches. Harmless today |
| L-9 | Parse `Date` truncation | The interceptor rewrites every `{__type:'Date', iso}` to `YYYY-MM-DD`, discarding the time. Will corrupt any timestamp the UI needs |
| L-10 | Unused backend dependencies | `nodemailer`, `pdfkit`, `multer`, `web-push`, `node-cron`, `node-geocoder`, `node-schedule` are declared but imported nowhere in `backend/src` |
| L-11 | `AppSettings` | A generic key-value store with no consumer at all — the only reference to `getAppSetting` in `backend/src` or `frontend/src` is its own definition. **Still present in the clean template today** (model, cloud function, `/api/app-settingses/getAppSetting` route, Swagger schema, and `key_unique` index all exist and were observed at runtime). **Scheduled for removal in Checkpoint 1** by resolved product-owner decision (OQ-13) — not yet removed |
| L-12 | `create-project.js` | A 290-line template bootstrapper that clones from `git.90-soft.com/90_soft/fullstack-template.git` and offers to remove "the Employee example entity". Irrelevant to this project |
| L-13 | `roleGuard` / `appIfRole` | Compare against `userRole()`, which is `user.role[0]` — only the **first** role is considered |
| L-14 | Hash routing | `withHashLocation()` makes every deep link `…/#/path`, which affects invitation links and QR codes (OQ-12) |
| L-15 | No typed reactive forms | `AuthComponent` uses `FormsModule` with signals; there is no `FormGroup` in the template, though `frontend/CLAUDE.md` conventions assume typed forms |
| L-16 | Dark theme default | `SwitchThemeService.getCurrentTheme()` falls back to `'dark'` and `index.html` hard-codes `class="dark"` |

## 7. Working-tree changes (uncommitted)

```
 M .gitignore                    ← docs + pnpm-lock rules removed
 M package.json                  ← packageManager pin
 M backend/package.json          ← packageManager pin
 M backend/pnpm-workspace.yaml   ← the one Phase 0 code correction
?? docs/                         ← five context documents + two prototypes, now trackable
?? pnpm-lock.yaml
?? backend/pnpm-lock.yaml
?? frontend/pnpm-lock.yaml
```

### `.gitignore` — documentation and lockfile tracking
Two rules were removed, both of which were silently excluding source-controlled content:

- A bare `docs` rule (added before Phase 0 discovery) ignored the whole `docs/` directory —
  **the five context documents *and* both prototypes.** Removed, closing **OQ-15**.
- `pnpm-lock.yaml` (a pattern with no leading slash, so it matched at every level) ignored all
  three lockfiles. Removed, so reproducible installs are possible.

`package-lock.json` remains ignored: this repository installs with pnpm, so an npm lockfile would
be a foreign artefact. No unrelated ignore rule was touched, and both protected files remain
ignored via `backend/.gitignore` (`.env` line 6, `dashboard.json` line 4).

Verified: `git check-ignore -v` reports **no matching rule** for any of the five documents, either
prototype, or any of the three lockfiles.

### Lockfile policy — three tracked lockfiles (Policy B)
Root, `backend/`, and `frontend/` are **genuinely independent pnpm projects**, so each keeps its own
lockfile and all three are tracked. The evidence and the reasons a single root workspace was
rejected are recorded in [TEMPLATE_ARCHITECTURE.md §14](TEMPLATE_ARCHITECTURE.md). In short: there
is no root `pnpm-workspace.yaml`; `backend/pnpm-workspace.yaml` has no `packages:` key and exists
only to carry `allowBuilds`; the frontend needs `--shamefully-hoist`; and both the root scripts and
`.gitlab-ci.yml` already install per directory. No lockfile is a duplicate — each resolves a
distinct manifest.

All three were regenerated/validated under the pinned pnpm and came out **byte-identical**
(md5 unchanged: root `c6c16c98…`, backend `c2a28eac…`, frontend `fc5cf584…`), all already
`lockfileVersion: '9.0'`. No lockfile content was hand-edited.

### Package-manager pin — `pnpm@10.33.0`
`packageManager: "pnpm@10.33.0"` was added to the root and backend manifests; the frontend already
had it. Before this, root and backend commands ran under the global pnpm 11.15.1 while the frontend
silently switched to 10.33.0.

10.33.0 was chosen because it was already the most restrictive existing pin, and it was validated
before adoption rather than assumed:

| Check under pnpm 10.33.0 | Result |
|---|---|
| Root install | exit 0 |
| Backend install | exit 0 |
| Frontend install (`--shamefully-hoist`) | exit 0 |
| `--frozen-lockfile` in all three | exit 0 |
| `allowBuilds` honoured | `pendingBuilds: []`, **no** ignored-builds warning |
| `sharp` functional | real WebP encode, 44 bytes |
| Backend `tsc` / `pnpm run compile` | exit 0 |
| Frontend production build | exit 0 |
| `pnpm -v` in root / backend / frontend | `10.33.0` / `10.33.0` / `10.33.0` |

One operational note: when downgrading an existing pnpm-11 `node_modules`, pnpm 10.33.0 asks to
purge it and aborts in a non-TTY shell with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Setting
`CI=true` lets it proceed. This affects only the one-time transition, not clean clones.

### `backend/pnpm-workspace.yaml` — the Phase 0 correction
**Classification:** code defect. **Justification:** the untouched template could not compile,
start, or run in dev via its own scripts.

At baseline every `allowBuilds` value was the literal placeholder string
`set this to true or false`. pnpm 10+ treats a non-boolean as an undecided build, raises
`ERR_PNPM_IGNORED_BUILDS`, and exits 1 — and because pnpm runs a dependency-status check before
any script, `pnpm run compile`, `pnpm run start`, and `pnpm run dev` all failed before doing any
work. Measured at baseline:

```
pnpm install     exit 1
pnpm run compile exit 1
npx tsc          exit 0     ← the compiler itself was always fine
```

The file now carries real booleans: `sharp: true` (its `install` script is `node install/check`,
which verifies the prebuilt libvips binary), `parse-server: true` (benign postinstall banner), and
`false` for `@apollo/protobufjs`, `@firebase/util`, `@scarf/scarf`, `core-js-pure`, `protobufjs`
(telemetry/banner scripts only).

After the correction: `pnpm install` → 0, `pnpm run compile` → 0 with output emitted, and
`require('sharp')` still resolves 0.33.5. This also unblocks `build:backend` in `.gitlab-ci.yml`,
which runs `pnpm install` on a Node 20 Alpine image.

**Re-validated under the pinned pnpm 10.33.0 during the closeout** and confirmed correct:

- All seven values are real booleans.
- Only two packages are granted build permission, and only because they need it: `sharp`
  (`install: node install/check`, which verifies the prebuilt libvips binary that
  `utils/imageProcessing.ts` depends on) and `parse-server` (a benign `postinstall` banner).
- The other five — `@apollo/protobufjs`, `@firebase/util`, `@scarf/scarf`, `core-js-pure`,
  `protobufjs` — remain `false`; they are telemetry or banner scripts only.
- No unrelated package was granted permission, and permissions were **not** broadened to silence
  the unrelated frontend ignored-builds warning (OQ-16).
- `node_modules/.modules.yaml` records `pendingBuilds: []`, so no build decision is left undecided.
- `sharp` performs a real WebP encode after install (44 bytes), which is exactly the operation
  `processImage()` relies on.

The frontend was never affected by the original defect: it already pinned
`"packageManager": "pnpm@10.33.0"`, and pnpm 10 emits the undecided-build condition as a warning
rather than an error.

## 8. Product features not implemented

None of the following exists in any form — no model, no cloud function, no route, no page, no DTO:

Admin/Student roles · Google OAuth (or any OAuth) · StudentProfile · institution list ·
`expectedGraduationDate` normalisation · private profile photo · Batch · Batch lifecycle and
transition guard · BatchInvitation · invitation tokens · QR generation · `/join/:token` ·
Enrollment · the pending-invitation flow · Resources · PDF validation · resource ordering ·
authorised file download · Live Slides · Tasks · Assignment · Final Task · Submission ·
one-submission locking · Accept-for-publication · Pinned Students · Talent Reels · sanitised
public DTOs · the EN/AR approved copy.

The frontend ships exactly three pages: `/auth` (username + password), `/dashboard` (a
placeholder), and `/users` (a data-table over template users).
