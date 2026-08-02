import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {RESOURCE_MAX_BYTES, isStorableMimeType} from '../modules/BatchResource/constants';

/**
 * `BatchResource` — a file an Admin shares with one Batch ⟨CP5⟩.
 *
 * **Metadata only.** The bytes live in private GridFS storage and are addressed
 * by `storageKey`, which is 128 bits of randomness and never leaves the server.
 * A 20 MiB document inline on a Parse object would be loaded whole on every read
 * of the row, including reads that only wanted the title.
 *
 * ── Access ──────────────────────────────────────────────────────────────────
 * Deny-by-default on every class-level operation, an empty default object ACL,
 * and every column in `protectedFields`. Nothing reads this class directly: an
 * Admin manages Resources through focused operations, and an enrolled Student
 * receives a smaller DTO still. A query that somehow reached the class would
 * read an empty shell — including, and especially, `storageKey`.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No folder, tag, category, comment, rating, download count, or progress flag.
 * No generic metadata object and no JSON column: a place to put "anything else"
 * is a place where the next unreviewed field lands.
 *
 * There is also **no file replacement**. `storageKey` is written once, at
 * creation. Editing a title must not silently change what a Student downloads,
 * and a Resource whose bytes changed under a name people already know is worse
 * than a second Resource.
 */
@ParseClass('BatchResource', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'batch',
        'title',
        'description',
        'filename',
        'extension',
        'mimeType',
        'fileSize',
        'displayOrder',
        'storageKey',
        'uploadedBy',
      ],
      authenticated: [
        'batch',
        'title',
        'description',
        'filename',
        'extension',
        'mimeType',
        'fileSize',
        'displayOrder',
        'storageKey',
        'uploadedBy',
      ],
    },
  },
  // Deny-by-default. Every read and write goes through an authorised operation
  // using the master key; no per-record ACL grants anybody direct access.
  ACL: {},
  compoundIndexes: [
    {
      // The list query: every Resource of one Batch, in display order. One index
      // serves both the filter and the sort.
      //
      // `_p_batch` is the MongoDB column a Parse Pointer occupies; naming the
      // logical field would index a column that does not exist.
      fields: ['_p_batch', 'displayOrder'],
      name: 'batch_resource_order_index',
    },
    {
      // Storage cleanup and the download's key lookup. Unique because two rows
      // sharing a storage key would mean deleting one destroys the other's
      // bytes — the exact orphan-and-dangle problem this checkpoint has to
      // avoid.
      fields: ['storageKey'],
      unique: true,
      name: 'batch_resource_storage_key_unique',
      partialFilterNulls: true,
    },
  ],
  description:
    'A file shared with one Batch. Metadata only — the bytes are in private ' +
    'storage. Never readable or writable directly by any client.',
})
export default class BatchResource extends BaseModel {
  constructor() {
    super('BatchResource');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'Batch',
    required: true,
    description: 'The Batch this Resource belongs to. Immutable after creation',
  })
  batch!: Parse.Object;

  @ParseField({type: 'String', required: true, description: 'Title, as the Admin writes it'})
  title!: string;

  @ParseField({type: 'String', description: 'Optional description'})
  description!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'The sanitised original filename, sent back on download',
  })
  filename!: string;

  @ParseField({type: 'String', required: true, description: 'Lower-case, with the dot'})
  extension!: string;

  @ParseField({
    type: 'String',
    required: true,
    description: 'The MIME type this product decided on, never the browser',
  })
  mimeType!: string;

  @ParseField({type: 'Number', required: true, description: 'Size in bytes'})
  fileSize!: number;

  @ParseField({type: 'Number', required: true, description: 'Position within its Batch'})
  displayOrder!: number;

  @ParseField({
    type: 'String',
    required: true,
    description: 'Private storage key. Server-only; never in a DTO or a log',
  })
  storageKey!: string;

  @ParseField({
    type: 'Pointer',
    targetClass: '_User',
    required: true,
    description: 'The Admin who uploaded it. Resolved from the session, never sent',
  })
  uploadedBy!: Parse.User;

  /**
   * The invariants, enforced here as well as in the operations.
   *
   * The cloud functions check all of this first. This trigger exists because a
   * rule that lives in only one call path stops being true the moment somebody
   * adds a second one — and because `storageKey` immutability is the difference
   * between "no file replacement" being a product decision and being a fact.
   */
  @BeforeSave({
    description: 'Reject client writes, freeze the file fields, refuse a public ACL',
  })
  static async onBeforeSave(
    request: Parse.Cloud.BeforeSaveRequest<BatchResource>
  ): Promise<void> {
    const object = request.object;

    // Only the server writes here. Every legitimate path uses the master key.
    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'BatchResource is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      if (!object.get('batch')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Resource requires a Batch');
      }
      if (!object.get('storageKey')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Resource requires a storage key');
      }
      if (!object.get('uploadedBy')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Resource requires an uploader');
      }
    } else {
      // Written once, at creation. This is what makes "no file replacement" and
      // "the Batch cannot move" structural rather than procedural.
      for (const immutable of ['batch', 'storageKey', 'filename', 'extension', 'mimeType', 'fileSize', 'uploadedBy']) {
        if (object.dirty(immutable)) {
          throw new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            `${immutable} cannot change after a Resource is created`
          );
        }
      }
    }

    const size = object.get('fileSize');
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Resource requires a positive size');
    }
    if (size > RESOURCE_MAX_BYTES) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Resource exceeds the size limit');
    }

    // Only a MIME type this product will actually serve can be stored, so a
    // download can never be asked to send something unexpected.
    if (!isStorableMimeType(object.get('mimeType'))) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported media type');
    }

    const order = object.get('displayOrder');
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'displayOrder must be a whole number');
    }

    // Deny-by-default at the record level too.
    object.setACL(new Parse.ACL());
  }
}
