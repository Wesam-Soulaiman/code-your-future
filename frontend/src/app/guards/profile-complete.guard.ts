import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { STUDENT_PROFILE } from './home-route';

/**
 * Keep a Student with an unfinished profile out of the rest of the product.
 *
 * Runs **after** `studentGuard`, so by this point the caller is a signed-in
 * Student. The only question left is whether they have finished the form, and
 * the answer comes from `profileComplete` — a value the **server** recalculates
 * on every session restoration, never something the browser decides.
 *
 * This guard deliberately does not protect `/student/profile` itself: that would
 * be a loop, and the form is exactly where an incomplete Student is meant to be.
 *
 * Editing later uses `/student/profile/edit` inside the protected shell. This
 * guard redirects an unfinished Student away from that route to onboarding.
 *
 * The redirect target is a fixed internal path, so it cannot become an open
 * redirect. This is UI routing only — every profile operation is independently
 * authorised server-side.
 */
export const profileCompleteGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.profileComplete()) return true;

  return router.createUrlTree([STUDENT_PROFILE]);
};
