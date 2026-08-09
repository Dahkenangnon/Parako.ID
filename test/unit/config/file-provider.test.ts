import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  defaults: { source: 'defaults' },
  getDefaultFullConfig: vi.fn(),
  mergeConfig: vi.fn(),
  parse: vi.fn(),
  specs: { marker: 'specs' },
  validateEnvVars: vi.fn(),
}));

vi.mock('../../../src/config/constants.js', () => ({
  getDefaultFullConfig: mocks.getDefaultFullConfig,
}));
vi.mock('../../../src/utils/config-merge.js', () => ({
  mergeConfig: mocks.mergeConfig,
}));
vi.mock('../../../src/utils/env-validator.js', () => ({
  PARAKO_ENV_SPECS: mocks.specs,
  validateEnvVars: mocks.validateEnvVars,
}));
vi.mock('../../../src/config/schemas/schema.js', () => ({
  AppConfigSchema: { parse: mocks.parse },
}));

import { FileConfigProvider } from '../../../src/config/provider/file-provider.js';

const createProvider = () => {
  const reader = { readAppConfig: vi.fn() };
  return {
    provider: new FileConfigProvider(reader as never),
    reader,
  };
};

describe('FileConfigProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getDefaultFullConfig.mockReset().mockReturnValue(mocks.defaults);
    mocks.mergeConfig.mockReset();
    mocks.parse.mockReset();
    mocks.validateEnvVars.mockReset();
  });

  it('preflights, reads, merges, validates, and caches configuration', async () => {
    const { provider, reader } = createProvider();
    const raw = { application: { title: 'Custom' } };
    const merged = { source: 'merged' };
    const validated = { application: { title: 'Validated' } };
    reader.readAppConfig.mockReturnValue(raw);
    mocks.mergeConfig.mockReturnValue(merged);
    mocks.parse.mockReturnValue(validated);

    expect(provider.isCached()).toBe(false);
    const first = await provider.loadConfiguration();
    const second = await provider.loadConfiguration();

    expect(first).toBe(validated);
    expect(second).toBe(first);
    expect(mocks.validateEnvVars).toHaveBeenCalledOnce();
    expect(mocks.validateEnvVars).toHaveBeenCalledWith(mocks.specs);
    expect(reader.readAppConfig).toHaveBeenCalledOnce();
    expect(mocks.mergeConfig).toHaveBeenCalledWith(mocks.defaults, raw);
    expect(mocks.parse).toHaveBeenCalledWith(merged);
    expect(provider.isCached()).toBe(true);
  });

  it('reloads after clearing and cleanup invalidates the cache', async () => {
    const { provider, reader } = createProvider();
    reader.readAppConfig
      .mockReturnValueOnce({ version: 1 })
      .mockReturnValueOnce({ version: 2 });
    mocks.mergeConfig.mockImplementation((_defaults, raw) => raw);
    mocks.parse.mockImplementation(value => value);

    expect(
      ((await provider.loadConfiguration()) as unknown as { version: number })
        .version
    ).toBe(1);
    expect(
      ((await provider.reloadConfiguration()) as unknown as { version: number })
        .version
    ).toBe(2);
    expect(reader.readAppConfig).toHaveBeenCalledTimes(2);

    provider.cleanup();
    expect(provider.isCached()).toBe(false);
  });

  it('reports availability according to whether the reader can load a file', async () => {
    const { provider, reader } = createProvider();
    reader.readAppConfig.mockReturnValue({});
    await expect(provider.isAvailable()).resolves.toBe(true);

    reader.readAppConfig.mockImplementation(() => {
      throw new Error('missing file');
    });
    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it('normalizes validation, ordinary, and non-Error load failures', async () => {
    const { provider, reader } = createProvider();
    reader.readAppConfig.mockReturnValue({});
    mocks.mergeConfig.mockReturnValue({});

    const validationError = new Error('invalid config');
    validationError.name = 'ZodError';
    mocks.parse.mockImplementationOnce(() => {
      throw validationError;
    });
    await expect(provider.loadConfiguration()).rejects.toThrow(
      'File configuration validation failed: invalid config'
    );

    mocks.parse.mockImplementationOnce(() => {
      throw new Error('parse failed');
    });
    await expect(provider.loadConfiguration()).rejects.toThrow(
      'Failed to load file configuration: parse failed'
    );

    mocks.parse.mockImplementationOnce(() => {
      throw new String('string failure');
    });
    await expect(provider.loadConfiguration()).rejects.toThrow(
      'Failed to load file configuration: string failure'
    );
  });

  it('requires a load before lookup and reads only own nested properties', async () => {
    const { provider, reader } = createProvider();
    expect(() => provider.getConfigValue('application.title')).toThrow(
      'Configuration not loaded'
    );

    const validated = { application: { title: 'Parako' }, storage: {} };
    reader.readAppConfig.mockReturnValue({});
    mocks.mergeConfig.mockReturnValue({});
    mocks.parse.mockReturnValue(validated);
    await provider.loadConfiguration();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(provider.getConfigValue('application.title')).toBe('Parako');
    expect(provider.getConfigValue('application.missing', 'fallback')).toBe(
      'fallback'
    );
    expect(provider.getConfigValue('storage.mongodb.uri')).toBeUndefined();
    expect(provider.getConfigValue('__proto__.polluted', 'safe')).toBe('safe');
    expect(provider.getConfigValue('toString', 'safe')).toBe('safe');
    expect(warning).toHaveBeenCalledTimes(4);
  });

  it('identifies itself and rejects file writes and initial flushes', async () => {
    const { provider } = createProvider();

    expect(provider.getProviderName()).toBe('file');
    await expect(provider.updateConfig?.({})).rejects.toThrow(
      'File configuration cannot be updated'
    );
    await expect(provider.flushInitial?.()).rejects.toThrow(
      'File configuration does not support initial flush'
    );
  });
});
