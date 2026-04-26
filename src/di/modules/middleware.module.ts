import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { LocalsMiddleware } from '../../middlewares/locals.middleware.js';
import { SecurityMiddleware } from '../../middlewares/security.middleware.js';
import { UIMiddleware } from '../../middlewares/ui.middleware.js';
import { UploadMiddleware } from '../../middlewares/upload.middleware.js';
import { KoaMiddleware } from '../../oidc/flows/middleware/koa.middleware.js';
import { OIDCMiddleware } from '../../oidc/flows/middleware/oidc.middleware.js';
import { ConfigValidationMiddleware } from '../../middlewares/config-validation.middleware.js';
import { RequestLoggerMiddleware } from '../../middlewares/request-logger.middleware.js';
import { TenantContextMiddleware } from '../../middlewares/tenant-context.middleware.js';

import { ILocalsMiddleware } from '../interfaces/locals-middleware.interface.js';
import { ISecurityMiddleware } from '../interfaces/security-middleware.interface.js';
import { IUIMiddleware } from '../interfaces/ui-middleware.interface.js';
import { IUploadMiddleware } from '../interfaces/upload-middleware.interface.js';
import { IKoaMiddleware } from '../interfaces/koa-middleware.interface.js';
import { IOIDCMiddleware } from '../interfaces/oidc-middleware.interface.js';
import { IConfigValidationMiddleware } from '../interfaces/config-validation-middleware.interface.js';
import { IRequestLoggerMiddleware } from '../interfaces/request-logger-middleware.interface.js';
import { ITenantContextMiddleware } from '../interfaces/tenant-context-middleware.interface.js';

export const middlewareModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // All middleware - Transient (per-request, fresh instance)
    options
      .bind<ILocalsMiddleware>(TYPES.LocalsMiddleware)
      .to(LocalsMiddleware)
      .inTransientScope();

    options
      .bind<ISecurityMiddleware>(TYPES.SecurityMiddleware)
      .to(SecurityMiddleware)
      .inTransientScope();

    options
      .bind<IUIMiddleware>(TYPES.UIMiddleware)
      .to(UIMiddleware)
      .inTransientScope();

    options
      .bind<IUploadMiddleware>(TYPES.UploadMiddleware)
      .to(UploadMiddleware)
      .inTransientScope();

    options
      .bind<IKoaMiddleware>(TYPES.KoaMiddleware)
      .to(KoaMiddleware)
      .inTransientScope();

    options
      .bind<IOIDCMiddleware>(TYPES.OIDCMiddleware)
      .to(OIDCMiddleware)
      .inTransientScope();

    options
      .bind<IConfigValidationMiddleware>(TYPES.ConfigValidationMiddleware)
      .to(ConfigValidationMiddleware)
      .inTransientScope();

    // Request logger - Singleton (stateless, shares logger instance)
    options
      .bind<IRequestLoggerMiddleware>(TYPES.RequestLoggerMiddleware)
      .to(RequestLoggerMiddleware)
      .inSingletonScope();

    // Tenant context - Singleton (reads config + repo at runtime, stateless)
    options
      .bind<ITenantContextMiddleware>(TYPES.TenantContextMiddleware)
      .to(TenantContextMiddleware)
      .inSingletonScope();
  }
);
