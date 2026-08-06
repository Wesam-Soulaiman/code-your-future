/**
 * The public profile photo ⟨CP8⟩.
 *
 * ── Why this is a route and not a field ─────────────────────────────────────
 * The photo is base64 WebP on a private column. Putting it in the directory
 * response would mean a grid of twenty-four faces arriving as one enormous JSON
 * body, re-sent on every filter change. So the DTO carries a path and this
 * serves the bytes.
 *
 * ── The path grants nothing ─────────────────────────────────────────────────
 * It is addressed by **slug**, never by profile id, and publication is
 * re-checked on every request rather than trusted from whatever produced the
 * URL. A Student who withdraws consent stops having a face on the internet at
 * the next request, not at the next cache expiry — which is the whole reason
 * this is not a signed URL or a storage key.
 *
 * ── Cache headers differ from the private photo route, deliberately ─────────
 * The private one is `private, no-store`, because it serves a photo of the
 * person who is signed in over a shared path. This one serves something its
 * owner asked to be public, and the URL carries a version stamp from
 * `photoUpdatedAt` — so a replaced photo is a different address and a stale one
 * cannot be served for it. `public` with a short max-age is therefore honest
 * and saves the grid re-fetching every face on every scroll.
 */

import express, {NextFunction, Request, Response} from 'express';

import {catchError} from '@90soft/parse-server-kit';

import {safeLog} from '../../utils/logging/safeLogger';
import {STORED_PHOTO_MIME} from '../StudentProfile/photo';
import {PUBLIC_PHOTO_CACHE_SECONDS} from './constants';
import {findPublishedPhoto} from './repository';

export const PUBLIC_PHOTO_PATH = '/talent/photo/:slug';

/**
 * A refusal that says nothing.
 *
 * An unknown slug, a slug belonging to somebody unpublished, and a published
 * Student with no photo all answer 404 with the same body. Distinguishing them
 * would let somebody enumerate which slugs are real.
 */
function notFound(res: Response): void {
  res.status(404).json({error: 'PUBLIC_PHOTO_NOT_FOUND'});
}

export function publicTalentPhotoRouter(): express.Router {
  const router = express.Router();

  router.get(PUBLIC_PHOTO_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const [error, found] = await catchError(findPublishedPhoto(req.params['slug']));
      if (error) return notFound(res);
      if (!found) return notFound(res);

      const bytes = Buffer.from(found.data, 'base64');
      if (bytes.length === 0) return notFound(res);

      safeLog.info('Public photo served', {
        op: 'getPublicStudentPhoto',
        ok: true,
        bytes: bytes.length,
      });

      res.setHeader('Content-Type', STORED_PHOTO_MIME);
      res.setHeader('Cache-Control', `public, max-age=${PUBLIC_PHOTO_CACHE_SECONDS}`);
      // The stored bytes are WebP that this server produced, but the header is
      // set anyway: a browser that sniffed its way to another type would be
      // deciding what to execute based on content nobody re-checked.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Rendered in an `<img>`, never navigated to as a document.
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).end(bytes);
    })().catch(next);
  });

  return router;
}
