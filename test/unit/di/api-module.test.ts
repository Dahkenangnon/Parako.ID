import 'reflect-metadata';

import express from 'express';
import { Container } from 'inversify';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { apiModule } from '../../../src/di/modules/api.module.js';
import { TYPES } from '../../../src/di/types.js';

function createApiContainer(
  options: { brokenPlatform?: boolean; omitProvider?: boolean } = {}
): Container {
  const container = new Container();
  container.bind(TYPES.Logger).toConstantValue({
    debug() {},
    error() {},
    warn() {},
  });
  container.bind(TYPES.ConfigManager).toConstantValue({
    getConfig: () => ({ deployment: { environment: 'production' } }),
  });
  container.bind(TYPES.OIDCAdapterBridge).toConstantValue({});
  container.bind(TYPES.KeyStore).toConstantValue({
    getPublicJWKS: async () => {
      throw new Error('key store unavailable');
    },
  });
  container.bind(TYPES.UserService).toConstantValue({});
  container.bind(TYPES.AuthService).toConstantValue({});
  container.bind(TYPES.ActivityService).toConstantValue({});
  if (options.brokenPlatform) {
    container.bind(TYPES.PlatformAdminService).toDynamicValue(() => {
      throw new Error('platform admin construction failed');
    });
  } else {
    container.bind(TYPES.PlatformAdminService).toConstantValue({});
  }
  container.bind(TYPES.TenantSettingsOverrideService).toConstantValue({});
  container.bind(TYPES.RedisPubSubService).toConstantValue({});
  if (!options.omitProvider) {
    container.bind(TYPES.ProviderService).toConstantValue({});
  }
  container.load(apiModule);
  return container;
}

describe('apiModule', () => {
  it('builds one Management API router with its required capabilities', () => {
    const container = createApiContainer();

    const first = container.get(TYPES.ApiV1RoutesManager);
    const second = container.get(TYPES.ApiV1RoutesManager);

    expect(first).toBeInstanceOf(Function);
    expect(second).toBe(first);
  });

  it('surfaces failures while constructing a required service', () => {
    const container = createApiContainer({ brokenPlatform: true });

    expect(() => container.get(TYPES.ApiV1RoutesManager)).toThrow(
      'platform admin construction failed'
    );
  });

  it('fails fast when a required provider capability is not bound', () => {
    const container = createApiContainer({ omitProvider: true });

    expect(() => container.get(TYPES.ApiV1RoutesManager)).toThrow();
  });

  it('uses the default tenant and returns a Problem Detail when keys are unavailable', async () => {
    const container = createApiContainer();
    const app = express();
    app.use(
      '/api/v1',
      container.get(TYPES.ApiV1RoutesManager) as express.RequestHandler
    );

    const response = await request(app)
      .get('/api/v1/clients')
      .set('Authorization', 'Bearer invalid')
      .expect(401);

    expect(response.headers['content-type']).toContain(
      'application/problem+json'
    );
    expect(response.body).toMatchObject({
      status: 401,
      detail: 'Unable to verify token — key store unavailable',
    });
  });
});
