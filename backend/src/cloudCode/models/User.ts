import {ParseClass, ParseField} from '@90soft/parse-server-kit';
import type {AuthRole} from '@90soft/parse-server-kit';

@ParseClass('_User', {
  clp: {
    find: {'role:SuperAdmin': true, 'role:Employee': true},
    get: {'role:SuperAdmin': true, 'role:Employee': true},
    create: {'role:SuperAdmin': true},
    update: {
      'role:SuperAdmin': true,
      'role:Employee': true,
    },
    delete: {'role:SuperAdmin': true},
    count: {
      'role:SuperAdmin': true,
      'role:Employee': true,
    },
    protectedFields: {
      '*': ['email'],
      authenticated: [],
    },
  },
  ACL: {
    'role:SuperAdmin': {read: true, write: true},
    'role:Employee': {read: true},
  },
  description: 'User account with authentication credentials',
})
export default class User extends Parse.User {
  constructor() {
    super();
  }

  static pointer(id: string): User {
    const obj = new User();
    obj.id = id;
    return obj;
  }

  @ParseField({
    type: 'String',
    description: 'Unique username for login',
  })
  username!: string;

  @ParseField({
    type: 'String',
    description: 'User email address',
  })
  email!: string;

  @ParseField({
    type: 'String',
    description: 'User first name',
  })
  firstName!: string;

  @ParseField({
    type: 'String',
    description: 'User last name',
  })
  lastName!: string;

  @ParseField({
    type: 'String',
    description: 'User phone number',
  })
  phoneNumber!: string;

  static map(
    user?: User,
    assignedRole?: AuthRole | AuthRole[] | any[],
    sessionToken?: string
  ) {
    if (!user) {
      return undefined;
    }

    return {
      id: user.id,
      email: user.get('email'),
      username: user.get('username'),
      firstName: user.get('firstName'),
      lastName: user.get('lastName'),
      phoneNumber: user.get('phoneNumber'),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      sessionToken: sessionToken,
      role: assignedRole || [],
    };
  }
}
