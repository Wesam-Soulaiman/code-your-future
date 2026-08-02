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

### `Batch`

A group of Students going through the programme together. An Admin creates one,
invites Students to it with a link, and sees who joined.

| Field | Description | Required |
|---|---|---|
| name | 2–120 characters. **Not unique** — two intakes may share a name | Yes |
| description | Up to 1000 characters | — |
| startDate | A calendar date. Means the same day everywhere | Yes |
| endDate | On or after `startDate`. A one-day Batch is allowed | — |
| status | `draft` / `active` / `completed` / `archived`. Defaults to `draft` | Yes |
| createdBy | The Admin who created it. Never returned to any client | — |

**Only `active` accepts enrollment.** Status never changes on its own — there is
no scheduler and no date-driven transition. The allowed moves are
`draft → active | archived`, `active → completed | archived`, and
`completed → archived`. **Archived is terminal and read-only**: no field, no
status, no new invitation, no new member, ever again.

There is **no delete**, here or anywhere under a Batch. Deleting one would
silently delete the record of who was in it.

Deliberately absent: capacity, maximum students, trainers, location, schedule,
image, score, rating, and any Program field.

### `BatchInvitation`

The link that lets somebody into a Batch. One current invitation per Batch,
enforced by a **unique database index** rather than an application check.

| Field | Description |
|---|---|
| batch | The Batch it admits to |
| tokenHash | SHA-256 of the token. **The token itself is never stored** |
| fingerprint | First eight characters of the hash. Safe to display and to log |
| state | `current` / `replaced` / `revoked` / `expired` |
| version | Increments on every rotation |
| expiresAt | Optional. Judged at the moment a token is presented |
| currentForBatch | Set only while current. This is the indexed column |

The raw token is 32 bytes of OS randomness, base64url-encoded, and is returned in
**exactly one response**. It is never stored, never logged, and never shown
again — only replaced. Generating a new link stops the old one working
immediately; Students who already joined are unaffected.

### `BatchEnrollment`

A Student's membership of a Batch: the pair, and when they joined. One
membership per `(Batch, Student)`, again enforced by a **unique index**, so
redeeming the same link twice returns the existing membership rather than
creating a second one.

Carries no score, rating, grade, feedback, or note.

### `BatchResource`

A file an Admin shares with one Batch. **Metadata only** — the bytes live in
private GridFS storage and are addressed by `storageKey`, 128 bits of randomness
that never leaves the server. A 20 MiB document stored inline on the row would be
loaded whole on every read of the row, including reads that only wanted a title.

Columns: the Batch, a title, an optional description, the sanitised original
filename, the extension, the stored MIME type, the size in bytes, a display
order, the storage key, and the uploading Admin.

`storageKey`, `batch`, `filename`, `extension`, `mimeType`, `fileSize`, and
`uploadedBy` are **written once, at creation**, and a trigger refuses any later
change to them. That is what makes "there is no file replacement" a fact about
the data rather than a policy about the UI.

Two indexes: `(batch, displayOrder)` for the list, and a **unique** index on
`storageKey` — two rows sharing a key would mean deleting one destroys the
other's bytes.

Carries no folder, tag, category, comment, rating, download count, progress flag,
or generic metadata bag.

> `AppSettings` was removed in Checkpoint 1 (resolved decision OQ-13): it had no
> consumer, no product requirement, and it widened the API surface. A generic
> key-value settings store is now a **prohibited pattern** — future configuration
> needs use narrowly scoped, typed, sanitised endpoints.

**Not implemented yet:** `LiveSlidesSession`, `Task`, `Submission`,
`PinnedStudent`, Talent Reels.

---

## Entity Relationships

```
_User ──(membership)────── _Role {Admin, Student}
      ├──(1:1 per provider) StudentAuthIdentity {google}
      ├──(1:1)────────────── StudentProfile
      │                           │
      │                           └──(4 × N:1) ProfileCatalogItem
      │                                {CITY, INSTITUTION, MAJOR, TARGET_ROLE}
      └──(N:M via BatchEnrollment) Batch
                                     │
                                     └──(1 current, N historical) BatchInvitation

Batch ──(1:N)── BatchEnrollment ──(N:1)── _User      unique on (batch, student)
Batch ──(1:N)── BatchInvitation                      unique on currentForBatch
Batch ──(1:N)── BatchResource ──(N:1)── _User        unique on storageKey
                      │                 (uploadedBy)
                      └──(1:1) private GridFS binary, addressed only by storageKey

File, IMG  — standalone private infrastructure, no product owner yet
```

---

## API surface

Thirty-nine cloud functions and two authenticated binary routes. Nothing else is
reachable.

Both binary routes exist for the same reason: Parse Server logs every
cloud-function call with its serialised input **and** result, so a file passed as
a parameter is a file written into the log. Bytes therefore never enter the
cloud-function pipeline in either direction.

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
| `/api/batches/listBatches` | GET | Admin session | A page of Batches. Search and status filter; the page size is capped server-side. |
| `/api/batches/getBatch` | GET | Admin session | One Batch **and** its invitation status. |
| `/api/batches/createBatch` | POST | Admin session | Create. Only `draft` or `active` may be chosen. |
| `/api/batches/updateBatch` | POST | Admin session | Edit. Refused outright for an archived Batch. |
| `/api/batches/changeBatchStatus` | POST | Admin session | Move status, enforcing the allowed transitions. |
| `/api/batches/archiveBatch` | POST | Admin session | Terminal and irreversible. |
| `/api/batches/listBatchStudents` | GET | Admin session | The roster: an allow-listed summary per Student, paged. |
| `/api/batches/issueBatchInvitation` | POST | Admin session | Generate **or** rotate. Returns the only copy of the token. |
| `/api/batches/getBatchInvitation` | GET | Admin session | State, fingerprint, version, expiry. **Never the token or the hash.** |
| `/api/batches/revokeBatchInvitation` | POST | Admin session | Kill the current link. |
| `/api/batches/expireBatchInvitation` | POST | Admin session | Expire it now. |
| `/api/batches/setBatchInvitationExpiry` | POST | Admin session | Set or clear the expiry. |
| `/api/join/previewInvitation` | **POST** | **none** | The only public product endpoint. Returns the Batch name and dates, or a stable reason. Carries **no identifier of any kind**. |
| `/api/student-batches/joinBatchWithInvitation` | POST | Student session | Redeem. Idempotent — a repeat returns the existing membership. |
| `/api/student-batches/listMyBatches` | GET | Student session | The caller's own memberships. No roster, no counts. |
| `/api/student-batches/getMyBatch` | GET | Student session | One of them. "Not yours" and "does not exist" answer identically. |
| `/api/student-directory/listStudents` | GET | Admin session | Read-only directory, driven by `StudentProfile`. Filters are catalog **ids**, never typed names. |
| `/api/student-directory/getStudent` | GET | Admin session | One Student, read-only, plus the Batches they belong to. |
| `/api/batch-resources/listBatchResources` | GET | Admin session | Every Resource of one Batch in display order, plus the upload rules and whether the Batch is read-only. Works on an archived Batch. |
| `/api/batch-resources/updateBatchResource` | POST | Admin session | Edit the title and description. The file is untouchable — there is no replacement operation. |
| `/api/batch-resources/reorderBatchResources` | POST | Admin session | Apply a whole new order. The set is rewritten 0..n in one save. |
| `/api/batch-resources/deleteBatchResource` | POST | Admin session | Delete the Resource and the bytes behind it. |
| `/api/student-resources/listMyBatchResources` | GET | Student session | The Resources of a Batch the caller has **joined**. An invitation alone grants nothing. |
| `/api/batch-resource` | POST | Admin session | **Not a cloud function.** Multipart upload, bounded at the socket to 20 MiB. |
| `/api/batch-resource/:resourceId` | GET | Admin **or** enrolled Student | **Not a cloud function.** Streams the bytes as an attachment. **No URL exists** — the id is not an address for the file, and a refusal answers 404. |

The two operations that accept a token are **POST** so the token travels in a
body: a GET would put it in the URL, and URLs end up in access logs, proxy logs,
and browser history.

**There is no delete** for a Batch, an invitation, or an enrollment, and no write
of any kind against a Student — no create, edit, delete, role change, password
reset, impersonation, rating, score, or export exists in the API.

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
- An **Edit profile** action; the shared header carries navigation, the language
  switch, and logout.
- **No completion percentage, task, statistic, chart, or link to anything that
  does not exist.**

### My Batches (`/student/batches`) — Students with a complete profile
- The Batches this Student has joined, with dates and status.
- Empty is a normal state, not an error: joining needs somebody to send a link,
  and the page says exactly that.
- **No other Student appears anywhere, and no count of them.** The endpoint
  behind the page cannot return a roster.

### One Batch (`/student/batches/:batchId`) — Overview · Resources
- The Batch's details and the date this Student joined.
- No roster, no trainer, no schedule, no score.
- "Not yours" and "does not exist" render the identical message, because the
  server refuses to distinguish them.

### Join a Batch (`/join/:token`) — **public**
- The only page a Visitor can open that shows real product content: a Batch name,
  its dates, and nothing else.
- One page, six audiences. A Visitor is asked to sign in; a Student with an
  unfinished profile is asked to finish it; an eligible Student is offered
  **Join this batch**; an Admin is told plainly that an admin account cannot
  join; and an expired, revoked, replaced, or invalid link says which.
- The invitation is remembered **before anything can navigate away**, so signing
  in and completing a profile both come back here. It lives in `sessionStorage`,
  dies with the tab, and is cleared on success, on an unusable link, on cancel,
  and on sign-out.
- The token is never rendered into the page and never written to `localStorage`.

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

### Batches (`/dashboard/batches`) — Admins only
- Search by name, filter by status, paged. Every filter change returns to page
  one, because page 3 of a 2-page result reads as an empty product.
- **New batch**, and a row that opens the Batch. **There is no delete anywhere
  on the page, because there is none in the API.**

### New / edit a Batch (`/dashboard/batches/new`, `/dashboard/batches/:batchId/edit`)
- Name, description, start date, end date, and — on create only — the initial
  status, which may be `draft` or `active`.
- Dates go through the picker and are sent as calendar dates: the day that was
  picked is the day that is stored, whatever timezone the browser is in.
- An archived Batch never reaches this page, and the form stays disabled if
  somebody arrives at it anyway.

### One Batch (`/dashboard/batches/:batchId`) — Overview · Students · Invitation · Resources
- **Overview** — details, the Student count, and the status transitions that are
  legal right now, read from the shared transition map so the buttons and the
  server cannot disagree. Archiving is confirmed in a dialog that spells out what
  stops working rather than asking "are you sure".
- **Students** — the roster: name, verified email, city, institution, and when
  they joined. Read-only. There is no way to remove a Student from a Batch or to
  act on one from here.
- **Invitation** — generate, rotate, set an expiry, expire now, revoke, and a QR
  code. The link is shown **once**, with a warning saying so; after that only its
  fingerprint, version, state, and expiry remain. The QR code is drawn black on
  white in both themes, because a scanner reads it and a themed one does not
  scan.
- **Resources** — upload a file, edit its title and description, move it up or
  down, download it, and delete it. The upload dialog states the accepted formats
  and the size limit **as the server sent them**, so the hint cannot drift from
  the rule. Editing says plainly that the file itself cannot be replaced.
  Deleting says the file goes with the row. On an archived Batch every one of
  those controls is **absent** — not disabled — and the panel says why; downloads
  keep working.

  The panel is mounted only while its tab is open, so a Batch nobody opens it on
  costs no request at all.

### Students (`/dashboard/students`) — Admins only
- A **read-only directory**: search, and filter by Batch, city, institution,
  major, target role, and profile completion. Every filter sends a catalog id,
  never a typed name.
- Driven by `StudentProfile`, so a Student appears whether or not anybody has
  invited them anywhere — which is the point, since the directory exists to find
  somebody to invite.
- **Not user management.** No create, edit, delete, role change, password reset,
  impersonation, rating, score, or export — none of them exist in the API either.

### One Student (`/dashboard/students/:studentId`) — read-only
- Name, verified email, the four catalog selections, completion, and the Batches
  they belong to. The only interactive things on the page are links to Batches.
- **No phone number, date of birth, or photo** — the endpoint does not return
  them, and the page says so.

### Sidebar Navigation (Admin shell only)

| Item | Route | Icon | Roles |
|---|---|---|---|
| Dashboard | `/dashboard` | `fa-solid fa-gauge` | Admin |
| Batches | `/dashboard/batches` | `fa-solid fa-layer-group` | Admin |
| Students | `/dashboard/students` | `fa-solid fa-user-group` | Admin |
| Profile Catalogs | `/dashboard/profile-catalogs` | `fa-solid fa-list-ul` | Admin |

The Student area has a header with Welcome, My Batches, and My Profile — added
when the area gained a second page, and hidden on the profile form while the
profile is unfinished, because both other links would bounce straight back.

Resources, Live Slides, Tasks, Pinned Students, Talent Reels, and user management
are **not** present. Every navigation item leads to a page that works.

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

### Batches, invitations, and enrollment
- A Batch is a group of Students. Only an **active** Batch accepts anybody, and
  no status ever changes on its own.
- **Archived is terminal**: no edit, no status change, no new link, no new
  member. It is the retirement path, and it keeps everything — deleting a Batch
  would silently delete the record of who was in it.
- **One current invitation per Batch**, and **one membership per Student per
  Batch**, both enforced by unique database indexes rather than application
  checks. A race cannot break either: under ten simultaneous rotations the
  database refused seven and exactly one link was live afterwards.
- The token is 256 bits of OS randomness. **Only its SHA-256 hash is stored**;
  the raw value exists in one response and then nowhere — not in a log, not in
  storage, not in a URL the server sees.
- A token that never existed and one that is malformed produce the **identical**
  answer, so nobody probing random strings can learn which were real. Beyond that
  point the holder demonstrably has a token we issued, so "expired", "revoked",
  and "replaced" are told plainly.
- Rotating retires the old link **before** creating the new one, so there is
  never a moment when two links work.
- Redeeming is idempotent: scanning the same code twice says "you had already
  joined", not "joined again".
- An Admin cannot join a Batch, and a Visitor cannot redeem a link — signing in
  comes first, and the profile comes before the membership.

### Batch Resources
- An Admin uploads files to a Batch; enrolled Students list and download them.
  Visitors get nothing, and a Student outside the Batch gets the same answer as
  somebody asking for a Resource that does not exist.
- Eight accepted formats — `.pdf .html .htm .docx .pptx .xlsx .txt .md` — and
  **20 MiB** per file. The limit is applied at the socket, so an oversized upload
  is refused mid-stream rather than buffered whole and then rejected.
- Three things are checked, cheapest first: the extension against a closed
  allow-list, the browser's MIME value as a **cross-check** (never as the source
  of truth), and finally the bytes. `.docx`, `.pptx`, `.xlsx`, a renamed `.jar`
  and a plain `.zip` all start with the same four bytes, so for those three the
  **package contents** decide — read from the ZIP central directory, with nothing
  decompressed and no ZIP library added.
- The stored MIME type comes from the allow-list, never from the browser, so a
  caller cannot choose what a later download is served as.
- Every download is an **attachment**, including HTML: `Content-Disposition:
  attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  no-store`, and a sandbox CSP. There is no inline mode, no preview endpoint, and
  no query parameter that changes it. An uploaded `.html` rendered in this
  application's origin would run its own script with the reader's session in
  scope.
- Downloads are **streamed** out of GridFS, so a 20 MiB file is never held whole
  in application memory.
- **No file replacement.** A metadata edit changes the title and description;
  the storage key, filename, extension, MIME type, and size are frozen by a
  trigger.
- Reordering sends the **whole** sequence, and the server rewrites `displayOrder`
  0..n in one save, so two concurrent reorders cannot interleave into an order
  neither Admin chose.
- Deleting removes the row **first**, then the bytes. A failure between the two
  leaves bytes nobody can see and anybody can reclaim; the other order would
  leave a visible Resource whose download 404s. Uploading is the mirror image —
  bytes first, row second — and every failure path after the bytes land removes
  them again.
- An archived Batch is read-only, not invisible: everything stays listed and
  downloadable, and every write is refused server-side as well as hidden in the
  UI.
- **There is no public URL for a Resource**, and nothing in the browser can build
  one. `/api/files/*` remains closed.

### Schema reconciliation at startup
- Parse **adds** fields to `_SCHEMA` and never removes them, so a `required`
  field left behind by an earlier shape of a model refuses **every** create on
  that class — surfacing as a bare `142 / "<field> is required"` naming a column
  the running code has never heard of. A fresh database never shows it.
- Startup now compares each class's stored required fields with what its model
  declares. A stale required field **no row uses** is removed through Parse's own
  schema API and logged loudly; one that **still holds data** fails the boot with
  the field named, because deleting somebody's column is a person's decision.
- Deliberately narrow: it does not sync schemas, does not touch optional
  leftovers, and does not touch anything a model still declares.

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
- `storageKey` joined the masked list in Checkpoint 5, found the same way
  `fullName` was in 3A: runtime validation read a real log file and saw Parse's
  own `beforeSave` line writing a private file's address verbatim. A Resource
  operation logs an id, a byte **count**, and an extension — never a filename,
  because people name documents after themselves and after the people they are
  about.

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
It now renders every table surface: Admin Batches, the Student directory, a
Batch roster, Profile Catalogs, Admin Batch Resources, and Student Batch
Resources. Server-backed lists still page and filter on the server; lists
returned whole by their APIs page and search locally. Product-specific actions
remain explicit, so bulk deletion and Excel export stay hidden where the API
does not offer them.

---

## Tests

| Suite | Command | Count |
|---|---|---|
| Backend | `cd backend && pnpm run test` (`node:test`) | 987 |
| Frontend | `cd frontend && pnpm run test` (Vitest) | 707 |

No new dependency was added for either suite, and none was added for the feature.

Beyond the suites, Checkpoint 5 was validated against a **running server on an
isolated database**: 75 checks covering all eight formats with real bytes, a
renamed executable, a JAR disguised as a `.docx`, an empty file, the 20 MiB
boundary, every download header, the four access boundaries, the archived
read-only rule, orphan counts read straight from GridFS, and a real log file
audited for a leaked storage key. Then six browser inspections in both languages
and at a phone width.

Checkpoint 4 was validated the same way: 51 API checks, a concurrency run (ten
simultaneous rotations → exactly one live link), a log audited for a leaked
token, and 121 browser checks — including reading the QR canvas back to confirm a
real, scannable symbol was drawn.

---

## Known Limitations

- Initial frontend bundle exceeds its 500 kB budget (pre-existing).
- Port `1337` default is now overridable via `PORT`, but `serverURL` must be kept
  consistent manually.
- `withHashLocation()` is still active, so deep links are `/#/path`. **Decided**
  (OQ-12): invitation links are `https://host/#/join/<token>`. Keeping it needs no
  server rewrite rule, and a fragment is never sent to the server — so the token
  stays client-side by construction.
- `applyAllIndexes` is still never called. Three unique indexes now exist and two
  of them are the sole enforcement of a concurrency invariant, so a deployment
  that skips index creation would lose those guarantees silently.
- The losers of a simultaneous invitation rotation get `BATCH_SAVE_FAILED` rather
  than an automatic retry. Safe, and not yet pleasant.
- Enrollment concurrency is enforced by a unique index and exercised in code, but
  has not been observed under two genuinely simultaneous redemptions — that needs
  two live Google sessions.
- CI is `.gitlab-ci.yml` targeting branch `dev` while the remote is GitHub/`master`
  (OQ-14).
- Reads from private storage reach past the files adapter's public surface to
  its `_getBucket()`. Neither public read method fits: `getFileData` buffers the
  whole file, and `handleFileStream` is a range handler that demands a `Range`
  header, always answers 206, and sets no `Content-Disposition`. The call is
  feature-detected at startup and the server logs a warning if it is ever
  missing, but a parse-server upgrade that removes it would break downloads.
- Reordering has no drag-and-drop. Move Up / Move Down works from the keyboard
  and needs no library; a long list would want better.
- A Resource cannot be moved between Batches, and there is no bulk upload.
  Both are deliberate for now.
- An archived Batch shows two read-only notices on the Resources tab — one for
  the Batch, one for the panel. Each is accurate and each is needed on its own
  (the Student view has no page-level banner), but together they read as
  repetition.

---

## Required configuration

| Variable | Where | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `backend/.env` | Google **Web application** Client ID. Student sign-in refuses without it; Admin login is unaffected. |
| `googleClientId` | `frontend/src/environments/environment*.ts` | The same public Client ID for the browser. |
| `FRONTEND_ORIGIN` | `backend/.env` | **Optional.** The origin invitation links are built against. Falls back to the first usable entry of the CORS allow-list; if neither is set the API returns a **relative path** and the browser resolves it against whatever origin served the page. Never read from a request header — a link built from a caller-supplied host is a phishing primitive. |

There is **no Google client secret** anywhere: this flow returns a signed ID
token directly and never exchanges an authorization code.

## Last Updated

Checkpoint 5 — Private Batch Resources: an Admin uploads files to a Batch and
manages their titles, descriptions, and order; enrolled Students list and
download them. Eight document formats, 20 MiB each, validated by extension, by
the browser's MIME claim, and finally by their own bytes — which is the only one
of the three an uploader cannot simply set. Files live in private GridFS storage
addressed by a random key that never leaves the server; every download is an
authenticated, streamed **attachment** with no public URL anywhere. This resolves
**OQ-10** and closes **S-20**.

Preceded by Checkpoint 4 — Batches, invitations, enrollment, and the Admin Student directory:
an Admin creates a Batch, generates one invitation link for it, and sees who
joined; a Student opens the link, signs in if they need to, finishes their
profile if they need to, and joins. One current link per Batch and one membership
per Student per Batch are enforced by **unique database indexes**, so a race
cannot break either. The link's token is 256 bits of OS randomness, stored only
as a SHA-256 hash, shown exactly once, and absent from every log. There is **no
delete** for a Batch or anything under one, and the Student directory is
**read-only** — no create, edit, delete, role change, password reset,
impersonation, rating, score, or export exists in the API. Resolved OQ-4 (Batch
fields) and OQ-12 (hash routing kept, for the reasons in
`docs/TEMPLATE_ARCHITECTURE.md` §17g).

Preceded by Checkpoint 3A — Google name and photo: a Student's full name arrives prefilled
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
