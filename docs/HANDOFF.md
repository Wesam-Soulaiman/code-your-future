# Handoff — Phase 0

**Phase:** 0 — Full-Stack Template Discovery and Code Your Future Project Context
**Date:** 2026-07-30 (discovery) · 2026-07-30 (closeout)
**Branch:** `master` (never left)
**Baseline commit:** `c1517e4` — *chore: initialize full-stack template*
**Ready for review:** **Yes — safe to commit and push.**

Future implementation tasks must update `docs/CURRENT_STATE.md` and `docs/HANDOFF.md`.

---

## 0. Closeout summary (read this first)

Phase 0 ran in two passes: **discovery** (§1–§12 below) and this **reproducibility closeout**.

| Objective | Outcome |
|---|---|
| Documentation trackable | ✅ `docs` ignore rule removed — five documents + both prototypes no longer ignored (**OQ-15 closed**) |
| Reproducible installs | ✅ All three `pnpm-lock.yaml` files trackable; `--frozen-lockfile` exits 0 in all three projects |
| One pnpm version | ✅ `pnpm@10.33.0` pinned via `packageManager` in all three manifests; `pnpm -v` → 10.33.0 in every directory |
| Workspace fix preserved | ✅ Re-validated under 10.33.0; still only `sharp` + `parse-server` permitted |
| Documents updated | ✅ `PRODUCT_REQUIREMENTS.md`, `TEMPLATE_ARCHITECTURE.md`, `CURRENT_STATE.md`, `IMPLEMENTATION_PLAN.md`, `HANDOFF.md` |
| Open Questions surfaced in full | ✅ 16 questions, full text + classification, in `PRODUCT_REQUIREMENTS.md` §17 |
| Phase 1 unblocked | ✅ **No Open Question blocks Phase 1.** OQ-13 resolved by product-owner decision: legacy `AppSettings` will be **removed** in Checkpoint 1 (documented only — nothing removed yet) |
| No Phase 1 work done | ✅ Roles, ACL, master key, redaction, tests, CI, and the `AppSettings` removal all left documented and scheduled |

**Closeout changes — five files, no source code:**

```
 M .gitignore                    two ignore rules removed (docs, pnpm-lock.yaml)
 M package.json                  + packageManager: pnpm@10.33.0
 M backend/package.json          + packageManager: pnpm@10.33.0
 M backend/pnpm-workspace.yaml   (discovery correction, preserved and re-validated)
 M docs/*.md                     documentation updates
```

Nothing under `backend/src/` or `frontend/src/` was touched in the closeout.

### Lockfile policy chosen — Policy B, three tracked lockfiles

Root, `backend/`, and `frontend/` are genuinely independent pnpm projects, so each keeps its own
lockfile. Evidence: there is **no root `pnpm-workspace.yaml`** (and the root lockfile has a single
importer `.` for its one devDependency); `backend/pnpm-workspace.yaml` has **no `packages:` key**
and exists only to carry `allowBuilds`, which pnpm reads only at a workspace root; the frontend
requires `--shamefully-hoist`, a root-level layout setting that would otherwise be forced onto the
backend; and both the root scripts and `.gitlab-ci.yml` already install per directory. Collapsing
to one workspace would mean rewriting the root scripts, the CI file, and the README — a broad
refactor that is out of scope and buys nothing. No lockfile is a duplicate: each resolves a distinct
manifest. All three came out **byte-identical** under the pinned version and are already
`lockfileVersion: '9.0'`; none was hand-edited.

### pnpm version chosen — 10.33.0

Selected because it was already the most restrictive existing pin (the frontend's), so adoption
changes the fewest moving parts — and it was **validated before adoption**, not assumed. The
decisive check was whether pnpm 10.33.0 understands the backend's `allowBuilds` block: it does
(`pendingBuilds: []`, no ignored-builds warning, and sharp performs a real WebP encode afterwards).
Root install, backend install, frontend install with `--shamefully-hoist`, `--frozen-lockfile` in
all three, backend `tsc`, and the frontend production build all exit 0 under it.

**How future developers install** — no global pnpm version needs to match; `packageManager` selects
10.33.0 automatically per directory:

```bash
pnpm install                                        # root
cd backend && pnpm install                          # backend
cd ../frontend && pnpm install --shamefully-hoist   # frontend needs the flat layout
```

or `pnpm run install:all` from the root. Add `--frozen-lockfile` for CI. When downgrading an
existing pnpm-11 `node_modules`, pnpm 10.33.0 asks to purge it and aborts in a non-TTY shell
(`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); `CI=true` lets it proceed. One-time only.

### Closeout validation results

| Check | Result |
|---|---|
| `pnpm install` — root / backend / frontend | exit 0 / 0 / 0 |
| `pnpm install --frozen-lockfile` — all three | exit 0 / 0 / 0 |
| `pnpm -v` — root / backend / frontend | 10.33.0 / 10.33.0 / 10.33.0 |
| `npx tsc --noEmit` (backend) | exit 0, zero diagnostics |
| `pnpm run compile` (backend) | exit 0, emits `build/src/{app.js, app.js.map, cloudCode/}` |
| sharp functional check | WebP encode OK, 44 bytes |
| `pnpm run build` (frontend) | exit 0, 6.91 s; initial bundle 692.08 kB (**192.08 kB over the 500 kB budget** — pre-existing) |
| `pnpm run test` (frontend) | **exit 1 — no test files exist.** Test *absence*, not test failure |
| Backend test command | **none exists** — `backend/package.json` has no `test` script |
| `git diff --check` | clean (only benign LF→CRLF notices) |
| Task-created processes remaining | **zero** |

### Test availability — stated plainly

There are **no test files anywhere** in the repository: zero `*.spec.ts`, zero `*.test.ts` under
`backend/src` or `frontend/src`. The backend has **no test command at all**. The frontend's
`pnpm run test` exits 1 solely because the runner finds nothing to run. **No test passed, because
no test exists.** The Vitest runner itself is known-good — a temporary probe spec passed during
discovery and was deleted. Standing up both harnesses is Checkpoint 1 work.

### Deliberately NOT fixed (Phase 1 and later)

`SuperAdmin`/`Employee` legacy roles · missing Admin/Student boundaries · public fallback ACL ·
`IMG`/`File` public ACL · broad Master Key usage · open `masterKeyIps` · missing log redaction ·
direct Parse access concerns · auth-page language initialisation · **the legacy `AppSettings`
feature and its `app-settingses` route pluralisation** · absent backend tests · absent frontend
tests · GitLab CI targeting `dev` while the repo is GitHub/`master`. Each is now assigned to an
owning checkpoint in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — see *"Phase 1 items deferred
from Checkpoint 0"*. `AppSettings` is still present in the template; only the **decision** to remove
it was recorded.

Frontend build permissions were **not** broadened to silence the unrelated ignored-builds warning
for `@parcel/watcher`, `esbuild`, `lmdb`, `msgpackr-extract` (tracked as **OQ-16**, non-blocking:
install exits 0 and the build succeeds because all four ship prebuilt binaries).

---

## Discovery record (first pass)

---

## 1. Objective

Discover, validate, and document the untouched full-stack template; establish the authoritative
Code Your Future product context; produce a phased plan. **No product feature was to be
implemented — none was.**

## 2. Work completed

- Read in full: `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `README.md`, `PROJECT.md`,
  `GENERATE.md`, all three `package.json`, all four `tsconfig*.json`, `angular.json`,
  `.postcssrc.json`, all three `.gitignore`, `.gitlab-ci.yml`, `.claude/settings.json`,
  `backend/pnpm-workspace.yaml`, `backend/setup.js`, and both prototypes.
- Traced backend source: `app.ts`, `cloudCode/main.ts`, `cron.ts`, `database/seed.ts`, all four
  models, both function modules, and all six `utils/` files.
- Traced the `@90soft/parse-server-kit` **installed dist** (v2.6.0) — `index.d.ts`,
  `parseDecorators.js`, `cloudDecorator.js`, `cloudRegistry.js`, `routeDecorator.js`,
  `triggerRegistry.js`, `middleware/middleware.js`, `database/schema.js`, `database/indexes.js`,
  `utils/{ACL,constants,helper}.d.ts`, `models/BaseModel.d.ts`,
  `decorators/types/{cloudTypes,schemaTypes,fieldValidation}.d.ts` — because nearly all backend
  behaviour lives there rather than in the repo.
- Traced frontend source: bootstrap, routing, guards, interceptor, session, API layer, LiveQuery
  client, i18n, theming, shell nav, all three pages, and the shared component public APIs.
- Ran the baseline validation and the runtime verification in §5–§7.
- Applied **one** minimal correction (§9) and re-verified it.
- Wrote the five context documents (§4).

## 3. Prototypes reviewed

| File | Size | What it shows |
|---|---|---|
| `docs/prototypes/index.html` | 1278 lines, 82.7 KB | Split Student/Admin demo across a 12-step flow: create Batch → invitation → OAuth sign-in → profile → Assignment → submission → review → re-review → Final Task → final submission → final review → showcase. Includes a task builder, an evidence-inspection gate, review modals, and a **Company** discovery view with Talent Reels. |
| `docs/prototypes/slides.html` | 1005 lines, 57.0 KB | Batch Live Slides: session create → slide builder (Welcome / Information / Question / Closing) → Mark Ready → Start → Student joins → answers → question locking → End Session → results by student / by question, saved into Admin-only student profiles. Admin tabs: Overview, Students, Tasks, Live Slides, Pinned Students. |

Both are self-contained static HTML with inline CSS and vanilla-JS state machines. **Neither was
modified** (checksums confirmed in §11).

## 4. Files added

All five are new, and all five currently sit inside a git-ignored directory (see §10):

| File | Purpose |
|---|---|
| `docs/PRODUCT_REQUIREMENTS.md` | Authoritative product behaviour; 25 prototype conflicts; 16 Open Questions in full text with classifications |
| `docs/TEMPLATE_ARCHITECTURE.md` | Architecture, repo map, models, security model, boot flows, extension guidance, 21 known limitations |
| `docs/IMPLEMENTATION_PLAN.md` | Checkpoints 0–12, each with prerequisites, scope, security, tests, manual flow, docs, out-of-scope, definition of done |
| `docs/CURRENT_STATE.md` | Working / partial / failing / environment-dependent / legacy / 16 security gaps / not-implemented |
| `docs/HANDOFF.md` | This document |

## 5. Files modified

| File | Change | Why |
|---|---|---|
| `backend/pnpm-workspace.yaml` | Placeholder `allowBuilds` strings → real booleans | The untouched template could not compile, start, or run in dev via its own scripts. Detailed in §9. |

`.gitignore` also shows as modified — **that change pre-dated this task and was deliberately left
untouched.** See §10.

## 6. Validation commands and exact results

| Command | Location | Result |
|---|---|---|
| `git status` / `git branch --show-current` / `git log --oneline -3` / `git diff --stat` / `git ls-files` / `git ls-files "*lock*"` | root | Recorded in §12; 126 tracked files, **0 tracked lockfiles** |
| `pnpm install` | root | **exit 0** — "Already up to date" |
| `pnpm install` | `backend/` | **exit 1 at baseline** (`ERR_PNPM_IGNORED_BUILDS`) → **exit 0** after §9 |
| `npx tsc --noEmit` | `backend/` | **exit 0**, zero diagnostics (both before and after §9) |
| `pnpm run compile` | `backend/` | **exit 1 at baseline** → **exit 0** after §9; emits `build/src/{app.js, app.js.map, cloudCode/}` |
| *(backend tests)* | `backend/` | **No `test` script exists** — nothing to run |
| `pnpm install --shamefully-hoist` | `frontend/` | **exit 0** (ran under pnpm 10.33.0 via the `packageManager` pin) |
| `pnpm run build` | `frontend/` | **exit 0**, 9.38 s on the final run; output `dist/code-your-future-frontend/browser/` |
| `pnpm run test` | `frontend/` | **exit 1** — `No tests found matching the following patterns: **/*.spec.ts, **/*.test.ts` |
| `pnpm run test` with a temporary probe spec | `frontend/` | **exit 0** — 1 file, 1 test passed, 4.45 s. Probe file deleted immediately. |
| `git diff --check` | root | **exit 0**, no whitespace errors (one benign LF→CRLF notice) |

### Bundle sizes (production build)

| Chunk | Raw | Transfer |
|---|---|---|
| Initial total | **692.08 kB** | 160.86 kB |
| `users-component` (lazy) | 830.29 kB | 170.18 kB |
| `shell-component` (lazy) | 83.10 kB | 17.93 kB |
| `auth-component` (lazy) | 4.89 kB | 1.74 kB |

## 7. Runtime results

Local MongoDB was listening on 27017, so the application was exercised for real.

A **pre-existing** dev stack (`npm run dev`, started 10:17, before this task) already held port
1337 and 4200. The instance this task started therefore logged
`EADDRINUSE {"port":1337}` and was stopped; the runtime probes below were run read-only against the
already-running server.

**Boot sequence observed (own instance, before the port collision):**
model pre-load (AppSettings, File, IMG, `_User`) → 13 Parse deprecation warnings → Parse Server
internal migrations → Cloud Code `main.js` re-imports models then modules → 11 Swagger functions
registered → 11 cloud functions defined → 11 routes mapped → 4 triggers registered
(`File.beforeSave`, `IMG.beforeSave`, `IMG.afterSave`, `IMG.afterDelete`) → `[Cron] No cron jobs to
register` → Swagger at `/api-docs` and `/api-docs/json` → LiveQuery server started.

| Check | Result |
|---|---|
| Backend port | **1337** (hard-coded in `app.ts:118`) |
| Frontend port | **4200** → HTTP 200, `<title>Code Your Future</title>` |
| Swagger UI | `/api-docs` → 301 → UI |
| Swagger JSON | `/api-docs/json` → OpenAPI **3.0.3**, 11 paths, schemas `AppSettings, File, IMG, _User, ParseError, CloudFunctionRequest` |
| Current models | `AppSettings`, `File`, `IMG`, `_User` (4) |
| Current routes | `/api/users/{loginUser,signupUser,getCurrentUser,logout,listUsers,getUser,createUser,updateUser,deleteUser,searchEmployees}` and `/api/app-settingses/getAppSetting` (11) |
| Route restriction | `GET /api/classes/_User` → **403**; `GET /api/schemas` → **403** |
| Unauthenticated cloud fn | `GET /api/users/getCurrentUser` → **400** (not 401) |
| Current authentication | `POST /api/users/loginUser` → `{id, email, username, createdAt, updatedAt, sessionToken, role}`; session token present |
| Current roles | Login returned `role: ["SuperAdmin"]` — proves `seedRoles` + `seedAdminUser` ran |
| Logout | `{"success":true,"message":"Logged out successfully"}` |
| GET param passing | `?limit=1&withCount=true&searchString=…` honoured on **both** `/api/users/listUsers` and `/api/functions/listUsers` → `{"results":[],"count":0}` |
| Master-key-in-body bypass | `POST /api/classes/AppSettings` with the key in a `text/plain` body → **403** (code path exists but is not exploitable here) |
| Public file endpoint | `GET /api/files/{appId}/nonexistent.pdf` → **404** (reachable unauthenticated, not blocked) |
| i18n asset | `/i18n/ar.json` → 200; en/ar both 77 keys, no drift |
| Missing assets | `/images/login1.webp` → **404** (6 files referenced by `AuthComponent`, none exist) |
| `require('sharp')` | loads, 0.33.5 |

**No Code Your Future product data was created.** The only state touched was one Admin login
session, destroyed by the matching logout call.

## 8. Warnings and failures

### Failures
1. **`pnpm run test` (frontend) — exit 1.** No spec files exist anywhere in the repo. The runner
   itself is functional (proved by the probe). *Test defect.*
2. **No backend test script.** `backend/tsconfig.json` includes `test/**/*.ts`; no `test/`
   directory exists. *Test defect.*
3. **`backend/pnpm-workspace.yaml` blocked every backend script at baseline.** *Code defect —
   corrected, §9.*
4. **Six `login*.webp` images and `favicon.ico` are referenced but absent** → 404. *Code defect.*
5. **`pnpm run db`** resolves `backend/backend/dashboard.json`. *Code defect.*
6. **`pnpm run deploy`** calls a non-existent `deploy.js`. *Code defect.*

### Warnings
- Frontend production build: **initial bundle 692.08 kB exceeds the 500 kB budget by 192.08 kB.**
- 13 Parse Server deprecation warnings at boot (`fileUpload.*`, `pages.*`, read-only master key,
  `requestComplexity.*` ×6, protected-field defaults ×2, `installation.*`) — all future-default
  changes, none fatal.
- `pnpm install` (frontend) warns about 4 ignored build scripts (`@parcel/watcher`, `esbuild`,
  `lmdb`, `msgpackr-extract`) — a warning under pnpm 10, not an error.
- `git status --ignored` warns "Filename too long" for two Angular compiler-cli paths under
  `frontend/node_modules/.pnpm/`. Cosmetic; `core.longpaths` is not set.
- `git diff` notes LF→CRLF normalisation for `backend/pnpm-workspace.yaml`.

### Issue classification summary
| Class | Count | Where |
|---|---|---|
| Code defect | 12 | CURRENT_STATE §3, §6 |
| Test defect | 2 | zero specs; no backend test script |
| Documentation defect | 6 | CURRENT_STATE §6 (L-3 … L-6), version drift ×2 |
| Environment issue | 3 | port 1337 hard-coded and already in use; no env validation; Windows long paths |
| Missing local service | 0 | MongoDB was available |
| Deprecation warning | 13 | Parse Server boot |
| Build warning | 2 | bundle budget; frontend ignored build scripts |
| Security gap | 16 | CURRENT_STATE §5 (S-1 … S-16) |
| Legacy template behaviour | 16 | CURRENT_STATE §6 (L-1 … L-16) |
| Prototype conflict | 25 | PRODUCT_REQUIREMENTS §16 (P1 … P25) |
| Open Question | 16 | PRODUCT_REQUIREMENTS §17 (OQ-1 … OQ-16; OQ-15 now resolved) |

## 9. The one code change

**`backend/pnpm-workspace.yaml`** — classification: *code defect*; justification: the untouched
template could not compile, start, or run in dev through its own scripts.

At baseline all seven `allowBuilds` values were the literal placeholder string
`set this to true or false`. pnpm 10+ treats a non-boolean as an undecided build decision, raises
`ERR_PNPM_IGNORED_BUILDS`, and exits 1 — and because pnpm runs a dependency-status check *before*
any package script, that failure aborted `compile`, `start`, and `dev` before any work happened.

Measured at baseline (backend):
```
pnpm install      exit 1
pnpm run compile  exit 1
npx tsc           exit 0     ← the compiler was never the problem
```

The values are now real booleans: `sharp: true` (its `install` script is `node install/check`,
verifying the prebuilt libvips binary), `parse-server: true` (benign postinstall banner), and
`false` for `@apollo/protobufjs`, `@firebase/util`, `@scarf/scarf`, `core-js-pure`, `protobufjs`
(telemetry/banner scripts only). A header comment explains the constraint.

**Tested after the change:** `pnpm install` → exit 0 (both allowed scripts ran and reported Done);
`pnpm run compile` → exit 0 with `build/src/` emitted; `require('sharp')` → 0.33.5; frontend
install/build/test unaffected. This also unblocks the `build:backend` CI job, which runs
`pnpm install` on `node:20-alpine`.

## 10. Open questions

**16 questions. Every one is recorded in full text, with its classification and who must answer it,
in [PRODUCT_REQUIREMENTS.md §17](PRODUCT_REQUIREMENTS.md#17-open-questions)** — the single canonical
list. Summary only below; the full wording lives there.

### Blocking Phase 1 (Checkpoint 1) — none
**No Open Question blocks the start of Phase 1.** OQ-13 was the last one and is now resolved (see
*Resolved* below), so Checkpoint 1 can begin as soon as the Phase 0 output is committed.

### Deferred to a later named checkpoint
| # | Topic | Blocks |
|---|---|---|
| OQ-1 | Admin provisioning policy (mechanism already resolved from source) | Checkpoint 2 |
| OQ-2 | Syrian institution list; `city` free-text or fixed list | Checkpoint 4 |
| OQ-3 | Career-goal shape (free text vs fixed role list, max length) | Checkpoint 4 |
| OQ-4 | Batch metadata fields | Checkpoint 5 |
| OQ-12 | Hash vs path routing (hash routing confirmed active in source) | Checkpoint 6 |
| OQ-10 | Private-file serving mechanism (problem fully characterised in source) | Checkpoint 7 |
| OQ-5 | **Live Slides detailed behaviour — explicitly deferred; does not block Phase 1** | Checkpoint 8 |
| OQ-6 | One Final Task per Batch, or many | Checkpoint 9 |
| OQ-7 | Task deadlines and their interaction with one-submission locking | Checkpoint 9 |
| OQ-8 | File-evidence allowed types and max size | Checkpoint 9 |
| OQ-9 | Talent Reels public field allow-list, ordering, pagination | Checkpoint 10 |
| OQ-11 | Pinned Students vs Talent Reels overlap | Checkpoint 10 |
| OQ-14 | Authoritative CI/deployment target (GitHub/`master` vs GitLab/`dev`) | Checkpoint 12 |

### Non-blocking technical follow-up
- **OQ-16 — frontend ignored build scripts** (`@parcel/watcher`, `esbuild`, `lmdb`,
  `msgpackr-extract`). Warning only: install exits 0 and the production build succeeds because all
  four ship prebuilt platform binaries. Build permissions were deliberately not broadened.

### Resolved
- **OQ-13 — retention of `AppSettings`. ✅ Resolved by product-owner decision: the legacy
  `AppSettings` feature will be removed during Phase 1 (Checkpoint 1).** Reasons on record:
  `getAppSetting` has no current frontend or backend consumer; Code Your Future has no confirmed
  requirement for a generic `AppSettings` model; retaining it unnecessarily expands the API and
  security surface; its generated `app-settingses` route is legacy behaviour; and future
  configuration requirements should use narrowly scoped, typed and sanitised endpoints rather than a
  generic settings store.

  **It has not been removed yet.** `AppSettings` still exists in the clean template — the model, the
  `getAppSetting` cloud function, the `/api/app-settingses/getAppSetting` route, the Swagger schema,
  and the `key_unique` index are all present and were observed at runtime during Phase 0 discovery.
  Removal is Checkpoint 1 scope and is now part of that checkpoint's definition of done. Because the
  class goes away entirely, the mis-pluralised route needs no `@Route('app-settings')` fix.
- **OQ-15 — `docs/` tracking. ✅ Closed in the closeout.** The bare `docs` rule was removed from
  `.gitignore`; `git check-ignore -v` now reports no matching rule for any of the five documents or
  either prototype.

**Genuinely requiring a product-owner decision:** OQ-1, OQ-2, OQ-3, OQ-4, OQ-5, OQ-6, OQ-7, OQ-8,
OQ-9, OQ-11, and OQ-14 (with dev-ops). OQ-10 and OQ-12 are engineering decisions (OQ-12 with product
sign-off on how invitation links look). **No product decision was invented in any pass** — OQ-13 was
answered by the product owner and recorded verbatim.

## 11. Exact Git status

```
$ git branch --show-current
master

$ git log --oneline -3
c1517e4 chore: initialize full-stack template

$ git status
On branch master
Your branch is up to date with 'origin/master'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   .gitignore
	modified:   backend/package.json
	modified:   backend/pnpm-workspace.yaml
	modified:   package.json

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	backend/pnpm-lock.yaml
	docs/
	frontend/pnpm-lock.yaml
	pnpm-lock.yaml

no changes added to commit (use "git add" and/or "git commit -a")

$ git diff --stat
 .gitignore                  |  5 ++++-
 backend/package.json        |  1 +
 backend/pnpm-workspace.yaml | 22 +++++++++++++++-------
 package.json                |  1 +
 4 files changed, 21 insertions(+), 8 deletions(-)

$ git diff --check
(clean — exit 0; one benign "LF will be replaced by CRLF" notice for backend/pnpm-workspace.yaml)

$ git ls-files "*lock*"
(empty — the three lockfiles are untracked-but-no-longer-ignored, awaiting the first commit)

$ git ls-files "docs/**"
(empty — docs/ is untracked-but-no-longer-ignored, awaiting the first commit)
```

The four modified files and the four untracked paths are the complete Phase 0 output.
**No commit was created. Nothing was pushed. No branch was created, renamed, switched, merged, or
deleted.** The lockfiles and `docs/` show as *untracked* rather than *tracked* only because no
commit has been made — the point is that they are **no longer ignored**, so `git add` will pick them
up.

### Verifications
| Verification | Result |
|---|---|
| `.env` files unchanged | ✅ `backend/.env` md5 `812a68d6…` — identical across both passes |
| `backend/dashboard.json` unchanged | ✅ md5 `e4742b51…` — identical across both passes |
| Protected files remain ignored | ✅ `git check-ignore -v backend/.env` → `backend/.gitignore:6:.env`; `git check-ignore -v backend/dashboard.json` → `backend/.gitignore:4:dashboard.json` |
| Documentation trackable | ✅ `git check-ignore -v` returns **no match** for all five `docs/*.md` files |
| Prototypes trackable | ✅ `git check-ignore -v` returns **no match** for `docs/prototypes/index.html` and `slides.html` |
| Lockfiles trackable | ✅ `git check-ignore -v` returns **no match** for `pnpm-lock.yaml`, `backend/pnpm-lock.yaml`, `frontend/pnpm-lock.yaml` |
| No protected file modified | ✅ nothing under `backend/src/cloudCode/utils/`, `database/`, `models/{User,IMG,File}.ts`, `modules/User/`, or `.claude/settings.json` was touched |
| No secret added, exposed, or tracked | ✅ no `.env` write; env keys listed by name only; master key, REST API key, database URI, and session tokens never printed. The REST API key already committed in `environment.ts` / `environment.prod.ts` is reported as gap **S-13** without reproducing its value. The three newly-trackable lockfiles were checked for credentials — they contain only registry URLs and integrity hashes |
| No product model added | ✅ `classNames` remains `AppSettings, File, IMG, _User` |
| No product feature implemented | ✅ zero files added or modified under `backend/src/` or `frontend/src/` in either pass |
| Prototypes unchanged | ✅ `index.html` md5 `b48de413…`, `slides.html` md5 `ffa34244…` — identical across both passes |
| One pnpm version | ✅ `pnpm -v` → `10.33.0` in root, `backend/`, and `frontend/` |
| No task-created process remains | ✅ the discovery pass's process (PID 20148) was stopped and verified gone. The closeout started and left **zero** processes: `Get-Process node` returns nothing, and ports 1337/4200 have no listeners. The user's own dev stack had already been stopped by its owner before the closeout began, so no unrelated process was killed |

## 12. Recommended next action

1. **Commit the Phase 0 output** — the four modified files plus `docs/` and the three lockfiles.
   Nothing blocks this: `docs/` and the lockfiles are trackable, protected files remain ignored, and
   no secret is present. No commit was created by any pass.
2. **Start Checkpoint 1** (Product foundation and access boundaries) from
   `IMPLEMENTATION_PLAN.md` — **no Open Question blocks it** now that OQ-13 is resolved. Its scope
   includes the `AppSettings` removal, and its first sub-task should be standing up both test
   harnesses: there is no backend test script and zero spec files, and the Vitest runner is already
   confirmed working, so only specs are missing.
3. **Answer OQ-1 … OQ-4, OQ-10, OQ-12** to unblock Checkpoints 2–7 as they come up.
4. Do not start **Checkpoint 8** (Live Slides) until **OQ-5** is answered in writing.

**Phase 0 is complete and safe to commit and push.**
