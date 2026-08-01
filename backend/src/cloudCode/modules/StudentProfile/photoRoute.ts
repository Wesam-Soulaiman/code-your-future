/**
 * The profile photo endpoint — a dedicated, authenticated binary route.
 *
 * ── Why this is not a cloud function ────────────────────────────────────────
 * It was one, and that was the bug. Parse Server logs every cloud-function call
 * at `info` as a message string containing the serialised input and result, so
 * the moment a Student picked a photograph the whole base64 image was written to
 * the log — and again on the way back out. Redaction can mask that shape, and
 * now does, but masking a 6 MB string on every upload is a workaround for
 * sending it down that path in the first place.
 *
 * Moving the bytes here removes the cause:
 *
 *   - the image never enters Parse's cloud-function pipeline, so there is no
 *     `Input: {...}` line to redact;
 *   - it travels as **raw multipart**, not base64, so a 5 MiB photo is 5 MiB
 *     rather than 6.7 MiB;
 *   - the size limit applies to the socket, **before** anything is decoded,
 *     buffered whole, or handed to an image library. A cloud function had
 *     already parsed the entire payload before the first check could run.
 *
 * ── What has not changed ────────────────────────────────────────────────────
 * No file route is opened. `blockRawFileRoutes` still answers `/files/*` with
 * 403, `File` and `IMG` are untouched, `fileUpload` stays disabled, and **no
 * public URL exists** — this route serves the owner and nobody else. The stored
 * bytes still live on the private, owner-ACL'd, deny-by-default profile row for
 * the reason recorded in `photo.ts`; that limitation is unchanged and OQ-10 /
 * S-20 stay open for the private-file architecture checkpoint.
 *
 * ── Authorisation ───────────────────────────────────────────────────────────
 * The route resolves the caller from the `X-Parse-Session-Token` header against
 * the `_Session` class, checks the session has not expired, and then reads
 * **live** `Student` role membership. It accepts no user id, no profile id, and
 * no file name from the client for anything but validation: the profile is found
 * from the session, so there is no id to substitute.
 */

import type {NextFunction, Request, Response} from 'express';
import express = require('express');
import multer = require('multer');
import {catchError} from '@90soft/parse-server-kit';

import {AppRole} from '../../utils/constants/roles';
import {getAppRoles} from '../../utils/auth/authorize';
import {PHOTO} from './constants';
import {ProfileError} from './errors';
import {profileLog} from './logging';
import {
  STORED_PHOTO_MIME,
  decodePhotoBuffer,
  encodePhotoForStorage,
  processPhoto,
} from './photo';
import {findProfileForUser, setProfilePhoto} from './repository';

/** The path, relative to the Parse mount path. */
export const PROFILE_PHOTO_PATH = '/profile-photo';

/** The multipart field the image arrives in. */
export const PROFILE_PHOTO_FIELD = 'photo';

/**
 * A simple fixed-window limiter, matching the 10-per-minute bound the cloud
 * function carried. Keyed by user id, so one Student cannot spend another's
 * budget, and pruned as it goes rather than growing forever.
 */
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX = 10;
const uploadWindows = new Map<string, {count: number; resetAt: number}>();

function withinUploadLimit(userId: string, now: number): boolean {
  for (const [key, window] of uploadWindows) {
    if (window.resetAt <= now) uploadWindows.delete(key);
  }

  const current = uploadWindows.get(userId);
  if (!current || current.resetAt <= now) {
    uploadWindows.set(userId, {count: 1, resetAt: now + UPLOAD_WINDOW_MS});
    return true;
  }
  if (current.count >= UPLOAD_MAX) return false;
  current.count += 1;
  return true;
}

/** Reset the limiter. Test-only; never called by the server. */
export function resetPhotoUploadLimits(): void {
  uploadWindows.clear();
}

/**
 * Answer with a stable code and nothing else.
 *
 * The same contract the cloud functions use, so the browser has one error
 * vocabulary to translate regardless of which path a failure came from.
 */
function fail(res: Response, status: number, code: string): void {
  res.status(status).json({error: code});
}

/**
 * Resolve the caller from the session token header.
 *
 * Reads `_Session` with the master key because the class is not client-readable,
 * and rejects an expired session explicitly rather than trusting that Parse has
 * already swept it.
 */
async function resolveSessionUser(req: Request): Promise<Parse.User | undefined> {
  const header = req.headers['x-parse-session-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== 'string' || token.trim().length === 0) return undefined;

  const query = new Parse.Query(Parse.Session);
  query.equalTo('sessionToken', token.trim());
  query.include('user');

  const [error, session] = await catchError(query.first({useMasterKey: true}));
  if (error || !session) return undefined;

  const expiresAt = (session as Parse.Object).get('expiresAt');
  if (expiresAt instanceof Date && expiresAt.getTime() <= Date.now()) return undefined;

  const user = (session as Parse.Object).get('user') as Parse.User | undefined;
  return user && typeof user.id === 'string' ? user : undefined;
}

/** Require a live Student, or answer and return `undefined`. */
async function requireStudent(
  req: Request,
  res: Response,
  op: string
): Promise<Parse.User | undefined> {
  const user = await resolveSessionUser(req);
  if (!user) {
    fail(res, 401, 'INVALID_SESSION_TOKEN');
    return undefined;
  }

  const [error, roles] = await catchError(getAppRoles(user));
  if (error || !roles) {
    fail(res, 500, ProfileError.PROFILE_UNAVAILABLE);
    return undefined;
  }

  if (!(roles as AppRole[]).includes(AppRole.STUDENT)) {
    profileLog.warn('Photo route refused for a non-Student', {
      op,
      stage: 'authorize',
      ok: false,
      userId: user.id,
      code: ProfileError.NOT_A_STUDENT,
    });
    fail(res, 403, ProfileError.NOT_A_STUDENT);
    return undefined;
  }

  return user;
}

/**
 * Multer in memory, bounded to the same 5 MiB the product allows.
 *
 * `limits.fileSize` stops the stream at the boundary, so an oversized upload is
 * refused without ever being held whole — and `files: 1` refuses a request that
 * tries to smuggle a second one past the single-field handler.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: PHOTO.maxBytes, files: 1, fields: 4},
});

/**
 * The router.
 *
 * Mounted on the Parse mount path **before** the entity-route and
 * restrict-route middleware, so it terminates its own two paths and every other
 * request falls through to them untouched.
 */
export function studentProfilePhotoRouter(): express.Router {
  const router = express.Router();

  /**
   * Serve the owner's photo.
   *
   * `private, no-store` because this is a photograph of a person served over a
   * shared path: a proxy caching it, or a browser leaving it in the disk cache
   * on a shared machine, is exactly the kind of leak having no public URL is
   * meant to prevent.
   */
  router.get(PROFILE_PHOTO_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = await requireStudent(req, res, 'getMyProfilePhoto');
      if (!user) return;

      const [error, profile] = await catchError(findProfileForUser(user));
      if (error) return fail(res, 500, ProfileError.PROFILE_UNAVAILABLE);

      const stored = (profile as Parse.Object | undefined)?.get('photoData');
      if (typeof stored !== 'string' || stored.length === 0) {
        return fail(res, 404, ProfileError.PHOTO_NOT_FOUND);
      }

      const bytes = Buffer.from(stored, 'base64');

      profileLog.info('Profile photo read', {
        op: 'getMyProfilePhoto',
        stage: 'photo',
        ok: true,
        userId: user.id,
        profileId: (profile as Parse.Object).id,
        bytes: bytes.length,
      });

      res.setHeader('Content-Type', STORED_PHOTO_MIME);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Rendered by the owner's own page; never framed or navigated to.
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).end(bytes);
    })().catch(next);
  });

  /**
   * Replace the photo.
   *
   * The new bytes overwrite the old ones in a single save, so there is no window
   * in which the Student has no photo and nothing left to clean up.
   */
  router.post(
    PROFILE_PHOTO_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single(PROFILE_PHOTO_FIELD)(req, res, (error: unknown) => {
        if (error) {
          // Includes the size limit, which fires before the body is complete.
          // The reason is never echoed: it is a multer message about somebody's
          // file.
          return fail(res, 400, ProfileError.PHOTO_REJECTED);
        }
        next();
      });
    },
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const user = await requireStudent(req, res, 'uploadMyProfilePhoto');
        if (!user) return;

        if (!withinUploadLimit(user.id as string, Date.now())) {
          return fail(res, 429, ProfileError.PHOTO_REJECTED);
        }

        const file = (req as Request & {file?: Express.Multer.File}).file;
        if (!file || !Buffer.isBuffer(file.buffer)) {
          return fail(res, 400, ProfileError.PHOTO_REJECTED);
        }

        // A photo belongs to a profile. The form saves the profile first and
        // only then uploads, so this is a client that skipped that order rather
        // than a Student who did something wrong.
        const [loadError, profile] = await catchError(findProfileForUser(user));
        if (loadError) return fail(res, 500, ProfileError.PROFILE_UNAVAILABLE);
        if (!profile) return fail(res, 400, ProfileError.PROFILE_UNAVAILABLE);

        // MIME, extension, and the actual byte signature must all agree, then
        // sharp must be able to decode it. Unchanged from the cloud-function
        // path — only the transport moved.
        let decoded: {bytes: Buffer};
        try {
          decoded = decodePhotoBuffer(file.buffer, file.originalname, file.mimetype);
        } catch {
          return fail(res, 400, ProfileError.PHOTO_REJECTED);
        }

        const [processError, processed] = await catchError(processPhoto(decoded.bytes));
        if (processError || !processed) return fail(res, 400, ProfileError.PHOTO_REJECTED);

        let encoded: string;
        try {
          encoded = encodePhotoForStorage(processed as Buffer);
        } catch {
          return fail(res, 400, ProfileError.PHOTO_REJECTED);
        }

        const [saveError, updated] = await catchError(
          setProfilePhoto(profile as Parse.Object, encoded)
        );
        if (saveError || !updated) return fail(res, 500, ProfileError.PROFILE_SAVE_FAILED);

        profileLog.info('Profile photo stored', {
          op: 'uploadMyProfilePhoto',
          stage: 'photo',
          ok: true,
          userId: user.id,
          profileId: (updated as Parse.Object).id,
          // A byte count. Never a prefix of the bytes, and never the file name:
          // people name files after themselves.
          bytes: (processed as Buffer).length,
        });

        res.status(200).json({
          ok: true,
          mimeType: STORED_PHOTO_MIME,
          bytes: (processed as Buffer).length,
        });
      })().catch(next);
    }
  );

  return router;
}
