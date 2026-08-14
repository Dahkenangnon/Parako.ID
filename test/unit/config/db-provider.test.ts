import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyComputedDefaults: vi.fn(),
  connection: { readyState: 0 } as Record<string, unknown>,
  defaultConfig: { application: { title: 'Default' } },
  getDefaultFullConfig: vi.fn(),
  parse: vi.fn(),
  stripBootstrapFields: vi.fn(),
  tenantRun: vi.fn(),
  validateNonBootstrapConfig: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    get connection() {
      return mocks.connection;
    },
  },
}));
vi.mock('../../../src/config/schemas/schema.js', () => ({
  AppConfigSchema: { parse: mocks.parse },
}));
vi.mock('../../../src/config/constants.js', () => ({
  getDefaultFullConfig: mocks.getDefaultFullConfig,
}));
vi.mock('../../../src/config/validation/persistence-validator.js', () => ({
  stripBootstrapFields: mocks.stripBootstrapFields,
  validateNonBootstrapConfig: mocks.validateNonBootstrapConfig,
}));
vi.mock('../../../src/config/computed-fields.js', () => ({
  applyComputedDefaults: mocks.applyComputedDefaults,
}));
vi.mock('../../../src/multi-tenancy/tenant-context.js', () => ({
  DEFAULT_TENANT_ID: 'default',
  tenantContext: { run: mocks.tenantRun },
}));
vi.mock('../../../src/services/settings.service.js', () => ({
  SettingsService: class {
    static readonly MAIN_CONFIG_KEY = 'parako_config';
  },
}));

import { DatabaseConfigProvider } from '../../../src/config/provider/db-provider.js';
import { ConfigurationVersionConflictError } from '../../../src/errors/configuration-version-conflict.error.js';

type SettingsDouble = ReturnType<typeof createSettingsDouble>;

function createSettingsDouble() {
  return {
    configDocumentExists: vi.fn(),
    flushInitialConfiguration: vi.fn(),
    getMainConfiguration: vi.fn(),
    getMainConfigurationLastUpdated: vi.fn(),
    loadAndDecryptConfiguration: vi.fn(),
    saveMainConfigurationWithTransaction: vi.fn(),
  };
}

function createProvider(
  settings: SettingsDouble = createSettingsDouble(),
  adapter = 'sqlite'
) {
  const bootstrapProvider = {
    getConfigValue: vi.fn().mockReturnValue(adapter),
  };
  const provider = new DatabaseConfigProvider(
    settings as never,
    bootstrapProvider as never
  );

  return { bootstrapProvider, provider, settings };
}

function createStoredSettings(overrides: Record<string, unknown> = {}) {
  return {
    application: { title: 'Stored', description: 'Keep me' },
    branding: { companyName: 'Parako' },
    deployment: {
      url: 'https://id.example.test',
      server: { trust_proxy_hops: 1 },
    },
    security: { enabled: true },
    features: { oidc: { enabled: true } },
    oidc: { path: '/oidc/v1' },
    integrations: { urls: { website: 'https://example.test' } },
    notifications: { channels: {} },
    ...overrides,
  };
}

describe('DatabaseConfigProvider core behavior', () => {
  const providers: DatabaseConfigProvider[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    mocks.connection = { readyState: 0 };
    mocks.getDefaultFullConfig.mockReset().mockReturnValue(mocks.defaultConfig);
    mocks.parse.mockReset().mockImplementation(value => value);
    mocks.stripBootstrapFields.mockReset().mockImplementation(value => value);
    mocks.applyComputedDefaults.mockReset().mockImplementation(value => value);
    mocks.validateNonBootstrapConfig.mockReset().mockReturnValue({
      isValid: true,
      bootstrapFieldsFound: [],
    });
    mocks.tenantRun.mockReset().mockImplementation((_tenantId, fn) => fn());
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) {
      provider.cleanup();
    }
    vi.useRealTimers();
  });

  function trackedProvider(
    settings: SettingsDouble = createSettingsDouble(),
    adapter = 'sqlite'
  ) {
    const result = createProvider(settings, adapter);
    providers.push(result.provider);
    return result;
  }

  it('auto-flushes defaults only when no configuration document exists', async () => {
    const { bootstrapProvider, provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(false);
    settings.saveMainConfigurationWithTransaction.mockResolvedValue(undefined);

    expect(provider.getProviderName()).toBe('database');
    expect(provider.isCached()).toBe(false);
    const first = await provider.loadConfiguration();
    const second = await provider.loadConfiguration();

    expect(first).toBe(mocks.defaultConfig);
    expect(second).toBe(first);
    expect(bootstrapProvider.getConfigValue).toHaveBeenCalledWith(
      'storage.adapter',
      'sqlite'
    );
    expect(mocks.parse).toHaveBeenCalledWith(mocks.defaultConfig);
    expect(settings.saveMainConfigurationWithTransaction).toHaveBeenCalledWith(
      mocks.defaultConfig
    );
    expect(settings.configDocumentExists).toHaveBeenCalledOnce();
    expect(provider.isCached()).toBe(true);
  });

  it('loads, shapes, timestamps, caches, clears, and reloads stored config', async () => {
    const { provider, settings } = trackedProvider();
    const firstStored = createStoredSettings();
    const secondStored = createStoredSettings({
      application: { title: 'Reloaded' },
    });
    const firstTimestamp = new Date('2026-08-01T00:00:00.000Z');
    const secondTimestamp = new Date('2026-08-01T01:00:00.000Z');
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(firstStored)
      .mockResolvedValueOnce(secondStored);
    settings.getMainConfigurationLastUpdated
      .mockResolvedValueOnce(firstTimestamp)
      .mockResolvedValueOnce(secondTimestamp);

    const first = await provider.loadConfiguration();
    expect(first).toEqual(firstStored);
    expect(first).not.toHaveProperty('oidc_storage');
    expect(provider.isCached()).toBe(true);

    provider.clearCache();
    expect(provider.isCached()).toBe(false);
    const second = await provider.reloadConfiguration();
    expect(second.application).toEqual({ title: 'Reloaded' });
    expect(settings.configDocumentExists).toHaveBeenCalledTimes(2);
  });

  it('never treats an existing but unreadable document as a first run', async () => {
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration.mockResolvedValue(null);

    await expect(provider.loadConfiguration()).rejects.toThrow(
      'Configuration document exists but failed to load'
    );
    expect(
      settings.saveMainConfigurationWithTransaction
    ).not.toHaveBeenCalled();
  });

  it.each([new Error('decrypt failed'), 'decrypt failed'])(
    'preserves database load failures: %s',
    async failure => {
      const { provider, settings } = trackedProvider();
      settings.configDocumentExists.mockResolvedValue(true);
      settings.loadAndDecryptConfiguration.mockRejectedValue(failure);

      await expect(provider.loadConfiguration()).rejects.toEqual(failure);
      expect(
        settings.saveMainConfigurationWithTransaction
      ).not.toHaveBeenCalled();
    }
  );

  it.each([new Error('save failed'), 'save failed'])(
    'normalizes default auto-flush failures: %s',
    async failure => {
      const { provider, settings } = trackedProvider();
      settings.configDocumentExists.mockResolvedValue(false);
      settings.saveMainConfigurationWithTransaction.mockRejectedValue(failure);

      await expect(provider.loadConfiguration()).rejects.toThrow(
        'Failed to auto-flush default configuration: save failed'
      );
    }
  );

  it('reads only own nested properties and blocks dangerous paths', async () => {
    const inherited = Object.create({ inherited: 'unsafe' });
    inherited.own = 'safe';
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration.mockResolvedValue(
      createStoredSettings({ application: inherited })
    );
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    await provider.loadConfiguration();

    expect(provider.getConfigValue('application.own')).toBe('safe');
    expect(provider.getConfigValue('application.inherited', 'fallback')).toBe(
      'fallback'
    );
    expect(provider.getConfigValue('application.missing', 'fallback')).toBe(
      'fallback'
    );
    expect(
      provider.getConfigValue('application.missing.deep', 'fallback')
    ).toBe('fallback');
    expect(provider.getConfigValue('__proto__.polluted', 'fallback')).toBe(
      'fallback'
    );
    expect(provider.getConfigValue('application.constructor', 'fallback')).toBe(
      'fallback'
    );
    expect(provider.getConfigValue('application.prototype', 'fallback')).toBe(
      'fallback'
    );
  });

  it('requires configuration to be loaded before lookup', () => {
    const { provider } = trackedProvider();

    expect(() => provider.getConfigValue('application.title')).toThrow(
      'Configuration not loaded. Call loadConfiguration() first.'
    );
  });

  it('deep-merges partial updates, strips bootstrap fields, validates, saves, reloads, and notifies', async () => {
    const current = createStoredSettings();
    const reloaded = createStoredSettings({
      application: { title: 'Updated', description: 'Keep me' },
    });
    const sanitized = { marker: 'sanitized' };
    const computed = { marker: 'computed' };
    const validated = { marker: 'validated' };
    const subscriber = vi.fn();
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(reloaded);
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.saveMainConfigurationWithTransaction.mockResolvedValue(undefined);
    mocks.validateNonBootstrapConfig.mockReturnValue({
      isValid: false,
      bootstrapFieldsFound: ['deployment.environment'],
    });
    mocks.stripBootstrapFields.mockReturnValue(sanitized);
    mocks.applyComputedDefaults.mockReturnValue(computed);
    mocks.parse.mockReturnValue(validated);
    provider.subscribe(subscriber);

    const result = await provider.updateConfig(
      { application: { title: 'Updated' } } as never,
      7
    );

    expect(mocks.validateNonBootstrapConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        application: { title: 'Updated', description: 'Keep me' },
      })
    );
    expect(mocks.stripBootstrapFields).toHaveBeenCalledWith(
      expect.objectContaining({
        application: { title: 'Updated', description: 'Keep me' },
      })
    );
    expect(mocks.applyComputedDefaults).toHaveBeenCalledWith(sanitized);
    expect(mocks.parse).toHaveBeenCalledWith(computed);
    expect(settings.saveMainConfigurationWithTransaction).toHaveBeenCalledWith(
      validated,
      undefined,
      undefined,
      7
    );
    expect(subscriber).toHaveBeenCalledWith(
      reloaded,
      undefined,
      'local-update'
    );
    expect(result).toEqual(reloaded);

    provider.unsubscribe(subscriber);
  });

  it('applies an implicit partial update to the latest persisted version', async () => {
    const stale = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: 'logos/dark.svg',
        favicon: 'favicons/current.svg',
      },
    });
    const latest = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: null,
        favicon: 'favicons/current.svg',
      },
    });
    const saved = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: null,
        favicon: null,
      },
    });
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(saved);
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.getMainConfiguration.mockResolvedValue({ _version: 8 });
    settings.saveMainConfigurationWithTransaction.mockResolvedValue(undefined);
    await provider.loadConfiguration();

    const result = await provider.updateConfig({
      branding: { favicon: null },
    });

    expect(settings.saveMainConfigurationWithTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: {
          companyName: 'Parako',
          logoDark: null,
          favicon: null,
        },
      }),
      undefined,
      undefined,
      8
    );
    expect(result).toEqual(saved);
  });

  it('retries an implicit partial update after a concurrent version change', async () => {
    const firstBase = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: 'logos/dark.svg',
        favicon: 'favicons/current.svg',
      },
    });
    const newerBase = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: null,
        favicon: 'favicons/current.svg',
      },
    });
    const saved = createStoredSettings({
      branding: {
        companyName: 'Parako',
        logoDark: null,
        favicon: null,
      },
    });
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(firstBase)
      .mockResolvedValueOnce(newerBase)
      .mockResolvedValueOnce(saved);
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.getMainConfiguration
      .mockResolvedValueOnce({ _version: 8 })
      .mockResolvedValueOnce({ _version: 9 });
    settings.saveMainConfigurationWithTransaction
      .mockRejectedValueOnce(new ConfigurationVersionConflictError(8, 9))
      .mockResolvedValueOnce(undefined);

    const result = await provider.updateConfig({
      branding: { favicon: null },
    });

    expect(settings.saveMainConfigurationWithTransaction).toHaveBeenCalledTimes(
      2
    );
    expect(
      settings.saveMainConfigurationWithTransaction
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        branding: {
          companyName: 'Parako',
          logoDark: null,
          favicon: null,
        },
      }),
      undefined,
      undefined,
      9
    );
    expect(result).toEqual(saved);
  });

  it('bounds implicit partial-update retries and preserves the final conflict', async () => {
    const conflicts = [
      new ConfigurationVersionConflictError(8, 9),
      new ConfigurationVersionConflictError(9, 10),
      new ConfigurationVersionConflictError(10, 11),
    ];
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration.mockResolvedValue(
      createStoredSettings()
    );
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.getMainConfiguration
      .mockResolvedValueOnce({ _version: 8 })
      .mockResolvedValueOnce({ _version: 9 })
      .mockResolvedValueOnce({ _version: 10 });
    settings.saveMainConfigurationWithTransaction
      .mockRejectedValueOnce(conflicts[0])
      .mockRejectedValueOnce(conflicts[1])
      .mockRejectedValueOnce(conflicts[2]);

    await expect(
      provider.updateConfig({ branding: { favicon: null } })
    ).rejects.toBe(conflicts[2]);
    expect(settings.saveMainConfigurationWithTransaction).toHaveBeenCalledTimes(
      3
    );
  });

  it.each([new Error('update failed'), 'update failed'])(
    'normalizes update failures: %s',
    async failure => {
      const { provider, settings } = trackedProvider();
      settings.configDocumentExists.mockRejectedValue(failure);

      await expect(provider.updateConfig({})).rejects.toThrow(
        'Failed to update configuration: update failed'
      );
    }
  );

  it('preserves typed version conflicts from the settings service', async () => {
    const conflict = new ConfigurationVersionConflictError(7, 8);
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration.mockResolvedValue(
      createStoredSettings()
    );
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.saveMainConfigurationWithTransaction.mockRejectedValue(conflict);

    await expect(provider.updateConfig({}, 7)).rejects.toBe(conflict);
  });

  it('isolates subscriber failures from other subscribers', async () => {
    const { provider, settings } = trackedProvider();
    const throwingSubscriber = vi.fn(() => {
      throw new Error('subscriber failed');
    });
    const healthySubscriber = vi.fn();
    provider.subscribe(throwingSubscriber);
    provider.subscribe(healthySubscriber);
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(createStoredSettings())
      .mockResolvedValueOnce(createStoredSettings());
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.saveMainConfigurationWithTransaction.mockResolvedValue(undefined);

    await provider.updateConfig({});

    expect(throwingSubscriber).toHaveBeenCalledOnce();
    expect(healthySubscriber).toHaveBeenCalledOnce();
  });

  it('isolates non-Error subscriber failures', async () => {
    const { provider, settings } = trackedProvider();
    provider.subscribe(() => {
      throw 'subscriber failed';
    });
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(createStoredSettings())
      .mockResolvedValueOnce(createStoredSettings());
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());
    settings.saveMainConfigurationWithTransaction.mockResolvedValue(undefined);

    await expect(provider.updateConfig({})).resolves.toBeDefined();
  });

  it('reports database availability without leaking errors', async () => {
    const { provider, settings } = trackedProvider();
    settings.getMainConfiguration.mockResolvedValue({});
    await expect(provider.isAvailable()).resolves.toBe(true);

    settings.getMainConfiguration.mockRejectedValueOnce(new Error('offline'));
    await expect(provider.isAvailable()).resolves.toBe(false);

    settings.getMainConfiguration.mockRejectedValueOnce('offline');
    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it('uses a change stream for replica-set topology and watches the real config key', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const changeStream = {
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
        return changeStream;
      }),
    };
    const collection = {
      watch: vi.fn().mockReturnValue(changeStream),
    };
    const getCollection = vi.fn().mockReturnValue(collection);
    mocks.connection = {
      readyState: 1,
      client: {
        topology: {
          constructor: { name: 'Topology' },
          description: { type: 'ReplicaSetWithPrimary' },
        },
      },
      db: { collection: getCollection },
    };

    trackedProvider(createSettingsDouble(), 'mongodb');

    expect(getCollection).toHaveBeenCalledWith('settings');
    expect(collection.watch).toHaveBeenCalledWith(
      [
        {
          $match: {
            operationType: { $in: ['insert', 'update', 'replace'] },
            'fullDocument.key': 'parako_config',
          },
        },
      ],
      { fullDocument: 'updateLookup' }
    );
    expect([...handlers.keys()]).toEqual(['change', 'error', 'close']);
  });

  it('reloads and notifies when polling detects a newer configuration', async () => {
    const oldTimestamp = new Date('2026-08-01T00:00:00.000Z');
    const newTimestamp = new Date('2026-08-01T01:00:00.000Z');
    const original = createStoredSettings();
    const updated = createStoredSettings({
      application: { title: 'Polled update' },
    });
    const subscriber = vi.fn();
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(updated);
    settings.getMainConfigurationLastUpdated
      .mockResolvedValueOnce(oldTimestamp)
      .mockResolvedValueOnce(newTimestamp)
      .mockResolvedValueOnce(newTimestamp);
    provider.subscribe(subscriber);
    await provider.loadConfiguration();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({ application: { title: 'Polled update' } }),
      undefined
    );
    expect(settings.loadAndDecryptConfiguration).toHaveBeenCalledTimes(2);
  });

  it('keeps cached configuration when polling has no comparable/new timestamp or timestamp lookup fails', async () => {
    const timestamp = new Date('2026-08-01T00:00:00.000Z');
    const { provider, settings } = trackedProvider();
    settings.configDocumentExists.mockResolvedValue(true);
    settings.loadAndDecryptConfiguration.mockResolvedValue(
      createStoredSettings()
    );
    settings.getMainConfigurationLastUpdated
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(timestamp)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('timestamp offline'))
      .mockRejectedValueOnce('timestamp offline');
    await provider.loadConfiguration();

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(settings.loadAndDecryptConfiguration).toHaveBeenCalledOnce();
    expect(provider.isCached()).toBe(true);
  });

  it.each([new Error('reload failed'), 'reload failed'])(
    'notifies polling reload failures without dropping the process: %s',
    async failure => {
      const oldTimestamp = new Date('2026-08-01T00:00:00.000Z');
      const newTimestamp = new Date('2026-08-01T01:00:00.000Z');
      const subscriber = vi.fn();
      const { provider, settings } = trackedProvider();
      settings.configDocumentExists
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(failure);
      settings.loadAndDecryptConfiguration.mockResolvedValue(
        createStoredSettings()
      );
      settings.getMainConfigurationLastUpdated
        .mockResolvedValueOnce(oldTimestamp)
        .mockResolvedValueOnce(newTimestamp);
      provider.subscribe(subscriber);
      await provider.loadConfiguration();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(subscriber).toHaveBeenCalledWith(null, expect.any(Error));
      expect(subscriber.mock.calls[0]?.[1]?.message).toBe('reload failed');
    }
  );

  it('handles change-stream reload success, reload failure, stream error, and close', async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const changeStream = {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
        handlers.set(event, handler);
        return changeStream;
      }),
    };
    const collection = { watch: vi.fn().mockReturnValue(changeStream) };
    mocks.connection = {
      readyState: 1,
      client: {
        topology: { description: { type: 'Sharded' } },
      },
      db: { collection: vi.fn().mockReturnValue(collection) },
    };
    const subscriber = vi.fn();
    const { provider, settings } = trackedProvider(
      createSettingsDouble(),
      'mongodb'
    );
    provider.subscribe(subscriber);
    settings.configDocumentExists
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce('stream reload failed')
      .mockRejectedValueOnce(new Error('stream reload error'));
    settings.loadAndDecryptConfiguration.mockResolvedValueOnce(
      createStoredSettings({ application: { title: 'Stream update' } })
    );
    settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());

    await handlers.get('change')?.({ operationType: 'update' } as never);
    await handlers.get('change')?.({ operationType: 'replace' } as never);
    await handlers.get('change')?.({ operationType: 'replace' } as never);

    expect(subscriber).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ application: { title: 'Stream update' } }),
      undefined
    );
    expect(subscriber).toHaveBeenNthCalledWith(2, null, expect.any(Error));
    expect(subscriber.mock.calls[1]?.[1]?.message).toBe('stream reload failed');
    expect(subscriber).toHaveBeenNthCalledWith(
      3,
      null,
      expect.objectContaining({ message: 'stream reload error' })
    );

    handlers.get('error')?.(new Error('stream failed') as never);
    handlers.get('error')?.(new Error('stream failed again') as never);
    handlers.get('close')?.();
    await Promise.resolve();

    expect(changeStream.close).toHaveBeenCalledOnce();
  });

  it.each([
    { readyState: 0 },
    { readyState: 1 },
    {
      readyState: 1,
      client: { topology: { description: { type: 'Single' } } },
    },
  ])(
    'falls back to polling for unsupported MongoDB connection: %j',
    connection => {
      mocks.connection = connection;

      trackedProvider(createSettingsDouble(), 'mongodb');

      expect(vi.getTimerCount()).toBe(1);
    }
  );

  it('falls back when topology inspection or stream initialization fails', async () => {
    mocks.connection = {
      readyState: 1,
      get client() {
        throw new Error('topology unavailable');
      },
    };
    trackedProvider(createSettingsDouble(), 'mongodb');
    expect(vi.getTimerCount()).toBe(1);

    mocks.connection = {
      readyState: 1,
      get client() {
        throw 'topology unavailable';
      },
    };
    trackedProvider(createSettingsDouble(), 'mongodb');
    expect(vi.getTimerCount()).toBe(2);

    mocks.connection = {
      readyState: 1,
      client: { topology: { constructor: { name: 'ReplicaSet' } } },
    };
    trackedProvider(createSettingsDouble(), 'mongodb');
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(3);

    mocks.connection = {
      readyState: 1,
      client: { topology: { constructor: { name: 'ReplicaSet' } } },
      db: {
        collection: vi.fn(() => {
          throw 'watch unavailable';
        }),
      },
    };
    trackedProvider(createSettingsDouble(), 'mongodb');
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(4);
  });

  it('contains stream-close failures during cleanup', async () => {
    const changeStream = {
      close: vi.fn().mockRejectedValue(new Error('cleanup close failed')),
      on: vi.fn().mockReturnThis(),
    };
    mocks.connection = {
      readyState: 1,
      client: { topology: { description: { type: 'Sharded' } } },
      db: {
        collection: vi.fn().mockReturnValue({
          watch: vi.fn().mockReturnValue(changeStream),
        }),
      },
    };
    const { provider } = trackedProvider(createSettingsDouble(), 'mongodb');

    provider.cleanup();
    await Promise.resolve();

    expect(changeStream.close).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      'Error closing change stream:',
      'cleanup close failed'
    );
  });

  it('flushes an initial config inside the default tenant context', async () => {
    const decrypted = createStoredSettings();
    const { provider, settings } = trackedProvider();
    settings.flushInitialConfiguration.mockResolvedValue({ id: 'saved' });
    settings.loadAndDecryptConfiguration.mockResolvedValue(decrypted);

    const result = await provider.flushInitial();

    expect(mocks.tenantRun).toHaveBeenCalledWith(
      'default',
      expect.any(Function)
    );
    expect(settings.flushInitialConfiguration).toHaveBeenCalledWith(
      'system',
      'Initial configuration flush'
    );
    expect(result).toEqual(decrypted);
    expect(result).not.toHaveProperty('oidc_storage');
    expect(provider.isCached()).toBe(true);
  });

  it.each([null, { id: 'saved' }])(
    'loads existing config when initial flush does not yield decrypted data: %j',
    async savedConfig => {
      const existing = createStoredSettings();
      const { provider, settings } = trackedProvider();
      settings.flushInitialConfiguration.mockResolvedValue(savedConfig);
      if (savedConfig) {
        settings.loadAndDecryptConfiguration
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing);
      } else {
        settings.loadAndDecryptConfiguration.mockResolvedValue(existing);
      }
      settings.configDocumentExists.mockResolvedValue(true);
      settings.getMainConfigurationLastUpdated.mockResolvedValue(new Date());

      await expect(provider.flushInitial()).resolves.toEqual(existing);
    }
  );

  it.each([new Error('flush failed'), 'flush failed'])(
    'normalizes initial flush failures: %s',
    async failure => {
      const { provider, settings } = trackedProvider();
      settings.flushInitialConfiguration.mockRejectedValue(failure);

      await expect(provider.flushInitial()).rejects.toThrow(
        'Failed to flush initial configuration: flush failed'
      );
    }
  );
});
