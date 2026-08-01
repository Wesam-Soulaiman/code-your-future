/**
 * The safe catalog DTO.
 *
 * A hand-built allow-list, like every other DTO in this repository. A raw
 * `Parse.Object` is never returned, so ACL, `createdAt`/`updatedAt` internals,
 * and any column added later cannot leak by default.
 *
 * Catalog items are not personal data — a list of Syrian universities is the
 * least sensitive thing in the product — but the shape still matters: the
 * browser must be able to render a name in the right language and show that a
 * value it already holds has been retired, and nothing more.
 */

import {CatalogType, InstitutionKind} from './constants';

export interface CatalogItemDto {
  id: string;
  type: CatalogType;
  code: string;
  nameEn: string;
  nameAr: string;
  /**
   * Always `true` in a Student's list — they are only ever sent active items.
   * It is carried anyway so a profile's own selection can be shown as retired
   * when an Admin has since deactivated it.
   */
  active: boolean;
  sortOrder: number;
  /** Only present for `INSTITUTION`. */
  institutionKind?: InstitutionKind;
  /** Only present, and only ever `true`, for the institution escape hatch. */
  isOther?: boolean;
}

/** Keys that must never appear in a catalog DTO. Exported for the tests. */
export const FORBIDDEN_CATALOG_DTO_KEYS: readonly string[] = [
  'ACL',
  'acl',
  'className',
  'objectId',
  'attributes',
  '_p_user',
  'user',
  'masterKey',
  'sessionToken',
];

/** Build the DTO from a stored catalog item. */
export function toCatalogItemDto(item: Parse.Object): CatalogItemDto {
  const dto: CatalogItemDto = {
    id: item.id as string,
    type: String(item.get('type')) as CatalogType,
    code: String(item.get('code') ?? ''),
    nameEn: String(item.get('nameEn') ?? ''),
    nameAr: String(item.get('nameAr') ?? ''),
    active: item.get('active') === true,
    sortOrder: Number(item.get('sortOrder') ?? 0),
  };

  const kind = item.get('institutionKind');
  if (typeof kind === 'string' && kind.length > 0) {
    dto.institutionKind = kind as InstitutionKind;
  }

  // Only ever carried when true: an explicit `false` on every other item would
  // be noise the browser has to ignore.
  if (item.get('isOther') === true) dto.isOther = true;

  return dto;
}

/**
 * The compact reference embedded in a Student profile.
 *
 * The same fields, because the browser needs exactly the same thing to render a
 * selected value: a localised name, and whether the value is still on offer.
 */
export type CatalogRefDto = CatalogItemDto;

export function toCatalogRefDto(item: Parse.Object): CatalogRefDto {
  return toCatalogItemDto(item);
}
