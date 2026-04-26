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

const container = new Container({
  defaultScope: 'Transient', // Default to transient for better performance
});

container.load(
  configModule, // Configuration first
  databaseModule, // Database connections
  servicesModule, // Business logic services
  modelsModule, // Model factories
  middlewareModule, // Middleware
  controllersModule, // Controllers
  oidcModule, // OIDC services
  storageModule, // Storage provider (local/S3)
  apiModule, // Management API v1 controllers + routes
  appModule // Application services (MainRoutesManager)
);

// Bind Application after all modules are loaded to avoid circular dependencies
container
  .bind<IApplication>(TYPES.Application)
  .to(Application)
  .inSingletonScope();

export { container };

export {
  validateContainer,
  assertContainerValid,
  type ContainerValidationResult,
} from './validation.js';
