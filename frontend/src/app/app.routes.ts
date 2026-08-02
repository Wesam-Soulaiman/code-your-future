/**
 * Application Routes
 *
 *   /auth              — redirects to /auth/admin
 *   /auth/admin        — Admin sign-in (public, guest-only)
 *   /auth/student      — Student sign-in with Google (public, guest-only)
 *   /auth/**           — any unknown auth sub-route resolves to /auth/admin
 *   /join/:token       — the public invitation landing page (anybody)
 *   /student           — redirects to the Student's current home
 *     /student/profile — Complete Profile (Students only)
 *     /student/welcome — the Student area (Students with a complete profile)
 *     /student/batches — My Batches (Students with a complete profile)
 *     /student/batches/:batchId — one Batch this Student belongs to
 *
 * Both protected areas load the same `ShellComponent`. It renders the sidebar,
 * the top bar, and the page header, and picks its navigation items from the
 * session's roles — an Admin never sees a Student item and a Student never sees
 * an Admin one. Hiding a link is not authorization: every route below is
 * guarded, and every request is re-authorised server-side.
 *
 *   /student           — Student shell (Students only)
 *   /                  — Admin shell (Admins only)
 *     /dashboard       — Admin landing page
 *     /dashboard/profile-catalogs — the four profile vocabularies (Admins only)
 *     /dashboard/batches            — Batches (Admins only)
 *     /dashboard/batches/new        — create a Batch
 *     /dashboard/batches/:batchId   — one Batch: Overview, Students, Invitation
 *     /dashboard/batches/:batchId/edit — edit a Batch
 *     /dashboard/students           — the read-only Student directory
 *     /dashboard/students/:studentId — one Student, read-only
 *
 * Guards:
 *   authGuard    — Admin workspace; Visitor → /auth/admin, Student → their own area
 *   studentGuard — Student area; Visitor → /auth/student, Admin → the dashboard
 *   profileCompleteGuard — sends a Student with an unfinished profile to the form
 *   guestGuard   — sends an authenticated user away from the auth pages, to the
 *                  landing route for the role they actually hold
 *   roleGuard    — restricts a route to the supplied application roles
 *
 * Redirect safety: every redirect target below is a fixed internal path, defined
 * in `guards/home-route.ts`. No target is ever read from a query parameter or
 * from user input, so none of these can become an open redirect.
 *
 * `/join/:token` is deliberately **ungated**: it has to work for a Visitor, for
 * a signed-in Student with an unfinished profile, and for an Admin who opened
 * the wrong link. The page itself decides what to ask each of them for, and the
 * backend authorises the one operation that matters — redeeming — independently.
 *
 * The public Talent Reels route arrives with Checkpoint 10 and does not exist yet.
 */

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { profileCompleteGuard } from './guards/profile-complete.guard';
import { adminGuard } from './guards/role.guard';
import { studentGuard } from './guards/student.guard';

export const routes: Routes = [
  // ── Public authentication ────────────────────────────────────────────────
  {
    path: 'auth',
    // On the parent so entering the branch is short-circuited for a signed-in
    // user before any child is matched...
    canActivate: [guestGuard],
    children: [
      { path: '', redirectTo: 'admin', pathMatch: 'full' },
      {
        path: 'admin',
        title: 'Code Your Future — Admin sign in',
        // ...and on each child too. Angular does NOT re-run a parent's
        // canActivate when only the child changes, so without this a
        // sibling navigation (/auth/admin -> /auth/student) would skip the
        // check while the branch stayed activated.
        canActivate: [guestGuard],
        loadComponent: () => import('./pages/auth/auth.component').then((m) => m.AuthComponent),
      },
      {
        path: 'student',
        title: 'Code Your Future — Student sign in',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./pages/auth/student-auth.component').then((m) => m.StudentAuthComponent),
      },
      // An unknown auth sub-route resolves to the Admin page rather than
      // falling through to the protected shell.
      { path: '**', redirectTo: 'admin' },
    ],
  },

  // ── Public invitation landing ────────────────────────────────────────────
  // No guard, by design. Signing in and completing a profile are offered *from*
  // this page as steps towards joining; gating the page itself would bounce a
  // Visitor to a sign-in screen that has forgotten why they came.
  {
    path: 'join/:token',
    title: 'Code Your Future — Join a batch',
    loadComponent: () => import('./pages/join/join.component').then((m) => m.JoinComponent),
  },

  // ── Student area ─────────────────────────────────────────────────────────
  //
  // ⟨CP4 closeout⟩ Loads the **same** shell the Admin workspace does. The shell
  // decides which navigation items to render from the session's roles, so one
  // component serves both workspaces and the two cannot drift apart in layout,
  // active-state handling, or responsive behaviour.
  {
    path: 'student',
    canActivate: [studentGuard],
    loadComponent: () =>
      import('./components/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'welcome', pathMatch: 'full' },
      {
        path: 'profile',
        title: 'Code Your Future — Complete your profile',
        // Deliberately NOT behind profileCompleteGuard: this is where an
        // incomplete Student is sent, and guarding it would loop. A Student who
        // has already finished may open it any time to edit.
        canActivate: [studentGuard],
        loadComponent: () =>
          import('./pages/student/student-profile.component').then(
            (m) => m.StudentProfileComponent,
          ),
      },
      {
        path: 'welcome',
        title: 'Code Your Future — Welcome',
        // Guarded on the child as well, for the same reason as the auth branch.
        // The profile guard runs second, so an unfinished Student lands on the
        // form rather than on a page that assumes their details exist.
        canActivate: [studentGuard, profileCompleteGuard],
        loadComponent: () =>
          import('./pages/student/student-welcome.component').then(
            (m) => m.StudentWelcomeComponent,
          ),
      },
      {
        // ⟨CP4⟩ My Batches. Behind the profile guard for the same reason the
        // welcome page is: a membership means nothing until we know who joined.
        path: 'batches',
        title: 'Code Your Future — My batches',
        canActivate: [studentGuard, profileCompleteGuard],
        loadComponent: () =>
          import('./pages/student/student-batches.component').then(
            (m) => m.StudentBatchesComponent,
          ),
      },
      {
        path: 'batches/:batchId',
        title: 'Code Your Future — Batch',
        canActivate: [studentGuard, profileCompleteGuard],
        loadComponent: () =>
          import('./pages/student/student-batch-detail.component').then(
            (m) => m.StudentBatchDetailComponent,
          ),
      },
      { path: '**', redirectTo: 'welcome' },
    ],
  },

  // ── Admin shell ──────────────────────────────────────────────────────────
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        title: 'Code Your Future — Dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        // Profile Catalogs ⟨CP3A catalog⟩ — the four vocabularies behind the
        // Student profile's selects. Admin-only, enforced again on every call.
        path: 'dashboard/profile-catalogs',
        title: 'Code Your Future — Profile Catalogs',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/profile-catalogs.component').then(
            (m) => m.ProfileCatalogsComponent,
          ),
      },
      {
        // ⟨CP4⟩ Batches. `new` is declared before `:batchId` so the literal
        // wins the match — otherwise creating a Batch would try to load one
        // whose id is the word "new".
        path: 'dashboard/batches',
        title: 'Code Your Future — Batches',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/batches.component').then((m) => m.AdminBatchesComponent),
      },
      {
        path: 'dashboard/batches/new',
        title: 'Code Your Future — New batch',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/batch-form.component').then((m) => m.AdminBatchFormComponent),
      },
      {
        path: 'dashboard/batches/:batchId/edit',
        title: 'Code Your Future — Edit batch',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/batch-form.component').then((m) => m.AdminBatchFormComponent),
      },
      {
        path: 'dashboard/batches/:batchId',
        title: 'Code Your Future — Batch',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/batch-detail.component').then((m) => m.AdminBatchDetailComponent),
      },
      {
        // ⟨CP4⟩ A read-only directory. There is no create, edit, or delete
        // route because there is no such operation in the API.
        path: 'dashboard/students',
        title: 'Code Your Future — Students',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/students.component').then((m) => m.AdminStudentsComponent),
      },
      {
        path: 'dashboard/students/:studentId',
        title: 'Code Your Future — Student',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin/student-detail.component').then(
            (m) => m.AdminStudentDetailComponent,
          ),
      },
    ],
  },

  // Unknown paths fall back to the shell, whose guard routes each visitor to
  // the place they are actually allowed to be.
  { path: '**', redirectTo: '' },
];
