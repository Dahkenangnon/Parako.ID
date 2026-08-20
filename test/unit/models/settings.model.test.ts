import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createSettingsModel,
  type SettingsModel,
} from '../../../src/models/settings.model.js';

describe('Settings Mongoose model', () => {
  let Settings: SettingsModel;

  beforeAll(() => {
    if (mongoose.models.Settings) {
      mongoose.deleteModel('Settings');
    }
    Settings = createSettingsModel();
  });

  afterAll(() => {
    mongoose.deleteModel('Settings');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a never-persisted configuration as not newer than a timestamp', () => {
    const settings = new Settings({ key: 'parako_config' });

    expect(settings.isNewerThan(new Date(0))).toBe(false);
  });

  it('creates one reusable global model with safe document defaults and plugins', () => {
    const settings = new Settings({
      key: '  parako_config  ',
      description: '  Main settings  ',
    });

    expect(createSettingsModel()).toBe(Settings);
    expect(Settings.collection.collectionName).toBe('settings');
    expect((Settings.schema as any).tenantScoped).toBe(false);
    expect(typeof Settings.paginate).toBe('function');
    expect(settings).toMatchObject({
      key: 'parako_config',
      description: 'Main settings',
      version: '1.0.0',
      schema_version: '1.0.0',
      _version: 0,
      is_active: true,
    });
    expect(
      (settings.metadata as { tags?: string[] } | undefined)?.tags
    ).toEqual([]);
    expect(settings.toJSON()).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      key: 'parako_config',
    });
    expect(settings.toJSON()).not.toHaveProperty('_id');
  });

  it('can compile an isolated model registry for concurrent database harnesses', () => {
    const isolatedMongoose = new mongoose.Mongoose();

    expect(createSettingsModel(isolatedMongoose)).not.toBe(Settings);
    expect(isolatedMongoose.models.Settings).toBeDefined();
  });

  it('compares a persisted update timestamp strictly', () => {
    const settings = new Settings({
      key: 'parako_config',
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(settings.isNewerThan(new Date('2026-01-01T23:59:59.999Z'))).toBe(
      true
    );
    expect(settings.isNewerThan(new Date('2026-01-02T00:00:00.000Z'))).toBe(
      false
    );
    expect(settings.isNewerThan(new Date('2026-01-03T00:00:00.000Z'))).toBe(
      false
    );
  });

  it('increments semantic patch versions, including a missing patch component', () => {
    const settings = new Settings({ key: 'parako_config', version: '2.4.9' });
    const legacySettings = new Settings({
      key: 'legacy_config',
      version: '2.4',
    });

    expect(settings.incrementVersion()).toBe('2.4.10');
    expect(legacySettings.incrementVersion()).toBe('2.4.1');
  });

  it('returns the current document as its configuration value', () => {
    const settings = new Settings({ key: 'parako_config' });

    expect(settings.getValue()).toBe(settings);
  });

  it('persists activation and deactivation changes', async () => {
    const settings = new Settings({
      key: 'parako_config',
      is_active: false,
    });
    const save = vi
      .spyOn(settings, 'save')
      .mockImplementation(async () => settings);

    await expect(settings.activate()).resolves.toBe(settings);
    expect(settings.is_active).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    await expect(settings.deactivate()).resolves.toBe(settings);
    expect(settings.is_active).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('updates only configuration sections and advances both versions', async () => {
    const settings = new Settings({
      key: 'parako_config',
      version: '1.2.3',
      _version: 7,
      metadata: {
        last_modified_by: 'previous-admin',
        change_reason: 'Previous update',
        tags: ['production'],
      },
      application: {
        title: 'Before',
        description: 'Before update',
        locales: { default: 'en', available: ['en'] },
      },
    });
    vi.spyOn(settings, 'save').mockImplementation(async () => settings);

    await expect(
      settings.updateValue(
        {
          key: 'attacker-controlled-key',
          application: {
            title: 'After',
            description: 'After update',
            locales: { default: 'fr', available: ['en', 'fr'] },
          },
        } as any,
        'admin@example.test',
        'Approved change'
      )
    ).resolves.toBe(settings);

    expect(settings).toMatchObject({
      key: 'parako_config',
      version: '1.2.4',
      _version: 8,
      application: {
        title: 'After',
        description: 'After update',
        locales: { default: 'fr', available: ['en', 'fr'] },
      },
      metadata: {
        last_modified_by: 'admin@example.test',
        change_reason: 'Approved change',
        tags: ['production'],
      },
    });
  });

  it('initializes audit metadata and versioning for a legacy document', async () => {
    const settings = new Settings({ key: 'legacy_config' });
    settings.metadata = undefined;
    settings._version = undefined as any;
    vi.spyOn(settings, 'save').mockImplementation(async () => settings);

    await expect(
      settings.updateValue({}, 'migration', 'Backfill metadata')
    ).resolves.toBe(settings);

    expect(settings.version).toBe('1.0.1');
    expect(settings._version).toBe(1);
    expect(settings.metadata).toMatchObject({
      last_modified_by: 'migration',
      change_reason: 'Backfill metadata',
      tags: [],
    });
  });

  it('requires a key and restricts metadata environments', async () => {
    const missingKey = new Settings();
    const invalidEnvironment = new Settings({
      key: 'parako_config',
      metadata: { environment: 'qa' },
    });

    await expect(missingKey.validate()).rejects.toMatchObject({
      errors: { key: expect.any(mongoose.Error.ValidatorError) },
    });
    await expect(invalidEnvironment.validate()).rejects.toMatchObject({
      errors: {
        'metadata.environment': expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it('declares the active-key uniqueness and lookup indexes', () => {
    const indexes = Settings.schema.indexes();

    expect(indexes).toContainEqual([
      { key: 1, is_active: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { is_active: true },
        name: 'key_is_active_unique',
      }),
    ]);
    expect(indexes).toContainEqual([
      { 'metadata.environment': 1, is_active: 1 },
      expect.any(Object),
    ]);
    expect(indexes).toContainEqual([{ schema_version: 1 }, expect.any(Object)]);
    expect(indexes).toContainEqual([{ updated_at: -1 }, expect.any(Object)]);
  });

  it('builds active and environment-scoped static queries', () => {
    const activeQuery = { query: 'active' };
    const environmentQuery = { query: 'environment' };
    const findOne = vi
      .spyOn(Settings, 'findOne')
      .mockReturnValue(activeQuery as any);
    const find = vi
      .spyOn(Settings, 'find')
      .mockReturnValue(environmentQuery as any);

    expect((Settings as any).findActiveByKey('parako_config')).toBe(
      activeQuery
    );
    expect(findOne).toHaveBeenCalledWith({
      key: 'parako_config',
      is_active: true,
    });
    expect((Settings as any).findByEnvironment('production')).toBe(
      environmentQuery
    );
    expect(find).toHaveBeenCalledWith({
      'metadata.environment': 'production',
      is_active: true,
    });
  });

  it('sorts the latest-version query by the numeric version counter', () => {
    const latestQuery = { query: 'latest' };
    const sort = vi.fn().mockReturnValue(latestQuery);
    const findOne = vi
      .spyOn(Settings, 'findOne')
      .mockReturnValue({ sort } as any);

    expect((Settings as any).getLatestVersion('parako_config')).toBe(
      latestQuery
    );
    expect(findOne).toHaveBeenCalledWith({ key: 'parako_config' });
    expect(sort).toHaveBeenCalledWith({ _version: -1 });
  });
});
