/**
 * Application Routes
 *
 *   /auth              — redirects to /auth/admin
 *   /auth/admin        — Admin sign-in (public, guest-only)
 *   /auth/student      — Student sign-in with Google (public, guest-only)
 *   /auth/**           — any unknown auth sub-route resolves to /auth/admin
 *   /student           — redirects to the Student's current home
 *     /student/profile — Complete Profile (Students only)
 *     /student/welcome — the Student area (Students with a complete profile)
 *   /                  — Admin shell (Admins only)
 *     /dashboard       — Admin landing page
 *     /dashboard/profile-catalogs — the four profile vocabularies (Admins only)
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
 * Future checkpoints add `/join/:token` (6) and the public Talent Reels route
 * (10). Neither exists yet.
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

  // ── Student area ─────────────────────────────────────────────────────────
  {
    path: 'student',
    canActivate: [studentGuard],
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
    ],
  },

  // Unknown paths fall back to the shell, whose guard routes each visitor to
  // the place they are actually allowed to be.
  { path: '**', redirectTo: '' },
];
