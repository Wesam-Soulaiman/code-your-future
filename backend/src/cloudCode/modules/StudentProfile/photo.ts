/**
 * Profile photo — validation, storage, and retrieval.
 *
 * ── Why the bytes are stored inline, not as a `Parse.File` ──────────────────
 * Checkpoint 1 closed Parse's raw file endpoint: `blockRawFileRoutes` answers
 * `/api/files/*` with 403. Parse's `FilesRouter` is **not** part of the router
 * that `directAccess` uses, so a `Parse.File.save()` inside cloud code cannot be
 * routed internally — Parse falls back to a real HTTP request to its own
 * `serverURL` and is refused by that block. `getData()` hits the same wall on
 * the way back. `IMG` is worse still: its `beforeSave` re-downloads the file it
 * just saved, so it cannot work either.
 *
 * Re-opening the endpoint would undo a security control, and `models/File.ts`,
 * `models/IMG.ts`, and `utils/` are protected paths. The processed bytes
 * therefore live on the profile itself — already deny-by-default, already
 * owner-ACL'd, and with no URL in existence to leak. Found by runtime
 * validation, not by any unit test.
 *
 * ── Validation ──────────────────────────────────────────────────────────────
 * Three independent checks, because each alone is forgeable:
 *
 *   1. the declared MIME type is on the allow-list;
 *   2. the filename extension is on the allow-list;
 *   3. the **actual bytes** carry a matching image signature.
 *
 * Then `sharp` must be able to decode it. A file that passes all four is an
 * image, whatever it claims to be. It is re-encoded to WebP, which also strips
 * EXIF — including the GPS coordinates phone cameras attach.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * The processed bytes are held on the profile, stripped by `protectedFields` and
 * absent from every DTO. They come back only through the authenticated binary
 * route in `photoRoute.ts`, which has already matched the caller to the profile
 * — there is no public URL and no id to substitute.
 */

import sharp = require('sharp');
import {catchError} from '@90soft/parse-server-kit';

import {PHOTO, PHOTO_SIGNATURES} from './constants';
import {ProfileError, profileError} from './errors';

export interface DecodedPhoto {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Validate an uploaded photo that already arrived as raw bytes.
 *
 * The image now travels as multipart rather than base64 ⟨CP3A catalog⟩, so
 * there is nothing to decode: multer hands over the buffer, and the size limit
 * has already been applied at the socket. The three independent checks are
 * unchanged, because each alone is forgeable — a filename and a `Content-Type`
 * are both attacker-controlled, and only the bytes say what the file is.
 */
export function decodePhotoBuffer(
  bytes: Buffer,
  rawFileName: unknown,
  rawMimeType: unknown
): DecodedPhoto {
  if (!Buffer.isBuffer(bytes)) throw profileError(ProfileError.PHOTO_REJECTED);

  // An empty upload is not a photo.
  if (bytes.length === 0) throw profileError(ProfileError.PHOTO_REJECTED);
  if (bytes.length > PHOTO.maxBytes) throw profileError(ProfileError.PHOTO_REJECTED);

  const declaredMime = String(rawMimeType ?? '').toLowerCase().trim();
  if (!PHOTO.mimeTypes.includes(declaredMime)) {
    throw profileError(ProfileError.PHOTO_REJECTED);
  }

  const fileName = String(rawFileName ?? '');
  const extension = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  if (!PHOTO.extensions.includes(extension)) {
    throw profileError(ProfileError.PHOTO_REJECTED);
  }

  // The bytes themselves must agree with what was claimed.
  const signature = PHOTO_SIGNATURES.find(candidate => candidate.test(bytes));
  if (!signature) throw profileError(ProfileError.PHOTO_REJECTED);
  if (signature.mime !== declaredMime) throw profileError(ProfileError.PHOTO_REJECTED);

  return {bytes, mimeType: signature.mime};
}

/**
 * Re-encode to a bounded WebP.
 *
 * Doing this server-side means the stored bytes are always something we
 * produced: no embedded metadata, no polyglot file, no decompression bomb — the
 * dimensions are capped and `sharp` refuses anything it cannot decode.
 */
export async function processPhoto(bytes: Buffer): Promise<Buffer> {
  const [error, output] = await catchError(
    sharp(bytes)
      .rotate() // honour EXIF orientation before the data is stripped
      .resize({width: PHOTO.maxWidth, withoutEnlargement: true})
      .webp({quality: PHOTO.quality})
      .toBuffer()
  );

  if (error || !output) throw profileError(ProfileError.PHOTO_REJECTED);
  return output as Buffer;
}

/**
 * The largest processed photo we will store.
 *
 * A WebP capped at 1024px is normally well under this; the bound exists so a
 * pathological image cannot grow the profile document without limit.
 */
export const MAX_STORED_PHOTO_BYTES = 1024 * 1024;

/** Encode processed bytes for storage. Rejects anything implausibly large. */
export function encodePhotoForStorage(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > MAX_STORED_PHOTO_BYTES) {
    throw profileError(ProfileError.PHOTO_REJECTED);
  }
  return bytes.toString('base64');
}

/** The stored MIME type. Every photo is re-encoded, so this is always WebP. */
export const STORED_PHOTO_MIME = 'image/webp';
