/**
 * Application Routes
 *
 *   /auth              — redirects to /auth/admin
 *   /auth/admin        — Admin sign-in (public, guest-only)
 *   /auth/student      — Student sign-in, UI only (public, guest-only)
 *   /auth/**           — any unknown auth sub-route resolves to /auth/admin
 *   /                  — authenticated shell
 *     /dashboard       — landing page after login
 *
 * Guards:
 *   authGuard   — sends a Visitor to /auth/admin
 *   guestGuard  — sends an authenticated user away from the auth pages
 *   roleGuard   — restricts a route to the supplied application roles
 *
 * Redirect safety: every redirect target below is a fixed internal path. No
 * target is ever read from a query parameter or from user input, so none of
 * these can become an open redirect.
 *
 * Student authentication is NOT implemented — `/auth/student` is presentation
 * only and performs no sign-in. Google OAuth arrives in Checkpoint 3.
 *
 * Future checkpoints add the Student workspace (3–4), `/join/:token` (6), and
 * the public Talent Reels route (10). None of them exist yet.
 */

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

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

  // ── Authenticated shell ──────────────────────────────────────────────────
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

  // Unknown paths fall back to the shell, which redirects to the dashboard
  // (or to /auth/admin when the visitor is not signed in).
  { path: '**', redirectTo: '' },
];
