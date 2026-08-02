# Code Your Future — Product Requirements

**Status:** Authoritative product behaviour document. Nothing in this file is implemented yet
(see [CURRENT_STATE.md](CURRENT_STATE.md)).

> **Authority rule.** Source-code implementation must follow this document when a prototype
> conflicts with it. The prototypes in `docs/prototypes/` are visual and workflow references
> only — they are not requirements, and they contain rejected ideas (see
> [Prototype conflicts](#14-prototype-conflicts)).

---

## 1. Scope and terminology

Code Your Future is a Batch-based training platform. Admins run Batches; Students join a Batch
by invitation, complete tasks, and may have accepted Final Task videos published publicly.

| Term | Meaning |
|---|---|
| **Batch** | The only organisational container. A cohort with a lifecycle. |
| **Admin** | Authenticated staff role. Password login. |
| **Student** | Authenticated learner role. Google OAuth only. |
| **Visitor** | Unauthenticated user. Sees sanitised public data only. |
| **StudentProfile** | Exactly one profile record per Student. |
| **Invitation** | One current general token per Batch, used only to join that Batch. |
| **Enrollment** | The link between a Student and a Batch. |
| **Resource** | A private PDF inside a Batch. |
| **Live Slides** | Admin-controlled in-session slides for a Batch. |
| **Task** | An Assignment or a Final Task inside a Batch. |
| **Talent Reels** | The public gallery of accepted Final Task videos. |

Batch hierarchy:

```
Code Your Future
└── Batches
    ├── Overview
    ├── Students
    ├── Resources
    ├── Live Slides
    ├── Tasks
    └── Pinned Students
```

**MUST NOT** introduce `Program` as a model, route, DTO, page, or navigation term. Use only
*Batch* / *Batches*.

## 2. Roles

Authenticated roles are exactly **Admin** and **Student**. Unauthenticated users are **Visitors**.

**MUST NOT** introduce: SuperAdmin, Employee, Company, Trainer, Teacher, Moderator, Recruiter.
(The template currently ships `SuperAdmin` and `Employee` — renaming is Checkpoint 1 work, not
a Phase 0 change.)

There is no public email/password signup, no manual Student creation, no manual Student role
assignment, and no Student Excel import.

## 3. Access matrix

| Capability | Visitor | Student | Admin |
|---|---|---|---|
| Talent Reels (sanitised public DTOs) | Read | Read | Read |
| Admin password login | — | — | Yes |
| Google sign-in | Yes (to become a Student) | — | — |
| Own StudentProfile | — | Read / Write | Read |
| Other Students' profiles | — | No | Read |
| Batch list / metadata | No | Enrolled Batches only | All |
| Batch create / edit / status transition | No | No | Yes |
| Invitation token inspect (`/join/:token`) | Safe pre-check only | Safe pre-check only | Yes |
| Invitation generate / rotate / expire / revoke | No | No | Yes |
| Enroll into a Batch | No (must sign in) | Yes, with a valid invitation | No (cannot enroll others) |
| Resources | No | Read-only, enrolled Batch only | Manage (except Archived) |
| Live Slides | No | Participate, enrolled Batch only | Control |
| Tasks | No | Read + submit, enrolled Batch only | Create / manage |
| Own submissions | No | Read / create (one only) | Read |
| Accept a Final Task for publication | No | No | Yes |
| Pinned Students | No | No | Yes |

## 4. Authentication

### Admin
- Password-based login.
- Session restoration on reload.
- Protected Admin routes.
- Logout invalidates the server-side session.

### Student
- **OAuth only. Google first.** Apple may be added later.
- No Student password login, password reset, or password change.
- A Student may sign in, complete their profile, and use the Student dashboard **without an
  invitation**. An invitation is required only to join a Batch.

Approved copy (must be used verbatim):

- **EN:** "You can sign in and complete your profile now. An invitation is required only to join a batch."
- **AR:** "يمكنك تسجيل الدخول وإكمال ملفك الشخصي الآن. ستحتاج إلى دعوة فقط للانضمام إلى دفعة."

## 5. Student Profile

Exactly one `StudentProfile` per Student.

**Required:** `fullName`, verified read-only `email`, `phone`, `city`, `institution`, `major`,
`educationStatus`.

**Optional:** `photo`, `dateOfBirth`, `careerGoal`, `targetRole`, `targetRoleReason`, GitHub URL,
LinkedIn URL, Portfolio URL.

### Catalog selections ⟨CP3A⟩

Four fields are **selections from an Admin-managed catalog**, never free text and never a
hard-coded list. Resolves OQ-2 and OQ-3.

| Field | Required | Catalog category |
|---|---|---|
| `city` | Yes | `CITY` |
| `institution` | Yes | `INSTITUTION` |
| `major` | Yes | `MAJOR` |
| `targetRole` | **No** | `TARGET_ROLE` |

- Each is a **searchable Select** in the UI. There is no free-text fallback for any of them.
- The request carries an **id**; the backend resolves the authoritative item and stores a pointer.
  A name sent by a client is refused, never stored.
- The catalog is closed to exactly these four categories. It is **not** a settings store and holds
  no configuration or secret.
- An Admin may **deactivate** an item: it stays valid on the profiles that already reference it and
  stops being offered to anybody new. An item any profile references **cannot be deleted**.
- Cities, majors, and target roles ship **empty**. Only the institution list is seeded, from the
  list Checkpoint 3A already carried.

### Target role and its reason ⟨CP3A⟩
- `targetRole` is optional.
- `targetRoleReason` answers, in these exact words:
  - English — **Why did you choose this role?**
  - Arabic — **لماذا اخترت هذا الدور؟**
- Optional, **maximum 500 characters**, shown only when a target role is selected, and **cleared**
  when the role is cleared.
- **Neither affects profile completion.** Neither is an evaluation: nothing scores or ranks either.
- `careerGoal` is unchanged and independent.

### Education
- Exactly **one** education record.
- Institution comes from the `INSTITUTION` catalog, which includes an **Other** item (`isOther`).
- **Other** requires a custom institution name.
- `educationStatus` ∈ { `Current Student`, `Graduate` }.

### Dates ⟨CP3A⟩
Both date fields use a **polished DatePicker**, never a browser-native date input.

- **`dateOfBirth`** — optional, full date, no future date selectable, clearable, with year
  navigation so a birth year is reachable without paging through months.
- **`expectedGraduationDate`** — **month and year only**; no day is ever offered.
  - Backend stores a Parse `Date` normalised to the **first day of the selected month in UTC**.
    Example: `June 2027` → `2027-06-01T00:00:00.000Z`.
  - `Current Student` **requires** it.
  - `Graduate` **clears** it.
- Month and day names are localised; an Arabic page shows an Arabic calendar.

### From Google, once ⟨CP3A⟩
A Student signs in with Google, so their name and avatar are already known and
verified. Both are taken **once** and both are theirs to change:

- **`fullName`** is prefilled into the form from the verified Google claims. It
  is a suggestion — whatever the Student submits is stored, and the form says
  where it came from until they edit it.
- **The photo** is imported on the save that creates the profile: fetched
  server-side, validated and re-encoded exactly like an upload, stored privately.

**Neither is ever re-applied.** A later edit or removal is permanent; no sign-in
restores Google's version. The Google avatar URL is never shown to a browser,
never stored on the profile, and never logged.

### Photo
Optional. Supports keep / replace / remove. Image only, non-empty, **max 5 MiB**, **private**.

Selecting a photo before the first save is a **local preview**: one Save action creates the profile
first and uploads the photo second, because a photo has nothing to attach to until the profile
exists. If the profile saves and only the upload fails, the profile stands and the page says so.

**MUST NOT** add: CV, salary, work preferences, years of experience, skill self-ratings, multiple
education records, **country of residence, or timezone**.

## 6. Batches and lifecycle

Statuses: `draft`, `active`, `completed`, `archived`.

Allowed transitions:

```
draft ──▶ active ──▶ completed ──▶ archived
  │           │                      ▲
  └───────────┴──────────────────────┘   (both may go straight to archived)
```

| From | To | Allowed |
|---|---|---|
| draft | active | Yes |
| draft | archived | Yes |
| draft | completed | **No** |
| active | completed | Yes |
| active | archived | Yes |
| completed | archived | Yes |
| any | any earlier status | **No** (no backward transitions) |
| archived | anything | **No** (terminal) |

- `archived` is terminal and read-only. There is **no hard delete** of a Batch.
- Metadata may be edited in `draft`, `active`, and `completed`.
- Only `active` Batches accept new enrollment.
- Existing enrollments remain readable after completion or archiving.

## 7. Invitations

Each Batch has **one current general invitation**. The link and the QR code encode the **same
secure token**.

Admin can: generate, copy, preview QR, download QR, expire, revoke, rotate.
Rotation immediately invalidates the previous token.

Token rules — the token MUST be:
- cryptographically secure,
- URL-safe,
- unpredictable,
- unrelated to the Batch `objectId`,
- never logged,
- excluded from generic DTOs.

Public route: `/join/:token`.

## 8. Enrollment

- Requires a valid invitation.
- Resolves the Student from the **authenticated session**; the server MUST NOT accept a
  `studentId` from the client.
- Requires a complete profile.
- MUST be idempotent.
- A Student may join multiple Batches, but each Batch only once.
- Admin cannot manually enroll a Student.

Out of initial scope: manual enrollment, enrollment approval, waiting lists, enrollment
scoring, Student removal.

## 9. Pending invitation flow

1. Visitor opens `/join/:token`.
2. Frontend safely inspects the token (no private data returned).
3. An invalid state is shown as a translated message.
4. Visitor signs in through Google when needed.
5. The token is preserved temporarily.
6. An incomplete profile redirects to Complete Profile.
7. Redemption resumes afterwards.
8. Enrollment is created exactly once.
9. Temporary invitation state is cleared.
10. Student opens Batch Overview.

Temporary token state is cleared after: success, invalid token, logout, or explicit cancellation.

## 10. Resources

A private PDF library inside each Batch.

- Admin manages Resources in `draft`, `active`, `completed`. `archived` is read-only.
- Enrolled Students have read-only access. Visitors have no access.
- Files: **PDF only**, **max 20 MiB by default**. Validate extension, validate MIME, reject
  empty files, validate the `%PDF-` signature.
- Metadata may be edited; the underlying file **cannot** be replaced during metadata editing.
- Ordering supports **Move Up** / **Move Down**.
- There is **no public raw file access**.

## 11. Live Slides constraints

- Live Slides belong to a Batch. Admin controls the session; enrolled Students participate;
  Visitors have no access.
- **Students and the Admin are physically in the same place during a session** ⟨confirmed CP3A⟩.
  Live Slides is an in-room tool, not a remote-meeting one — which is why the product carries no
  timezone, no country of residence, no remote-attendance field, and no scheduling model, and why
  none may be added.
- Phase 0 does **not** define final slide types or answer-persistence rules.
- **MUST NOT** add: scores, grades, ratings, correct-answer grading, evaluation, feedback
  workflow, ranking, recommendations, AI evaluation.
- Detailed Live Slides behaviour remains an **Open Question** until explicitly confirmed
  (see [§15](#15-open-questions)).

## 12. Tasks

Exactly two task types: **Assignment** and **Final Task**.

Evidence options: GitHub, Live Demo, Drive/Doc, File, Video URL, Text.
At least one evidence option is required per task.

### Assignment
- One submission. Locks after submission.
- No late submission, no accept/reject, no score, no rating, no feedback, no recommendation,
  no *Needs Update*, no re-review.

### Final Task
- Video URL is **mandatory**. No direct video upload.
- One submission.
- Not public automatically.
- Admin may **Accept** it for publication — acceptance is *only* a publication decision.
- Accepted Final Tasks may appear in Talent Reels.
- Admin may remove an accepted Final Task from Reels.

**MUST NOT** add: rubrics, grades, scores, ratings, evaluation, feedback, recommendations,
*Needs Update*, re-review, AI evaluation.

## 13. Pinned Students and Talent Reels

**Pinned Students** — Admin only, scoped to a Batch, no score, no rating.

**Talent Reels** — public; accepted Final Task videos only; sanitised public DTOs only.
Excludes Assignments, unaccepted Final Tasks, email, phone, date of birth, OAuth data,
session data, invitation data, likes, comments, ratings.

### Public-data privacy

Visitors receive sanitised public DTOs only and MUST NEVER read private raw Parse classes
directly. Never expose publicly: email, phone, date of birth, OAuth identities, session
tokens, invitation tokens, enrollment internals, ACL, CLP, Admin metadata, drafts, private
Resources, unaccepted Final Tasks, raw Parse objects.

## 14. Prohibited features (consolidated)

Scores · grades · ratings · rubrics · evaluation · feedback workflows · submission reviews ·
re-review · *Needs Update* · recommendations · correct-answer grading · AI evaluation ·
ranking · likes · comments · Program entity · SuperAdmin/Employee/Company/Trainer/Teacher/
Moderator/Recruiter roles · public email/password signup · manual Student creation · Student
Excel import · Student password login/reset/change · public raw file access · direct video
upload · persisting Live Slides answers into a permanent Student evaluation profile.

## 15. Confirmed user flows

1. **Admin login** → session restored on reload → Admin workspace → logout.
2. **Student first sign-in** → Google → Complete Profile → Student dashboard (no invitation needed).
3. **Join a Batch** → `/join/:token` → sign in if needed → complete profile if needed →
   idempotent enrollment → Batch Overview.
4. **Batch lifecycle** → create as `draft` → `active` (accepts enrollment) → `completed` →
   `archived` (read-only, terminal).
5. **Resources** → Admin uploads PDFs and reorders them → enrolled Students read them.
6. **Assignment** → Admin publishes → Student submits once → submission locks.
7. **Final Task** → Admin publishes (Video URL mandatory) → Student submits once → Admin
   Accepts for publication → video may appear in Talent Reels → Admin may remove it.
8. **Talent Reels** → Visitor browses sanitised public accepted Final Task videos.

## 16. Prototype conflicts

Both prototypes were reviewed in full. The following prototype behaviours **conflict with this
document and MUST NOT be implemented**. In every row, this document wins.

| # | Prototype behaviour | Source | Authoritative rule |
|---|---|---|---|
| P1 | 0–10 skill ratings, score bars, `overall` score (`8.3/10`) | `index.html` `assignmentReview.scores`, `finalReview.scores/overall` | No scores, no ratings |
| P2 | "Select skills to evaluate" step in the task builder; per-skill rating fields in the review form | `index.html` `taskSkillCards`, `openReviewModal` | No evaluation, no rubrics |
| P3 | Student feedback text + internal Admin notes on submissions | `index.html` `assignmentReview.feedback/internal` | No feedback workflow |
| P4 | Review statuses `Reviewed` / `Needs Improvement` / `Rejected` | `index.html` `openReviewModal` | Assignments have no accept/reject and no review status |
| P5 | Editing a submission after review; `Needs re-review`; `editReviewedSubmission()` | `index.html` `assignmentEdited`, `assignmentReReviewed` | One submission; locks after submission; no re-review, no *Needs Update* |
| P6 | `recommendation: "Recommended for Junior Frontend roles."` | `index.html` `finalReview.recommendation` | No recommendations |
| P7 | "Verified skills — Admin-rated" panel in the public view | `index.html` `companyView()` | No ratings in public DTOs |
| P8 | A **Company** persona with its own view and "Company verified" badge | `index.html` `setView('company')` | Roles are exactly Admin and Student; Visitor is unauthenticated. Public surface is Talent Reels |
| P9 | Mandatory evidence-inspection gate that unlocks evaluation | `index.html` `inspectionComplete`, `startEvaluation` | There is no evaluation step to gate |
| P10 | Invitation appears required to sign in ("You have been invited… Sign in with Google or Apple") | `index.html` `studentInvite()` | Sign-in and profile need no invitation; the invitation is only for joining a Batch |
| P11 | Apple sign-in offered as a first-class equal option | `index.html` `oauth('Apple')` | Google first; Apple may be added later |
| P12 | Task deadlines, "Submitted on time", "Open until deadline", "no late submission" UI | `index.html` `config.deadline`, submission timing panel | Deadlines are **not** confirmed requirements — Open Question OQ-7 |
| P13 | Multiple Final Tasks per Batch | `index.html` `state.finalTasks[]`, "Create another Final Task" | Not confirmed — Open Question OQ-6 |
| P14 | Human-readable invitation slug `codeyourfuture.app/join/summer-2026` | `index.html` `copyInvite()` | Token must be cryptographically secure, unpredictable, and unrelated to the Batch identity |
| P15 | Live Slides answers saved into the Student profile as "Live Session Answers" | `slides.html` `studentProfileContent`, `openEndConfirmation` | MUST NOT persist Live Slides answers into a permanent Student evaluation profile — OQ-5 |
| P16 | `No Answer` recorded per Student when a question is locked | `slides.html` `nextSlide`, `unansweredStudents` | Would create a per-Student performance record — OQ-5 |
| P17 | Session statuses `draft` / `ready` / `live` / `completed`, presenter mode, question locking, duplicate-as-draft | `slides.html` `session.status` | Not confirmed; Live Slides behaviour is deliberately undefined in Phase 0 — OQ-5 |
| P18 | Slide types Welcome / Information / Question / Closing; short vs long answer; required flag | `slides.html` `sampleSlides`, `openAddSlide` | Not confirmed — OQ-5 |
| P19 | Batch nav omits **Resources** (tabs: Overview / Students / Tasks / Live Slides / Pinned Students) | `slides.html` `adminTabs()` | Batch navigation includes Resources |
| P20 | Profile fields "Target role" (select list) and "Why did you choose this role?" | `index.html` `studentProfileForm` | **Adopted** in Checkpoint 3A. Both exist, both optional, neither affects completion, neither is an evaluation — OQ-3 resolved |
| P21 | City chosen from a 14-item Syrian governorate list | `index.html` `governors` | **Superseded.** `city` is a required searchable Select over an Admin-managed catalog; no list is hard-coded anywhere — OQ-2 resolved |
| P22 | `Date of birth` uses a full date input; graduation uses `type="month"` | `index.html` `pfDob`, `pfGraduation` | Shape confirmed; **implementation differs**. Both are PrimeNG DatePickers, not native inputs — full date for DOB, month/year only for graduation |
| P23 | Profile save button reads "Save profile **and join** Summer 2026" — coupling profile completion to enrollment | `index.html` `saveProfile()` | Profile completion and enrollment are separate steps |
| P24 | "File Upload" evidence accepts ZIP; free-text file name | `index.html` `submissionOptions` | File evidence limits are not confirmed — OQ-8 |
| P25 | Custom skills can be added to a shared global list at task-creation time | `index.html` `addCustomSkill` | No skills model exists in this document |

## 17. Open Questions

This is the single canonical list. Every question is recorded in full text, with who must answer
it and what it blocks. Other documents reference these identifiers but never restate them.

**Classification legend**

| Class | Meaning |
|---|---|
| **BLOCKS-P1** | Must be answered before Phase 1 (Checkpoint 1) begins — *no question currently carries this class* |
| **BLOCKS-CPn** | Must be answered before the named later checkpoint |
| **FOLLOW-UP** | Non-blocking technical follow-up |
| **RESOLVED-SRC** | Resolved from source code during Phase 0 |
| **RESOLVED-RULES** | Resolved by an authoritative product-owner decision recorded in this document |

Where source code answers part of a question, the source answer is recorded and only the
remaining *decision* is left open. **No product decision has been invented** — resolved questions
carry the decision as given by the product owner.

---

### OQ-1 — Admin provisioning
**Question in full:** Which Admin accounts exist in Code Your Future, and how are Admins
provisioned — only by the environment-driven seed, or also through an Admin-managed user list
inside the application? If both, may an Admin create, disable, or delete another Admin?

**Resolved from source:** the mechanism already exists in the template.
`backend/src/cloudCode/database/seed.ts` → `seedAdminUser()` creates exactly one account from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` (defaults `admin` / `ChangeMe!2024` /
`admin@example.com`) and adds it to the `SuperAdmin` role. `modules/User/functions.ts` additionally
exposes `createUser` / `updateUser` / `deleteUser`, all gated on
`requireAnyUserRoles: ['SuperAdmin']`, so an in-app Admin-managed list is already possible.

**Still open:** which policy Code Your Future should adopt, and the self-management rules.
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP2** (Admin authentication). Does not block Phase 1.

---

### OQ-2 — Institution list and city input ✅ RESOLVED
**Question in full:** What is the authoritative Syrian institution list for `institution`, and is
`city` a free-text field or a fixed list? If a fixed list, what is its authoritative source?

**Source note (not authoritative):** the prototype hard-codes a 14-item governorate list
(`index.html` `governors`) and a 10-item institution list ending in `Other`
(`index.html` `universities`). Prototypes are references only — conflicts P21 and P20.

**Answer — product owner, Checkpoint 3A:** there is **no static authoritative list**, and the
question is resolved by removing the need for one. `city`, `institution`, and `major` are all
**required searchable Selects backed by an Admin-managed catalog** (`ProfileCatalogItem`), so the
authoritative source is the Admin screen rather than a source file.

- **`city`** — a required Select. No list ships; an Admin adds the cities the product serves.
- **`institution`** — a required Select. The Checkpoint 3A hard-coded list of common Syrian
  institutions was **migrated into the catalog** as seed data, including the `Other` escape hatch
  (`isOther`), which still requires `customInstitutionName`. Institutions additionally carry a
  kind: `UNIVERSITY`, `INSTITUTE`, or `OTHER`.
- **`major`** — a required Select. No list ships.

Nothing is invented: cities, majors, and target roles start **empty**, and both the Admin screen
and the Student form say so plainly rather than offering plausible-looking options nobody approved.

**Classification:** **RESOLVED-CP3A**.

---

### OQ-3 — Career goal shape ✅ RESOLVED
**Question in full:** Is the optional "career goal" free text or a selection from a fixed list of
target roles? If free text, what is the maximum length? If a list, what are its values, and is a
custom "Other" permitted?

**Source note (not authoritative):** the prototype models this as *two* fields — a 10-item
"Target role" select plus a free-text "Why did you choose this role?" (`index.html`
`studentProfileForm`).

**Answer — product owner, Checkpoint 3A:** **both**, and the prototype's shape is adopted here.
Conflict P20 is therefore closed in the prototype's favour, which is the only P-conflict resolved
that way so far.

- **`careerGoal`** — unchanged. Optional free text, maximum 500 characters.
- **`targetRole`** — a new **optional** searchable Select backed by the `TARGET_ROLE` catalog.
  No values ship; an Admin adds them.
- **`targetRoleReason`** — a new optional free-text answer to the question, worded exactly:
  - English: **Why did you choose this role?**
  - Arabic: **لماذا اخترت هذا الدور؟**

  Maximum 500 characters. It is shown **only** when a target role is selected, and is cleared when
  the role is cleared.

**Neither the target role nor its reason affects profile completion**, and neither is an
evaluation: nothing scores, ranks, or grades either one. This is a Student saying what they are
aiming for.

**Classification:** **RESOLVED-CP3A**.

---

### OQ-4 — Batch metadata fields — ✅ RESOLVED
**Question in full:** Which metadata fields does a Batch carry beyond `status`? Candidates include
name/title, start date, end date, description, and capacity. Which are required, which are
editable in `draft` / `active` / `completed`, and is Batch name uniqueness enforced?

**Product-owner decision, taken for Checkpoint 4:**

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 2–120 characters. **Not unique** — two intakes may legitimately share a name, and refusing that would be an invented rule. |
| `description` | no | Up to 1000 characters. |
| `startDate` | yes | A calendar date, stored as UTC midnight. |
| `endDate` | no | Must be on or after `startDate`. A one-day Batch is allowed. |
| `status` | yes | `draft` \| `active` \| `completed` \| `archived`; defaults to `draft`. |

**Deliberately absent:** capacity, maximum students, trainers, location, schedule, image, score,
rating, and any Program field. A backend test asserts none of them exists on the model.

**Editability:** every field is editable in `draft`, `active`, and `completed`. **Archived is
terminal and read-only** — no field, and no status, can change again. Status itself is never
changed through the edit form; it moves through its own transition operation, which enforces the
allowed moves (`draft → active|archived`, `active → completed|archived`, `completed → archived`).
No status ever changes on its own — there is no scheduler and no date-driven transition.

**Classification:** **RESOLVED-CP4**. Implemented and verified — see
[CURRENT_STATE.md §7g](CURRENT_STATE.md).

---

### OQ-5 — Live Slides detailed behaviour
**Question in full:** What are the final Live Slide types? Are Student answers persisted at all —
and if so, where, for how long, and who may read them? What happens to answers when a session
ends? Is a session status model needed, and may a session be re-run or duplicated?

**Constrained by the product rules (§11):** whatever is decided, it must add **no** scores, grades,
ratings, correct-answer grading, evaluation, feedback workflow, ranking, recommendations, or AI
evaluation, and it must **not** persist Live Slides answers into a permanent Student evaluation
profile. The prototype's design for this area is explicitly rejected — conflicts P15, P16, P17, P18.

**Answer required from:** product owner, in writing, before Checkpoint 8 begins.
**Classification:** **BLOCKS-CP8** (Live Slides). **Explicitly deferred — does not block Phase 1.**

---

### OQ-6 — Number of Final Tasks per Batch
**Question in full:** May a Batch contain more than one Final Task, or exactly one?

**Source note (not authoritative):** the prototype supports many (`index.html` `state.finalTasks[]`
and a "Create another Final Task" action) — conflict P13.
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP9** (Assignment and Final Task).

---

### OQ-7 — Task deadlines
**Question in full:** Do Tasks have deadlines? If so, what happens when a deadline passes, given
that the product rules already state "one submission", "locks after submission", and "no late
submission"? Does a passed deadline close submission entirely, and is a deadline required or optional?

**Source note (not authoritative):** the prototype has deadlines, "Submitted on time" badges, and
"Student edit access — open until deadline", the last of which contradicts submission locking —
conflict P12.
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP9**.

---

### OQ-8 — File evidence limits
**Question in full:** For the `File` evidence option on a Task, which file types are allowed and
what is the maximum size? Do the Resource rules (PDF only, 20 MiB, `%PDF-` signature check) apply,
or is a broader set permitted?

**Source note (not authoritative):** the prototype suggests ZIP and a free-text file name
(`index.html` `submissionOptions`) — conflict P24. The template performs **no** server-side type or
size validation on any upload path today (security gap S-9).
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP9**.

---

### OQ-9 — Talent Reels public field set
**Question in full:** Exactly which Student fields appear in the public Talent Reels DTO — full
name, city, institution, major, career goal, GitHub / LinkedIn / Portfolio links, photo? Is there
pagination, and what is the ordering?

**Constrained by the product rules (§13):** the payload must exclude email, phone, date of birth,
OAuth identities, session tokens, invitation tokens, enrollment internals, ACL, CLP, Admin
metadata, drafts, private Resources, unaccepted Final Tasks, and raw Parse objects — and must carry
no likes, comments, or ratings. The remaining allow-list is the open part.
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP10** (Pinned Students and Talent Reels).

---

### OQ-10 — Private file serving and per-request authorisation
**Question in full:** How are private files (Student photos, Batch Resource PDFs) served so that
every download is authorised per request? Which mechanism will be used — an authorised cloud
function / Express route that streams the bytes, or a custom Parse `filesAdapter`?

**Resolved from source — the problem is fully characterised:**
- Parse Server serves files at `/api/files/{appId}/{filename}` with **no authentication**, and
  `restrictRoutes` in `@90soft/parse-server-kit` whitelists `/files` as a system route. Verified:
  an anonymous GET returns 404 for a missing file, i.e. the endpoint is reachable, not blocked.
- `app.ts:92` additionally serves `backend/files/` at the web root via `express.static`, also
  unauthenticated.
- `backend/src/cloudCode/utils/fileAdapter.ts` already implements a complete local-disk adapter
  including `handleFileStream` with HTTP Range support, but is **never wired** into
  `parseConfig.ts` — no `filesAdapter` key is passed, so the default GridFS adapter is in use.

**Narrowed further in Checkpoint 3A ⟨catalog⟩ — but still open.** The Student profile photo now
has a working, authenticated answer: a dedicated Express route on the Parse mount path that
resolves the caller from their session, verifies live `Student` membership, accepts a bounded
multipart upload, and serves the bytes back to the owner alone with `Cache-Control: private,
no-store`. It opens **no** file route — `/api/files/*` is still 403 — and creates no public URL.

That route is a **profile-photo** answer, not the general one. It stores bounded, re-encoded bytes
inline on the private profile row, which works for a ≤1 MiB WebP and will not work for a Batch
Resource PDF. It also does not use `File`, `IMG`, or `fileAdapter.ts`, all of which remain unwired
for the reason recorded in S-20.

**Still open:** the general mechanism for private files that are too large to inline — an
authorised streaming route reading from a `filesAdapter`, or a custom adapter that authorises per
request. This is a technical/architecture decision, not a product decision.
**Answer required from:** engineering, before Checkpoint 7 (Batch Resources).
**Classification:** **BLOCKS-CP7** (Resources) — Resources cannot be made private without it.
Also referenced by Checkpoint 11 and by Checkpoint 4's private photo.

---

### OQ-11 — Pinned Students vs Talent Reels
**Question in full:** Do the "Pinned Students" and Talent Reels surfaces overlap? Does pinning a
Student affect public visibility in any way, or is pinning purely an internal Admin bookmark scoped
to a Batch?

**Constrained by the product rules (§13):** Pinned Students is Admin-only, Batch-scoped, with no
score and no rating; Talent Reels publishes accepted Final Task videos. Nothing in the rules links
them, so the safe reading is "no overlap" — but this has not been confirmed.
**Answer required from:** product owner.
**Classification:** **BLOCKS-CP10**.

---

### OQ-12 — Routing mode for public links — ✅ RESOLVED
**Question in full:** Should the frontend keep hash-based routing? With it, every invitation link
and QR code becomes `https://host/#/join/:token` rather than `https://host/join/:token`.

**Decision, taken for Checkpoint 4: keep hash routing.** Invitation links are
`https://host/#/join/:token`.

**Why.** Switching to path routing would require a rewrite rule on the deployment target that
serves `index.html` for every unmatched path. Getting that wrong does not fail at build time or in
review — it fails when somebody scans a QR code in a room and gets a 404, which is the worst
possible moment to discover it. Hash routing needs no server configuration at all and cannot break
that way. The cost is a `#` in the URL, which nobody types: these links are scanned or clicked.

There is also a small, real security benefit. A URL fragment is **not sent to the server** and does
not appear in access logs, proxy logs, or `Referer` headers. With hash routing the token stays on
the client by construction rather than by everybody remembering to redact it.

**What was actually built on the strength of this.** `buildInvitationUrl()` produces
`${origin}/#/join/${token}`; the log redactor strips `(#?/join/)<token>` in both forms; and the
frontend's stored-intent helper builds `#/join/<token>` from a shape-validated token and never
stores a redirect URL. Reversing the decision later means changing one function, one regular
expression, and adding the rewrite rule — no data migration, because no link is stored.

**Classification:** **RESOLVED-CP4**. Implemented and verified — see
[CURRENT_STATE.md §7g](CURRENT_STATE.md).

---

### OQ-13 — Retention of `AppSettings` — ✅ RESOLVED
**Question in full:** Is the template's `AppSettings` key-value class retained for Code Your
Future, and if so for what purpose? If retained, its route prefix needs correcting (see below).

**Resolved from source:** `AppSettings` is **entirely unused**. Verified by search: the only
reference to `getAppSetting` anywhere in `backend/src` or `frontend/src` is its own definition in
`modules/AppSettings/functions.ts` — there is no frontend caller and no other backend caller. The
model declares `key` (required, unique → index `key_unique`) and `value`, with `count`/`create`/
`update`/`delete` CLP set to `{}` so only the master key can write. Its generated route prefix is
mis-pluralised to `/api/app-settingses/getAppSetting` by the kit's `toKebabPlural`.

**Product-owner decision:** **the legacy `AppSettings` feature will be removed during Phase 1
(Checkpoint 1).** Reasons on record:

1. `getAppSetting` has no current frontend or backend consumer.
2. Code Your Future has no confirmed requirement for a generic `AppSettings` model.
3. Retaining it unnecessarily expands the API and security surface.
4. Its generated `app-settingses` route is legacy behaviour.
5. Future configuration requirements should use narrowly scoped, typed and sanitised endpoints
   rather than a generic settings store.

**Consequence for the product rules:** none. `AppSettings` was never part of the Code Your Future
product surface described in §1–§14, so no authoritative behaviour changes. The mis-pluralised
route needs no fix — it disappears with the class, so no `@Route('app-settings')` correction is
required.

**Consequence for future configuration work:** a generic key-value settings store is now a
**prohibited pattern**. Any future configuration need must be met with a narrowly scoped, typed,
sanitised endpoint.

**Status:** `AppSettings` **still exists in the clean template today** — the model, its cloud
function, its route, and its Swagger schema are all present and were observed at runtime during
Phase 0. Nothing has been removed yet; removal is Checkpoint 1 scope.
**Classification:** **RESOLVED-RULES** — decided by the product owner. No longer blocks Phase 1.

---

### OQ-14 — Authoritative CI and deployment target
**Question in full:** Which deployment pipeline is authoritative? The repository remote is GitHub
(`https://github.com/Wesam-Soulaiman/code-your-future.git`) on branch `master`, while the only
pipeline definition is `.gitlab-ci.yml`, which gates every job on `$CI_COMMIT_BRANCH == "dev"`.
Should the GitLab pipeline be ported to GitHub Actions, or is GitLab mirroring intended? Which
branch triggers deployment?

**Resolved from source:** the mismatch is confirmed — remote is GitHub/`master`; the pipeline
targets GitLab/`dev` and needs eight CI variables plus Docker on the host.
**Still open:** which platform and branch are authoritative.
**Answer required from:** product owner / dev-ops.
**Classification:** **BLOCKS-CP12** (Final E2E and deployment readiness). **FOLLOW-UP** until then.

---

### OQ-15 — Tracking of `docs/` — ✅ RESOLVED
**Question in full:** `docs/` was git-ignored by an uncommitted `.gitignore` edit, so all five
context documents and both prototypes were untracked and would not survive a fresh clone. Should
`docs/*.md` be tracked?

**Resolution:** resolved during the Phase 0 closeout. The bare `docs` rule has been removed from
the root `.gitignore`. Verified: `git check-ignore -v` reports no matching rule for any of the five
documents or for either prototype, so all seven files are now trackable.
**Classification:** **RESOLVED-SRC**.

---

### OQ-16 — Frontend ignored build scripts
**Question in full:** The frontend install reports `Ignored build scripts: @parcel/watcher@2.6.0,
esbuild@0.28.1, lmdb@3.5.1, msgpackr-extract@3.0.4`. Should these be explicitly decided (as the
backend's `allowBuilds` does), or left as an accepted warning?

**Resolved from source / validation:** it is a **warning only**, not an error — the frontend install
exits 0 and the production build succeeds, because all four packages ship prebuilt platform
binaries. Unlike the backend, no frontend script is blocked. Build permissions were deliberately
**not** broadened during the closeout, since doing so would only silence a warning.
**Classification:** **FOLLOW-UP** — non-blocking. Revisit only if a frontend build ever fails for
a missing native binary.

---

### Summary

| # | Class | Blocks | Answer from |
|---|---|---|---|
| OQ-1 | BLOCKS-CP2 | Checkpoint 2 | product owner |
| OQ-10 | BLOCKS-CP7 | Checkpoint 7 | engineering (narrowed in CP3A; still open) |
| OQ-5 | BLOCKS-CP8 | Checkpoint 8 (deferred) | product owner |
| OQ-6, OQ-7, OQ-8 | BLOCKS-CP9 | Checkpoint 9 | product owner |
| OQ-9, OQ-11 | BLOCKS-CP10 | Checkpoint 10 | product owner |
| OQ-14 | BLOCKS-CP12 | Checkpoint 12 | product owner / dev-ops |
| OQ-16 | FOLLOW-UP | — | engineering |
| OQ-2, OQ-3 | RESOLVED-CP3A | — | product owner: answered in Checkpoint 3A |
| OQ-4, OQ-12 | RESOLVED-CP4 | — | answered and implemented in Checkpoint 4 |
| OQ-13 | RESOLVED-RULES | — | product owner: remove in Checkpoint 1 |
| OQ-15 | RESOLVED-SRC | — | closed in closeout |

**No Open Question blocks the start of Phase 1.** OQ-13 was the last one, and it is now resolved:
the product owner has decided that `AppSettings` will be removed during Checkpoint 1. Everything
else is scheduled against a later checkpoint, is a non-blocking follow-up, or is already resolved.
