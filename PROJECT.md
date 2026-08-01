# Code Your Future

## Overview

Batch-based training platform. Parse Server 9.x backend + Angular 21 frontend.

Authoritative product behaviour lives in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).
This file describes **what is implemented right now** — the secure product
foundation from Checkpoint 1, the UI/UX design system from Checkpoint 2A,
Student Google authentication from Checkpoint 2B, and the Student profile from
Checkpoint 3A.

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

### `StudentProfile`

Exactly one per Student, enforced by a unique index on the user pointer. All
operations denied, empty default ACL, a per-record ACL granting read to the
owning Student only, every personal column in `protectedFields`, and a
`beforeSave` that refuses client writes and freezes the owner.

| Field | Description | Required |
|---|---|---|
| user | The owning Student. Immutable after creation | Yes |
| fullName | Full name, as the Student writes it | Yes |
| verifiedEmail | From the Google identity. Read-only to the Student | Yes |
| phone | Contact number, as entered | Yes |
| city | A CITY catalog item | Yes |
| dateOfBirth | Optional | No |
| institution | An INSTITUTION catalog item | Yes |
| customInstitutionName | Required when the `Other` item is chosen | Conditional |
| major | A MAJOR catalog item | Yes |
| educationStatus | `Current Student` or `Graduate` | Yes |
| expectedGraduationDate | First of the selected month, UTC. Required for a Current Student | Conditional |
| careerGoal | Optional, up to 500 characters | No |
| targetRole | A TARGET_ROLE catalog item. **Never affects completion** | No |
| targetRoleReason | "Why did you choose this role?", up to 500 characters. Cleared with the role | No |
| githubUrl / linkedinUrl / portfolioUrl | Optional | No |
| photoData / photoUpdatedAt | Private photo, stored inline. Never a public URL | No |
| isComplete | **Calculated server-side** | — |

The four catalog fields are **pointers**, not names: a request carries an id and
the backend resolves the authoritative item, so nothing a client invents can be
stored and renaming a city corrects every profile at once.

Exactly one education record. **No CV, salary, work experience, skill ratings,
work preferences, employment status, biography, country of residence, or
timezone** — and none is possible: the writable field list is closed and tested.

### `ProfileCatalogItem`

The closed vocabulary behind those four selections. **Not** a settings store: the
category is restricted to exactly `CITY`, `INSTITUTION`, `MAJOR`, `TARGET_ROLE`,
cannot change after creation, and there is no key/value column of any kind.

| Field | Description | Required |
|---|---|---|
| type | One of the four categories. Immutable | Yes |
| code | Normalised, unique within its category | Yes |
| nameEn / nameAr | Both names. A half-bilingual list shows the wrong language | Yes |
| active | Inactive stays on existing profiles; never offered to anybody new | — |
| sortOrder | Display order within the category | — |
| institutionKind | University / Institute / Other. Institutions only | Conditional |
| isOther | The escape hatch demanding a typed name. Institutions only | No |

An Admin manages it; a Student receives **active items only**; a Visitor has no
access. An item any profile references **cannot be deleted** — it is deactivated
instead, so nobody's stored answer is silently blanked.

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

**Not implemented yet:** `Batch`, `BatchInvitation`,
`Enrollment`, `Resource`, `LiveSlidesSession`, `Task`, `Submission`,
`PinnedStudent`, Talent Reels.

---

## Entity Relationships

```
_User ──(membership)────── _Role {Admin, Student}
      ├──(1:1 per provider) StudentAuthIdentity {google}
      └──(1:1)────────────── StudentProfile
                                  │
                                  └──(4 × N:1) ProfileCatalogItem
                                       {CITY, INSTITUTION, MAJOR, TARGET_ROLE}
File, IMG  — standalone private infrastructure, no product owner yet
```

---

## API surface

Fourteen cloud functions and one authenticated binary route. Nothing else is
reachable.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/users/loginUser` | POST | none (rate limited 10/min) | Admin password login. Returns a safe DTO **plus** the session token. Refuses any account without the Admin role. |
| `/api/users/getCurrentUser` | GET | session | Session restoration. Safe DTO, **no** session token, no email, no phone. |
| `/api/users/logout` | POST | session | Invalidates the caller's own session. Idempotent. Used by both roles. |
| `/api/student-auth/loginWithGoogle` | POST | none (rate limited 10/min) | Verifies a Google credential, provisions or reuses the Student, and returns a safe DTO **plus** the session token. |
| `/api/student-auth/getSession` | GET | session | Session restoration for **either** role. `{id, roles, displayName?, profileComplete?}` — no session token, **no username**, no email, and never the profile itself. |
| `/api/student-profile/getMyStudentProfile` | GET | Student session | The caller's own profile, or the empty shape carrying their verified email. |
| `/api/student-profile/saveMyStudentProfile` | POST | Student session | Validate and store. The verified email and completion state are derived server-side. |
| `/api/student-profile/removeMyProfilePhoto` | POST | Student session | Remove the photo. |
| `/api/profile-photo` | POST | Student session (10/min) | **Not a cloud function.** Multipart upload; validate, re-encode to WebP, store privately. |
| `/api/profile-photo` | GET | Student session | The owner's photo bytes. `private, no-store`. **No URL exists.** |
| `/api/student-catalog/getProfileCatalog` | GET | Student session | The **active** items for the four approved categories. |
| `/api/profile-catalogs/listProfileCatalogItems` | GET | Admin session | Every item in one category, active or not. |
| `/api/profile-catalogs/createProfileCatalogItem` | POST | Admin session | Add one. |
| `/api/profile-catalogs/updateProfileCatalogItem` | POST | Admin session | Edit one. The category cannot move. |
| `/api/profile-catalogs/setProfileCatalogItemActive` | POST | Admin session | Activate or deactivate. |
| `/api/profile-catalogs/deleteProfileCatalogItem` | POST | Admin session | Delete, unless a profile references it. |

The photo endpoint is deliberately **not** a cloud function: Parse Server logs
every cloud-function call with its serialised input and result, which wrote a
whole photograph to the log on every upload. Moving the bytes off that path
removed the cause, and lets the size limit apply at the socket rather than after
the payload has been parsed.

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

### Complete profile (`/student/profile`) — Students only
- Four sections: Identity, Personal information, Education, Career and links.
- Required and optional fields are marked distinctly; the verified email is
  visibly read-only and explained.
- **City, institution, major, and target role are searchable Selects** over the
  catalog. There is no free-text fallback for any of them; an empty category
  says "No options available yet" rather than showing an empty dropdown.
- **Date of birth** is a full DatePicker that will not accept a future date;
  **expected graduation** is a month-and-year DatePicker that never offers a
  day. Both are localised — an Arabic page shows an Arabic calendar.
- Conditional fields: a custom institution name appears only for the `Other`
  institution, a month picker only for a Current Student, and
  "Why did you choose this role?" only once a target role is selected.
- Photo preview with add / replace / remove. **Choosing a photo opens a cropper**
  so the Student frames the square that becomes their circular avatar, rather
  than the browser taking whatever the centre happens to be. The result is a
  **local preview**; one Save writes the profile, then uploads. If the upload
  alone fails, the saved profile stands and the page says so.
- **The name and photo start from Google.** The full name arrives prefilled from
  the verified claims, with a note saying so that disappears once it is edited;
  the photo is imported when the profile is created. Both are taken **once** —
  changing or removing either is permanent, and no later sign-in restores
  Google's version.
- Inline validation, unsaved-change warning, duplicate-save prevention, and a
  translated message for every failure — including per-field messages the
  backend sends back.
- A **real count** of outstanding required fields. **No progress percentage and
  no statistic.**
- A Student may return and edit at any time.

### Student welcome (`/student/welcome`) — Students with a complete profile
- Branding, a greeting using the name from the saved profile, and confirmation
  that the profile is complete.
- States that joining a batch is the next step and that it is not available yet.
- An **Edit profile** action, a language switch, and logout.
- **No completion percentage, batch, invitation, task, statistic, chart, or link
  to anything that does not exist.**

### `/auth`
- Redirects to `/auth/admin`. Any unknown `/auth/**` sub-route resolves there too.

### Dashboard (`/dashboard`)
- Landing page after login. Placeholder pending the Admin workspace.

A Student who has not finished their profile is directed to
`/student/profile`; the welcome page is reachable only once the **server** says
the profile is complete.

### Profile Catalogs (`/dashboard/profile-catalogs`) — Admins only
- Four tabs: Cities, Universities & Institutes, Majors, Target Roles.
- List, search, create, edit, activate, deactivate, and delete, with loading,
  empty, and error states and bilingual names throughout.
- Institutions additionally carry University / Institute / Other, and the
  `Other` flag that demands a typed name from a Student.
- **Deleting an item any Student references is refused**; the page explains that
  deactivating retires it without blanking anybody's answer.
- Empty means empty: cities, majors, and target roles ship with no data.

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

### Profile catalog
- Four categories and no more, checked before any query exists. It is not an
  `AppSettings` table and holds no configuration or secret.
- A category is immutable after creation: retyping an item would silently
  reinterpret every profile pointing at it.
- Only an Admin may write; a Student receives sanitized **active** items only; a
  Visitor has no access. Direct class access is denied for everybody.
- An item referenced by a profile cannot be deleted. Deactivating keeps it on
  the profiles that already hold it and removes it from every new choice.
- A client never sends a name — only an id, which the backend resolves.

### Importing from Google
- The name is a **suggestion**, never a write: nothing stores it but a Student
  pressing Save.
- The avatar is fetched **server-side** and put through the same validation an
  upload gets — MIME, extension, byte signature, and a decode — then re-encoded.
  Google is a trustworthy source of a photograph, not a reason to skip checking
  that what arrived is one.
- The avatar URL is pinned to Google's own hosts over HTTPS, re-checked before
  use, fetched with redirects refused and no credentials, and bounded in time and
  size. It is never shown to a browser, never stored on the profile, and never
  logged.
- An import that fails for any reason is a profile without a photo, never a
  failed save.

### Student profile
- Exactly one profile per Student, enforced by a unique database index.
- A Student reads and writes only their own, through five focused operations —
  there is no generic CRUD and no operation that takes a profile id.
- The verified email comes from the Google identity and cannot be set by a
  request; the owner pointer is immutable; completion is calculated server-side.
- An Admin cannot read or edit a Student profile, and a Visitor has no access.
- The optional photo is validated by MIME type, extension, **and actual byte
  signature**, re-encoded to a bounded WebP (which strips EXIF), and stored
  privately. **No public URL exists**; the owner reads it through an
  authenticated route that resolves them from their session.
- The photo's size limit applies **at the socket**, before anything is decoded.
- No profile value — name, email, phone, date of birth, education, links, or
  **any part of the photo** — is logged at any level. Image and file keys are
  treated as content: a byte count survives, the bytes never do, and no
  truncated prefix is ever kept.

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
| Backend | `cd backend && pnpm run test` (`node:test`) | 739 |
| Frontend | `cd frontend && pnpm run test` (Vitest) | 509 |

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

Checkpoint 3A — Google name and photo: a Student's full name arrives prefilled
from their verified Google claims, and their Google photo is imported when the
profile is created — fetched server-side from a pinned host, validated and
re-encoded exactly like an upload, and stored privately with no URL anywhere.
Both are taken **once**: changing or removing either is permanent.

Preceded by Checkpoint 3A — Profile Catalog: the four profile selections became references
into a new closed, typed, Admin-managed `ProfileCatalogItem` — required
searchable Selects for city, institution, and major, an optional one for target
role, with an optional 500-character "Why did you choose this role?" that never
affects completion. One Admin page with four tabs manages them; an item any
profile references can be deactivated but not deleted. The photo moved to a
dedicated authenticated binary endpoint, which removed a privacy defect that
wrote a whole photograph to the log on every upload, and fixed
`PROFILE_UNAVAILABLE` on a first save by making one Save write the profile
before uploading. Both date fields became polished, localised DatePickers.
OQ-2 and OQ-3 are resolved; OQ-10 / S-20 remain open for the general
private-file architecture.

Preceded by Checkpoint 3A — Complete Student Profile: a `StudentProfile` model with one row
per Student behind a unique index, five focused Student-only operations,
server-side completion, UTC month normalisation for the expected graduation
date, a centralised institution list plus `Other`, a private profile photo
validated by signature and re-encoded to WebP, a `profileComplete` boolean on the
session, profile-aware routing, the first real product page built on the
Checkpoint 2A design system, and 262 new tests.

Preceded by Checkpoint 2B — Student Google authentication: `StudentAuthIdentity` with two
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
