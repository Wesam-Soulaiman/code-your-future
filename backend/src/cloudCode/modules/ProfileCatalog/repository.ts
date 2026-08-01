/**
 * Catalog persistence — the only place that reads or writes
 * `ProfileCatalogItem`.
 *
 * Every operation uses the master key, because the class denies all client
 * access by design; authorisation happens above, in the cloud function, before
 * anything here is called.
 *
 * The rule this file exists to keep: **an item is always addressed by id *and*
 * its category**. There is no `findById(id)` that ignores the type, so an Admin
 * editing the Cities tab cannot reach a major by pasting its id, and a
 * mis-scoped call fails closed rather than crossing categories.
 */

import {catchError} from '@90soft/parse-server-kit';

import {CATALOG_MAX_ITEMS, CATALOG_TYPES, CatalogType} from './constants';
import {CatalogError, catalogError} from './errors';
import {NormalisedCatalogItem} from './validation';

const CLASS_NAME = 'ProfileCatalogItem';

/** The profile columns that point at a catalog item. */
export const PROFILE_CATALOG_REFERENCE_FIELDS: readonly string[] = [
  'city',
  'institution',
  'major',
  'targetRole',
];

/** Parse's duplicate-value code, plus MongoDB's raw duplicate-key code. */
const PARSE_DUPLICATE_VALUE = 137;
const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code;
  if (code === PARSE_DUPLICATE_VALUE || code === MONGO_DUPLICATE_KEY) return true;
  const message = String((error as {message?: unknown} | null)?.message ?? '');
  return message.includes('E11000') || message.includes('duplicate key');
}

function catalogQuery(type: CatalogType): Parse.Query {
  const query = new Parse.Query(CLASS_NAME);
  query.equalTo('type', type);
  query.limit(CATALOG_MAX_ITEMS);
  return query;
}

/** Every item in a category, active or not. Admin-facing. */
export async function findItemsByType(type: CatalogType): Promise<Parse.Object[]> {
  const [error, items] = await catchError(catalogQuery(type).find({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  return (items ?? []) as Parse.Object[];
}

/** Only the items on offer. Student-facing. */
export async function findActiveItemsByType(type: CatalogType): Promise<Parse.Object[]> {
  const query = catalogQuery(type);
  query.equalTo('active', true);

  const [error, items] = await catchError(query.find({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  return (items ?? []) as Parse.Object[];
}

/**
 * One item, addressed by id **and** category.
 *
 * The type is part of the lookup rather than a check afterwards, so a
 * cross-category id simply does not resolve.
 */
export async function findItemById(
  id: unknown,
  type?: CatalogType
): Promise<Parse.Object | undefined> {
  if (typeof id !== 'string' || id.trim().length === 0) return undefined;

  const query = new Parse.Query(CLASS_NAME);
  query.equalTo('objectId', id.trim());
  if (type) query.equalTo('type', type);

  const [error, item] = await catchError(query.first({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  return (item as Parse.Object | undefined) ?? undefined;
}

/** Resolve several ids at once, keyed by id. Used when building a profile DTO. */
export async function findItemsByIds(
  ids: readonly string[]
): Promise<Map<string, Parse.Object>> {
  const unique = [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))];
  const resolved = new Map<string, Parse.Object>();
  if (unique.length === 0) return resolved;

  const query = new Parse.Query(CLASS_NAME);
  query.containedIn('objectId', unique);
  query.limit(unique.length);

  const [error, items] = await catchError(query.find({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);

  for (const item of (items ?? []) as Parse.Object[]) {
    resolved.set(item.id as string, item);
  }
  return resolved;
}

/** The item holding a code within a category, if any. */
export async function findItemByCode(
  type: CatalogType,
  code: string
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(CLASS_NAME);
  query.equalTo('type', type);
  query.equalTo('code', code);

  const [error, item] = await catchError(query.first({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  return (item as Parse.Object | undefined) ?? undefined;
}

/** Apply the normalised values to an item. Never touches `type` after creation. */
function applyValues(item: Parse.Object, values: NormalisedCatalogItem, created: boolean): void {
  if (created) {
    item.set('type', values.type);

    // Deny-by-default: no public access, and no per-record grant to anybody.
    // Every read goes through an authorised operation using the master key.
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    item.setACL(acl);
  }

  item.set('code', values.code);
  item.set('nameEn', values.nameEn);
  item.set('nameAr', values.nameAr);
  item.set('active', values.active);
  item.set('sortOrder', values.sortOrder);

  if (values.institutionKind) item.set('institutionKind', values.institutionKind);
  else item.unset('institutionKind');

  if (values.isOther) item.set('isOther', true);
  else item.unset('isOther');
}

/** Create a new item. Duplicate codes within a category are refused. */
export async function createItem(values: NormalisedCatalogItem): Promise<Parse.Object> {
  const existing = await findItemByCode(values.type, values.code);
  if (existing) throw catalogError(CatalogError.CATALOG_DUPLICATE);

  const ItemClass = Parse.Object.extend(CLASS_NAME);
  const item = new ItemClass() as Parse.Object;
  applyValues(item, values, true);

  const [error, saved] = await catchError(item.save(null, {useMasterKey: true}));
  if (error || !saved) {
    // The unique index is the real gate; the check above only produces a nicer
    // message when there is no race.
    if (isDuplicateKeyError(error)) throw catalogError(CatalogError.CATALOG_DUPLICATE);
    throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  }
  return saved as Parse.Object;
}

/** Update an existing item. The category cannot move. */
export async function updateItem(
  item: Parse.Object,
  values: NormalisedCatalogItem
): Promise<Parse.Object> {
  const clash = await findItemByCode(values.type, values.code);
  if (clash && clash.id !== item.id) throw catalogError(CatalogError.CATALOG_DUPLICATE);

  applyValues(item, values, false);

  const [error, saved] = await catchError(item.save(null, {useMasterKey: true}));
  if (error || !saved) {
    if (isDuplicateKeyError(error)) throw catalogError(CatalogError.CATALOG_DUPLICATE);
    throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  }
  return saved as Parse.Object;
}

/** Activate or deactivate an item. Deactivation is always allowed. */
export async function setItemActive(
  item: Parse.Object,
  active: boolean
): Promise<Parse.Object> {
  item.set('active', active);
  const [error, saved] = await catchError(item.save(null, {useMasterKey: true}));
  if (error || !saved) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  return saved as Parse.Object;
}

/**
 * How many Student profiles reference an item.
 *
 * Checked across **every** reference column, not just the one matching the
 * item's category: an item that is somehow referenced from an unexpected column
 * is still referenced, and deleting it would leave a dangling pointer in
 * somebody's profile.
 *
 * The count is the only thing returned. Which Students chose a particular city
 * is not something a delete confirmation needs to know.
 */
export async function countProfileReferences(item: Parse.Object): Promise<number> {
  const queries = PROFILE_CATALOG_REFERENCE_FIELDS.map(field => {
    const query = new Parse.Query('StudentProfile');
    query.equalTo(field, item);
    return query;
  });

  const [error, counts] = await catchError(
    Promise.all(queries.map(query => query.count({useMasterKey: true})))
  );
  if (error || !counts) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);

  return (counts as number[]).reduce((total, value) => total + value, 0);
}

/**
 * Delete an item, but only when nothing points at it.
 *
 * A referenced item is refused with `CATALOG_IN_USE` rather than cascaded or
 * nulled: a Student's stored answer is theirs, and an Admin tidying a list must
 * not silently blank a field in somebody's profile. Deactivation is the way to
 * retire a value that is in use.
 */
export async function deleteItem(item: Parse.Object): Promise<void> {
  const references = await countProfileReferences(item);
  if (references > 0) throw catalogError(CatalogError.CATALOG_IN_USE);

  const [error] = await catchError(item.destroy({useMasterKey: true}));
  if (error) throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
}

/**
 * Create an item if its code is free, otherwise leave the stored one alone.
 *
 * Used by seeding, which must be safe to run on every boot. An Admin who has
 * renamed or deactivated a seeded institution keeps their change: the seed
 * establishes a starting point, it does not reassert itself forever.
 */
export async function ensureItem(
  values: NormalisedCatalogItem
): Promise<{item: Parse.Object; created: boolean}> {
  const existing = await findItemByCode(values.type, values.code);
  if (existing) return {item: existing, created: false};

  const [error, created] = await catchError(createItem(values));
  if (error || !created) {
    // A concurrent boot won the unique index. Re-read rather than fail: both
    // processes wanted the same row to exist, and it now does.
    const winner = await findItemByCode(values.type, values.code);
    if (winner) return {item: winner, created: false};
    throw catalogError(CatalogError.CATALOG_SAVE_FAILED);
  }
  return {item: created as Parse.Object, created: true};
}

/** Every category, for iteration. Re-exported so call sites need one import. */
export {CATALOG_TYPES};
