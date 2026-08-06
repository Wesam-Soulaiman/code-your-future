# Handoff — Checkpoint 8 / 8B / 8C (Talent Reel, Public Student Profiles, Talent Discovery)

**Checkpoint:** 8 + 8B + 8C — the public talent showcase, its refinement, and
the two corrections on top of it
**Date:** 2026-08-05
**Branch:** `master` (never left)
**Baseline commit:** `4bd5685` — *feat: add batch tasks and student submissions*
**Ready for review:** **Yes.**

Three pages a stranger can open without an account: a filterable directory of
published work, one Student's public profile, and a vertical Talent Reel. A
Student appears when their Final Task is published, they consented, and their
profile has been completed at least once — and disappears only when somebody
decides something, never because a profile is mid-edit. An Admin can pin a
published Reel to the front of both public surfaces.

Nothing was committed, staged, or pushed. No branch was created or switched.
`.env`, `backend/dashboard.json`, `docs/prototypes/**`, `CLAUDE.md`, and
`.claude/**` were not touched. No dependency was added.

Earlier handoffs are preserved in history: Checkpoint 7 at `4bd5685`, 6 at
`d3b80fd`, 5 at `c4166e9`, 4 at `673f898`, 3A at `70735bc`.

---

## 1. Initial state

```
$ git branch --show-current    master
$ git log --oneline -1
4bd5685 feat: add batch tasks and student submissions
```

CP7 was committed at `4bd5685`. CP8 began from a clean tree; **CP8B began from
this same commit with CP8's work still uncommitted in it**, which is the right
base — CP8B extends CP8 rather than replacing it, and discarding uncommitted
work is not something to do quietly. Both checkpoints are in this one tree.

---

## 2. One ambiguity, and how it was resolved

The brief's flow reads *"Submit Final Task → Admin publishes Final Task → if
consent → create publication"*, which could mean an Admin action **after**
submission. The same brief also forbids a moderation workflow and approvals, and
CP7 shipped publication as automatic.

Both readings are satisfied by taking the stated invariant literally: the Final
**Task** must be in `PUBLISHED` status, alongside consent. That is now a
condition in `evaluateEligibility`. Nothing new is asked of an Admin — publishing
the Task is the same action that let Students submit to it — and CP7's behaviour
is preserved exactly, because a Student can only submit to a published Task
anyway. What it adds is that closing or archiving a Final Task withdraws the
Reels it produced.

If that reading is wrong and a per-submission Admin gate was intended, the
change is one condition in one function plus a control — say so and it is a
small piece of work.

---

## 3. What was built

**No new model.** The showcase is built from CP7's `TalentReelPublication` and
`StudentProfile`. Three columns were added to `TaskSubmission` (`demoTitle`,
`demoVideoUrl`, `demoVideoId`) and three to the publication (`demoTitle`,
`demoVideoId`, `reelVideoId`).

**New backend module** `modules/PublicTalent/`: `constants`, `dto`,
`repository`, `functions`, `photoRoute`. Four unauthenticated cloud functions
plus a public photo route addressed by slug.

**New frontend**: `models/PublicTalent.ts`,
`services/dataService/public-talent-service.ts`,
`utils/public-talent-constants.ts`, `styles/public-talent.css`, and three pages
under `pages/public/`.

---

## 4. The three decisions worth reviewing

**The privacy boundary is one file, not a permissions matrix.**
`TalentReelPublication` and `StudentProfile` stay closed to every audience. The
public endpoints read with the master key and hand rows to builders that copy
out named fields. Relaxing the CLP instead would have opened both classes to
authenticated clients too — a much larger hole than the one being filled.

**A public read never touches `TaskSubmission`.** Everything a public page needs
was snapshotted onto the publication at publication time, so there is no
`include` that could carry the private Drive link and the note to staff out with
it. A test asserts the repository never names that class.

**The only thing that survives from a pasted video URL is eleven characters.**
Validation accepts four YouTube shapes (`watch`, `youtu.be`, `shorts`, `embed`
— widened from three by CP8B), extracts the id, and discards the rest. The watch URL is rebuilt from the id; the embed is built from the id
server-side; both browser components re-check the id shape before calling
`bypassSecurityTrustResourceUrl`. A test asserts no module concatenates onto
`embed/`.

---

## 5. One real gap runtime validation found

`evaluateEligibility` requires the Final Task to be published — but publication
is otherwise re-decided only when a Student **submits**, and a Student cannot
submit to a Task that was just closed. So closing a Final Task left its Reels on
the internet while the checker said they should be gone: the rule was true in
the code and false in the database.

`reevaluateTaskPublications` now sweeps a Final Task's publications when its
status changes. It refuses to override an Admin suppression, and it never throws
into the caller — an Admin closing a Task should not fail because a Reel could
not be updated. Three regression tests pin all three properties.

---

## 6. Tests

| Suite | Command | Count |
|---|---|---|
| Backend | `cd backend && pnpm run test` | **1375 pass, 0 fail** |
| Frontend | `cd frontend && pnpm run test` | **844 pass, 0 fail** (flaky under load — see §9) |
| Runtime | isolated server, no session | **122 checks, 0 fail** |
| Browser | headless Chrome, 5 screenshots | **36 checks, 0 findings** |

New: `backend/test/publicTalent.test.ts` (52 tests — endpoint shape, DTO
privacy, the demo validator against every named provider, the publication
lifecycle, the slug, pagination clamping, the photo route, the stylesheet), plus
three frontend specs covering the directory, the profile, and the reel.

Two existing guards were updated rather than worked around:
`app.branding.spec.ts` (the route surface, which correctly caught three new
routes) and `templatePreservation.test.ts` (the page allow-list). The
forbidden-name list was narrowed rather than emptied — `pinned`, `bookmark`,
`favourite`, and `moderation` are still features that do not exist.

---

## 7. Runtime validation — 89 checks, all green

Against a running server on an isolated database, driving the public endpoints
**with no session at all**:

- The two consented Students appear; the one who withheld consent does not.
- Every filter narrows server-side; a technology nobody has returns an empty
  page rather than everything; `limit=100000` is answered with one page.
- The profile carries no email, phone, date of birth, private reason, ACL,
  `objectId`, `__type`, storage key, Drive link, or note to staff.
- The embed URL equals `https://www.youtube.com/embed/{storedId}`.
- Withdrawing consent removes the directory entry, the profile, the photo, and
  the reel item. Restoring it returns them **at the same slug**.
- Closing the Final Task withdraws the publication.
- Drive, Vimeo, Loom, and TikTok are each refused; a canonical watch URL with
  tracking parameters is accepted and stored rebuilt without them.

This run predates the CP8B changes — see §13 for what has not been re-run.

---

## 8. Visual validation — 246 checks, 42 screenshots

Three public pages × EN/AR × 1440/390/360 × light/dark, in headless Chrome, with
local storage cleared each time so every page was rendered **as a Visitor**.

Verified: no horizontal overflow, nothing clipped, correct direction in both
languages, everything translated, no console errors, no session in storage, and
— the behavioural one — **exactly one iframe** on the reel at any moment,
including after scrolling to the next panel, and none at all before somebody
presses play.

**Two real defects found and fixed:**

1. The page headings used `cyf-heading-lg`, which is not defined anywhere in the
   project — the `h1` rendered at body size. Now `cyf-page-title`, the class the
   rest of the application actually uses.
2. Two touch targets measured under 24px at 390px: the demo checkbox (20×20) and
   the breadcrumb link (92×19). Both sized in pixels rather than rem, because
   this application's root font size is 14px and a fingertip does not scale with
   the type ramp. Guarded by tests.

A third finding — a uniform 1.49:1 contrast reading — was traced to the
measurement harness, not the pages: these routes have no shell, so `body` has no
explicit background and the harness parsed `rgba(0,0,0,0)` as black. The
screenshots show correct contrast in both themes.

---

## 9. Remaining limitations

- **Several frontend specs are flaky under full-suite parallelism.** The set
  varies run to run — across three runs this session it was
  `invitation-card` + `student-batch-resources`, then
  `profile-catalogs` + `slide-builder` + `join`, then `auth-routing`. Every one
  fails with *"Test timed out in 5000ms"*, never an assertion, and every one
  passes in isolation (46/46, 15/15, 8/8 respectively). Pre-existing and
  documented in the CP7 handoff; none of these files was touched.
- **One genuine test defect was found and fixed** — `batchSurface.test.ts` built
  its "near miss" invitation hash by overwriting the first character with a fixed
  value, which reproduces the hash itself one run in sixteen. It had been read as
  a flaky constant-time comparison. The replacement is now derived from the hash.
- The initial bundle exceeds its 500 kB budget by ~268 kB (pre-existing).
- Filter options are built from the most recent 500 published rows. At a larger
  corpus the option lists would reflect a recent slice rather than everything,
  which is the right thing to lose on an unauthenticated endpoint.
- The public photo is served with `public, max-age=300`. Withdrawal is bounded
  by the route re-checking publication on every request, but a CDN sitting in
  front would hold a withdrawn photo for up to five minutes.

---

## 10. Files

**Added (13):** `modules/PublicTalent/{constants,dto,repository,functions,photoRoute}.ts`;
`test/publicTalent.test.ts`; `models/PublicTalent.ts`;
`services/dataService/public-talent-service.ts`; `utils/public-talent-constants.ts`;
`styles/public-talent.css`; `pages/public/{public-students,public-student-profile,talent-reel}.component.{ts,html,spec.ts}`.

**Modified (26):** three CP7 backend models and five `BatchTask` modules,
`app.ts`, `redact.ts`, two backend test guards, `app.routes.ts`,
`app.branding.spec.ts`, the Student Tasks component and template,
`models/BatchTask.ts`, `utils/task-constants.ts`, `styles.css`, both i18n files,
and six documentation files.

**Deleted:** none.

---

## 12. What Checkpoint 8B changed

CP8B refines CP8; both are in this uncommitted tree.

**One gap closed that CP8 had left open.** Visibility depends on five inputs,
and only three had something watching them. Deleting a submission and saving a
profile now recompute publication too — a Student who empties their profile
would otherwise have stayed public while the rule said they should not. Same
shape as the closed-Task gap in §5, found the same way.

**Profile completeness became a visibility condition**, as CP8B specifies.

**The video validator widened** from three shapes to four (`watch`, `youtu.be`,
`shorts`, `embed`). CP8 rejected the last two deliberately; CP8B names them.
This does not widen the output surface: only the id survives, and every embed is
still rebuilt from it.

**The public surface moved to `/talent/*`** — `listTalentDiscovery`,
`getTalentProfile`, `listTalentReels`, `getTalentFilters`, and
`/talent/photo/:slug`.

**Discovery gained a debounced name search** (350ms in the browser, 60 chars and
regex-escaped on the server) **and a newest/oldest sort**. Both live in the URL.

**The public profile gained an education block**, which is a deliberate widening
of the public surface: `institution` and `major` came off the forbidden-key
list. `customInstitutionName` and `expectedGraduationDate` stayed on it.

### What CP8B asked for that this product does not store

Country, Languages, Experience, Certificates, and Resume are not fields on
`StudentProfile`. The public profile renders what exists — City, Education
status, Institution, Major, About, Target role, Technologies, Projects, and the
three links — and omits the rest rather than showing empty sections. Adding them
means extending the CP3A profile form, catalogs, validation, DTOs, i18n, and
tests, which CP8B otherwise instructs against. **Confirmed with the product
owner before building.**

---

## 13. The validation that did not run

**Runtime validation of the CP8B triggers was not completed.** The local
MongoDB service stopped part-way through this session and starting it requires
administrator rights this environment does not have:

```
$ net start MongoDB
System error 5 has occurred. Access is denied.
```

The harness is written and updated for the new surface
(`scratchpad/cp8_runtime.mjs`); it needs a running database and one command.
CP8's 89 checks passed earlier in the session against the pre-8B code, so the
endpoints and the withdrawal cycle are known good — but the four things CP8B
added have **only unit coverage**, not end-to-end:

- profile completeness gating visibility
- the profile-save and submission-delete sweeps
- name search and sort over real HTTP
- `shorts` and `embed` URLs accepted end-to-end

The browser pass was likewise not re-run after the CP8B UI changes (search box,
sort control, reel identity strip, education block). CP8's 246 checks and 42
screenshots covered the pages as they stood before those additions.

---

## 14. What Checkpoint 8C changed

Two corrections, both on top of CP8B and both in this same uncommitted tree.

### Public visibility no longer flickers while a profile is edited

CP8B made profile completeness a visibility condition and read it as
`isComplete` — the profile's state **right now**. It also added a sweep that
recomputed publication on every profile save. Together those meant a Student
clearing one field to retype it was withdrawn from the public pages, and
reinstated when they finished. Nobody decided anything; the pages just moved.

The suites did not catch it because they asserted the checker, and the checker
did exactly what it was told — the same shape as the CP7 and CP8 gaps.

Publication now reads `StudentProfile.profileEverComplete`, a latch set in
`onBeforeSave` the first time the profile is genuinely complete and never
cleared; a test counts every write to it and requires the only value written to
be `true`. `reevaluateProfilePublications` lost its unpublish branch outright, so
saving a profile can only publish. Withdrawal is left to the four paths where
somebody actually decided: consent, the Final Task's status, an Admin
suppression, and deleting the submission — each still covered by a test.

Live profile fields (name, city, target role, About, links) still reach the
public profile immediately; only the *project* is snapshotted, which was CP7's
deliberate consent boundary.

### Pinned Students

`pinned` and `pinnedAt` on `TalentReelPublication`, `pinTalentReel` /
`unpinTalentReel` for Admins, and two buttons beside Unpublish and Publish Again
in the panel that already existed. No new page, route, class, or approval step.

Three decisions worth reviewing:

**The pin is on the publication, not the profile.** A pin is a fact about a
published piece of work. On the profile it would outlive what it points at, and
every path that unpublishes would have to remember to clear it. On the
publication, `onBeforeSave` clears it whenever the row stops being published.

**The sort orders on `pinnedAt`, not on `pinned`.** MongoDB ranks a missing field
below a Boolean, so descending on `pinned` gives three groups — pinned,
explicitly-unpinned, never-pinned — and newest-first would then hold only within
each. Somebody once pinned would sit above a newer publication forever, which is
an unpin that does not undo itself. `pinnedAt` is set and unset with the Boolean
and a missing Date is one group. Index: `['status', 'pinnedAt', 'publishedAt']`.

**Pinning refuses rather than publishing.** A Student who is not currently public
cannot be pinned; the alternative — accepting the pin quietly — is a control that
looks like it worked and changed nothing a Visitor can see. Unpinning is always
allowed so a stale pin can be cleared.

Only one Boolean crosses the public boundary. `pinnedAt` is on
`FORBIDDEN_PUBLIC_KEYS`, and `talentReelPinned` is on `AdminSubmissionDto` only —
never on the DTO a Student reads about their own work.

### Tests added

Backend: 17 new assertions across the latch, the one-way sweep, the pin's
placement, its refusal, the model invariant, the DTO boundary, and the index.
Frontend: a new `task-submissions.component.spec.ts` covering the Admin control
(5 tests, including "no pin offered for an unpublished Reel"), plus Featured-chip
and server-order assertions on both public pages.

### Runtime validation — 122 checks, all green, and one real bug

§13's MongoDB blocker was cleared: the Windows service still refuses to start
without administrator rights, but `mongod` runs perfectly well as an ordinary
process on a scratch dbpath and a spare port. That closes the gap CP8B left
open — CP8's endpoints, CP8B's triggers, and CP8C's behaviour are now all
validated end-to-end, unauthenticated, against a running server.

**The bug it found.** `setPinned` was a private method called as
`this.setPinned(...)`. The kit invokes a registered cloud function unbound, so
`this` is undefined inside one: both Admin pin controls threw
`Cannot read properties of undefined` on the first real request, while 1374
green tests said the feature worked. Source-reading tests could not see it,
because the code they were reading was correct — it was simply unreachable. It is
now a module-level function, with a test that strips comments and forbids `this.`
anywhere in the module.

**What the 122 checks cover.** A momentarily incomplete profile stays in the
directory and keeps its public page; the latch survives that save; a live profile
edit reaches the public page with nothing republished; a profile that was never
complete does not publish. Pinning puts somebody first in both Discovery and the
Reel and still outranks an oldest-first sort; it adds nobody to the list; exactly
one card is marked; `pinnedAt` never appears in a response; a Student and a
Visitor are both refused; pinning somebody not public is refused and publishes
nobody; unpinning restores the original order exactly; withdrawing a publication
clears both the pin and the sort key; and republishing does not silently restore
it.

**Two harness defects, both producing false green**, are recorded in
`docs/CURRENT_STATE.md` §7r — a blanket rename that rewrote property accesses so
three checks read non-existent fields, and a liveness check that wrote a raw
string into a catalog pointer.

### Browser validation — 36 checks, 5 screenshots, no findings

Run against the same isolated backend with a Student genuinely pinned over HTTP,
in headless Chrome, with local storage cleared before each combination so every
page rendered as a Visitor: `/students` at EN/AR × 1440/390 × light/dark, and
`/talent-reel` at 390 dark.

Confirmed in the page, not just in a screenshot: the pinned Student is **first**
in every combination; exactly **one** card carries the Featured chip; the chip
has real width and height; the label is translated (`Featured` / `مميّز`);
direction is correct in both languages; no horizontal overflow at any width; no
session in storage; and the reel still mounts **zero** iframes before anybody
presses play, with the pinned item first and marked.

Two harness problems were fixed along the way and are worth knowing about for the
next pass: this application routes on the **hash**, so `Page.navigate` to
`/students` silently lands on the Admin sign-in page; and its dev CORS allow-list
names port **4200** exactly, so a dev server on 4201 fails every API call and the
page renders its error state rather than anything worth looking at.

One thing that looks like a defect in the screenshots is not: the pinned
Student's avatar is blank because the fixture stores a 17-character fake WebP,
which the browser cannot decode. The route itself answers `200 image/webp`.

### Still not validated

Nothing outstanding for CP8C. The pre-existing item from §11 stands: scroll-snap
on a real phone is the one thing headless Chrome models imperfectly.

## 11. Recommended next action

1. **Confirm the publication-trigger reading in §2** before committing.
2. Note that the MongoDB blocker recorded in §13 is **resolved**: the Windows
   service still needs administrator rights, but `mongod --dbpath <scratch>
   --port 27018` runs as an ordinary process and is all either harness needs.
   Both passes have now run (§14).
3. Run the browser pass over `/talent-reel` on a real phone — scroll-snap is the
   one thing headless Chrome models imperfectly.
4. Decide whether Country, Languages, Experience, Certificates, and Resume are
   wanted (§12). They are a CP3A profile change, not a public-pages change.
