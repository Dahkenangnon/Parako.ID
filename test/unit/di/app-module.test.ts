import 'reflect-metadata';

import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

import { appModule } from '../../../src/di/modules/app.module.js';
import { TYPES } from '../../../src/di/types.js';
import { MainRoutesManager } from '../../../src/routes/index.js';

describe('appModule', () => {
  it('binds one main routes manager instance', () => {
    const container = new Container();
    const dependencies = [
      TYPES.ConfigManager,
      TYPES.AuthController,
      TYPES.AccountController,
      TYPES.AdminUsersController,
      TYPES.AdminHomeController,
      TYPES.AdminActivitiesController,
      TYPES.AdminOidcClientsController,
      TYPES.AdminSessionsController,
      TYPES.AdminUserGrantsController,
      TYPES.AdminSettingsController,
      TYPES.AdminJwksController,
      TYPES.AdminConfigurationController,
      TYPES.AdminDataTransferController,
      TYPES.UploadMiddleware,
      TYPES.SecurityMiddleware,
      TYPES.LocalsMiddleware,
      TYPES.UIMiddleware,
      TYPES.ConfigValidationMiddleware,
      TYPES.SessionManager,
      TYPES.WebAuthnController,
      TYPES.SocialTier1CompletionService,
      TYPES.Logger,
    ];
    for (const dependency of dependencies) {
      container.bind(dependency).toConstantValue({});
    }
    container.load(appModule);

    const first = container.get<MainRoutesManager>(TYPES.MainRoutesManager);
    const second = container.get<MainRoutesManager>(TYPES.MainRoutesManager);

    expect(first).toBeInstanceOf(MainRoutesManager);
    expect(second).toBe(first);
  });
});
