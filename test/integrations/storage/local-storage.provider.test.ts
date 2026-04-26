import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock inversify decorators before importing the provider
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => (_target: any, _key: any) => {},
}));

import { LocalStorageProvider } from '../../../src/storage/local-storage.provider.js';

function createProvider(basePath: string) {
  const fileSystemUtils = {
    rootDir: basePath,
    getPackageJson: vi.fn(),
    getEnvFilePath: vi.fn(),
    getProjectDir: vi.fn(),
    getLogDir: vi.fn(),
    createDir: vi.fn(),
    removeFile: vi.fn(),
    removeDir: vi.fn(),
    fileExists: vi.fn(),
    saveFile: vi.fn(),
    readFile: vi.fn(),
    readFileSync: vi.fn(),
    ensureDir: vi.fn(),
    join: vi.fn((...args: string[]) => path.join(...args)),
  };

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    getLogger: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
  };

  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      security: {
        secrets: { cookie_secrets: ['test-signing-secret'] },
      },
      integrations: {
        file_storage: {
          signed_url_expiry_seconds: 3600,
        },
      },
    }),
    load: vi.fn(),
    getPlatformConfig: vi.fn(),
    getConfigSection: vi.fn(),
    getSectionCacheMetrics: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getSubscribers: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    getConfigValue: vi.fn(),
    isFeatureEnabled: vi.fn(),
    clearCache: vi.fn(),
    isLoaded: vi.fn(),
    getBootstrapConfig: vi.fn(),
    isUsingFileConfig: vi.fn(),
    flushInitial: vi.fn(),
    ensureTenantConfig: vi.fn(),
    invalidateTenantConfig: vi.fn(),
    setPubSub: vi.fn(),
    cleanup: vi.fn(),
  };

  // Create the provider (constructor creates uploads dir)
  const provider = new (LocalStorageProvider as any)(
    fileSystemUtils,
    logger,
    configManager
  );

  return { provider, fileSystemUtils, logger, configManager };
}

describe('LocalStorageProvider', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('store', () => {
    it('should write a file to the correct path', async () => {
      const { provider } = createProvider(tmpDir);
      const buffer = Buffer.from('test image data');
      const key = 'default/avatars/test.png';

      const result = await provider.store(buffer, key, 'image/png');

      expect(result).toBe(key);
      const fullPath = path.join(tmpDir, 'uploads', key);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath).toString()).toBe('test image data');
    });

    it('should create parent directories recursively', async () => {
      const { provider } = createProvider(tmpDir);
      const buffer = Buffer.from('data');
      const key = 'tenant1/avatars/deep/nested/file.png';

      await provider.store(buffer, key, 'image/png');

      const fullPath = path.join(tmpDir, 'uploads', key);
      expect(fs.existsSync(fullPath)).toBe(true);
    });

    it('should reject path traversal with ..', async () => {
      const { provider } = createProvider(tmpDir);
      const buffer = Buffer.from('data');

      await expect(
        provider.store(buffer, '../../../etc/passwd', 'text/plain')
      ).rejects.toThrow('path traversal');
    });

    it('should reject null bytes in key', async () => {
      const { provider } = createProvider(tmpDir);
      const buffer = Buffer.from('data');

      await expect(
        provider.store(buffer, 'test\0.png', 'image/png')
      ).rejects.toThrow('path traversal');
    });
  });

  describe('delete', () => {
    it('should remove an existing file', async () => {
      const { provider } = createProvider(tmpDir);
      const buffer = Buffer.from('data');
      const key = 'default/avatars/test.png';

      await provider.store(buffer, key, 'image/png');
      const fullPath = path.join(tmpDir, 'uploads', key);
      expect(fs.existsSync(fullPath)).toBe(true);

      await provider.delete(key);
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('should not throw when deleting a non-existent file', async () => {
      const { provider } = createProvider(tmpDir);

      await expect(
        provider.delete('nonexistent/file.png')
      ).resolves.toBeUndefined();
    });

    it('should no-op for empty key', async () => {
      const { provider } = createProvider(tmpDir);

      await expect(provider.delete('')).resolves.toBeUndefined();
    });
  });

  describe('getUrl', () => {
    it('should return a signed URL in the correct format', () => {
      const { provider } = createProvider(tmpDir);
      const url = provider.getUrl('default/avatars/test.png');

      expect(url).toMatch(/^\/media\/file\//);
      expect(url).toContain('expires=');
      expect(url).toContain('sig=');
    });

    it('should return empty string for empty key', () => {
      const { provider } = createProvider(tmpDir);
      expect(provider.getUrl('')).toBe('');
    });
  });
});
