/**
 * Application Routes
 *
 * Route structure:
 *   /auth              — Login page (public, no guard)
 *   /                  — Shell layout (requires authentication)
 *     /dashboard       — Default landing page after login
 *     /users           — User management (Admin + Employee only)
 *     /your-entity     — Add your entity routes in the children array below
 *
 * Guards:
 *   authGuard   — Redirects unauthenticated users to /auth
 *   roleGuard   — Restricts access by user role (pass allowed roles as arguments)
 *
 * All routes use lazy loading (loadComponent) for optimal bundle splitting.
 */

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';
import { UserRoles } from './config/user-roles';

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
      // Redirect root to dashboard
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

      // Dashboard — accessible to all authenticated users
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },

      // User management — restricted to Admin and Employee roles
      {
        path: 'users',
        canActivate: [roleGuard(UserRoles.ADMIN, UserRoles.EMPLOYEE)],
        loadComponent: () =>
          import('./pages/users/users.component').then((m) => m.UsersComponent),
      },

      // ── Add your entity routes here ────────────────────────
    ],
  },
];
