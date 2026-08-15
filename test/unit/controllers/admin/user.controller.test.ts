import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

import { AdminUsersController } from '../../../../src/controllers/admin/user.controller.js';

function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'user-1',
    username: 'ada',
    email: 'ada@example.com',
    given_name: 'Ada',
    family_name: 'Lovelace',
    name: 'Ada Lovelace',
    gender: 'F',
    roles: ['user'],
    phone_number_verified: false,
    email_verified: true,
    blocked_from: [],
    account_is_anonymized: false,
    register_with: 'email',
    auth_provider: 'local',
    account_enabled: true,
    ...overrides,
  };
}

function createMockDeps() {
  const flash = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    userService: {
      findWithPagination: vi.fn().mockResolvedValue({
        results: [],
        page: 1,
        limit: 20,
        totalPages: 0,
        totalResults: 0,
      }),
      getUserStatistics: vi.fn().mockResolvedValue({ total: 0 }),
      getCustomIdentifierFields: vi.fn().mockReturnValue([]),
      findById: vi.fn(),
      findOne: vi.fn(),
      createUserWithGeneratedUsername: vi.fn(),
      updateWithAssignment: vi.fn(),
      updateById: vi.fn(),
      anonymize: vi.fn(),
      isCustomIdentifierAvailable: vi.fn().mockResolvedValue(true),
    },
    activityService: {
      success: vi.fn(),
      failed: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      getUserActivities: vi.fn(),
      queryActivities: vi.fn(),
      getUserActivityTypes: vi.fn(),
    },
    sessionManager: {
      flash: vi.fn().mockReturnValue(flash),
      getActiveUser: vi.fn().mockReturnValue({
        id: 'admin-1',
        username: 'admin',
        email: 'admin@example.com',
      }),
      revokeAllSessionsForUser: vi.fn(),
    },
    passwordUtils: {
      hashPassword: vi.fn(),
    },
    clientDeviceInfoManager: {
      getClientInfoFromRequest: vi.fn().mockReturnValue({
        ip: '127.0.0.1',
        user_agent: 'vitest',
      }),
    },
    configManager: {
      getConfig: vi.fn().mockReturnValue({
        deployment: { redis_prefix: 'parako' },
        security: {
          authentication: {
            roles: { available: ['user', 'admin'] },
          },
        },
      }),
    },
    oidcAdapter: {
      session: {
        deleteSessionsByAccountId: vi.fn(),
      },
    },
    pubsub: {
      isConnected: vi.fn().mockReturnValue(false),
      publish: vi.fn().mockResolvedValue(undefined),
    },
    flash,
  };
}

function createController(deps: ReturnType<typeof createMockDeps>) {
  return new (AdminUsersController as any)(
    deps.logger,
    deps.userService,
    deps.activityService,
    deps.sessionManager,
    deps.passwordUtils,
    deps.clientDeviceInfoManager,
    deps.configManager,
    deps.oidcAdapter,
    deps.pubsub
  ) as AdminUsersController;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('vitest'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('AdminUsersController', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminUsersController;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    controller = createController(deps);
  });

  describe('list()', () => {
    it.each([
      [{ nested: true }, { nested: true }],
      [[], []],
      [42, 84],
    ])(
      'ignores non-string role and status filters %#',
      async (role, status) => {
        const res = makeRes();

        await expect(
          controller.list(makeReq({ query: { role, status } as any }), res)
        ).resolves.toBeUndefined();

        expect(deps.userService.findWithPagination).toHaveBeenCalledWith(
          {},
          expect.any(Object)
        );
        expect(res.render).toHaveBeenCalledWith(
          'admin/users/index',
          expect.objectContaining({
            filters: expect.objectContaining({ role: 'all', status: 'all' }),
          })
        );
      }
    );

    it('builds adapter-neutral search, role, status, sort, and pagination data', async () => {
      const users = [createMockUser()];
      deps.userService.findWithPagination.mockResolvedValue({
        results: users,
        page: 2,
        limit: 5,
        totalPages: 3,
        totalResults: 11,
      });
      deps.userService.getUserStatistics.mockResolvedValue({ total: 11 });
      const res = makeRes();

      await controller.list(
        makeReq({
          query: {
            page: '2',
            limit: '5',
            search: ' Ada.* ',
            role: 'admin',
            status: 'active',
            sortBy: 'email',
            sortOrder: 'asc',
          },
        }),
        res
      );

      const [filter, options] = deps.userService.findWithPagination.mock
        .calls[0] as [Record<string, any>, Record<string, any>];
      expect(filter.search).toBe('Ada.*');
      expect(filter.roles).toEqual({ $in: ['admin'] });
      expect(filter.account_enabled).toBe(true);
      expect(filter.account_is_anonymized).toBe(false);
      expect(filter).not.toHaveProperty('$or');
      expect(options).toEqual({ page: 2, limit: 5, sort: { email: 1 } });
      expect(res.render).toHaveBeenCalledWith(
        'admin/users/index',
        expect.objectContaining({
          users,
          pagination: {
            page: 2,
            limit: 5,
            totalPages: 3,
            totalResults: 11,
            hasNextPage: true,
            hasPrevPage: true,
            nextPage: 3,
            prevPage: 1,
          },
          filters: {
            search: 'Ada.*',
            role: 'admin',
            status: 'active',
            sortBy: 'email',
            sortOrder: 'asc',
          },
          roles: ['all', 'user', 'admin'],
          stats: { total: 11 },
          customIdentifierFields: [],
        })
      );
    });

    it.each([
      ['disabled', { account_enabled: false }],
      ['anonymized', { account_is_anonymized: true }],
      ['all', {}],
      ['unsupported', {}],
    ])(
      'maps the %s status to the expected repository filter',
      async (status, expected) => {
        await controller.list(makeReq({ query: { status } }), makeRes());

        expect(deps.userService.findWithPagination).toHaveBeenCalledWith(
          expected,
          expect.objectContaining({ sort: { created_at: -1 } })
        );
      }
    );
  });

  describe('show()', () => {
    it('redirects with an error when the user id is missing', async () => {
      const res = makeRes();

      await controller.show(makeReq(), res);

      expect(deps.flash.error).toHaveBeenCalledWith('User ID is required');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users');
      expect(deps.userService.findById).not.toHaveBeenCalled();
    });

    it('redirects with an error when the user does not exist', async () => {
      deps.userService.findById.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'missing' } }), res);

      expect(deps.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users');
    });

    it('renders the user, recent activities, and custom identifier fields', async () => {
      const user = createMockUser();
      const activity = { type: 'login', timestamp: new Date() };
      const fields = [{ slot: 1, name: 'Member ID' }];
      deps.userService.findById.mockResolvedValue(user);
      deps.activityService.getUserActivities.mockResolvedValue({
        results: [activity],
        page: 1,
        limit: 5,
        totalPages: 1,
        totalResults: 1,
      });
      deps.userService.getCustomIdentifierFields.mockReturnValue(fields);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.activityService.getUserActivities).toHaveBeenCalledWith(
        'user-1',
        { limit: 5, page: 1 }
      );
      expect(res.render).toHaveBeenCalledWith('admin/users/show', {
        title: 'User details',
        user,
        activities: [activity],
        currentUserId: 'admin-1',
        customIdentifierFields: fields,
      });
    });
  });

  it('renders the create form with configured roles and identifier fields', async () => {
    const fields = [{ slot: 1, name: 'Member ID' }];
    deps.userService.getCustomIdentifierFields.mockReturnValue(fields);
    const res = makeRes();

    await controller.create(makeReq(), res);

    expect(res.render).toHaveBeenCalledWith('admin/users/create', {
      title: 'Create New User',
      roles: ['user', 'admin'],
      customIdentifierFields: fields,
    });
  });

  describe('store()', () => {
    it('rejects a duplicate email before hashing or creating a user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
          },
        }),
        res
      );

      expect(deps.userService.findOne).toHaveBeenCalledWith({
        email: 'ada@example.com',
      });
      expect(deps.flash.error).toHaveBeenCalledWith('Email already exists');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/new');
      expect(deps.passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });

    it('persists the admin-selected password reset requirement when creating a user', async () => {
      const createdUser = createMockUser({ _id: 'created-1' });
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createdUser
      );
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: [' user ', ' admin '],
            account_enabled: 'true',
            password_force_reset: 'true',
          },
        }),
        res
      );

      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'hashed-password',
          password_hash_algo: 'argon2id',
          roles: ['user', 'admin'],
          account_enabled: true,
          password_force_reset: true,
          email_verified: true,
          auth_provider: 'local',
        })
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'user_created_by_admin',
        'Admin created new user',
        createdUser,
        expect.objectContaining({
          actor: expect.objectContaining({
            username: 'admin',
            actor_type: 'admin',
          }),
          target: expect.objectContaining({
            target_type: 'user',
            username: 'ada',
          }),
        })
      );
      expect(deps.flash.success).toHaveBeenCalledWith(
        'User ada created successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/created-1');
    });

    it('creates an enabled account when account status is omitted', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser()
      );

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
          },
        }),
        makeRes()
      );

      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({ account_enabled: true })
      );
    });

    it('keeps only configured string roles and removes duplicates', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser({ roles: ['admin'] })
      );

      await expect(
        controller.store(
          makeReq({
            body: {
              email: 'ada@example.com',
              password: 'correct horse battery staple',
              given_name: 'Ada',
              family_name: 'Lovelace',
              roles: [' admin ', { nested: true }, 'owner', '', 'admin'],
            },
          }),
          makeRes()
        )
      ).resolves.toBeUndefined();

      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(expect.objectContaining({ roles: ['admin'] }));
    });

    it('uses an empty role set when no submitted or default role is configured', async () => {
      deps.configManager.getConfig.mockReturnValue({
        security: {
          authentication: { roles: { available: ['admin'] } },
        },
      });
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser({ roles: [] })
      );

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
          },
        }),
        makeRes()
      );

      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(expect.objectContaining({ roles: [] }));
    });

    it('falls back to user and skips omitted or blank custom identifiers', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          validation_type: 'none',
          case_sensitive: true,
        },
        {
          slot: 2,
          name: 'Badge',
          validation_type: 'none',
          case_sensitive: true,
        },
      ]);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser()
      );

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: { nested: true },
            custom_identifier_2: '   ',
          },
        }),
        makeRes()
      );

      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(expect.objectContaining({ roles: ['user'] }));
      const payload = deps.userService.createUserWithGeneratedUsername.mock
        .calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('custom_identifier_1');
      expect(payload).not.toHaveProperty('custom_identifier_2');
    });

    it('rejects an invalid birthdate before creating a user', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            birthdate: 'not-a-date',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid birthdate');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/new');
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });

    it('normalizes optional profile and custom identifier fields', async () => {
      const identifierField = {
        slot: 1,
        key: 'member_id',
        name: 'Member ID',
        hint_for_user: '',
        validation_type: 'regex',
        pattern: 'mem-[0-9]+',
        min_length: 5,
        max_length: 20,
        case_sensitive: false,
        required_for_registration: false,
        edit_policy: 'editable',
        usable_for_login: true,
      };
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        identifierField,
      ]);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser()
      );

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            middle_name: '  Byron  ',
            nickname: '   ',
            phone_number: 123,
            gender: 'F',
            birthdate: '1815-12-10',
            custom_identifier_1: '  mem-42  ',
          },
        }),
        makeRes()
      );

      expect(deps.userService.isCustomIdentifierAvailable).toHaveBeenCalledWith(
        1,
        'mem-42',
        undefined
      );
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          middle_name: 'Byron',
          gender: 'F',
          birthdate: new Date('1815-12-10'),
          custom_identifier_1: 'mem-42',
        })
      );
      const payload = deps.userService.createUserWithGeneratedUsername.mock
        .calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('nickname');
      expect(payload).not.toHaveProperty('phone_number');
    });

    it('validates a case-insensitive custom identifier before normalizing it', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Employee ID',
          validation_type: 'regex',
          pattern: '^EMP-[0-9]{4}$',
          min_length: 8,
          max_length: 8,
          case_sensitive: false,
        },
      ]);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      deps.userService.createUserWithGeneratedUsername.mockResolvedValue(
        createMockUser()
      );
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: 'EMP-0042',
          },
        }),
        res
      );

      expect(deps.userService.isCustomIdentifierAvailable).toHaveBeenCalledWith(
        1,
        'emp-0042',
        undefined
      );
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({ custom_identifier_1: 'emp-0042' })
      );
      expect(deps.flash.error).not.toHaveBeenCalled();
    });

    it('rejects an invalid custom identifier', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          validation_type: 'regex',
          pattern: 'MEM-[0-9]+',
          min_length: 5,
          max_length: 20,
          case_sensitive: true,
        },
      ]);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: 'invalid',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid Member ID format');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/new');
      expect(
        deps.userService.isCustomIdentifierAvailable
      ).not.toHaveBeenCalled();
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });

    it('uses the generic label for an unnamed invalid custom identifier', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: '',
          validation_type: 'none',
          min_length: 5,
          case_sensitive: true,
        },
      ]);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: 'x',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith(
        'Invalid identifier format'
      );
    });

    it('rejects a custom identifier already assigned to another user', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: '',
          validation_type: 'none',
          case_sensitive: true,
        },
      ]);
      deps.userService.isCustomIdentifierAvailable.mockResolvedValue(false);
      deps.passwordUtils.hashPassword.mockResolvedValue('hashed-password');
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: 'MEM-42',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith(
        'This identifier is already in use by another user'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/new');
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });

    it('rejects a structured birthdate value', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.store(
        makeReq({
          body: {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
            given_name: 'Ada',
            family_name: 'Lovelace',
            birthdate: { nested: true },
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid birthdate');
      expect(
        deps.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });
  });

  describe('edit()', () => {
    it('redirects when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.edit(makeReq({ params: { id: 'missing' } }), res);

      expect(deps.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users');
    });

    it('renders the user with configured roles and identifier fields', async () => {
      const user = createMockUser();
      const fields = [{ slot: 1, name: 'Member ID' }];
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.getCustomIdentifierFields.mockReturnValue(fields);
      const res = makeRes();

      await controller.edit(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.render).toHaveBeenCalledWith('admin/users/edit', {
        title: 'Edit User',
        user,
        roles: ['user', 'admin'],
        customIdentifierFields: fields,
      });
    });
  });

  describe('update()', () => {
    it('redirects when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.update(
        makeReq({ params: { id: 'missing' }, body: {} }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('rejects deactivating the current administrator through the edit form', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'ada',
        email: 'ada@example.com',
      });
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ roles: ['admin'] })
      );
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: 'admin',
            account_enabled: 'false',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith(
        'You cannot disable your own account'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('rejects removing the current administrator role through the edit form', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'ada',
        email: 'ada@example.com',
      });
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ roles: ['admin'] })
      );
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: 'user',
            account_enabled: 'true',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith(
        'You cannot remove your own administrator role'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('allows the current administrator to preserve an enabled admin account', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'ada',
        email: 'ada@example.com',
      });
      const user = createMockUser({ roles: ['admin'] });
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.updateWithAssignment.mockResolvedValue(user);
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: 'admin',
            account_enabled: 'true',
          },
        }),
        res
      );

      expect(deps.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ roles: ['admin'], account_enabled: true })
      );
      expect(deps.flash.error).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1');
    });

    it('keeps only configured string roles when updating a user', async () => {
      const user = createMockUser();
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.updateWithAssignment.mockResolvedValue(user);
      const res = makeRes();

      await expect(
        controller.update(
          makeReq({
            params: { id: 'user-1' },
            body: {
              email: 'ada@example.com',
              given_name: 'Ada',
              family_name: 'Lovelace',
              roles: [' admin ', { nested: true }, 'owner', 'admin'],
              account_enabled: 'true',
            },
          }),
          res
        )
      ).resolves.toBeUndefined();

      expect(deps.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ roles: ['admin'] })
      );
      expect(deps.flash.success).toHaveBeenCalledWith(
        'User updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1');
    });

    it('rejects a structured new password without updating the user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      const res = makeRes();

      await expect(
        controller.update(
          makeReq({
            params: { id: 'user-1' },
            body: {
              email: 'ada@example.com',
              given_name: 'Ada',
              family_name: 'Lovelace',
              new_password: { nested: true },
            },
          }),
          res
        )
      ).resolves.toBeUndefined();

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid password value');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('rejects an invalid birthdate without updating the user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            birthdate: 'not-a-date',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid birthdate');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('rejects a structured birthdate without updating the user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            birthdate: { nested: true },
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid birthdate');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it('updates profile fields, clears empty values, and hashes a new password', async () => {
      const user = createMockUser();
      const updatedUser = createMockUser({
        middle_name: 'Byron',
        birthdate: new Date('1815-12-10'),
      });
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.updateWithAssignment.mockResolvedValue(updatedUser);
      deps.passwordUtils.hashPassword.mockResolvedValue('new-password-hash');
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            roles: 'admin',
            account_enabled: 'true',
            middle_name: '  Byron ',
            nickname: '   ',
            phone_number: 123,
            gender: 'F',
            birthdate: '1815-12-10',
            new_password: '  replacement-password  ',
            password_force_reset: 'true',
          },
        }),
        res
      );

      expect(deps.passwordUtils.hashPassword).toHaveBeenCalledWith(
        '  replacement-password  '
      );
      expect(deps.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          roles: ['admin'],
          account_enabled: true,
          middle_name: 'Byron',
          nickname: undefined,
          phone_number: undefined,
          gender: 'F',
          birthdate: new Date('1815-12-10'),
          password: 'new-password-hash',
          password_hash_algo: 'argon2id',
          password_force_reset: false,
        })
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'user_updated_by_admin',
        'Admin updated user',
        updatedUser,
        expect.objectContaining({
          target: expect.objectContaining({
            user_id: 'user-1',
            username: 'ada',
          }),
        })
      );
      expect(deps.flash.success).toHaveBeenCalledWith(
        'User updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1');
    });

    it('publishes a force-reset invalidation with the configured prefix', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateWithAssignment.mockResolvedValue(
        createMockUser({ password_force_reset: true })
      );
      deps.pubsub.isConnected.mockReturnValue(true);

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            password_force_reset: 'true',
          },
        }),
        makeRes()
      );

      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:user:invalidated',
        expect.objectContaining({
          originId: expect.any(String),
          username: 'ada',
          action: 'force_password_reset',
        })
      );
    });

    it.each([
      [new Error('redis unavailable'), 'redis unavailable'],
      ['redis unavailable', 'redis unavailable'],
    ])(
      'logs pubsub invalidation rejection without failing the update %#',
      async (failure, message) => {
        deps.configManager.getConfig.mockReturnValue({
          security: {
            authentication: { roles: { available: ['user', 'admin'] } },
          },
        });
        deps.userService.findOne.mockResolvedValue(createMockUser());
        deps.userService.updateWithAssignment.mockResolvedValue(
          createMockUser({ password_force_reset: true })
        );
        deps.pubsub.isConnected.mockReturnValue(true);
        deps.pubsub.publish.mockRejectedValue(failure);
        const res = makeRes();

        await controller.update(
          makeReq({
            params: { id: 'user-1' },
            body: {
              email: 'ada@example.com',
              given_name: 'Ada',
              family_name: 'Lovelace',
              password_force_reset: 'true',
            },
          }),
          res
        );

        await vi.waitFor(() => {
          expect(deps.logger.warn).toHaveBeenCalledWith(
            'Pubsub broadcast of user invalidation failed',
            {
              step: 'admin-user-force-password-reset-broadcast',
              username: 'ada',
              err: message,
            }
          );
        });
        expect(deps.pubsub.publish).toHaveBeenCalledWith(
          'parako:user:invalidated',
          expect.any(Object)
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1');
      }
    );

    it('clears empty custom identifiers and excludes the edited user from uniqueness checks', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          validation_type: 'none',
          case_sensitive: false,
        },
        {
          slot: 2,
          name: 'Badge',
          validation_type: 'none',
          case_sensitive: true,
        },
      ]);
      deps.userService.updateWithAssignment.mockResolvedValue(createMockUser());

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: '   ',
            custom_identifier_2: '  Badge-7  ',
          },
        }),
        makeRes()
      );

      expect(deps.userService.isCustomIdentifierAvailable).toHaveBeenCalledWith(
        2,
        'Badge-7',
        'user-1'
      );
      expect(deps.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          custom_identifier_1: undefined,
          custom_identifier_2: 'Badge-7',
        })
      );
    });

    it('redirects with a custom identifier validation error', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          validation_type: 'none',
          min_length: 5,
          case_sensitive: true,
        },
      ]);
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            custom_identifier_1: 'x',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid Member ID format');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.userService.updateWithAssignment).not.toHaveBeenCalled();
    });

    it.each([
      [new Error('database unavailable'), 'database unavailable'],
      ['database unavailable', 'Unknown error'],
    ])(
      'reports assignment failures without exposing an untyped exception %#',
      async (failure, message) => {
        deps.userService.findOne.mockResolvedValue(createMockUser());
        deps.userService.updateWithAssignment.mockRejectedValue(failure);
        const res = makeRes();

        await controller.update(
          makeReq({
            params: { id: 'user-1' },
            body: {
              email: 'ada@example.com',
              given_name: 'Ada',
              family_name: 'Lovelace',
            },
          }),
          res
        );

        expect(deps.logger.error).toHaveBeenCalledWith(failure, {
          context: 'user_update_failed',
          userId: 'user-1',
        });
        expect(deps.flash.error).toHaveBeenCalledWith(
          `Failed to update user: ${message}`
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      }
    );

    it('reports a null assignment result', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateWithAssignment.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
          },
        }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Failed to update user');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users/user-1/edit');
      expect(deps.activityService.success).not.toHaveBeenCalled();
    });

    it('clears gender and birthdate when the form sends empty values', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateWithAssignment.mockResolvedValue(
        createMockUser({ gender: undefined, birthdate: undefined })
      );

      await controller.update(
        makeReq({
          params: { id: 'user-1' },
          body: {
            email: 'ada@example.com',
            given_name: 'Ada',
            family_name: 'Lovelace',
            gender: '',
            birthdate: '',
          },
        }),
        makeRes()
      );

      expect(deps.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ gender: undefined, birthdate: undefined })
      );
    });
  });

  describe('enable()', () => {
    it('returns 404 when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.enable(makeReq({ params: { id: 'missing' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User not found',
      });
      expect(deps.userService.updateById).not.toHaveBeenCalled();
    });

    it('reports an already-enabled account without writing', async () => {
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ account_enabled: true })
      );
      const res = makeRes();

      await controller.enable(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User is already enabled',
      });
      expect(deps.userService.updateById).not.toHaveBeenCalled();
    });

    it('returns 500 when enabling does not return a user', async () => {
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ account_enabled: false })
      );
      deps.userService.updateById.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.enable(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.userService.updateById).toHaveBeenCalledWith('user-1', {
        account_enabled: true,
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to enable user',
      });
    });

    it('enables and audits the user', async () => {
      const disabledUser = createMockUser({ account_enabled: false });
      const enabledUser = createMockUser({
        _id: undefined,
        id: 'user-1',
        account_enabled: true,
      });
      deps.userService.findOne.mockResolvedValue(disabledUser);
      deps.userService.updateById.mockResolvedValue(enabledUser);
      const res = makeRes();

      await controller.enable(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.activityService.success).toHaveBeenCalledWith(
        'user_enabled_by_admin',
        'Admin enabled user',
        enabledUser,
        expect.objectContaining({
          target: expect.objectContaining({
            user_id: 'user-1',
            username: 'ada',
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'User enabled successfully',
      });
    });

    it('logs and returns 500 when enabling throws', async () => {
      const failure = new Error('database unavailable');
      deps.userService.findOne.mockRejectedValue(failure);
      const res = makeRes();

      await controller.enable(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'user_enable_failed',
        userId: 'user-1',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to enable user',
      });
    });
  });

  describe('disable()', () => {
    it('returns 404 when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'missing' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User not found',
      });
    });

    it('rejects disabling the current administrator', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'ada',
        email: 'ada@example.com',
      });
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ roles: ['admin'] })
      );
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'You cannot disable your own account',
      });
      expect(deps.userService.updateById).not.toHaveBeenCalled();
    });

    it('reports an already-disabled account without writing', async () => {
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ account_enabled: false })
      );
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User is already disabled',
      });
      expect(deps.userService.updateById).not.toHaveBeenCalled();
    });

    it('returns 500 when disabling does not return a user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateById.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to disable user',
      });
      expect(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).not.toHaveBeenCalled();
    });

    it('disables, revokes all sessions, invalidates caches, and audits', async () => {
      const user = createMockUser();
      const disabledUser = createMockUser({ account_enabled: false });
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.updateById.mockResolvedValue(disabledUser);
      deps.oidcAdapter.session.deleteSessionsByAccountId.mockResolvedValue({
        deletedCount: 2,
      });
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(3);
      deps.pubsub.isConnected.mockReturnValue(true);
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).toHaveBeenCalledWith('ada');
      expect(deps.sessionManager.revokeAllSessionsForUser).toHaveBeenCalledWith(
        'ada'
      );
      expect(deps.logger.info).toHaveBeenCalledWith(
        'Revoked all sessions for disabled user',
        { username: 'ada', revokedSessionsCount: 5 }
      );
      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:user:invalidated',
        expect.objectContaining({ username: 'ada', action: 'disabled' })
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'user_disabled_by_admin',
        'Admin disabled user',
        disabledUser,
        expect.objectContaining({
          target: expect.objectContaining({ username: 'ada' }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'User disabled successfully',
      });
    });

    it('does not log a revocation summary when no sessions exist', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateById.mockResolvedValue(
        createMockUser({ account_enabled: false })
      );
      deps.oidcAdapter.session.deleteSessionsByAccountId.mockResolvedValue({
        deletedCount: 0,
      });
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(0);

      await controller.disable(
        makeReq({ params: { id: 'user-1' } }),
        makeRes()
      );

      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'Revoked all sessions for disabled user',
        expect.anything()
      );
    });

    it('logs session-revocation failure but still disables the user', async () => {
      const failure = new Error('session store unavailable');
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.updateById.mockResolvedValue(
        createMockUser({ account_enabled: false })
      );
      deps.oidcAdapter.session.deleteSessionsByAccountId.mockRejectedValue(
        failure
      );
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'session_revocation_for_disabled_user_failed',
        username: 'ada',
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'User disabled successfully',
      });
    });

    it('logs and returns 500 when disabling throws', async () => {
      const failure = new Error('database unavailable');
      deps.userService.findOne.mockRejectedValue(failure);
      const res = makeRes();

      await controller.disable(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'user_disable_failed',
        userId: 'user-1',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to disable user',
      });
    });
  });

  describe('destroy()', () => {
    it('rejects anonymizing the current administrator', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'ada',
        email: 'ada@example.com',
      });
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ roles: ['admin'] })
      );
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'You cannot anonymize your own account',
      });
      expect(deps.userService.anonymize).not.toHaveBeenCalled();
    });

    it('delegates to the lifecycle anonymizer instead of retaining user PII', async () => {
      const user = createMockUser();
      const anonymizedUser = createMockUser({
        username: 'deleted-a1b2c3d4e5f6',
        email: 'anon-a1b2c3d4e5f6@deleted.invalid',
        given_name: undefined,
        family_name: undefined,
        account_is_anonymized: true,
        account_enabled: false,
      });
      deps.userService.findOne.mockResolvedValue(user);
      deps.userService.anonymize.mockResolvedValue(anonymizedUser);
      deps.pubsub.isConnected.mockReturnValue(true);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.userService.anonymize).toHaveBeenCalledWith('user-1');
      expect(deps.userService.updateById).not.toHaveBeenCalled();
      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:user:invalidated',
        expect.objectContaining({ username: 'ada', action: 'deleted' })
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'user_anonymized_by_admin',
        'Admin anonymized user',
        anonymizedUser,
        expect.objectContaining({
          target: expect.objectContaining({
            user_id: 'user-1',
            username: 'ada',
            email: 'ada@example.com',
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'User anonymized successfully',
      });
    });

    it('returns 404 when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'missing' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User not found',
      });
      expect(deps.userService.anonymize).not.toHaveBeenCalled();
    });

    it('reports an already-anonymized account without writing', async () => {
      deps.userService.findOne.mockResolvedValue(
        createMockUser({ account_is_anonymized: true })
      );
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User is already anonymized',
      });
      expect(deps.userService.anonymize).not.toHaveBeenCalled();
    });

    it('returns 500 when anonymization does not return a user', async () => {
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.anonymize.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'user-1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to anonymize user',
      });
    });

    it('logs and returns 500 when anonymization throws', async () => {
      const failure = new Error('database unavailable');
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.userService.anonymize.mockRejectedValue(failure);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'user-1' } }), res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'user_anonymize_failed',
        userId: 'user-1',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to anonymize user',
      });
    });
  });

  describe('activities()', () => {
    it('redirects when the user does not exist', async () => {
      deps.userService.findOne.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.activities(
        makeReq({ params: { id: 'missing' }, query: {} }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/users');
      expect(deps.activityService.queryActivities).not.toHaveBeenCalled();
    });

    it('renders filtered activities with normalized nested device data and dates', async () => {
      const user = createMockUser();
      const activityWithDevice = {
        type: 'login',
        timestamp: '2026-08-02T10:00:00.000Z',
        device_infos: { browser: { name: 'Firefox' } },
      };
      const activityWithoutDevice = {
        type: 'logout',
        timestamp: new Date('2026-08-02T11:00:00.000Z'),
      };
      deps.userService.findOne.mockResolvedValue(user);
      deps.activityService.queryActivities.mockResolvedValue({
        results: [activityWithDevice, activityWithoutDevice],
        page: 2,
        limit: 25,
        totalPages: 4,
        totalResults: 76,
      });
      deps.activityService.getUserActivityTypes.mockResolvedValue([
        'login',
        'logout',
      ]);
      const res = makeRes();

      await controller.activities(
        makeReq({
          params: { id: 'user-1' },
          query: { page: '2', limit: '25', type: 'login' },
        }),
        res
      );

      expect(deps.activityService.queryActivities).toHaveBeenCalledWith(
        { related_user_id: 'user-1', type: 'login' },
        { page: 2, limit: 25, sort: { timestamp: -1 } }
      );
      expect(deps.activityService.getUserActivityTypes).toHaveBeenCalledWith(
        'user-1'
      );
      expect(activityWithDevice.timestamp).toEqual(
        new Date('2026-08-02T10:00:00.000Z')
      );
      expect(activityWithDevice.device_infos).toEqual({
        browser: { name: 'Firefox' },
        os: {},
        device: {},
        screen: {},
        geo_location: {},
      });
      expect(res.render).toHaveBeenCalledWith(
        'admin/users/activities',
        expect.objectContaining({
          title: 'Ada Lovelace - Activities',
          user,
          activities: [activityWithDevice, activityWithoutDevice],
          pagination: {
            page: 2,
            limit: 25,
            totalPages: 4,
            totalResults: 76,
            hasNextPage: true,
            hasPrevPage: true,
            nextPage: 3,
            prevPage: 1,
          },
          filters: { type: 'login' },
          activityTypes: ['all', 'login', 'logout'],
        })
      );
    });

    it('uses bounded defaults and the username title fallback', async () => {
      const user = createMockUser({ name: undefined });
      deps.userService.findOne.mockResolvedValue(user);
      deps.activityService.queryActivities.mockResolvedValue({
        results: [],
        page: 1,
        limit: 50,
        totalPages: 0,
        totalResults: 0,
      });
      deps.activityService.getUserActivityTypes.mockResolvedValue([]);
      const res = makeRes();

      await controller.activities(
        makeReq({
          params: { id: 'user-1' },
          query: { page: '-10', limit: '1000', type: 'all' },
        }),
        res
      );

      expect(deps.activityService.queryActivities).toHaveBeenCalledWith(
        { related_user_id: 'user-1' },
        { page: 1, limit: 100, sort: { timestamp: -1 } }
      );
      expect(res.render).toHaveBeenCalledWith(
        'admin/users/activities',
        expect.objectContaining({
          title: 'ada - Activities',
          filters: { type: 'all' },
        })
      );
    });

    it('defaults an omitted activity type and empty device object', async () => {
      const activity = {
        type: 'login',
        timestamp: undefined,
        device_infos: {},
      };
      deps.userService.findOne.mockResolvedValue(createMockUser());
      deps.activityService.queryActivities.mockResolvedValue({
        results: [activity],
        page: 1,
        limit: 50,
        totalPages: 1,
        totalResults: 1,
      });
      deps.activityService.getUserActivityTypes.mockResolvedValue(['login']);
      const res = makeRes();

      await controller.activities(
        makeReq({ params: { id: 'user-1' }, query: {} }),
        res
      );

      expect(activity.device_infos).toEqual({
        browser: {},
        os: {},
        device: {},
        screen: {},
        geo_location: {},
      });
      expect(res.render).toHaveBeenCalledWith(
        'admin/users/activities',
        expect.objectContaining({ filters: { type: 'all' } })
      );
    });
  });
});
