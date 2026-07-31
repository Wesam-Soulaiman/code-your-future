# Code Your Future

## Overview

Batch-based training platform. Parse Server 9.x backend + Angular 21 frontend.

Authoritative product behaviour lives in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).
This file describes **what is implemented right now** — the secure product
foundation from Checkpoint 1, the UI/UX design system from Checkpoint 2A, and
Student Google authentication from Checkpoint 2B.

---

## Roles

| Role | Description |
|---|---|
| Admin | Staff. Password login. The only role with any write capability today. |
| Student | Learner. Seeded as a role; **no Student can authenticate yet** — Google OAuth arrives in Checkpoint 3. |
| Visitor | Unauthenticated caller. Not a stored Parse Role — simply the absence of a session. |

The legacy template roles `SuperAdmin` and `Employee` were retired in
Checkpoint 1. They authorise nothing: the backend matches live `_Role` membership
against `Admin`/`Student` only, and the frontend strips unrecognised names out of
cached session state.

---

## Entities

### `_User`

Identity only. Direct client access is **denied** — every class-level operation
(`find`, `get`, `count`, `create`, `update`, `delete`) grants nobody, so a client
cannot create, enumerate, read, or modify a user. All access goes through a cloud
function that resolves the caller from its session and returns a hand-built DTO.

| Field | Description | Required |
|---|---|---|
| username | Login identifier (Admin accounts) | Yes |
| email | Account email — never returned in a DTO | No |
| firstName | Given name | No |
| lastName | Family name | No |
| phoneNumber | Contact number — never returned in a DTO | No |

`protectedFields` additionally strips `email`, `username`, `emailVerified`,
`authData`, and `phoneNumber` for non-master callers.

### `StudentAuthIdentity`

Links an external identity-provider account to a Student — the minimum needed to
recognise a returning learner. All operations denied, empty default ACL, every
column in `protectedFields`, and a `beforeSave` that refuses non-server writes
and freezes the columns after creation. No API returns one.

| Field | Description | Required |
|---|---|---|
| provider | Identity provider name (`google`) | Yes |
| providerSubject | The provider's stable subject id — never returned | Yes |
| user | Pointer to the Student `_User` | Yes |

Two unique compound indexes: `(provider, providerSubject)` so one Google account
maps to exactly one Student, and `(provider, user)` so a Student can never hold a
duplicate. **No credential, token, email, name, or other claim is stored.**

### `File`

Private file infrastructure. All operations denied, default object ACL empty, the
storage handle hidden by `protectedFields`, and a `beforeSave` trigger that
rejects a client-supplied ACL. No record is created by a client today.

### `IMG`

Private image infrastructure with the WebP / thumbnail / blurhash pipeline intact.
Same deny-by-default posture and ACL rejection as `File`.

> `AppSettings` was removed in Checkpoint 1 (resolved decision OQ-13): it had no
> consumer, no product requirement, and it widened the API surface. A generic
> key-value settings store is now a **prohibited pattern** — future configuration
> needs use narrowly scoped, typed, sanitised endpoints.

**Not implemented yet:** `StudentProfile`, `Batch`, `BatchInvitation`,
`Enrollment`, `Resource`, `LiveSlidesSession`, `Task`, `Submission`,
`PinnedStudent`, Talent Reels.

---

## Entity Relationships

```
_User ──(membership)────── _Role {Admin, Student}
      └──(1:1 per provider) StudentAuthIdentity {google}
File, IMG  — standalone private infrastructure, no product owner yet
```

---

## API surface

Five cloud functions. Nothing else is reachable.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/users/loginUser` | POST | none (rate limited 10/min) | Admin password login. Returns a safe DTO **plus** the session token. Refuses any account without the Admin role. |
| `/api/users/getCurrentUser` | GET | session | Session restoration. Safe DTO, **no** session token, no email, no phone. |
| `/api/users/logout` | POST | session | Invalidates the caller's own session. Idempotent. Used by both roles. |
| `/api/student-auth/loginWithGoogle` | POST | none (rate limited 10/min) | Verifies a Google credential, provisions or reuses the Student, and returns a safe DTO **plus** the session token. |
| `/api/student-auth/getSession` | GET | session | Session restoration for **either** role. `{id, roles, displayName?}` — no session token, **no username**, no email. |

Blocked for every client: `/classes/*`, `/schemas`, `/batch`, Parse's
`POST /users` signup, `requestPasswordReset`, and the raw `/files/*` endpoints —
all return 403 (or 404 where the route does not resolve).

---

## Pages & Navigation

### Admin sign-in (`/auth/admin`)
- Username + password, on the Code Your Future design system.
- Accessible password visibility toggle.
- Translated inline states: invalid credentials, account not permitted to use a password,
  rate limited, backend unavailable, unexpected. **No raw backend error is ever shown.**
- Duplicate-submit prevention and Enter-key submission.
- Language switch and a link to Student sign-in.

### Student sign-in (`/auth/student`)
- Google's own sign-in button, rendered in the page's language.
- Translated states: loading, ready, signing in, cancelled, invalid credential,
  unverified Google email, account not eligible, rate limited, backend
  unavailable, and sign-in not configured on this server.
- The approved invitation copy, verbatim in both languages.
- Privacy note and a link to Admin sign-in.
- **No email, username, password, signup, reset, or invitation-token field**, and
  no Apple button.
- A first verified sign-in creates the Student automatically. **No invitation is
  required to sign in.**

### Student welcome (`/student/welcome`) — Students only
- Branding, a greeting using the verified Google name when Google supplies one,
  and confirmation that the account is ready.
- States that completing the profile is the next step and that it is not
  available yet.
- Language switch and logout.
- **No profile form, completion percentage, batch, invitation, task, statistic,
  chart, or link to anything that does not exist.**

### `/auth`
- Redirects to `/auth/admin`. Any unknown `/auth/**` sub-route resolves there too.

### Dashboard (`/dashboard`)
- Landing page after login. Placeholder pending the Admin workspace.

### Sidebar Navigation (Admin shell only)

| Item | Route | Icon | Roles |
|---|---|---|---|
| Dashboard | `/dashboard` | `fa-solid fa-gauge` | Admin |

The Student area has no navigation at all — one page, a language switch, and
logout. No other navigation exists anywhere. Students, Batches, Resources, Live Slides, Tasks, Pinned Students,
Talent Reels, and user management are **not** present.

The template's `/users` management screen was removed in Checkpoint 1: Code Your
Future has no manual user-administration requirement.

---

## Features

### Authentication
- Admin username/password login via a cloud function that verifies the Admin role
  **after** authentication and revokes the session if the account is not an Admin.
- Session token in `localStorage`; restored on reload through the safe DTO.
- Logout destroys the server-side session and clears local state even if the
  server call fails.
- No Student password login, signup, reset, or change exists anywhere.
- **Student Google sign-in**: the credential is verified server-side (signature,
  audience, issuer, expiry, subject, and a Google-verified email) before anything
  is created. It is never stored, logged, returned, or placed in a URL.
- A Student's Parse username and password are generated server-side from a
  CSPRNG, never leave the server, and cannot be used — password login refuses any
  non-Admin.
- An Admin account is never converted to a Student, and a Google identity cannot
  move between Students.
- Simultaneous first sign-ins are resolved by unique database indexes, so exactly
  one Student and one identity result.
- Removing the Student role blocks the next sign-in and empties the roles on the
  next session restoration.

### Access boundaries
- Deny-by-default CLP on every class.
- A repository-owned schema guard aborts startup if a class omits explicit access
  metadata, and rewrites any public wildcard ACL to deny-by-default.
- Client-supplied `role`, `roles`, `ACL`, `CLP`, `sessionToken`, `authData`,
  `masterKey`, `protectedFields`, `owner`, `userId`, and `studentId` are rejected.
- Authorization always reads live `_Role` membership — never a client-sent value.

### Master key boundaries
- Usable from `127.0.0.1` / `::1` only (configurable via `MASTER_KEY_IPS`).
- Read-only master key restricted to localhost as well.
- Reserved for role seeding, Admin provisioning, and startup schema/index work.

### Safe logging
- One redaction boundary covers this repository's logs **and** Parse Server's own
  logs via the supported `loggerAdapter` option.
- Recursive over nested objects, arrays, `Map`/`Set`, and errors carrying request
  data; masks by key name regardless of casing; summarises Parse objects and
  buffers instead of printing them.

### Design system
- Semantic design tokens (colour, surface, text, border, focus, status, spacing, radius, shadow,
  layout widths, control and touch sizes, motion) layered on the existing PrimeNG theme.
- A typography hierarchy with a system UI stack for English and self-hosted Cairo for Arabic.
- Layout and UI primitives built with CSS logical properties, so one stylesheet serves LTR and RTL.
- Accessibility baseline: landmarks, one `h1` per page, real labels, visible focus, 44px targets,
  status never by colour alone, reduced-motion support.

### Multi-Language
- English and Arabic with exact key parity, verified by a test.
- Language, `dir`, and `lang` initialise during bootstrap — before routing — so
  `/auth` renders correctly in both directions on a cold load.

### Theming
- Light and dark mode, persisted to `localStorage`, initialised at bootstrap.

### Data Table (Reusable)
Retained shared component: lazy loading, server-side pagination, debounced search,
table/grid views, column visibility, preview panel, Excel export, skeletons.
Currently unused — no list page exists.

---

## Tests

| Suite | Command | Count |
|---|---|---|
| Backend | `cd backend && pnpm run test` (`node:test`) | 315 |
| Frontend | `cd frontend && pnpm run test` (Vitest) | 305 |

No new dependency was added for either suite.

---

## Known Limitations

- Initial frontend bundle exceeds its 500 kB budget (pre-existing).
- Port `1337` default is now overridable via `PORT`, but `serverURL` must be kept
  consistent manually.
- `withHashLocation()` is still active, so deep links are `/#/path`. Decide before
  invitation links are built (OQ-12).
- CI is `.gitlab-ci.yml` targeting branch `dev` while the remote is GitHub/`master`
  (OQ-14).
- Controlled private-file read access is designed but not implemented; the
  extension points are documented on `File`/`IMG` (OQ-10).

---

## Required configuration

| Variable | Where | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `backend/.env` | Google **Web application** Client ID. Student sign-in refuses without it; Admin login is unaffected. |
| `googleClientId` | `frontend/src/environments/environment*.ts` | The same public Client ID for the browser. |

There is **no Google client secret** anywhere: this flow returns a signed ID
token directly and never exchanges an authorization code.

## Last Updated

Checkpoint 2B — Student Google authentication: `StudentAuthIdentity` with two
unique compound indexes, server-side credential verification through Parse
Server's bundled Google adapter plus a verified-email rule, idempotent and
concurrency-safe provisioning, real Parse sessions issued through `/loginAs`
(so a Student holds no usable password), a role-agnostic session-restoration
endpoint that carries no username, `/student/welcome` behind a Student guard,
role-aware guards throughout, and 161 new tests.

Preceded by Checkpoint 2A — UI/UX design system and authentication experience: semantic design
tokens, typography with language-aware stacks, layout and UI primitives, a
redesigned Admin auth page with translated error states, a **presentation-only**
Student auth page (Google OAuth not implemented), `/auth/admin` + `/auth/student`
routing with a guest guard, an accessibility baseline, and 82 new frontend tests.
All existing template capabilities were preserved.

Preceded by Checkpoint 1 — product foundation and access boundaries: `AppSettings`
removed, `Admin`/`Student` roles established, user management retired,
deny-by-default CLP/ACL, private `File`/`IMG`, master-key boundaries, log
redaction, safe DTOs, branding, and the EN/AR initialisation fix.
