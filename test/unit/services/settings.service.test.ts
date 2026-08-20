import 'reflect-metadata';
import { BootstrapEnvironment } from '../../../src/config/bootstrap-environment.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from '../../../src/services/settings.service.js';
import type { ISettings } from '../../../src/models/settings/types.js';
import type { ISettingsRepository } from '../../../src/db/repositories/interfaces/settings.repository.js';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { ConfigurationVersionConflictError } from '../../../src/errors/configuration-version-conflict.error.js';
import {
  ensureDecrypted,
  ensureEncrypted,
} from '../../../src/utils/encryption.js';

function makeMockRepo(): ISettingsRepository {
  return {
    findById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    findActive: vi.fn(),
    findVersion: vi.fn(),
    findHistory: vi.fn(),
    save: vi.fn(),
    getLatestVersion: vi.fn(),
  } as unknown as ISettingsRepository;
}

function makeSettings(overrides: Partial<ISettings> = {}): ISettings {
  return {
    _id: 'settings-123',
    id: 'settings-123',
    key: 'parako_config',
    version: '1.0.0',
    is_active: true,
    _version: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as unknown as ISettings;
}

function makeMockLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeService(
  repo: ISettingsRepository,
  logger = makeMockLogger()
): SettingsService {
  return new SettingsService(
    logger as any,
    repo as any,
    new BootstrapEnvironment()
  );
}

describe('SettingsService — ISettingsRepository delegation', () => {
  let repo: ISettingsRepository;
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  describe('getMainConfiguration', () => {
    it('delegates to repo.findActive', async () => {
      const settings = makeSettings();
      vi.mocked(repo.findActive).mockResolvedValue(settings);

      const result = await service.getMainConfiguration();

      expect(repo.findActive).toHaveBeenCalledWith('parako_config');
      expect(result).not.toBeNull();
    });

    it('returns null when no active settings', async () => {
      vi.mocked(repo.findActive).mockResolvedValue(null);

      const result = await service.getMainConfiguration();

      expect(result).toBeNull();
    });
  });

  describe('base service compatibility', () => {
    it('routes id, active-key, and arbitrary findOne filters correctly', async () => {
      const byId = makeSettings({ _id: 'by-id' });
      const active = makeSettings({ key: 'feature' });
      const inactive = makeSettings({ is_active: false });
      vi.mocked(repo.findById).mockResolvedValue(byId);
      vi.mocked(repo.findActive).mockResolvedValue(active);
      vi.mocked(repo.findOne).mockResolvedValue(inactive);

      await expect(service.findOne('by-id')).resolves.toBe(byId);
      await expect(service.findOne({ key: 'feature' })).resolves.toBe(active);
      await expect(
        service.findOne({ key: 'feature', is_active: false })
      ).resolves.toBe(inactive);
      await expect(service.findOne({ environment: 'test' })).resolves.toBe(
        inactive
      );

      expect(repo.findById).toHaveBeenCalledWith('by-id');
      expect(repo.findActive).toHaveBeenCalledWith('feature');
      expect(repo.findOne).toHaveBeenCalledWith({
        key: 'feature',
        is_active: false,
      });
      expect(repo.findOne).toHaveBeenCalledWith({ environment: 'test' });
    });

    it('counts, lists, creates, and bulk-creates through the repository', async () => {
      const first = makeSettings({ _id: 'one' });
      const second = makeSettings({ _id: 'two' });
      vi.mocked(repo.count).mockResolvedValue(2);
      vi.mocked(repo.findMany).mockResolvedValue([first, second]);
      vi.mocked(repo.create)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      await expect(service.countDocuments()).resolves.toBe(2);
      await expect(
        service.findMany(
          { is_active: true },
          { sort: { created_at: -1 }, limit: 5, skip: 1 }
        )
      ).resolves.toEqual([first, second]);
      await expect(service.createOne({ key: 'one' })).resolves.toBe(first);
      await expect(
        service.createMany([{ key: 'one' }, { key: 'two' }])
      ).resolves.toEqual([first, second]);

      expect(repo.count).toHaveBeenCalledWith({});
      expect(repo.findMany).toHaveBeenCalledWith(
        { is_active: true },
        { sort: { created_at: -1 }, limit: 5, skip: 1 }
      );
      expect(repo.create).toHaveBeenNthCalledWith(1, { key: 'one' });
      expect(repo.create).toHaveBeenNthCalledWith(2, { key: 'one' });
      expect(repo.create).toHaveBeenNthCalledWith(3, { key: 'two' });
    });

    it('updates one, maps repository not-found errors to null, and propagates other errors', async () => {
      const updated = makeSettings({ description: 'updated' });
      vi.mocked(repo.update).mockResolvedValueOnce(updated);

      await expect(
        service.updateById('settings-123', { description: 'updated' })
      ).resolves.toBe(updated);

      vi.mocked(repo.update).mockRejectedValueOnce(
        new Error('Settings not found: missing')
      );
      await expect(service.updateById('missing', {})).resolves.toBeNull();

      vi.mocked(repo.update).mockRejectedValueOnce(
        new Error('Document not found during update')
      );
      await expect(service.updateById('missing', {})).resolves.toBeNull();

      vi.mocked(repo.update).mockRejectedValueOnce('database unavailable');
      await expect(service.updateById('one', {})).rejects.toBe(
        'database unavailable'
      );
    });

    it('updates every matching record and reports deterministic bulk counts', async () => {
      const docs = [makeSettings({ _id: 'one' }), makeSettings({ _id: 'two' })];
      vi.mocked(repo.findMany).mockResolvedValue(docs);
      vi.mocked(repo.update).mockResolvedValue(makeSettings());

      await expect(
        service.updateMany({ is_active: true }, { is_active: false })
      ).resolves.toEqual({
        modifiedCount: 2,
        matchedCount: 2,
        upsertedCount: 0,
      });
      expect(repo.update).toHaveBeenNthCalledWith(1, 'one', {
        is_active: false,
      });
      expect(repo.update).toHaveBeenNthCalledWith(2, 'two', {
        is_active: false,
      });
    });

    it('returns the requested repository-backed pagination page and totals', async () => {
      const docs = [makeSettings({ _id: 'row-3' })];
      vi.mocked(repo.findMany).mockResolvedValue(docs);
      vi.mocked(repo.count).mockResolvedValue(11);

      await expect(
        service.findWithPagination(
          { is_active: true },
          { page: 3, limit: 5, sort: { created_at: -1 } }
        )
      ).resolves.toEqual({
        results: docs,
        page: 3,
        limit: 5,
        totalResults: 11,
        totalPages: 3,
      });
      expect(repo.findMany).toHaveBeenCalledWith(
        { is_active: true },
        { sort: { created_at: -1 }, limit: 5, skip: 10 }
      );
      expect(repo.count).toHaveBeenCalledWith({ is_active: true });
    });
  });

  describe('hasMainConfiguration', () => {
    it('delegates to repo.findActive and returns true when found', async () => {
      vi.mocked(repo.findActive).mockResolvedValue(makeSettings());

      const result = await service.hasMainConfiguration();

      expect(repo.findActive).toHaveBeenCalledWith('parako_config');
      expect(result).toBe(true);
    });

    it('returns false when no active settings', async () => {
      vi.mocked(repo.findActive).mockResolvedValue(null);

      const result = await service.hasMainConfiguration();

      expect(result).toBe(false);
    });
  });

  describe('saveMainConfiguration', () => {
    it.each([
      [undefined, 'ENCRYPTION_KEY environment variable is not set'],
      ['too-short', 'ENCRYPTION_KEY must be 32 bytes'],
      ['!'.repeat(44), 'ENCRYPTION_KEY must be 32 bytes'],
    ])(
      'rejects invalid encryption key %s before persistence',
      async (key, message) => {
        const originalKey = process.env.ENCRYPTION_KEY;
        if (key === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = key;

        try {
          await expect(service.saveMainConfiguration({})).rejects.toThrow(
            message
          );
          expect(repo.save).not.toHaveBeenCalled();
        } finally {
          if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
          else process.env.ENCRYPTION_KEY = originalKey;
        }
      }
    );

    it('delegates to repo.save with encrypted config', async () => {
      // Set a valid ENCRYPTION_KEY for this test
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

      try {
        const saved = makeSettings({ version: '1.0.1', _version: 1 });
        vi.mocked(repo.findActive).mockResolvedValue(null);
        vi.mocked(repo.save).mockResolvedValue(saved);
        vi.mocked(repo.findHistory).mockResolvedValue([saved]);

        const minimalConfig = { key: 'parako_config', value: {} };
        const result = await service.saveMainConfiguration(
          minimalConfig,
          'admin',
          'test save'
        );

        expect(repo.save).toHaveBeenCalledWith(
          'parako_config',
          expect.any(Object),
          expect.objectContaining({
            last_modified_by: 'admin',
            change_reason: 'test save',
          })
        );
        expect(result).toEqual(saved);
      } finally {
        process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('accepts a canonical 32-byte base64 encryption key', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
      const saved = makeSettings();
      vi.mocked(repo.findActive).mockResolvedValue(null);
      vi.mocked(repo.save).mockResolvedValue(saved);
      vi.mocked(repo.findHistory).mockResolvedValue([saved]);

      try {
        await expect(service.saveMainConfiguration({})).resolves.toBe(saved);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('encrypts populated scalar and array secrets while preserving metadata', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      const existing = makeSettings({
        description: 'Existing description',
        metadata: { tags: ['stable'], environment: 'production' },
      });
      const saved = makeSettings({ version: '1.0.1', _version: 1 });
      vi.mocked(repo.findActive).mockResolvedValue(existing);
      vi.mocked(repo.findHistory)
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([saved]);
      vi.mocked(repo.save).mockResolvedValue(saved);
      const config = {
        security: {
          secrets: {
            jwt_secret: 'jwt-plain',
            cookie_secrets: ['cookie-one', '', 7],
          },
        },
        integrations: { email: { smtp_password: null } },
      };

      let decryptedJwt = '';
      try {
        await service.saveMainConfiguration(config, 'admin', 'rotate secrets');
        const savedValue = vi.mocked(repo.save).mock.calls[0][1] as any;
        decryptedJwt = ensureDecrypted(savedValue.security.secrets.jwt_secret);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      const savedValue = vi.mocked(repo.save).mock.calls[0][1] as any;
      expect(savedValue.description).toBe('Existing description');
      expect(savedValue.security.secrets.jwt_secret).toMatch(/^ENCRYPTED:v1:/);
      expect(decryptedJwt).toBe('jwt-plain');
      expect(savedValue.security.secrets.cookie_secrets[0]).toMatch(
        /^ENCRYPTED:v1:/
      );
      expect(savedValue.security.secrets.cookie_secrets.slice(1)).toEqual([
        '',
        7,
      ]);
      expect(repo.save).toHaveBeenCalledWith(
        'parako_config',
        expect.any(Object),
        {
          last_modified_by: 'admin',
          change_reason: 'rotate secrets',
          tags: ['stable'],
          environment: 'production',
        }
      );
    });

    it('preserves empty and non-string secret values for schema validation', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '2'.repeat(64);
      const saved = makeSettings();
      vi.mocked(repo.findActive).mockResolvedValue(null);
      vi.mocked(repo.save).mockResolvedValue(saved);
      vi.mocked(repo.findHistory).mockResolvedValue([saved]);

      try {
        await service.saveMainConfiguration({
          integrations: { email: { smtp_password: '' } },
          integrations2: {},
          notifications: { channels: { sms: { api_key: 42 } } },
        });
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      const savedValue = vi.mocked(repo.save).mock.calls[0][1] as any;
      expect(savedValue.integrations.email.smtp_password).toBe('');
      expect(savedValue.notifications.channels.sms.api_key).toBe(42);
    });

    it('serializes concurrent in-process main configuration saves', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '3'.repeat(64);
      let resolveFirstSave!: (value: ISettings) => void;
      const firstSave = new Promise<ISettings>(resolve => {
        resolveFirstSave = resolve;
      });
      const first = makeSettings({ _id: 'first' });
      const second = makeSettings({ _id: 'second' });
      vi.mocked(repo.findActive).mockResolvedValue(null);
      vi.mocked(repo.findHistory).mockResolvedValue([]);
      vi.mocked(repo.save)
        .mockReturnValueOnce(firstSave)
        .mockResolvedValueOnce(second);

      try {
        const firstRequest = service.saveMainConfiguration({ request: 1 });
        await vi.waitFor(() => expect(repo.save).toHaveBeenCalledTimes(1));

        const secondRequest = service.saveMainConfiguration({ request: 2 });
        await Promise.resolve();
        expect(repo.findActive).toHaveBeenCalledTimes(1);
        expect(repo.save).toHaveBeenCalledTimes(1);

        resolveFirstSave(first);
        await expect(firstRequest).resolves.toBe(first);
        await expect(secondRequest).resolves.toBe(second);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('rejects an optimistic version conflict before writing', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'c'.repeat(64);
      const current = makeSettings({ _version: 1, version: '1.0.1' });
      const newerInactive = makeSettings({
        _id: 'newer',
        _version: 2,
        version: '1.0.2',
        is_active: false,
      });
      vi.mocked(repo.findActive).mockResolvedValue(current);
      vi.mocked(repo.findHistory).mockResolvedValue([newerInactive, current]);

      try {
        await expect(
          service.saveMainConfiguration({}, 'admin')
        ).rejects.toBeInstanceOf(ConfigurationVersionConflictError);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('forwards the submitted active version to the atomic repository save', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '4'.repeat(64);
      const current = makeSettings({ _version: 7, version: '1.0.7' });
      const saved = makeSettings({ _version: 8, version: '1.0.8' });
      vi.mocked(repo.findActive).mockResolvedValue(current);
      vi.mocked(repo.findHistory).mockResolvedValue([current]);
      vi.mocked(repo.save).mockResolvedValue(saved);

      try {
        await expect(
          service.saveMainConfiguration({}, 'admin', 'update', 7)
        ).resolves.toBe(saved);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      expect(repo.save).toHaveBeenCalledWith(
        'parako_config',
        expect.any(Object),
        expect.objectContaining({
          last_modified_by: 'admin',
          change_reason: 'update',
        }),
        7
      );
    });

    it('treats legacy active settings without a revision as version zero', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '6'.repeat(64);
      const current = makeSettings({ _version: undefined });
      const saved = makeSettings({ _version: 1, version: '1.0.1' });
      vi.mocked(repo.findActive).mockResolvedValue(current);
      vi.mocked(repo.findHistory).mockResolvedValue([current]);
      vi.mocked(repo.save).mockResolvedValue(saved);

      try {
        await expect(
          service.saveMainConfiguration({}, 'admin', 'legacy update', 0)
        ).resolves.toBe(saved);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      expect(repo.save).toHaveBeenCalledWith(
        'parako_config',
        expect.any(Object),
        expect.objectContaining({ change_reason: 'legacy update' }),
        0
      );
    });

    it('rejects a submitted version when no active configuration exists', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '7'.repeat(64);
      vi.mocked(repo.findActive).mockResolvedValue(null);

      try {
        await expect(
          service.saveMainConfiguration({}, 'admin', 'stale update', 7)
        ).rejects.toMatchObject({ expectedVersion: 7 });
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      expect(repo.findHistory).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects a stale submitted version before attempting a repository write', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '5'.repeat(64);
      const current = makeSettings({ _version: 8, version: '1.0.8' });
      vi.mocked(repo.findActive).mockResolvedValue(current);

      try {
        const rejection = service.saveMainConfiguration(
          {},
          'admin',
          'stale update',
          7
        );
        await expect(rejection).rejects.toMatchObject({
          expectedVersion: 7,
          actualVersion: 8,
        });
        await expect(rejection).rejects.toBeInstanceOf(
          ConfigurationVersionConflictError
        );
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      expect(repo.findHistory).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('delegates transaction-compatible saves to the atomic repository path', async () => {
      const saved = makeSettings();
      const save = vi
        .spyOn(service, 'saveMainConfiguration')
        .mockResolvedValue(saved);

      await expect(
        service.saveMainConfigurationWithTransaction({}, 'admin', 'reason', 7)
      ).resolves.toBe(saved);
      expect(save).toHaveBeenCalledWith({}, 'admin', 'reason', 7);
    });
  });

  describe('loadAndDecryptConfiguration', () => {
    it('decrypts and validates the active full configuration', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'd'.repeat(64);
      const config: any = getDefaultFullConfig();
      const jwtSecret = 'jwt-secret'.padEnd(32, '-');
      const cookieSecret = 'cookie-secret'.padEnd(32, '-');
      config.security.secrets.jwt_secret = ensureEncrypted(jwtSecret);
      config.security.secrets.cookie_secrets = [ensureEncrypted(cookieSecret)];
      vi.mocked(repo.findActive).mockResolvedValue(makeSettings(config));

      try {
        const result: any = await service.loadAndDecryptConfiguration();
        expect(result.security.secrets.jwt_secret).toBe(jwtSecret);
        expect(result.security.secrets.cookie_secrets).toEqual([cookieSecret]);
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('returns null when the active configuration is absent', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'e'.repeat(64);
      vi.mocked(repo.findActive).mockResolvedValue(null);
      try {
        await expect(service.loadAndDecryptConfiguration()).resolves.toBeNull();
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('logs individual decryption failures and keeps validating other fields', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'f'.repeat(64);
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      const config: any = getDefaultFullConfig();
      config.integrations.email.smtp_password = 'ENCRYPTED:invalid';
      vi.mocked(repo.findActive).mockResolvedValue(makeSettings(config));
      try {
        const result: any = await service.loadAndDecryptConfiguration();
        expect(result.integrations.email.smtp_password).toBe(
          'ENCRYPTED:invalid'
        );
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
      expect(logger.error).toHaveBeenCalledWith(
        '[SettingsService] Failed to decrypt field: integrations.email.smtp_password',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('preserves invalid empty secret values and lets schema validation reject them', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '4'.repeat(64);
      const config: any = getDefaultFullConfig();
      config.security.secrets.cookie_secrets = [''];
      config.integrations.email.smtp_password = '';
      vi.mocked(repo.findActive).mockResolvedValue(makeSettings(config));

      try {
        await expect(service.loadAndDecryptConfiguration()).rejects.toThrow();
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('logs and rethrows repository failures', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '1'.repeat(64);
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      const failure = new Error('database unavailable');
      vi.mocked(repo.findActive).mockRejectedValue(failure);
      try {
        await expect(service.loadAndDecryptConfiguration()).rejects.toBe(
          failure
        );
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'load_and_decrypt_configuration',
      });
    });
  });

  describe('keyed configuration and status helpers', () => {
    it('saves non-main keyed configuration with audit metadata', async () => {
      const saved = makeSettings({ key: 'feature_flags' });
      vi.mocked(repo.save).mockResolvedValue(saved);

      await expect(
        service.saveConfigurationByKey(
          'feature_flags',
          { enabled: true },
          'ignored description',
          'admin',
          'enable feature'
        )
      ).resolves.toBe(saved);
      expect(repo.save).toHaveBeenCalledWith(
        'feature_flags',
        {
          enabled: true,
          key: 'feature_flags',
          schema_version: '1.0.0',
        },
        {
          last_modified_by: 'admin',
          change_reason: 'enable feature',
          tags: ['configuration'],
        }
      );
    });

    it('logs and rethrows keyed save failures for main and non-main keys', async () => {
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      const failure = new Error('save failed');
      vi.mocked(repo.save).mockRejectedValue(failure);

      await expect(
        service.saveConfigurationByKey('feature_flags', {})
      ).rejects.toBe(failure);
      await expect(
        service.saveConfigurationByKey('parako_config', {})
      ).rejects.toBe(failure);
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'save_configuration_by_key',
        key: 'parako_config',
      });
    });

    it('reports last update, document existence, and safe fallbacks', async () => {
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      vi.mocked(repo.findActive).mockResolvedValueOnce(
        makeSettings({ updated_at: '2026-08-02T10:00:00.000Z' })
      );
      await expect(service.getMainConfigurationLastUpdated()).resolves.toEqual(
        new Date('2026-08-02T10:00:00.000Z')
      );
      vi.mocked(repo.findActive).mockResolvedValueOnce(
        makeSettings({ updated_at: undefined })
      );
      await expect(
        service.getMainConfigurationLastUpdated()
      ).resolves.toBeNull();
      vi.mocked(repo.findActive).mockRejectedValueOnce(
        new Error('read failed')
      );
      await expect(
        service.getMainConfigurationLastUpdated()
      ).resolves.toBeNull();

      vi.mocked(repo.count).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await expect(service.configDocumentExists()).resolves.toBe(true);
      await expect(service.configDocumentExists()).resolves.toBe(false);
      vi.mocked(repo.count).mockRejectedValueOnce(new Error('count failed'));
      await expect(service.configDocumentExists()).resolves.toBe(false);
    });

    it('returns safe fallbacks for read helper failures', async () => {
      vi.mocked(repo.findActive).mockRejectedValue(new Error('read failed'));
      vi.mocked(repo.findMany).mockRejectedValue(new Error('list failed'));

      await expect(service.getMainConfiguration()).rejects.toThrow(
        'read failed'
      );
      await expect(
        service.getConfigurationByKey('feature')
      ).resolves.toBeNull();
      await expect(service.hasMainConfiguration()).resolves.toBe(false);
      await expect(service.getAllActiveConfigurations()).resolves.toEqual([]);
    });
  });

  describe('getConfigurationHistory', () => {
    it('delegates to repo.findHistory', async () => {
      const history = [makeSettings({ _version: 1 }), makeSettings()];
      vi.mocked(repo.findHistory).mockResolvedValue(history);

      const result = await service.getConfigurationHistory('parako_config');

      expect(repo.findHistory).toHaveBeenCalledWith('parako_config');
      expect(result).toEqual(history);
    });

    it('returns empty array on error', async () => {
      vi.mocked(repo.findHistory).mockRejectedValue(new Error('DB error'));

      const result = await service.getConfigurationHistory('parako_config');

      expect(result).toEqual([]);
    });
  });

  describe('getConfigurationStatistics', () => {
    it('delegates count calls to repo', async () => {
      vi.mocked(repo.count).mockResolvedValue(5);
      vi.mocked(repo.findActive).mockResolvedValue(makeSettings());

      const stats = await service.getConfigurationStatistics();

      expect(repo.count).toHaveBeenCalledWith({});
      expect(repo.count).toHaveBeenCalledWith({ is_active: true });
      expect(stats.totalConfigurations).toBe(5);
      expect(stats.activeConfigurations).toBe(5);
      expect(stats.mainConfigurationExists).toBe(true);
    });
  });

  describe('getConfigurationByKey', () => {
    it('delegates to repo.findActive', async () => {
      const settings = makeSettings({ key: 'some_key' });
      vi.mocked(repo.findActive).mockResolvedValue(settings);

      const result = await service.getConfigurationByKey('some_key');

      expect(repo.findActive).toHaveBeenCalledWith('some_key');
      expect(result).toEqual(settings);
    });
  });

  describe('getAllActiveConfigurations', () => {
    it('delegates to repo.findMany with is_active filter', async () => {
      const settings = [makeSettings()];
      vi.mocked(repo.findMany).mockResolvedValue(settings);

      const result = await service.getAllActiveConfigurations();

      expect(repo.findMany).toHaveBeenCalledWith(
        { is_active: true },
        expect.anything()
      );
      expect(result).toEqual(settings);
    });
  });

  describe('configuration validation, migration, and initial flush', () => {
    it('validates full configurations and rejects incomplete ones', () => {
      expect(
        service.validateConfiguration(getDefaultFullConfig()).success
      ).toBe(true);
      expect(service.validateConfiguration({}).success).toBe(false);
    });

    it('migrates with defaults or explicit audit values and propagates failures', async () => {
      const saved = makeSettings();
      const save = vi
        .spyOn(service, 'saveMainConfiguration')
        .mockResolvedValueOnce(saved)
        .mockResolvedValueOnce(saved)
        .mockRejectedValueOnce(new Error('migration failed'));

      await expect(service.migrateFromFile({ enabled: true })).resolves.toBe(
        saved
      );
      await expect(
        service.migrateFromFile({ enabled: false }, 'admin', 'manual import')
      ).resolves.toBe(saved);
      await expect(service.migrateFromFile({})).rejects.toThrow(
        'migration failed'
      );
      expect(save).toHaveBeenNthCalledWith(
        1,
        { enabled: true },
        'system',
        'Migration from file configuration'
      );
      expect(save).toHaveBeenNthCalledWith(
        2,
        { enabled: false },
        'admin',
        'manual import'
      );
    });

    it('returns an existing main configuration without flushing defaults', async () => {
      const existing = makeSettings();
      vi.spyOn(service, 'getMainConfiguration').mockResolvedValue(existing);
      const save = vi.spyOn(service, 'saveMainConfiguration');

      await expect(service.flushInitialConfiguration()).resolves.toBe(existing);
      expect(save).not.toHaveBeenCalled();
    });

    it('flushes validated defaults with explicit and fallback audit values', async () => {
      const saved = makeSettings();
      const initialConfig = getDefaultFullConfig();
      initialConfig.deployment.url = 'https://id.operator.test';
      vi.spyOn(service, 'getMainConfiguration').mockResolvedValue(null);
      const save = vi
        .spyOn(service, 'saveMainConfiguration')
        .mockResolvedValue(saved);

      await expect(
        service.flushInitialConfiguration(
          'bootstrap',
          'first run',
          initialConfig
        )
      ).resolves.toBe(saved);
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          deployment: expect.objectContaining({
            url: 'https://id.operator.test',
          }),
        }),
        'bootstrap',
        'first run'
      );

      await service.flushInitialConfiguration();
      expect(save).toHaveBeenLastCalledWith(
        expect.any(Object),
        'system',
        'Initial configuration flush'
      );
    });

    it('returns null when initial configuration discovery or save fails', async () => {
      vi.spyOn(service, 'getMainConfiguration').mockRejectedValue(
        new Error('initial read failed')
      );
      await expect(service.flushInitialConfiguration()).resolves.toBeNull();
    });

    it('returns a safe statistics fallback when a composed helper rejects', async () => {
      vi.spyOn(service, 'hasMainConfiguration').mockRejectedValue(
        new Error('status failed')
      );
      vi.mocked(repo.count).mockResolvedValue(2);

      await expect(service.getConfigurationStatistics()).resolves.toEqual({
        totalConfigurations: 0,
        activeConfigurations: 0,
        mainConfigurationExists: false,
        lastMainConfigurationUpdate: null,
      });
    });
  });

  describe('configuration diff and impact analysis', () => {
    it('reports nested additions, removals, modifications, and masks secrets', () => {
      const oldConfig = {
        _id: 'ignored',
        metadata: { ignored: true },
        security: {
          secrets: {
            jwt_secret: 'old-secret-value',
            cookie_secrets: ['old-cookie', 7],
          },
          enabled: true,
        },
        removed: 'old',
        unchanged: ['same'],
        nullable: null,
        notifications: { channels: { sms: { api_key: 123 } } },
      };
      const newConfig = {
        _id: 'different-but-ignored',
        metadata: { ignored: false },
        security: {
          secrets: {
            jwt_secret: 'new-secret-value',
            cookie_secrets: ['new-cookie', 8],
          },
          enabled: false,
        },
        added: 'new',
        unchanged: ['same'],
        nullable: { nested: true },
        notifications: { channels: { sms: { api_key: 456 } } },
      };

      const changes = service.generateConfigDiff(oldConfig, newConfig);

      expect(changes).toEqual(
        expect.arrayContaining([
          {
            field: 'security.enabled',
            oldValue: true,
            newValue: false,
            changeType: 'modified',
          },
          {
            field: 'removed',
            oldValue: 'old',
            newValue: null,
            changeType: 'removed',
          },
          {
            field: 'added',
            oldValue: null,
            newValue: 'new',
            changeType: 'added',
          },
          {
            field: 'nullable',
            oldValue: null,
            newValue: { nested: true },
            changeType: 'modified',
          },
        ])
      );
      const jwt = changes.find(
        change => change.field === 'security.secrets.jwt_secret'
      );
      expect(jwt).toMatchObject({ changeType: 'modified' });
      expect(jwt?.oldValue).not.toBe('old-secret-value');
      expect(jwt?.newValue).not.toBe('new-secret-value');
      const cookies = changes.find(
        change => change.field === 'security.secrets.cookie_secrets'
      );
      const oldCookies = cookies?.oldValue;
      expect(Array.isArray(oldCookies)).toBe(true);
      if (!Array.isArray(oldCookies)) {
        throw new TypeError(
          'Expected masked cookie secrets to remain an array'
        );
      }
      expect(oldCookies[0]).not.toBe('old-cookie');
      expect(oldCookies[1]).toBe(7);
      expect(changes.some(change => change.field === '_id')).toBe(false);
      expect(changes.some(change => change.field === 'unchanged')).toBe(false);
      expect(
        changes.find(
          change => change.field === 'notifications.channels.sms.api_key'
        )
      ).toMatchObject({ oldValue: 123, newValue: 456 });
    });

    it('supports absent inputs and an explicit nested path prefix', () => {
      expect(
        service.generateConfigDiff(null, { enabled: true }, 'feature')
      ).toEqual([
        {
          field: 'feature.enabled',
          oldValue: null,
          newValue: true,
          changeType: 'added',
        },
      ]);
      expect(service.generateConfigDiff({ enabled: true }, null)).toEqual([
        {
          field: 'enabled',
          oldValue: true,
          newValue: null,
          changeType: 'removed',
        },
      ]);
    });

    it('classifies every operationally significant configuration surface', () => {
      const fields = [
        'oidc.issuer',
        'oidc.secrets.pairwise_salt',
        'oidc.discovery.claims',
        'oidc.features.pkce',
        'security.secrets.jwt_secret',
        'security.secrets.cookie_secrets',
        'security.authentication.multi_factor.enabled',
        'security.rate_limiting.enabled',
        'integrations.email.smtp_host',
        'integrations.social_providers.google',
        'deployment.url',
        'deployment.server.allowed_origins',
        'branding.companyName',
        'branding.logo_url',
        'features.registration',
        'unrelated.value',
      ];
      const impact = service.analyzeConfigImpact(
        fields.map(field => ({
          field,
          oldValue: null,
          newValue: true,
          changeType: 'modified' as const,
        }))
      );

      expect(impact.requiresRestart).toBe(true);
      expect(impact.servicesAffected).toEqual(
        expect.arrayContaining([
          'oidc',
          'security',
          'authentication',
          'integrations',
          'email',
          'social_login',
          'deployment',
          'branding',
          'features',
        ])
      );
      expect(impact.warnings).toHaveLength(13);
    });

    it('returns an empty impact for no changes', () => {
      expect(service.analyzeConfigImpact([])).toEqual({
        servicesAffected: [],
        requiresRestart: false,
        warnings: [],
      });
    });
  });

  describe('active configuration validation and cleanup', () => {
    it.each([
      [[], null],
      [[makeSettings({ version: '1.2.3' })], '1.2.3'],
    ])(
      'accepts zero or one active configuration',
      async (active, keptVersion) => {
        vi.mocked(repo.findMany).mockResolvedValue(active as ISettings[]);

        await expect(service.validateAndFixActiveConfigs()).resolves.toEqual({
          isValid: true,
          multipleActiveFound: false,
          fixedCount: 0,
          keptVersion,
          details: `Validation passed: ${active.length} active configuration(s) found`,
        });
      }
    );

    it('keeps the first sorted configuration and deactivates every older row', async () => {
      const newest = makeSettings({
        _id: 'newest',
        version: '1.0.3',
        _version: 3,
      });
      const older = [
        makeSettings({ _id: 'old-2', version: '1.0.2', _version: 2 }),
        makeSettings({ _id: 'old-1', version: '1.0.1', _version: 1 }),
      ];
      vi.mocked(repo.findMany).mockResolvedValue([newest, ...older]);
      vi.mocked(repo.update).mockResolvedValue(makeSettings());
      vi.mocked(repo.count).mockResolvedValue(1);

      await expect(service.validateAndFixActiveConfigs()).resolves.toEqual({
        isValid: true,
        multipleActiveFound: true,
        fixedCount: 2,
        keptVersion: '1.0.3',
        details:
          'Auto-healed: Found 3 active configs, kept newest (v1.0.3), deactivated 2 older configs',
      });
      expect(repo.update).toHaveBeenNthCalledWith(1, 'old-2', {
        is_active: false,
      });
      expect(repo.update).toHaveBeenNthCalledWith(2, 'old-1', {
        is_active: false,
      });
    });

    it('reports partial deactivation failures and incomplete healing', async () => {
      const active = [
        makeSettings({ _id: 'newest', version: '1.0.2', _version: 2 }),
        makeSettings({ _id: 'old-1', version: '1.0.1', _version: 1 }),
        makeSettings({ _id: 'old-0', version: '1.0.0', _version: 0 }),
      ];
      vi.mocked(repo.findMany).mockResolvedValue(active);
      vi.mocked(repo.update)
        .mockRejectedValueOnce('deactivation failed')
        .mockResolvedValueOnce(makeSettings());
      vi.mocked(repo.count).mockResolvedValue(2);

      const result = await service.validateAndFixActiveConfigs();

      expect(result).toMatchObject({
        isValid: false,
        multipleActiveFound: true,
        fixedCount: 1,
        keptVersion: '1.0.2',
      });
      expect(result.details).toContain('2 active configs remain');
    });

    it('normalizes Error failures while deactivating an older configuration', async () => {
      const active = [
        makeSettings({ _id: 'newest', version: '1.0.2', _version: 2 }),
        makeSettings({ _id: 'old', version: '1.0.1', _version: 1 }),
      ];
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      vi.mocked(repo.findMany).mockResolvedValue(active);
      vi.mocked(repo.update).mockRejectedValue(new Error('update failed'));
      vi.mocked(repo.count).mockResolvedValue(2);

      await service.validateAndFixActiveConfigs();

      expect(logger.error).toHaveBeenCalledWith(
        '[SettingsService] Failed to deactivate config',
        expect.objectContaining({ error: 'update failed' })
      );
    });

    it.each([new Error('validation unavailable'), 'unknown failure'])(
      'propagates validation dependency failures: %s',
      async failure => {
        vi.mocked(repo.findMany).mockRejectedValue(failure);

        await expect(service.validateAndFixActiveConfigs()).rejects.toBe(
          failure
        );
      }
    );

    it('skips cleanup within retention and when old rows have no ids', async () => {
      vi.mocked(repo.findHistory)
        .mockResolvedValueOnce([makeSettings()])
        .mockResolvedValueOnce([
          makeSettings({ _id: 'keep' }),
          makeSettings({ _id: undefined }),
        ]);

      await expect(service.cleanupOldVersions('key', 1)).resolves.toBe(0);
      await expect(service.cleanupOldVersions('key', 1)).resolves.toBe(0);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes old versions independently and tolerates individual failures', async () => {
      const versions = [
        makeSettings({ _id: 'keep', version: '1.0.3' }),
        makeSettings({ _id: 'delete-2', version: '1.0.2' }),
        makeSettings({ _id: 'delete-1', version: '1.0.1' }),
      ];
      vi.mocked(repo.findHistory).mockResolvedValue(versions);
      vi.mocked(repo.delete)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce('delete failed');

      await expect(service.cleanupOldVersions('key', 1)).resolves.toBe(1);
      expect(repo.delete).toHaveBeenNthCalledWith(1, 'delete-2');
      expect(repo.delete).toHaveBeenNthCalledWith(2, 'delete-1');
    });

    it('normalizes Error failures while deleting an old version', async () => {
      const logger = makeMockLogger();
      service = makeService(repo, logger);
      vi.mocked(repo.findHistory).mockResolvedValue([
        makeSettings({ _id: 'keep' }),
        makeSettings({ _id: 'delete' }),
      ]);
      vi.mocked(repo.delete).mockRejectedValue(new Error('delete failed'));

      await expect(service.cleanupOldVersions('key', 1)).resolves.toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[SettingsService] Failed to delete old version',
        expect.objectContaining({ error: 'delete failed' })
      );
    });

    it('returns zero when history lookup fails', async () => {
      vi.mocked(repo.findHistory).mockRejectedValue(
        new Error('history failed')
      );
      await expect(service.cleanupOldVersions('key')).resolves.toBe(0);
    });
  });
});
