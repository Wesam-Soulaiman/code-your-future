import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';
import {BeforeSave, AfterSave, AfterDelete} from '@90soft/parse-server-kit';
import {catchError} from '@90soft/parse-server-kit';
import {processImage} from '../utils/imageProcessing';
import {safeLog} from '../utils/logging/safeLogger';

/**
 * `IMG` — private image infrastructure.
 *
 * Deny-by-default: no client session may find, get, count, create, update, or
 * delete an `IMG`, and the default object ACL grants nobody anything. Records
 * are created only by a trusted server-controlled flow.
 *
 * The WebP / thumbnail / blurhash pipeline is unchanged and still runs on
 * `beforeSave`; only the access boundary changed.
 *
 * FUTURE EXTENSION POINT (Checkpoint 4 — StudentProfile photo): the photo is
 * uploaded through a cloud function that authorises the caller, saves the `IMG`
 * with the master key, and stamps a per-record ACL limited to the owning Student
 * and Admin. Reads go through a cloud function that authorises and then streams
 * the bytes — no public URL is published. See Open Question OQ-10.
 */
@ParseClass('IMG', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      // Never surface the raw storage handles to a non-master caller.
      '*': ['image', 'imageThumbNail'],
      authenticated: ['image', 'imageThumbNail'],
    },
  },
  // Deny-by-default object ACL. Per-record ACL is stamped by the server flow
  // that creates the image.
  ACL: {},
  description: 'Private image record. Server-controlled access only.',
})
export default class IMG extends BaseModel {
  constructor() {
    super('IMG');
  }

  @ParseField({
    type: 'File',
    description: 'Processed full-size image',
  })
  image!: Parse.File;

  @ParseField({
    type: 'File',
    description: 'Thumbnail variant',
  })
  imageThumbNail!: Parse.File;

  @ParseField({
    type: 'String',
    description: 'BlurHash placeholder string',
  })
  blurHash!: string;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Process uploaded images; reject client-supplied ACL'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<IMG>) {
    const object = request.object;

    // A client must never choose the ACL of a private image. Only a master-key
    // (server-controlled) save may set one.
    if (!request.master && object.dirty('ACL')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'ACL cannot be set by a client'
      );
    }

    // Only (re)process when the image File itself changed. An ACL-only update
    // skips the expensive WebP/thumbnail/blurhash pipeline and leaves the stored
    // file untouched.
    if (!object.dirty('image')) return;

    const image = object.get('image') as Parse.File | undefined;
    const url = image?.url();

    if (!url) return;

    const [error, result] = await catchError(processImage(url));

    if (error) {
      // Never log the error object raw — it may carry the request/response of
      // the image download.
      safeLog.error('Image processing failed', {
        op: 'IMG.beforeSave',
        ok: false,
        stage: 'processImage',
      });
      throw new Parse.Error(
        Parse.Error.INTERNAL_SERVER_ERROR,
        'Failed to process image'
      );
    }

    object.set('image', result!.large);
    object.set('imageThumbNail', result!.thumbnail);
    object.set('blurHash', result!.blurhash);
  }

  @AfterSave({description: 'Cleanup superseded image files'})
  static async onAfterSave(request: Parse.Cloud.AfterSaveRequest<IMG>) {
    const object = request.object;
    const original = request.original;

    if (original) {
      const currentImage = object.get('image') as Parse.File | undefined;
      const originalImage = original.get('image') as Parse.File | undefined;

      if (currentImage?.name() !== originalImage?.name()) {
        const originalThumb = original.get('imageThumbNail') as Parse.File | undefined;
        await Promise.all([
          originalImage?.destroy({useMasterKey: true}),
          originalThumb?.destroy({useMasterKey: true}),
        ]);
      }
    }
  }

  @AfterDelete({description: 'Cleanup associated files'})
  static async onAfterDelete(request: Parse.Cloud.AfterDeleteRequest<IMG>) {
    const object = request.object;
    const image = object.get('image') as Parse.File | undefined;
    const thumbnail = object.get('imageThumbNail') as Parse.File | undefined;

    await Promise.all([
      image?.destroy({useMasterKey: true}),
      thumbnail?.destroy({useMasterKey: true}),
    ]);
  }
}
