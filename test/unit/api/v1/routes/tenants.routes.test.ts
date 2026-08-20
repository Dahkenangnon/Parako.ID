import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

const middlewareMocks = vi.hoisted(() => ({
  requireScope: vi.fn(),
  apiRateLimiter: vi.fn(),
  validateBody: vi.fn(),
}));

vi.mock(
  '../../../../../src/api/v1/middleware/scope-guard.middleware.js',
  () => ({ requireScope: middlewareMocks.requireScope })
);
vi.mock(
  '../../../../../src/api/v1/middleware/rate-limiter.middleware.js',
  () => ({ apiRateLimiter: middlewareMocks.apiRateLimiter })
);
vi.mock(
  '../../../../../src/api/v1/middleware/validate-body.middleware.js',
  () => ({ validateBody: middlewareMocks.validateBody })
);

import type { ITenantsRouteController } from '../../../../../src/api/v1/routes/contracts.js';
import { tenantRoutes } from '../../../../../src/api/v1/routes/tenants.routes.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';
import {
  createTenantSchema,
  updateConfigSectionSchema,
} from '../../../../../src/api/v1/validators/tenants.validator.js';

type TracedRequest = Request & { routeTrace?: string[] };

function traceMiddleware(label: string): RequestHandler {
  return (req: TracedRequest, _res: Response, next: NextFunction) => {
    req.routeTrace ??= [];
    req.routeTrace.push(label);
    next();
  };
}

middlewareMocks.requireScope.mockImplementation((scope: string) =>
  traceMiddleware(`scope:${scope}`)
);
middlewareMocks.apiRateLimiter.mockImplementation((tier: string) =>
  traceMiddleware(`rate:${tier}`)
);
middlewareMocks.validateBody.mockImplementation((schema: ZodType) => {
  const schemaName =
    schema === createTenantSchema
      ? 'create'
      : schema === updateConfigSectionSchema
        ? 'updateConfigSection'
        : 'unexpected';
  return traceMiddleware(`body:${schemaName}`);
});

function handler(name: string) {
  return async (req: TracedRequest, res: Response): Promise<void> => {
    res.status(200).json({ name, trace: req.routeTrace });
  };
}

const controller: ITenantsRouteController = {
  list: handler('list'),
  create: handler('create'),
  get: handler('get'),
  getConfig: handler('getConfig'),
  updateConfig: handler('updateConfig'),
};

type RouteCase = {
  method: 'get' | 'post' | 'put';
  path: string;
  handler: string;
  scope: string;
  rate: string;
  bodySchema?: 'create' | 'updateConfigSection';
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/tenants/',
    handler: 'list',
    scope: SCOPES.TENANTS_READ,
    rate: 'read',
  },
  {
    method: 'post',
    path: '/tenants/',
    handler: 'create',
    scope: SCOPES.TENANTS_WRITE,
    rate: 'write',
    bodySchema: 'create',
  },
  {
    method: 'get',
    path: '/tenants/acme',
    handler: 'get',
    scope: SCOPES.TENANTS_READ,
    rate: 'read',
  },
  {
    method: 'get',
    path: '/tenants/acme/config',
    handler: 'getConfig',
    scope: SCOPES.CROSS_TENANT_READ,
    rate: 'read',
  },
  {
    method: 'put',
    path: '/tenants/acme/config/security',
    handler: 'updateConfig',
    scope: SCOPES.CROSS_TENANT_WRITE,
    rate: 'write',
    bodySchema: 'updateConfigSection',
  },
];

describe('tenantRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/tenants', tenantRoutes(controller));

      const response = await request(app)
        [routeCase.method](routeCase.path)
        .expect(200);
      const expectedTrace = [
        `scope:${routeCase.scope}`,
        `rate:${routeCase.rate}`,
      ];
      if (routeCase.bodySchema) {
        expectedTrace.push(`body:${routeCase.bodySchema}`);
      }

      expect(response.body).toEqual({
        name: routeCase.handler,
        trace: expectedTrace,
      });
    }
  );

  it('keeps tenant config routes distinct from the single-tenant route', async () => {
    const app = express();
    app.use('/tenants', tenantRoutes(controller));

    const response = await request(app).get('/tenants/acme/config').expect(200);

    expect(response.body.name).toBe('getConfig');
  });
});
