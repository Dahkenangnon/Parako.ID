import { ContainerModule, type ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';
import type { IStorageProvider } from '../../storage/storage-provider.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../interfaces/file-system-utils.interface.js';
import type { ILogger } from '../interfaces/logger.interface.js';
import { ImageProcessorService } from '../../services/image-processor.service.js';
import type { OptionalDepsHandles } from '../loaders/optional-deps.js';

export const storageModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    options
      .bind<IStorageProvider>(TYPES.StorageProvider)
      .toDynamicValue(context => {
        const handles = context.get<OptionalDepsHandles>(
          TYPES.OptionalDepsHandles
        );
        const configManager = context.get<IConfigManager>(TYPES.ConfigManager);
        const logger = context.get<ILogger>(TYPES.Logger);
        const fileSystemUtils = context.get<IFileSystemUtils>(
          TYPES.FileSystemUtils
        );
        return handles.buildStorageProvider(
          fileSystemUtils,
          logger,
          configManager
        );
      })
      .inSingletonScope();

    options
      .bind<ImageProcessorService>(TYPES.ImageProcessorService)
      .to(ImageProcessorService)
      .inSingletonScope();
  }
);
