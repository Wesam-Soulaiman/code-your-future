# Handoff — Checkpoint 4 (Batches, invitations, enrollment, Student directory) + closeout

**Checkpoint:** 4 — Batches, invitations, enrollment, and the Admin Student directory
**Date:** 2026-08-01
**Branch:** `master` (never left)
**Baseline commit:** `70735bc` — *feat: add complete student profile and profile catalogs*
**Ready for review:** **Yes.**

This checkpoint delivers what the plan scheduled as Checkpoints 5 **and** 6.
Splitting them would have shipped a Batch nobody could join, and then an
invitation with nothing to invite anybody to; neither half is reviewable alone.

> **Baseline note.** This work began on top of `79fea2b` with the Checkpoint 3A
> changes uncommitted. Those were committed as `70735bc` while this checkpoint
> was in progress — not by this task, which committed nothing. The working tree
> therefore now contains **only** Checkpoint 4: 60 new files and 30
> modifications, all of them listed in §8. **Nothing was reset, cleaned, stashed,
> restored, or discarded** at any point.

Earlier handoffs are preserved in history: Checkpoint 3A at `70735bc`, 2B at
`79fea2b`, 2A at `9ec03df`, 1 at `0344a43`, Phase 0 at `a796aa0`.

---

## 1. Initial state

```
$ git branch --show-current    master
$ git log --oneline -1
70735bc feat: add complete student profile and profile catalogs
$ git diff --cached --name-only    (empty — nothing staged)
$ git status --porcelain -uall | wc -l    90
```

60 new files, 30 modifications — Checkpoint 4 only. Three of the modifications
(`student-profile.component.{ts,html,scss}`) belong to Checkpoint 3A files that
this checkpoint deliberately touched, for the reasons in §4.

---

## 2. What this checkpoint is

An Admin creates a Batch, generates **one** invitation link for it, and sends it.
A Student opens the link — signing in if they need to, finishing their profile if
they need to — and joins. The Admin can then see who joined, and can find any
Student in a read-only directory.

That is the whole feature. Everything else a "batch management" screen might have
is deliberately absent, and absent from the API too, not merely hidden from the
UI.

---

## 3. The three decisions worth reviewing

### 3.1 The concurrency invariants are database indexes, not application checks

`BatchInvitation` carries a unique partial index on `_p_currentForBatch`;
`BatchEnrollment` a unique index on `(_p_batch, _p_student)`.

An application check cannot win a race: "read the current invitation, see none,
create one" is correct only if nothing happens in between, and eventually
something does. The index makes the second write impossible rather than unlikely.

Two things a reviewer should look at:

- **`_p_<field>`, not `<field>`.** A Parse Pointer occupies a MongoDB column
  called `_p_batch`. Indexing `batch` would create an index on a column that does
  not exist — it succeeds, it looks correct in the schema, and it enforces
  nothing.
- **`partialFilterNulls`.** A retired invitation has no `currentForBatch`.
  Without the partial filter every retired row would collide on `null`, and a
  Batch could never be rotated twice.

**Observed under real contention:** ten simultaneous rotations against one Batch —
three writes landed, seven were refused by the index, and exactly one link was
live afterwards.

### 3.2 A token that never existed and one that is malformed answer identically

Both get `INVITATION_INVALID`. Past that point the caller demonstrably holds a
token we issued, so "expired", "revoked", and "replaced" are told plainly — they
are useful and they leak nothing. Before it, distinguishing "no such token" from
"not even a token" would let somebody probing random strings learn which ones
were once real.

Verified at runtime: the two responses are byte-identical.

### 3.3 Hash routing, kept (OQ-12)

Invitation links are `https://host/#/join/<token>`.

Path routing would need a rewrite rule on the deployment target. Getting that
wrong does not fail at build time or in review — it fails when somebody scans a
QR code in a room and gets a 404. Hash routing needs no server configuration and
cannot break that way, and a URL fragment is never sent to the server, so the
token stays client-side by construction rather than by everybody remembering to
redact it.

Reversing this later means one function, one regular expression, and the rewrite
rule. No data migration, because no link is stored.

---

## 4. What was changed outside the new files

Eleven existing source files were modified. Each is listed with why.

| File | Change | Why |
|---|---|---|
| `utils/logging/redact.ts` | Strip `(#?/join/)<token>` from messages | Parse prints the URL in its `Result:` line; without this a working link lands in the log on every issue |
| `session.service.ts` | `clearSession()` clears the pending invitation | Signing out on a shared machine must not leave a working join link for the next person |
| `guards/home-route.ts` | Added `studentLandingCommands()` and three route constants | One definition of where a Student goes next, so the sign-in path and the profile-save path cannot disagree |
| `student-auth.component.ts` | Lands via `studentLandingCommands()` | Straight to the profile form, or back to the invitation — rather than to the welcome page and out again via a guard |
| `student-profile.component.ts` | Same, after a successful save | Somebody who filled in a profile *in order to join* should land back on the invitation |
| `student-welcome.component.{ts,html,scss}` | Header extracted; docstring corrected | See below |
| `student-profile.component.{html,scss}` | Header swapped for the shared one; its now-dead header styles removed | The profile form hides the navigation while the profile is unfinished — both links it could offer would bounce straight back |
| `shell.component.ts` | Two nav items | Batches and Students are real pages now |
| `app.routes.ts` | Eight routes | Including `/join/:token`, deliberately **ungated** |
| `styles/layout.css` | `.cyf-status-chip`, `.cyf-empty`, `.cyf-flip-rtl` | Five pages render the same four statuses; a status that looked different per page would read as a different thing |

**The Student area header moved into a shared component.** Through Checkpoint 3A
the area was one page, so a header with navigation would have been navigation to
nowhere. It now has three pages, and one header serves them all — the sign-out
call, its double-submit guard, and its destination moved with the button, so the
welcome page's existing sign-out tests still exercise the real thing.

### Protected paths

Nothing under `backend/src/cloudCode/utils/` was modified **except**
`logging/redact.ts`, which this checkpoint's brief authorises explicitly. Nothing
under `models/User.ts`, `models/IMG.ts`, `models/File.ts`, or `modules/User/` was
touched. `.env`, `backend/dashboard.json`, and `.claude/settings.json` were not
modified. `node_modules` was not patched. No prototype and no instruction file
was changed.

---

## 5. Tests

| Suite | Before | After |
|---|---|---|
| Backend (`node:test`) | 739 | **868** |
| Frontend (Vitest) | 509 | **647** |

Three new backend suites and five new frontend specs. One dependency was added:
`qrcode-generator@2.0.4` — zero runtime dependencies, ships its own types, one
file. QR encoding is Reed–Solomon plus mask evaluation; hand-rolling it risks
producing something that *looks* like a QR code and does not scan, which nobody
notices until they are standing in a room with a phone.

### Eight existing tests were updated

All eight encoded a checkpoint boundary that this checkpoint legitimately
crosses. None was weakened; each now asserts the new, correct surface, and five
gained a *stronger* companion assertion:

| Test | Was | Now |
|---|---|---|
| `app.branding.spec.ts` — route surface | `['auth','student','','**']` | includes `join/:token`; the nine shell children are enumerated; **plus** a test that `new` is declared before `:batchId` |
| `app.branding.spec.ts` — future routes | forbade `join`, `batches`, `students` | forbids `reels`, `resources`, `live-slides`, `tasks`, `pinned`; **plus** a test that the join route carries no guard |
| `auth-routing.spec.ts` | same list | same change, **plus** a test that `/join/:token` has neither `canActivate` nor `canMatch` |
| `student-auth.component.spec.ts` | one test: "navigates to the welcome page" | four: unfinished → form, finished → welcome, invitation held → join page, invitation held but profile unfinished → form |
| `student-welcome.component.spec.ts` — future features | forbade "my batch" | forbids only what is still future |
| `student-welcome.component.spec.ts` — links | "no links at all" | an **allow-list** of routes that exist — the failure worth catching is a link to a feature that has not shipped |
| `templatePreservation.test.ts` | forbade a `join` route and any admin page but `profile-catalogs` | enumerates the pages that exist, **plus** a test that no page exists for a feature that does not |
| `schemaAccess.test.ts` | six classes; `Batch` listed as future | nine classes; deny-by-default asserted for all three new ones, and the token hash asserted hidden |

`schemaAccess.test.ts` deserves a specific note: it previously "passed" its
no-future-model assertion partly by **not importing** the classes it was
checking. It now imports all three new models, so every assertion in it is about
something real.

### Two production changes came out of writing the tests

- `normaliseBatchSearch` coerced any input with `String(raw ?? '')`, so a
  malformed request became a search for `[object Object]` — a query that runs,
  returns nothing, and looks like an empty product rather than a bad request. It
  now accepts only a string.
- `mapBatchError` kept the whole server message in `failure.code` when the
  message was not a stable code, so a stack frame or an internal path could
  travel around inside the failure object and be rendered or logged by somebody
  who assumed it was safe. It now keeps a code only if it looks like one.

---

## 6. Runtime validation — 51 checks, all green

Against a **running server on an isolated database** (`cyf_cp4_validation`,
dropped afterwards; the developer's own database was never touched).

In full in [CURRENT_STATE.md §7g](CURRENT_STATE.md). Highlights:

- All three classes are unreadable straight off the REST class API, **with and
  without an Admin session**.
- `startDate: 2026-03-03` is stored and returned as `2026-03-03` — no timezone
  shift in either direction.
- An `ACL` smuggled into a create is **refused**, not silently dropped.
- `draft → completed` is refused; archiving cannot be undone; an archived Batch
  refuses edits and refuses to issue a link.
- A Visitor cannot create, list, issue, read the directory, or redeem. **An Admin
  cannot join a Batch.**
- `deleteBatch`, `removeBatch`, `deleteEnrollment`, and `DELETE /classes/Batch/:id`
  all either do not exist or are refused.

### The log was read, not assumed

| What Parse would have printed | What the file actually contains |
|---|---|
| `Input: {"token":"<43 chars>"}` on every preview and redemption | `Input: {"token":"[REDACTED]"}` |
| The stored hash on an invitation `beforeSave` | `"tokenHash":"[REDACTED]"` |
| `"invitationUrl":"http://…/#/join/<token>"` | `…/#/join/[REDACTED]` |
| Any 40+ character base64url string anywhere in the file | **none** |

The fingerprint (`1c4e64ee`) does appear, by design: it is the first eight
characters of the *hash*, it identifies which link is being discussed, and it
reveals nothing about the token.

---

## 7. Visual validation — 121 checks, 25 captures

A real headless Chrome at 1440 px and 390 px, in **English and Arabic** and
**light and dark**. Every page was checked for a console error, horizontal
document overflow, an untranslated key rendered into the copy, a mismatched
document direction, and more than one `main` landmark. All clean.

The invitation panel was driven for real: open the Batch → Invitation tab →
generate → open the QR dialog. The canvas was then **read back** — dark-module
ratio 0.345 (a blank or filled square would be 0 or 1), the quiet zone light, a
finder pattern dark. A real, scannable symbol, black on white in both themes.

One harness bug is worth recording because it would have produced a false pass:
the first run navigated between hash routes, which does **not** reload the app, so
the language written to `localStorage` was never read and every "Arabic" page was
actually rendering English. The direction assertion is what caught it.

---

## 8. Files

### Added (60)

**Backend models (3)** — `models/{Batch,BatchInvitation,BatchEnrollment}.ts`

**Backend module (14)** — `modules/Batch/{constants,invitationConstants,errors,
invitationToken,frontendOrigin,dto,studentSummary,logging,validation,repository,
invitationService,functions,enrollmentFunctions,studentDirectory}.ts`

**Backend tests (3)** — `batchSurface.test.ts` · `batchValidation.test.ts` ·
`invitationRedaction.test.ts`

**Frontend shared (2)** — `components/layout/student-header.component.ts` ·
`services/qr-code.service.ts`

**Frontend model / service / utils (6)** — `models/Batch.ts` ·
`services/dataService/batch-service.ts` · `utils/batch-constants.ts` ·
`utils/batch-error.ts` · `utils/calendar-date.ts` · `utils/invitation-intent.ts`

**Frontend pages (24)** — `pages/join/join.component.{ts,html,scss}` ·
`pages/student/student-batches.component.{ts,html,scss}` ·
`pages/student/student-batch-detail.component.{ts,html,scss}` ·
`pages/admin/batches.component.{ts,html,scss}` ·
`pages/admin/batch-form.component.{ts,html,scss}` ·
`pages/admin/batch-detail.component.{ts,html,scss}` ·
`pages/admin/invitation-card.component.{ts,html,scss}` ·
`pages/admin/students.component.{ts,html,scss}` ·
`pages/admin/student-detail.component.{ts,html,scss}`

**Frontend specs (5)** — `join.component.spec.ts` ·
`invitation-card.component.spec.ts` · `invitation-intent.spec.ts` ·
`calendar-date.spec.ts` · `batch-error.spec.ts`

### Modified (30)

Eleven source files (§4 — nine listed there, plus `student-profile.component.html`
and `.scss`, which carry the header swap), eight tests (§5), the two i18n files,
`frontend/package.json` and its lockfile, and seven documents.

---

## 9. Warnings and remaining gaps

1. ~~**`applyAllIndexes` is still never called.**~~ **Resolved in the closeout**
   (§11.1). Indexes are applied and physically verified before the port opens,
   and a missing or non-unique one fails the boot.
2. **The losers of a simultaneous rotation get `BATCH_SAVE_FAILED`.** Honest (the
   write did fail) and safe (the invariant held), but an Admin who loses the race
   has to click again. A bounded retry would be nicer.
3. **Enrollment concurrency has not been observed under two genuinely
   simultaneous redemptions.** The unique index and the duplicate-key path are
   both in place and unit-tested, but proving it end to end needs two live Google
   sessions, which automated validation cannot produce.
4. **The full pending-invitation walk-through still needs a real Google sign-in**,
   blocked on the authorised-origin change outstanding from Checkpoint 2B. Every
   step either side of the Google round trip was validated, and the
   return-to-invitation behaviour is unit-tested on both paths.
5. **Expiry is lazy.** An expired invitation keeps `state: current` until somebody
   presents it. Deliberate — a sweep's failure mode is an expired link that still
   works — but the stored state can lag reality.
6. **No Student has actually joined a Batch during validation**, for the same
   reason as (4). The roster, the enrollment count, and My Batches were exercised
   with zero rows; their populated states are covered by unit tests but have not
   been photographed.
7. **The Student workspace has not been photographed in a browser.** ⟨closeout⟩
   The Admin shell was captured at six widths in both languages and both themes,
   and the Student sidebar's exact contents are asserted in
   `shell.component.spec.ts` against a real `SessionService` — but rendering the
   Student pages needs a real Student session, and one cannot be minted outside
   Google: Parse's native signup route is closed by the Checkpoint 1 hardening,
   and a hand-written `_Session` row is not a session Parse accepts. Both facts
   are the product working as designed. What this leaves unproven is only the
   *appearance* of the Student pages inside the shell; their structure is the
   same component the Admin pages use.
8. **PrimeNG marks a disabled paginator control with a `p-disabled` class rather
   than the `disabled` property**, so first/previous stay focusable on the first
   page. Clicking one does nothing, and this is the template paginator's own
   long-standing behaviour; `node_modules` is not ours to patch. Recorded rather
   than worked around.
9. **A wide table's scroll container is not keyboard-reachable.** PrimeNG's
   `.p-datatable-table-container` scrolls correctly — verified at 390 px — but
   carries no `tabindex` and no accessible name, so on a phone the off-screen
   columns can be swiped to but not tabbed to. Same reason as (8): it is
   PrimeNG's element. The alternative attempted during the closeout — taking the
   scrolling over with our own labelled element — produced a control that was
   labelled and did **not** scroll, which is worse.

---

## 10. Git verification

| Check | Result |
|---|---|
| Branch unchanged (`master`) | ✅ |
| No branch created, renamed, switched, merged, or deleted | ✅ |
| Nothing committed, pushed, or staged | ✅ |
| No reset, clean, stash, restore, or checkout of a path | ✅ |
| Earlier uncommitted work preserved | ✅ |
| `.env` and `backend/dashboard.json` untouched | ✅ |
| `node_modules` unpatched | ✅ |
| Prototypes and instruction files untouched | ✅ |
| No task-created process remains | ✅ — ports 1337, 1338, 4200, 9222, 9223 all confirmed free |
| Validation database dropped | ✅ |

---

---

## 11. The closeout

Four things were finished after the checkpoint itself. Each is here because it
was either wrong, or missing, or both.

### 11.1 Index application now runs during startup — and is verified

§9.1 of this handoff previously said `applyAllIndexes` was "never called". That
was half right, and the wrong half mattered more: it *was* called, under its
deprecated alias `applyUniqueIndexes`, **from inside the `server.listen`
callback**.

So the port was open while the indexes were still being built. For most indexes
that is slow; for the two that are the sole enforcement of a concurrency
invariant it was a window in which the guarantee did not exist. And two further
properties made it useless as a safeguard:

- **the kit's applier cannot fail** — every `createIndex` is wrapped in
  `catchError`, and a real failure is `console.error`-ed and stepped over;
- **it never reads its work back**, so a skipped index and a created one looked
  identical.

`cloudCode/startup/indexes.ts` wraps it rather than patching `node_modules`: ping
the database, run the applier, then read **every declared index back out of
MongoDB** and refuse to continue if one is missing or is not unique. `app.ts`
awaits that before `server.listen`; a failure exits non-zero with the port never
opened.

Verified at runtime: indexes complete at 4287 ms, the port opens at 4368 ms. All
seven unique indexes exist and are unique. A second boot drops and recreates
nothing. With duplicate rows planted to block an index, the boot **refused**,
exited 1, named the collection and the index, told the operator to clean up by
hand, printed no duplicate row, and left the offending rows untouched.

### 11.2 The kit's index logging was leaking duplicate values

Found by reading a real log, not by a test.

The kit prints `createErr.message` on failure. A driver's E11000 message contains
the colliding value:

```
dup key: { tokenHash: "e3b0c44298fc…" }
```

On these collections that is an invitation's token hash, a Student's verified
email, or a Google subject — written outside every boundary `safeLogger` puts
around Parse's own output.

The applier is now called with `console` captured; each line goes through
`redactMessage` (which masks the value) and is replayed at **debug** level once
the real console is back. The buffering is load-bearing: forwarding straight into
`safeLog` recursed, because `safeLog` writes to `console`.

### 11.3 The template's table and paginator were never used

The tables did not "drift" from the template — they never used it. `c1517e4`
ships `app-data-table` (a PrimeNG `p-table` with the template's header, row,
hover, and empty-state styling) and `app-paginator` (a `p-paginator` with page
numbers, first/last, a rows-per-page selector, and a `{first} - {last} /
{totalRecords}` report). Both are **unchanged since that commit**. Nothing
imported them. Profile Catalogs in Checkpoint 3A, then Batches, Students, and the
Batch roster in Checkpoint 4, each hand-rolled a bare `<table>` with its own
stylesheet and a pair of Previous/Next buttons.

`components/shared/record-table/` is the narrow slice those four pages need: the
same `p-table`, the same `app-paginator` **used as it is**, and the same
`appColTemplate` directive. `app-data-table` itself is kept and untouched — it
carries bulk delete, XLSX export, a preview panel, column visibility, and a grid
mode, none of which this product has, and deleting it was never on the table.

Server-side paging is unchanged and separately tested: the component holds no
data, slices nothing, and every page change, page-size change, search, and filter
goes back to the backend.

**A real defect surfaced during the restoration.** PrimeNG renders page numbers
through `new Intl.NumberFormat(this.locale)`, and `locale` was unset — so digits
followed the **viewer's operating system**. On this Arabic-configured machine an
English page rendered `١ ٢ ٣`. `app-paginator` gained an explicit `locale` input,
pinned to Latin digits like every other figure in the product.

**A false pass was caught in the browser, and it is worth recording how.** A
390 px screenshot looked as though the table were clipped with no way to reach
the last three columns, so a scroll container was added. It did not help — and
the check that was supposed to prove it was written as *"if a scroller exists,
is it reachable"*, which passed silently on a build where the component had not
compiled at all (a backtick inside a comment inside the `styles` template
literal). Two things came out of fixing it:

- **PrimeNG already scrolls the table**, on its own `.p-datatable-table-container`.
  Measured in a browser at 390 px: 633 px of table inside a 333 px card,
  `overflow-x: auto`. Scrolling it brings Status, Students, and Actions into
  view. The added container was redundant and was removed; the card keeps
  clipping, which is what makes the header follow its corner radius.
- **The check was rewritten to fail when the element is missing**, rather than
  to skip. A test that cannot fail is worse than no test, because it is counted.

What remains is a genuine PrimeNG limitation: that scroll container is not
focusable and has no accessible name, so the off-screen columns cannot be
reached by keyboard alone. Recorded below rather than worked around — the
attempt to take the scrolling over produced a labelled element that did not
actually scroll, which is worse than the honest version.

### 11.4 One shell for both workspaces

The Student area carried its own header with its own navigation, added in
Checkpoint 4. Two navigation implementations meant two sets of active-state
rules, two responsive behaviours, and two places to forget something.

Both areas now load the same `ShellComponent`. It picks its items from the
session's roles:

| Role | Items |
|---|---|
| Admin | Dashboard · Batches · Students · Profile Catalogs |
| Student | Home · My Batches · Edit Profile |
| Anything else | none |

Every item carries an explicit `roles`, so the filter **denies by default** — a
legacy or unrecognised role inherits nothing rather than picking up whatever was
left unrestricted. Hiding a link is not authorization, and nothing here pretends
otherwise: the route guards and the backend are unchanged and remain the
authority.

Sign-out became role-aware at the same time. It used to send everybody to
`/auth`, which asks a Student for a username and password they will never have.

### 11.5 Spacing

A shared layout layer (`.cyf-page-body`, `.cyf-page-head`, `.cyf-toolbar`,
`.cyf-filter-grid`, `.cyf-page-status`) replaced per-page rules that had already
drifted — three sibling pages used 4, 5, and 6 spacing steps for the same
relationship, so navigating between them moved the content. The shell's scroll
container owns the page padding; the template's `p-4 pt-0` left the first element
of every page flush against the divider above it.

The mobile drawer gained an accessible name on its trigger, `aria-expanded`,
Escape to close, and a body scroll lock that is released on close, on resize, and
on destroy — a page left `overflow: hidden` with the drawer gone is
unrecoverable.

### 11.6 What the closeout did **not** change

No Batch, invitation, enrollment, directory, or My Batches behaviour. No Admin
authentication source or behaviour. No route guard. No ACL, CLP, CORS, File, IMG,
or logging rule was relaxed. No template capability was removed. No future
feature was added.

## 12. Recommended next action

1. **Review and commit this checkpoint.** It stands alone on `70735bc`: the
   Checkpoint 3A work is already committed underneath it.
2. **Resolve the index-application gap (§9.1)** before anything is deployed. It is
   the one item here that can fail silently in production.
3. **Finish the Checkpoint 2B closeout** — the Google authorised-origin change is
   still outstanding, and it now blocks the last unproven part of *this*
   checkpoint too.
4. **Walk the invitation flow by hand once**, on a phone, with a real Google
   account: scan → sign in → complete profile → land back on the invitation →
   join. That is the one path automation cannot reach.
5. **Add real catalog data** if it has not been added yet — cities, majors, and
   target roles ship empty by design, and a Student cannot finish a profile
   (and therefore cannot join) until an Admin adds at least one of each.
6. **Decide OQ-10 / S-20** before Checkpoint 7 (Resources) — it cannot be secure
   without an answer.
