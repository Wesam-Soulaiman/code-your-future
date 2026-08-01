/**
 * Profile catalog constants — the single source of truth for the vocabulary.
 *
 * `frontend/src/app/utils/profile-catalog-constants.ts` mirrors this file; a
 * test asserts the two stay in step, for the same reason the profile constants
 * are mirrored: a browser that offers a category the server refuses, or refuses
 * one it accepts, is worse than no client-side check at all.
 */

/**
 * The **only** four categories that exist.
 *
 * This list is closed on purpose. A client never supplies a category name; it
 * picks one of these, and anything else is refused before a query is built.
 * That is what stops this model becoming a generic key/value store.
 */
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

/** Institution sub-kind. Meaningful only when `type` is `INSTITUTION`. */
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

/**
 * Categories where an `isOther` escape hatch is supported.
 *
 * Only institutions have one, because only institutions have a confirmed
 * product rule that an unlisted value is typed in by hand. A city or a major
 * marked `isOther` would promise a free-text field that does not exist.
 */
export const TYPES_SUPPORTING_OTHER: readonly CatalogType[] = [CATALOG_TYPE.INSTITUTION];

/** Length bounds. Generous for real names, tight enough to bound storage. */
export const CATALOG_LIMITS = {
  code: {min: 2, max: 60},
  name: {min: 1, max: 160},
  search: {max: 80},
} as const;

/**
 * A normalised code: upper-case ASCII letters, digits, and underscores, opening
 * on a letter or digit.
 *
 * Codes are the stable identity used by seeding and by uniqueness, so they are
 * deliberately narrower than a display name — a code carrying punctuation or a
 * different Unicode form of the same letter would defeat both.
 */
export const CATALOG_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]*$/;

/** Sort order bounds. A safe integer, small enough to stay readable. */
export const CATALOG_SORT_ORDER = {min: 0, max: 100000} as const;

/** How many items one category may hold. Bounds the read and the UI alike. */
export const CATALOG_MAX_ITEMS = 2000;

/**
 * Normalise a code.
 *
 * Upper-cases, collapses anything that is not a letter or digit into a single
 * underscore, and trims the underscores from both ends — so `"Damascus  Univ."`
 * and `"damascus_univ"` are the same code and cannot both be created.
 */
export function normaliseCatalogCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Narrow an arbitrary value to a catalog type, or `undefined`. */
export function toCatalogType(value: unknown): CatalogType | undefined {
  return CATALOG_TYPES.find(type => type === value);
}

/** Narrow an arbitrary value to an institution kind, or `undefined`. */
export function toInstitutionKind(value: unknown): InstitutionKind | undefined {
  return INSTITUTION_KINDS.find(kind => kind === value);
}
