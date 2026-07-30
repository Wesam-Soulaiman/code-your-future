/**
 * Application Routes
 *
 *   /auth        — Admin login (public, no guard)
 *   /            — Authenticated shell
 *     /dashboard — Landing page after login
 *
 * Guards:
 *   authGuard  — redirects a Visitor to /auth
 *   roleGuard  — restricts a route to the supplied application roles
 *
 * Retired in Checkpoint 1: `/users`, the template's user-management screen. Code
 * Your Future has no manual user-administration requirement — Admins are
 * provisioned server-side and Students arrive via Google OAuth (Checkpoint 3).
 *
 * Future checkpoints add the Student workspace (3–4), `/join/:token` (6), and the
 * public Talent Reels route (10). None of them exist yet.
 */

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Public route — no auth required
  {
    path: 'auth',
    loadComponent: () => import('./pages/auth/auth.component').then((m) => m.AuthComponent),
  },

  // Protected routes — all children require authentication
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
    ],
  },

  // Unknown paths fall back to the shell, which redirects to the dashboard.
  { path: '**', redirectTo: '' },
];
