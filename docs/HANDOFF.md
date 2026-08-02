# Handoff — Checkpoint 5 (Private Batch Resources)

**Checkpoint:** 5 — Private Batch Resources
**Date:** 2026-08-02
**Branch:** `master` (never left)
**Baseline commit:** `673f898` — *feat: add batches invitations and student enrollment*
**Ready for review:** **Yes.**

This is the work the plan scheduled as **Checkpoint 7 — Resources**, and it is the
checkpoint that answers **OQ-10** and closes **S-20**: the general mechanism for
private files that are too large to store inline.

Nothing was committed, staged, or pushed. Nothing was reset, cleaned, stashed,
restored, or discarded. The working tree contains **20 new paths and 19
modifications**, all listed in §8.

Earlier handoffs are preserved in history: Checkpoint 4 at `673f898`, 3A at
`70735bc`, 2B at `79fea2b`, 2A at `9ec03df`, 1 at `0344a43`, Phase 0 at `a796aa0`.

---

## 1. Initial state

```
$ git branch --show-current    master
$ git log --oneline -1
673f898 feat: add batches invitations and student enrollment
```

Checkpoint 4 and its closeout were committed as `673f898` before this work began.
The tree was clean.

---

## 2. What this checkpoint is

An Admin uploads files to a Batch and manages their titles, descriptions, and
order. Students enrolled in that Batch list them and download them. Nobody else
can do either.

- Eight formats: `.pdf .html .htm .docx .pptx .xlsx .txt .md`. **20 MiB** each.
- Files are stored **privately in GridFS**, addressed by a random key that never
  leaves the server. There is no public URL, no storage path in any response, and
  nothing in the browser that could build one.
- Every download is an authenticated, **streamed attachment** — HTML included.
- **No file replacement.** Metadata is editable; the bytes are frozen at creation
  by a database trigger.
- An archived Batch is **read-only, not invisible**: everything stays listed and
  downloadable and every write is refused.

`/api/files/*` is still 403. `File`, `IMG`, `fileAdapter.ts`, and the Checkpoint
3A profile-photo route are untouched.

---

## 3. The four decisions worth reviewing

### 3.1 Private storage is Parse's own GridFS adapter, used in-process

This is the OQ-10 answer, and the reasoning is in
[TEMPLATE_ARCHITECTURE.md §19](TEMPLATE_ARCHITECTURE.md).

`Parse.File` is unusable here: Parse's `FilesRouter` is not part of the router
`directAccess` uses, so `Parse.File.save()` HTTP-calls the server's own
`serverURL` and `blockRawFileRoutes` refuses it — correctly. That is S-20, and it
was not worked around. It was **routed around**: the configured
`GridFSBucketAdapter` is already connected to the same database, so it is reached
directly, in process, and the blocked HTTP surface is never involved.

No new dependency. `mongodb` is on disk transitively but is not directly
importable under pnpm's strict layout, and adding it would have been an
unnecessary dependency for something the adapter already does.

**The one thing to review:** reads call `adapter._getBucket()`. Neither public
read method fits — `getFileData` buffers the whole file, and `handleFileStream`
is a range handler that demands a `Range` header, always answers 206, and sets no
`Content-Disposition`. The call is feature-detected together with `createFile`
and `deleteFile` at startup, and the server logs a warning at boot if any is
missing, so a parse-server upgrade that moved it surfaces as a startup line
rather than as a failed download under a user. It is recorded as a limitation.

### 3.2 Bytes are stored before the row, and deleted after it

Upload: bytes, then the metadata row, with `removeBinaryQuietly` on **every**
failure path after the bytes land. Delete: the row, then the bytes.

The asymmetry is the failure design. Bytes with no row are invisible, harmless,
and reclaimable. A row pointing at bytes that are not there is a broken Resource
people can see and click.

Runtime validation checked this by counting GridFS documents directly after every
refused upload: eight rows, eight binaries, no orphan.

### 3.3 A magic-byte check would not have been enough

`.docx`, `.pptx`, and `.xlsx` are ZIP archives. So is a `.jar`. All of them start
`PK\x03\x04`. A signature check accepts an executable JAR renamed to `.docx` and
looks thorough while doing it.

So for those three the **package contents** decide, read from the ZIP central
directory: every OOXML package has `[Content_Types].xml`, and a document also has
`word/`, a presentation `ppt/`, a workbook `xl/`. Nothing is decompressed,
nothing is opened, the scan is bounded, and a malformed archive yields a short
list rather than an exception. A name table is inert — which is why no ZIP
library was added.

Both the test suite and the runtime validation build real ZIP containers byte by
byte and check that a JAR renamed `.docx` is refused, that a `.docx` is not
accepted as a `.pptx`, and that a plain ZIP renamed `.xlsx` is refused.

### 3.4 An uploaded `.html` is a hostile document, and is treated as one

Served inline it would run its own script in this application's origin, with the
reader's session in scope. Every download is `Content-Disposition: attachment`
plus `X-Content-Type-Options: nosniff`, and there is no inline mode, no preview
endpoint, and no query parameter that changes it. The browser saves it and never
parses it.

The frontend enforces the same thing from its side: the bytes arrive as a `Blob`
over an authenticated request and go to a temporary object URL that is clicked
once and revoked. Nothing is opened in a tab, and there is no `href` anywhere
that points at a file.

---

## 4. What was changed outside the new files

### `backend/src/app.ts`

- Imports and mounts `batchResourceRouter()` on the Parse mount path, **ahead of
  `validateEntityRoutes`** — for the same reason the profile-photo route is
  mounted there: that middleware maps a path segment to a registered entity and
  would reject an unknown one.
- Wires Parse's configured files adapter into the Resource storage module once,
  after Parse Server is initialised and before indexes are applied, and logs a
  boot-time warning if the adapter cannot do what the module needs.

### `backend/src/app.ts` — the schema reconciliation step ⟨post-review fix⟩

A real upload against a real database failed with `142 / "file is required"` —
a column no model declares. Parse **adds** fields to `_SCHEMA` and never removes
them, so a `required` leftover refuses **every** create on that class, forever,
while the class still reads and counts perfectly. A database created by this code
never has it, which is why every suite passed.

`startup/schemaDrift.ts` now runs before the port opens. Per declared class it
compares the stored required fields with the declared ones and, for a required
field the model does not declare: removes it through `Parse.Schema` when **no row
uses it** (logged loudly), or **fails the boot naming the field** when rows still
hold values, because deleting somebody's column is a person's decision.

Verified by injecting that exact `file` column into an isolated database and
booting: it was removed, and the full 75-check runtime validation passed after.

### `backend/src/cloudCode/utils/logging/redact.ts` — a protected path

One line: `'storagekey'` was added to the sensitive-key list.

**Why it had to change.** Runtime validation read the real log file and found
Parse Server's own `beforeSave` line writing `storageKey` verbatim on every
upload. `filename` was already masked; the storage key was not. It is the single
value in that row that would matter most to a log reader, because it is how the
bytes are addressed.

This is the same class of finding, discovered the same way, as `fullName` in
Checkpoint 3A — which is also why that entry is in the same list. The fragment is
`storagekey`, not `storage`, so a harmless flag like `storageIsUsable` is not
swallowed with it. Three new tests pin all of that.

Nothing else in the file changed, and the change only ever **adds** masking.

### Five existing test files

| File | Change |
|---|---|
| `schemaAccess.test.ts` | `BatchResource` imported and added to the approved-class list (nine → **ten**), added to the deny-by-default loop, and given its own `protectedFields` assertion. `'Resource'` left the future-model list. |
| `templatePreservation.test.ts` | `'resource'` and `"path: 'resources'"` left the future lists; the two new page prefixes were allow-listed; two new assertions added — that the browser keeps no copy of the server's format list or size limit, and that nothing in the Resource frontend knows a storage key or opens a tab. |
| `studentAuthSurface.test.ts`, `studentProfileSurface.test.ts` | `'resource'` removed from their "no future product function" lists. Resources shipped; the exact five functions are now asserted in the new surface test instead. |
| `redaction.test.ts` | Three tests for the storage key, the Resource filename shape, and the `storageIsUsable` false positive. |

### Frontend — five existing files

`batch-detail.component.{ts,html}` gained a fourth tab.
`student-batch-detail.component.{ts,html,scss}` gained tabs it did not have —
Overview and Resources — styled to match the Admin page, so the two views of one
Batch look like two views of one thing.
`en.json` / `ar.json` gained a `resources` block and the two tab labels, at full
parity (asserted by the existing parity spec).

### Protected paths

`backend/src/cloudCode/utils/` was modified — one line in `redact.ts`, explained
above. `backend/src/cloudCode/database/`, `models/User.ts`, `models/IMG.ts`,
`models/File.ts`, and `modules/User/` were **not** touched. `.env` and
`dashboard.json` were not touched. No prototype or instruction file was touched.

---

## 5. Tests

| Suite | Before | After |
|---|---|---|
| Backend (`node:test`) | 872 | **999 pass, 0 fail** |
| Frontend (Vitest) | 648 | **707 pass, 0 fail** |

No new dependency for either suite, and none for the feature.

### New backend files

- **`resourceValidation.test.ts`** — what a Resource is allowed to be. Builds real
  ZIP containers byte by byte, so the OOXML discrimination is exercised against
  actual structure rather than against a mock that agrees with it. All eight
  formats; the three ZIP formats against each other; a JAR renamed `.docx`; a
  plain ZIP renamed `.xlsx`; an empty archive; an executable renamed `.pdf` and
  `.txt`; every forbidden extension; unsupported-but-harmless extensions; MIME
  contradiction; the 20 MiB boundary from both sides; filename sanitising
  including header injection, traversal, a leading dot, length, and Arabic.
- **`batchResourceSurface.test.ts`** — the five registered functions and nothing
  else; every one requires a session; none accepts file bytes or a storage key;
  the model's CLP, ACL, protected fields, columns, indexes, and frozen fields;
  both DTOs' exact shapes; the logging allow-list; the eight error codes; the
  metadata rules; storage-key generation; and the binary route's header and
  ordering promises, asserted against its source.

The route's guarantees are header decisions and an ordering of two writes —
properties of the code as written, not of a value it returns. A test that mocked
Express and multer to observe them would mostly be asserting that the mock
matches the real thing, so those are asserted against source, with comments
stripped first so a sentence promising something is absent cannot be mistaken for
the thing itself.

### New frontend files

`schemaDrift.test.ts` covers the reconciliation: the repair, the refusal, the
three cases it must not touch (optional leftovers, declared fields, Parse's own
columns), and the rule that a failed count means "there might be data".

`resource-error.spec.ts` (every code, and that nothing a server said survives),
`resource-constants.spec.ts` (icons, binary units, Latin digits in Arabic),
`batch-resources.component.spec.ts` (25 tests: list, archived read-only, the
three client-side pre-checks that fire without a request, multipart body, edit,
reorder with rollback, delete, download-not-open), and
`student-batch-resources.component.spec.ts` (the Student endpoint, no write
control drawn, download saves rather than opens).

---

## 6. Runtime validation — 75 checks, all green

Against a running server on an **isolated database** (`cyf_cp5_validation` on a
`mongod` on port 27018 with a scratch dbpath, dropped and stopped afterwards).
The developer's own MongoDB on 27017, their server on 1337, and their database
were never touched.

The full table is in [CURRENT_STATE.md §7i](CURRENT_STATE.md). The parts worth
repeating here:

- All eight formats accepted with real bytes; the **stored** MIME type comes from
  the allow-list, not from what the browser claimed.
- A JAR renamed `.docx`, an executable renamed `.pdf`, an executable renamed
  `.txt`, a MIME contradiction, an empty file, and 20 MiB + 1 KiB: all refused,
  each with its own code, and **413 at the socket** for the oversized one.
- After every refusal, GridFS document count == metadata row count. No orphan.
- Download headers verified on the wire, and the bytes came back byte-for-byte.
- A Student outside the Batch gets **404**, not 403 — existence is the secret.
- A smuggled `storageKey` in an edit is refused with a field error, and the
  stored key is unchanged.
- Delete removes the row **and** the binary; a later download is a clean 404.
- On an archived Batch: list works and reports `readOnly`, all four writes are
  refused, downloads still work, and an enrolled Student still reads it.
- `/classes/BatchResource` is unreadable with no session **and** with an Admin
  session, and unwritable. `/api/files/*` is still refused.

### The log was read, not assumed — and it had a leak

| What Parse would have printed | What the file contains now |
|---|---|
| `"storageKey":"resource_01d6d9e2…"` on every `beforeSave` | `"storageKey":"[REDACTED]"` |
| `"filename":"week-1-reading.pdf"` | `"filename":"[REDACTED]"` |
| Any file bytes | none |
| An upload | `Resource uploaded {op,stage,ok,userId,batchId,resourceId,extension,bytes:29}` |
| A refusal | `Resource upload refused {…,code:"RESOURCE_TYPE_NOT_ALLOWED",bytes:68}` |

The first run **failed** on the storage key. §4 has the fix.

### One honest note about how the Student session was made

`/loginAs` is refused over HTTP by `restrictRoutes`, correctly — production calls
`Parse.User.loginAs` in-process. So the validation writes a `_Session` row
directly, in exactly the shape Parse writes one. Everything after that is the
real authenticated path: the server resolves the token, reads roles from `_Role`,
and checks enrolment against the database on every call. **No claim is made that
a real Google sign-in was performed.**

---

## 7. Visual validation — six inspections

Headless Chrome against the isolated server, at 1440 px and 390 px, in English
and Arabic. Screenshots were captured and looked at.

| # | What | Result |
|---|---|---|
| 1 | Admin → Resources tab, live Batch | five Resources with title, description, filename, type, binary size, date; all write controls present |
| 2 | The upload dialog | states the accepted formats and the 20 MiB limit **as the server sent them**; the picker's `accept` is the server's list |
| 3 | Admin → Resources, **archived** Batch | listed and downloadable; Upload, Edit, Delete, Move Up, Move Down all **absent**; the panel says why |
| 4 | Student → Resources tab | two tabs; every row offers a download; no control a Student cannot use is drawn |
| 5 | Arabic, RTL | `dir="rtl"`, translated, no English in the panel, file sizes in **Latin** digits |
| 6 | 390 px phone | the list renders, the document does not scroll sideways, the wide table scrolls inside its own container |

Every inspection also asserted: no console error, no `<a href>` pointing at a
file, and no `resource_` key anywhere in the rendered HTML.

The developer's dev server owned port 4200, so the app was served on 4300 and the
browser rewrote its API calls from 1337 to the isolated server on 1338. Their
ports were never bound and their data was never reached.

---

## 8. Files

### Added (20 paths)

**Backend**

```
backend/src/cloudCode/models/BatchResource.ts
backend/src/cloudCode/startup/schemaDrift.ts
backend/test/schemaDrift.test.ts
backend/src/cloudCode/http/session.ts
backend/src/cloudCode/modules/BatchResource/storage.ts
backend/src/cloudCode/modules/BatchResource/constants.ts
backend/src/cloudCode/modules/BatchResource/errors.ts
backend/src/cloudCode/modules/BatchResource/fileValidation.ts
backend/src/cloudCode/modules/BatchResource/validation.ts
backend/src/cloudCode/modules/BatchResource/dto.ts
backend/src/cloudCode/modules/BatchResource/logging.ts
backend/src/cloudCode/modules/BatchResource/access.ts
backend/src/cloudCode/modules/BatchResource/repository.ts
backend/src/cloudCode/modules/BatchResource/functions.ts
backend/src/cloudCode/modules/BatchResource/resourceRoute.ts
backend/test/resourceValidation.test.ts
backend/test/batchResourceSurface.test.ts
```

`http/session.ts` exists because Checkpoint 3A resolved a session inside the
photo route and Checkpoint 5 needed exactly the same thing. Two copies of session
resolution is the kind of duplication that eventually diverges in the direction
of being wrong — one gets an expiry check and the other does not.

**Frontend**

```
frontend/src/app/models/BatchResource.ts
frontend/src/app/utils/resource-constants.ts
frontend/src/app/utils/resource-error.ts
frontend/src/app/utils/save-blob.ts
frontend/src/app/services/dataService/batch-resource-service.ts
frontend/src/app/pages/admin/batch-resources.component.{ts,html,scss,spec.ts}
frontend/src/app/pages/student/student-batch-resources.component.{ts,html,scss,spec.ts}
frontend/src/app/utils/resource-constants.spec.ts
frontend/src/app/utils/resource-error.spec.ts
```

### Modified (19)

```
backend/src/app.ts
backend/src/cloudCode/utils/logging/redact.ts          ← protected path, one line, §4
backend/test/redaction.test.ts
backend/test/schemaAccess.test.ts
backend/test/templatePreservation.test.ts
backend/test/studentAuthSurface.test.ts
backend/test/studentProfileSurface.test.ts
frontend/src/app/pages/admin/batch-detail.component.{ts,html}
frontend/src/app/pages/student/student-batch-detail.component.{ts,html,scss}
frontend/public/i18n/{en,ar}.json
PROJECT.md
docs/PRODUCT_REQUIREMENTS.md
docs/TEMPLATE_ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
docs/CURRENT_STATE.md
docs/HANDOFF.md
```

`README.md` was **not** changed: no dependency, no environment variable, and no
setup step was added.

---

## 9. Warnings and remaining gaps

1. **`_getBucket()` is not public API.** Feature-detected at startup and warned
   about at boot, but a parse-server upgrade that removes it breaks downloads.
   Watch it on any adapter change. §3.1.
2. **No drag-and-drop ordering.** Move Up / Move Down works from the keyboard and
   needs no library. A long list would want better.
3. **A Resource cannot move between Batches, and there is no bulk upload.** Both
   deliberate.
4. **Two read-only notices** appear on the Resources tab of an archived Batch —
   one for the Batch, one for the panel. Each is accurate and each is needed
   alone (the Student view has no page-level banner), but together they read as
   repetition. A deliberate choice, worth a second opinion.
5. **The initial frontend bundle is 715.51 kB** against a 500 kB budget. The
   template already exceeded it; both new panels are in lazy route chunks.
6. **Concurrent reordering is safe but not observed under real contention.** The
   whole sequence is rewritten in one `saveAll`, so two reorders resolve to one of
   them rather than to an interleaving — but two genuinely simultaneous Admin
   sessions were not driven.
7. **Port 4200 was in use when the visual pass began and was free afterwards.**
   Nothing this task ran targeted it: the dev server it started was on 4300, and
   only 4300 and 1338 were released. It is noted here because it cannot be proven
   that nothing done here caused it.

---

## 10. Git verification

```
$ git branch --show-current    master
$ git log --oneline -1         673f898 feat: add batches invitations and student enrollment
$ git status --porcelain | wc -l    39     (20 new paths, 19 modified)
$ git stash list                    (empty)
```

Nothing staged, nothing committed, nothing pushed. No branch created, switched,
renamed, merged, or deleted. No reset, clean, stash, restore, checkout, or revert.

---

## 11. Recommended next action

1. **Review and commit this checkpoint.** It stands alone on `673f898`.
2. **Read the one-line change to `redact.ts` first** (§4). It is in a protected
   path, it was made in response to a real leak found in a real log file, and it
   only ever adds masking.
3. **Upload one file of each accepted type by hand**, from a browser, and open
   each downloaded file. Automation proved the bytes come back identical; it
   cannot tell you Word opens the `.docx`.
4. **Try an uploaded `.html` in a browser** and confirm it downloads rather than
   renders. That is the one behaviour where a browser's own opinion matters.
5. **Decide whether the double read-only notice** on an archived Batch stays
   (§9.4).
6. **Checkpoint 8 (Live Slides) still needs OQ-5 answered in writing** before it
   starts. OQ-10 is now resolved and no longer blocks anything.
