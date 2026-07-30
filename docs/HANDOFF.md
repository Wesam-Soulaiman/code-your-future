# Handoff — Checkpoint 2A

**Checkpoint:** 2A — UI/UX Design System and Authentication Experience
**Date:** 2026-07-30
**Branch:** `master` (never left)
**Baseline commit:** `0344a43` — *feat: establish secure product foundation and access boundaries*
**Ready for visual review:** **Yes** — with the six manual checks in §9 still outstanding.

Checkpoint 1's handoff is preserved in the repository history at `0344a43`; Phase 0's at `a796aa0`.

---

## 1. Checkpoint objective

Build the reusable UI/UX foundation for the whole product: a coherent visual system, semantic design
tokens, layout and interaction patterns, a polished Admin authentication experience, a
**presentation-only** Student authentication page, strong English/Arabic and RTL support, a solid
accessibility and responsive baseline, frontend regression tests, and documentation.

Frontend-only. **No backend source file was changed** — the single backend addition is a test.

---

## 2. UI audit — findings, classified

| # | Finding | Classification | Action |
|---|---|---|---|
| 1 | `styles.css` (483 lines) is ~68% FullCalendar theming, plus Timeline, Editor, ProgressBar, Avatar and Divider overrides for components the product never imports | **Preserved template capability** | **Kept in full.** Now guarded by a regression test. |
| 2 | No token layer — three ad-hoc `--app-*` variables; everything else reaches into PrimeNG `--p-surface-*` internals directly | Current conflict | New additive token layer; existing usages untouched |
| 3 | `*, body { font-family: 'Cairo', sans-serif; }` — an Arabic-first face applied to English too, through a universal selector that defeats inheritance | Current conflict | Rule left in place; one scoped `html[lang='en']` override added |
| 4 | Auth page carried a dead `diagonal-image` mask and an empty image array, rendering an empty desktop panel | Current conflict | Replaced by the new auth layout |
| 5 | Auth page had no `h1`, no password toggle, no `autocomplete`, no inline error region | Current conflict | All added |
| 6 | Errors surfaced only as a global toast built from raw `error.error?.error` server text | Current conflict | Client-side translated mapping + inline panel; toast suppressed for auth calls |
| 7 | `login()` had no re-entrancy guard, so Enter could double-submit | Current conflict | Guard added |
| 8 | Only `/auth` existed; no Student route, and a signed-in Admin could sit on the login form | Current conflict | `/auth/admin` + `/auth/student` + `guestGuard` |
| 9 | No `:focus-visible` styling and no reduced-motion support anywhere | Current conflict | Both added |
| 10 | Dark mode already implemented and stable (`.dark`, `SwitchThemeService`, PrimeNG `darkModeSelector`) | **Currently used** | Preserved, and extended with a dark token scale |
| 11 | Shell is 376 lines of pinning, popover and submenu machinery serving one nav item | **Preserved template capability** | Polished only (brand mark, nav landmark); not rebuilt |
| 12 | `data-table`, `base-dialog`, `image-uploader`, `image-cropper-dialog`, `LiveQueryService`, `ExportService`, the pipes — none used by any current page | **Preserved template capability** | Untouched |
| 13 | `@fullcalendar/*`, `quill`, `xlsx`, `html2canvas`, `ngx-image-cropper` unused by current pages | **Future cleanup candidate** | **Not removed.** Requires a separate explicit instruction |
| 14 | `frontend/public/images/` holds only `empty-grid.svg`; `favicon.ico` is referenced but missing | Future cleanup candidate | Not addressed (pre-existing) |

The audit authorised nothing, and **nothing was removed.**

---

## 3. Work completed

| Area | Outcome |
|---|---|
| Design tokens | `src/styles/tokens.css` — colour, surface, text, border, focus, four status families, 4px spacing scale, radius, three elevation steps, four layout widths, control and 44px touch sizes, motion. Every colour derives from PrimeNG's `--p-*`, so there is one source of truth. Full `.dark` scale. |
| Typography | `src/styles/typography.css` — type scale, line heights, weights, tracking, the `.cyf-*` hierarchy, language-aware stacks (system UI for English, self-hosted Cairo for Arabic with larger line heights), reduced-motion reset. **No remote font CDN.** |
| Layout & primitives | `src/styles/layout.css` plus `cyf-brand-mark`, `cyf-auth-layout`, `cyf-language-switch`, `cyf-alert`. CSS logical properties throughout, so one stylesheet serves LTR and RTL. PrimeNG's `p-button` is reused for the primary action — no component library was rebuilt. |
| Auth routing | `/auth` → `/auth/admin`; `/auth/admin`; `/auth/student`; `/auth/**` → `/auth/admin`. `guestGuard` returns a `UrlTree`, so a signed-in Admin never sees the form flash. Every redirect target is a fixed internal path. |
| Admin auth page | Redesigned on the token system: password visibility toggle, translated inline error states, duplicate-submit prevention, Enter submission, `autocomplete` hints, reserved message space so validation causes no layout shift, link to Student sign-in. **Login, session restoration, guards, logout and rate limiting are unchanged from Checkpoint 1.** |
| Student auth page | **Presentation only** — no service, no HTTP, no navigation, no session write, no click handler; the Google button is `disabled`. Approved invitation copy verbatim in both languages, privacy note, link to Admin sign-in. |
| Error handling | `mapAuthError()` maps status/Parse code to one of five translated keys; the interceptor's toast is suppressed for calls that opt in via `HANDLES_OWN_ERRORS`. No raw backend string ever reaches the UI. |
| Shell polish | Brand mark in the logo slot, labelled navigation landmark. Navigation is still exactly Dashboard + language + logout. |
| Accessibility | Landmarks and a skip link, exactly one `h1` per page, real `<label>`s, `:focus-visible` ring, 44px touch targets, `aria-pressed` on toggles, `role="alert"`/`role="status"` with a visually-hidden text prefix so status is never colour-only. |
| i18n | 114 keys per language, exact parity, verified by test. |
| Tests | +82 frontend, +26 backend. **Zero new dependencies.** |

---

## 4. Three defects found during validation

All three were caught by *validating*, not by writing code.

**1. Every icon was invisible in English.** The English font override initially re-asserted
`font-family: 'Font Awesome 6 Free'`. The installed package is Font Awesome **7.3.1**, so the named
family did not exist and every glyph fell back to a missing-character box. Arabic was unaffected
because the override does not apply there — which is exactly how it hid. Found by *looking at a
screenshot*; the whole suite was green. Fixed by **excluding** icon-bearing elements
(`:not([class*='fa-']):not([class*='pi-'])`) instead of naming a version, so the fix cannot rot on
the next Font Awesome upgrade.

**2. The guest guard did not run on sibling navigation.** With `canActivate` on the parent `/auth`
route only, navigating `/auth/admin` → `/auth/student` kept the branch activated and skipped the
check — Angular does not re-run a parent's `canActivate` when only the child changes. Found by a
routing test. Fixed by guarding the parent **and** both children.

**3. A stale test assertion, caught by the final validation run.** The icon-font test still encoded
the *old, broken* contract — `assert.ok(typography.includes('Font Awesome 6 Free'))` — and it was
passing only because that string survives inside the explanatory comment. Its second assertion
(`primeicons`) then failed once the fix removed the re-declaration. The test now asserts the real
contract: the `html[lang='en']` override must **exclude** `[class*='fa-']` and `[class*='pi-']`, and
the file must contain no `font-family` declaration naming a versioned Font Awesome family — so the
same regression cannot return under a different version number.

An earlier screenshot run also captured glyphs mid-font-load, producing boxes that resembled defect
1. The harness now awaits `document.fonts.ready`, so the captures reviewed in §8 are real.

---

## 5. Preserved template capabilities

Nothing was deleted, simplified, consolidated or rewritten. Explicitly retained and now
regression-guarded:

FullCalendar theming (variables, toolbar, buttons, headers, day numbers, time slots, list view, now
indicator, background events, the `fc-slot-pulse` animation, event cards, action buttons, tooltip,
slot action bar) · Timeline theming · Editor theming · ProgressBar, Avatar, Divider, scrollbar and
`.p-button` overrides · `.app-card` / `.app-card-nested` and the `--app-*` surface variables · all
all nine Cairo `@font-face` declarations · the `data-table` suite, `base-dialog`, `image-uploader`,
`image-cropper-dialog` · `LiveQueryService`, `ExportService`, `PageTitleService`, `ConfirmService`,
`ToastService` · every pipe and the `appIfRole` directive · every dependency in
`frontend/package.json` · every existing route · the shell's pinning, popover and submenu machinery.

`backend/test/templatePreservation.test.ts` fails if any of those stylesheet sections disappears, if
the token layer stops being additive, or if a dependency-bearing capability is stripped.

**Future cleanup candidates — preserved, not removed:** `@fullcalendar/*`, `quill`, `xlsx`,
`html2canvas`, `ngx-image-cropper`, the `data-table` suite, `base-dialog`, the image components, and
the shell's pinning/popover machinery. Removing any of them requires a separate explicit instruction
naming the exact item.

---

## 6. Files

### Added (17)

**Frontend styles (3)** — `src/styles/tokens.css`, `src/styles/typography.css`,
`src/styles/layout.css`

**Frontend components (5)** — `src/app/components/shared/brand-mark.component.ts`,
`src/app/components/shared/language-switch.component.ts`,
`src/app/components/shared/alert.component.ts`,
`src/app/components/layout/auth-layout.component.ts`,
`src/app/pages/auth/student-auth.component.ts` *(with `.html` and `.scss`)*

**Frontend logic (2)** — `src/app/guards/guest.guard.ts`, `src/app/utils/auth-error.ts`

**Frontend tests / helpers (4)** — `src/app/testing/i18n-testing.ts`,
`src/app/design-system.spec.ts`, `src/app/auth-routing.spec.ts`,
`src/app/pages/auth/student-auth.component.spec.ts`

**Backend test (1)** — `test/templatePreservation.test.ts`

*(the two Student template files bring the total to 17 — see the `git status` listing in §13)*

### Modified (19)

**Frontend (13)** — `src/styles.css` *(three `@import` lines prepended; **nothing removed**)* ·
`src/app/app.routes.ts` · `src/app/guards/auth.guard.ts` · `src/app/services/http.interceptor.ts` ·
`src/app/services/dataService/user-service.ts` · `src/app/pages/auth/auth.component.{ts,html,scss}` ·
`src/app/pages/auth/auth.component.spec.ts` ·
`src/app/components/layout/shell.component.{ts,html}` · `public/i18n/en.json` · `public/i18n/ar.json`

**Docs (6)** — `PROJECT.md`, `README.md`, `docs/TEMPLATE_ARCHITECTURE.md`,
`docs/CURRENT_STATE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/HANDOFF.md`

### Deleted (0)

**Nothing was deleted.**

**Deliberately untouched:** `backend/.env` · `backend/dashboard.json` · `docs/prototypes/*` ·
`docs/PRODUCT_REQUIREMENTS.md` · `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` ·
`.claude/**` · all three lockfiles · `frontend/package.json` and every dependency in it ·
`node_modules` · every backend source file.

---

## 7. Tests

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && pnpm run test` | **210 pass / 0 fail**, 41 suites (was 184) |
| Frontend | `cd frontend && pnpm run test` | **167 pass / 0 fail**, 11 files (was 85) |

**No new dependency was added**, so `--frozen-lockfile` remains valid in all three projects.

**Frontend, new (82).** `auth.component.spec.ts` rewritten — structure, labels, `autocomplete`, no
autofocus, branding, absence of signup/reset/account-type affordances, no default credentials,
password toggle (accessible name and `aria-pressed`), validation without an API call, layout-shift-free
message space, submit, keyboard submission, duplicate-submit prevention, disabled-while-loading,
session stored on success, six error states, no raw backend string, assertive announcement, error
cleared on edit, no session on failure, Arabic heading/labels/errors, layout safety.
`student-auth.component.spec.ts` — no input of any kind, no form, no signup/reset/token affordance,
no Apple button, Google disabled with no handler, no navigation and **no HTTP request**,
`aria-describedby` explanation, English content, approved copy verbatim, Arabic content and copy,
layout safety. `auth-routing.spec.ts` — route structure, `guestGuard` on parent **and** children,
titles, **no open redirect**, no future route, guard behaviour for Visitor and signed-in Admin,
unknown sub-route, no redirect loop, switching between the two pages. `design-system.spec.ts` —
brand mark, language switch including `lang`/`dir` synchronisation in both directions, alert roles
and colour-independence.

**Backend, new (26).** `templatePreservation.test.ts` — FullCalendar / Timeline / Editor / PrimeNG
theming intact, `--app-*` variables intact, all nine `@font-face` rules intact, layers imported
additively with template styling still cascading after them, all 30 required tokens present, no
hardcoded hex in the token layer, dark scheme defined, 44px targets, full type hierarchy, distinct
EN/AR stacks, **no remote font source**, Arabic line heights, icon fonts untouched, reduced motion,
logical properties, overflow guard, no fixed pixel widths, `:focus-visible`, a11y helpers,
responsive auth split, no future route, Student page performs no authentication, **no Google package
added**.

No snapshot-only tests. No external service is contacted. No existing test was weakened or skipped.

---

## 8. Build result and runtime validation — observed, not assumed

```
root      pnpm install --frozen-lockfile                      exit 0
backend   pnpm install --frozen-lockfile                      exit 0
backend   pnpm run compile                                    exit 0
backend   pnpm run test                    210 pass / 0 fail  exit 0
frontend  pnpm install --frozen-lockfile --shamefully-hoist   exit 0
frontend  pnpm run build                   674.37 kB initial  exit 0
frontend  pnpm run test                    167 pass / 0 fail  exit 0
```

Visual validation was driven through a real headless Chrome (150.0.7871.187) over the DevTools
Protocol, using only Node built-ins — nothing was installed. `document.fonts.ready` is awaited
before every capture. **20 screenshots were produced and reviewed.**

### Viewports and languages inspected

`/auth/admin` and `/auth/student`, each at **1440, 1024, 768, 390 and 360 px**, in **English and
Arabic** — 20 combinations.

| Property | Result across all 20 |
|---|---|
| Horizontal overflow (`scrollWidth − clientWidth`) | **0** everywhere |
| `<html lang>` / `<html dir>` | `en`/`ltr` and `ar`/`rtl`, correct in all |
| `h1` count | exactly **1** on every page |
| Google button `disabled` | **true** on every Student render |

### Signed-in Admin shell — a real login was performed

Credentials were typed into the redesigned form and submitted through the UI. They were supplied to
the harness via environment variables and never written to a file, a shell command, or a log.

```
LOGIN RESULT: {"hash":"#/dashboard","signedIn":true,"roles":["Admin"],
               "cachedKeys":["id","username","roles"]}
SHELL(en):    {"lang":"en","dir":"ltr","overflow":0,"navLinks":["Dashboard"]}
SHELL(ar):    {"lang":"ar","dir":"rtl","overflow":0,"navLinks":["لوحة التحكم"]}
SHELL(390):   {"overflow":0}
GUEST GUARD:  signed-in Admin -> /auth/admin  =>  #/dashboard
```

Admin login still works end to end, the cached user object holds only `id, username, roles` (no
token, no email), navigation is exactly Dashboard, and there was **no CORS regression** — the
backend's development allow-list served `http://localhost:4200` correctly.

### Screenshots reviewed by eye

`admin-en-1440` (split layout, branding, hierarchy, icons rendering), `student-ar-1440` (full RTL
mirroring, disabled Google button, approved copy), `admin-ar-360` (single column, RTL, no clipping),
`student-en-390` (mobile, disabled button, approved copy), `shell-ar-1440` (RTL sidebar, single nav
item, logout), plus a zoomed crop confirming the password toggle mirrors to the inline-start under
RTL.

Backend startup and request logs were checked during the login run — no credential, token, key or
database URI appears.

All of this ran against an **isolated `mongod` on port 27018** with a scratch dbpath, driven by
environment overrides. `backend/.env` was never read into a config change and never modified; the
developer's own MongoDB service was untouched. Every task-created process was stopped afterwards.

---

## 9. Manual visual validation still recommended

Automated capture cannot judge everything. A human should still confirm:

1. **Aesthetic judgement** — whether the visual direction reads as a premium modern educational SaaS
   product on a real display.
2. **Light mode.** Dark mode is the default and every screenshot above is dark. The token layer
   defines a complete light scale and the build is clean, but light mode was **not** visually
   reviewed.
3. **Real-device Arabic rendering** — Cairo shaping and diacritics on an actual phone.
4. **Keyboard walkthrough** — tab order and focus-ring visibility with a physical keyboard.
5. **Screen-reader pass** — NVDA or VoiceOver on the error and loading announcements.
6. **Rate-limited and offline states** — reproducible only against a throttled or stopped backend.
   The mapping is unit-tested but the rendered panels were not photographed.

---

## 10. Warnings

| Warning | Assessment |
|---|---|
| Frontend initial bundle **674.37 kB** against a 500 kB budget (over by 174.37 kB) | Pre-existing; was 654.87 kB after Checkpoint 1. The design system and the second auth page account for the ~20 kB increase. Not addressed here. |
| `favicon.ico` referenced by `index.html` and still absent | Pre-existing. |
| `withHashLocation()` still active, so URLs are `/#/auth/admin` | **OQ-12 is still open and is now due**, before Checkpoint 6 builds invitation links. |
| Frontend install reports ignored build scripts | Pre-existing (OQ-16); install and build succeed. |
| `git diff --check` LF→CRLF notices | Benign Windows line-ending normalisation. |

---

## 11. Remaining UI gaps

- **Admin workspace / dashboard content** — deliberately still an empty placeholder. No fake
  statistics, no invented modules.
- **Light-mode visual review** — see §9.2.
- The **rate-limited** and **backend-unavailable** panels are implemented and unit-tested but were
  never visually captured.
- **No skeleton or loading screen** for initial session restoration. The app initializer resolves
  fast enough locally that no flash was observable, but this is untested on a slow connection.
- **No form-field component abstraction yet** — the auth fields use the `.cyf-field` pattern
  directly. Typed reactive forms and a shared field component arrive in Checkpoint 4.
- **Toast styling** is still PrimeNG's default; it has not been brought onto the token system.

---

## 12. Instruction conflict — status

The `CLAUDE.md` conflict recorded in Checkpoint 1's handoff (§11 at `0344a43`) is **unchanged and
still awaiting an owner decision**. Checkpoint 2A needed no protected-file change: no file under
`backend/src/cloudCode/utils/`, `database/`, `models/{User,IMG,File}.ts` or `modules/User/` was
touched, and no instruction file was modified. The one backend addition is `backend/test/`, which is
not a protected path.

---

## 13. Exact Git status

```
$ git branch --show-current
master

$ git log --oneline -3
0344a43 feat: establish secure product foundation and access boundaries
a796aa0 docs: establish project context and template architecture
c1517e4 chore: initialize full-stack template

$ git status --short
 M PROJECT.md
 M README.md
 M docs/CURRENT_STATE.md
 M docs/HANDOFF.md
 M docs/IMPLEMENTATION_PLAN.md
 M docs/TEMPLATE_ARCHITECTURE.md
 M frontend/public/i18n/ar.json
 M frontend/public/i18n/en.json
 M frontend/src/app/app.routes.ts
 M frontend/src/app/components/layout/shell.component.html
 M frontend/src/app/components/layout/shell.component.ts
 M frontend/src/app/guards/auth.guard.ts
 M frontend/src/app/pages/auth/auth.component.html
 M frontend/src/app/pages/auth/auth.component.scss
 M frontend/src/app/pages/auth/auth.component.spec.ts
 M frontend/src/app/pages/auth/auth.component.ts
 M frontend/src/app/services/dataService/user-service.ts
 M frontend/src/app/services/http.interceptor.ts
 M frontend/src/styles.css
?? backend/test/templatePreservation.test.ts
?? frontend/src/app/auth-routing.spec.ts
?? frontend/src/app/components/layout/auth-layout.component.ts
?? frontend/src/app/components/shared/alert.component.ts
?? frontend/src/app/components/shared/brand-mark.component.ts
?? frontend/src/app/components/shared/language-switch.component.ts
?? frontend/src/app/design-system.spec.ts
?? frontend/src/app/guards/guest.guard.ts
?? frontend/src/app/pages/auth/student-auth.component.html
?? frontend/src/app/pages/auth/student-auth.component.scss
?? frontend/src/app/pages/auth/student-auth.component.spec.ts
?? frontend/src/app/pages/auth/student-auth.component.ts
?? frontend/src/app/testing/i18n-testing.ts
?? frontend/src/app/utils/auth-error.ts
?? frontend/src/styles/layout.css
?? frontend/src/styles/tokens.css
?? frontend/src/styles/typography.css

$ git diff --cached --name-only
(empty — nothing is staged)

$ git ls-files backend/.env backend/dashboard.json
(empty — neither is tracked)

$ git check-ignore -v backend/.env
backend/.gitignore:6:.env	backend/.env

$ git check-ignore -v backend/dashboard.json
backend/.gitignore:4:dashboard.json	backend/dashboard.json
```

19 modified · 17 untracked · **0 staged** · 0 deleted. `git diff --check` reports only benign
LF→CRLF notices.

### Verifications

| Verification | Result |
|---|---|
| Nothing staged, nothing committed, nothing pushed | ✅ `git diff --cached --name-only` empty; `HEAD` is still `0344a43` |
| No branch created, switched, merged or deleted | ✅ still on `master` |
| `.env` / `dashboard.json` not modified | ✅ md5 unchanged; both still resolve to `backend/.gitignore` rules |
| No secret exposed, printed or tracked | ✅ login credentials passed via environment variables only; no value in any file, log or shell command |
| Prototypes unchanged | ✅ md5 identical; `git status docs/prototypes` empty |
| `docs/PRODUCT_REQUIREMENTS.md` unchanged | ✅ not in `git status` |
| Protected instruction files unchanged | ✅ `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `.claude/**` all absent from `git status` |
| `styles.css` preserved sections intact | ✅ FullCalendar, Timeline, Editor, PrimeNG, `--app-*` and all nine `@font-face` rules present; asserted by test |
| No dependency removed | ✅ `frontend/package.json` and all three lockfiles unmodified |
| No route removed | ✅ every pre-existing route still resolves; only `/auth` children were added |
| No template capability removed | ✅ asserted by `templatePreservation.test.ts` |
| Google OAuth not implemented | ✅ no package, no service, no handler, no request, no session |
| No future product feature | ✅ no new model, no new nav item, no fake data |
| Phase 1 security not weakened | ✅ no backend source touched; login/guard/interceptor changes are additive and covered by the existing Checkpoint 1 tests, all still green |
| No task-created process remains | ✅ the isolated `mongod` (27018), backend node (1337), `ng serve` (4200/4201) and the headless Chrome debug instance (9222) are all stopped; every one of those ports is free. The Windows `MongoDB` **service** is Running on 27017 — that is the developer's own instance, was not started by this task (which used 27018 with a scratch dbpath throughout), and was deliberately left alone. |

---

## 14. Recommended next action

1. **Visual review** of the running app — in particular the six items in §9, and light mode above
   all.
2. **Commit** Checkpoint 2A. Nothing blocks it.
3. **Decide OQ-12** (hash vs path routing) before Checkpoint 6 builds invitation links. Deferring it
   further gets more expensive once real links exist.
4. **Start Checkpoint 3** (Student Google authentication). The Student page is built to receive it:
   enabling sign-in is a deliberate flip of `googleSignInAvailable` plus the real handler and the
   backend `authData` path — nothing else on the page needs to change.

**Checkpoint 2A is ready for visual review.**
