import { describe, it, expect, vi } from 'vitest';
import { Container } from 'inversify';
import { oidcModule } from '../../../src/di/modules/oidc.module.js';
import { TYPES } from '../../../src/di/types.js';
import { DBKeyStore } from '../../../src/oidc/key-store/db-key-store.js';
import { FileKeyStore } from '../../../src/oidc/key-store/file-key-store.js';

describe('KeyStore DI Wiring', () => {
  it(
    'should bind FileKeyStore when config type is "file"',
    { timeout: 30000 },
    async () => {
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
    container
      .bind(TYPES.AdapterBundle)
      .toConstantValue({ kind: 'mongoose' } as any);
    container.bind(TYPES.JwksKeyModel).toConstantValue({} as any);

    container.load(oidcModule);

    const keyStore = container.get(TYPES.KeyStore);
    expect(keyStore).toBeInstanceOf(DBKeyStore);
  });

  it('uses Prisma JWKS persistence without requiring a Mongoose model', async () => {
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
    container
      .bind(TYPES.AdapterBundle)
      .toConstantValue({ kind: 'prisma' } as any);
    container.bind(TYPES.PrismaClient).toConstantValue({
      jwksKey: { count: vi.fn().mockResolvedValue(1) },
    } as any);

    container.load(oidcModule);

    const keyStore = container.get<any>(TYPES.KeyStore);
    await expect(keyStore.initialize()).resolves.toBeUndefined();
  });

  it('should bind DBKeyStore by default (no explicit type)', async () => {
    const container = new Container();

    container.bind(TYPES.ConfigManager).toConstantValue({
      getConfig: () => ({
        security: {
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
    container
      .bind(TYPES.AdapterBundle)
      .toConstantValue({ kind: 'mongoose' } as any);
    container.bind(TYPES.JwksKeyModel).toConstantValue({} as any);

    container.load(oidcModule);

    const keyStore = container.get(TYPES.KeyStore);
    expect(keyStore).toBeInstanceOf(DBKeyStore);
  });
});
