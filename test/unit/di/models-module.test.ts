import 'reflect-metadata';

import { Container } from 'inversify';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IPasswordUtils } from '../../../src/di/interfaces/password-utils.interface.js';
import { modelsModule } from '../../../src/di/modules/models.module.js';
import { TYPES } from '../../../src/di/types.js';

const modelBindings = [
  [TYPES.UserModel, 'User'],
  [TYPES.ActivityModel, 'Activity'],
  [TYPES.SocialIntegrationModel, 'SocialIntegration'],
  [TYPES.SettingsModel, 'Settings'],
  [TYPES.JwksKeyModel, 'JwksKey'],
  [TYPES.TenantModel, 'Tenant'],
  [TYPES.TenantSettingsOverrideModel, 'TenantSettingsOverride'],
] as const;

describe('modelsModule', () => {
  afterEach(() => {
    for (const [, modelName] of modelBindings) {
      if (mongoose.models[modelName]) mongoose.deleteModel(modelName);
    }
  });

  it('builds one instance of every application model', () => {
    const container = new Container();
    const configManager = {
      getConfig: () => ({
        security: {
          authentication: {
            roles: { available: ['user', 'admin'], default: 'user' },
          },
        },
      }),
    } as IConfigManager;

    container.bind(TYPES.Logger).toConstantValue({} as ILogger);
    container.bind(TYPES.ConfigManager).toConstantValue(configManager);
    container.bind(TYPES.PasswordUtils).toConstantValue({} as IPasswordUtils);
    container.load(modelsModule);

    for (const [identifier, modelName] of modelBindings) {
      const first = container.get<typeof mongoose.Model>(identifier);
      const second = container.get<typeof mongoose.Model>(identifier);

      expect(first.modelName).toBe(modelName);
      expect(second).toBe(first);
    }
  });
});
