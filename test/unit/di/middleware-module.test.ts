import 'reflect-metadata';

import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

import { middlewareModule } from '../../../src/di/modules/middleware.module.js';
import { TYPES } from '../../../src/di/types.js';
import { RequestLoggerMiddleware } from '../../../src/middlewares/request-logger.middleware.js';
import { TenantContextMiddleware } from '../../../src/middlewares/tenant-context.middleware.js';
import { OIDCMiddleware } from '../../../src/oidc/flows/middleware/oidc.middleware.js';

const middlewareBindings = [
  TYPES.LocalsMiddleware,
  TYPES.SecurityMiddleware,
  TYPES.UIMiddleware,
  TYPES.UploadMiddleware,
  TYPES.KoaMiddleware,
  TYPES.OIDCMiddleware,
  TYPES.ConfigValidationMiddleware,
  TYPES.RequestLoggerMiddleware,
  TYPES.TenantContextMiddleware,
] as const;

describe('middlewareModule', () => {
  it('registers every middleware component', () => {
    const container = new Container();

    container.load(middlewareModule);

    for (const identifier of middlewareBindings) {
      expect(container.isBound(identifier)).toBe(true);
    }
  });

  it('creates a fresh OIDC middleware instance for each resolution', () => {
    const container = new Container();
    container.bind(TYPES.SessionManager).toConstantValue({});
    container.bind(TYPES.AuthService).toConstantValue({});
    container.bind(TYPES.Logger).toConstantValue({});
    container.load(middlewareModule);

    const first = container.get<OIDCMiddleware>(TYPES.OIDCMiddleware);
    const second = container.get<OIDCMiddleware>(TYPES.OIDCMiddleware);

    expect(first).toBeInstanceOf(OIDCMiddleware);
    expect(second).toBeInstanceOf(OIDCMiddleware);
    expect(second).not.toBe(first);
  });

  it('shares the stateless request and tenant middleware instances', () => {
    const container = new Container();
    container.bind(TYPES.Logger).toConstantValue({});
    container.bind(TYPES.MetricsService).toConstantValue({});
    container.bind(TYPES.ConfigManager).toConstantValue({});
    container.bind(TYPES.TenantRepository).toConstantValue({});
    container.bind(TYPES.SessionManager).toConstantValue({});
    container.load(middlewareModule);

    const requestLogger = container.get<RequestLoggerMiddleware>(
      TYPES.RequestLoggerMiddleware
    );
    const tenantContext = container.get<TenantContextMiddleware>(
      TYPES.TenantContextMiddleware
    );

    expect(requestLogger).toBeInstanceOf(RequestLoggerMiddleware);
    expect(
      container.get<RequestLoggerMiddleware>(TYPES.RequestLoggerMiddleware)
    ).toBe(requestLogger);
    expect(tenantContext).toBeInstanceOf(TenantContextMiddleware);
    expect(
      container.get<TenantContextMiddleware>(TYPES.TenantContextMiddleware)
    ).toBe(tenantContext);
  });
});
