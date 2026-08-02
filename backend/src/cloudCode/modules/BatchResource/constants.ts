/**
 * What a Batch Resource may be ⟨CP5⟩.
 *
 * **One allow-list, and it is closed.** Extension, MIME type, and byte
 * signature are declared together for each accepted format, because they are
 * three facts about one thing and checking them from three separate places is
 * how a `.pdf` that is really a `.exe` gets through.
 *
 * Nothing here is derived from what the browser said. The browser's MIME value
 * is checked *against* this table; it never adds to it.
 */

/** 20 MiB, per the product decision. Enforced at the socket, not after parsing. */
export const RESOURCE_MAX_BYTES = 20 * 1024 * 1024;

export const RESOURCE_LIMITS = {
  title: {min: 2, max: 160},
  description: {max: 1000},
  /** What a stored filename may grow to after sanitising. */
  filename: {max: 180},
} as const;

/** Storage keys: `resource_` + 32 hex characters. */
export const STORAGE_KEY_PREFIX = 'resource_';
export const STORAGE_KEY_BYTES = 16;

/** Reorder accepts at most this many ids in one request. */
export const REORDER_MAX_ITEMS = 200;

/**
 * How a format's bytes are recognised.
 *
 * `zip` means the file is an OOXML package: a ZIP whose *contents* decide which
 * of the three Office formats it is. See `fileValidation.ts` — the ZIP header
 * alone cannot tell a `.docx` from a `.pptx`, or from a renamed `.jar`.
 */
export type SignatureKind = 'exact' | 'zip' | 'text';

export interface ResourceFormat {
  /** Lower-case, with the dot. */
  extension: string;
  /** The single MIME type stored and served for this format. */
  mimeType: string;
  /** MIME values a browser may legitimately send for it. */
  acceptedMimeTypes: readonly string[];
  signature: SignatureKind;
  /** Leading bytes, for `exact`. */
  magic?: readonly number[];
  /**
   * For `zip`: an entry that must exist inside the package. This is what
   * distinguishes the three OOXML formats from each other and from any other
   * ZIP.
   */
  packageEntry?: string;
  /** Short label for the UI. Translated on the frontend by extension. */
  kind: string;
}

/**
 * The eight accepted formats.
 *
 * `application/octet-stream` is accepted as a *browser-supplied* value for
 * several of these because browsers genuinely send it — on Windows for `.md`
 * with no registered handler, and for OOXML files copied from some sources. It
 * is never what gets **stored**: the stored MIME is always `mimeType`, decided
 * here, after the bytes have been checked.
 */
export const RESOURCE_FORMATS: readonly ResourceFormat[] = [
  {
    extension: '.pdf',
    mimeType: 'application/pdf',
    acceptedMimeTypes: ['application/pdf', 'application/x-pdf', 'application/octet-stream'],
    signature: 'exact',
    // %PDF
    magic: [0x25, 0x50, 0x44, 0x46],
    kind: 'pdf',
  },
  {
    extension: '.html',
    mimeType: 'text/html',
    acceptedMimeTypes: ['text/html', 'application/xhtml+xml', 'text/plain'],
    signature: 'text',
    kind: 'html',
  },
  {
    extension: '.htm',
    mimeType: 'text/html',
    acceptedMimeTypes: ['text/html', 'application/xhtml+xml', 'text/plain'],
    signature: 'text',
    kind: 'html',
  },
  {
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      'application/octet-stream',
    ],
    signature: 'zip',
    packageEntry: 'word/',
    kind: 'docx',
  },
  {
    extension: '.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    acceptedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/octet-stream',
    ],
    signature: 'zip',
    packageEntry: 'ppt/',
    kind: 'pptx',
  },
  {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
      'application/octet-stream',
    ],
    signature: 'zip',
    packageEntry: 'xl/',
    kind: 'xlsx',
  },
  {
    extension: '.txt',
    mimeType: 'text/plain',
    acceptedMimeTypes: ['text/plain', 'application/octet-stream'],
    signature: 'text',
    kind: 'txt',
  },
  {
    extension: '.md',
    mimeType: 'text/markdown',
    acceptedMimeTypes: [
      'text/markdown',
      'text/x-markdown',
      'text/plain',
      'application/octet-stream',
    ],
    signature: 'text',
    kind: 'md',
  },
];

/** Every accepted extension, for the picker's `accept` and the UI hint. */
export const RESOURCE_EXTENSIONS: readonly string[] = RESOURCE_FORMATS.map(
  format => format.extension
);

/** Every MIME type that may be **stored**. Nothing else can reach a response. */
export const RESOURCE_STORED_MIME_TYPES: readonly string[] = [
  ...new Set(RESOURCE_FORMATS.map(format => format.mimeType)),
];

/** The format for an extension, or undefined. Extension is matched exactly. */
export function formatForExtension(extension: unknown): ResourceFormat | undefined {
  if (typeof extension !== 'string') return undefined;
  const normalised = extension.trim().toLowerCase();
  return RESOURCE_FORMATS.find(format => format.extension === normalised);
}

/** True when this MIME type is one this product will ever serve. */
export function isStorableMimeType(value: unknown): boolean {
  return typeof value === 'string' && RESOURCE_STORED_MIME_TYPES.includes(value);
}

/**
 * Extensions that must never be accepted, whatever else is true.
 *
 * Belt and braces: the allow-list above already excludes these by construction,
 * and a double extension like `report.pdf.exe` resolves to `.exe` and is refused
 * by that alone. This list exists so the *intent* is stated in code rather than
 * being an emergent property of a table somebody might extend carelessly.
 */
export const FORBIDDEN_EXTENSIONS: readonly string[] = [
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.sh',
  '.jar',
  '.js',
  '.mjs',
  '.vbs',
  '.php',
  '.py',
  '.rb',
  '.app',
  '.deb',
  '.rpm',
  '.zip',
  '.rar',
  '.7z',
  '.svg',
];
