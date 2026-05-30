import { Container } from 'inversify';

import { configModule } from './modules/config.module.js';
import { databaseModule } from './modules/database.module.js';
import { servicesModule } from './modules/services.module.js';
import { controllersModule } from './modules/controllers.module.js';
import { middlewareModule } from './modules/middleware.module.js';
import { oidcModule } from './modules/oidc.module.js';
import { modelsModule } from './modules/models.module.js';
import { appModule } from './modules/app.module.js';
import { storageModule } from './modules/storage.module.js';
import { apiModule } from './modules/api.module.js';

import { Application } from '../app.js';
import { TYPES } from './types.js';
import { IApplication } from './interfaces/application.interface.js';
import type { IConfigProvider } from './interfaces/config-provider.interface.js';
import type { BootstrapConfig } from '../config/schemas/bootstrap-schema.js';
import {
  loadAdapterBundle,
  type AdapterBundle,
  type StorageAdapter,
} from './loaders/adapter-loader.js';

const resolveStorageAdapter = (
  provider: IConfigProvider<BootstrapConfig>
): StorageAdapter => {
  const raw = provider.getConfigValue<string>('storage.adapter', 'sqlite');
  if (raw === 'mongodb' || raw === 'postgresql' || raw === 'sqlite') {
    return raw;
  }
  throw new Error(`Unsupported storage adapter: ${raw}`);
};

/**
 * Construct the DI container. The function dynamic-imports only the runtime
 * modules required by the active storage adapter so a single-adapter
 * deployment does not pay the heap cost of the unused families. The result
 * is exposed as a module-level promise (`containerReady`) so entry points
 * can await initialization once and pass the resolved container around.
 */
export async function buildContainer(): Promise<Container> {
  const container = new Container({
    defaultScope: 'Transient',
  });

  container.load(configModule);

  const provider = container.get<IConfigProvider<BootstrapConfig>>(
    TYPES.BootstrapConfigProvider
  );
  const adapter = resolveStorageAdapter(provider);
  const bundle = await loadAdapterBundle(adapter);
  container.bind<AdapterBundle>(TYPES.AdapterBundle).toConstantValue(bundle);

  container.load(
    databaseModule,
    servicesModule,
    modelsModule,
    middlewareModule,
    controllersModule,
    oidcModule,
    storageModule,
    apiModule,
    appModule
  );

  container
    .bind<IApplication>(TYPES.Application)
    .to(Application)
    .inSingletonScope();

  return container;
}

export const containerReady: Promise<Container> = buildContainer();

export {
  validateContainer,
  assertContainerValid,
  type ContainerValidationResult,
} from './validation.js';
