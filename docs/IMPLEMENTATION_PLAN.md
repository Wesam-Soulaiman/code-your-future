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

| Finding | Owning checkpoint | Status |
|---|---|---|
| `SuperAdmin` / `Employee` legacy roles | Checkpoint 1 | ✅ retired |
| Missing `Admin` / `Student` role boundaries | Checkpoint 1 | ✅ done |
| No backend test script; zero backend tests | Checkpoint 1 | ✅ 131 tests |
| Zero frontend tests (runner works, no specs) | Checkpoint 1 | ✅ 66 tests |
| `AppSettings` route mis-pluralised | Checkpoint 1 | ✅ gone with the class |
| Legacy `AppSettings` key-value store (OQ-13) | Checkpoint 1 | ✅ removed |
| Auth-page language initialisation | Checkpoint 1 *(pulled forward from 2)* | ✅ fixed at bootstrap |
| Public fallback ACL in `getSchemaDefinition` | Checkpoint 1 *(pulled forward from 11)* | ✅ neutralised by `schemaGuard` |
| `IMG` / `File` public ACL | Checkpoint 1 *(pulled forward from 11)* | ✅ deny-by-default |
| Broad `useMasterKey` usage | Checkpoint 1 *(pulled forward from 11)* | ✅ audited; 7 client-facing uses deleted |
| Open `masterKeyIps` | Checkpoint 1 *(pulled forward from 11)* | ✅ localhost-only |
| Missing log redaction | Checkpoint 1 *(pulled forward from 11)* | ✅ recursive boundary + Parse adapter |
| Direct Parse access / raw-object exposure | Checkpoint 1 *(pulled forward from 11)* | ✅ `/classes`, `/schemas`, raw files all 403; DTOs are allow-lists |
| Private-file **serving** (OQ-10) | **Checkpoint 7**, hardened in **11** | ⏳ raw access closed; controlled read not built |
| Upload MIME/size/magic-byte validation | **Checkpoints 4 and 7** | ⏳ deferred — no client-reachable upload path exists |
| `cors()` open when `CORS_ORIGINS` unset | **Checkpoint 11/12** | ⏳ |
| Session token in `localStorage` | **Checkpoint 11** | ⏳ storage decision |
| Committed REST API key (S-13) | **Checkpoint 12** | ⏳ rotate before deploy |
| Kit accepts a master key from the request body (S-6) | **upstream / Checkpoint 11** | ⏳ not exploitable; lives in `node_modules` |
| Parse `Date` truncation in the interceptor (L-9) | **Checkpoint 4** | ⏳ will matter once profiles store dates |
| Hash vs path routing (OQ-12) | **Checkpoint 4** | ✅ **decided** — hash routing kept; see TEMPLATE_ARCHITECTURE §17g |
| `applyAllIndexes` never called during startup | **Checkpoint 4 closeout** | ✅ **fixed** — applied and verified before the port opens; see TEMPLATE_ARCHITECTURE §17l |
| The template's table and paginator were unused; every list hand-rolled its own | **Checkpoint 4 closeout** | ✅ **fixed** — the four implemented tables are back on `p-table` + the template's `app-paginator` |
| The Student area had its own header navigation | **Checkpoint 4 closeout** | ✅ **fixed** — both workspaces load the same role-aware shell |
| GitLab CI targeting `dev` while the repo is GitHub/`master`; **CI runs no tests** (OQ-14) | **Checkpoint 12** | ⏳ |
| `GENERATE.md` and `backend/CLAUDE.md` still cite `SuperAdmin`/`Employee` and `models/Employee.ts` | **Checkpoint 2** | ⏳ documentation follow-up |

---

## Checkpoint 1 — Product foundation and access boundaries ✅ COMPLETE

**Delivered.** 197 tests (131 backend + 66 frontend), runtime-validated against a clean isolated
database. See [CURRENT_STATE.md](CURRENT_STATE.md) and [HANDOFF.md](HANDOFF.md).

**Scope changes agreed during delivery** (the checkpoint spec superseded the original plan lines):

| Planned | Actual | Why |
|---|---|---|
| "Split the shell into an Admin workspace and a Student workspace" | Not done | The checkpoint spec forbids implementing a Student dashboard and any UI redesign. The Student workspace belongs to Checkpoints 3–4. |
| "Add a `visitorGuard` / public layout for Talent Reels and `/join/:token`" | Not done | Those routes belong to Checkpoints 6 and 10; adding a guard for non-existent routes would be speculative. |
| "keep Admin user administration" | **Removed instead** | The spec directs removing unsupported user management, and no authoritative document requires generic Admin account administration. Admins are provisioned by seeding. |
| "Decide hash vs path routing (OQ-12)" | ✅ Decided in Checkpoint 4 | Hash routing kept. Invitation links are `https://host/#/join/<token>`. |
| `requireEnrolledStudent` helper | Not added | Enrollment does not exist until Checkpoint 6; an empty helper would be a fake API. `requireAdmin` / `requireStudent` are in place. |

**Additional work not in the original plan**, required by the checkpoint spec: deny-by-default
schema guard, private `File`/`IMG`, master-key and read-only-master-key IP restriction, anonymous
users disabled, raw file routes blocked, log redaction, sanitised errors, safe DTOs, branding, and
the EN/AR auth-initialisation fix.

**Prerequisites:** Checkpoint 0 approved. **No Open Question blocked this checkpoint** — OQ-13 was
resolved (`AppSettings` removed).

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
- ~~Decide hash vs path routing (OQ-12) before any public link is built.~~ ✅ Decided in Checkpoint 4: hash routing kept.

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
**Definition of done — all met:**
- ✅ no `SuperAdmin` / `Employee` grants access anywhere; the only occurrences in app code are the
  `LEGACY_ROLE_NAMES` migration list and tests asserting they authorise nothing;
- ✅ no unauthenticated write path exists — every class is deny-by-default and `POST /users` 404s;
- ✅ **`AppSettings` fully removed** — model file, module file, `getAppSetting`, the
  `/api/app-settingses/*` route, and the Swagger schema are all gone. Runtime shows **3 registered
  models** (`_User`, `File`, `IMG`; 4 definitions including `_Role`) and **3 routes**. *(The plan
  predicted 10 routes; the actual figure is 3 because user management was removed rather than
  retained.)* No `AppSettings` reference remains in `backend/src` or `frontend/src`;
- ✅ both suites green: 131 backend, 66 frontend. **CI does not yet run them** — `.gitlab-ci.yml`
  has no test step. Adding it is Checkpoint 12 work (OQ-14 must be answered first).

---

## Checkpoint 2A — UI/UX design system and authentication experience ✅ COMPLETE

Frontend-only. No backend source changed; the backend suite was run purely as a regression check.

**Delivered:** semantic design tokens, a typography system with language-aware stacks, layout and UI
primitives, a redesigned Admin auth page, a Student auth page that is **presentation only**, an
`/auth/admin` + `/auth/student` route structure with a guest guard, an accessibility baseline, and
frontend regression tests. Details in [TEMPLATE_ARCHITECTURE.md §16b](TEMPLATE_ARCHITECTURE.md) and
[CURRENT_STATE.md §7b](CURRENT_STATE.md).

**Explicitly not implemented:** Google OAuth. The Student Google button is `disabled`, has no click
handler, issues no request, and creates no session.

**Template Preservation Rule honoured:** nothing was deleted. FullCalendar, Timeline, and Editor
theming and every other unused template capability remain, guarded by
`backend/test/templatePreservation.test.ts`.

**Tests:** 210 backend (26 new, all repository-integrity checks) + 167 frontend (82 new).
**Runtime:** 20 viewport × language combinations inspected in a real browser, plus a genuine Admin
login and the signed-in shell at three sizes.

**Two defects found and fixed during the checkpoint** — both caught by validation rather than by
writing code:
1. Re-asserting `'Font Awesome 6 Free'` in the English font override broke **every icon in English**
   (the installed package is Font Awesome 7). Found by looking at a screenshot; fixed by excluding
   icon elements with `:not()` instead of naming a version.
2. `guestGuard` on the parent `/auth` route alone did not run on sibling navigation, because Angular
   does not re-run a parent's `canActivate` when only the child changes. Found by a routing test;
   fixed by also guarding both children.

**Definition of done — met:** design system in place and additive · Admin auth redesigned with all
required states · Student auth UI-only and provably inert · routes safe with no open redirect · EN/AR
parity at 114 keys · zero horizontal overflow at every tested viewport · a11y baseline in place ·
both suites green.

**Remaining for a later checkpoint:** the Admin workspace/dashboard content, and the manual review
items listed in [HANDOFF.md](HANDOFF.md).

---

## Checkpoint 2 — Admin authentication

**Prerequisites:** Checkpoint 1.

> **Note:** Checkpoint 1 already delivered the functional core of this checkpoint — Admin-only
> password login with an after-authentication role check and session revocation, session
> restoration via a safe DTO, idempotent logout, and a 10/min login rate limit. What remains here is
> the Admin **UI** work plus the items listed below.

**Backend scope:** hardening only — the login/session/logout functions exist. Add the account-kind
discriminator so a Student can never hold a password, and review the 400-vs-401 response for
unauthenticated calls. Also update `GENERATE.md` and `backend/CLAUDE.md`, which still cite
`SuperAdmin`/`Employee` and a non-existent `models/Employee.ts`.
**Frontend scope:** the Admin workspace / dashboard design. Login, session restoration via
`provideAppInitializer`, protected routes, logout, and EN/AR auth copy are already in place.
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

## Checkpoint 2B / 3 — Student Google authentication ✅ COMPLETE

Delivered as **Checkpoint 2B**. It is the same scope the plan listed as Checkpoint 3; the numbering
changed when the UI/UX work was split out as 2A.

**Prerequisites met:** Checkpoint 2A. A Google Web Client ID is configured per deployment; no secret
is involved, so nothing was committed that needed to be.

**Delivered**
- `StudentAuthIdentity` — provider, provider subject, and a user pointer. Deny-by-default CLP, empty
  ACL, all columns protected, server-controlled writes, and **two unique compound indexes** that are
  confirmed present in MongoDB at runtime.
- `POST /api/student-auth/loginWithGoogle` — verifies the credential through Parse Server's bundled
  Google adapter (signature, audience, issuer, expiry, subject) plus this repository's own
  `email_verified` rule, then provisions or reuses the Student and issues a real Parse session.
- `GET /api/student-auth/getSession` — role-agnostic restoration carrying no session token and **no
  username**. `/api/users/getCurrentUser` is untouched and still tested.
- Frontend: Google Identity Services on the existing Student page, `/student/welcome`,
  `studentGuard`, role-aware `authGuard`/`guestGuard`, explicit session states, single-flight
  restoration, and translated messages for every failure.

**Deviation from the plan, and why:** the plan proposed wiring Parse's Google auth adapter into
`parseConfig.ts` and calling `logInWith()`. That was **not** done, because Parse persists whatever
`authData` it is given — including the raw `id_token` — which would have stored the credential, and
the checkpoint forbids storing it. The adapter is still used, but as a verification library behind
this repository's own boundary; the session comes from `/loginAs` instead, which also means a
Student account carries no usable password at all.

**Three defects found during validation** — all by *running* the system, none by unit tests:
1. `Parse.User.loginAs` was called directly rather than inside the error wrapper, so a synchronous
   failure carried its internal message to the client.
2. Concurrent first sign-ins for one Google account produced one Student — correct — but the two
   losing requests were told the account was *ineligible*, because the `_User` email index rejects
   them before the identity index does. Recovery now starts from the account conflict.
3. Google's button rendered in **Dutch** on an English page: `renderButton({locale})` is ignored by
   the current Google library, and the language must be set on the script URL (`?hl=`).

**Tests:** 315 backend (+79) and 305 frontend (+82), zero new dependencies. No test contacts Google.
**Runtime:** verified end to end against MongoDB with only Google's token verification substituted —
first sign-in, returning sign-in, three concurrent sign-ins, Admin conflict, role withdrawal, logout,
token reuse, and the safe DTO over the wire. Google's own button was confirmed loading and rendering
in a real browser in both languages.

**Explicitly not implemented:** Complete Profile, `StudentProfile`, Apple sign-in, invitations,
enrollment, account-linking UI, multi-provider linking, and any Student dashboard data.

**Remaining:** a real end-to-end Google sign-in with a live Google account — it needs a human at a
browser and the backend `GOOGLE_CLIENT_ID` set. See [HANDOFF.md](HANDOFF.md).

---

## Checkpoint 3A / 4 — Complete Student Profile ✅ COMPLETE

Delivered as **Checkpoint 3A**, then completed by the **Profile Catalog** work.
Same scope the plan listed as Checkpoint 4's profile half; the Student dashboard
is explicitly **not** part of it.

**OQ-2 and OQ-3 are now resolved and recorded** in
`docs/PRODUCT_REQUIREMENTS.md`, which the product owner authorised amending.
The first cut answered them with a free-text city and a hard-coded institution
array; the catalog work replaced both with the shape the owner finally chose:

- `city`, `institution`, and `major` are **required searchable Selects** over an
  Admin-managed catalog — the authoritative source is a screen, not a source file;
- `targetRole` is an **optional** Select, with an optional 500-character
  "Why did you choose this role?" that is shown only alongside it, cleared with
  it, and excluded from completion;
- `careerGoal` is unchanged: optional, bounded free text.

**Delivered**
- `StudentProfile` — one row per Student behind a unique index on the user
  pointer, deny-by-default CLP, empty class ACL, owner-read record ACL, every
  personal column in `protectedFields`, and a `beforeSave` that refuses client
  writes and freezes the owner.
- `ProfileCatalogItem` — one closed, typed vocabulary for the four selections,
  restricted to `CITY` / `INSTITUTION` / `MAJOR` / `TARGET_ROLE`, with a unique
  `(type, code)` index and an immutable category. Five Admin operations and one
  Student read; **no generic CRUD and no settings store**.
- Three focused profile operations under `/api/student-profile` plus a dedicated
  **authenticated binary photo endpoint**, each requiring live Student
  membership and resolving the profile from the session.
- Server-side completion, UTC month normalisation, and two shared constants
  modules mirrored on the browser with tests that keep each pair in step.
- Complete Profile — the first real product page — in four sections on the
  Checkpoint 2A design system, with searchable PrimeNG Selects, polished
  DatePickers, conditional fields, inline validation, unsaved-change protection,
  a save-then-upload photo flow, and full RTL.
- **Profile Catalogs** — one Admin page at `/dashboard/profile-catalogs` with
  four tabs, search, create / edit / activate / deactivate / delete, loading,
  empty, and error states, and one visible navigation item.
- Profile-aware routing: an unfinished Student is directed to the form; a
  finished one reaches the welcome page, which now shows their real name and an
  Edit action.

**Defects found by running the system, none caught by a unit test:**
1. **The profile photo could not be stored at all** ⟨first cut⟩.
   `Parse.File.save()` in cloud code falls back to an HTTP request to the
   server's own `serverURL`, which Checkpoint 1's raw-file block answers with
   403. `IMG` fails the same way and worse. The bytes live on the private
   profile row; **no security control was changed**, and a first attempt that
   narrowed the block was reverted once runtime evidence showed the master key
   never travels with that request. S-20 / OQ-10 stay open.
2. **A whole photograph was written to the log on every upload** ⟨catalog⟩.
   Parse logs each cloud-function call with its serialised input and result, and
   the upload was a cloud function taking base64. Fixed at the cause — the bytes
   moved to a binary route — and again in redaction as a second layer.
3. **`PROFILE_UNAVAILABLE` on a first save with a photo** ⟨catalog⟩. Choosing an
   image uploaded it immediately, against a profile that did not exist yet. The
   selection is now a local preview and one Save writes the profile first.
4. **A Student's name survived in the log** ⟨found while validating the catalog
   work⟩, in the same lines where their email was already redacted.
5. **PrimeNG's calendar spoke English on an Arabic page** ⟨catalog⟩. It does not
   read `@ngx-translate`; its DatePicker has its own translation object. Found
   by looking at a screenshot.
6. **A language `effect` that reloaded forever** ⟨catalog⟩, because it read the
   loading signal it set. Found by a test that would not go green.
7. A `maxlength` property binding that Angular rejects on a plain input ⟨first
   cut⟩ — caught by the build rather than by a passing test.

**Tests:** 683 backend and 483 frontend, zero new dependencies.
**Runtime:** 65 checks against an isolated database — Admin catalog CRUD across
all four categories, Student active-only reads, the first-save-with-photo order,
no image bytes in any log, catalog references, the optional target role,
deletion versus deactivation, UTC date normalisation, the photo lifecycle,
cross-Student denial, and every Checkpoint 1 and 2B boundary still closed.
**Visual:** 23 captures — both pages at 1440/768/390 in EN and AR, both date
pickers open in both languages, a searchable select open in both, and the Admin
page at desktop and mobile. Zero horizontal overflow, zero clipped text, no
native date field anywhere, no console errors.

**Explicitly not implemented:** Student dashboard data, Batches, invitations,
enrollment, Tasks, and everything else listed as out of scope.

---

## Checkpoint 5 — Batch management ✅ **delivered early, inside Checkpoint 4**

> **Status.** Checkpoints 5 and 6 were delivered together as Checkpoint 4, because
> splitting them would have shipped a Batch nobody could join and then an
> invitation with nothing to invite anybody to. Everything below was implemented;
> the two exceptions are recorded under each scope line.

**Prerequisites:** Checkpoint 4; OQ-4 (Batch metadata fields) answered — ✅ **answered**.

**Backend scope:** `Batch` model with `status` ∈ {draft, active, completed, archived}; a
transition guard enforcing the exact allowed set and rejecting every backward transition and
`draft → completed`; `archived` terminal and read-only; **no hard delete**; metadata editable in
draft/active/completed; Admin-only list/get/create/update/transition.
**Frontend scope:** Admin Batch list and detail. **Delivered with three tabs, not six** —
Overview, Students, and Invitation. Resources, Live Slides, Tasks, and Pinned Students do not
exist, and a tab for one would be a promise the product cannot keep; they arrive with their own
checkpoints. Status chips, transition actions, an archive confirmation that spells out what stops
working, and read-only rendering for `archived` are all present.
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

## Checkpoint 6 — Invitations and enrollment ✅ **delivered early, inside Checkpoint 4**

**Prerequisites:** Checkpoint 5; OQ-12 (routing mode) decided — ✅ **decided**: hash routing kept.

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
**Data-model scope:** `BatchInvitation`, `BatchEnrollment` (named for the Batch it belongs to,
rather than the bare `Enrollment` this plan sketched — there is only one kind, and the name says
what it joins).
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
appears in any log or DTO. ✅ **Met**, with one part of the manual flow outstanding: the end-to-end
walk-through requires a real Google sign-in, which needs the authorised-origin change that is still
outstanding from Checkpoint 2B. Every step either side of the Google round trip was validated
against a running server, and the redirect-back-to-the-invitation behaviour is covered by unit
tests on both the sign-in and the profile-save paths.

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
