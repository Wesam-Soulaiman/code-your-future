import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';
import {BeforeSave} from '@90soft/parse-server-kit';

/**
 * `File` — private file infrastructure.
 *
 * Deny-by-default: no client session may find, get, count, create, update, or
 * delete a `File` record, and the default object ACL grants nobody anything.
 * Records are created only by a trusted server-controlled flow (a cloud function
 * running with the master key after it has authorised the caller).
 *
 * FUTURE EXTENSION POINT (Checkpoint 7 — Resources): controlled read access is
 * added by a cloud function that (1) authorises the caller against the owning
 * record, then (2) streams the bytes itself. The class stays closed and no
 * public download route is introduced. See docs/PRODUCT_REQUIREMENTS.md §10 and
 * Open Question OQ-10.
 */
@ParseClass('File', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      // Even with a master-key read, never surface the storage handle to a
      // non-master caller.
      '*': ['file'],
      authenticated: ['file'],
    },
  },
  // Deny-by-default object ACL. Nobody — public or role — gets implicit access.
  ACL: {},
  description: 'Private file record. Server-controlled access only.',
})
export default class File extends BaseModel {
  constructor() {
    super('File');
  }

  @ParseField({
    type: 'File',
    description: 'The stored file handle',
  })
  file!: Parse.File;

  @ParseField({
    type: 'Number',
    description: 'File size in bytes',
  })
  fileSize!: number;

  @ParseField({
    type: 'String',
    description: 'File extension derived on save',
  })
  type!: string;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Derive file type and reject client-supplied ACL'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<File>) {
    const object = request.object;

    // A client must never choose the ACL of a private file record. Only a
    // master-key (server-controlled) save may set one.
    if (!request.master && object.dirty('ACL')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'ACL cannot be set by a client'
      );
    }

    if (object.isNew()) {
      const file = object.get('file') as Parse.File | undefined;
      object.set('type', file?.name().split('.').pop() || 'unknown');
    }
  }
}
