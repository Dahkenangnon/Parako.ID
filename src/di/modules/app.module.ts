import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { MainRoutesManager } from '../../routes/index.js';

import { IMainRoutesManager } from '../interfaces/main-routes-manager.interface.js';

export const appModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // Application services - Singleton (shared across app)
    options
      .bind<IMainRoutesManager>(TYPES.MainRoutesManager)
      .to(MainRoutesManager)
      .inSingletonScope();
  }
);
