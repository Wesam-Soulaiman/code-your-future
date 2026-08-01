/**
 * Profile catalog constants — the browser's copy.
 *
 * Mirrors `backend/src/cloudCode/modules/ProfileCatalog/constants.ts`. A backend
 * test asserts the two stay in step: a browser that offers a category the server
 * refuses, or refuses one it accepts, is worse than no client-side check at all.
 *
 * **The backend is always the authority.** These exist to build the right form
 * and give fast feedback; every value is re-validated server-side.
 */

/** The only four categories that exist. */
export const CATALOG_TYPE = {
  CITY: 'CITY',
  INSTITUTION: 'INSTITUTION',
  MAJOR: 'MAJOR',
  TARGET_ROLE: 'TARGET_ROLE',
} as const;

export type CatalogType = (typeof CATALOG_TYPE)[keyof typeof CATALOG_TYPE];

export const CATALOG_TYPES: readonly CatalogType[] = [
  CATALOG_TYPE.CITY,
  CATALOG_TYPE.INSTITUTION,
  CATALOG_TYPE.MAJOR,
  CATALOG_TYPE.TARGET_ROLE,
];

/** Institution sub-kind. Meaningful only when the type is `INSTITUTION`. */
export const INSTITUTION_KIND = {
  UNIVERSITY: 'UNIVERSITY',
  INSTITUTE: 'INSTITUTE',
  OTHER: 'OTHER',
} as const;

export type InstitutionKind = (typeof INSTITUTION_KIND)[keyof typeof INSTITUTION_KIND];

export const INSTITUTION_KINDS: readonly InstitutionKind[] = [
  INSTITUTION_KIND.UNIVERSITY,
  INSTITUTION_KIND.INSTITUTE,
  INSTITUTION_KIND.OTHER,
];

/** Categories where an `isOther` escape hatch is supported. */
export const TYPES_SUPPORTING_OTHER: readonly CatalogType[] = [CATALOG_TYPE.INSTITUTION];

export const CATALOG_LIMITS = {
  code: { min: 2, max: 60 },
  name: { min: 1, max: 160 },
  search: { max: 80 },
} as const;

export const CATALOG_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]*$/;

export const CATALOG_SORT_ORDER = { min: 0, max: 100000 } as const;

/** Normalise a code exactly as the backend does, so the preview is honest. */
export function normaliseCatalogCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Which Admin tab shows which category. Order is the tab order. */
export const CATALOG_TABS: readonly { type: CatalogType; labelKey: string }[] = [
  { type: CATALOG_TYPE.CITY, labelKey: 'admin.catalogs.tabs.cities' },
  { type: CATALOG_TYPE.INSTITUTION, labelKey: 'admin.catalogs.tabs.institutions' },
  { type: CATALOG_TYPE.MAJOR, labelKey: 'admin.catalogs.tabs.majors' },
  { type: CATALOG_TYPE.TARGET_ROLE, labelKey: 'admin.catalogs.tabs.targetRoles' },
];
