import { describe, it, expect, vi } from 'vitest';
import type { IFileSystemUtils } from '../../../../src/di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../../../src/di/interfaces/config-manager.interface.js';
import { FileKeyStore } from '../../../../src/oidc/key-store/file-key-store.js';

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

function createMockConfigManager(
  algorithms: Array<'RS256' | 'ES256' | 'EdDSA'> = ['RS256', 'ES256', 'EdDSA']
): IConfigManager {
  return {
    getConfig: vi.fn().mockReturnValue({
      security: {
        key_store: {
          type: 'file',
          rotation_interval_days: 90,
          overlap_window_seconds: 7200,
          algorithms,
        },
      },
    }),
    isLoaded: vi.fn().mockReturnValue(true),
  } as any;
}

describe('FileKeyStore', () => {
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

  it('does not expose its internal key array to callers', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    const firstRead = await store.getJWKS();
    firstRead.keys.length = 0;

    await expect(store.getJWKS()).resolves.toMatchObject({
      keys: [expect.objectContaining({ kid: 'test-kid-rs256' })],
    });
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

  it('preserves the filesystem failure as the read error cause', async () => {
    const fsUtils = createMockFileSystemUtils();
    const failure = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    (fsUtils.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw failure;
      }
    );
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager()
    );

    await expect(store.initialize()).rejects.toMatchObject({
      cause: failure,
      message:
        'Failed to read JWKS file at /test/project/runtime/jwks/jwks.json. Generate keys with: pnpm keys generate --file',
    });
  });

  it('should throw on initialize if JWKS has no keys', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(JSON.stringify({ keys: [] })),
      createMockLogger(),
      createMockConfigManager()
    );

    await expect(store.initialize()).rejects.toThrow();
  });

  it('rejects a JSON null document with the actionable no-keys error', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils('null'),
      createMockLogger(),
      createMockConfigManager()
    );

    await expect(store.initialize()).rejects.toThrow(
      'JWKS file contains no keys. Generate keys with: pnpm keys generate --file'
    );
  });

  it.each([null, 'not-an-object', []])(
    'rejects malformed key entry %j during initialization',
    async invalidKey => {
      const store = new FileKeyStore(
        createMockFileSystemUtils(JSON.stringify({ keys: [invalidKey] })),
        createMockLogger(),
        createMockConfigManager()
      );

      await expect(store.initialize()).rejects.toThrow(
        'JWKS file contains an invalid key at index 0'
      );
    }
  );

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
    expect(keys[0].createdAt).toBeInstanceOf(Date);
  });

  it('uses safe metadata defaults for minimally described keys', async () => {
    const store = new FileKeyStore(
      createMockFileSystemUtils(JSON.stringify({ keys: [{ kty: 'EC' }, {}] })),
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    await expect(store.listKeys()).resolves.toEqual([
      expect.objectContaining({
        alg: 'EC',
        kid: 'unknown',
        use: 'sig',
      }),
      expect.objectContaining({
        alg: 'unknown',
        kid: 'unknown',
        use: 'sig',
      }),
    ]);
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

  it('refuses to overwrite the JWKS file when no signing algorithm is configured', async () => {
    const fsUtils = createMockFileSystemUtils();
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager([])
    );

    await expect(store.rotate()).rejects.toThrow(
      'At least one signing algorithm is required to rotate file-based keys'
    );

    expect(fsUtils.readFileSync).not.toHaveBeenCalled();
    expect(fsUtils.saveFile).not.toHaveBeenCalled();
  });

  it('rotates the configured algorithms, backs up the current file, and updates the in-memory keys', async () => {
    const existingJwks = JSON.stringify(sampleJWKS);
    const fsUtils = createMockFileSystemUtils(existingJwks);
    const logger = createMockLogger();
    const store = new FileKeyStore(
      fsUtils,
      logger,
      createMockConfigManager(['ES256'])
    );

    await store.rotate();

    const saveFile = fsUtils.saveFile as ReturnType<typeof vi.fn>;
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(saveFile.mock.calls[0]).toEqual([
      expect.stringMatching(
        /^\/test\/project\/runtime\/jwks\/jwks\.json\.backup-/
      ),
      existingJwks,
    ]);
    expect(fsUtils.ensureDir).toHaveBeenCalledWith(
      '/test/project/runtime/jwks'
    );
    expect(saveFile.mock.calls[1][0]).toBe(
      '/test/project/runtime/jwks/jwks.json'
    );

    const persisted = JSON.parse(saveFile.mock.calls[1][1] as string) as {
      keys: Array<Record<string, unknown>>;
    };
    expect(persisted.keys).toEqual([
      expect.objectContaining({
        alg: 'ES256',
        d: expect.any(String),
        kid: expect.any(String),
        use: 'sig',
      }),
    ]);
    await expect(store.getJWKS()).resolves.toEqual(persisted);
    await expect(store.getPublicJWKS()).resolves.toEqual({
      keys: [expect.not.objectContaining({ d: expect.anything() })],
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Rotated keys: 1 new keys written to file'
    );
  });

  it('continues rotation when no existing file can be backed up', async () => {
    const fsUtils = createMockFileSystemUtils();
    (fsUtils.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
    );
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager(['ES256'])
    );

    await expect(store.rotate()).resolves.toBeUndefined();

    expect(fsUtils.saveFile).toHaveBeenCalledOnce();
    expect(fsUtils.saveFile).toHaveBeenCalledWith(
      '/test/project/runtime/jwks/jwks.json',
      expect.any(String)
    );
  });

  it('aborts rotation when the existing JWKS file cannot be read', async () => {
    const fsUtils = createMockFileSystemUtils();
    const failure = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    (fsUtils.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw failure;
      }
    );
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager(['ES256'])
    );

    await expect(store.rotate()).rejects.toMatchObject({
      cause: failure,
      message: expect.stringContaining('rotation aborted'),
    });
    expect(fsUtils.saveFile).not.toHaveBeenCalled();
  });

  it('aborts rotation when the existing JWKS backup cannot be written', async () => {
    const fsUtils = createMockFileSystemUtils();
    const failure = new Error('backup volume unavailable');
    (fsUtils.saveFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      failure
    );
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager(['ES256'])
    );

    await expect(store.rotate()).rejects.toMatchObject({
      cause: failure,
      message: expect.stringContaining('rotation aborted'),
    });
    expect(fsUtils.saveFile).toHaveBeenCalledOnce();
    expect(fsUtils.saveFile).not.toHaveBeenCalledWith(
      '/test/project/runtime/jwks/jwks.json',
      expect.any(String)
    );
  });

  it('uses the supported default algorithms when partial configuration omits them', async () => {
    const fsUtils = createMockFileSystemUtils();
    const configManager = {
      getConfig: vi.fn().mockReturnValue({ security: { key_store: {} } }),
    } as unknown as IConfigManager;
    const store = new FileKeyStore(fsUtils, createMockLogger(), configManager);

    await store.rotate();

    const saveFile = fsUtils.saveFile as ReturnType<typeof vi.fn>;
    const persisted = JSON.parse(saveFile.mock.calls[1][1] as string) as {
      keys: Array<{ alg: string }>;
    };
    expect(persisted.keys.map(key => key.alg)).toEqual([
      'RS256',
      'ES256',
      'EdDSA',
    ]);
  });

  it('reports file-store lifecycle operations as no-ops', async () => {
    const logger = createMockLogger();
    const store = new FileKeyStore(
      createMockFileSystemUtils(),
      logger,
      createMockConfigManager()
    );

    await expect(store.promoteKeys()).resolves.toBe(0);
    await expect(store.retireExpiredKeys()).resolves.toBe(0);

    expect(logger.debug).toHaveBeenCalledWith(
      'promoteKeys is a no-op for FileKeyStore'
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'retireExpiredKeys is a no-op for FileKeyStore'
    );
  });

  it('persists removal when one file-backed key is retired', async () => {
    const content = JSON.stringify({
      keys: [
        ...sampleJWKS.keys,
        { ...sampleJWKS.keys[0], kid: 'replacement-key' },
      ],
    });
    const fsUtils = createMockFileSystemUtils(content);
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    await expect(store.retireKey('test-kid-rs256')).resolves.toBe(true);

    expect(fsUtils.saveFile).toHaveBeenCalledWith(
      '/test/project/runtime/jwks/jwks.json',
      expect.any(String)
    );
    const persisted = JSON.parse(
      (fsUtils.saveFile as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[1] as string
    );
    expect(persisted.keys).toEqual([
      expect.objectContaining({ kid: 'replacement-key' }),
    ]);
    await expect(store.listKeys()).resolves.toEqual([
      expect.objectContaining({ kid: 'replacement-key' }),
    ]);
  });

  it('refuses to retire the last file-backed signing key', async () => {
    const fsUtils = createMockFileSystemUtils();
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    await expect(store.retireKey('test-kid-rs256')).rejects.toThrow(
      'last promoted active signing key'
    );
    expect(fsUtils.saveFile).not.toHaveBeenCalled();
  });

  it('reports no change when a file-backed kid does not exist', async () => {
    const fsUtils = createMockFileSystemUtils();
    const store = new FileKeyStore(
      fsUtils,
      createMockLogger(),
      createMockConfigManager()
    );
    await store.initialize();

    await expect(store.retireKey('missing-kid')).resolves.toBe(false);
    expect(fsUtils.saveFile).not.toHaveBeenCalled();
  });
});
