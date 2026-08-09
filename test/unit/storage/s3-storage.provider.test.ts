import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockGetSignedUrl: vi
    .fn()
    .mockResolvedValue('https://bucket.s3.amazonaws.com/key?signed'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3Client() {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommand(
    input: any
  ) {
    return { ...input, _type: 'PutObject' };
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function DeleteObjectCommand(
    input: any
  ) {
    return { ...input, _type: 'DeleteObject' };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function GetObjectCommand(
    input: any
  ) {
    return { ...input, _type: 'GetObject' };
  }),
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
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

function createProvider(
  s3Overrides: Record<string, unknown> = {},
  fileStorageOverrides: Record<string, unknown> = {}
) {
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
          ...fileStorageOverrides,
          s3: {
            region: 'us-east-1',
            bucket: 'test-bucket',
            access_key_id: 'AKIAFAKEKEY1234567890',
            secret_access_key: 'fake-secret-key-for-testing-only-not-real-0',
            ...s3Overrides,
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

  it('rejects a configured endpoint that is not a valid http(s) URL', () => {
    expect(() => createProvider({ endpoint: 'not a url' })).toThrow(
      /endpoint.*valid http\(s\) url/i
    );
  });

  it.each([42, 'ftp://storage.example.com'])(
    'rejects an unsupported endpoint value: %s',
    endpoint => {
      expect(() => createProvider({ endpoint })).toThrow(
        /endpoint.*valid http\(s\) url/i
      );
    }
  );

  it.each(['http://storage.example.com', 'https://storage.example.com'])(
    'passes a valid custom endpoint to the SDK: %s',
    endpoint => {
      createProvider({
        access_key_id: '  access-key  ',
        bucket: '  bucket  ',
        endpoint: `  ${endpoint}  `,
        force_path_style: true,
        region: '  region  ',
        secret_access_key: '  secret-key  ',
      });

      expect(S3Client).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        },
        endpoint,
        forcePathStyle: true,
        region: 'region',
      });
    }
  );

  it.each([undefined, null, '   '])(
    'omits an absent or blank optional endpoint: %s',
    endpoint => {
      createProvider({ endpoint });

      expect(S3Client).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: 'AKIAFAKEKEY1234567890',
          secretAccessKey: 'fake-secret-key-for-testing-only-not-real-0',
        },
        region: 'us-east-1',
      });
    }
  );

  it('reports one missing required setting with singular grammar', () => {
    expect(() => createProvider({ region: '   ' })).toThrow(
      'S3 storage provider misconfigured: region is required'
    );
  });

  it('reports every missing required setting with plural grammar', () => {
    expect(() =>
      createProvider({
        access_key_id: undefined,
        bucket: undefined,
        region: undefined,
        secret_access_key: undefined,
      })
    ).toThrow(
      'S3 storage provider misconfigured: region, bucket, access_key_id, secret_access_key are required'
    );
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

    it('should use the default expiry when it is not configured', async () => {
      const { provider } = createProvider(
        {},
        { signed_url_expiry_seconds: undefined }
      );

      await provider.getUrl('default/avatars/test.png');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 }
      );
    });
  });
});
