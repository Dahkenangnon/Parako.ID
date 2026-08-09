import 'reflect-metadata';

import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

import { storageModule } from '../../../src/di/modules/storage.module.js';
import { TYPES } from '../../../src/di/types.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { OptionalDepsHandles } from '../../../src/di/loaders/optional-deps.js';
import { ImageProcessorService } from '../../../src/services/image-processor.service.js';
import type { IStorageProvider } from '../../../src/storage/storage-provider.interface.js';

function createStorageContainer() {
  const container = new Container();
  const fileSystemUtils = { rootDir: '/test' } as IFileSystemUtils;
  const logger = {} as ILogger;
  const configManager = {} as IConfigManager;
  const provider = { providerName: 'local' } as IStorageProvider;
  const buildStorageProvider = vi.fn(() => provider);
  const handles: OptionalDepsHandles = {
    storageProviderName: 'local',
    buildStorageProvider,
  };

  container.bind(TYPES.OptionalDepsHandles).toConstantValue(handles);
  container.bind(TYPES.FileSystemUtils).toConstantValue(fileSystemUtils);
  container.bind(TYPES.Logger).toConstantValue(logger);
  container.bind(TYPES.ConfigManager).toConstantValue(configManager);
  container.load(storageModule);

  return {
    buildStorageProvider,
    configManager,
    container,
    fileSystemUtils,
    logger,
    provider,
  };
}

describe('storageModule', () => {
  it('builds the selected storage provider with the container dependencies', () => {
    const {
      buildStorageProvider,
      configManager,
      container,
      fileSystemUtils,
      logger,
      provider,
    } = createStorageContainer();

    expect(container.get(TYPES.StorageProvider)).toBe(provider);
    expect(buildStorageProvider).toHaveBeenCalledWith(
      fileSystemUtils,
      logger,
      configManager
    );
  });

  it('binds one image processor instance', () => {
    const { container } = createStorageContainer();

    const first = container.get<ImageProcessorService>(
      TYPES.ImageProcessorService
    );
    const second = container.get<ImageProcessorService>(
      TYPES.ImageProcessorService
    );

    expect(first).toBeInstanceOf(ImageProcessorService);
    expect(second).toBe(first);
  });
});
