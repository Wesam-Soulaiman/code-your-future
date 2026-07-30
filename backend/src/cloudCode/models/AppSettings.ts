import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';

@ParseClass('AppSettings', {
  clp: {
    find: {'role:SuperAdmin': true, 'role:Employee': true},
    get: {'role:SuperAdmin': true, 'role:Employee': true},
    count: {},
    create: {},
    update: {},
    delete: {},
  },
  ACL: {
    'role:SuperAdmin': {read: true, write: true},
    'role:Employee': {read: true},
  },
  description: 'Global application settings stored as key-value pairs',
})
export default class AppSettings extends BaseModel {
  constructor() {
    super('AppSettings');
  }

  @ParseField({
    type: 'String',
    required: true,
    unique: true,
    description: 'Unique setting key',
  })
  key!: string;

  @ParseField({
    type: 'String',
    description: 'Setting value (ISO string, JSON, or plain text)',
  })
  value!: string;
}
