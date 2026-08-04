# Handoff — Checkpoint 7 (Batch Tasks, Student Submissions, and Talent Reel Publication Records)

**Checkpoint:** 7 — Batch Tasks, Student Submissions, and Talent Reel Publication Records
**Date:** 2026-08-04 (closeout)
**Branch:** `master` (never left)
**Baseline commit:** `9515542` — *feat: add syrian phone number and improve UI*
**Ready for review:** **Yes.** Both original validation gaps are closed;
what remains unverified is listed in §7a.

An Admin sets Assignments and one Final Task per Batch, deciding for each which
of five fields it collects and whether each is optional or required. Students
save drafts and submit. An eligible Final Task submitted with the Student's own
consent publishes a Talent Reel record automatically.

Nothing was committed, staged, or pushed. Nothing was reset, cleaned, stashed,
restored, or discarded. No branch was created, switched, renamed, merged, or
deleted. `.env`, `backend/dashboard.json`, `docs/prototypes/**`, `CLAUDE.md`,
`.claude/**`, and `node_modules` were not touched.

Earlier handoffs are preserved in history: Checkpoint 6 at `d3b80fd`, 5 at
`c4166e9`, 4 at `673f898`, 3A at `70735bc`, 2B at `79fea2b`.

---

## 1. Initial state

```
$ git branch --show-current    master
$ git log --oneline -1
9515542 feat: add syrian phone number and improve UI
```

Checkpoint 6 and the Complete Profile layout fix were committed before this work
began. The tree was clean.

---

## 2. The three guarantees, and why they are indexes

The product says three things that are only true if two simultaneous requests
cannot both succeed:

| Guarantee | Index | Column |
|---|---|---|
| A Batch holds at most one Final Task | `batch_task_final_per_batch_unique` | `_p_finalForBatch` |
| One Submission per Task per Student | `task_submission_unique` | `_p_task, _p_student` |
| One publication per Submission | `talent_reel_submission_unique` | `_p_submission` |

None of them is a query-then-create check, because a check loses a race and the
losing write is not even an error — it is a second row nobody notices until
something reads "the" one and gets an arbitrary answer.

`_p_finalForBatch`, not `finalForBatch`: a Parse Pointer occupies the `_p_`
column in MongoDB, and an index on the logical name builds cleanly against a
column that does not exist. That is the fourth time this repository has needed
the sentinel-pointer pattern; it is now written down in
`docs/TEMPLATE_ARCHITECTURE.md` §20.

The conflict is reported **before** and enforced **after**: `createTask` maps the
driver's duplicate-key error to `FINAL_TASK_ALREADY_EXISTS`, so the loser of a
race gets a stable code rather than a raw driver message — but the index is what
makes the outcome true.

---

## 3. Defects found during implementation

### An IPv4-mapped IPv6 address slipped through the SSRF guard

`isPrivateIpv6` matched `::ffff:127.0.0.1` with a dotted-quad regex. The WHATWG
URL parser normalises that host to `::ffff:7f00:1`, so the regex matched **no**
mapped address arriving through a URL — which is all of them.
`https://[::ffff:10.0.0.1]/` would have been accepted as a live demo URL.

Found while writing `backend/test/batchTaskValidation.test.ts`, by checking what
the parser actually does before writing the assertion rather than assuming it.
`isPrivateIpv6` now handles the hex form, and the test covers both spellings plus
a mapped **public** address, so the fix is not "refuse anything mapped".

### Two submission fields were not recognised as sensitive

`technologies` and `publicConsent` passed `isSensitiveKey` unmasked.
`technologies` appears nowhere outside CP7, so masking it globally costs nothing;
whether somebody agreed to be published is a decision about them, not a detail of
the request that carried it. Both are now in `redact.ts`, and the comment that
justified excluding `technologies` was corrected rather than left standing.

---

## 4. What was changed outside the new files

| File | Change |
|---|---|
| `backend/src/app.ts` | Mounts `taskAttachmentRouter()` after `batchResourceRouter()` |
| `backend/src/cloudCode/models/StudentProfile.ts` | `publicProfileSlug` field, both `protectedFields` audiences, a unique partial index, and a trigger that refuses to change it once issued |
| `backend/src/cloudCode/utils/logging/redact.ts` | 13 sensitive key fragments and 22 omitted payload subjects |
| `backend/test/startupIndexes.test.ts` | Now loads **all 15** models and asserts the 15 unique indexes **by name** |
| `backend/test/schemaAccess.test.ts` | Sixteen approved classes; the three new ones in the deny-by-default loop |
| `backend/test/studentProfileSurface.test.ts` | `publicProfileSlug` in the field surface |
| `backend/test/templatePreservation.test.ts` | CP7 pages allow-listed; the forbidden-name list narrowed to what is still unbuilt |
| `frontend/src/app/pages/admin/batch-detail.component.*` | A sixth tab |
| `frontend/src/app/pages/student/student-batch-detail.component.*` | A fourth tab |
| `frontend/src/app/pages/admin/student-detail.component.*` | A read-only Tasks and submissions section |
| `frontend/src/styles.css` | Imports `styles/tasks.css` |
| `frontend/public/i18n/{en,ar}.json` | 866 keys, exact parity |

`startupIndexes.test.ts` deserves a note. It asserted `unique.length === 7` and
had been loading only 7 of 15 models since CP5 — passing while checking a subset.
Rather than bump the number, the test now loads every model and asserts names.

`templatePreservation.test.ts` did its job: it failed when the CP7 pages appeared
and had to be told, explicitly, that Tasks are now real. The forbidden-name list
was narrowed rather than emptied — `pinned`, `public-profile`, `talent-reels`,
and `showcase` are still features that do not exist.

---

## 5. Tests

| Suite | Command | Count |
|---|---|---|
| Backend | `cd backend && pnpm run test` | **1295 pass, 0 fail** |
| Frontend | `cd frontend && pnpm run test` | **794 pass, 0 fail** |
| Backend compile | `cd backend && pnpm run compile` | clean |
| Frontend types | `pnpm exec tsc --noEmit -p tsconfig.app.json` | clean |
| Frontend build | `cd frontend && pnpm run build` | succeeds; only the pre-existing bundle-budget warning |

New backend files: `batchTaskValidation.test.ts` (the closed vocabularies, the
full URL matrix, the deadline boundary at −1 ms, exactly on it, and +1 ms, the
requirements allow-list, technology normalisation), `batchTaskSurface.test.ts`
(the registered operations, deny-by-default CLP, the five physical indexes, the
three triggers exercised directly, the DTOs, the logging allow-list, a
backend↔frontend constants parity check, and a source scan asserting no module
fetches anything or serves a brief inline), and `batchTaskRedaction.test.ts`
(real Parse log lines carrying a whole submission).

New frontend files: `task-error.spec.ts` and `student-tasks.component.spec.ts`.

The closeout added regression tests for all six defects in §7 — including
source scans asserting that no model reads the pre-save state through a
method that does not exist, that no module reads a Student name off the user
object, that the roster resolves profiles in one query rather than one per
row, and that the two stylesheet rules a screenshot caught stay fixed.

Two test-authoring notes worth keeping:

- `new Parse.Object()` + `.set()` marks **every** field dirty, so a trigger that
  reports the first changed field reports whichever the fixture set first. A test
  for "changing the student is refused" would pass while the code checked nothing
  of the sort. `Parse.Object.fromJSON` builds the row in its saved state instead,
  and a companion test asserts an untouched row still saves — so the freeze is
  shown to catch a changed pointer rather than to refuse every update.
- A one-way `[ngModel]` binding writes to the DOM in a **microtask**, not during
  the `detectChanges()` that set it. Four component tests read the DOM one beat
  early and saw empty, enabled controls — which looks exactly like a broken
  component. The specs now await it.

---

## 6. Runtime validation — 27 checks, all green

Against a **running server on an isolated database** (`cyf_cp7_runtime`, dropped
afterwards; `.env` untouched, overrides passed in the environment).

Fifteen checks read `db.collection(...).indexes()` straight out of MongoDB and
confirmed every unique index was actually **built**, with the right key columns
and a partial filter. A declared index and a built index are different facts, and
only one of them stops a duplicate row.

The rest drove real HTTP:

- Three simultaneous `createBatchTask` calls for a Final Task → **exactly one**
  succeeded, two returned `FINAL_TASK_ALREADY_EXISTS`, and exactly one row
  existed in the database. A fourth sequential attempt was refused too.
- A Task with a past deadline stayed `PUBLISHED` and reported
  `availabilityReason: 'DEADLINE_PASSED'` with `isSubmissionOpen: false`.
- The Task DTO carried no `attachmentStorageKey`, no `finalForBatch`, no `ACL`.
- An invented Task type was refused; an unauthenticated caller got nothing.
- The real server log was audited: 93 lines mentioning CP7 operations, and
  **zero** occurrences of any Task title, description, URL, storage key, or
  consent value. A representative line:

  ```
  [info] Task created {"op":"createBatchTask","stage":"persist","ok":true,
                       "userId":"…","batchId":"…","taskId":"…","taskType":"FINAL_TASK"}
  ```

No process was left running; port 1339 is free and the isolated database is gone.

---

## 7. The two validation gaps, now closed

The checkpoint originally shipped with two gaps stated here: no Student path had
been driven over authenticated HTTP, and nobody had looked at the Tasks tabs in
a browser. Both are closed. Between them they found **six real defects**, every
one of which had passed 1282 backend and 793 frontend tests.

### The Student test-session strategy, and why production is untouched

Students have no usable password; production mints their session with
`Parse.User.loginAs` under the master key after Google verifies them. Neither
route is open to a test process — `restrictRoutes` blocks `/users`, `/classes`,
`/loginAs`, and `/schemas`, and its master-key bypass only fires for a key in a
JSON body. So the harness uses the sanctioned fallback: **direct setup of the
isolated test database**, writing the same rows Parse Server writes, with the
`_Session` shape read back from a session the running server had just created.

- No password login was enabled. The fixture `_User` carries a hash no password
  produces, which is the state a real provisioned Student is left in.
- No Google call. The verifier is never reached.
- No production bypass, flag, environment switch, or session-minting endpoint.
- The master key stayed in the harness. Angular never saw it.
- The `_Session` row is ordinary: it expires, it is revocable, `logout` kills it.

Every assertion then went through the **real production routes** carrying
nothing but `X-Parse-Session-Token`. The database was read directly only to
verify what those routes had done.

### Student HTTP — 83 checks, all green

Visibility (Draft Tasks invisible, and invisible by id too), detail, private
attachment download with byte-for-byte comparison, the full draft → submit →
edit → back-to-draft → resubmit lifecycle with a row count proving no second
`TaskSubmission` was ever created, a server-generated `submittedAt` and a
refused client-supplied one, cross-Batch and cross-Student denial, five
privileged parameters refused individually, all four state gates (deadline,
Closed, completed Batch, archived Batch), delete rules both ways, the Final Task
publication matrix including consent withdrawal and Admin suppression surviving
a resubmit, attachment authorisation for enrolled/other/visitor, the raw
`/files` route still blocked, and GridFS left with no orphan.

Every response was scanned for `ACL`, raw pointers, `storageKey`,
`adminSuppressed`, another Student's identity, and raw Parse or driver errors.
None appeared.

### Real-log privacy — clean

17 assertions against the log the run actually produced: no GitHub, demo, Drive,
or YouTube value, no note, description, contribution, technologies, or consent,
no filename, storage key, attachment bytes, submission body, session token, or
master key. Useful operational lines survive, e.g.
`{"op":"submitMyTask","stage":"submit","ok":true,"userId":"…","taskId":"…","submissionId":"…","status":"SUBMITTED"}`.

### Browser pass — 66 screenshots, 296 measured checks

The real Angular dev server against the isolated backend on the port the dev
environment already points at, so **no frontend configuration was touched**.
Six combinations: EN/AR at 1440 light, EN/AR at 390 light, EN/AR at 360 dark.
Admin: task list, create form, all five requirement selectors, the DatePicker
overlay, submissions view, read-only submission dialog, empty state, and Student
Detail history. Student: task list, Draft invisibility, task detail, attachment,
required/optional markers, the Final Task with its public fields, technology
chips, consent, and the deadline-passed state.

Result: **zero horizontal overflow, zero clipped text, zero dialogs outside the
viewport, zero untranslated keys, zero console errors, and correct `dir` in all
six.** Arabic is a true mirror — sidebar, tabs, chips, and action order all flip.

### The six defects

| # | Defect | Root cause |
|---|---|---|
| 1 | Discard draft failed every time | Browser sent `submissionId`; server takes `taskId` |
| 2 | No public slug was ever minted | Trigger called a client-SDK method absent on a trigger object; a cast hid it |
| 3 | No publication could ever be updated | `dirty('submission')` fires on an identical re-set |
| 4 | Blank Student names in the status table | Name read from two user fields this product never populates |
| 5 | `profileComplete` always `true` | Hardcoded |
| 6 | 180px dead space in every mobile card | `flex-basis` sizes height once the container is a column |

A seventh, smaller: the technology remove control measured 18×18. Two `rem`
attempts landed at 21px, because this app's root font size is 14px. It is now
stated in pixels.

Each has a regression test, including source scans asserting no model reads the
pre-save state through a non-existent method and no module reads a name off the
user object.

### A seventh defect, found in a real log after the closeout

The Admin pressed Publish on a Batch that was not active. The server refused
with `BATCH_NOT_ACTIVE` — and the browser **signed them out**.

`http.interceptor.ts` cleared the session on Parse code 142. That code is
`VALIDATION_ERROR`, which this application uses for two unrelated things: the
kit's "please log in" when no session was sent, and *every* product-rule
refusal. So being told "no" logged you out, and the next request went out with
no session at all — which is exactly what the log showed, three lines later.

This was pre-existing and affects every feature, not only Tasks; CP7 simply
made it easy to reach, because CP7 refuses things for two dozen stated reasons.
The interceptor now reads the message as well as the code: a stable
SCREAMING_SNAKE refusal is not a sign-out, 209 always is, and the kit's prose
142 still is. `http.interceptor.spec.ts` is new and pins all of it.

Two notes on that spec. Its first version passed three tests **vacuously** — the
interceptor injects `ToastService`, which the TestBed did not provide, so every
request threw before being forwarded, and "the session was preserved" was true
because nothing happened at all. The header assertions are what exposed it, and
they are kept for that reason.

The same log also showed the UI offering a Publish button the server would
always refuse. `listBatchTasks` already returns `canPublish`; the template now
honours it.

**Still open for a decision:** `setBatchTaskStatus` requires an active Batch for
*any* publish, but the approved CP7 lifecycle attaches that condition only to
`CLOSED → PUBLISHED`. A Draft Batch can hold prepared Tasks safely — a published
Task there already reports `BATCH_NOT_ACTIVE` and refuses submissions through
the derived availability — so the stricter rule may be an unintended deviation
rather than the intent. Left as-is because relaxing it is a product decision,
not a defect fix.

---

## 7a. What is still not verified

**The `×` sizing fix and the name fix were not re-confirmed in a browser.**
MongoDB stopped partway through the closeout and could not be restarted without
elevation, so the final visual re-run and a re-run of the HTTP harness against
the fixed backend were both impossible. What stands behind them instead:

- The name/`profileComplete` fix is covered by four backend tests, and the
  batched lookup by a test asserting no per-row query inside the roster loop.
- The `×` fix is covered by a test asserting `flex: none` and a 24px minimum in
  the stylesheet, and the sizing arithmetic was measured live (root font size
  14px) rather than assumed.
- The 83 Student HTTP checks were run against the code **before** defects 4 and
  5 were fixed; those two are backend-only and covered by the suite, but the
  end-to-end run has not been repeated since.

**Recommended before commit:** start MongoDB, re-run
`cp7_student_http.mjs` and the visual pass, and drop the leftover isolated
database `cyf_cp7_visual` (it holds only fabricated fixture data and is not
tracked by git; `cyf_cp7_runtime` was already dropped).

**The frontend suite is flaky under parallel load.** Different specs time out on
different runs — `batch-resources`, `batches`, `invitation-card`,
`student-batch-resources` — always a 5s/10s timeout, never an assertion failure,
and each passes in isolation. Pre-existing and unrelated to CP7; the clean
794/794 run was on an idle machine.

## 8. Files

**New backend (18):**
`models/{BatchTask,TaskSubmission,TalentReelPublication}.ts`;
`modules/BatchTask/{constants,errors,urls,availability,validation,dto,logging,access,repository,publication,storage,adminFunctions,studentFunctions,reelFunctions,attachmentRoute}.ts`.

**New backend tests (3):**
`test/batchTask{Validation,Surface,Redaction}.test.ts`.

**New frontend (14):**
`models/BatchTask.ts`; `utils/{task-constants,task-error}.ts`;
`services/dataService/task-service.ts`;
`pages/admin/{batch-tasks,task-submissions,student-task-history}.component.{ts,html}`;
`pages/student/student-tasks.component.{ts,html}`; `styles/tasks.css`;
`utils/task-error.spec.ts`; `pages/student/student-tasks.component.spec.ts`.

---

## 9. Git verification

```
$ git branch --show-current    master
$ git log --oneline -1
9515542 feat: add syrian phone number and improve UI
$ git status --short | wc -l
43
```

HEAD is unchanged. Nothing staged, nothing committed, nothing pushed.

---

## 10. Recommended next action

1. **Restart MongoDB and re-run the two harnesses** (§7a) — the Student HTTP
   pass against the fixed backend, and one browser pass to confirm the last two
   fixes render. Then drop the leftover `cyf_cp7_visual` database.
2. **Upload one brief of each accepted type by hand** and confirm the `.html`
   downloads rather than renders. That is the one behaviour where a browser's own
   opinion is what matters.
3. **Add a deployment-time index check.** Fifteen unique indexes now exist and
   five of them are the sole enforcement of a concurrency invariant. Both the
   test suite and the CP7 runtime run verify them, and neither runs in
   production.
4. **Checkpoint 8 is the public side** — the browsable Talent Reel list and the
   public student profile page. `publicProfileSlug` is the seam they attach to,
   and it is already minted, unique, and immutable.
