/**
 * Stable failure codes for Batch Resources ⟨CP5⟩.
 *
 * A code, never a sentence and never a driver message. The browser maps each to
 * translated copy; nothing a database, a stream, or a ZIP parser said reaches a
 * caller, because those messages carry paths, connection strings, and — in the
 * duplicate-key case — the offending value itself.
 */

import {FieldReason, FieldErrors} from '../Batch/errors';

export const ResourceError = {
  /** A field is missing, too short, or too long. Carries a field map. */
  RESOURCE_VALIDATION_FAILED: 'RESOURCE_VALIDATION_FAILED',
  /** The extension, the MIME type, or the bytes are not an accepted format. */
  RESOURCE_TYPE_NOT_ALLOWED: 'RESOURCE_TYPE_NOT_ALLOWED',
  /** Over 20 MiB. Refused at the socket, before anything is parsed. */
  RESOURCE_TOO_LARGE: 'RESOURCE_TOO_LARGE',
  /** Zero bytes. A file that is not a file. */
  RESOURCE_EMPTY: 'RESOURCE_EMPTY',
  /** Storing failed. Deliberately opaque: it is an infrastructure problem. */
  RESOURCE_UPLOAD_FAILED: 'RESOURCE_UPLOAD_FAILED',
  /** No such Resource — **or** one the caller may not see. See the note below. */
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  /** The caller is authenticated but not allowed to act on this Resource. */
  RESOURCE_ACCESS_DENIED: 'RESOURCE_ACCESS_DENIED',
  /** Removing the metadata or its bytes failed. */
  RESOURCE_DELETE_FAILED: 'RESOURCE_DELETE_FAILED',
} as const;

export type ResourceErrorCode = (typeof ResourceError)[keyof typeof ResourceError];

export const RESOURCE_ERROR_CODES: readonly ResourceErrorCode[] = Object.values(ResourceError);

/**
 * Why a cross-Batch read answers `RESOURCE_NOT_FOUND` rather than
 * `RESOURCE_ACCESS_DENIED`.
 *
 * "You may not see this" confirms the thing exists. A Student probing objectIds
 * would learn which ones are real Resources of Batches they are not in, and how
 * many there are. So a Resource the caller cannot read is reported as one that
 * is not there — the same answer a made-up id gets.
 *
 * `RESOURCE_ACCESS_DENIED` is kept for the case where hiding nothing: the caller
 * demonstrably holds the Resource (an Admin acting on an **archived** Batch, a
 * Student attempting a write). There, the existence is not the secret; the
 * action is.
 */
export function resourceError(
  code: ResourceErrorCode,
  fields?: FieldErrors
): Parse.Error {
  const suffix = fields && Object.keys(fields).length > 0 ? `:${JSON.stringify(fields)}` : '';
  return new Parse.Error(Parse.Error.VALIDATION_ERROR, `${code}${suffix}`);
}

export {FieldReason};
export type {FieldErrors};
