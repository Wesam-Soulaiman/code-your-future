/**
 * Shared facts about Batch Resources ⟨CP5⟩.
 *
 * The **limits are not here**. Accepted extensions and the maximum size arrive
 * from the server with every list, because a browser-side copy is a copy that
 * drifts: the day somebody adds a format on the backend, a hard-coded list here
 * would start refusing a file the server would happily take, and the person
 * uploading would have no way to tell which of the two was wrong.
 *
 * What is here is presentation — an icon per format, a readable size — plus the
 * field name the upload route expects, which is a wire contract rather than a
 * rule.
 */

/** The multipart field name. Mirrors `RESOURCE_FILE_FIELD` on the backend. */
export const RESOURCE_FILE_FIELD = 'file';

/** Bounds for the metadata form. Mirrors `RESOURCE_LIMITS`; server re-checks. */
export const RESOURCE_LIMITS = {
  title: { min: 2, max: 160 },
  description: { max: 1000 },
} as const;

/**
 * An icon per format.
 *
 * Keyed by the `kind` the backend derives, not by MIME type or by extension, so
 * `.htm` and `.html` land on one entry without this file knowing they are the
 * same thing.
 */
export const RESOURCE_KIND_ICON: Record<string, string> = {
  pdf: 'fa-solid fa-file-pdf',
  html: 'fa-solid fa-file-code',
  docx: 'fa-solid fa-file-word',
  pptx: 'fa-solid fa-file-powerpoint',
  xlsx: 'fa-solid fa-file-excel',
  txt: 'fa-solid fa-file-lines',
  md: 'fa-solid fa-file-lines',
};

/** The fallback, for a format this build has not been taught to draw. */
export const RESOURCE_DEFAULT_ICON = 'fa-solid fa-file';

export function resourceIcon(kind: string): string {
  return RESOURCE_KIND_ICON[kind] ?? RESOURCE_DEFAULT_ICON;
}

const KIB = 1024;

/**
 * A file size somebody can read at a glance.
 *
 * Binary units, because that is what the 20 MiB limit is expressed in — showing
 * "21 MB" beside a limit of "20 MB" for a file the server just refused would be
 * true in decimal and useless to the reader.
 *
 * Formatted through `Intl` with the digits pinned to Latin, matching every other
 * number in the application: an Arabic page still reads `1.4`, not `١٫٤`.
 */
export function formatFileSize(bytes: number, lang: string): string {
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB-u-nu-latn';
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;

  if (safe < KIB) return new Intl.NumberFormat(locale).format(safe);

  const units = safe < KIB * KIB ? KIB : KIB * KIB;
  const value = safe / units;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

/** Which unit `formatFileSize` used, as a translation key suffix. */
export function fileSizeUnit(bytes: number): 'bytes' | 'kb' | 'mb' {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < KIB) return 'bytes';
  return safe < KIB * KIB ? 'kb' : 'mb';
}

/**
 * The `accept` attribute for the file picker.
 *
 * A convenience for the person choosing a file, never a control: the picker can
 * be talked past in every browser, and everything is checked again on the
 * server against the bytes themselves.
 */
export function acceptAttribute(extensions: readonly string[]): string {
  return extensions.join(',');
}
