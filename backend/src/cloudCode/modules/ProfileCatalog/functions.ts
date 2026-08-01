/**
 * Profile catalog surface — six focused operations, no generic CRUD.
 *
 * Five Admin operations under `/api/profile-catalogs`:
 *
 *   listProfileCatalogItems     every item in one category, active or not
 *   createProfileCatalogItem    add one
 *   updateProfileCatalogItem    edit one; the category cannot move
 *   setProfileCatalogItemActive activate or deactivate
 *   deleteProfileCatalogItem    delete, but only when nothing references it
 *
 * One Student operation under `/api/student-catalog`:
 *
 *   getProfileCatalog           the **active** items a form may offer
 *
 * Every one of them:
 *   - requires an authenticated session;
 *   - verifies **live** role membership, so a withdrawn role takes effect
 *     immediately;
 *   - takes a category from a **closed four-value allow-list**, never a class
 *     name and never a free-form query;
 *   - returns a hand-built DTO;
 *   - returns a stable error code and nothing else.
 *
 * There is deliberately no operation that takes a class name, no operation that
 * accepts an arbitrary `where`, and no path by which a Student reaches an
 * inactive item they have not already chosen.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {requireAdmin, requireStudent, rejectPrivilegedParams} from '../../utils/auth/authorize';
import {
  CATALOG_TYPES,
  CatalogType,
  TYPES_SUPPORTING_OTHER,
  toCatalogType,
} from './constants';
import {toCatalogItemDto} from './dto';
import {
  CatalogError,
  FieldErrors,
  FieldReason,
  catalogError,
  isCatalogErrorCode,
} from './errors';
import {catalogLog} from './logging';
import {
  createItem,
  deleteItem,
  findActiveItemsByType,
  findItemById,
  findItemsByType,
  setItemActive,
  updateItem,
} from './repository';
import {
  compareForDisplay,
  findPrivilegedCatalogFields,
  normaliseSearch,
  validateCatalogInput,
} from './validation';

/**
 * The last gate before a message reaches the client. Anything unexpected — a
 * database failure, a driver stack trace — collapses to a stable code.
 */
function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (typeof message === 'string') {
    const [code] = message.split(':');
    if (isCatalogErrorCode(code)) return error as Parse.Error;
  }
  return catalogError(CatalogError.CATALOG_SAVE_FAILED);
}

/**
 * Read the category from a request.
 *
 * This is the single choke point that keeps the model from becoming a generic
 * store: the value must be one of exactly four, and anything else is a
 * validation failure before a query exists.
 */
function requireType(params: Record<string, unknown>): CatalogType {
  const type = toCatalogType(params['type']);
  if (!type) {
    const fields: FieldErrors = {
      type: params['type'] === undefined ? FieldReason.REQUIRED : FieldReason.NOT_ALLOWED,
    };
    throw catalogError(CatalogError.CATALOG_VALIDATION_FAILED, fields);
  }
  return type;
}

/** The display language for sorting. Never used for authorisation. */
function requestLanguage(params: Record<string, unknown>): string {
  return String(params['lang'] ?? 'en').toLowerCase() === 'ar' ? 'ar' : 'en';
}

/** Match a search term against both names and the code. Case-insensitive. */
function matchesSearch(item: Parse.Object, term: string): boolean {
  if (term.length === 0) return true;
  const needle = term.toLowerCase();
  return (
    String(item.get('nameEn') ?? '').toLowerCase().includes(needle) ||
    String(item.get('nameAr') ?? '').toLowerCase().includes(needle) ||
    String(item.get('code') ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Resolve one item by id within a category, or fail with a stable code.
 *
 * The category is part of the lookup, so an id from another tab does not
 * resolve — an Admin on the Cities tab cannot edit a major by pasting its id.
 */
async function requireItem(
  id: unknown,
  type: CatalogType
): Promise<Parse.Object> {
  const [error, item] = await catchError(findItemById(id, type));
  if (error) throw toClientError(error);
  if (!item) throw catalogError(CatalogError.CATALOG_NOT_FOUND);
  return item as Parse.Object;
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════════

@Route('profile-catalogs')
class ProfileCatalogAdminFunctions {
  /**
   * Every item in one category, active or not.
   *
   * An Admin needs to see the retired values too — that is how a deactivated
   * item gets brought back — so this is the one read that does not filter on
   * `active`.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'List profile catalog items',
      description:
        'Every item in one of the four approved categories, active or not. Admins only.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Safe catalog DTOs'},
        '400': {description: 'Unknown category'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not an Admin'},
      },
    },
  })
  async listProfileCatalogItems(req: Parse.Cloud.FunctionRequest) {
    const user = await requireAdmin(req, 'listProfileCatalogItems');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const type = requireType(params);
    const search = normaliseSearch(params['search']);
    const language = requestLanguage(params);

    const [error, items] = await catchError(findItemsByType(type));
    if (error || !items) throw toClientError(error);

    const dtos = (items as Parse.Object[])
      .filter(item => matchesSearch(item, search))
      .map(toCatalogItemDto)
      .sort((a, b) => compareForDisplay(a, b, language));

    catalogLog.info('Catalog listed', {
      op: 'listProfileCatalogItems',
      stage: 'load',
      ok: true,
      userId: user.id,
      type,
      count: dtos.length,
    });

    // The supported sub-kinds travel with the list so the Admin form offers
    // exactly what the backend accepts, without a second round trip.
    return {
      type,
      items: dtos,
      supportsOther: TYPES_SUPPORTING_OTHER.includes(type),
    };
  }

  /** Add an item. The normalised code must be free within the category. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Create a profile catalog item',
      description: 'Add one item to one of the four approved categories. Admins only.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Created; returns the safe DTO'},
        '400': {description: 'Validation failed'},
        '403': {description: 'Not an Admin'},
      },
    },
  })
  async createProfileCatalogItem(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'createProfileCatalogItem');
    const user = await requireAdmin(req, 'createProfileCatalogItem');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const privileged = findPrivilegedCatalogFields(params);
    if (privileged.length > 0) {
      const fields: FieldErrors = {};
      for (const key of privileged) fields[key] = FieldReason.NOT_ALLOWED;
      catalogLog.warn('Rejected server-controlled fields in a catalog create', {
        op: 'createProfileCatalogItem',
        stage: 'validate',
        ok: false,
        userId: user.id,
        fieldCount: privileged.length,
        code: CatalogError.CATALOG_VALIDATION_FAILED,
      });
      throw catalogError(CatalogError.CATALOG_VALIDATION_FAILED, fields);
    }

    const {values, errors} = validateCatalogInput(params);
    if (Object.keys(errors).length > 0) {
      catalogLog.warn('Catalog validation failed', {
        op: 'createProfileCatalogItem',
        stage: 'validate',
        ok: false,
        userId: user.id,
        fieldCount: Object.keys(errors).length,
        code: CatalogError.CATALOG_VALIDATION_FAILED,
      });
      throw catalogError(CatalogError.CATALOG_VALIDATION_FAILED, errors);
    }

    const [error, item] = await catchError(createItem(values));
    if (error || !item) throw toClientError(error);

    catalogLog.info('Catalog item created', {
      op: 'createProfileCatalogItem',
      stage: 'complete',
      ok: true,
      userId: user.id,
      itemId: (item as Parse.Object).id,
      type: values.type,
    });

    return toCatalogItemDto(item as Parse.Object);
  }

  /** Edit an item. The category is immutable; the code stays unique. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {id: {required: true, type: String}}},
    swagger: {
      summary: 'Update a profile catalog item',
      description: 'Edit names, code, order, and sub-kind. The category cannot change.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Saved; returns the safe DTO'},
        '400': {description: 'Validation failed'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such item in that category'},
      },
    },
  })
  async updateProfileCatalogItem(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'updateProfileCatalogItem');
    const user = await requireAdmin(req, 'updateProfileCatalogItem');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const type = requireType(params);
    const item = await requireItem(params['id'], type);

    // The stored category wins, so a mismatched `type` in the payload is a
    // validation failure rather than a silent no-op.
    const {values, errors} = validateCatalogInput(params, String(item.get('type')) as CatalogType);
    if (Object.keys(errors).length > 0) {
      catalogLog.warn('Catalog validation failed', {
        op: 'updateProfileCatalogItem',
        stage: 'validate',
        ok: false,
        userId: user.id,
        itemId: item.id,
        fieldCount: Object.keys(errors).length,
        code: CatalogError.CATALOG_VALIDATION_FAILED,
      });
      throw catalogError(CatalogError.CATALOG_VALIDATION_FAILED, errors);
    }

    const [error, saved] = await catchError(updateItem(item, values));
    if (error || !saved) throw toClientError(error);

    catalogLog.info('Catalog item updated', {
      op: 'updateProfileCatalogItem',
      stage: 'complete',
      ok: true,
      userId: user.id,
      itemId: (saved as Parse.Object).id,
      type: values.type,
    });

    return toCatalogItemDto(saved as Parse.Object);
  }

  /**
   * Activate or deactivate.
   *
   * Deactivation is always permitted, including for an item Students already
   * reference — that is exactly what it is for. Their stored answer keeps
   * displaying; the value simply stops being offered to anybody new.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {id: {required: true, type: String}, active: {required: true, type: Boolean}},
    },
    swagger: {
      summary: 'Activate or deactivate a catalog item',
      description:
        'A deactivated item stays valid on profiles that already reference it, ' +
        'but is never offered as a new choice.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Saved; returns the safe DTO'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such item in that category'},
      },
    },
  })
  async setProfileCatalogItemActive(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'setProfileCatalogItemActive');
    const user = await requireAdmin(req, 'setProfileCatalogItemActive');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const type = requireType(params);
    const item = await requireItem(params['id'], type);
    const active = params['active'] === true;

    const [error, saved] = await catchError(setItemActive(item, active));
    if (error || !saved) throw toClientError(error);

    catalogLog.info('Catalog item activation changed', {
      op: 'setProfileCatalogItemActive',
      stage: 'complete',
      ok: true,
      userId: user.id,
      itemId: (saved as Parse.Object).id,
      type,
    });

    return toCatalogItemDto(saved as Parse.Object);
  }

  /**
   * Delete an item that nothing references.
   *
   * A referenced item is refused with `CATALOG_IN_USE`. Cascading or nulling
   * would silently blank a field in somebody's profile; deactivation is the
   * supported way to retire a value that is in use.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true, fields: {id: {required: true, type: String}}},
    swagger: {
      summary: 'Delete a profile catalog item',
      description:
        'Permanently remove an unused item. An item referenced by a Student ' +
        'profile is refused with CATALOG_IN_USE and may be deactivated instead.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Deleted'},
        '403': {description: 'Not an Admin, or the item is in use'},
        '404': {description: 'No such item in that category'},
      },
    },
  })
  async deleteProfileCatalogItem(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'deleteProfileCatalogItem');
    const user = await requireAdmin(req, 'deleteProfileCatalogItem');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const type = requireType(params);
    const item = await requireItem(params['id'], type);
    const itemId = item.id as string;

    const [error] = await catchError(deleteItem(item));
    if (error) {
      catalogLog.warn('Catalog item could not be deleted', {
        op: 'deleteProfileCatalogItem',
        stage: 'delete',
        ok: false,
        userId: user.id,
        itemId,
        type,
        code: CatalogError.CATALOG_IN_USE,
      });
      throw toClientError(error);
    }

    catalogLog.info('Catalog item deleted', {
      op: 'deleteProfileCatalogItem',
      stage: 'complete',
      ok: true,
      userId: user.id,
      itemId,
      type,
    });

    return {id: itemId, type, deleted: true};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Student
// ═══════════════════════════════════════════════════════════════════════════

@Route('student-catalog')
class ProfileCatalogStudentFunctions {
  /**
   * The active items a Student form may offer.
   *
   * `types` is an optional comma-separated subset of the same closed
   * allow-list; the default is all four, so the form fills its selects in one
   * round trip. An unrecognised name is a validation failure, not a filter that
   * silently returns nothing.
   *
   * Inactive items are never returned. A Student whose profile already points
   * at one still sees it, because it travels with **their own profile**, not
   * with this list.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Get the active profile catalog',
      description:
        'Active items for the four approved categories, sorted for display. ' +
        'Students only.',
      tags: ['Profile catalog'],
      responses: {
        '200': {description: 'Safe catalog DTOs, keyed by category'},
        '400': {description: 'Unknown category'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not a Student'},
      },
    },
  })
  async getProfileCatalog(req: Parse.Cloud.FunctionRequest) {
    const user = await requireStudent(req, 'getProfileCatalog');
    const params = (req.params ?? {}) as Record<string, unknown>;
    const language = requestLanguage(params);

    const raw = params['types'];
    let requested: CatalogType[];

    if (raw === undefined || raw === null || String(raw).trim().length === 0) {
      requested = [...CATALOG_TYPES];
    } else {
      const names = String(raw)
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0);

      requested = [];
      for (const name of names) {
        const type = toCatalogType(name);
        // A name outside the allow-list is refused outright: quietly dropping
        // it would return a partial catalog that looks complete.
        if (!type) {
          throw catalogError(CatalogError.CATALOG_VALIDATION_FAILED, {
            types: FieldReason.NOT_ALLOWED,
          });
        }
        if (!requested.includes(type)) requested.push(type);
      }
    }

    const result: Record<string, ReturnType<typeof toCatalogItemDto>[]> = {};
    let total = 0;

    for (const type of requested) {
      const [error, items] = await catchError(findActiveItemsByType(type));
      if (error || !items) throw toClientError(error);

      const dtos = (items as Parse.Object[])
        .map(toCatalogItemDto)
        .sort((a, b) => compareForDisplay(a, b, language));

      result[type] = dtos;
      total += dtos.length;
    }

    catalogLog.info('Student catalog read', {
      op: 'getProfileCatalog',
      stage: 'load',
      ok: true,
      userId: user.id,
      count: total,
    });

    return result;
  }
}

export default ProfileCatalogAdminFunctions;
export {ProfileCatalogStudentFunctions};
