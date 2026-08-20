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
