# Code Your Future

## Overview

Batch-based training platform. Parse Server 9.x backend + Angular 21 frontend.

Authoritative product behaviour lives in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).
This file describes **what is implemented right now** — the secure product
foundation from Checkpoint 1 plus the UI/UX design system and authentication
experience from Checkpoint 2A.

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
_User ──(membership)── _Role {Admin, Student}
File, IMG  — standalone private infrastructure, no product owner yet
```

---

## API surface

Three cloud functions. Nothing else is reachable.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/users/loginUser` | POST | none (rate limited 10/min) | Admin password login. Returns a safe DTO **plus** the session token. Refuses any account without the Admin role. |
| `/api/users/getCurrentUser` | GET | session | Session restoration. Safe DTO, **no** session token, no email, no phone. |
| `/api/users/logout` | POST | session | Invalidates the caller's own session. Idempotent. |

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

### Student sign-in (`/auth/student`) — presentation only
- Student heading, value proposition, and a **disabled** Google button.
- The approved invitation copy, verbatim in both languages.
- Privacy note and a link to Admin sign-in.
- **No email, username, password, signup, reset, or invitation-token field.**
- Google OAuth is **not implemented** — the button has no click handler, issues no
  request, and creates no session. It is enabled in Checkpoint 3.

### `/auth`
- Redirects to `/auth/admin`. Any unknown `/auth/**` sub-route resolves there too.

### Dashboard (`/dashboard`)
- Landing page after login. Placeholder pending the Admin workspace.

### Sidebar Navigation

| Item | Route | Icon | Roles |
|---|---|---|---|
| Dashboard | `/dashboard` | `fa-solid fa-gauge` | any authenticated user |

No other navigation exists. Students, Batches, Resources, Live Slides, Tasks, Pinned Students,
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
| Backend | `cd backend && pnpm run test` (`node:test`) | 210 |
| Frontend | `cd frontend && pnpm run test` (Vitest) | 167 |

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

## Last Updated

Checkpoint 2A — UI/UX design system and authentication experience: semantic design
tokens, typography with language-aware stacks, layout and UI primitives, a
redesigned Admin auth page with translated error states, a **presentation-only**
Student auth page (Google OAuth not implemented), `/auth/admin` + `/auth/student`
routing with a guest guard, an accessibility baseline, and 82 new frontend tests.
All existing template capabilities were preserved.

Preceded by Checkpoint 1 — product foundation and access boundaries: `AppSettings`
removed, `Admin`/`Student` roles established, user management retired,
deny-by-default CLP/ACL, private `File`/`IMG`, master-key boundaries, log
redaction, safe DTOs, branding, and the EN/AR initialisation fix.
