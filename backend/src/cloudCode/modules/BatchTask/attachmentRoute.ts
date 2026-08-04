/**
 * The authenticated binary route for Task attachments ⟨CP7⟩.
 *
 * ── Why bytes never go through a cloud function ─────────────────────────────
 * Parse Server logs every cloud-function call with its serialised input and
 * result. In Checkpoint 3A that wrote a whole base64 photograph into the log on
 * every upload. Raw multipart also lets the 20 MiB limit apply **at the socket**,
 * so an oversized upload is refused mid-stream instead of being buffered whole
 * and then rejected.
 *
 * ── Downloads are always attachments ────────────────────────────────────────
 * Including — especially — HTML. An uploaded `.html` served inline would run its
 * own script in this application's origin, with the reader's session in scope.
 * `Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff` means
 * the browser saves it and never parses it. There is no inline mode, no preview
 * endpoint, and no query parameter that changes it.
 *
 * ── Replacing is store-then-swap-then-delete ────────────────────────────────
 * The new bytes land first, then the metadata points at them, and only then are
 * the old bytes removed. Any failure before the metadata succeeds removes the
 * **new** bytes and leaves the old file exactly as it was — so a failed replace
 * never costs an Admin the attachment they already had.
 */

import express = require('express');
import type {NextFunction, Request, Response} from 'express';
import multer = require('multer');

import {catchError} from '@90soft/parse-server-kit';

import {resolveSessionUser} from '../../http/session';
import {contentDisposition} from '../BatchResource/resourceRoute';
import {validateUploadedFile} from '../BatchResource/fileValidation';
import {ATTACHMENT_EXTENSIONS, ATTACHMENT_MAX_BYTES} from './constants';
import {batchAllowsTaskEditing, batchOf, describeViewer} from './access';
import {TaskError, TaskErrorCode} from './errors';
import {taskLog} from './logging';
import {findEnrollment} from '../Batch/repository';
import {findTaskById, taskHasAnySubmission, updateTask} from './repository';
import {STUDENT_VISIBLE_TASK_STATUSES, TaskStatus} from './constants';
import {newAttachmentKey, openBinaryStream, removeBinaryQuietly, storeBinary} from './storage';

export const ATTACHMENT_UPLOAD_PATH = '/task-attachment';
export const ATTACHMENT_DOWNLOAD_PATH = '/task-attachment/:taskId';
export const ATTACHMENT_FILE_FIELD = 'file';

/** A stable code, never a message. The browser owns the wording. */
function fail(res: Response, status: number, code: TaskErrorCode | string): void {
  res.status(status).json({error: code});
}

/**
 * Multer in memory, bounded to exactly the product's limit.
 *
 * `limits.fileSize` stops the stream at the boundary, so an oversized upload
 * never exists whole in memory — and `files: 1` refuses a request trying to
 * smuggle a second one past a single-field handler.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 6},
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

export function taskAttachmentRouter(): express.Router {
  const router = express.Router();

  // ══ Download ═════════════════════════════════════════════════════════════
  router.get(ATTACHMENT_DOWNLOAD_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = await requireUser(req, res);
      if (!user) return;

      const raw = req.params['taskId'];
      const task = await findTaskById(typeof raw === 'string' ? raw : '');
      if (!task) {
        fail(res, 404, TaskError.TASK_NOT_FOUND);
        return;
      }

      // The Batch comes from the Task, never from anything the caller sent.
      const batch = batchOf(task);
      if (!batch) {
        fail(res, 404, TaskError.TASK_NOT_FOUND);
        return;
      }

      const viewer = await describeViewer(user);
      let allowed = viewer.isAdmin;

      if (!allowed && viewer.isStudent) {
        // A Student may download only what they can already see: a visible Task
        // in a Batch they belong to. A Draft Task's brief is not theirs yet.
        const visible = STUDENT_VISIBLE_TASK_STATUSES.includes(task.get('status') as TaskStatus);
        if (visible) {
          const enrollment = await findEnrollment(batch.id as string, user);
          allowed = Boolean(enrollment);
        }
      }

      if (!allowed) {
        // 404, not 403. "You may not have this" confirms it exists; somebody
        // probing ids would learn which Tasks are real.
        taskLog.warn('Attachment download refused', {
          op: 'downloadTaskAttachment',
          stage: 'authorize',
          ok: false,
          userId: user.id,
          batchId: batch.id,
          taskId: task.id,
          code: TaskError.TASK_NOT_FOUND,
        });
        fail(res, 404, TaskError.TASK_NOT_FOUND);
        return;
      }

      const storageKey = String(task.get('attachmentStorageKey') ?? '');
      if (!storageKey) {
        fail(res, 404, TaskError.TASK_NOT_FOUND);
        return;
      }

      const opened = await openBinaryStream(storageKey);
      if (!opened) {
        fail(res, 404, TaskError.TASK_NOT_FOUND);
        return;
      }

      const filename = String(task.get('attachmentFilename') ?? 'attachment');
      const mimeType = String(task.get('attachmentMimeType') ?? 'application/octet-stream');

      // ── Headers, before a single byte ────────────────────────────────────
      res.setHeader('Content-Type', mimeType);
      // Always an attachment. HTML included; there is no other mode.
      res.setHeader('Content-Disposition', contentDisposition(filename));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Accept-Ranges', 'none');
      if (typeof opened.length === 'number') {
        res.setHeader('Content-Length', String(opened.length));
      }

      taskLog.info('Attachment download started', {
        op: 'downloadTaskAttachment',
        stage: 'stream',
        ok: true,
        userId: user.id,
        batchId: batch.id,
        taskId: task.id,
        extension: String(task.get('attachmentExtension') ?? ''),
        bytes: Number(task.get('attachmentSize') ?? 0),
      });

      opened.stream.on('error', () => {
        // Once bytes are on the wire the status is already sent, so there is
        // nothing to report but the connection ending. A stream error can name
        // a storage path, so the reason stays server-side.
        taskLog.error('Attachment stream failed', {
          op: 'downloadTaskAttachment',
          stage: 'stream',
          ok: false,
          taskId: task.id,
          code: TaskError.TASK_ATTACHMENT_FAILED,
        });
        res.destroy();
      });

      opened.stream.pipe(res);
    })().catch(() => {
      if (!res.headersSent) fail(res, 500, TaskError.TASK_ATTACHMENT_FAILED);
      else res.destroy();
    });

    void next;
  });

  // ══ Upload and replace ═══════════════════════════════════════════════════
  router.post(
    ATTACHMENT_UPLOAD_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single(ATTACHMENT_FILE_FIELD)(req, res, (error: unknown) => {
        if (error) {
          // The reason is never echoed: it is a multer message about somebody's
          // file. Size is the one case worth distinguishing, because the UI can
          // say something useful about it.
          const code = (error as {code?: string})?.code;
          if (code === 'LIMIT_FILE_SIZE') {
            fail(res, 413, TaskError.TASK_ATTACHMENT_TOO_LARGE);
          } else {
            fail(res, 400, TaskError.TASK_ATTACHMENT_INVALID);
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
        if (!viewer.isAdmin) {
          fail(res, 404, TaskError.TASK_NOT_FOUND);
          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const taskId = typeof body['taskId'] === 'string' ? body['taskId'].trim() : '';
        if (taskId.length === 0) {
          fail(res, 404, TaskError.TASK_NOT_FOUND);
          return;
        }

        const task = await findTaskById(taskId);
        if (!task) {
          fail(res, 404, TaskError.TASK_NOT_FOUND);
          return;
        }

        const batch = batchOf(task);
        if (!batch || !batchAllowsTaskEditing(batch)) {
          fail(res, 403, TaskError.BATCH_NOT_ACTIVE);
          return;
        }

        // The attachment freezes with the requirements: a Student who answered
        // a brief must keep the brief they answered.
        if (await taskHasAnySubmission(task.id)) {
          fail(res, 403, TaskError.TASK_NOT_EDITABLE);
          return;
        }

        const file = (req as Request & {file?: Express.Multer.File}).file;
        if (!file || !file.buffer) {
          fail(res, 400, TaskError.TASK_ATTACHMENT_INVALID);
          return;
        }

        // Reuses the Resource validator, which already knows how to tell a real
        // `.docx` from a renamed JAR by reading the ZIP central directory.
        const check = validateUploadedFile({
          originalName: file.originalname,
          declaredMimeType: file.mimetype,
          buffer: file.buffer,
        });

        if (!check.ok) {
          taskLog.warn('Attachment refused', {
            op: 'uploadTaskAttachment',
            stage: 'validate',
            ok: false,
            userId: user.id,
            taskId: task.id,
            code: check.reason.code,
            bytes: file.buffer.length,
          });
          const status = check.reason.code === 'RESOURCE_TOO_LARGE' ? 413 : 400;
          fail(
            res,
            status,
            status === 413 ? TaskError.TASK_ATTACHMENT_TOO_LARGE : TaskError.TASK_ATTACHMENT_INVALID
          );
          return;
        }

        // A Task brief is a document. The Resource allow-list is wider, so the
        // narrower Task list is applied on top of it.
        if (!ATTACHMENT_EXTENSIONS.includes(check.file.extension)) {
          fail(res, 400, TaskError.TASK_ATTACHMENT_INVALID);
          return;
        }

        // ── Store the new bytes, then point at them, then drop the old ─────
        const previousKey = String(task.get('attachmentStorageKey') ?? '');
        const storageKey = newAttachmentKey();

        const [storeError] = await catchError(
          storeBinary(storageKey, file.buffer, check.file.mimeType)
        );
        if (storeError) {
          fail(res, 500, TaskError.TASK_ATTACHMENT_FAILED);
          return;
        }

        const [saveError] = await catchError(
          updateTask(task, {
            attachmentStorageKey: storageKey,
            attachmentFilename: check.file.filename,
            attachmentExtension: check.file.extension,
            attachmentMimeType: check.file.mimeType,
            attachmentSize: check.file.size,
          })
        );

        if (saveError) {
          // The new bytes landed and the metadata did not. Remove only the new
          // ones — the old attachment is still referenced and still works.
          await removeBinaryQuietly(storageKey);
          taskLog.error('Attachment metadata failed after storing bytes', {
            op: 'uploadTaskAttachment',
            stage: 'persist',
            ok: false,
            userId: user.id,
            taskId: task.id,
            code: TaskError.TASK_ATTACHMENT_FAILED,
          });
          fail(res, 500, TaskError.TASK_ATTACHMENT_FAILED);
          return;
        }

        // Only now is the previous file unreferenced.
        if (previousKey && previousKey !== storageKey) await removeBinaryQuietly(previousKey);

        taskLog.info('Attachment stored', {
          op: 'uploadTaskAttachment',
          stage: 'attach',
          ok: true,
          userId: user.id,
          batchId: batch.id,
          taskId: task.id,
          extension: check.file.extension,
          bytes: check.file.size,
        });

        res.status(200).json({
          attachment: {
            filename: check.file.filename,
            extension: check.file.extension,
            kind: check.file.extension.replace(/^\./, '') === 'htm' ? 'html' : check.file.extension.replace(/^\./, ''),
            size: check.file.size,
          },
        });
      })().catch(() => {
        if (!res.headersSent) fail(res, 500, TaskError.TASK_ATTACHMENT_FAILED);
      });
    }
  );

  return router;
}
