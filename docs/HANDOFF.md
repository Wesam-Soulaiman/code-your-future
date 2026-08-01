# Handoff — Checkpoint 3A (Profile Catalog)

**Checkpoint:** 3A — Complete Student Profile, completed with Profile Catalog management
**Date:** 2026-08-01
**Branch:** `master` (never left)
**Baseline commit:** `79fea2b` — *feat: add secure student Google authentication*
**Ready for review:** **Yes.**

This handoff supersedes the first Checkpoint 3A handoff. Both bodies of work are
uncommitted on top of `79fea2b` and are meant to be reviewed together: the second
completes the first and corrects three defects in it.

Earlier handoffs are preserved in history: Checkpoint 2B at `79fea2b`, 2A at
`9ec03df`, 1 at `0344a43`, Phase 0 at `a796aa0`.

---

## 1. Initial state

```
$ git branch --show-current    master
$ git log --oneline -1
79fea2b feat: add secure student Google authentication
$ git diff --cached --name-only    (empty — nothing staged)
$ git status --porcelain -uall | wc -l    44
```

The 44 entries were the first Checkpoint 3A cut, uncommitted and intentional.
**Every one of them was preserved**; nothing was reset, cleaned, stashed, or
discarded, and no file from that work was deleted.

---

## 2. What changed, and why

### 2.1 The four profile selections became catalog references

`city`, `institution`, `major`, and the new `targetRole` are now **pointers**
into `ProfileCatalogItem` rather than free text or a hard-coded array.

The practical difference: "Damascus", "damascus", and "Dmascus" used to be three
different places, and correcting the institution list meant a deployment. Now a
rename is one Admin edit and it corrects every profile pointing at the item at
once — because the profiles point at the item, not at a copy of its name.

A request carries an **id**. A bare `city`, `institution`, `major`, or
`targetRole` in a payload is refused outright, because it is somebody trying to
write a name straight into the record.

### 2.2 `ProfileCatalogItem` — closed and typed, not a settings store

Restricted to exactly `CITY`, `INSTITUTION`, `MAJOR`, `TARGET_ROLE`, checked at
the cloud-function boundary before any query exists. The category is **immutable
after creation**: retyping an item would silently reinterpret every profile
pointing at it. There is no `key`, `value`, `config`, `json`, or `data` column,
and a test asserts there never will be.

Deny-by-default CLP on all six operations, an empty class ACL, no per-record
grant to anybody, every column in `protectedFields`, and a unique
`(type, code)` index.

**Five Admin operations** and **one Student read**. No generic CRUD, no class
name in any signature, no `where`.

### 2.3 Deleting versus deactivating

An unused item is deleted. An item any profile references is refused with
`CATALOG_IN_USE`, counted across **every** reference column rather than just the
matching one. Cascading or nulling would blank a field in somebody's profile
without their knowledge.

Deactivation is the supported alternative, and it is asymmetric on purpose: an
inactive item **stays valid** on the profiles that already chose it, and can
never be *newly* selected. Both halves matter — the first so an Admin tidying a
list does not invalidate answers people already gave, the second so deactivation
means something.

### 2.4 The optional target role

`targetRole` is optional; `targetRoleReason` answers, in exactly these words:

- English — **Why did you choose this role?**
- Arabic — **لماذا اخترت هذا الدور؟**

Optional, ≤ 500 characters, shown only when a role is selected, and cleared when
the role is cleared. **Neither affects completion**, and neither is an
evaluation — nothing scores or ranks either one. `careerGoal` is unchanged.

Sending a reason without a role is **not** an error: a Student clearing their
role is a legitimate save, and refusing it would strand them on a form
complaining about a field they can no longer see. The value is dropped instead.

---

## 3. Three defects in the first cut, fixed

### 3.1 `PROFILE_UNAVAILABLE` on a first save with a photo

**Cause.** Choosing a photo uploaded it immediately, against a profile that did
not exist yet. A photo belongs to a profile; on a first save there is none until
the save creates it.

**Fix.** Selecting an image is now a **local preview**. One Save action
validates, writes the profile, and *then* uploads. If the profile save fails the
photo is not sent at all — attaching an image to details that were rejected would
be attaching it to nothing.

**If the upload alone fails**, the saved profile stands, nothing is rolled back,
the page says "Your details were saved. The photo could not be uploaded," and
offers a retry that re-sends only the file. Throwing away twelve correct fields
over one image would be the worse outcome.

### 3.2 A whole photograph in the log, on every upload

**Cause.** Parse Server logs every cloud-function call at `info` as a message
containing the serialised input and result. The upload was a cloud function
taking base64, so the image appeared verbatim inside `Input: {"data":"…"}` — and
again on the way back out.

**Fix, at the cause.** The bytes moved to a dedicated authenticated binary route
(§4). They never enter Parse's cloud-function pipeline, so there is no line to
redact.

**Fix, as a second layer**, because a future edit could put them back: redaction
now treats file and image keys as **content** — `data`, `base64`, `photo`,
`image`, `file`, `buffer`, `bytes`, `binary`, `contents`, `payload`, `blob`,
`attachment`, `thumbnail`, `avatar`, `picture`, and `filename`.

A matching key survives **only** when its value is a number or a boolean, which
no image can be. `bytes: 48213` tells an operator the upload worked; the bytes
themselves are never acceptable, and **no truncated prefix is kept** — the first
characters of a JPEG are still the first characters of a JPEG.

Two details in that pass are load-bearing:

- **`profile` is stripped before matching**, because `profileId` contains
  `file`. Without it, every profile id in every log line would read
  `[REDACTED]`, losing the identifier that lets an operator follow a request.
- **`{` is excluded from the unquoted value class.** Parse writes
  `Input: {"data":"…"}`; with `{` allowed the first match is `Input` →
  `{"data":"…`, which is not sensitive, so it is kept — and the scanner has
  already consumed the pair it was supposed to mask. This is why the fix looked
  correct and did nothing until the pattern changed.

The value pattern was also rewritten from `(?:[^"\\]|\\.)*` to
`[^"\\]*(?:\\.[^"\\]*)*`. Both match the same strings, but only the second is
unambiguous; the first has two ways to match every ordinary character, which on
a multi-megabyte unterminated payload explores an exponential number of paths.
An image is exactly that size.

### 3.3 A person's name in the log

Found while validating the above. Parse's `beforeSave` and result lines
serialised a Student's `fullName` and their Google `displayName` verbatim — in
the same lines where the email beside them was already `[REDACTED]`. That is
incoherent: a name identifies a person as well as an address does.

`fullname`, `displayname`, `givenname`, and `familyname` joined the personal-data
list. No log call site anywhere passes a field with those names, so nothing
useful was lost. Runtime validation now asserts the absence of all of them.

---

## 4. The photo endpoint

| | |
|---|---|
| `POST {mountPath}/profile-photo` | multipart, field `photo` |
| `GET {mountPath}/profile-photo` | the owner's bytes, `image/webp` |

Mounted on the Parse mount path **before** the entity-route middleware, so it
terminates its own two paths and every other request falls through untouched.

- Raw multipart rather than base64 — a third smaller on the wire.
- **The size limit applies at the socket**, before anything is decoded or held
  whole. A cloud function had already parsed the entire payload before the first
  check could run.
- The caller is resolved from `X-Parse-Session-Token` against `_Session`, an
  expired session is rejected explicitly, and **live** `Student` membership is
  read. No user id, profile id, or class name is accepted from the client.
- MIME type, filename extension, and the **actual byte signature** must all
  agree, then `sharp` must decode it; every upload is re-encoded to a bounded
  WebP, which strips EXIF including GPS.
- `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. A
  photograph of a person must not sit in a proxy or a shared machine's cache.
- The 10-per-minute bound moved with the endpoint rather than being dropped.

**What did not change.** `blockRawFileRoutes` still answers `/api/files/*` with
403 — verified at runtime. `File`, `IMG`, and `fileAdapter.ts` are untouched and
unwired. `fileUpload` stays disabled. **No public URL exists.** The bytes still
live inline on the private, owner-ACL'd, deny-by-default profile row, so
**OQ-10 / S-20 remain open**: this is a profile-photo answer, not the general
private-file architecture, and it would not serve a Batch Resource PDF.

---

## 5. Searchable selects and polished date pickers

Four PrimeNG `p-select` controls — city, institution, major, target role — all
filterable, keyboard reachable, rendered into `body` so no card can clip an
overlay, with loading, empty, and no-match states. **No native `<select>`
remains anywhere on the form.** Target role is clearable because it is optional;
the three required ones are not, since clearing them could only produce a
required error.

An item an Admin has since retired still appears **on the profile that chose
it**, marked "no longer offered" in words rather than by colour, and the backend
still refuses it as a new choice for anybody else.

Two PrimeNG DatePickers replace the native `type="date"` and `type="month"`
inputs:

- **Date of birth** — full date, calendar icon, clear action, year navigation so
  a birth year is reachable without paging through months, and `maxDate` set to
  today so a future date is not reachable at all rather than typed and rejected.
- **Expected graduation** — `view="month"`, `dateFormat="mm/yy"`. **No day is
  ever offered**, because month-and-year is the precision anybody has. The
  browser sends `YYYY-MM`; the backend remains authoritative and stores the
  first of that month at `00:00:00.000Z`.

**PrimeNG does not read `@ngx-translate`.** Its DatePicker draws month and day
names from its own translation object, which defaults to English — so an Arabic
page opened an Arabic-labelled field onto a calendar reading
"May 2001 / Su Mo Tu We Th Fr Sa". Found by looking at a screenshot, not by a
test. `PrimeNgLocaleService` now generates both languages from
`Intl.DateTimeFormat` — the browser already ships correct names, so the spelling
cannot drift and a later locale needs no new list — and re-applies them on every
language change.

---

## 6. Profile Catalogs — the Admin page

`/dashboard/profile-catalogs`, Admin-only, reachable from one new navigation
item (**Profile Catalogs** / **قوائم الملف الشخصي**). Added because the feature
now exists; nothing in that menu is a stub.

Four tabs — Cities, Universities & Institutes, Majors, Target Roles — each with
list, search, create, edit, activate, deactivate, and delete, plus loading,
empty, and error states. Institutions additionally carry University / Institute /
Other and the `isOther` flag.

Two details worth keeping:

- **The code preview.** The server normalises whatever it is given, so an Admin
  typing `Damascus Univ.` sees `DAMASCUS_UNIV` before saving rather than
  discovering it afterwards.
- **`CATALOG_IN_USE` is explained, not just reported.** The message says the item
  is in use and that deactivating retires it without blanking anybody's profile.

**Empty means empty.** Cities, majors, and target roles ship with no data,
because no authoritative source exists and a plausible-looking invented list is
worse than an empty one — an empty one is obviously empty. Only institutions are
seeded, from the list the first Checkpoint 3A cut already carried, including
`Other`. Seeding is keyed on the normalised code, so it is safe on every boot and
concurrently, and it **does not overwrite an Admin's edits**.

---

## 6b. The name and photo start from Google

A Student signs in with Google, so their name and avatar are already known and
verified. Making them retype one and re-upload the other is friction for no
benefit — so both are taken, **once**, and both are theirs to change.

**The name** is prefilled into the form from the verified claims, with a note
saying where it came from that disappears the moment they edit the field. It is a
suggestion and nothing more: nothing writes it but the Student pressing Save, and
a saved profile never claims a provider name.

**The photo** is imported on the save that *creates* the profile. It is fetched
server-side and put through exactly the upload validation — declared MIME,
filename extension, real byte signature, a `sharp` decode — then re-encoded to a
bounded WebP. Google is a trustworthy source of a photograph, not a reason to
skip checking that what arrived is one.

**Once is the whole design.** Neither is ever re-applied, so a corrected spelling
or a removed photo is permanent. Two things fall out of that for free: an import
can never overwrite an image the Student chose, and removal needs no "suppressed"
flag to track and get wrong.

### Fetching a URL that arrived in a token

The avatar URL is verified and trustworthy in practice, but *"the backend fetches
a URL a request named"* is the shape of a server-side request forgery whatever
the source. It is treated as untrusted at four points:

1. **At capture** — `https:` only, hostname pinned to `googleusercontent.com`,
   `google.com`, or `gstatic.com`, matched exactly or as a sub-domain. A URL that
   fails is **dropped, not refused**: a bad avatar must never cost somebody their
   sign-in.
2. **At read** — re-checked, because the check that admitted it and this read are
   separated by time and a database.
3. **At request** — `redirect: 'error'` (following one would let a pinned host
   hand off to an unpinned one), no credentials, 4-second timeout.
4. **At the body** — the content type must be an accepted image; a declared
   length over 5 MiB is refused **before a byte is read**; the bytes actually
   received are checked again, because a header is a claim, not a guarantee.

The URL itself lives on `StudentAuthIdentity` beside the provider subject — it is
provider identity data — in `protectedFields`, and reaches no DTO, no browser,
and no log. It is deliberately **not** on the profile: a Google avatar URL is a
stable, unauthenticated address for a photograph of a person, and putting it on
the object that gets serialised to a browser would be one careless field away
from undoing the reason the image is stored privately at all.

Nothing here throws. A missing, slow, or malformed avatar is a profile with no
photo and an Add button — never a failed save.

### Framing the photo

Choosing a photo by hand opens the template's **`image-cropper-dialog`**, which
had been carried since Checkpoint 1 and never wired to anything. A profile photo
is rendered in a circle, so what a Student sees is a square crop of whatever they
picked — chosen by the browser, from the centre, with no say from them. Letting
them place that square is the difference between a portrait and an arbitrary
rectangle of somebody's shoulder.

`aspectRatio: 1` and `maintainAspectRatio` match the avatar exactly, and the
cropper is asked for **WebP** — which is what gets stored anyway, so the preview
is the image. The result becomes the pending file and the existing
save-then-upload flow carries it unchanged; cancelling changes nothing, and an
existing photo survives a dismissed dialog.

Two things surfaced by being the component's first consumer, both fixed in place:

- its stylesheet was **empty**, and its footer carried PrimeNG's own
  `.p-dialog-footer` class inside the dialog *body* — where PrimeNG positions
  that class for the real footer slot, drawing the buttons **on top of the
  image**. The footer is now a plain row with a separator;
- its buttons read `'Close' | translate` and `'Save' | translate`, which are not
  keys — ngx-translate echoes a missing key, so an Arabic dialog showed English
  words. They now use `actions.cancel` and `actions.save`, which already existed
  in both languages.

The file's type and size are checked **before** the cropper opens, so an
unusable file is refused while the Student still has the picker in mind rather
than after they have spent time framing a crop; the cropped result is checked
again, because it is a different image.

---

## 7. Tests

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && pnpm run test` | **739 pass, 0 fail** |
| Frontend | `cd frontend && pnpm run test` | **509 pass, 0 fail** (18 files) |
| Backend compile | `pnpm run compile` | exit 0 |
| Frontend build | `pnpm run build` | exit 0, initial bundle **701.83 kB** |

Zero new dependencies; both `--frozen-lockfile` installs succeed unchanged.

The photo endpoint is tested against a **real Express server on an ephemeral
loopback port**, posting real multipart bodies — the only way multer's size
limit, the signature checks, and `sharp` are actually run rather than described.

The Google import is tested in two halves, because the halves need different
things. The host allow-list is asserted against 14 hostile URLs *and* against the
fact that **no request is issued at all** for any of them. Everything downstream
of that check needs a response that appears to come from a pinned host, so the
transport is doubled — not the checks — and the happy path is proved by asserting
that what lands in storage is a real `RIFF...WEBP`, not the PNG that was sent.

---

## 8. Runtime validation — 65 + 20 checks, all green

Against an isolated `mongod` on port 27018 with a local credential double for
Google. Highlights:

- Admin CRUD across all four categories; an unknown category or a class name in
  its place is `CATALOG_VALIDATION_FAILED`; a duplicate code is
  `CATALOG_DUPLICATE`.
- A Student receives **active items only**; a Visitor is refused; a Student
  cannot reach an Admin operation and an Admin cannot reach the Student read.
- Uploading before the profile exists is `PROFILE_UNAVAILABLE`; **one Save then
  upload succeeds with no `PROFILE_UNAVAILABLE` anywhere**, and the owner reads
  the bytes back as `image/webp` with `private, no-store`.
- **No base64, no `data:` URI, no long blob, and no personal value** — name,
  email, or phone — anywhere in the server log. A photo log line carries a byte
  count and nothing more.
- A name in place of an id, a wrong-category id, and a newly chosen inactive item
  are each `VALIDATION_FAILED`; an already-chosen retired item keeps the profile
  complete.
- Deleting a referenced item is `CATALOG_IN_USE` with the profile untouched;
  deactivating it keeps it on that profile and removes it from new options.
- `2001-05-09T00:00:00.000Z` and `2027-06-01T00:00:00.000Z` stored; switching to
  Graduate clears the graduation date.
- A disguised script and a 6 MiB upload are both refused; another Student gets
  404 for the photo and their own empty profile.
- `/classes/*`, `/schemas`, and `/files/*` all **403**; CORS answers the
  allow-listed origin only, never a wildcard, and never echoes a foreign origin.
- No country, timezone, remote-attendance, or evaluation column exists, and only
  the eight approved classes are in the database.

A further **20 checks** cover the Google import: the name arrives prefilled and
is marked as such; the Student's override is stored and survives both a re-read
and a second sign-in; a pinned-host URL is captured while an unpinned one is
never stored; an avatar that cannot be downloaded degrades to no photo rather
than a failed save; no DTO or log line carries a URL, a provider field, or a
subject; and a removed photo stays removed across later saves.

Two of the four initial failures were **my assertions being wrong**, not the
system: Parse maps `OPERATION_FORBIDDEN` onto HTTP 400 with code 119 rather than
403, and the `cors` package answers a static allow-list by echoing the configured
origin (so a foreign request receives a header that does not match itself and the
browser blocks it). Both assertions were corrected to test the behaviour rather
than the status number. The other two were the real name-in-log defect.

---

## 9. Visual validation — 27 captures

Complete Profile and Profile Catalogs at **1440 / 768 / 390 px** in **English
and Arabic**, plus both date pickers open and a searchable select open in both
languages.

- **Zero** horizontal overflow, **zero** clipped text.
- **No native date input and no `<select>`** on any capture.
- Exactly one `h1` per page; four labelled sections on the form; no percentage.
- **No console errors.**
- Every overlay renders fully inside the viewport.
- The date-of-birth picker shows 35 day cells and year navigation; the graduation
  picker shows 12 month buttons and **zero day cells**.

Plus the Google-sourced name at 1440 px in both languages, and the same page
after editing it. The field arrives filled, the hint reads "Taken from your
Google account. Change it if you prefer a different name." and its Arabic
equivalent, and the hint **disappears on the first keystroke**. **No Google URL
appears anywhere in the rendered markup.**

Reviewed by eye: profile EN 1440, AR 1440, AR 390; the Arabic graduation picker
(Arabic month names, RTL, month-only); the Arabic institution select (filter
input, Arabic names, University tags); Profile Catalogs AR 1440 and EN 390; and
the prefilled name in English.

**Not claimed:** no real Google sign-in was performed. The runtime and visual
passes used the injectable credential verifier, and the Google Cloud origin
change from the Checkpoint 2B closeout is still outstanding.

---

## 10. Files

### Added (23)

**Backend (11)** — `models/ProfileCatalogItem.ts` ·
`modules/ProfileCatalog/{constants,errors,dto,validation,repository,logging,functions,seed}.ts` ·
`modules/StudentProfile/{catalogRefs,photoRoute,googleImport}.ts`

**Backend tests (3)** — `profileCatalogSurface.test.ts` · `imageRedaction.test.ts` ·
`googleProfileImport.test.ts`

**Frontend (7)** — `models/ProfileCatalogItem.ts` ·
`utils/profile-catalog-constants.ts` · `utils/catalog-error.ts` ·
`services/dataService/profile-catalog-service.ts` ·
`services/primeng-locale.service.ts` ·
`pages/admin/profile-catalogs.component.{ts,html,scss}`

**Frontend tests (2)** — `pages/admin/profile-catalogs.component.spec.ts` ·
`services/primeng-locale.service.spec.ts`

### Modified

**Backend (12)** — `app.ts` (mount the photo route; seed the catalog) ·
`utils/logging/redact.ts` (authorised) · `models/StudentProfile.ts` ·
`models/StudentAuthIdentity.ts` · `modules/StudentAuth/{googleVerifier,provisioning}.ts` ·
`modules/StudentProfile/{constants,validation,repository,dto,functions,photo}.ts`

**Backend tests (7)** — `studentProfile{Validation,Surface,Operations}.test.ts` ·
`studentAuthSurface.test.ts` · `redaction.test.ts` · `schemaAccess.test.ts` ·
`templatePreservation.test.ts`

**Frontend (12)** — `models/StudentProfile.ts` ·
`utils/{student-profile-constants,profile-error}.ts` ·
`services/dataService/student-profile-service.ts` · `services/http.interceptor.ts` ·
`app.config.ts` · `app.routes.ts` · `components/layout/shell.component.ts` ·
`styles/layout.css` · `pages/student/student-profile.component.{ts,html,scss}` ·
`public/i18n/{en,ar}.json`

**Frontend (14)** — also
`components/shared/image-cropper-dialog/image-cropper-dialog.component.{html,scss}`
(first consumer; see §6c)

**Frontend tests (2)** — `pages/student/student-profile.component.spec.ts` ·
`app.branding.spec.ts`

**Docs (6)** — `PROJECT.md` · `docs/PRODUCT_REQUIREMENTS.md` (authorised) ·
`docs/TEMPLATE_ARCHITECTURE.md` · `docs/IMPLEMENTATION_PLAN.md` ·
`docs/CURRENT_STATE.md` · `docs/HANDOFF.md`

### Deleted (0) — nothing was deleted.

`README.md` was **not** changed: no configuration, environment variable, or
command changed.

**Deliberately untouched:** `backend/.env` · `backend/dashboard.json` ·
`docs/prototypes/*` · all three `CLAUDE.md` files · `.claude/**` ·
`backend/src/cloudCode/utils/**` except the authorised `logging/redact.ts` ·
`database/**` · `modules/User/**` · `models/{User,File,IMG}.ts` · all three
lockfiles and both manifests · `node_modules`.

---

## 11. Warnings and remaining gaps

1. **Initial bundle 698.48 kB against a 500 kB warning budget.** Pre-existing —
   it was 677.55 kB before this work and over budget then too. PrimeNG's Select
   and DatePicker account for most of the increase, and both are load-bearing
   requirements.
2. **`OQ-10` / `S-20` remain open.** The photo has an authenticated route; the
   general private-file architecture does not, and Batch Resources (Checkpoint 7)
   will need one.
3. **A local database carrying first-cut Checkpoint 3A data will not accept the
   new schema.** `city`, `institution`, and `major` changed from `String` to
   `Pointer`. Drop the `StudentProfile` collection, or use a fresh database. The
   runtime validation ran against a clean one.
4. **No real Google sign-in was performed**, for the reason in §9. In particular
   **a successful avatar download from Google's own CDN has not been observed** —
   the runtime pass used a pinned host that does not resolve, which proves the
   failure path, and the success path is proved by test with the transport
   doubled. The first real sign-in is where an end-to-end import should be
   confirmed.

---

## 12. Git verification

```
$ git diff --check                 exit 0 (LF→CRLF notices only)
$ git diff --cached --name-only    (empty — nothing staged)
$ git ls-files backend/.env backend/dashboard.json
                                   (empty — neither is tracked)
```

| Confirmation | Result |
|---|---|
| Nothing staged, nothing committed, nothing pushed | ✅ `HEAD` still `79fea2b` |
| No branch created or switched | ✅ still on `master` |
| Existing Checkpoint 3A work preserved | ✅ all 44 entries intact, none deleted |
| `.env` / `dashboard.json` unchanged and still ignored | ✅ |
| Protected paths unchanged | ✅ except `logging/redact.ts`, explicitly authorised |
| Prototypes and instruction files unchanged | ✅ |
| No secret, profile value, or image content exposed | ✅ |
| No template capability removed | ✅ guarded by `templatePreservation.test.ts` |
| No dependency added or removed | ✅ both frozen-lockfile installs pass |
| No Country or Timezone field | ✅ asserted at runtime against the live schema |
| No future product feature | ✅ |
| No task-created process remains | ✅ |

---

## 13. Recommended next action

1. **Visual review**, especially light mode and a real photograph — the runtime
   fixture is a 1×1 PNG, which renders as a flat colour circle. This is also
   where the Google avatar import should be seen working end to end for the
   first time (see §11.4).
2. **Add real catalog data.** Cities, majors, and target roles are empty by
   design; a Student cannot finish a profile until an Admin adds at least one of
   each.
3. **Commit** the two Checkpoint 3A bodies of work together.
4. **Decide OQ-10 / S-20** before Checkpoint 7.
5. **Finish the Checkpoint 2B closeout** — the Google Cloud authorized-origin
   change is still outstanding, and no real Google sign-in has been demonstrated.
6. **Start Checkpoint 5** (Batch management), which needs OQ-4 answered.
