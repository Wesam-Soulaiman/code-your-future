/**
 * Validating the metadata a caller sends with a Resource ⟨CP5⟩.
 *
 * The file itself is judged in `fileValidation.ts`; this is the title, the
 * description, and the reorder list. Every rejection is a **field name plus a
 * stable reason code** — never the value the caller sent, which would end up
 * rendered back onto a page and into a log.
 */

import {REORDER_MAX_ITEMS, RESOURCE_LIMITS} from './constants';
import {FieldErrors, FieldReason} from './errors';

/** Collapse internal whitespace and trim, so " A  B " and "A B" are one title. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Trim only — internal spacing in a description is the author's formatting. */
function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface ResourceMetadata {
  title: string;
  description?: string;
}

export interface MetadataValidation {
  values: ResourceMetadata;
  errors: FieldErrors;
}

/** Title and description, for both upload and edit. */
export function validateResourceMetadata(input: Record<string, unknown>): MetadataValidation {
  const errors: FieldErrors = {};

  const title = normaliseText(input['title']);
  if (title.length === 0) {
    errors['title'] = FieldReason.REQUIRED;
  } else if (title.length < RESOURCE_LIMITS.title.min) {
    errors['title'] = FieldReason.TOO_SHORT;
  } else if (title.length > RESOURCE_LIMITS.title.max) {
    errors['title'] = FieldReason.TOO_LONG;
  }

  const description = trimText(input['description']);
  if (description.length > RESOURCE_LIMITS.description.max) {
    errors['description'] = FieldReason.TOO_LONG;
  }

  const values: ResourceMetadata = {title};
  if (description) values.description = description;

  return {values, errors};
}

/**
 * Fields a caller must never set on a Resource.
 *
 * Reported rather than ignored: a request sending `storageKey` deserves to
 * learn it was refused, instead of believing it worked. The model's trigger
 * refuses these too — this is the layer that gives a useful answer.
 */
export function findPrivilegedResourceFields(input: Record<string, unknown>): string[] {
  const forbidden = [
    'storageKey',
    'uploadedBy',
    'batch',
    'objectId',
    'ACL',
    'acl',
    'className',
    'createdAt',
    'updatedAt',
    'mimeType',
    'fileSize',
    'filename',
    'extension',
    // Nothing about authorisation is ever set by writing a Resource.
    'roles',
    'role',
    'sessionToken',
    'password',
  ];
  return forbidden.filter(key => Object.prototype.hasOwnProperty.call(input, key));
}

/**
 * The ordered id list for a reorder.
 *
 * Returns `undefined` when the input is not a usable list at all. Individual ids
 * that do not belong to the Batch are not rejected here — the repository ignores
 * them, because a caller working from a slightly stale list should get a sane
 * result rather than an error.
 */
export function parseOrderedIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0 || raw.length > REORDER_MAX_ITEMS) return undefined;

  const ids = raw
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id.length <= 64);

  return ids.length > 0 ? ids : undefined;
}
