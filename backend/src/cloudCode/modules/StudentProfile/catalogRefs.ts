/**
 * Resolving the four catalog selections on a Student profile.
 *
 * The request carries ids. **Nothing the browser sends about a catalog item is
 * trusted** — not the name, not the language, not whether it is active. The
 * backend loads the authoritative row and stores a pointer to it, so a renamed
 * city renames everywhere at once and a forged name has nowhere to land.
 *
 * ── The one rule that needs care ────────────────────────────────────────────
 * An **inactive** item may stay on a profile that already references it, but may
 * never be newly selected. Both halves matter:
 *
 *   - keeping it means an Admin retiring a value does not silently break the
 *     profiles of everyone who chose it, or force them to re-answer a question
 *     they already answered;
 *   - refusing it as a *new* choice is what makes deactivation mean anything.
 *
 * So the check is not "is this active?" but "is this active, **or** is it what
 * was already stored?" — which is why the currently-stored profile is passed in.
 */

import {catchError} from '@90soft/parse-server-kit';

import {CatalogType} from '../ProfileCatalog/constants';
import {findItemsByIds} from '../ProfileCatalog/repository';
import {
  CATALOG_REFERENCE_FIELDS,
  CATALOG_REFERENCE_NAMES,
  CatalogReferenceField,
} from './constants';
import {FieldErrors, FieldReason, ProfileError, profileError} from './errors';

/** The resolved selections, ready to be written as pointers. */
export type ResolvedCatalogSelections = Partial<
  Record<CatalogReferenceField, Parse.Object>
>;

export interface CatalogResolution {
  values: ResolvedCatalogSelections;
  errors: FieldErrors;
  /** True when the chosen institution is the escape hatch. */
  institutionIsOther: boolean;
}

/** The id currently stored in a reference column, if any. */
export function storedReferenceId(
  profile: Parse.Object | undefined,
  field: CatalogReferenceField
): string | undefined {
  const pointer = profile?.get(field) as Parse.Object | undefined;
  const id = pointer?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function requestedId(input: Record<string, unknown>, field: CatalogReferenceField): string {
  const raw = input[CATALOG_REFERENCE_FIELDS[field].param];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Resolve every catalog selection in one request.
 *
 * All four ids are loaded in a **single** query rather than one round trip per
 * field, so a save costs the same whether the Student changed one selection or
 * all of them.
 */
export async function resolveCatalogSelections(
  input: Record<string, unknown>,
  existing: Parse.Object | undefined
): Promise<CatalogResolution> {
  const errors: FieldErrors = {};
  const values: ResolvedCatalogSelections = {};

  const wanted: {field: CatalogReferenceField; id: string}[] = [];

  for (const field of CATALOG_REFERENCE_NAMES) {
    const spec = CATALOG_REFERENCE_FIELDS[field];
    const id = requestedId(input, field);

    if (id.length === 0) {
      // An optional selection simply clears; a required one is a failure.
      if (spec.required) errors[spec.param] = FieldReason.REQUIRED;
      continue;
    }
    wanted.push({field, id});
  }

  if (wanted.length === 0) {
    return {values, errors, institutionIsOther: false};
  }

  const [error, resolved] = await catchError(findItemsByIds(wanted.map(entry => entry.id)));
  if (error || !resolved) throw profileError(ProfileError.PROFILE_UNAVAILABLE);

  const items = resolved as Map<string, Parse.Object>;

  for (const {field, id} of wanted) {
    const spec = CATALOG_REFERENCE_FIELDS[field];
    const item = items.get(id);

    // No such item, or an id borrowed from another category. Both are the same
    // answer to the client: this is not a value you may choose.
    if (!item || String(item.get('type')) !== (spec.type as CatalogType)) {
      errors[spec.param] = FieldReason.NOT_ALLOWED;
      continue;
    }

    if (item.get('active') !== true && storedReferenceId(existing, field) !== id) {
      // Retired, and not what this profile already had.
      errors[spec.param] = FieldReason.NOT_ALLOWED;
      continue;
    }

    values[field] = item;
  }

  return {
    values,
    errors,
    institutionIsOther: values.institution?.get('isOther') === true,
  };
}
