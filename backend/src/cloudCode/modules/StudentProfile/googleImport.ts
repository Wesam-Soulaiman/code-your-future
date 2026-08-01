/**
 * Importing a Student's Google name and photo, once.
 *
 * ── What "once" means, and why it matters ───────────────────────────────────
 * The name is a **suggestion**: it is prefilled into the form, and whatever the
 * Student submits is what gets stored. The photo is imported on the save that
 * **creates** the profile, and never again.
 *
 * Both halves of that are deliberate. A Student who corrects the spelling of
 * their own name, or removes a photo they did not choose, has made a decision —
 * and a product that quietly re-imposes Google's version on the next sign-in has
 * not let them change anything, it has only let them see the change disappear.
 * Importing exactly once is what makes "you can change this" true.
 *
 * ── Fetching an image named by a token ──────────────────────────────────────
 * The URL arrives inside a Google ID token. It is verified and therefore
 * trustworthy in practice, but "the backend fetches a URL a request named" is
 * the shape of a server-side request forgery whatever the source, so it is
 * treated as untrusted:
 *
 *   - the host is pinned to Google's own image domains at capture time, before
 *     the URL is ever stored (`isGooglePictureUrl`);
 *   - it is re-checked here, because the stored value and the check that
 *     admitted it are separated by time and a database;
 *   - `https:` only, so a network position cannot swap the image;
 *   - **redirects are refused outright** — following one would let a pinned host
 *     hand off to an unpinned one, which defeats the pinning;
 *   - the request carries no credentials and no cookies;
 *   - it is bounded by a timeout and by the same 5 MiB the upload endpoint
 *     allows, checked against `Content-Length` *and* against the bytes actually
 *     read, because a header is not a promise.
 *
 * What comes back is then put through **exactly** the upload validation: MIME,
 * extension, real byte signature, and a `sharp` decode, then re-encoded to a
 * bounded WebP. Google is a trustworthy source of a photograph, not a reason to
 * skip checking that what arrived is one.
 *
 * ── Best effort, always ─────────────────────────────────────────────────────
 * Nothing here throws to its caller. A Student whose avatar is missing, slow, or
 * malformed gets a profile with no photo and a Replace button — not a failed
 * save.
 */

import {catchError} from '@90soft/parse-server-kit';

import {isGooglePictureUrl} from '../StudentAuth/googleVerifier';
import {PHOTO} from './constants';
import {profileLog} from './logging';
import {decodePhotoBuffer, encodePhotoForStorage, processPhoto} from './photo';

/** How long the fetch may take. It sits on the critical path of a first save. */
const FETCH_TIMEOUT_MS = 4000;

/** Google serves avatars as JPEG or PNG; the extension is implied, not present. */
const IMPORT_FILE_NAMES: Record<string, string> = {
  'image/jpeg': 'google-avatar.jpg',
  'image/png': 'google-avatar.png',
  'image/webp': 'google-avatar.webp',
};

/**
 * The Google avatar URL captured for a Student at first sign-in, if any.
 *
 * Read with the master key because `StudentAuthIdentity` is deny-by-default,
 * and looked up **by the authenticated user**, never by an id from a request.
 */
export async function findProviderPictureUrl(user: Parse.User): Promise<string | undefined> {
  const query = new Parse.Query('StudentAuthIdentity');
  query.equalTo('user', user);
  query.select('providerPictureUrl');

  const [error, identity] = await catchError(query.first({useMasterKey: true}));
  if (error || !identity) return undefined;

  const url = (identity as Parse.Object).get('providerPictureUrl');
  // Re-checked rather than trusted: the check that admitted this value and this
  // read are separated by time and a database.
  return isGooglePictureUrl(url) ? String(url) : undefined;
}

/**
 * Download an avatar, bounded in time and size.
 *
 * Returns the bytes and the declared type, or `undefined`. Never throws.
 */
export async function fetchGoogleAvatar(
  url: string
): Promise<{bytes: Buffer; mimeType: string} | undefined> {
  if (!isGooglePictureUrl(url)) return undefined;

  const [error, response] = await catchError(
    fetch(url, {
      // Following a redirect would let a pinned host hand off to an unpinned
      // one, which is the whole attack the pinning exists to stop.
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {Accept: PHOTO.mimeTypes.join(',')},
    })
  );

  if (error || !response || !(response as Response).ok) return undefined;
  const result = response as Response;

  const mimeType = (result.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!PHOTO.mimeTypes.includes(mimeType)) return undefined;

  // A declared length over the bound is refused before a single byte is read.
  const declared = Number(result.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > PHOTO.maxBytes) return undefined;

  const [readError, buffer] = await catchError(result.arrayBuffer());
  if (readError || !buffer) return undefined;

  const bytes = Buffer.from(buffer as ArrayBuffer);
  // Checked again against what actually arrived: a `Content-Length` header is a
  // claim, not a guarantee.
  if (bytes.length === 0 || bytes.length > PHOTO.maxBytes) return undefined;

  return {bytes, mimeType};
}

/**
 * Import the Google avatar onto a freshly created profile.
 *
 * Called **only** for a profile that was just created and has no photo, so it
 * can never overwrite an image a Student chose. Returns the stored base64, or
 * `undefined` when there is nothing to import or anything at all went wrong.
 */
export async function importGoogleAvatar(user: Parse.User): Promise<string | undefined> {
  const url = await findProviderPictureUrl(user);
  if (!url) return undefined;

  const downloaded = await fetchGoogleAvatar(url);
  if (!downloaded) {
    profileLog.info('No Google photo was imported', {
      op: 'importGoogleAvatar',
      stage: 'photo',
      ok: false,
      userId: user.id,
    });
    return undefined;
  }

  // The same three checks an upload gets, plus a sharp decode. A trustworthy
  // source is not a reason to skip verifying that what arrived is an image.
  let decoded: {bytes: Buffer};
  try {
    decoded = decodePhotoBuffer(
      downloaded.bytes,
      IMPORT_FILE_NAMES[downloaded.mimeType] ?? 'google-avatar.jpg',
      downloaded.mimeType
    );
  } catch {
    return undefined;
  }

  const [processError, processed] = await catchError(processPhoto(decoded.bytes));
  if (processError || !processed) return undefined;

  let encoded: string;
  try {
    encoded = encodePhotoForStorage(processed as Buffer);
  } catch {
    return undefined;
  }

  profileLog.info('Google photo imported', {
    op: 'importGoogleAvatar',
    stage: 'photo',
    ok: true,
    userId: user.id,
    // A byte count, as everywhere else. Never the bytes, never the source URL.
    bytes: (processed as Buffer).length,
  });

  return encoded;
}

/**
 * The name to prefill the form with, from the verified Google claims stored on
 * `_User` at sign-in.
 *
 * A **suggestion only**: it is returned on the empty profile shape so the field
 * is not blank, and it is never written to the profile by itself. Whatever the
 * Student submits is what gets stored.
 */
export function suggestedFullName(user: Parse.User): string {
  const first = String(user.get('firstName') ?? '').trim();
  const last = String(user.get('lastName') ?? '').trim();
  return `${first} ${last}`.replace(/\s+/g, ' ').trim();
}
