import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {
  CATALOG_TYPES,
  INSTITUTION_KINDS,
  CatalogType,
} from '../modules/ProfileCatalog/constants';

/**
 * `ProfileCatalogItem` — the closed vocabulary behind four profile selections.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 * It is a **typed catalog**, not an `AppSettings` table and not a generic
 * key/value store. `type` is restricted to exactly four values — `CITY`,
 * `INSTITUTION`, `MAJOR`, `TARGET_ROLE` — and nothing here holds a secret, a
 * feature flag, or a configuration value. One model serves all four categories
 * because they are the same shape; four near-identical classes would be four
 * places to get the access rules wrong.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every class-level operation, an empty default object ACL,
 * and no public raw class access. An Admin manages items through the
 * `profile-catalogs` operations; a Student receives sanitised, **active-only**
 * DTOs from a single focused read; a Visitor gets nothing. No client ever
 * touches this class directly.
 *
 * `protectedFields` is a second layer: a query that somehow reached this class
 * would read an empty shell.
 *
 * ── Server-controlled invariants ────────────────────────────────────────────
 * `type` is **immutable** after creation. Converting a city into a major would
 * silently retype every profile pointing at it, so the trigger below refuses it
 * outright rather than trusting every future call site to remember.
 */
@ParseClass('ProfileCatalogItem', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'type',
        'code',
        'nameEn',
        'nameAr',
        'active',
        'sortOrder',
        'institutionKind',
        'isOther',
      ],
      authenticated: [
        'type',
        'code',
        'nameEn',
        'nameAr',
        'active',
        'sortOrder',
        'institutionKind',
        'isOther',
      ],
    },
  },
  // Deny-by-default. Every read and write goes through an authorised operation
  // using the master key; no per-record ACL grants anybody direct access.
  ACL: {},
  compoundIndexes: [
    {
      // A code is unique **within its type**, so `DAMASCUS` can be both a city
      // and — in principle — something else, while two cities cannot collide.
      // Enforced by the database rather than by a check two concurrent creates
      // could both pass.
      fields: ['type', 'code'],
      unique: true,
      name: 'profile_catalog_type_code_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'Closed, typed vocabulary for the four profile selections. Admin-managed; ' +
    'never readable or writable directly by any client.',
})
export default class ProfileCatalogItem extends BaseModel {
  constructor() {
    super('ProfileCatalogItem');
  }

  @ParseField({
    type: 'String',
    required: true,
    description: 'CITY | INSTITUTION | MAJOR | TARGET_ROLE. Immutable after creation.',
  })
  type!: CatalogType;

  @ParseField({
    type: 'String',
    required: true,
    description: 'Normalised, unique within the type. Stable identifier for seeding.',
  })
  code!: string;

  @ParseField({type: 'String', required: true, description: 'English display name'})
  nameEn!: string;

  @ParseField({type: 'String', required: true, description: 'Arabic display name'})
  nameAr!: string;

  @ParseField({
    type: 'Boolean',
    description:
      'Inactive items stay valid on the profiles that already reference them, ' +
      'but are never offered as a new choice.',
  })
  active!: boolean;

  @ParseField({type: 'Number', description: 'Ascending display order within the type'})
  sortOrder!: number;

  @ParseField({
    type: 'String',
    description: 'UNIVERSITY | INSTITUTE | OTHER. Only meaningful when type is INSTITUTION.',
  })
  institutionKind!: string;

  @ParseField({
    type: 'Boolean',
    description:
      'Marks the escape hatch that requires a typed name. Only supported for ' +
      'INSTITUTION.',
  })
  isOther!: boolean;

  // ==================== TRIGGERS ====================

  /**
   * The last line of defence, independent of which operation saved.
   *
   * The CLP already denies client writes; this also protects against a future
   * server-side path that forgets the master key, and freezes the one column
   * that must never move.
   */
  @BeforeSave({description: 'Reject client writes, freeze the type, refuse a public ACL'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<ProfileCatalogItem>) {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Profile catalog items are server-controlled'
      );
    }

    const type = object.get('type');
    if (!(CATALOG_TYPES as readonly string[]).includes(String(type))) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Unknown profile catalog type'
      );
    }

    const kind = object.get('institutionKind');
    if (
      kind !== undefined &&
      kind !== null &&
      !(INSTITUTION_KINDS as readonly string[]).includes(String(kind))
    ) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Unknown institution kind'
      );
    }

    if (object.dirty('ACL')) {
      const acl = object.getACL();
      if (acl && (acl.getPublicReadAccess() || acl.getPublicWriteAccess())) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'A catalog item cannot be made public'
        );
      }
    }

    if (object.isNew()) return;

    if (object.dirty('type')) {
      // Retyping an item would silently reinterpret every profile that points
      // at it — a city would become a major without anybody editing a profile.
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'A catalog item cannot change category'
      );
    }
  }
}
