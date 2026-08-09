import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadOptionalDeps,
  type StorageProviderName,
} from '../../../src/di/loaders/optional-deps.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';

describe('loadOptionalDeps', () => {
  it('rejects an unsupported runtime storage provider', async () => {
    await expect(
      loadOptionalDeps('ftp' as StorageProviderName)
    ).rejects.toThrow('Unsupported storage provider: ftp');
  });

  it('builds the local provider when local storage is selected', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'parako-optional-deps-'));

    try {
      const handles = await loadOptionalDeps('local');
      const provider = handles.buildStorageProvider(
        { rootDir } as IFileSystemUtils,
        {} as ILogger,
        {
          getConfig: () => ({
            integrations: {
              file_storage: { upload_dir: 'uploads' },
            },
          }),
        } as IConfigManager
      );

      expect(handles.storageProviderName).toBe('local');
      expect(provider.providerName).toBe('local');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('builds the S3 provider when S3 storage is selected', async () => {
    const handles = await loadOptionalDeps('s3');
    const provider = handles.buildStorageProvider(
      {} as IFileSystemUtils,
      {} as ILogger,
      {
        getConfig: () => ({
          integrations: {
            file_storage: {
              s3: {
                region: 'us-east-1',
                bucket: 'parako-test',
                access_key_id: 'test-access-key',
                secret_access_key: 'test-secret-key',
              },
            },
          },
        }),
      } as IConfigManager
    );

    expect(handles.storageProviderName).toBe('s3');
    expect(provider.providerName).toBe('s3');
  });
});
