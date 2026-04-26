import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IFileSystemUtils } from '../../../../src/di/interfaces/file-system-utils.interface';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface';
import type { IConfigManager } from '../../../../src/di/interfaces/config-manager.interface';

// Sample JWKS with one RS256 key
const sampleJWKS = {
  keys: [
    {
      kty: 'RSA',
      n: 'test-n',
      e: 'AQAB',
      d: 'test-d',
      p: 'test-p',
      q: 'test-q',
      dp: 'test-dp',
      dq: 'test-dq',
      qi: 'test-qi',
      use: 'sig',
      kid: 'test-kid-rs256',
      alg: 'RS256',
    },
  ],
};

function createMockLogger(): ILogger {
  return {
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
  } as any;
}

function createMockFileSystemUtils(jwksContent?: string): IFileSystemUtils {
  return {
    rootDir: '/test',
    getProjectDir: vi.fn().mockReturnValue('/test/project'),
    readFileSync: vi
      .fn()
      .mockReturnValue(jwksContent ?? JSON.stringify(sampleJWKS)),
    fileExists: vi.fn().mockResolvedValue(true),
    saveFile: vi.fn().mockResolvedValue(true),
    ensureDir: vi.fn().mockReturnValue(true),
    join: vi.fn((...paths: string[]) => paths.join('/')),
    getPackageJson: vi.fn(),
    getEnvFilePath: vi.fn(),
    getLogDir: vi.fn(),
    createDir: vi.fn(),
    removeFile: vi.fn(),
    removeDir: vi.fn(),
    readFile: vi.fn(),
  } as any;
}

function createMockConfigManager(): IConfigManager {
  return {
    getConfig: vi.fn().mockReturnValue({
      security: {
        key_store: {
          type: 'file',
          rotation_interval_days: 90,
          overlap_window_seconds: 7200,
          algorithms: ['RS256', 'ES256', 'EdDSA'],
        },
      },
    }),
    getConfigSection: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(true),
  } as any;
}

describe('FileKeyStore', () => {
  let FileKeyStore: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/oidc/key-store/file-key-store');
    FileKeyStore = mod.FileKeyStore;
  });

  it('should load JWKS from file on initialize', async () => {
    const fsUtils = createMockFileSystemUtils();
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager()
    );

    await store.initialize();

    expect(fsUtils.readFileSync).toHaveBeenCalled();
  });

  it('should return keys from getJWKS after initialize', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    const jwks = await store.getJWKS();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe('test-kid-rs256');
  });

  it('should return public-only keys from getPublicJWKS (no private fields)', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    const jwks = await store.getPublicJWKS();
    expect(jwks.keys).toHaveLength(1);
    // RSA private fields should be stripped
    const key = jwks.keys[0] as Record<string, unknown>;
    expect(key.d).toBeUndefined();
    expect(key.p).toBeUndefined();
    expect(key.q).toBeUndefined();
    expect(key.dp).toBeUndefined();
    expect(key.dq).toBeUndefined();
    expect(key.qi).toBeUndefined();
    // Public fields should remain
    expect(key.kty).toBe('RSA');
    expect(key.n).toBe('test-n');
    expect(key.e).toBe('AQAB');
    expect(key.kid).toBe('test-kid-rs256');
  });

  it('should throw on initialize if JWKS file is invalid', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils('not-json'),
      createMockLogger(),
      createMockConfigManager()
    );

    await expect(store.initialize()).rejects.toThrow();
  });

  it('should throw on initialize if JWKS has no keys', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(JSON.stringify({ keys: [] })),
      createMockLogger(),
      createMockConfigManager()
    );

    await expect(store.initialize()).rejects.toThrow();
  });

  it('should list keys with metadata', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    const keys = await store.listKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].kid).toBe('test-kid-rs256');
    expect(keys[0].status).toBe('active');
    expect(keys[0].tenantId).toBe('default');
  });

  it('needsRotation should return false (file store does not auto-rotate)', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    const needs = await store.needsRotation();
    expect(needs).toBe(false);
  });
});
