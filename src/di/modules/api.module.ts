/**
 * DI module for the Management API v1.
 *
 * API controllers are plain classes (no @injectable decorators) to keep them
 * testable without the DI container.  This module manually resolves their
 * dependencies from the container and binds factory-created instances.
 */

import { ContainerModule, type ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import type { ILogger } from '../interfaces/logger.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IOIDCAdapterBridge } from '../interfaces/oidc-adapter-bridge.interface.js';
import type { IKeyStore } from '../interfaces/key-store.interface.js';
import type { IUserService } from '../interfaces/user-service.interface.js';
import type { IAuthService } from '../interfaces/auth-service.interface.js';
import type { IActivityService } from '../interfaces/activity-service.interface.js';
import type { IPlatformAdminService } from '../../services/platform-admin.service.js';
import type { IProviderService } from '../interfaces/provider-service.interface.js';

import { ClientsController } from '../../api/v1/controllers/clients.controller.js';
import { UsersController } from '../../api/v1/controllers/users.controller.js';
import { SessionsController } from '../../api/v1/controllers/sessions.controller.js';
import { JwksController } from '../../api/v1/controllers/jwks.controller.js';
import { AuditController } from '../../api/v1/controllers/audit.controller.js';
import { StatsController } from '../../api/v1/controllers/stats.controller.js';
import { TenantsController } from '../../api/v1/controllers/tenants.controller.js';
import { RegistrationTokensController } from '../../api/v1/controllers/registration-tokens.controller.js';

import { createJwtAuthMiddleware } from '../../api/v1/middleware/jwt-auth.middleware.js';
import { createApiAuditLogger } from '../../api/v1/middleware/audit-logger.middleware.js';
import { createApiErrorHandler } from '../../api/v1/middleware/error-handler.middleware.js';
import { createApiV1Router } from '../../api/v1/routes/index.js';

import { tenantContext } from '../../multi-tenancy/tenant-context.js';

export const apiModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // Bind the complete API v1 router as a factory (lazy resolution).
    options
      .bind(TYPES.ApiV1RoutesManager)
      .toDynamicValue(context => {
        const logger = context.get<ILogger>(TYPES.Logger);
        const configManager = context.get<IConfigManager>(TYPES.ConfigManager);
        const oidcAdapter = context.get<IOIDCAdapterBridge>(
          TYPES.OIDCAdapterBridge
        );
        const keyStore = context.get<IKeyStore>(TYPES.KeyStore);
        const userService = context.get<IUserService>(TYPES.UserService);
        const authService = context.get<IAuthService>(TYPES.AuthService);
        const activityService = context.get<IActivityService>(
          TYPES.ActivityService
        );

        // Platform admin service may not be bound in non-multi-tenant setups
        let platformAdminService: IPlatformAdminService | undefined;
        try {
          platformAdminService = context.get<IPlatformAdminService>(
            TYPES.PlatformAdminService
          );
        } catch {
          // Not available — tenants endpoints will return errors
        }

        // Tenant settings override service may not be bound
        let tenantSettingsOverrideService: any;
        try {
          tenantSettingsOverrideService = context.get(
            TYPES.TenantSettingsOverrideService
          );
        } catch {}

        // Redis pub/sub may not be bound
        let redisPubSub: any;
        try {
          redisPubSub = context.get(TYPES.RedisPubSubService);
        } catch {}

        // ProviderService for registration token management
        let providerService: IProviderService | undefined;
        try {
          providerService = context.get<IProviderService>(
            TYPES.ProviderService
          );
        } catch {
          // Not available — registration-tokens endpoints will return errors
        }

        const getTenantId = () => tenantContext.getTenantId();

        // --- Middleware ---
        const jwtAuth = createJwtAuthMiddleware({
          keyStore,
          configManager,
          logger,
          getTenantId,
        });

        const auditLogger = createApiAuditLogger({
          activityService: activityService as any,
          logger,
        });

        const isDevelopment =
          configManager.getConfig().deployment.environment === 'development';
        const errorHandler = createApiErrorHandler({ logger, isDevelopment });

        // --- Controllers ---
        // Pass the oidcAdapter bridge itself — NOT its sub-properties.
        // The bridge getters (.client, .session, .grant) throw if called
        // before initialize(), which hasn't run yet at DI resolution time.
        // Controllers access these lazily during request handling.
        const clientsController = new ClientsController({
          oidcAdapter: oidcAdapter as any,
          logger,
        });

        const usersController = new UsersController({
          userService: userService as any,
          authService: authService as any,
          activityService: activityService as any,
          oidcAdapter: oidcAdapter as any,
          logger,
        });

        const sessionsController = new SessionsController({
          oidcAdapter: oidcAdapter as any,
          logger,
        });

        const jwksController = new JwksController({
          keyStore,
          getTenantId,
          redisPubSub,
          logger,
        });

        const auditController = new AuditController({
          activityService: activityService as any,
          logger,
        });

        const statsController = new StatsController({
          userService: userService as any,
          oidcAdapter: oidcAdapter as any,
          activityService: activityService as any,
          configManager,
          logger,
        });

        const tenantsController = new TenantsController({
          platformAdminService: platformAdminService as any,
          tenantSettingsOverrideService,
          logger,
        });

        const registrationTokensController = new RegistrationTokensController({
          providerService: providerService as any,
          getTenantId,
          logger,
        });

        // --- Build router ---
        return createApiV1Router({
          jwtAuth,
          auditLogger,
          errorHandler,
          clientsController,
          usersController,
          sessionsController,
          jwksController,
          auditController,
          statsController,
          tenantsController,
          registrationTokensController,
        });
      })
      .inSingletonScope();
  }
);
