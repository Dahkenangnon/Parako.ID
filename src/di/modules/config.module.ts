import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { ConfigManager } from '../../config/index.js';
import { BootstrapConfigProvider } from '../../config/provider/bootstrap-provider.js';
import { DatabaseConfigProvider } from '../../config/provider/db-provider.js';
import { FileConfigProvider } from '../../config/provider/file-provider.js';

import { IConfigManager } from '../interfaces/config-manager.interface.js';
import { IConfigProvider } from '../interfaces/config-provider.interface.js';

export const configModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // Configuration services - Singleton (shared across app)
    options
      .bind<IConfigManager>(TYPES.ConfigManager)
      .to(ConfigManager)
      .inSingletonScope();

    options
      .bind<IConfigProvider>(TYPES.BootstrapConfigProvider)
      .to(BootstrapConfigProvider)
      .inSingletonScope();

    options
      .bind<IConfigProvider>(TYPES.DatabaseConfigProvider)
      .to(DatabaseConfigProvider)
      .inSingletonScope();

    options
      .bind<IConfigProvider>(TYPES.FileConfigProvider)
      .to(FileConfigProvider)
      .inSingletonScope();
  }
);
