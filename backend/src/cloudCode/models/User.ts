import {ParseClass, ParseField} from '@90soft/parse-server-kit';
import {AppRole, roleKey} from '../utils/constants/roles';

/**
 * `_User` — identity only.
 *
 * Deny-by-default: every class-level operation is `{}`, so no client session can
 * find, get, count, create, update, or delete a user directly. All legitimate
 * access goes through a cloud function that resolves the caller from its session
 * and returns a hand-built DTO. In particular `create: {}` closes the
 * unauthenticated `_User` creation hole that the template shipped with.
 *
 * `protectedFields` is a second layer: even if a future query somehow reaches
 * this class, the sensitive columns are stripped for every non-master caller.
 */
@ParseClass('_User', {
  clp: {
    // No direct client access whatsoever. Cloud functions use the master key
    // for the narrow, server-controlled operations they implement.
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      // Stripped for unauthenticated callers…
      '*': [
        'email',
        'username',
        'emailVerified',
        'authData',
        'phoneNumber',
        'firstName',
        'lastName',
      ],
      // …and for authenticated ones. A signed-in user learns nothing about
      // another account from this class; their own data arrives via a DTO.
      authenticated: [
        'email',
        'username',
        'emailVerified',
        'authData',
        'phoneNumber',
      ],
    },
  },
  // Default object ACL: readable and writable only by Admin. Never public.
  ACL: {
    [roleKey(AppRole.ADMIN)]: {read: true, write: true},
  },
  description: 'User identity. Direct client access is denied; use cloud functions.',
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
    description: 'Unique login identifier (Admin accounts only)',
  })
  username!: string;

  @ParseField({
    type: 'String',
    description: 'Account email address',
  })
  email!: string;

  @ParseField({
    type: 'String',
    description: 'Given name',
  })
  firstName!: string;

  @ParseField({
    type: 'String',
    description: 'Family name',
  })
  lastName!: string;

  @ParseField({
    type: 'String',
    description: 'Contact phone number',
  })
  phoneNumber!: string;
}
