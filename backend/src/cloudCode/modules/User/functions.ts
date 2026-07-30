import User from '../../models/User';
import {
  CloudFunction, Route, catchError, UserRoles,
  generateRandomString, getUserRoles, getUsersRoles,
} from '@90soft/parse-server-kit';

@Route(User)
class UserFunctions {
  /**
   * Login user with username and password
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: false,
      fields: {
        username: {required: true, type: String},
        password: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Login user',
      description:
        'Authenticate a user with username and password and return session token',
      tags: ['Authentication'],
      responses: {
        '200': {
          description: 'Login successful with user data and session token',
        },
        '404': {description: 'Invalid credentials'},
      },
    },
  })
  async loginUser(req: Parse.Cloud.FunctionRequest) {
    const {username, password} = req.params;

    const [error, user] = await catchError<User>(
      User.logIn(username, password, {
        installationId: generateRandomString(10),
      })
    );

    if (error) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        'Invalid credentials'
      );
    }

    // Get user roles
    const roleNames = await getUserRoles(user);

    return User.map(user, roleNames, user.getSessionToken());
  }

  /**
   * Register a new user
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: false,
      fields: {
        username: {required: true, type: String},
        email: {required: true, type: String},
        password: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Register new user',
      description:
        'Create a new user account with username, email, and password',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'User created successfully'},
        '400': {description: 'Username already taken or invalid data'},
      },
    },
  })
  async signupUser(req: Parse.Cloud.FunctionRequest) {
    const {username, email, password} = req.params;

    const user = new User();
    user.username = username;
    user.email = email;
    user.set('password', password);

    const [error, savedUser] = await catchError(user.signUp());

    if (error) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, error.message);
    }

    // Assign default Employee role
    const roleQuery = new Parse.Query('_Role');
    roleQuery.equalTo('name', UserRoles.EMPLOYEE);
    const employeeRole = (await roleQuery.first({useMasterKey: true})) as
      | Parse.Role
      | undefined;

    if (employeeRole) {
      employeeRole.getUsers().add(savedUser);
      await employeeRole.save(null, {useMasterKey: true});
    }

    return User.map(
      savedUser,
      [UserRoles.EMPLOYEE],
      savedUser.getSessionToken()
    );
  }

  /**
   * Get current authenticated user
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {
      requireUser: true,
    },
    swagger: {
      summary: 'Get current user',
      description: 'Retrieve the currently authenticated user with their roles',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Current user data with roles'},
        '401': {description: 'Not authenticated'},
      },
    },
  })
  async getCurrentUser(req: Parse.Cloud.FunctionRequest) {
    const user = req.user as User;

    // Get user roles
    const roleNames = await getUserRoles(user);

    return User.map(user, roleNames, user.getSessionToken());
  }

  /**
   * Logout user and destroy session
   */
  @CloudFunction({
    methods: ['POST'],
    swagger: {
      summary: 'Logout user',
      description: 'Invalidate the current user session and log out',
      tags: ['Authentication'],
      responses: {
        '200': {description: 'Logout successful'},
        '401': {description: 'No valid session token'},
      },
    },
  })
  async logout(req: Parse.Cloud.FunctionRequest) {
    const sessionToken = req.user?.getSessionToken();

    if (!sessionToken) {
      return;
    }

    const sessionQuery = new Parse.Query('_Session');
    sessionQuery.equalTo('sessionToken', sessionToken);

    const [error, session] = await catchError(
      sessionQuery.first({useMasterKey: true})
    );

    if (error) {
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Failed to find session');
    }

    if (session) {
      await session.destroy({useMasterKey: true});
      return {success: true, message: 'Logged out successfully'};
    }

    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Session not found');
  }

  /**
   * List users with optional search and pagination (Admin only)
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {
      requireUser: true,
      requireAnyUserRoles: ['SuperAdmin', 'Employee'],
      fields: {
        limit: {type: String},
        skip: {type: String},
        searchString: {type: String},
        withCount: {type: String},
      },
    },
    swagger: {
      summary: 'List users',
      description: 'List all users with search and pagination',
      tags: ['User Management'],
      responses: {
        '200': {description: 'List of users with roles'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not authorized'},
      },
    },
  })
  async listUsers(req: Parse.Cloud.FunctionRequest) {
    const limit = Number(req.params.limit) || 20;
    const skip = Number(req.params.skip) || 0;
    const {searchString} = req.params;
    const withCount =
      req.params.withCount === true || req.params.withCount === 'true';

    let query = new Parse.Query('_User');

    if (searchString) {
      const searchQueries = [
        new Parse.Query('_User').matches(
          'username',
          new RegExp(searchString, 'i')
        ),
        new Parse.Query('_User').matches(
          'email',
          new RegExp(searchString, 'i')
        ),
      ];
      query = Parse.Query.or(...searchQueries);
    }

    query.limit(limit);
    query.skip(skip);
    query.descending('createdAt');

    if (withCount) {
      const [error, results] = await catchError(
        query.withCount().find({useMasterKey: true})
      );
      if (error) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
      }

      // Attach roles to each user
      const users = (results as any).results || results;
      const rolesMap = await getUsersRoles(users as User[]);
      const usersWithRoles = (users as User[]).map((u: User) =>
        User.map(u, rolesMap.get(u.id!) || [])
      );

      if ((results as any).count !== undefined) {
        return {results: usersWithRoles, count: (results as any).count};
      }
      return usersWithRoles;
    }

    const [error, results] = await catchError(query.find({useMasterKey: true}));
    if (error) {
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
    }

    // Attach roles to each user
    const rolesMap = await getUsersRoles(results as User[]);
    const usersWithRoles = (results as User[]).map((u: User) =>
      User.map(u, rolesMap.get(u.id!) || [])
    );

    return usersWithRoles;
  }

  /**
   * Get a user by ID (Admin only)
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      requireAnyUserRoles: ['SuperAdmin'],
      fields: {
        id: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Get user',
      description: 'Get a user by ID with their roles (Admin only)',
      tags: ['User Management'],
      responses: {
        '200': {description: 'User data with roles'},
        '404': {description: 'User not found'},
      },
    },
  })
  async getUser(req: Parse.Cloud.FunctionRequest) {
    const {id} = req.params;

    const query = new Parse.Query('_User');
    const [error, user] = await catchError(query.get(id, {useMasterKey: true}));
    if (error || !user) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
    }

    // Get user roles
    const roleNames = await getUserRoles(user as User);

    return User.map(user as User, roleNames);
  }

  /**
   * Create a new user with role (Admin only)
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      requireAnyUserRoles: ['SuperAdmin'],
      fields: {
        username: {required: true, type: String},
        email: {required: true, type: String},
        password: {required: true, type: String},
        role: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Create user',
      description: 'Create a new user and assign a role (Admin only)',
      tags: ['User Management'],
      responses: {
        '200': {description: 'User created with assigned role'},
        '400': {description: 'Username already taken or invalid role'},
      },
    },
  })
  async createUser(req: Parse.Cloud.FunctionRequest) {
    const {username, email, password, role} = req.params;

    // Validate role
    const validRoles = Object.values(UserRoles);
    if (!validRoles.includes(role)) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        `Invalid role. Must be one of: ${validRoles.join(', ')}`
      );
    }

    const user = new User();
    user.set('username', username);
    user.set('email', email);
    user.set('password', password);

    const [error, savedUser] = await catchError(
      user.save(null, {useMasterKey: true})
    );
    if (error) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, error.message);
    }

    // Assign role
    const roleQuery = new Parse.Query('_Role');
    roleQuery.equalTo('name', role);
    const [roleError, foundRole] = await catchError(
      roleQuery.first({useMasterKey: true})
    );

    if (roleError || !foundRole) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        `Role '${role}' not found`
      );
    }

    (foundRole as Parse.Role).getUsers().add(savedUser);
    await foundRole.save(null, {useMasterKey: true});

    return User.map(savedUser, [role]);
  }

  /**
   * Update a user (Admin only)
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      requireAnyUserRoles: ['SuperAdmin'],
      fields: {
        id: {required: true, type: String},
        username: {type: String},
        email: {type: String},
        password: {type: String},
        role: {type: String},
      },
    },
    swagger: {
      summary: 'Update user',
      description: 'Update user details and/or role (Admin only)',
      tags: ['User Management'],
      responses: {
        '200': {description: 'User updated successfully'},
        '404': {description: 'User not found'},
      },
    },
  })
  async updateUser(req: Parse.Cloud.FunctionRequest) {
    const {id, username, email, password, role} = req.params;

    const query = new Parse.Query('_User');
    const [fetchError, fetchedUser] = await catchError(
      query.get(id, {useMasterKey: true})
    );
    if (fetchError || !fetchedUser) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
    }
    const user = fetchedUser as User;

    if (username) user.set('username', username);
    if (email) user.set('email', email);
    if (password) user.set('password', password);

    const [saveError] = await catchError(user.save(null, {useMasterKey: true}));
    if (saveError) {
      throw new Parse.Error(
        Parse.Error.INTERNAL_SERVER_ERROR,
        saveError.message
      );
    }

    // Update role if provided
    if (role) {
      const validRoles = Object.values(UserRoles);
      if (!validRoles.includes(role)) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `Invalid role. Must be one of: ${validRoles.join(', ')}`
        );
      }

      // Remove from all existing roles
      const existingRolesQuery = new Parse.Query('_Role');
      existingRolesQuery.equalTo('users', user);
      const existingRoles = await existingRolesQuery.find({useMasterKey: true});

      for (const existingRole of existingRoles) {
        (existingRole as Parse.Role).getUsers().remove(user as Parse.User);
        await existingRole.save(null, {useMasterKey: true});
      }

      // Assign new role
      const roleQuery = new Parse.Query('_Role');
      roleQuery.equalTo('name', role);
      const [roleError, foundRole] = await catchError(
        roleQuery.first({useMasterKey: true})
      );

      if (roleError || !foundRole) {
        throw new Parse.Error(
          Parse.Error.OBJECT_NOT_FOUND,
          `Role '${role}' not found`
        );
      }

      (foundRole as Parse.Role).getUsers().add(user as Parse.User);
      await foundRole.save(null, {useMasterKey: true});
    }

    // Return user with current roles
    const roleNames = await getUserRoles(user);

    return User.map(user, roleNames);
  }

  /**
   * Delete a user (Admin only)
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      requireAnyUserRoles: ['SuperAdmin'],
      fields: {
        id: {required: true, type: String},
      },
    },
    swagger: {
      summary: 'Delete user',
      description: 'Delete a user account (Admin only)',
      tags: ['User Management'],
      responses: {
        '200': {description: 'User deleted successfully'},
        '404': {description: 'User not found'},
      },
    },
  })
  async deleteUser(req: Parse.Cloud.FunctionRequest) {
    const {id} = req.params;

    const query = new Parse.Query('_User');
    const [fetchError, fetchedUser] = await catchError(
      query.get(id, {useMasterKey: true})
    );
    if (fetchError || !fetchedUser) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
    }
    const user = fetchedUser as User;

    // Remove from all roles first
    const existingRolesQuery = new Parse.Query('_Role');
    existingRolesQuery.equalTo('users', user);
    const existingRoles = await existingRolesQuery.find({useMasterKey: true});

    for (const existingRole of existingRoles) {
      (existingRole as Parse.Role).getUsers().remove(user as Parse.User);
      await existingRole.save(null, {useMasterKey: true});
    }

    // Destroy all sessions
    const sessionQuery = new Parse.Query('_Session');
    sessionQuery.equalTo('user', user);
    const sessions = await sessionQuery.find({useMasterKey: true});
    await Parse.Object.destroyAll(sessions, {useMasterKey: true});

    // Delete user
    const [deleteError] = await catchError(user.destroy({useMasterKey: true}));
    if (deleteError) {
      throw new Parse.Error(
        Parse.Error.INTERNAL_SERVER_ERROR,
        deleteError.message
      );
    }

    return {success: true, id};
  }

  /**
   * Search users with Employee role
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {
      requireUser: true,
      fields: {
        searchString: {type: String},
      },
    },
    swagger: {
      summary: 'Search employees',
      description: 'Search users with Employee role by name or email',
      tags: ['User Management'],
      responses: {
        '200': {description: 'List of matching employees'},
        '401': {description: 'Not authenticated'},
      },
    },
  })
  async searchEmployees(req: Parse.Cloud.FunctionRequest) {
    const {searchString} = req.params;
    const sessionToken = req.user!.getSessionToken();

    // Find Employee and Admin roles (requires masterKey for _Role access)
    const employeeRoleQuery = new Parse.Query('_Role');
    employeeRoleQuery.equalTo('name', UserRoles.EMPLOYEE);
    const adminRoleQuery = new Parse.Query('_Role');
    adminRoleQuery.equalTo('name', UserRoles.ADMIN);

    const [[, employeeRole], [, adminRole]] = await Promise.all([
      catchError(employeeRoleQuery.first({useMasterKey: true})),
      catchError(adminRoleQuery.first({useMasterKey: true})),
    ]);

    if (!employeeRole) return [];

    // Get Admin user IDs to exclude (requires masterKey for role relation)
    const adminIds: string[] = [];
    if (adminRole) {
      const adminUsers = await (adminRole as Parse.Role).getUsers()
        .query().select('objectId').limit(1000).find({useMasterKey: true});
      for (const u of adminUsers) adminIds.push(u.id!);
    }

    // Build query — final find uses sessionToken to enforce CLP
    let query = new Parse.Query('_User');
    const employeeUserIds = (await (employeeRole as Parse.Role).getUsers()
      .query().select('objectId').limit(10000).find({useMasterKey: true}))
      .filter(u => !adminIds.includes(u.id!))
      .map(u => u.id);
    query.containedIn('objectId', employeeUserIds);

    if (searchString) {
      const regex = new RegExp(searchString, 'i');
      const searchQueries = [
        new Parse.Query('_User').matches('firstName', regex),
        new Parse.Query('_User').matches('lastName', regex),
        new Parse.Query('_User').matches('email', regex),
      ];
      query = Parse.Query.or(...searchQueries);
      query.containedIn('objectId', employeeUserIds);
    }

    query.limit(20);
    query.ascending('firstName');

    const [error, results] = await catchError(query.find({sessionToken}));
    if (error) {
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
    }

    return (results as User[]).map(u => User.map(u));
  }
}
