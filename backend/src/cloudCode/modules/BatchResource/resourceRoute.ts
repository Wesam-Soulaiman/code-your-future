/**
 * The authenticated binary route for Batch Resources ⟨CP5⟩.
 *
 * ── Why bytes never go through a cloud function ─────────────────────────────
 * Parse Server logs every cloud-function call with its serialised input and
 * result. In Checkpoint 3A that wrote a whole base64 photograph into the log on
 * every upload. Raw multipart also lets the 20 MiB limit apply **at the socket**,
 * so an oversized upload is refused mid-stream instead of being buffered whole
 * and then rejected.
 *
 * ── What this route does not open ───────────────────────────────────────────
 * `/api/files/*` is still 403. `File` and `IMG` are untouched. No public URL is
 * created, no storage key is ever sent, and nothing here is reachable without a
 * session. It terminates its own two paths and lets every other request fall
 * through.
 *
 * ── Downloads are always attachments ────────────────────────────────────────
 * Including — especially — HTML. An uploaded `.html` served inline would run its
 * own script in the application's origin, with the reader's session cookie in
 * scope. `Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff`
 * means the browser saves it and never parses it. There is no inline mode, no
 * preview endpoint, and no query parameter that changes this.
 */

import express = require('express');
import type {NextFunction, Request, Response} from 'express';
import multer = require('multer');

import {catchError} from '@90soft/parse-server-kit';

import {resolveSessionUser} from '../../http/session';
import {RESOURCE_MAX_BYTES} from './constants';
import {
  batchOf,
  canReadBatchResources,
  describeViewer,
  requireWriteAccess,
} from './access';
import {toResourceDto} from './dto';
import {ResourceError, ResourceErrorCode} from './errors';
import {resourceLog} from './logging';
import {
  createResource,
  findResourceById,
  nextDisplayOrder,
} from './repository';
import {findBatchById} from '../Batch/repository';
import {newStorageKey, openBinaryStream, removeBinaryQuietly, storeBinary} from './storage';
import {validateUploadedFile} from './fileValidation';
import {validateResourceMetadata} from './validation';

export const RESOURCE_UPLOAD_PATH = '/batch-resource';
export const RESOURCE_DOWNLOAD_PATH = '/batch-resource/:resourceId';
export const RESOURCE_FILE_FIELD = 'file';

/** A stable code, never a message. The browser owns the wording. */
function fail(res: Response, status: number, code: ResourceErrorCode | string): void {
  res.status(status).json({error: code});
}

/**
 * Multer in memory, bounded to exactly the product's limit.
 *
 * `limits.fileSize` stops the stream at the boundary, so an oversized upload
 * never exists whole in memory — and `files: 1` refuses a request trying to
 * smuggle a second one past a single-field handler.
 *
 * Memory rather than disk: at 20 MiB a temporary file would need its own
 * lifecycle, its own cleanup on every failure path, and its own permissions.
 * One bounded buffer that the process drops on return is less to get wrong.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: RESOURCE_MAX_BYTES, files: 1, fields: 6},
});

/** Require a live session, or answer 401 and return undefined. */
async function requireUser(req: Request, res: Response): Promise<Parse.User | undefined> {
  const user = await resolveSessionUser(req);
  if (!user) {
    fail(res, 401, 'INVALID_SESSION_TOKEN');
    return undefined;
  }
  return user;
}

export function batchResourceRouter(): express.Router {
  const router = express.Router();

  // ══ Download ═════════════════════════════════════════════════════════════
  router.get(RESOURCE_DOWNLOAD_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = await requireUser(req, res);
      if (!user) return;

      const raw = req.params['resourceId'];
      const resource = await findResourceById(typeof raw === 'string' ? raw : '');
      if (!resource) {
        fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
        return;
      }

      // The Batch comes from the Resource, never from anything the caller sent.
      // A request naming both invites them to disagree, and the caller picks.
      const batch = batchOf(resource);
      if (!batch) {
        fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
        return;
      }

      const viewer = await describeViewer(user);
      const allowed = await canReadBatchResources(viewer, batch.id as string);
      if (!allowed) {
        // 404, not 403. "You may not have this" confirms it exists; a Student
        // probing ids would learn which Resources are real. A Resource they
        // cannot read answers exactly as a made-up id does.
        resourceLog.warn('Resource download refused', {
          op: 'downloadResource',
          stage: 'authorize',
          ok: false,
          userId: user.id,
          batchId: batch.id,
          resourceId: resource.id,
          code: ResourceError.RESOURCE_NOT_FOUND,
        });
        fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
        return;
      }

      const storageKey = String(resource.get('storageKey') ?? '');
      const opened = await openBinaryStream(storageKey);
      if (!opened) {
        fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
        return;
      }

      const filename = String(resource.get('filename') ?? 'resource');
      const mimeType = String(resource.get('mimeType') ?? 'application/octet-stream');

      // ── Headers, before a single byte ────────────────────────────────────
      res.setHeader('Content-Type', mimeType);
      // Always an attachment. HTML included; there is no other mode.
      res.setHeader('Content-Disposition', contentDisposition(filename));
      // Do not let a browser second-guess the type and render it anyway.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      // Belt and braces for a document that somehow reaches a rendering context.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      // Range requests are not supported, and saying so is better than pretending.
      res.setHeader('Accept-Ranges', 'none');
      if (typeof opened.length === 'number') {
        res.setHeader('Content-Length', String(opened.length));
      }

      resourceLog.info('Resource download started', {
        op: 'downloadResource',
        stage: 'stream',
        ok: true,
        userId: user.id,
        batchId: batch.id,
        resourceId: resource.id,
        extension: String(resource.get('extension') ?? ''),
        bytes: Number(resource.get('fileSize') ?? 0),
      });

      // Streamed, not buffered: a 20 MiB file never exists whole in memory.
      opened.stream.on('error', () => {
        // Once bytes are on the wire the status is already sent, so there is
        // nothing to report to the caller but the connection ending. The reason
        // stays server-side; a stream error can name a storage path.
        resourceLog.error('Resource stream failed', {
          op: 'downloadResource',
          stage: 'stream',
          ok: false,
          resourceId: resource.id,
          code: ResourceError.RESOURCE_NOT_FOUND,
        });
        res.destroy();
      });

      opened.stream.pipe(res);
    })().catch(() => {
      if (!res.headersSent) fail(res, 500, ResourceError.RESOURCE_NOT_FOUND);
      else res.destroy();
    });

    void next;
  });

  // ══ Upload ═══════════════════════════════════════════════════════════════
  router.post(
    RESOURCE_UPLOAD_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single(RESOURCE_FILE_FIELD)(req, res, (error: unknown) => {
        if (error) {
          // The reason is never echoed: it is a multer message about somebody's
          // file. Size is the one case worth distinguishing, because the UI can
          // say something useful about it.
          const code = (error as {code?: string})?.code;
          if (code === 'LIMIT_FILE_SIZE') {
            fail(res, 413, ResourceError.RESOURCE_TOO_LARGE);
          } else {
            fail(res, 400, ResourceError.RESOURCE_VALIDATION_FAILED);
          }
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      void (async () => {
        const user = await requireUser(req, res);
        if (!user) return;

        const viewer = await describeViewer(user);

        const body = (req.body ?? {}) as Record<string, unknown>;
        const batchId = typeof body['batchId'] === 'string' ? body['batchId'].trim() : '';
        if (batchId.length === 0) {
          fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
          return;
        }

        const [batchError2, batch] = await catchError(findBatchById(batchId));
        if (batchError2 || !batch) {
          fail(res, 404, ResourceError.RESOURCE_NOT_FOUND);
          return;
        }

        // Admin, and not an archived Batch. Throws a Parse.Error carrying the
        // stable code, which the wrapper below turns into a status.
        try {
          requireWriteAccess(viewer, batch as Parse.Object, 'uploadResource');
        } catch {
          fail(res, 403, ResourceError.RESOURCE_ACCESS_DENIED);
          return;
        }

        // ── The metadata ───────────────────────────────────────────────────
        const {values, errors} = validateResourceMetadata(body);
        if (Object.keys(errors).length > 0) {
          res
            .status(400)
            .json({error: `${ResourceError.RESOURCE_VALIDATION_FAILED}:${JSON.stringify(errors)}`});
          return;
        }

        // ── The file ───────────────────────────────────────────────────────
        const file = (req as Request & {file?: Express.Multer.File}).file;
        if (!file || !file.buffer) {
          fail(res, 400, ResourceError.RESOURCE_EMPTY);
          return;
        }

        const check = validateUploadedFile({
          originalName: file.originalname,
          declaredMimeType: file.mimetype,
          buffer: file.buffer,
        });

        if (!check.ok) {
          resourceLog.warn('Resource upload refused', {
            op: 'uploadResource',
            stage: 'validate',
            ok: false,
            userId: user.id,
            batchId: batch.id,
            code: check.reason.code,
            bytes: file.buffer.length,
          });
          const status = check.reason.code === ResourceError.RESOURCE_TOO_LARGE ? 413 : 400;
          fail(res, status, check.reason.code);
          return;
        }

        // ── Store the bytes, then the row ──────────────────────────────────
        //
        // This order is deliberate. A row that points at bytes which are not
        // there is a Resource people can see and click that 404s. Bytes with no
        // row are invisible and reclaimable — and are cleaned up immediately
        // below if the row fails.
        const storageKey = newStorageKey();

        const [storeError] = await catchError(
          storeBinary(storageKey, file.buffer, check.file.mimeType)
        );
        if (storeError) {
          fail(res, 500, ResourceError.RESOURCE_UPLOAD_FAILED);
          return;
        }

        const [orderError, displayOrder] = await catchError(
          nextDisplayOrder(batch.id as string)
        );
        if (orderError) {
          await removeBinaryQuietly(storageKey);
          fail(res, 500, ResourceError.RESOURCE_UPLOAD_FAILED);
          return;
        }

        const [createError, resource] = await catchError(
          createResource({
            batchId: batch.id as string,
            title: values.title,
            description: values.description,
            filename: check.file.filename,
            extension: check.file.extension,
            mimeType: check.file.mimeType,
            fileSize: check.file.size,
            storageKey,
            uploadedBy: user,
            displayOrder: displayOrder as number,
          })
        );

        if (createError || !resource) {
          // The bytes landed and the row did not. Clean up rather than leaving
          // an orphan nobody will ever look for.
          await removeBinaryQuietly(storageKey);
          resourceLog.error('Resource metadata failed after storing bytes', {
            op: 'uploadResource',
            stage: 'persist',
            ok: false,
            userId: user.id,
            batchId: batch.id,
            code: ResourceError.RESOURCE_UPLOAD_FAILED,
          });
          fail(res, 500, ResourceError.RESOURCE_UPLOAD_FAILED);
          return;
        }

        resourceLog.info('Resource uploaded', {
          op: 'uploadResource',
          stage: 'complete',
          ok: true,
          userId: user.id,
          batchId: batch.id,
          resourceId: (resource as Parse.Object).id,
          extension: check.file.extension,
          bytes: check.file.size,
        });

        res.status(200).json(toResourceDto(resource as Parse.Object));
      })().catch(() => {
        if (!res.headersSent) fail(res, 500, ResourceError.RESOURCE_UPLOAD_FAILED);
      });
    }
  );

  return router;
}

/**
 * A `Content-Disposition` value that survives a non-ASCII filename.
 *
 * The plain `filename=` parameter is ASCII-only, so anything else is stripped
 * for it and the real name is carried in `filename*` (RFC 5987), which every
 * current browser prefers. An Arabic document keeps its name; a browser that
 * only understands the old parameter still gets something sensible rather than
 * mojibake.
 *
 * The name is already sanitised — no quotes, no semicolons, no control
 * characters — so it cannot terminate the parameter or inject a second header.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
