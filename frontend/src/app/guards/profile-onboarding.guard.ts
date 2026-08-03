import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from '../services/session.service';
import { STUDENT_PROFILE_EDIT } from './home-route';

/**
 * Keep the standalone page exclusive to first-time profile completion.
 *
 * `studentGuard` runs first, so this guard only chooses the presentation for a
 * signed-in Student. Once the server-backed session says the profile is
 * complete, the same form opens inside the protected workspace shell.
 */
export const profileOnboardingGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (!session.profileComplete()) return true;

  return router.createUrlTree([STUDENT_PROFILE_EDIT]);
};
