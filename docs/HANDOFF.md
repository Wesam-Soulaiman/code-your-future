# Handoff — Checkpoint 2B

**Checkpoint:** 2B — Student Google Authentication
**Date:** 2026-07-31
**Branch:** `master` (never left)
**Baseline commit:** `9ec03df` — *feat: establish UI UX foundation and authentication experience*
**Safe for review:** **Yes**, and **safe to commit** — see §26.
**Closeout applied:** Google privacy, authorized-origin handling, and popup communication — §26.

Checkpoint 2A's handoff is preserved in the repository history at `9ec03df`, Checkpoint 1's at
`0344a43`, and Phase 0's at `a796aa0`.

---

## 1. Objective

Enable real Google authentication for Students: open `/auth/student`, sign in with Google, have the
backend verify the credential, create or reuse the Student safely, assign the Student role, issue a
real Parse session, land on a protected welcome page, survive a refresh, and log out for good.

Nothing beyond that — no Complete Profile, no Batches, no invitations, no enrollment, no Student
dashboard data.

---

## 2. Initial state

```
$ git status              nothing to commit, working tree clean
$ git branch --show-current   master
$ git log --oneline -3
9ec03df feat: establish UI UX foundation and authentication experience
0344a43 feat: establish secure product foundation and access boundaries
a796aa0 docs: establish project context and template architecture
$ git diff --stat         (empty)
```

---

## 3. Google configuration architecture

One backend variable — **`GOOGLE_CLIENT_ID`**, the Google Cloud **Web application** Client ID — and
the same public value in the browser as `googleClientId` in
`frontend/src/environments/environment{,.prod}.ts`.

**There is no client secret anywhere, by design.** The browser flow returns a signed ID token
directly; verifying it needs Google's public keys and the expected audience, so no
authorization-code exchange exists and no secret has to be stored. A test asserts that neither
environment file declares a `clientSecret`, and that `googleClientId` is either empty or has the
published `NNN-xxxx.apps.googleusercontent.com` shape.

**Missing configuration fails safely.** The server boots normally and logs *which key* is absent —
never a value. Only the Student endpoint refuses, with the stable code `GOOGLE_NOT_CONFIGURED`.
**Admin password login keeps working**, verified at runtime with the variable unset.

`backend/.env` was **not** modified. The runtime checks supplied the variable as an in-process
override.

---

## 4. Student auth UI

The Checkpoint 2A page is unchanged in structure, copy, and styling; the Google action now works.

Google's **own** rendered button is used — it is the supported entry point for this flow and carries
Google's required branding — and it sits in the slot the page already reserved. Until the library is
ready, and whenever it cannot load or the deployment is unconfigured, the same slot shows the
explained, disabled control from 2A, so the page never presents an action that cannot work.

States: SDK loading · ready · authenticating · redirecting · cancelled/dismissed · invalid
credential · unverified Google email · account not eligible · rate limited · backend unavailable ·
missing configuration. Every one is a translated key chosen from the backend's stable code —
**no raw Google or Parse string is ever rendered**. Duplicate submission is prevented, the message
area is reserved so nothing shifts, errors are announced assertively, and EN/AR with full RTL is
preserved. Still no email, username, password, signup, reset, or invitation-token field, and no
Apple button.

The approved invitation copy appears verbatim in both languages, on this page and on the welcome
page.

---

## 5. Backend verification flow

`modules/StudentAuth/googleVerifier.ts` is the single trust boundary. It delegates the cryptography
to **Parse Server's bundled Google auth adapter** — the official server-side mechanism for this
stack — which fetches Google's JWKS and checks the RS256 signature, the audience, the expiry and the
issuer. No JWT or OAuth code is written in this repository.

On top of that, this module re-asserts audience, issuer, expiry and subject on the *verified* claims
and adds the product rule the adapter does not enforce: **`email_verified === true`**.

The adapter needs the expected subject up front, so the token payload is base64-decoded **without
any trust** to obtain a candidate; the adapter then verifies the signature and asserts that the
*verified* `sub` equals that candidate. A forged payload changes the candidate but cannot make the
signature check pass.

The request carries exactly one meaningful field, `credential`. An `email`, `name`, `sub`, or
`profileStatus` sent alongside it is **never read**; `role`, `roles`, `userId`, `sessionToken`, and
`authData` are refused outright by the shared privileged-parameter gate.

**Never happens:** the credential is not logged, not returned, not stored, and not placed in a URL;
no raw claim is persisted; no role is accepted from a client; no internal verification error reaches
the caller.

---

## 6. `StudentAuthIdentity`

Three columns — `provider`, `providerSubject`, and a `user` pointer. Nothing else: no credential, no
token, no email, no name, no picture, no locale, no claim of any kind.

Deny-by-default CLP on all six operations, an empty default object ACL, `protectedFields` covering
every column for both `*` and `authenticated`, and a `beforeSave` that refuses any non-master write,
refuses to make the record public, and freezes the three columns after creation. **No cloud function
reads, lists, or returns an identity record**, asserted by test.

Two unique compound indexes, both confirmed present in MongoDB at runtime and both observed
rejecting a duplicate with error `11000`:

| Index | Guarantees |
|---|---|
| `(provider, providerSubject)` | one Google account maps to exactly one Student |
| `(provider, _p_user)` | one Student holds at most one identity per provider |

`_p_user` is the MongoDB column name for a Parse pointer; naming the logical field would have
indexed a column that does not exist.

---

## 7. First sign-in

One `_User`, the `Student` role granted server-side, one identity record, one Parse session, and a
safe DTO.

The username is `gid_` + 24 random bytes and the password is 48 random bytes, both from
`crypto.randomBytes`. Both are server-generated, unpredictable, never returned, never logged, and
the password is discarded the moment `save()` completes. **The Google email is never used as a login
identifier.** The password is unusable regardless: `loginUser` verifies the Admin role after
authentication and destroys the session for anyone else.

A failed verification creates nothing — confirmed at runtime by counting `_User` rows before and
after.

---

## 8. Returning sign-in

The identity is found, the account is reused, no `_User` and no identity are created, and live
`Student` membership is re-checked. Provisioning is idempotent: three sequential sign-ins produced
exactly one account and one identity.

---

## 9. Concurrent sign-in protection

Decided by the **database**, not by an in-memory check. There are two distinct races, and the second
was found only by running the system:

1. **The identity index rejects the second writer.** It deletes the `_User` it had just created and
   continues on the winner's account.
2. **The `_User` email index rejects the second writer first**, before the identity index ever sees
   it. Recovery therefore starts from the account conflict: look for an identity on the same
   subject, briefly retrying because the winner may be between its two saves, and continue on the
   winner's account. Without this, the losers were told the account was *ineligible*.

Runtime result: **three simultaneous sign-ins → three successful responses, one account, one
identity.**

---

## 10. Identity conflicts

| Situation | Behaviour |
|---|---|
| Email already held by an Admin | `ACCOUNT_NOT_ELIGIBLE`. Nothing merged, nothing converted, nothing created. Verified at runtime. |
| Identity already linked to another Student | The existing link wins; a second account can never claim it. |
| Student role withdrawn | The next sign-in is refused, and the next restoration reports `roles: []`. |
| Legacy `SuperAdmin` / `Employee` membership | Grants nothing. |
| Client-supplied email, name, or subject | Never read — identity comes only from the verified token. |
| Client-supplied role | Rejected outright with `119`. |

No response distinguishes a conflicting account from an unknown one, so the endpoint cannot be used
to discover whether a given Google address has an account here.

No account-linking UI and no multi-provider linking were built.

---

## 11. Sessions, restoration, and the safe DTO

Sessions come from Parse's own **`/loginAs`**, which exists so a trusted server can create a session
for a user it authenticated another way. It is required because a Student has no usable password.
`/loginAs` refuses anything but a full master key, and `restrictRoutes` blocks it for external
callers — **403 observed from outside**; cloud code reaches it through Parse's `directAccess` path,
which is enabled by mounting `parseServer.app` in `app.ts`.

The session is an ordinary revocable `_Session`. Logout invalidates it and the old token then fails
with `209`, both observed.

| Response | Keys |
|---|---|
| `loginWithGoogle` (the only one with a token) | `id`, `roles`, `displayName?`, `sessionToken` |
| `getSession` (routine restoration) | `id`, `roles`, `displayName?` |

Never present: session token on the routine call, password, `authData`, ACL, raw Parse objects, raw
role objects, email, phone, the Google subject, the credential, any provider claim, the internal
username, or anything from `StudentAuthIdentity`. Verified over the wire, not only in unit tests.

`displayName` is built server-side from the **verified** Google names for a Student, and from the
login name for an Admin. A Student with no name gets no display name rather than an identifier.
There is **no profile-completion status**, because it cannot be truthfully derived until
`StudentProfile` exists.

**Frontend session state** gained explicit `restoring` / `authenticated` / `unauthenticated` states.
Restoration is awaited during bootstrap, so the router never activates a route while roles are still
unproven — no protected-content flash. `restoreSession()` shares one in-flight request, so two
callers cause one call. A rejected token clears both stored values and returns the visitor to the
sign-in page matching the session they had. No second state-management library was added; language
preference is untouched by sign-out.

---

## 12. The `getSession` endpoint, and the protected-path blocker

**Blocker, reported rather than worked around.** §9 of the checkpoint forbids returning the internal
username. `/api/users/getCurrentUser` returns `username`, which for a Student is exactly that
value — but `backend/src/cloudCode/utils/dto/` and `modules/User/` are **protected paths** under
`CLAUDE.md`, and the Checkpoint 1 handoff records that a previous task was corrected for
reinterpreting those rules.

So `getCurrentUser` was left untouched, still registered and still tested, and a new role-agnostic
`getSession` was added in the new module. The browser restores through `getSession`; the older
endpoint simply is not what the frontend calls.

**Owner decision available:** if the protection rules are amended to allow it, `getCurrentUser` and
`getSession` should be merged into one endpoint. Two restoration endpoints is redundancy this
checkpoint could not remove on its own authority.

---

## 13. Routes and guards

| Route | Guard | Visitor | Student | Admin |
|---|---|---|---|---|
| `/auth/student` | `guestGuard` | shown | → `/student/welcome` | → `/dashboard` |
| `/auth/admin` | `guestGuard` | shown | → `/student/welcome` | → `/dashboard` |
| `/student/welcome` | `studentGuard` | → `/auth/student` | shown | → `/dashboard` |
| `/dashboard` | `authGuard` | → `/auth/admin` | → `/student/welcome` | shown |

A Visitor asking for the Student area is sent to **Student** sign-in, not Admin: somebody following
a Student link should not be asked for a password they will never have.

Every target is a fixed internal path defined once in `guards/home-route.ts`; a test asserts no
redirect target contains a scheme or `//`, so none can become an open redirect. Guards sit on the
parent **and** each child, because Angular does not re-run a parent's `canActivate` when only the
child changes. Restoration completes before any guard runs. No redirect loop exists in either
direction, asserted by test.

---

## 14. Security, privacy, and one honest gap

**No Phase 1 control regressed** — re-verified at runtime: Admin login works; Student password login
refused; `/classes/*` and `/schemas` 403 (including `StudentAuthIdentity`, and including with a
master-key header); raw file routes 403; `POST /users` 404; `requestPasswordReset` 403;
`app-settingses` 403; CORS still allow-listed with no wildcard; master key still localhost-only;
recursive redaction intact; errors still sanitised; `AppSettings` still absent.

**Master-key operations added — five, each narrow and server-initiated:**

| # | Operation | Why it must use the master key |
|---|---|---|
| 1 | Read `StudentAuthIdentity` | The class denies every client read. |
| 2 | Read `_User` | `find`/`get` CLP are `{}`. |
| 3 | Create `_User` | The product forbids manual Student creation; only the server may do it. |
| 4 | Add the user to the `Student` role | Client-chosen roles are forbidden. |
| 5 | Issue a session via `/loginAs` | The Student has no password to present to `logIn`. |

`useMasterKey` usage was **not** broadened anywhere else.

**Logging.** The credential, the verified email, the internal username, and the session token are
all absent from the logs — scanned, not assumed. This module's own logging emits an allow-list of
seven fields (`op, provider, stage, ok, code, userId, created`) and drops anything else, so a future
edit cannot start logging a claim by adding one field to a call. Asserted by test.

**Gap S-19 — closed in the closeout (§26).** The Google subject no longer reaches the log at any
level, and no `LOG_LEVEL` setting is required for privacy.

---

## 15. Defects found during validation

All three were found by **running** the system. None was caught by the unit suites, and each now has
a regression test.

1. **`Parse.User.loginAs` was called outside the error wrapper.** A synchronous throw — a missing
   method on a misconfigured SDK — escaped `catchError` and carried its internal message to the
   client. Both the issuer and `issueStudentSession` now sanitise.
2. **Concurrent first sign-ins failed for the losers.** One account and one identity resulted, which
   was correct, but two of three requests were told the account was ineligible, because the `_User`
   email index rejects them before the identity index does. Recovery now starts from the account
   conflict. Three of three now succeed.
3. **Google's button rendered in Dutch on an English page.** `renderButton({locale})` is ignored by
   the current Google library — the parameter never reached the button iframe. The language must be
   set on the script URL (`gsi/client?hl=`), so changing language now reloads Google's script. Found
   by looking at a screenshot.

A fourth, smaller one: two of my own tests were self-deceiving — a defaulted parameter swallowed the
`undefined` the test meant to pass, so the "missing credential" and "nameless greeting" cases were
silently testing the ordinary path. Both were rewritten.

---

## 16. Tests

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && pnpm run test` | **315 pass / 0 fail** (59 suites) — was 210 |
| Frontend | `cd frontend && pnpm run test` | **305 pass / 0 fail** (15 files) — was 167 |

**Zero new dependencies.** **No test contacts Google**: verification is injected through
`setGoogleCredentialVerifier`, and the browser library is replaced by a double.

**Backend, new (105).** Missing configuration · invalid credential · verifier failure · invalid
audience (single and array) · invalid issuer · expired · missing expiry · missing subject ·
unverified email · missing email · claim reduction to exactly four fields · credential absent from
the result · malformed-token rejection before any adapter call · stable code set · conflicting and
unknown accounts indistinguishable · first sign-in creates exactly one Student · Student role
assigned · Admin role never assigned · identity created · verified email and names stored ·
username server-generated, not the email, unpredictable · password long, random, never returned ·
returning sign-in reuses · no duplicate account or identity · role withdrawal refuses · missing
account refuses · Admin never converted · email conflict not merged · identity cannot move between
Students · legacy roles grant nothing · no half-provisioned account left behind · concurrent
identity race · concurrent email race · winner ineligible still refused · session issuance delegated
· failing issuer sanitised · synchronous failure sanitised · registered function surface ·
rate limiting · one accepted field · no identity-exposing function · no Student password flow · no
future function · `AppSettings` absent · DTO allow-list and forbidden keys · internal username never
leaked · display-name rules · logging allow-list · subject dropped · raw Parse object dropped ·
identity schema shape and both unique indexes · plus the updated repository-integrity guard.

**Frontend, new (138).** Google library states (loading, ready, unavailable, unconfigured) and their
copy · locale passed to both `initialize` and `renderButton` · script reloaded on a language change,
not reloaded otherwise · credential forwarded, empty response ignored, never stored · no auto-select
· sign-in posts the credential in the body, never in a URL · session established · redirect to
`/student/welcome` · missing token treated as failure · duplicate submission prevented · busy state
· dismissal ignored while authenticating · seven failure states, each translated · no raw backend or
provider string · assertive announcement · no session on failure · cancellation · stale error
cleared · restoration for both roles · rejected session cleared · role withdrawal reflected ·
one request for concurrent restorations · expired Student → Student sign-in, expired Admin → Admin
sign-in · session token attached to ordinary calls but not to sign-in calls · explicit session
states · display-name rules · every guard for every role · no open redirect · no redirect loop ·
welcome page content, no fake data, no dead links, no HTTP on load, logout behaviour, duplicate
logout prevented · Arabic throughout · layout safety · error-key mapping and translation coverage.

---

## 17. Build and validation results

```
root      pnpm install --frozen-lockfile                      exit 0
backend   pnpm install --frozen-lockfile                      exit 0
backend   pnpm run compile                                    exit 0
backend   pnpm run test                    315 pass / 0 fail  exit 0
frontend  pnpm install --frozen-lockfile --shamefully-hoist   exit 0
frontend  pnpm run build                   676.47 kB initial  exit 0
frontend  pnpm run test                    305 pass / 0 fail  exit 0
```

---

## 18. Runtime validation

Against an **isolated `mongod` on port 27018** with a scratch dbpath. `backend/.env` was never
modified; overrides were applied in-process.

The full server (`build/src/app.js`) was booted and **only Google's token verification** was replaced
through the module's own seam. Everything else was genuine: Express, CORS, `restrictRoutes`,
`validateEntityRoutes`, the cloud function, provisioning, the unique indexes, `/loginAs`, and the DTO
over the wire.

| # | Check | Result |
|---|---|---|
| 1 | Backend starts | `Server listening {"port":1341}` |
| 2 | Frontend starts | `GET http://localhost:4201/` → 200 |
| 3 | Admin login still works | 200, `roles:["Admin"]`, token issued |
| 4 | Student auth page loads | renders at 1440 EN / 1440 AR / 390 EN, zero overflow, one `h1`, no inputs |
| 5 | Missing Google configuration | `GOOGLE_NOT_CONFIGURED`; Admin login unaffected |
| 6 | First verified sign-in | 1 `_User`, 1 identity, `roles:["Student"]`, real `r:` token |
| 7 | Returning sign-in | same account; no new `_User`, no new identity |
| 8 | Session restoration | `{displayName, id, roles}` — no token, no username |
| 9 | Student welcome route protected | Visitor → `/auth/student` (guard tests) |
| 10 | Student cannot enter Admin routes | → `/student/welcome` |
| 11 | Admin cannot enter Student routes | → `/dashboard` |
| 12 | Logout invalidates | `{"success":true}` |
| 13 | Old token cannot be reused | `209 Invalid session token` |
| 14 | No credential in logs | 0 occurrences; token `[REDACTED]`, params `[OMITTED]` |
| 15 | `File` / `IMG` private | `/classes/File` → 403, `/classes/IMG` → 403, raw files → 403 |
| 16 | `AppSettings` absent | route 403, collection absent, no registered function |
| 17 | CORS restricted | allowed origin echoed; foreign origin not echoed; **no wildcard** |
| 18 | No future navigation or fake data | Student area is one page; asserted by test |

Additionally observed: a **forged, unsigned token was rejected by the real verifier over HTTP**
(`INVALID_CREDENTIAL`), so signature checking is genuinely enforced; three concurrent sign-ins
produced one account and one identity; an Admin-email conflict created nothing; withdrawing the
Student role emptied the roles and refused the next sign-in; `/classes/StudentAuthIdentity` returned
403 even with a master-key header; and both unique indexes rejected duplicate inserts with `11000`.

---

## 19. Real Google browser result

**A real end-to-end Google sign-in was NOT performed, and nothing above claims one.** It needs a
human to choose a Google account and consent, plus `GOOGLE_CLIENT_ID` set in `backend/.env` — a file
this checkpoint must not modify.

**What was confirmed in a real browser** (headless Chrome 150, `document.fonts.ready` awaited): with
the configured Client ID, Google Identity Services **loads and renders its own button** at 1440 EN,
1440 AR, and 390 EN — zero horizontal overflow, exactly one `h1`, no input elements, and **no
console errors**. Arabic renders the button as "المواصلة باستخدام Google" and mirrors correctly in
RTL. That is what surfaced the Dutch-button defect in §15.

---

## 20. Manual setup and validation remaining

1. **Set `GOOGLE_CLIENT_ID` in `backend/.env`** to match the browser's `googleClientId`.
2. **Add the deployment origins** to the Google client's *Authorised JavaScript origins*.
3. **Perform one real Google sign-in** end to end: click the button, choose an account, land on
   `/student/welcome`, refresh, and log out.
4. ~~Decide on `LOG_LEVEL=warn`~~ — **no longer needed**; S-19 is closed at every log level (§26).
5. **Decide the `getCurrentUser` / `getSession` overlap** (§12).
6. Confirm the welcome page in **light mode** — it has only been reviewed in the default dark theme.

---

## 21. Warnings

| Warning | Assessment |
|---|---|
| Frontend initial bundle **676.47 kB** against a 500 kB budget | Pre-existing; +2.10 kB from this checkpoint. |
| Google's script is a third-party runtime dependency on `accounts.google.com` | Inherent to the official flow. It is fetched **only** when the Student page asks for it, and a blocked script degrades to an explained, disabled control. |
| Switching language on the Student page refetches Google's script | Required: the button's language is fixed when the script loads (§15.3). |
| Hash routing still active | OQ-12 still open, still due before Checkpoint 6. |
| `favicon.ico` still missing | Pre-existing. |
| 13 Parse Server deprecation warnings at boot | Pre-existing; all future-default changes. |

---

## 22. Remaining gaps

- **No real Google sign-in has been performed** (§19).
- ~~**S-19**~~ — **closed** in the closeout (§26).
- **Two restoration endpoints** until the protected-path question is settled (§12).
- No Complete Profile, `StudentProfile`, Apple sign-in, invitation, enrollment, account-linking UI,
  or multi-provider linking — all out of scope and none stubbed.
- The Student welcome page is intentionally minimal and carries no product data.
- `authData` is never populated, so a future migration to Parse's native auth flow would need to
  backfill it — deliberate: Parse persists the raw `id_token` in `authData`, which this checkpoint
  forbids storing.

---

## 23. Files

### Added (23)

**Backend (8)** — `src/cloudCode/models/StudentAuthIdentity.ts` ·
`src/cloudCode/modules/StudentAuth/{errors,googleConfig,googleVerifier,provisioning,dto,logging,functions}.ts`

**Backend tests (3)** — `test/googleVerification.test.ts` · `test/studentProvisioning.test.ts` ·
`test/studentAuthSurface.test.ts`

**Frontend (7)** — `src/app/services/google-identity.service.ts` ·
`src/app/services/dataService/student-auth-service.ts` · `src/app/utils/google-auth-error.ts` ·
`src/app/guards/student.guard.ts` · `src/app/guards/home-route.ts` ·
`src/app/pages/student/student-welcome.component.{ts,html,scss}`

**Frontend tests (4)** — `src/app/services/google-identity.service.spec.ts` ·
`src/app/services/dataService/student-auth-service.spec.ts` ·
`src/app/utils/google-auth-error.spec.ts` ·
`src/app/pages/student/student-welcome.component.spec.ts`

### Modified (31)

**Backend (3)** — `src/app.ts` (Google configuration status at boot) · `test/schemaAccess.test.ts` ·
`test/templatePreservation.test.ts`

**Frontend source (15)** — `src/app/app.config.ts` · `src/app/app.routes.ts` ·
`src/app/guards/{auth,guest}.guard.ts` · `src/app/models/User.ts` ·
`src/app/services/session.service.ts` · `src/app/services/http.interceptor.ts` ·
`src/app/components/layout/shell.component.ts` ·
`src/app/pages/auth/student-auth.component.{ts,html,scss}` ·
`src/environments/environment{,.prod}.ts` · `public/i18n/{en,ar}.json`

**Frontend tests (7)** — `app.branding.spec.ts` · `auth-routing.spec.ts` ·
`security.credentials.spec.ts` · `session.service.spec.ts` · `guards/role.guard.spec.ts` ·
`services/dataService/user-service.spec.ts` · `pages/auth/student-auth.component.spec.ts`

**Docs (6)** — `PROJECT.md` · `README.md` · `docs/TEMPLATE_ARCHITECTURE.md` ·
`docs/CURRENT_STATE.md` · `docs/IMPLEMENTATION_PLAN.md` · `docs/HANDOFF.md`

### Deleted (0)

**Nothing was deleted.**

**Deliberately untouched:** `backend/.env` · `backend/dashboard.json` · `docs/prototypes/*` ·
`docs/PRODUCT_REQUIREMENTS.md` · `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` ·
`.claude/**` · all three lockfiles · `backend/package.json`, `frontend/package.json` and every
dependency in them · `node_modules` · `backend/src/cloudCode/utils/**` ·
`backend/src/cloudCode/database/**` · `backend/src/cloudCode/modules/User/**` ·
`models/{User,File,IMG}.ts`.

---

## 24. Git verification

```
$ git diff --check                exit 0 (LF→CRLF notices only)
$ git status --short              31 modified, 23 untracked, 0 staged, 0 deleted
$ git diff --cached --name-only   (empty — nothing staged)
$ git ls-files backend/.env backend/dashboard.json
                                  (empty — neither is tracked)
$ git check-ignore -v backend/.env
backend/.gitignore:6:.env	backend/.env
$ git check-ignore -v backend/dashboard.json
backend/.gitignore:4:dashboard.json	backend/dashboard.json
```

| Confirmation | Result |
|---|---|
| Nothing staged, nothing committed, nothing pushed | ✅ `HEAD` is still `9ec03df` |
| No branch created, switched, merged, or deleted | ✅ still on `master` |
| `.env` / `dashboard.json` unmodified and still ignored | ✅ |
| No secret exposed or tracked | ✅ no client secret exists; runtime credentials passed via environment variables only |
| Prototypes unchanged | ✅ absent from `git status` |
| Protected instruction files unchanged | ✅ `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `.claude/**` |
| Protected source paths unchanged | ✅ `utils/`, `database/`, `modules/User/`, `models/{User,File,IMG}.ts` |
| No preserved template capability removed | ✅ guarded by `templatePreservation.test.ts` |
| No dependency added or removed | ✅ all lockfiles and manifests unmodified |
| No future product feature | ✅ no profile, batch, invitation, enrollment, resource, task, or reel |
| No task-created process remains | ✅ |

---

## 25. Recommended next action

1. **Complete one real Google sign-in** (§20) — the only thing between this checkpoint and a
   demonstrable Student flow.
2. **Commit** Checkpoint 2B.
3. **Decide S-19 and the `getSession` overlap** (§14, §12) — both are owner calls.
4. **Start Checkpoint 4** (Complete Profile and Student dashboard). It needs OQ-2 and OQ-3 answered,
   and the welcome page is the natural place its entry point will go.

---

## 26. Closeout — Google privacy, authorized origins, and popup communication

Applied after the implementation pass, in response to three browser errors: a Google 403, a
`GSI_LOGGER` origin rejection, and a Cross-Origin-Opener-Policy warning.

| # | Item | Outcome |
|---|---|---|
| 1 | **S-19 — Google subject in logs** | **Closed at every log level.** No `LOG_LEVEL` dependency. |
| 2 | **Cross-Origin-Opener-Policy** | `same-origin-allow-popups` now sent by the dev server; the postMessage warning is **gone**. |
| 3 | **Authorized JavaScript origin** | Diagnosed and documented. **Owner action — still pending.** |
| 4 | Existing Checkpoint 2B behaviour | Unchanged; re-verified end to end. |

### 26.1 S-19 — root cause and fix

**Root cause.** Parse Server logs each trigger's `Input`/`Result` as a message string at `info`.
Saving a `StudentAuthIdentity` therefore wrote `providerSubject` — the Google subject, a stable
identifier for a real person — into the line. This repository's own authentication logging never
emitted it; the leak was in Parse's generic trigger logging, which the redaction layer scrubs by key
name.

**Fix — the smallest possible change**, in `backend/src/cloudCode/utils/logging/redact.ts`
(modification of this protected file was explicitly authorised for this task, and it is the **only**
protected file touched):

- added to the substring rules: `subject` — which covers `subject`, `providerSubject`,
  `googleSubject`, and `oauthSubject` in one rule — plus `claims`, `authorizationcode`, and
  `authentication`;
- added a new **whole-word** rule list containing `sub`. `sub` is too short to be a substring rule:
  it would also swallow `submission`, `subtotal`, and `subscription`. Exact matching keeps it
  precise.

Everything already covered stays covered: `credential`, `idtoken`, `accesstoken`, `refreshtoken`,
`authdata`, `password`, `sessiontoken`, `email`, `masterkey`, `clientsecret`, database URIs. The
change is additive; no existing rule was altered or removed.

Because the rules live in `isSensitiveKey`, they apply through **every** path automatically:
`redact()` (nested objects, arrays, `Map`, `Set`, `Error` metadata, Parse-like objects),
`redactMeta()` (log field bags), and `redactMessage()` (Parse's embedded JSON) — and therefore
through the Parse `loggerAdapter` as well.

**`id` and `objectId` are untouched.** No rule matches them, which matters: they are what make a log
line diagnosable.

**32 focused tests** cover it: every OAuth key name recognised · direct and nested subjects · a claim
bag containing `sub` · a bare `sub` · arrays · `Map` · `Set` · `Error` metadata · a Parse-like object
· every token kind · `id` / `objectId` / `userId` / stable codes surviving · `submission` /
`subtotal` / `subscription` surviving · every pre-existing rule still holding · the exact Parse
trigger line · the sign-in call log · a provisioning-failure log.

**Runtime, at the default `info` level with `LOG_LEVEL` unset:** the trigger line now reads
`providerSubject":"[REDACTED]"` while `objectId` survives, and a scan of the whole log found **0**
occurrences of the subject, the credential, the verified email, the internal username, and any bare
session token.

### 26.2 Cross-Origin-Opener-Policy

**Observed origin:** `http://localhost:4200` — the Angular dev server's default, and the origin the
browser actually reports.

**Before:** the document carried no COOP header, and Chrome reported *"Cross-Origin-Opener-Policy
policy would block the window.postMessage call"* when Google's popup tried to reach its opener.

**After:** `frontend/angular.json` → `serve.options.headers` sets

```
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

That is the supported Angular option (`@angular/build:dev-server`), so **no `node_modules` patch and
no custom server**. Verified live on `http://localhost:4200`: the header is present, appears
**exactly once**, no `Cross-Origin-Embedder-Policy` is set, and **0 postMessage/opener warnings**
remain.

> A dev server started **before** this change keeps the old behaviour — the option is read at
> startup. Restart `ng serve` to pick it up.

**Production hosting is outside this repository.** Whatever serves the built frontend must send the
same header; nginx, Apache, and static-host equivalents are documented in
[TEMPLATE_ARCHITECTURE.md §16d](TEMPLATE_ARCHITECTURE.md).

**Backend CORS was not touched** — there was no evidence implicating it, and COOP governs the
document, not the API. Re-verified: allow-listed origin echoed, foreign origin not echoed, no
wildcard.

### 26.3 Authorized JavaScript origin — still pending

`accounts.google.com/gsi/button` returns **403** for `http://localhost:4200`, which is exactly the
`GSI_LOGGER` origin rejection. The origin is not registered on the OAuth client.

**Owner action, which the repository cannot perform:**

> Google Cloud Console → **APIs & Services** → **Credentials** → select the Code Your Future
> **OAuth 2.0 Web client** → **Authorized JavaScript origins** → **Add URI** →
> `http://localhost:4200` → Save.

Scheme + host + port only — no path, no hash, no query, no wildcard. Add `http://127.0.0.1:4200`
only if the app is genuinely opened on that hostname.

**Behaviour while unauthorised, confirmed in a real browser:** the button renders, no credential is
ever issued, **no session and no cached user are created**, no navigation happens, and no raw GSI or
403 text is rendered. Five focused tests lock that in.

The backend and frontend Client IDs were confirmed identical by comparing SHA-256 fingerprints —
**neither value was printed** — and the frontend carries no client secret.

### 26.4 Final Google classification

**Repository fixed; the Google Cloud origin change remains pending.** The COOP and privacy defects
were repository-side and are closed. The 403 is a Google Cloud console setting, and **no real Google
sign-in has been performed** — it needs the origin added and a human to choose an account.

### 26.5 Closeout validation

```
backend   pnpm run compile                                    exit 0
backend   pnpm run test                    347 pass / 0 fail  exit 0
frontend  pnpm run build                   676.47 kB initial  exit 0
frontend  pnpm run test                    310 pass / 0 fail  exit 0
```

Runtime, re-run in full: first sign-in, returning sign-in, three concurrent sign-ins (3 successes,
1 account, 1 identity), Admin-email conflict refused, forged credential refused, logout, token reuse
refused, role withdrawal, Admin login working, CORS restricted, every deny-by-default route still
403.

**Files changed in the closeout (5):** `backend/src/cloudCode/utils/logging/redact.ts` ·
`backend/test/redaction.test.ts` · `backend/test/browserHeaders.test.ts` *(new)* ·
`frontend/angular.json` · `frontend/src/app/pages/auth/student-auth.component.spec.ts` — plus the
four documents listed in §26.6.

Nothing else was altered: the verification flow, `StudentAuthIdentity`, provisioning, concurrency
handling, session creation, routes, guards, Admin authentication, UI structure, safe DTOs, and every
existing translation are exactly as they were. The `getCurrentUser` / `getSession` overlap remains
**deliberately deferred**.

### 26.6 Documentation updated in the closeout

`docs/CURRENT_STATE.md` (S-19 moved to closed; COOP, postMessage, and origin rows added) ·
`docs/TEMPLATE_ARCHITECTURE.md` (§16d — headers, the origin owner action, Client ID expectations) ·
`docs/HANDOFF.md` (this section) · `README.md` (origin action, COOP, and the removal of the
now-unnecessary `LOG_LEVEL=warn` advice).
