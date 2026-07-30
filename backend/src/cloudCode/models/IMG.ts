import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';
import {BeforeSave, AfterSave, AfterDelete} from '@90soft/parse-server-kit';
import {catchError} from '@90soft/parse-server-kit';
import {processImage} from '../utils/imageProcessing';

@ParseClass('IMG', {
  clp: {
    find: {'role:SuperAdmin': true, 'role:Employee': true},
    get: {'role:SuperAdmin': true, 'role:Employee': true},
    count: {'role:SuperAdmin': true, 'role:Employee': true},
    create: {'role:SuperAdmin': true, 'role:Employee': true},
    update: {'role:SuperAdmin': true, 'role:Employee': true},
    delete: {'role:SuperAdmin': true, 'role:Employee': true},
  },
})
export default class IMG extends BaseModel {
  constructor() {
    super('IMG');
  }

  @ParseField({
    type: 'File',
    description: 'Original image file',
  })
  image!: Parse.File;

  @ParseField({
    type: 'File',
    description: 'Thumbnail version of the image',
  })
  imageThumbNail!: Parse.File;

  @ParseField({
    type: 'String',
    description: 'BlurHash placeholder string',
  })
  blurHash!: string;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Process uploaded images - WebP conversion, thumbnails, blurhash'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<IMG>) {
    const object = request.object;

    // Only (re)process when the image File itself changed. An ACL-only update —
    // e.g. syncImageAcl keeping an image in sync with its parent's visibility —
    // skips the expensive WebP/thumbnail/blurhash pipeline and leaves the stored
    // file untouched.
    if (!object.dirty('image')) return;

    const image = object.get('image') as Parse.File | undefined;
    const url = image?.url();

    if (!url) return;

    const [error, result] = await catchError(processImage(url));

    if (error) {
      console.error('Image processing failed:', error);
      throw new Parse.Error(
        Parse.Error.INTERNAL_SERVER_ERROR,
        'Failed to process image'
      );
    }

    object.set('image', result!.large);
    object.set('imageThumbNail', result!.thumbnail);
    object.set('blurHash', result!.blurhash);
  }

  @AfterSave({description: 'Cleanup old images when updated'})
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
