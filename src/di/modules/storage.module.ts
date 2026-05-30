import { ContainerModule, type ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';
import type { IStorageProvider } from '../../storage/storage-provider.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../interfaces/file-system-utils.interface.js';
import type { ILogger } from '../interfaces/logger.interface.js';
import { LocalStorageProvider } from '../../storage/local-storage.provider.js';
import { S3StorageProvider } from '../../storage/s3-storage.provider.js';
import { ImageProcessorService } from '../../services/image-processor.service.js';

export const storageModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    options
      .bind<IStorageProvider>(TYPES.StorageProvider)
      .toDynamicValue(context => {
        const configManager = context.get<IConfigManager>(TYPES.ConfigManager);
        const logger = context.get<ILogger>(TYPES.Logger);
        const config = configManager.getConfig();
        const provider = config.integrations?.file_storage?.provider ?? 'local';

        if (provider === 's3') {
          return new S3StorageProvider(logger, configManager);
        }

        const fileSystemUtils = context.get<IFileSystemUtils>(
          TYPES.FileSystemUtils
        );
        return new LocalStorageProvider(fileSystemUtils, logger, configManager);
      })
      .inSingletonScope();

    options
      .bind<ImageProcessorService>(TYPES.ImageProcessorService)
      .to(ImageProcessorService)
      .inSingletonScope();
  }
);
