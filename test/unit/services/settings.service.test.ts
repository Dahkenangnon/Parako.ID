/**
 * TDD — SettingsService uses ISettingsRepository for data access
 *
 * RED: SettingsService extends BaseService (Mongoose), uses settingsModel directly.
 * GREEN: After migrating to ISettingsRepository.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from '../../../src/services/settings.service.js';
import type { ISettings } from '../../../src/models/settings/types.js';
import type { ISettingsRepository } from '../../../src/db/repositories/interfaces/settings.repository.js';

// ── Stubs ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeService(repo: ISettingsRepository): SettingsService {
  return new SettingsService(makeMockLogger() as any, repo as any);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsService — ISettingsRepository delegation', () => {
  let repo: ISettingsRepository;
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  // ── getMainConfiguration ────────────────────────────────────────────────────

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

  // ── hasMainConfiguration ─────────────────────────────────────────────────────

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

  // ── saveMainConfiguration ────────────────────────────────────────────────────

  describe('saveMainConfiguration', () => {
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
  });

  // ── getConfigurationHistory ───────────────────────────────────────────────────

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

  // ── getConfigurationStatistics ────────────────────────────────────────────────

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

  // ── getConfigurationByKey ─────────────────────────────────────────────────────

  describe('getConfigurationByKey', () => {
    it('delegates to repo.findActive', async () => {
      const settings = makeSettings({ key: 'some_key' });
      vi.mocked(repo.findActive).mockResolvedValue(settings);

      const result = await service.getConfigurationByKey('some_key');

      expect(repo.findActive).toHaveBeenCalledWith('some_key');
      expect(result).toEqual(settings);
    });
  });

  // ── getAllActiveConfigurations ─────────────────────────────────────────────────

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
});
