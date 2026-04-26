import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { AuthController } from '../../controllers/auth.controller.js';
import { AccountsController } from '../../controllers/account.controller.js';
import { AdminActivitiesController } from '../../controllers/admin/activity.controller.js';
import { AdminUsersController } from '../../controllers/admin/user.controller.js';
import { AdminOidcClientController } from '../../controllers/admin/oidc-client.controller.js';
import { AdminUserGrantsController } from '../../controllers/admin/grant.controller.js';
import { AdminHomeController } from '../../controllers/admin/home.controller.js';
import { AdminSessionsController } from '../../controllers/admin/session.controller.js';
import { AdminSettingsController } from '../../controllers/admin/settings.controller.js';
import { WebAuthnController } from '../../controllers/webauthn.controller.js';
import { AdminJwksController } from '../../controllers/admin/jwks.controller.js';
import { AdminConfigurationController } from '../../controllers/admin/configuration.controller.js';
import { AdminDataTransferController } from '../../controllers/admin/data-transfer.controller.js';

import { IAuthController } from '../interfaces/auth-controller.interface.js';
import { IAccountController } from '../interfaces/account-controller.interface.js';
import { IAdminActivitiesController } from '../interfaces/admin-activities-controller.interface.js';
import { IAdminUsersController } from '../interfaces/admin-users-controller.interface.js';
import { IAdminOidcClientController } from '../interfaces/admin-oidc-client-controller.interface.js';
import { IAdminUserGrantsController } from '../interfaces/admin-user-grants-controller.interface.js';
import { IAdminHomeController } from '../interfaces/admin-home-controller.interface.js';
import { IAdminSessionsController } from '../interfaces/admin-sessions-controller.interface.js';
import { IAdminSettingsController } from '../interfaces/admin-settings-controller.interface.js';
import { IWebAuthnController } from '../interfaces/webauthn-controller.interface.js';
import { IAdminJwksController } from '../interfaces/admin-jwks-controller.interface.js';
import type { IAdminConfigurationController } from '../interfaces/admin-configuration-controller.interface.js';
import type { IAdminDataTransferController } from '../interfaces/admin-data-transfer-controller.interface.js';

export const controllersModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // All controllers - Transient (per-request, fresh instance)
    options
      .bind<IAuthController>(TYPES.AuthController)
      .to(AuthController)
      .inTransientScope();

    options
      .bind<IAccountController>(TYPES.AccountController)
      .to(AccountsController)
      .inTransientScope();

    options
      .bind<IAdminActivitiesController>(TYPES.AdminActivitiesController)
      .to(AdminActivitiesController)
      .inTransientScope();

    options
      .bind<IAdminUsersController>(TYPES.AdminUsersController)
      .to(AdminUsersController)
      .inTransientScope();

    options
      .bind<IAdminOidcClientController>(TYPES.AdminOidcClientsController)
      .to(AdminOidcClientController)
      .inTransientScope();

    options
      .bind<IAdminUserGrantsController>(TYPES.AdminUserGrantsController)
      .to(AdminUserGrantsController)
      .inTransientScope();

    options
      .bind<IAdminHomeController>(TYPES.AdminHomeController)
      .to(AdminHomeController)
      .inTransientScope();

    options
      .bind<IAdminSessionsController>(TYPES.AdminSessionsController)
      .to(AdminSessionsController)
      .inTransientScope();

    options
      .bind<IAdminSettingsController>(TYPES.AdminSettingsController)
      .to(AdminSettingsController)
      .inTransientScope();

    options
      .bind<IWebAuthnController>(TYPES.WebAuthnController)
      .to(WebAuthnController)
      .inTransientScope();

    options
      .bind<IAdminJwksController>(TYPES.AdminJwksController)
      .to(AdminJwksController)
      .inTransientScope();

    options
      .bind<IAdminConfigurationController>(TYPES.AdminConfigurationController)
      .to(AdminConfigurationController)
      .inTransientScope();

    options
      .bind<IAdminDataTransferController>(TYPES.AdminDataTransferController)
      .to(AdminDataTransferController)
      .inTransientScope();
  }
);
