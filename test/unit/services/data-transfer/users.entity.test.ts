import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../../../../src/di/interfaces/oidc-adapter-bridge.interface.js';
import type { IPasswordUtils } from '../../../../src/di/interfaces/password-utils.interface.js';
import type { IUserService } from '../../../../src/di/interfaces/user-service.interface.js';
import { DataTransferService } from '../../../../src/services/data-transfer/data-transfer.service.js';
import { createUserEntityConfig } from '../../../../src/services/data-transfer/entities/users.entity.js';
import type { EntityConfigDeps } from '../../../../src/services/data-transfer/entities/types.js';
import type { ImportContext } from '../../../../src/services/data-transfer/types.js';

function createLogger(): ILogger {
  return {
    info: vi.fn(),
  } as unknown as ILogger;
}

describe('user data-transfer entity', () => {
  let logger: ILogger;
  let activityService: IActivityService;
  let userService: IUserService;
  let passwordUtils: IPasswordUtils;
  let deps: EntityConfigDeps;
  let transferService: DataTransferService;
  let context: ImportContext;

  beforeEach(() => {
    logger = createLogger();
    activityService = {
      success: vi.fn(),
      failed: vi.fn(),
    } as unknown as IActivityService;
    userService = {
      findByEmail: vi.fn(async () => null),
      createUserWithGeneratedUsername: vi.fn(async () => undefined),
      findMany: vi.fn(async () => []),
    } as unknown as IUserService;
    passwordUtils = {
      hashPassword: vi.fn(async () => 'hashed-password'),
    } as unknown as IPasswordUtils;
    deps = {
      logger,
      activityService,
      userService,
      passwordUtils,
      oidcAdapterBridge: {} as IOIDCAdapterBridge,
    };
    transferService = new DataTransferService(logger, activityService);
    context = {
      logger,
      adminUser: { username: 'admin' },
      tenantId: 'tenant-a',
    };
  });

  it('publishes the supported CSV import and export contract', () => {
    const config = createUserEntityConfig(deps);

    expect(config).toMatchObject({
      entityId: 'users',
      displayName: 'Users',
      importConfig: {
        format: 'csv',
        requiredFields: ['email', 'given_name', 'family_name'],
        maxRows: 5000,
      },
      exportConfig: {
        format: 'csv',
        filenamePrefix: 'users-export',
      },
    });
    expect(
      config.importConfig!.columns.find(column => column.field === 'email')
    ).toMatchObject({
      required: true,
      aliases: ['email_address', 'e-mail'],
    });
    expect(
      config.exportConfig!.columns.find(column => column.field === 'password')
    ).toMatchObject({ group: 'internal' });
  });

  it('rejects names that become empty after normalization', async () => {
    const config = createUserEntityConfig(deps);

    const result = await transferService.validateImport(
      [
        {
          email: 'user@example.test',
          given_name: '   ',
          family_name: 'User',
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.given_name).toBeDefined();
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });

  it('validates normalized email and gender values', async () => {
    const config = createUserEntityConfig(deps);

    const result = await transferService.validateImport(
      [
        {
          email: '  USER@Example.Test ',
          given_name: 'Maria',
          family_name: 'User',
          gender: ' f ',
          birthdate: '2000-01-02',
        },
      ],
      config,
      context
    );

    expect(result).toMatchObject({ valid: true, validCount: 1, errors: [] });
    expect(userService.findByEmail).toHaveBeenCalledWith('user@example.test');
  });

  it('reports an invalid birthdate instead of silently dropping it', async () => {
    const config = createUserEntityConfig(deps);

    const result = await transferService.validateImport(
      [
        {
          email: 'user@example.test',
          given_name: 'Maria',
          family_name: 'User',
          birthdate: 'not-a-date',
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.birthdate).toBe('Invalid birthdate');
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-02-30', 'Invalid birthdate'],
    ['2026-99-99', 'Invalid birthdate'],
    ['2000', 'Invalid birthdate'],
    ['9999-01-01', 'Birthdate cannot be in the future'],
  ])('rejects unsafe birthdate %s', async (birthdate, expectedMessage) => {
    const config = createUserEntityConfig(deps);

    const result = await transferService.validateImport(
      [
        {
          email: 'user@example.test',
          given_name: 'Maria',
          family_name: 'User',
          birthdate,
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.birthdate).toContain(expectedMessage);
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects non-string gender values', async () => {
    const config = createUserEntityConfig(deps);

    const result = await transferService.validateImport(
      [
        {
          email: 'user@example.test',
          given_name: 'Maria',
          family_name: 'User',
          gender: 1,
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.gender).toBeDefined();
  });

  it('detects duplicates using a normalized email', async () => {
    const config = createUserEntityConfig(deps);
    const checkDuplicate = config.importConfig!.checkDuplicate;
    vi.mocked(userService.findByEmail)
      .mockResolvedValueOnce({ id: 'existing' } as never)
      .mockResolvedValueOnce(undefined);

    await expect(checkDuplicate({}, context)).resolves.toBe(
      'Email is required'
    );
    await expect(
      checkDuplicate({ email: ' EXISTING@Example.Test ' }, context)
    ).resolves.toBe('Email already exists');
    await expect(
      checkDuplicate({ email: 'new@example.test' }, context)
    ).resolves.toBeNull();

    expect(userService.findByEmail).toHaveBeenNthCalledWith(
      1,
      'existing@example.test'
    );
    expect(userService.findByEmail).toHaveBeenNthCalledWith(
      2,
      'new@example.test'
    );
  });

  it('prepares a normalized local user with fresh hashed credentials', async () => {
    const config = createUserEntityConfig(deps);

    const prepared = await config.importConfig!.prepareRow(
      {
        email: ' USER@Example.Test ',
        given_name: ' Maria ',
        family_name: ' User ',
        middle_name: ' Anne ',
        nickname: ' M ',
        phone_number: ' +22900000000 ',
        profile: ' https://example.test/profile ',
        website: ' https://example.test ',
        picture: ' https://example.test/avatar.png ',
        country: ' Benin ',
        region: ' Littoral ',
        city: ' Cotonou ',
        postal_code: ' 01BP ',
        street_address: ' 1 Demo Street ',
        locale: ' fr-BJ ',
        zoneinfo: ' Africa/Porto-Novo ',
        gender: 'f',
        birthdate: '2000-01-02',
      },
      context
    );

    expect(prepared).toEqual({
      email: 'user@example.test',
      given_name: 'Maria',
      family_name: 'User',
      account_enabled: true,
      email_verified: true,
      auth_provider: 'local',
      password: 'hashed-password',
      password_hash_algo: 'argon2id',
      password_updated_at: expect.any(Date),
      middle_name: 'Anne',
      nickname: 'M',
      phone_number: '+22900000000',
      profile: 'https://example.test/profile',
      website: 'https://example.test',
      picture: 'https://example.test/avatar.png',
      country: 'Benin',
      region: 'Littoral',
      city: 'Cotonou',
      postal_code: '01BP',
      street_address: '1 Demo Street',
      locale: 'fr-BJ',
      zoneinfo: 'Africa/Porto-Novo',
      gender: 'F',
      birthdate: new Date('2000-01-02'),
    });
    expect(passwordUtils.hashPassword).toHaveBeenCalledWith(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    );
  });

  it('rejects missing normalized identity fields before hashing', async () => {
    const config = createUserEntityConfig(deps);

    await expect(
      config.importConfig!.prepareRow(
        { email: null, given_name: '   ', family_name: undefined },
        context
      )
    ).rejects.toThrow(
      'Email, first name, and last name are required for user import'
    );
    expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
  });

  it('rejects a missing first name even when the email is present', async () => {
    const config = createUserEntityConfig(deps);

    await expect(
      config.importConfig!.prepareRow(
        {
          email: 'user@example.test',
          given_name: undefined,
          family_name: 'User',
        },
        context
      )
    ).rejects.toThrow(
      'Email, first name, and last name are required for user import'
    );
    expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
  });

  it('prepares a minimal valid user without optional demographics', async () => {
    const config = createUserEntityConfig(deps);

    const prepared = await config.importConfig!.prepareRow(
      {
        email: 'user@example.test',
        given_name: 'Maria',
        family_name: 'User',
      },
      context
    );

    expect(prepared).not.toHaveProperty('gender');
    expect(prepared).not.toHaveProperty('birthdate');
  });

  it('does not persist empty optional fields or malformed profile values', async () => {
    const config = createUserEntityConfig(deps);

    const prepared = await config.importConfig!.prepareRow(
      {
        email: 'user@example.test',
        given_name: 'Maria',
        family_name: 'User',
        middle_name: '   ',
        nickname: null,
        gender: 'unknown',
        birthdate: 'not-a-date',
      },
      context
    );

    expect(prepared).not.toHaveProperty('middle_name');
    expect(prepared).not.toHaveProperty('nickname');
    expect(prepared).not.toHaveProperty('gender');
    expect(prepared).not.toHaveProperty('birthdate');
  });

  it('allows blank optional profile URLs in CSV imports', async () => {
    const config = createUserEntityConfig(deps);
    const birthdateValidator = config.importConfig!.columns.find(
      column => column.field === 'birthdate'
    )!.validator!;

    const result = await transferService.validateImport(
      [
        {
          email: 'user@example.test',
          given_name: 'Maria',
          family_name: 'User',
          profile: '   ',
          website: '',
          picture: '   ',
          birthdate: '',
        },
      ],
      config,
      context
    );

    expect(result).toMatchObject({ valid: true, validCount: 1, errors: [] });
    expect(birthdateValidator.safeParse('').success).toBe(true);
  });

  it.each([
    ['profile', 'javascript:alert(document.domain)', 'must use http or https'],
    ['website', 'javascript:alert(document.domain)', 'must use http or https'],
    ['picture', 'javascript:alert(document.domain)', 'must use http or https'],
    [
      'profile',
      'https://admin:secret@example.test/',
      'must not include credentials',
    ],
    [
      'profile',
      'https://*.example.test/',
      'must not include a wildcard hostname',
    ],
    ['profile', 'not a URL', 'must be a valid URL'],
  ])(
    'rejects unsafe %s import value %s',
    async (field, value, expectedMessage) => {
      const config = createUserEntityConfig(deps);

      const result = await transferService.validateImport(
        [
          {
            email: 'user@example.test',
            given_name: 'Maria',
            family_name: 'User',
            [field]: value,
          },
        ],
        config,
        context
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]?.fields[field]).toContain(expectedMessage);
      expect(userService.findByEmail).not.toHaveBeenCalled();
    }
  );

  it('inserts prepared users through generated-username creation', async () => {
    const config = createUserEntityConfig(deps);
    const prepared = { email: 'user@example.test', password: 'hash' };

    await expect(
      config.importConfig!.insertRow(prepared, context)
    ).resolves.toBeUndefined();

    expect(userService.createUserWithGeneratedUsername).toHaveBeenCalledWith(
      prepared
    );
  });

  it('exports core fields while gating sensitive data and password secrets', async () => {
    const config = createUserEntityConfig(deps);
    const storedUser = {
      email: 'user@example.test',
      given_name: 'Maria',
      family_name: 'User',
      username: 'maria',
      phone_number: '+22900000000',
      country: 'Benin',
      password: 'password-hash',
      password_hash_algo: 'argon2id',
      repository_only_field: 'must-not-leak',
    };
    vi.mocked(userService.findMany).mockResolvedValue([storedUser] as never);

    const core = await config.exportConfig!.loadData({}, context);
    const sensitive = await config.exportConfig!.loadData(
      { includeSensitive: true },
      context
    );
    const secrets = await config.exportConfig!.loadData(
      { includeSecrets: true },
      context
    );
    const malformedFlags = await config.exportConfig!.loadData(
      {
        includeSensitive: 'false' as unknown as boolean,
        includeSecrets: 'false' as unknown as boolean,
      },
      context
    );

    expect(core[0]).toMatchObject({
      email: 'user@example.test',
      given_name: 'Maria',
      family_name: 'User',
      username: 'maria',
    });
    expect(core[0]).not.toHaveProperty('phone_number');
    expect(core[0]).not.toHaveProperty('password');
    expect(core[0]).not.toHaveProperty('repository_only_field');
    expect(sensitive[0]).toMatchObject({
      phone_number: '+22900000000',
      country: 'Benin',
    });
    expect(sensitive[0]).not.toHaveProperty('password');
    expect(secrets[0]).toMatchObject({
      password: 'password-hash',
      password_hash_algo: 'argon2id',
    });
    expect(secrets[0]).not.toHaveProperty('phone_number');
    expect(malformedFlags[0]).not.toHaveProperty('phone_number');
    expect(malformedFlags[0]).not.toHaveProperty('password');
    expect(userService.findMany).toHaveBeenCalledWith(
      {},
      { sort: { created_at: -1, username: 1 }, limit: 10000 }
    );
  });

  it('exports every user batch instead of silently truncating at 10,000 rows', async () => {
    const firstPageUser = {
      email: 'first@example.test',
      given_name: 'First',
      family_name: 'User',
      username: 'first',
    };
    const secondPageUser = {
      email: 'last@example.test',
      given_name: 'Last',
      family_name: 'User',
      username: 'last',
    };
    vi.mocked(userService.findMany)
      .mockResolvedValueOnce(Array(10000).fill(firstPageUser) as never)
      .mockResolvedValueOnce([secondPageUser] as never);
    const config = createUserEntityConfig(deps);

    const rows = await config.exportConfig!.loadData({}, context);

    expect(userService.findMany).toHaveBeenNthCalledWith(
      1,
      {},
      { sort: { created_at: -1, username: 1 }, limit: 10000 }
    );
    expect(userService.findMany).toHaveBeenNthCalledWith(
      2,
      {},
      {
        sort: { created_at: -1, username: 1 },
        limit: 10000,
        skip: 10000,
      }
    );
    expect(rows).toHaveLength(10001);
    expect(rows.at(-1)?.email).toBe('last@example.test');
  });

  it('formats user export dates, booleans, and roles for CSV consumers', () => {
    const config = createUserEntityConfig(deps);
    const column = (field: string) =>
      config.exportConfig!.columns.find(
        candidate => candidate.field === field
      )!;
    const date = new Date('2026-08-02T12:34:56.000Z');

    for (const field of [
      'birthdate',
      'created_at',
      'updated_at',
      'password_updated_at',
    ]) {
      expect(column(field).formatter!(date)).toBe('2026-08-02');
      expect(column(field).formatter!('already-formatted')).toBe(
        'already-formatted'
      );
      expect(column(field).formatter!(null)).toBe('');
    }
    expect(column('account_enabled').formatter!(true)).toBe('Enabled');
    expect(column('account_enabled').formatter!(false)).toBe('Disabled');
    expect(column('email_verified').formatter!(true)).toBe('Yes');
    expect(column('email_verified').formatter!(false)).toBe('No');
    expect(column('roles').formatter!(['admin', 'user'])).toBe('admin;user');
    expect(column('roles').formatter!('admin')).toBe('');
  });
});
