/**
 * Bootstrap-time loader for optional storage backends.
 *
 * Heavy adapter modules whose runtime is only needed under specific
 * configuration paths are dynamic-imported here so the unused branches do
 * not enter the V8 heap. The resulting bundle carries the constructors the
 * DI factories need; callers consume it through a constant binding.
 */

import type { IStorageProvider } from '../../storage/storage-provider.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../interfaces/file-system-utils.interface.js';
import type { ILogger } from '../interfaces/logger.interface.js';

export type StorageProviderName = 'local' | 's3';

export interface OptionalDepsBundle {
  readonly StorageProvider: new (...args: never[]) => IStorageProvider;
  readonly storageProviderName: StorageProviderName;
}

interface BuildStorageProvider {
  (
    fileSystemUtils: IFileSystemUtils,
    logger: ILogger,
    configManager: IConfigManager
  ): IStorageProvider;
}

export interface OptionalDepsHandles {
  readonly storageProviderName: StorageProviderName;
  readonly buildStorageProvider: BuildStorageProvider;
}

export async function loadOptionalDeps(
  storageProvider: StorageProviderName
): Promise<OptionalDepsHandles> {
  if (storageProvider === 's3') {
    const { S3StorageProvider } =
      await import('../../storage/s3-storage.provider.js');
    return {
      storageProviderName: 's3',
      buildStorageProvider: (_fileSystemUtils, logger, configManager) =>
        new S3StorageProvider(logger, configManager),
    };
  }

  const { LocalStorageProvider } =
    await import('../../storage/local-storage.provider.js');
  return {
    storageProviderName: 'local',
    buildStorageProvider: (fileSystemUtils, logger, configManager) =>
      new LocalStorageProvider(fileSystemUtils, logger, configManager),
  };
}
