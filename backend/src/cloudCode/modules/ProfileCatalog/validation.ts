/**
 * Catalog validation — pure functions, no Parse, no I/O.
 *
 * Everything here is deterministic and directly testable. The cloud function
 * calls one of these once and either saves the normalised result or returns the
 * field map; nothing downstream re-checks or re-interprets.
 *
 * Two rules, the same two the profile validator follows:
 *
 *   1. **Normalise, then validate**, so `"  Damascus  "` and `"Damascus"` are
 *      the same item and a name of spaces is empty rather than "present";
 *   2. **Never echo a value.** A rejection carries a field name and a reason
 *      code, so nothing anybody typed reaches a response or a log.
 */

import {
  CATALOG_CODE_PATTERN,
  CATALOG_LIMITS,
  CATALOG_SORT_ORDER,
  CATALOG_TYPE,
  CatalogType,
  InstitutionKind,
  TYPES_SUPPORTING_OTHER,
  normaliseCatalogCode,
  toCatalogType,
  toInstitutionKind,
} from './constants';
import {FieldErrors, FieldReason} from './errors';

/** The normalised, storable shape produced by a successful validation. */
export interface NormalisedCatalogItem {
  type: CatalogType;
  code: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
  sortOrder: number;
  institutionKind?: InstitutionKind;
  isOther: boolean;
}

export interface CatalogValidationResult {
  values: NormalisedCatalogItem;
  errors: FieldErrors;
}

/** Collapse internal whitespace and trim. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function checkName(value: string): keyof typeof FieldReason | undefined {
  if (value.length === 0) return 'REQUIRED';
  if (value.length < CATALOG_LIMITS.name.min) return 'TOO_SHORT';
  if (value.length > CATALOG_LIMITS.name.max) return 'TOO_LONG';
  return undefined;
}

/**
 * Validate and normalise a catalog item.
 *
 * `existingType` is supplied when editing: the category is immutable, so a
 * request that names a different one is refused rather than quietly ignored.
 */
export function validateCatalogInput(
  input: Record<string, unknown>,
  existingType?: CatalogType
): CatalogValidationResult {
  const errors: FieldErrors = {};

  // ── Category ─────────────────────────────────────────────────────────────
  const requestedType = toCatalogType(input['type']);
  const type = existingType ?? requestedType;

  if (!type) {
    errors['type'] = input['type'] === undefined ? FieldReason.REQUIRED : FieldReason.NOT_ALLOWED;
  } else if (existingType && requestedType && requestedType !== existingType) {
    // Retyping would silently reinterpret every profile pointing at this item.
    errors['type'] = FieldReason.NOT_ALLOWED;
  }

  // ── Code ─────────────────────────────────────────────────────────────────
  const rawCode = input['code'];
  const code = normaliseCatalogCode(rawCode);
  if (code.length === 0) {
    errors['code'] = FieldReason.REQUIRED;
  } else if (code.length < CATALOG_LIMITS.code.min) {
    errors['code'] = FieldReason.TOO_SHORT;
  } else if (code.length > CATALOG_LIMITS.code.max) {
    errors['code'] = FieldReason.TOO_LONG;
  } else if (!CATALOG_CODE_PATTERN.test(code)) {
    errors['code'] = FieldReason.INVALID;
  }

  // ── Names ────────────────────────────────────────────────────────────────
  // Both languages are required. A catalog that is bilingual for some rows and
  // not others produces a form that silently falls back to the wrong language.
  const nameEn = normaliseText(input['nameEn']);
  const nameEnReason = checkName(nameEn);
  if (nameEnReason) errors['nameEn'] = FieldReason[nameEnReason];

  const nameAr = normaliseText(input['nameAr']);
  const nameArReason = checkName(nameAr);
  if (nameArReason) errors['nameAr'] = FieldReason[nameArReason];

  // ── Sort order ───────────────────────────────────────────────────────────
  const rawSort = input['sortOrder'];
  let sortOrder = 0;
  if (rawSort !== undefined && rawSort !== null && rawSort !== '') {
    const parsed = typeof rawSort === 'number' ? rawSort : Number(String(rawSort).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      errors['sortOrder'] = FieldReason.INVALID;
    } else if (parsed < CATALOG_SORT_ORDER.min || parsed > CATALOG_SORT_ORDER.max) {
      errors['sortOrder'] = FieldReason.OUT_OF_RANGE;
    } else {
      sortOrder = parsed;
    }
  }

  // ── Active ───────────────────────────────────────────────────────────────
  // A new item defaults to active: an Admin adding a city means it to be
  // choosable, and requiring a second click to enable it is a trap.
  const active = input['active'] === undefined ? true : input['active'] === true;

  // ── Institution-only fields ──────────────────────────────────────────────
  const isInstitution = type === CATALOG_TYPE.INSTITUTION;

  let institutionKind: InstitutionKind | undefined;
  const rawKind = input['institutionKind'];
  if (isInstitution) {
    const parsed = toInstitutionKind(rawKind);
    if (rawKind === undefined || rawKind === null || rawKind === '') {
      errors['institutionKind'] = FieldReason.REQUIRED;
    } else if (!parsed) {
      errors['institutionKind'] = FieldReason.NOT_ALLOWED;
    } else {
      institutionKind = parsed;
    }
  } else if (rawKind !== undefined && rawKind !== null && rawKind !== '') {
    // A kind on a city is meaningless; accepting it would store a field the
    // rest of the system never reads.
    errors['institutionKind'] = FieldReason.NOT_ALLOWED;
  }

  const requestedOther = input['isOther'] === true;
  let isOther = false;
  if (requestedOther) {
    if (type && !TYPES_SUPPORTING_OTHER.includes(type)) {
      errors['isOther'] = FieldReason.NOT_ALLOWED;
    } else {
      isOther = true;
    }
  }

  const values: NormalisedCatalogItem = {
    type: (type ?? CATALOG_TYPE.CITY) as CatalogType,
    code,
    nameEn,
    nameAr,
    active,
    sortOrder,
    isOther,
  };
  if (institutionKind) values.institutionKind = institutionKind;

  return {values, errors};
}

/**
 * Refuse a request that tries to set a server-controlled column.
 *
 * Ignoring these silently would be safe but dishonest — a caller sending an
 * `objectId` inside the payload deserves to learn it was refused.
 */
export function findPrivilegedCatalogFields(input: Record<string, unknown>): string[] {
  const forbidden = ['objectId', 'ACL', 'acl', 'createdAt', 'updatedAt', 'className'];
  return forbidden.filter(key => Object.prototype.hasOwnProperty.call(input, key));
}

/** Trim and bound a search term. Never used as a regular expression. */
export function normaliseSearch(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .slice(0, CATALOG_LIMITS.search.max);
}

/**
 * Compare two items for display: `sortOrder` first, then the localised name.
 *
 * `localeCompare` with the active language is what puts Arabic names in Arabic
 * order rather than in code-point order, which would look arbitrary to a reader.
 */
export function compareForDisplay(
  a: {sortOrder: number; nameEn: string; nameAr: string},
  b: {sortOrder: number; nameEn: string; nameAr: string},
  language: string
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const isArabic = language === 'ar';
  const left = isArabic ? a.nameAr : a.nameEn;
  const right = isArabic ? b.nameAr : b.nameEn;
  return left.localeCompare(right, isArabic ? 'ar' : 'en');
}
