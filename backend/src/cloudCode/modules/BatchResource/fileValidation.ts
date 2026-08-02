/**
 * Deciding whether an uploaded file is what it claims to be ⟨CP5⟩.
 *
 * Three things are checked, and the order matters because each is cheaper than
 * the next:
 *
 *   1. **the extension**, against the closed allow-list;
 *   2. **the browser's MIME value**, against what that format may legitimately
 *      arrive as — never as the source of truth, only as a cross-check;
 *   3. **the bytes**, which are the only one of the three the uploader cannot
 *      simply set.
 *
 * ── Why the ZIP formats need their own handling ─────────────────────────────
 * `.docx`, `.pptx`, and `.xlsx` are all ZIP archives. Their first four bytes are
 * identical — `PK\x03\x04` — which is also the signature of a `.jar`, an `.apk`,
 * an `.epub`, and a plain `.zip` full of anything at all. A magic-byte check
 * alone accepts an executable JAR renamed to `.docx`.
 *
 * So for those three the **package contents** decide: a Word document contains
 * `word/`, a presentation `ppt/`, a workbook `xl/`, and all three contain
 * `[Content_Types].xml`. The entry names are read straight from the ZIP central
 * directory — no archive is extracted, nothing is decompressed, and no ZIP
 * library is added. Reading a table of names cannot execute anything.
 */

import {
  FORBIDDEN_EXTENSIONS,
  RESOURCE_LIMITS,
  RESOURCE_MAX_BYTES,
  ResourceFormat,
  formatForExtension,
} from './constants';
import {ResourceError, ResourceErrorCode} from './errors';

/** What a validated upload turned out to be. */
export interface ValidatedFile {
  /** The sanitised name, as it will be stored and sent back on download. */
  filename: string;
  extension: string;
  /** The MIME type **this product** decided on, never the browser's. */
  mimeType: string;
  size: number;
  kind: string;
}

export interface FileRejection {
  code: ResourceErrorCode;
}

export type FileCheck = {ok: true; file: ValidatedFile} | {ok: false; reason: FileRejection};

function reject(code: ResourceErrorCode): FileCheck {
  return {ok: false, reason: {code}};
}

/**
 * The extension of a filename, lower-cased, including the dot.
 *
 * Takes the **last** one, so `report.pdf.exe` is `.exe` and is refused — the
 * classic double-extension trick fails on the ordinary rule rather than needing
 * a special case.
 */
export function extensionOf(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * Make a filename safe to store, to log, and to put in a header.
 *
 * Strips any directory component (`../../etc/passwd` becomes `passwd`), removes
 * control characters and the characters that would break a `Content-Disposition`
 * header or a filesystem, collapses whitespace, and bounds the length while
 * keeping the extension — a name truncated to the point of losing its extension
 * would be worse than one that is merely long.
 */
export function sanitiseFilename(raw: unknown): string {
  const asString = typeof raw === 'string' ? raw : '';

  // Directory traversal and separators go first: everything after this is a
  // single name.
  const base = asString.replace(/\\/g, '/').split('/').pop() ?? '';

  // Control characters are dropped by code point rather than by a regular
  // expression: a literal control class in source is invisible in a diff and
  // easy to mangle. CR and LF matter most — either would let a crafted name
  // inject a second HTTP header on download.
  const withoutControls = [...base]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const cleaned = withoutControls
    // Quotes and semicolons end a Content-Disposition parameter; the rest are
    // hostile on one filesystem or another.
    .replace(/["';:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot makes a hidden file and can hide the real extension.
    .replace(/^\.+/, '');

  if (cleaned.length === 0) return 'resource';
  if (cleaned.length <= RESOURCE_LIMITS.filename.max) return cleaned;

  // Too long: keep the extension, shorten the stem.
  const extension = extensionOf(cleaned);
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned;
  return `${stem.slice(0, RESOURCE_LIMITS.filename.max - extension.length)}${extension}`;
}

/**
 * Every entry name in a ZIP's central directory.
 *
 * Walks the central directory records by their `PK\x01\x02` signature and reads
 * each name. Deliberately **not** a ZIP library: nothing is decompressed, no
 * entry is opened, and a malformed archive yields a short list rather than an
 * exception. A name table is inert.
 *
 * Bounded so a crafted archive claiming thousands of entries cannot spin.
 */
export function zipEntryNames(buffer: Buffer, maxEntries = 512): string[] {
  const names: string[] = [];
  const CENTRAL_DIRECTORY = 0x02014b50;

  for (let offset = 0; offset + 46 <= buffer.length && names.length < maxEntries; offset += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY) continue;

    const nameLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 46;
    if (nameLength === 0 || nameStart + nameLength > buffer.length) continue;

    names.push(buffer.toString('utf8', nameStart, nameStart + nameLength));
    // Skip past this record's name; extra and comment fields are left to the
    // scan, which is cheap and cannot misread a signature.
    offset = nameStart + nameLength - 1;
  }

  return names;
}

/** True when the bytes begin with a local ZIP file header. */
function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // PK\x03\x04 — a local file header. PK\x05\x06 is an empty archive, which is
  // not a document.
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * True when the bytes are plausibly text rather than a program.
 *
 * Used for `.txt`, `.md`, and `.html`, which have no signature of their own. It
 * cannot prove a file is text — nothing can — but it reliably refuses the thing
 * that matters: a binary renamed to `.txt`. A NUL byte or a run of control
 * characters does not appear in a document somebody typed.
 *
 * A UTF-8/UTF-16 byte-order mark is allowed through, since those are text.
 */
export function looksLikeText(buffer: Buffer, sampleSize = 4096): boolean {
  if (buffer.length === 0) return false;

  // Skip a byte-order mark before judging.
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  } else if (buffer.length >= 2 && (buffer[0] === 0xff || buffer[0] === 0xfe)) {
    // UTF-16. Half its bytes are legitimately NUL, so the NUL rule cannot apply.
    return true;
  }

  const end = Math.min(buffer.length, start + sampleSize);
  let suspicious = 0;

  for (let i = start; i < end; i += 1) {
    const byte = buffer[i];
    if (byte === 0x00) return false; // A NUL is decisive.
    // Tab, newline, carriage return, and form feed are ordinary in text.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }

  const sampled = end - start;
  return sampled > 0 && suspicious / sampled < 0.02;
}

/** Do the bytes match what this format's signature rule requires? */
function signatureMatches(format: ResourceFormat, buffer: Buffer): boolean {
  switch (format.signature) {
    case 'exact': {
      const magic = format.magic ?? [];
      if (buffer.length < magic.length) return false;
      return magic.every((byte, index) => buffer[index] === byte);
    }

    case 'zip': {
      // A ZIP header is necessary but nowhere near sufficient — see the note at
      // the top of this file.
      if (!looksLikeZip(buffer)) return false;

      const names = zipEntryNames(buffer);
      if (names.length === 0) return false;

      // Every OOXML package declares its parts here.
      const isOoxml = names.some(name => name === '[Content_Types].xml');
      if (!isOoxml) return false;

      // And this is what separates a document from a presentation from a
      // workbook — and all three from a renamed JAR, which has `META-INF/` and
      // no `[Content_Types].xml`.
      const entry = format.packageEntry ?? '';
      return entry.length > 0 && names.some(name => name.startsWith(entry));
    }

    case 'text':
      return looksLikeText(buffer);

    default:
      return false;
  }
}

/**
 * Check an uploaded file against the allow-list.
 *
 * `declaredMimeType` is what the browser sent. It is cross-checked and then
 * discarded: the stored MIME type comes from the table, so a caller cannot
 * choose what a later download will be served as.
 */
export function validateUploadedFile(input: {
  originalName: unknown;
  declaredMimeType: unknown;
  buffer: Buffer;
}): FileCheck {
  const {buffer} = input;

  // ── Size, first: it is the cheapest check and the one an attacker abuses ──
  if (!buffer || buffer.length === 0) return reject(ResourceError.RESOURCE_EMPTY);
  if (buffer.length > RESOURCE_MAX_BYTES) return reject(ResourceError.RESOURCE_TOO_LARGE);

  const filename = sanitiseFilename(input.originalName);
  const extension = extensionOf(filename);

  if (extension.length === 0) return reject(ResourceError.RESOURCE_TYPE_NOT_ALLOWED);

  // Stated explicitly as well as implied by the allow-list — see the note on
  // FORBIDDEN_EXTENSIONS.
  if (FORBIDDEN_EXTENSIONS.includes(extension)) {
    return reject(ResourceError.RESOURCE_TYPE_NOT_ALLOWED);
  }

  const format = formatForExtension(extension);
  if (!format) return reject(ResourceError.RESOURCE_TYPE_NOT_ALLOWED);

  // ── The browser's claim, cross-checked ────────────────────────────────────
  const declared =
    typeof input.declaredMimeType === 'string'
      ? input.declaredMimeType.split(';')[0].trim().toLowerCase()
      : '';
  if (declared.length > 0 && !format.acceptedMimeTypes.includes(declared)) {
    return reject(ResourceError.RESOURCE_TYPE_NOT_ALLOWED);
  }

  // ── The bytes, which are the only thing that settles it ───────────────────
  if (!signatureMatches(format, buffer)) {
    return reject(ResourceError.RESOURCE_TYPE_NOT_ALLOWED);
  }

  return {
    ok: true,
    file: {
      filename,
      extension,
      // From the table. Never `declared`.
      mimeType: format.mimeType,
      size: buffer.length,
      kind: format.kind,
    },
  };
}
