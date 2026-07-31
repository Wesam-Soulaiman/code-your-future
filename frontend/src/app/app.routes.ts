/**
 * Application Routes
 *
 *   /auth              — redirects to /auth/admin
 *   /auth/admin        — Admin sign-in (public, guest-only)
 *   /auth/student      — Student sign-in with Google (public, guest-only)
 *   /auth/**           — any unknown auth sub-route resolves to /auth/admin
 *   /student           — redirects to /student/welcome
 *     /student/welcome — the Student area (Students only)
 *   /                  — Admin shell (Admins only)
 *     /dashboard       — Admin landing page
 *
 * Guards:
 *   authGuard    — Admin workspace; Visitor → /auth/admin, Student → their own area
 *   studentGuard — Student area; Visitor → /auth/student, Admin → the dashboard
 *   guestGuard   — sends an authenticated user away from the auth pages, to the
 *                  landing route for the role they actually hold
 *   roleGuard    — restricts a route to the supplied application roles
 *
 * Redirect safety: every redirect target below is a fixed internal path, defined
 * in `guards/home-route.ts`. No target is ever read from a query parameter or
 * from user input, so none of these can become an open redirect.
 *
 * Future checkpoints add Complete Profile (4), `/join/:token` (6), and the public
 * Talent Reels route (10). None of them exists yet.
 */

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
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
        path: 'welcome',
        title: 'Code Your Future — Welcome',
        // Guarded on the child as well, for the same reason as the auth branch.
        canActivate: [studentGuard],
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
    ],
  },

  // Unknown paths fall back to the shell, whose guard routes each visitor to
  // the place they are actually allowed to be.
  { path: '**', redirectTo: '' },
];
