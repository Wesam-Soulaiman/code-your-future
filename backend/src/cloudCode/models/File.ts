import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';
import {BeforeSave} from '@90soft/parse-server-kit';

@ParseClass('File', {
  clp: {
    find: {'role:SuperAdmin': true, 'role:Employee': true},
    get: {'role:SuperAdmin': true, 'role:Employee': true},
    create: {'role:SuperAdmin': true, 'role:Employee': true},
    update: {'role:SuperAdmin': true, 'role:Employee': true},
    delete: {'role:SuperAdmin': true, 'role:Employee': true},
  },
})
export default class File extends BaseModel {
  constructor() {
    super('File');
  }

  @ParseField({
    type: 'File',
    description: 'The uploaded file',
  })
  file!: Parse.File;

  @ParseField({
    type: 'Number',
    description: 'File size in bytes',
  })
  fileSize!: number;

  @ParseField({
    type: 'String',
    description: 'MIME type of the file',
  })
  type!: string;

  // ==================== TRIGGERS ====================

  @BeforeSave({description: 'Extract file type from filename'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<File>) {
    const object = request.object;

    if (object.isNew()) {
      const file = object.get('file') as Parse.File | undefined;
      object.set('type', file?.name().split('.').pop() || 'unknown');
    }
  }
}
