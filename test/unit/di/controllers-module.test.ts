import 'reflect-metadata';

import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

import { AdminActivitiesController } from '../../../src/controllers/admin/activity.controller.js';
import { controllersModule } from '../../../src/di/modules/controllers.module.js';
import { TYPES } from '../../../src/di/types.js';

const controllerBindings = [
  TYPES.AuthControllerOperationModules,
  TYPES.AccountControllerOperationModules,
  TYPES.AdminSettingsControllerOperationModules,
  TYPES.AuthController,
  TYPES.AccountController,
  TYPES.AdminActivitiesController,
  TYPES.AdminUsersController,
  TYPES.AdminOidcClientsController,
  TYPES.AdminUserGrantsController,
  TYPES.AdminHomeController,
  TYPES.AdminSessionsController,
  TYPES.AdminSettingsController,
  TYPES.WebAuthnController,
  TYPES.AdminJwksController,
  TYPES.AdminConfigurationController,
  TYPES.AdminDataTransferController,
] as const;

describe('controllersModule', () => {
  it('registers every standard HTTP controller', () => {
    const container = new Container();

    container.load(controllersModule);

    for (const identifier of controllerBindings) {
      expect(container.isBound(identifier)).toBe(true);
    }
  });

  it('constructs each controller operation module from container dependencies', () => {
    const container = new Container();
    const dependencies = [
      TYPES.Logger,
      TYPES.AuthService,
      TYPES.UserService,
      TYPES.NotificationService,
      TYPES.ConfigManager,
      TYPES.OIDCAdapterBridge,
      TYPES.SmsService,
      TYPES.RecoveryUtils,
      TYPES.SocialIntegrationService,
      TYPES.SocialLoginManager,
      TYPES.MfaUtils,
      TYPES.UploadMiddleware,
      TYPES.SessionManager,
      TYPES.EmailService,
      TYPES.SettingsService,
    ];
    for (const identifier of dependencies) {
      container.bind(identifier).toConstantValue({});
    }
    container.load(controllersModule);

    expect(container.get(TYPES.AuthControllerOperationModules)).toBeDefined();
    expect(
      container.get(TYPES.AccountControllerOperationModules)
    ).toBeDefined();
    expect(
      container.get(TYPES.AdminSettingsControllerOperationModules)
    ).toBeDefined();
  });

  it('creates a fresh controller for each resolution', () => {
    const container = new Container();
    container.bind(TYPES.ActivityService).toConstantValue({});
    container.bind(TYPES.SessionManager).toConstantValue({});
    container.bind(TYPES.ClientDeviceInfoManager).toConstantValue({});
    container.load(controllersModule);

    const first = container.get<AdminActivitiesController>(
      TYPES.AdminActivitiesController
    );
    const second = container.get<AdminActivitiesController>(
      TYPES.AdminActivitiesController
    );

    expect(first).toBeInstanceOf(AdminActivitiesController);
    expect(second).toBeInstanceOf(AdminActivitiesController);
    expect(second).not.toBe(first);
  });
});
