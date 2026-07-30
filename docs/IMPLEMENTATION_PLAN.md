# Implementation Plan

Phased plan from the validated template baseline (`c1517e4`) to a deployable Code Your Future.
Requirements come from [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md); the starting point is
described in [TEMPLATE_ARCHITECTURE.md](TEMPLATE_ARCHITECTURE.md) and
[CURRENT_STATE.md](CURRENT_STATE.md).

**Only Checkpoint 0 is complete. Nothing beyond it may be implemented until it is approved.**

Every checkpoint must update `docs/CURRENT_STATE.md` and `docs/HANDOFF.md` as part of its
definition of done.

---

## Checkpoint 0 — Template discovery and context ✅ COMPLETE

**Prerequisites:** none.
**Backend scope:** discovery only; one minimal correction to `backend/pnpm-workspace.yaml` so
backend scripts run under pnpm 10+.
**Frontend scope:** discovery only.
**Data-model scope:** none.
**Authorization and security:** catalogue the template's security gaps; change nothing.
**Tests:** verify install / compile / build; confirm the Vitest harness runs (probe file created,
run, and deleted).
**Manual flow:** boot the backend against local MongoDB; confirm port, Swagger, models, routes,
login, roles, and startup warnings.
**Documentation updates:** create the five `docs/*.md` context documents.
**Out of scope:** any product feature, any rename, any commit or push.
**Definition of done:** backend compiles, frontend builds, runtime verified, five documents
written, all findings classified, no product code added. ✅

### Checkpoint 0 closeout ✅ COMPLETE

Repository reproducibility, performed after discovery. No product code involved.

- **Documentation trackable** — the `docs` rule removed from `.gitignore`; the five context
  documents and both prototypes are no longer ignored (**OQ-15 resolved**). Prototypes unmodified.
- **Lockfile policy** — Policy B: root, `backend/`, and `frontend/` are independent pnpm projects,
  so all three `pnpm-lock.yaml` files are tracked. The `pnpm-lock.yaml` ignore rule was removed;
  `package-lock.json` stays ignored. All three validated with `--frozen-lockfile`.
- **One pnpm version** — pinned to `pnpm@10.33.0` via `packageManager` in all three manifests,
  after validating that 10.33.0 honours the backend's `allowBuilds` and that sharp still works.
- **Workspace fix preserved** — re-validated; only `sharp` and `parse-server` are permitted, and
  permissions were not broadened to silence the unrelated frontend warning (OQ-16).
- **Out of scope, deliberately deferred:** every item in the "deferred to later checkpoints" list
  below.
**Definition of done:** docs and lockfiles trackable, one pnpm version, install/compile/build green,
protected files still ignored, no product feature added. ✅

---

## Phase 1 items deferred from Checkpoint 0 — where each one lands

These were all confirmed during discovery and deliberately **not** fixed in the closeout. Each has
an owning checkpoint:

| Finding | Owning checkpoint |
|---|---|
| `SuperAdmin` / `Employee` legacy roles | **Checkpoint 1** |
| Missing `Admin` / `Student` role boundaries | **Checkpoint 1** |
| No backend test script; zero backend tests | **Checkpoint 1** |
| Zero frontend tests (runner works, no specs) | **Checkpoint 1** |
| `AppSettings` route mis-pluralised to `/api/app-settingses/…` | **Checkpoint 1** — no route fix needed: OQ-13 is resolved and the whole `AppSettings` class is *to be* removed, so the route disappears with it |
| Legacy `AppSettings` key-value store (no consumer, widens API/security surface) | **Checkpoint 1** — *to be removed* outright (resolved product-owner decision, OQ-13); still present today |
| Auth-page language initialisation (`initLang()` only runs in the shell, so `/auth` renders RTL with English text) | **Checkpoint 2** — the login page is rebuilt there |
| Private-file serving / unauthenticated Parse file URLs (OQ-10) | **Checkpoint 7**, hardened in **Checkpoint 11** |
| Public fallback ACL in `getSchemaDefinition` (`{'*':{read:true,write:true}}` when a class omits `ACL`) | **Checkpoint 11** — every new class declares `ACL` explicitly from Checkpoint 1 onward |
| `IMG` / `File` public ACL | **Checkpoint 11** |
| Broad `useMasterKey` usage | **Checkpoint 11** |
| Open `masterKeyIps` | **Checkpoint 11** |
| Missing log redaction | **Checkpoint 11** |
| Direct Parse access concerns / raw-object exposure | **Checkpoint 11** (public DTO discipline starts at Checkpoint 1) |
| GitLab CI targeting `dev` while the repo is GitHub/`master` (OQ-14) | **Checkpoint 12** |

---

## Checkpoint 1 — Product foundation and access boundaries

**Prerequisites:** Checkpoint 0 approved. **No Open Question blocks this checkpoint** — OQ-13 is
resolved (`AppSettings` is to be removed; see Backend scope below).

**Backend scope**
- Introduce the `Admin` and `Student` roles and seed them; retire `SuperAdmin` / `Employee`
  from the application surface. `UserRoles` comes from `@90soft/parse-server-kit`, so add a
  project-local role constant module rather than editing the package.
- Remove the open self-signup path (`signupUser`) and the Employee-oriented
  `searchEmployees`; keep Admin user administration.
- **Remove the legacy `AppSettings` feature entirely** (resolved product-owner decision, OQ-13).
  This deletes `backend/src/cloudCode/models/AppSettings.ts` and
  `backend/src/cloudCode/modules/AppSettings/functions.ts`, which in turn removes the
  `getAppSetting` cloud function, the mis-pluralised `/api/app-settingses/getAppSetting` route, the
  `AppSettings` Swagger schema, and the `key_unique` index — dropping the model count from 4 to 3
  and the route count from 11 to 10. Rationale: no consumer exists, Code Your Future has no
  confirmed requirement for a generic settings model, it needlessly widens the API and security
  surface, and its route prefix is legacy behaviour. Because the class disappears, **no
  `@Route('app-settings')` correction is needed.** Note that the collection may already exist in a
  developer's local MongoDB — document whether the orphaned collection is dropped or simply left
  unreferenced.
- **Establish the replacement rule:** future configuration needs are met with narrowly scoped,
  typed, sanitised endpoints. A generic key-value settings store is a prohibited pattern.
- Add a shared authorization helper layer: `requireAdmin`, `requireStudent`,
  `requireEnrolledStudent`, plus a sanitised-public-DTO helper.
- Add environment validation at boot: fail fast with a named list of missing keys, never print values.

**Frontend scope**
- Replace `config/user-roles.ts` with `Admin` / `Student`.
- Split the shell into an Admin workspace and a Student workspace.
- Make `roleGuard` role-set aware (the current guard reads only the first role).
- Add a `visitorGuard` / public layout for Talent Reels and `/join/:token`.
- Decide hash vs path routing (OQ-12) before any public link is built.

**Data-model scope:** no new domain classes. Role rename plus the **removal** of the `AppSettings`
class (and its unique index). Remaining registered classes afterwards: `_User`, `File`, `IMG`.

**Authorization and security**
- Every new cloud function declares `validation.requireUser` and an explicit role check.
- Establish the rule: **public responses are hand-built DTOs; raw Parse objects are never returned
  to a Visitor.**
- Every new `@ParseClass` MUST declare an explicit `ACL` (the kit defaults to public read+write).

**Tests:** role-constant unit tests; authorization-helper tests for Admin / Student / Visitor /
enrolled-Student; environment-validation tests. A regression test asserting that **no
`AppSettings` route, function, or schema is registered** after removal. Establish the Vitest +
backend test harness (currently absent).
**Manual flow:** Admin logs in and sees the Admin workspace; a non-Admin cannot reach Admin routes.
Boot the server and confirm the startup log registers 3 models and 10 routes, with no
`app-settingses` entry, and that `/api-docs/json` no longer lists an `AppSettings` schema.
**Documentation:** update `PROJECT.md` to the real role model; record the `AppSettings` removal as
done; update `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** OAuth, profiles, Batches. Replacing `AppSettings` with any new settings mechanism —
none is required, and a generic settings store is now prohibited.
**Definition of done:**
- no `SuperAdmin` / `Employee` string remains in app code;
- no unauthenticated write path exists;
- **`AppSettings` is fully removed** — the model file, the module file, the `getAppSetting` cloud
  function, the `/api/app-settingses/*` route, and the `AppSettings` Swagger schema are all gone,
  the startup log shows 3 registered models and 10 routes, and no `AppSettings` reference remains
  anywhere in `backend/src` or `frontend/src`;
- both test suites run green in CI.

---

## Checkpoint 2 — Admin authentication

**Prerequisites:** Checkpoint 1.

**Backend scope:** Admin-only password login; session restore endpoint; logout that destroys the
`_Session`; reject Student accounts on the password path. Rate-limit login
(`@CloudFunction({rateLimit})` is supported by the kit).
**Frontend scope:** Admin login page; session restoration via `provideAppInitializer`; protected
Admin routes; logout; translated auth errors (EN/AR).
**Data-model scope:** `_User` gains an explicit account-kind discriminator so a Student can never
authenticate by password.
**Authorization and security:** no password endpoint reachable by Students; no session token in
logs or URLs; decide session storage (see CURRENT_STATE security gap S-4).
**Tests:** login success/failure, role enforcement, logout invalidation, restore-on-reload,
rate-limit trip.
**Manual flow:** log in → reload (still authenticated) → log out → back button does not restore access.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** Student auth.
**Definition of done:** Admin can log in, reload, and log out; no password path exists for Students.

---

## Checkpoint 3 — Student Google authentication

**Prerequisites:** Checkpoint 2; Google OAuth client configured out-of-band (no secret in the repo).

**Backend scope:** Google auth adapter wired into `parseConfig.ts`; `logInWith()` **must** use
`{useMasterKey: true}` (Parse Server ≥ 9.6 enforces the Create CLP on auth signup); create the
`Student` role assignment on first sign-in; store the verified email read-only; never expose OAuth
identity payloads.
**Frontend scope:** Google sign-in entry point; post-sign-in routing (complete-profile vs
dashboard); the approved EN/AR copy from PRODUCT_REQUIREMENTS §4 verbatim.
**Data-model scope:** `_User` OAuth linkage only; `authData` excluded from every DTO.
**Authorization and security:** no Student password login / reset / change; verify the Google
token server-side; a Student may sign in **without** an invitation.
**Tests:** first sign-in creates exactly one Student; repeat sign-in reuses the account; password
login rejected for Students; `authData` absent from all responses.
**Manual flow:** Google sign-in from a clean browser → land on Complete Profile.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** Apple sign-in; invitations.
**Definition of done:** a Google account becomes a Student with no invitation and no password.

---

## Checkpoint 4 — Complete Profile and Student dashboard

**Prerequisites:** Checkpoint 3; OQ-2 (institution list, city), OQ-3 (career goal) answered.

**Backend scope:** `StudentProfile` model (one per Student, enforced by a unique index on the user
pointer); create/update/read functions resolving the Student from the session only; month/year
normalisation for `expectedGraduationDate` (first of month, UTC); `Graduate` clears it,
`Current Student` requires it; institution list + `Other` requiring a custom name; private photo
upload (image-only, non-empty, ≤ 5 MiB) with keep / replace / remove.
**Frontend scope:** single-page Complete Profile form (**typed reactive forms** — the template has
none); month/year picker; read-only email; photo uploader reusing `image-uploader`; Student
dashboard; profile-completeness gate.
**Data-model scope:** `StudentProfile` with exactly the fields in PRODUCT_REQUIREMENTS §5 —
one education record, no CV, no salary, no work preferences, no experience, no self-ratings.
**Authorization and security:** a Student reads/writes only their own profile; an Admin reads;
Visitors have no access. The photo must not be publicly readable — this collides with the
template's unauthenticated file URLs (OQ-10, security gap S-2).
**Tests:** required-field validation; `June 2027` → `2027-06-01T00:00:00.000Z`; `Graduate` clears
the date; `Other` requires a name; photo type/size/emptiness rejection; one-profile-per-Student.
**Manual flow:** sign in → complete profile → reload → dashboard shows the saved profile.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** Batches, enrollment.
**Definition of done:** a Student can complete and edit a profile with correct UTC month
normalisation and a private photo, with no invitation involved.

---

## Checkpoint 5 — Batch management

**Prerequisites:** Checkpoint 4; OQ-4 (Batch metadata fields) answered.

**Backend scope:** `Batch` model with `status` ∈ {draft, active, completed, archived}; a
transition guard enforcing the exact allowed set and rejecting every backward transition and
`draft → completed`; `archived` terminal and read-only; **no hard delete**; metadata editable in
draft/active/completed; Admin-only list/get/create/update/transition.
**Frontend scope:** Admin Batch list and detail with the Batch navigation (Overview, Students,
Resources, Live Slides, Tasks, Pinned Students); status badges; transition actions with
confirmation; read-only rendering for `archived`.
**Data-model scope:** `Batch` only. **Never** a `Program` model, route, DTO, page, or nav term.
**Authorization and security:** all mutations Admin-only; Students see only their enrolled
Batches; Visitors see nothing; drafts never leak into any public DTO.
**Tests:** each allowed transition; each forbidden transition rejected; archived write attempts
rejected; metadata editable in the three permitted statuses.
**Manual flow:** create a draft → activate → complete → archive → confirm read-only.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** invitations, enrollment, Resources, Tasks.
**Definition of done:** the lifecycle matrix in PRODUCT_REQUIREMENTS §6 is enforced server-side and
reflected in the UI.

---

## Checkpoint 6 — Invitations and enrollment

**Prerequisites:** Checkpoint 5; OQ-12 (routing mode) decided.

**Backend scope:** one current invitation per Batch; token from a CSPRNG, URL-safe, unpredictable,
unrelated to `objectId`, never logged, excluded from generic DTOs; generate / expire / revoke /
rotate (rotation invalidates the previous token immediately); a **safe public inspect** function
returning only `{valid, reason, batchName}`; `Enrollment` creation that resolves the Student from
the session (**never** a client `studentId`), requires a valid invitation, requires a complete
profile, requires `active` Batch status, and is **idempotent**; a unique compound index on
(batch, student).
**Frontend scope:** Admin invitation panel (generate, copy, QR preview, QR download, expire,
revoke, rotate); public `/join/:token` route; the 10-step pending-invitation flow from
PRODUCT_REQUIREMENTS §9; temporary token state cleared on success, invalid token, logout, or
cancellation; translated invalid-token states.
**Data-model scope:** `BatchInvitation`, `Enrollment`.
**Authorization and security:** the token never appears in logs, generic DTOs, or error messages;
inspect leaks nothing private; a rotated/expired/revoked token fails closed; Admin cannot enroll
anyone manually.
**Tests:** token uniqueness and entropy; rotation invalidates the old token; expired and revoked
tokens rejected; double redemption creates exactly one enrollment; client-supplied `studentId`
ignored; enrollment blocked on non-active Batches and incomplete profiles; the full pending flow
including sign-in mid-flow.
**Manual flow:** Admin generates a link → Visitor opens it in a clean browser → Google sign-in →
Complete Profile → enrollment created once → Batch Overview. Then rotate and confirm the old link
fails.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** manual enrollment, approval, waiting lists, enrollment scoring, Student removal.
**Definition of done:** the pending-invitation flow works end-to-end, is idempotent, and no token
appears in any log or DTO.

---

## Checkpoint 7 — Resources

**Prerequisites:** Checkpoint 6; OQ-10 (private file serving) answered — this checkpoint cannot
be secure without it.

**Backend scope:** `Resource` model scoped to a Batch with an explicit order field; PDF-only
validation (extension **and** MIME **and** non-empty **and** `%PDF-` magic bytes) with a 20 MiB
default cap; metadata edit that cannot replace the file; Move Up / Move Down reordering; Admin
manage in draft/active/completed, read-only in archived; enrolled-Student read; **an authorised
download endpoint — no public raw file access.**
**Frontend scope:** Admin Resource list with upload, metadata edit, reorder, delete; Student
read-only list and viewer; archived read-only.
**Data-model scope:** `Resource` (+ ordering strategy).
**Authorization and security:** close security gaps S-2 and S-3 — Parse's unauthenticated
`/api/files/{appId}/{name}` URLs and the static `backend/files/` mount must not expose Resources.
Every download is authorised per request.
**Tests:** non-PDF rejected by extension, by MIME, and by magic bytes; empty file rejected;
oversize rejected; metadata edit leaves the file untouched; reorder correctness; unauthenticated
and non-enrolled download attempts denied; archived writes denied.
**Manual flow:** upload three PDFs, reorder, edit metadata, read as an enrolled Student, confirm a
Visitor and a non-enrolled Student are denied, archive the Batch and confirm read-only.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** non-PDF resource types, versioning.
**Definition of done:** no PDF is reachable without an authorised request, and every validation
rule above is enforced server-side.

---

## Checkpoint 8 — Live Slides

**Prerequisites:** Checkpoint 7 **and OQ-5 answered in writing.** This checkpoint must not start
while Live Slides behaviour is undefined; the prototype design is explicitly rejected
(conflicts P15–P18).

**Backend scope:** to be defined once OQ-5 is answered — a `LiveSlidesSession` scoped to a Batch,
Admin session control, enrolled-Student participation, and the confirmed answer-handling rule.
LiveQuery is the natural transport: add the class to `liveQuery.classNames` in `parseConfig.ts`
**and** a `beforeSubscribe` hook in `main.ts` (role-based CLP alone is unreliable in this Parse
Server version), plus per-record ACL.
**Frontend scope:** Admin presenter control surface; Student participation view; the existing
`LiveQueryService` becomes live for the first time.
**Data-model scope:** deferred to OQ-5.
**Authorization and security:** Visitors have no access; only enrolled Students of that Batch
participate; **no scores, grades, ratings, correct-answer grading, evaluation, feedback, ranking,
recommendations, or AI evaluation**; answers must not be persisted into a permanent Student
evaluation profile.
**Tests:** access control per role and per enrollment; `beforeSubscribe` rejects unauthenticated
and non-enrolled subscribers; whatever answer rule OQ-5 defines.
**Manual flow:** Admin runs a session; an enrolled Student participates; a non-enrolled Student
and a Visitor are denied.
**Documentation:** record the OQ-5 decision in `PRODUCT_REQUIREMENTS.md` before coding.
**Out of scope:** anything not confirmed by OQ-5.
**Definition of done:** the confirmed behaviour is implemented with no prohibited feature present.

---

## Checkpoint 9 — Assignment and Final Task

**Prerequisites:** Checkpoint 8; OQ-6 (multiple Final Tasks), OQ-7 (deadlines), OQ-8 (file
evidence limits) answered.

**Backend scope:** `Task` model with `type` ∈ {Assignment, FinalTask} and an evidence-options set
(GitHub, Live Demo, Drive/Doc, File, Video URL, Text) requiring at least one; `Video URL`
mandatory for Final Task; `Submission` model enforcing **one submission per Student per Task**,
locking on submission, with no late submission and no edit-after-submit; Final Task **Accept for
publication** (a publication decision only) and **remove from Reels**.
**Frontend scope:** Admin task creation and task list; Student task list and submission form
driven by the task's evidence options; a clear locked state after submission; Admin submission
view; Accept / remove-from-Reels controls.
**Data-model scope:** `Task`, `Submission`.
**Authorization and security:** only enrolled Students of the Batch may submit; a Student reads
only their own submissions; **no rubrics, grades, scores, ratings, evaluation, feedback,
recommendations, *Needs Update*, re-review, or AI evaluation**; unaccepted Final Tasks are never
public; no direct video upload.
**Tests:** at-least-one-evidence enforcement; Final Task rejects a missing video URL; second
submission rejected; edit-after-submit rejected; non-enrolled submission rejected; Accept flips
publication only; remove-from-Reels works; an unaccepted Final Task is absent from every public
response.
**Manual flow:** publish an Assignment → submit once → confirm locked and no second submission;
publish a Final Task → submit with a video → Admin Accepts → appears in Reels → Admin removes it.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** every prohibited evaluation feature; the prototype's inspection gate,
re-review, and skill ratings.
**Definition of done:** both task types work with one-submission locking and no evaluation
surface anywhere in code, API, or UI.

---

## Checkpoint 10 — Pinned Students and Talent Reels

**Prerequisites:** Checkpoint 9; OQ-9 (public field set) and OQ-11 (pin/publication overlap) answered.

**Backend scope:** `PinnedStudent` scoped to a Batch, Admin-only, with no score and no rating; a
public Talent Reels endpoint returning **sanitised DTOs of accepted Final Task videos only**.
**Frontend scope:** Admin Pinned Students tab; public Talent Reels page reachable by a Visitor.
**Data-model scope:** `PinnedStudent`; a public projection over accepted Final Tasks (no new
storage for Reels unless OQ-11 requires it).
**Authorization and security:** the public payload excludes email, phone, date of birth, OAuth
identities, session tokens, invitation tokens, enrollment internals, ACL, CLP, Admin metadata,
drafts, private Resources, unaccepted Final Tasks, and raw Parse objects. No likes, comments, or
ratings. Assignments never appear.
**Tests:** a golden-file test asserting the **exact** public DTO key set; unaccepted Final Tasks
absent; Assignments absent; every forbidden field absent; pinning grants no public visibility.
**Manual flow:** as a logged-out Visitor, browse Reels and inspect the network payload for leaks.
**Documentation:** `PROJECT.md`, `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** likes, comments, ratings, ranking, recommendations.
**Definition of done:** the public payload contains only approved fields, proven by an
allow-list test.

---

## Checkpoint 11 — Security hardening

**Prerequisites:** Checkpoints 1–10.

**Backend scope:** close every gap catalogued in `CURRENT_STATE.md` §5 — restrict `cors()` to
known origins; restrict `masterKeyIps`; remove or gate the request-body master-key path; declare
an explicit `ACL` on every class (including `IMG` and `File`); add MIME / extension / size /
magic-byte validation on every upload path; add a log-redaction layer so tokens and keys can never
be logged; stop serving `backend/files/` statically; return 401 rather than 400 for unauthenticated
calls; audit every `useMasterKey: true` call site and narrow it; rate-limit auth and invitation
endpoints; call `applyAllIndexes` so compound and field indexes are actually created; `await`
`seedAll()`.
**Frontend scope:** decide and implement session-token storage; add a CSP; ensure no token
reaches a URL or a log; confirm no secret is bundled (the REST API key is currently committed in
both `environment.ts` and `environment.prod.ts`).
**Data-model scope:** an ACL/CLP review of every class, documented as a table.
**Authorization and security:** a written role × resource × operation matrix, each cell backed by
a test.
**Tests:** negative authorization tests for every endpoint × every role including Visitor; a
public-payload leak test; upload-rejection tests; token-in-log tests.
**Manual flow:** attempt each forbidden action as Visitor, Student, and non-enrolled Student.
**Documentation:** a security section in `PROJECT.md`; `CURRENT_STATE.md`, `HANDOFF.md`.
**Out of scope:** penetration testing by a third party.
**Definition of done:** every gap in `CURRENT_STATE.md` §5 is closed or explicitly accepted in
writing with a rationale.

---

## Checkpoint 12 — Final E2E and deployment readiness

**Prerequisites:** Checkpoint 11; OQ-14 (GitHub vs GitLab CI) answered.

**Backend scope:** boot-time environment validation with a clear failure report; make the port
configurable; production logging and health checks; a documented migration/seed path for a fresh
database.
**Frontend scope:** production build within budget (the template already exceeds the 500 kB
initial budget by 192 kB); real production environment values; the placeholder
`https://your-domain.com` replaced; the missing `login1..6.webp` and `favicon.ico` assets supplied
or their references removed.
**Data-model scope:** frozen; all indexes and validators applied and verified.
**Authorization and security:** a final review that no secret is committed; rotate the REST API
key that is currently in the repo; confirm `.env` and `dashboard.json` remain untracked.
**Tests:** full backend and frontend suites green; E2E coverage of all eight confirmed flows in
PRODUCT_REQUIREMENTS §15; CI green on the chosen platform. *(Lockfile tracking and the pnpm pin were
completed in the Checkpoint 0 closeout — verify here that CI installs with `--frozen-lockfile` under
`pnpm@10.33.0`.)*
**Manual flow:** deploy to staging and walk all eight confirmed flows in EN and AR, LTR and RTL,
light and dark.
**Documentation:** `PROJECT.md` final; `CURRENT_STATE.md` reflecting the shipped state;
`HANDOFF.md` release notes.
**Out of scope:** post-launch features.
**Definition of done:** CI green, staging verified in both languages and both directions, no
prohibited feature present, no secret committed, and every Open Question either answered or
explicitly deferred in writing.
