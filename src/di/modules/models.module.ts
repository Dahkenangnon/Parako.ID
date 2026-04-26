import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { createUserModel } from '../../models/user.model.js';
import {
  ActivityModel,
  createActivityModel,
} from '../../models/activity.model.js';
import {
  createSocialIntegrationModel,
  SocialIntegrationModel,
} from '../../models/social-integration.model.js';
import {
  createSettingsModel,
  SettingsModel,
} from '../../models/settings.model.js';
import {
  createJwksKeyModel,
  JwksKeyModel,
} from '../../models/jwks-key.model.js';
import { createTenantModel, TenantModel } from '../../models/tenant.model.js';
import {
  createTenantSettingsOverrideModel,
  TenantSettingsOverrideModel,
} from '../../models/tenant-settings-override/model.js';

import { ILogger } from '../interfaces/logger.interface.js';
import { IConfigManager } from '../interfaces/config-manager.interface.js';
import { IPasswordUtils } from '../interfaces/password-utils.interface.js';
import { UserModel } from '../../models/user.model.js';

export const modelsModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // Model factories - Singleton (shared model instances)
    options
      .bind<UserModel>(TYPES.UserModel)
      .toDynamicValue(context => {
        const logger = context.get<ILogger>(TYPES.Logger);
        const configManager = context.get<IConfigManager>(TYPES.ConfigManager);
        const passwordUtils = context.get<IPasswordUtils>(TYPES.PasswordUtils);
        return createUserModel(logger, configManager, passwordUtils);
      })
      .inSingletonScope();

    options
      .bind<ActivityModel>(TYPES.ActivityModel)
      .toDynamicValue(() => {
        return createActivityModel();
      })
      .inSingletonScope();

    options
      .bind<SocialIntegrationModel>(TYPES.SocialIntegrationModel)
      .toDynamicValue(() => {
        return createSocialIntegrationModel();
      })
      .inSingletonScope();

    options
      .bind<SettingsModel>(TYPES.SettingsModel)
      .toDynamicValue(() => {
        return createSettingsModel();
      })
      .inSingletonScope();

    options
      .bind<JwksKeyModel>(TYPES.JwksKeyModel)
      .toDynamicValue(() => {
        return createJwksKeyModel();
      })
      .inSingletonScope();

    options
      .bind<TenantModel>(TYPES.TenantModel)
      .toDynamicValue(() => {
        return createTenantModel();
      })
      .inSingletonScope();

    options
      .bind<TenantSettingsOverrideModel>(TYPES.TenantSettingsOverrideModel)
      .toDynamicValue(() => {
        return createTenantSettingsOverrideModel();
      })
      .inSingletonScope();
  }
);
