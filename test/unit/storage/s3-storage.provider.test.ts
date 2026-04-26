import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockGetSignedUrl: vi
    .fn()
    .mockResolvedValue('https://bucket.s3.amazonaws.com/key?signed'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi
    .fn()
    .mockImplementation((input: any) => ({ ...input, _type: 'PutObject' })),
  DeleteObjectCommand: vi
    .fn()
    .mockImplementation((input: any) => ({ ...input, _type: 'DeleteObject' })),
  GetObjectCommand: vi
    .fn()
    .mockImplementation((input: any) => ({ ...input, _type: 'GetObject' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => (_target: any, _key: any) => {},
}));

import { S3StorageProvider } from '../../../src/storage/s3-storage.provider.js';
import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

function createProvider() {
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
        secrets: { cookie_secrets: ['test-secret'] },
      },
      integrations: {
        file_storage: {
          provider: 's3',
          signed_url_expiry_seconds: 3600,
          s3: {
            region: 'us-east-1',
            bucket: 'test-bucket',
            access_key_id: 'AKIAFAKEKEY1234567890',
            secret_access_key: 'fake-secret-key-for-testing-only-not-real-0',
          },
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

  const provider = new (S3StorageProvider as any)(logger, configManager);
  return { provider, logger, configManager };
}

describe('S3StorageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('store', () => {
    it('should send PutObjectCommand with correct parameters', async () => {
      const { provider } = createProvider();
      const buffer = Buffer.from('test data');

      const result = await provider.store(
        buffer,
        'default/avatars/test.png',
        'image/png'
      );

      expect(result).toBe('default/avatars/test.png');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'default/avatars/test.png',
        Body: buffer,
        ContentType: 'image/png',
      });
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('delete', () => {
    it('should send DeleteObjectCommand', async () => {
      const { provider } = createProvider();

      await provider.delete('default/avatars/test.png');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'default/avatars/test.png',
      });
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should no-op for empty key', async () => {
      const { provider } = createProvider();

      await provider.delete('');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should log error but not throw on S3 failure', async () => {
      const { provider, logger } = createProvider();
      mockSend.mockRejectedValueOnce(new Error('S3 error'));

      await expect(provider.delete('test.png')).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getUrl', () => {
    it('should return a presigned URL', async () => {
      const { provider } = createProvider();

      const url = await provider.getUrl('default/avatars/test.png');

      expect(url).toBe('https://bucket.s3.amazonaws.com/key?signed');
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'default/avatars/test.png',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 }
      );
    });

    it('should return empty string for empty key', async () => {
      const { provider } = createProvider();
      const url = await provider.getUrl('');
      expect(url).toBe('');
    });
  });
});
