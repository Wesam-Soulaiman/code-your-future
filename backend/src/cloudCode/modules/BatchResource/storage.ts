/**
 * Private binary storage for Batch Resources ⟨CP5⟩ — **the answer to OQ-10 / S-20**.
 *
 * ── The problem this had to solve ───────────────────────────────────────────
 * `Parse.File` is unusable from cloud code in this deployment, and that is not
 * a style preference. Parse's `FilesRouter` is not part of the router
 * `directAccess` uses, so `Parse.File.save()` falls back to an HTTP request
 * against the server's own `serverURL` — which `blockRawFileRoutes` refuses,
 * correctly. `getData()` fails the same way. That is S-20, and it is why the
 * Checkpoint 3A profile photo stores bounded, re-encoded bytes inline on its own
 * private row: a workable answer for a ≤1 MiB WebP, and no answer at all for a
 * 20 MiB PDF.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 * **MongoDB GridFS, through the files adapter Parse Server already has.** The
 * default adapter *is* `GridFSBucketAdapter`, already connected to the same
 * database, so this introduces no new dependency, no second connection, and no
 * new operational surface. It is reached directly, in-process — the HTTP route
 * that S-20 blocks is never involved.
 *
 * Uploads are **piped** into GridFS and downloads are **streamed** out of it, so
 * a 20 MiB file is never held whole in application memory.
 *
 * ── Why not `getFileData` or `handleFileStream` ─────────────────────────────
 * The adapter has both, and neither fits:
 *
 *   - `getFileData` reads the entire file into a Buffer. That is exactly what a
 *     20 MiB limit is meant to avoid.
 *   - `handleFileStream` is a **range** handler: it calls `req.get('Range')`
 *     unconditionally (so it throws on an ordinary download), always answers
 *     206, and sets no `Content-Disposition`. A Resource download must be a
 *     plain 200 attachment.
 *
 * So the bucket is opened directly for reads. That is the one place this module
 * reaches past the adapter's public surface, and it is guarded and explained
 * below.
 *
 * ── What never leaves the server ────────────────────────────────────────────
 * The storage key. It is 128 bits of randomness, it is in `protectedFields` on
 * the model, it is absent from every DTO, and it is absent from the logging
 * allow-list. A browser addresses a Resource by its `objectId` and nothing else;
 * no public URL is ever produced, and `/api/files/*` stays closed.
 */

import {randomBytes} from 'crypto';
import type {Readable} from 'stream';

import {catchError} from '@90soft/parse-server-kit';

import {ResourceError, resourceError} from './errors';
import {STORAGE_KEY_BYTES, STORAGE_KEY_PREFIX} from './constants';
import {describeFailure, resourceLog} from './logging';

/**
 * The slice of Parse's files adapter this module uses.
 *
 * Declared structurally rather than imported, so a parse-server upgrade that
 * moves the class cannot break the build — it would surface as a startup-time
 * capability check instead, which is the failure we can actually report well.
 */
interface FilesAdapterLike {
  createFile(
    filename: string,
    data: Buffer | Readable,
    contentType?: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  deleteFile(filename: string): Promise<unknown>;
  /** Present on `GridFSBucketAdapter`. Feature-detected before use. */
  _getBucket?(): Promise<GridFsBucketLike>;
}

interface GridFsBucketLike {
  openDownloadStreamByName(filename: string): Readable;
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): {toArray(): Promise<{_id: unknown; length?: number}[]>};
}

/** Set once at startup, so nothing has to reach into Parse config per request. */
let filesAdapter: FilesAdapterLike | undefined;

/**
 * Hand this module the adapter Parse is already using.
 *
 * Called once during startup, **after** Parse Server is initialised. Kept
 * explicit rather than reaching into `Parse.Server` on every call: a single
 * wiring point is one place to check, and it makes the capability check below
 * happen at boot rather than under a user's upload.
 */
export function useFilesAdapter(adapter: unknown): void {
  filesAdapter = adapter as FilesAdapterLike;
}

/** True when the wired adapter can do everything this module needs. */
export function storageIsUsable(): boolean {
  return (
    typeof filesAdapter?.createFile === 'function' &&
    typeof filesAdapter?.deleteFile === 'function' &&
    typeof filesAdapter?._getBucket === 'function'
  );
}

function requireAdapter(): FilesAdapterLike {
  if (!storageIsUsable()) {
    // Never surfaced to a caller as anything but a stable code.
    throw resourceError(ResourceError.RESOURCE_UPLOAD_FAILED);
  }
  return filesAdapter as FilesAdapterLike;
}

/**
 * A storage key nobody can guess and nothing can collide with.
 *
 * Prefixed so a Resource binary is identifiable in the bucket during an
 * operational investigation, and random enough that knowing one tells you
 * nothing about any other. It is **not** derived from the filename, the Batch,
 * or the uploader — a key that encodes anything is a key that leaks it.
 */
export function newStorageKey(): string {
  return `${STORAGE_KEY_PREFIX}${randomBytes(STORAGE_KEY_BYTES).toString('hex')}`;
}

/**
 * Write bytes to private storage.
 *
 * `data` may be a Buffer or a readable stream; the adapter pipes a stream
 * straight into GridFS. Returns nothing useful on purpose — the caller already
 * holds the key it generated, and there is no second identifier to leak.
 */
export async function storeBinary(
  storageKey: string,
  data: Buffer | Readable,
  contentType: string
): Promise<void> {
  const adapter = requireAdapter();

  const [error] = await catchError(adapter.createFile(storageKey, data, contentType));
  if (error) {
    // The driver's message can name the database, so only the code leaves — but
    // it is written here, redacted, or the failure is undiagnosable.
    resourceLog.error('Storing a resource binary failed', {
      op: 'storeBinary',
      stage: 'store',
      ok: false,
      code: ResourceError.RESOURCE_UPLOAD_FAILED,
      ...describeFailure(error),
    });
    throw resourceError(ResourceError.RESOURCE_UPLOAD_FAILED);
  }
}

/**
 * Delete bytes from private storage.
 *
 * **Idempotent.** The adapter throws `FileNotFound` when nothing matches, and a
 * second delete of an already-deleted Resource is an ordinary thing to happen —
 * a retried request, a cleanup after a half-finished upload. Treating that as a
 * failure would leave callers unable to tidy up.
 *
 * Returns `true` when bytes were removed, `false` when there was nothing to
 * remove. Both are success.
 */
export async function removeBinary(storageKey: string): Promise<boolean> {
  if (!storageKey) return false;
  const adapter = requireAdapter();

  const [error] = await catchError(adapter.deleteFile(storageKey));
  if (!error) return true;

  const message = (error as Error)?.message ?? '';
  if (message.includes('FileNotFound')) return false;

  resourceLog.error('Deleting a resource binary failed', {
    op: 'removeBinary',
    ok: false,
    code: ResourceError.RESOURCE_DELETE_FAILED,
  });
  throw resourceError(ResourceError.RESOURCE_DELETE_FAILED);
}

/**
 * Best-effort cleanup after a failed upload.
 *
 * Used on the path where the bytes landed but the metadata row did not. It
 * never throws: the caller is already failing the request for a reason it will
 * report, and a cleanup failure must not replace that reason with a worse one.
 * What it must not do is stay silent — an orphan that nobody knows about is the
 * thing this exists to prevent.
 */
export async function removeBinaryQuietly(storageKey: string): Promise<void> {
  const [error] = await catchError(removeBinary(storageKey));
  if (error) {
    resourceLog.warn('An orphaned resource binary could not be cleaned up', {
      op: 'removeBinaryQuietly',
      ok: false,
      code: ResourceError.RESOURCE_DELETE_FAILED,
    });
  }
}

/**
 * A readable stream of the stored bytes, or `undefined` when there are none.
 *
 * Existence is checked before the stream is opened so a missing binary becomes a
 * clean 404 rather than a stream that errors after the response has started —
 * once bytes are on the wire there is no way to change the status code.
 */
export async function openBinaryStream(
  storageKey: string
): Promise<{stream: Readable; length?: number} | undefined> {
  const adapter = requireAdapter();

  // The one place this module reaches past the adapter's public surface. See
  // the note at the top: neither public read method can produce a plain,
  // streamed, attachment-dispositioned 200.
  const [bucketError, bucket] = await catchError(adapter._getBucket!());
  if (bucketError || !bucket) return undefined;

  const [findError, files] = await catchError(
    (bucket as GridFsBucketLike).find({filename: storageKey}, {limit: 1}).toArray()
  );
  if (findError || !files || files.length === 0) return undefined;

  return {
    stream: (bucket as GridFsBucketLike).openDownloadStreamByName(storageKey),
    length: typeof files[0].length === 'number' ? files[0].length : undefined,
  };
}
