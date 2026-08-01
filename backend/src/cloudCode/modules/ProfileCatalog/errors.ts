/**
 * Stable, sanitised error codes for the profile catalog.
 *
 * Same contract as the profile and authentication codes: the token **is** the
 * whole message. No database detail, no library text, and no submitted value
 * ever travels with an error.
 *
 * `CATALOG_VALIDATION_FAILED` is the one code that carries more, because
 * "something is wrong" is useless in a five-field form. It appends a map of
 * **field name → stable reason code** — fixed vocabulary this repository
 * defines, never a value somebody typed.
 */

import {FieldErrors, FieldReason} from '../StudentProfile/errors';

export const CatalogError = {
  /** One or more fields failed validation; see the `fields` map. */
  CATALOG_VALIDATION_FAILED: 'CATALOG_VALIDATION_FAILED',
  /** No item with that id exists in that category. */
  CATALOG_NOT_FOUND: 'CATALOG_NOT_FOUND',
  /** The normalised code is already taken within the same category. */
  CATALOG_DUPLICATE: 'CATALOG_DUPLICATE',
  /** A Student profile references this item, so it cannot be deleted. */
  CATALOG_IN_USE: 'CATALOG_IN_USE',
  /** Anything unexpected. */
  CATALOG_SAVE_FAILED: 'CATALOG_SAVE_FAILED',
} as const;

export type CatalogErrorCode = (typeof CatalogError)[keyof typeof CatalogError];

export const CATALOG_ERROR_CODES: readonly CatalogErrorCode[] = Object.values(CatalogError);

export function isCatalogErrorCode(value: unknown): value is CatalogErrorCode {
  return typeof value === 'string' && (CATALOG_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Build the Parse error for a code.
 *
 * The field map is encoded into the message as JSON because Parse serialises
 * the message only. It holds nothing but field names and reason codes.
 */
export function catalogError(code: CatalogErrorCode, fields?: FieldErrors): Parse.Error {
  const message =
    code === CatalogError.CATALOG_VALIDATION_FAILED && fields && Object.keys(fields).length > 0
      ? `${code}:${JSON.stringify(fields)}`
      : code;

  switch (code) {
    case CatalogError.CATALOG_VALIDATION_FAILED:
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
    case CatalogError.CATALOG_NOT_FOUND:
      return new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, message);
    case CatalogError.CATALOG_DUPLICATE:
      return new Parse.Error(Parse.Error.DUPLICATE_VALUE, message);
    case CatalogError.CATALOG_IN_USE:
      return new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
    default:
      return new Parse.Error(Parse.Error.OTHER_CAUSE, message);
  }
}

/** Re-exported so catalog call sites use one reason vocabulary, not two. */
export {FieldReason};
export type {FieldErrors};
