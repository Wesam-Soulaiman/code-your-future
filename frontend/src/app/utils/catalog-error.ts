import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turn a backend catalog failure into translated copy.
 *
 * The backend answers with a stable code and, for a validation failure, a map of
 * **field name → stable reason code**. Neither carries a submitted value, so
 * nothing untranslated is ever rendered.
 *
 * `CATALOG_IN_USE` is the one code that carries real product meaning rather than
 * just "that went wrong": it is the answer to deleting a value Students have
 * already chosen, and the copy explains that deactivating is what to do instead.
 */

export type CatalogErrorKey =
  | 'admin.catalogs.errors.validation'
  | 'admin.catalogs.errors.notFound'
  | 'admin.catalogs.errors.duplicate'
  | 'admin.catalogs.errors.inUse'
  | 'admin.catalogs.errors.forbidden'
  | 'admin.catalogs.errors.unavailable'
  | 'admin.catalogs.errors.unexpected';

/** Mirrors `modules/ProfileCatalog/errors.ts`. */
const CODE_TO_KEY: Record<string, CatalogErrorKey> = {
  CATALOG_VALIDATION_FAILED: 'admin.catalogs.errors.validation',
  CATALOG_NOT_FOUND: 'admin.catalogs.errors.notFound',
  CATALOG_DUPLICATE: 'admin.catalogs.errors.duplicate',
  CATALOG_IN_USE: 'admin.catalogs.errors.inUse',
  CATALOG_SAVE_FAILED: 'admin.catalogs.errors.unexpected',
};

/** Field-level reason codes → translated copy. Shared with the profile form. */
const REASON_TO_KEY: Record<string, string> = {
  REQUIRED: 'student.profile.fieldErrors.required',
  TOO_SHORT: 'student.profile.fieldErrors.tooShort',
  TOO_LONG: 'student.profile.fieldErrors.tooLong',
  INVALID: 'student.profile.fieldErrors.invalid',
  NOT_ALLOWED: 'student.profile.fieldErrors.notAllowed',
  OUT_OF_RANGE: 'student.profile.fieldErrors.outOfRange',
  WRONG_DOMAIN: 'student.profile.fieldErrors.wrongDomain',
};

export interface CatalogFailure {
  key: CatalogErrorKey;
  /** Field name → translation key. Empty unless the backend rejected fields. */
  fields: Record<string, string>;
  /** True for the one failure the page explains rather than just reports. */
  inUse: boolean;
}

/** Read the stable code and any field map out of a Parse error body. */
function parseMessage(error: HttpErrorResponse): { code?: string; fields: Record<string, string> } {
  const body = error.error as { error?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : '';
  if (message.length === 0) return { fields: {} };

  const separator = message.indexOf(':');
  const code = separator === -1 ? message : message.slice(0, separator);
  const fields: Record<string, string> = {};

  if (separator !== -1) {
    try {
      const raw = JSON.parse(message.slice(separator + 1)) as Record<string, unknown>;
      for (const [field, reason] of Object.entries(raw)) {
        const key = REASON_TO_KEY[String(reason)];
        // An unrecognised reason is dropped rather than rendered raw.
        if (key) fields[field] = key;
      }
    } catch {
      // A malformed map is simply no map; the page-level message still shows.
    }
  }

  return { code, fields };
}

/** Map a failed catalog call to safe, translated copy. */
export function mapCatalogError(error: unknown): CatalogFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { key: 'admin.catalogs.errors.unexpected', fields: {}, inUse: false };
  }

  // Transport conditions are decided first: they hold regardless of the body,
  // and a body may not exist at all.
  if (error.status === 0 || error.status >= 500) {
    return { key: 'admin.catalogs.errors.unavailable', fields: {}, inUse: false };
  }

  const { code, fields } = parseMessage(error);

  // A plain 403 with no catalog code is the authorisation gate, not a catalog
  // rule — an Admin whose role was withdrawn mid-session lands here.
  if (error.status === 403 && !code) {
    return { key: 'admin.catalogs.errors.forbidden', fields: {}, inUse: false };
  }

  const key = code ? CODE_TO_KEY[code] : undefined;

  return {
    key: key ?? 'admin.catalogs.errors.unexpected',
    fields,
    inUse: code === 'CATALOG_IN_USE',
  };
}
