/**
 * What a Resource looks like to a browser ⟨CP5⟩.
 *
 * Hand-built allow-lists, both of them. Nothing is spread from a Parse object,
 * so a column added to the model later cannot appear in a response by accident —
 * it has to be put here on purpose.
 *
 * **`storageKey` is in neither DTO, and there is no third DTO that has it.** A
 * browser addresses a Resource by its `objectId`; the key that would let
 * somebody ask storage directly never crosses the boundary.
 */

import {RESOURCE_MAX_BYTES, RESOURCE_EXTENSIONS} from './constants';

/** What an Admin sees. */
export interface ResourceDto {
  id: string;
  title: string;
  description?: string;
  filename: string;
  extension: string;
  /** A short label the browser translates — `pdf`, `docx`, … */
  kind: string;
  fileSize: number;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * What an enrolled Student sees.
 *
 * The same shape minus `displayOrder` and `updatedAt` — a Student reads the list
 * in the order it arrives and has nothing to do with either. **No `uploadedBy`**:
 * which Admin uploaded a file is not a Student's business, and it names a real
 * person.
 */
export interface StudentResourceDto {
  id: string;
  title: string;
  description?: string;
  filename: string;
  extension: string;
  kind: string;
  fileSize: number;
  createdAt?: string;
}

/**
 * Keys that must never appear in a Resource response.
 *
 * Asserted by a test against the real DTOs, so this list is a check rather than
 * a comment.
 */
export const FORBIDDEN_RESOURCE_DTO_KEYS: readonly string[] = [
  'storageKey',
  'uploadedBy',
  'batch',
  'ACL',
  'acl',
  'className',
  '__type',
  'objectId',
  'attributes',
  'sessionToken',
  'masterKey',
  // A URL of any kind would defeat the point of private storage.
  'url',
  'fileUrl',
  'downloadUrl',
  'location',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

/** The kind label for an extension. Derived, never stored. */
function kindOf(extension: unknown): string {
  const normalised = typeof extension === 'string' ? extension.replace(/^\./, '') : '';
  return normalised === 'htm' ? 'html' : normalised;
}

export function toResourceDto(resource: Parse.Object): ResourceDto {
  const dto: ResourceDto = {
    id: resource.id,
    title: String(resource.get('title') ?? ''),
    filename: String(resource.get('filename') ?? ''),
    extension: String(resource.get('extension') ?? ''),
    kind: kindOf(resource.get('extension')),
    fileSize: Number(resource.get('fileSize') ?? 0),
    displayOrder: Number(resource.get('displayOrder') ?? 0),
  };

  const description = optionalString(resource.get('description'));
  if (description) dto.description = description;

  const createdAt = isoOrUndefined(resource.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  const updatedAt = isoOrUndefined(resource.get('updatedAt'));
  if (updatedAt) dto.updatedAt = updatedAt;

  return dto;
}

export function toStudentResourceDto(resource: Parse.Object): StudentResourceDto {
  const dto: StudentResourceDto = {
    id: resource.id,
    title: String(resource.get('title') ?? ''),
    filename: String(resource.get('filename') ?? ''),
    extension: String(resource.get('extension') ?? ''),
    kind: kindOf(resource.get('extension')),
    fileSize: Number(resource.get('fileSize') ?? 0),
  };

  const description = optionalString(resource.get('description'));
  if (description) dto.description = description;

  const createdAt = isoOrUndefined(resource.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  return dto;
}

/**
 * The upload rules, so the browser can state them before somebody picks a file.
 *
 * Sent to the UI rather than duplicated there: a hint that disagrees with the
 * server is worse than no hint, because it teaches people to distrust the one
 * they are shown.
 */
export interface ResourceUploadRulesDto {
  extensions: readonly string[];
  maxBytes: number;
}

export function uploadRules(): ResourceUploadRulesDto {
  return {extensions: RESOURCE_EXTENSIONS, maxBytes: RESOURCE_MAX_BYTES};
}
