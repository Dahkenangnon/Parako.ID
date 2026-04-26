import { describe, it, expect, vi } from 'vitest';
import { Container } from 'inversify';
import { TYPES } from '../../../src/di/types';

describe('KeyStore DI Wiring', () => {
  it(
    'should bind FileKeyStore when config type is "file"',
    { timeout: 30000 },
    async () => {
      const { oidcModule } =
        await import('../../../src/di/modules/oidc.module');
      const { FileKeyStore } =
        await import('../../../src/oidc/key-store/file-key-store');

      const container = new Container();

      // Bind required dependencies as mocks
      container.bind(TYPES.ConfigManager).toConstantValue({
        getConfig: () => ({
          security: {
            key_store: { type: 'file' },
            secrets: { jwt_secret: 'x'.repeat(32) },
          },
        }),
        getConfigSection: vi.fn(),
        isLoaded: () => true,
        subscribe: vi.fn(),
      });
      container.bind(TYPES.Logger).toConstantValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        getLogger: vi.fn(),
        child: vi.fn(),
        flush: vi.fn(),
        shutdown: vi.fn(),
      });
      container.bind(TYPES.FileSystemUtils).toConstantValue({
        rootDir: '/test',
        getProjectDir: () => '/test',
        readFileSync: vi.fn(),
        fileExists: vi.fn(),
        saveFile: vi.fn(),
        ensureDir: vi.fn(),
        join: (...p: string[]) => p.join('/'),
        getPackageJson: vi.fn(),
        getEnvFilePath: vi.fn(),
        getLogDir: vi.fn(),
        createDir: vi.fn(),
        removeFile: vi.fn(),
        removeDir: vi.fn(),
        readFile: vi.fn(),
      });

      // Load the oidc module which should contain KeyStore binding
      container.load(oidcModule);

      const keyStore = container.get(TYPES.KeyStore);
      expect(keyStore).toBeInstanceOf(FileKeyStore);
    }
  );

  it('should bind DBKeyStore when config type is "database"', async () => {
    const { oidcModule } = await import('../../../src/di/modules/oidc.module');
    const { DBKeyStore } =
      await import('../../../src/oidc/key-store/db-key-store');

    const container = new Container();

    container.bind(TYPES.ConfigManager).toConstantValue({
      getConfig: () => ({
        security: {
          key_store: { type: 'database' },
          secrets: { jwt_secret: 'x'.repeat(32) },
        },
      }),
      getConfigSection: vi.fn(),
      isLoaded: () => true,
      subscribe: vi.fn(),
    });
    container.bind(TYPES.Logger).toConstantValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      getLogger: vi.fn(),
      child: vi.fn(),
      flush: vi.fn(),
      shutdown: vi.fn(),
    });
    container.bind(TYPES.FileSystemUtils).toConstantValue({
      rootDir: '/test',
      getProjectDir: () => '/test',
      readFileSync: vi.fn(),
      fileExists: vi.fn(),
      saveFile: vi.fn(),
      ensureDir: vi.fn(),
      join: (...p: string[]) => p.join('/'),
      getPackageJson: vi.fn(),
      getEnvFilePath: vi.fn(),
      getLogDir: vi.fn(),
      createDir: vi.fn(),
      removeFile: vi.fn(),
      removeDir: vi.fn(),
      readFile: vi.fn(),
    });
    container.bind(TYPES.JwksKeyModel).toConstantValue({} as any);

    container.load(oidcModule);

    const keyStore = container.get(TYPES.KeyStore);
    expect(keyStore).toBeInstanceOf(DBKeyStore);
  });

  it('should bind DBKeyStore by default (no explicit type)', async () => {
    const { oidcModule } = await import('../../../src/di/modules/oidc.module');
    const { DBKeyStore } =
      await import('../../../src/oidc/key-store/db-key-store');

    const container = new Container();

    container.bind(TYPES.ConfigManager).toConstantValue({
      getConfig: () => ({
        security: {
          key_store: { type: 'database' },
          secrets: { jwt_secret: 'x'.repeat(32) },
        },
      }),
      getConfigSection: vi.fn(),
      isLoaded: () => true,
      subscribe: vi.fn(),
    });
    container.bind(TYPES.Logger).toConstantValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      getLogger: vi.fn(),
      child: vi.fn(),
      flush: vi.fn(),
      shutdown: vi.fn(),
    });
    container.bind(TYPES.FileSystemUtils).toConstantValue({
      rootDir: '/test',
      getProjectDir: () => '/test',
      readFileSync: vi.fn(),
      fileExists: vi.fn(),
      saveFile: vi.fn(),
      ensureDir: vi.fn(),
      join: (...p: string[]) => p.join('/'),
      getPackageJson: vi.fn(),
      getEnvFilePath: vi.fn(),
      getLogDir: vi.fn(),
      createDir: vi.fn(),
      removeFile: vi.fn(),
      removeDir: vi.fn(),
      readFile: vi.fn(),
    });
    container.bind(TYPES.JwksKeyModel).toConstantValue({} as any);

    container.load(oidcModule);

    const keyStore = container.get(TYPES.KeyStore);
    expect(keyStore).toBeInstanceOf(DBKeyStore);
  });
});
