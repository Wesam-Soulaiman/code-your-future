import { CatalogType, InstitutionKind } from '../utils/profile-catalog-constants';

/**
 * The safe catalog DTO.
 *
 * Mirrors `backend/src/cloudCode/modules/ProfileCatalog/dto.ts` exactly. Fields
 * the backend deliberately withholds — ACL, the raw Parse object, internal
 * timestamps — are absent here too, so no component can depend on data the API
 * does not send.
 */
export interface ProfileCatalogItem {
  id: string;
  type: CatalogType;
  code: string;
  nameEn: string;
  nameAr: string;
  /**
   * Always `true` in a Student's list. Carried anyway so a profile's own
   * selection can be shown as retired once an Admin deactivates it.
   */
  active: boolean;
  sortOrder: number;
  /** Only present for `INSTITUTION`. */
  institutionKind?: InstitutionKind;
  /** Only present, and only ever `true`, for the institution escape hatch. */
  isOther?: boolean;
}

/** The Admin list response. */
export interface ProfileCatalogListResponse {
  type: CatalogType;
  items: ProfileCatalogItem[];
  /** Whether this category supports the `isOther` flag at all. */
  supportsOther: boolean;
}

/** What an Admin sends when creating or editing an item. */
export interface ProfileCatalogItemInput {
  type: CatalogType;
  code: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
  sortOrder: number;
  institutionKind?: InstitutionKind;
  isOther?: boolean;
}

/** The Student catalog, keyed by category. Absent keys were not requested. */
export type ProfileCatalogMap = Partial<Record<CatalogType, ProfileCatalogItem[]>>;

/** The localised name for the active language. */
export function catalogItemName(item: ProfileCatalogItem, language: string): string {
  // Falls back to the other language rather than rendering nothing: an item is
  // always more useful with a name in the wrong language than with no name.
  if (language === 'ar') return item.nameAr || item.nameEn;
  return item.nameEn || item.nameAr;
}
