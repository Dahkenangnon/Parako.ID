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

import { clientRoutes } from '../../../../../src/api/v1/routes/clients.routes.js';
import type { IClientsRouteController } from '../../../../../src/api/v1/routes/index.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';
import {
  createClientSchema,
  updateClientSchema,
} from '../../../../../src/api/v1/validators/clients.validator.js';

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
    schema === createClientSchema
      ? 'create'
      : schema === updateClientSchema
        ? 'update'
        : 'unexpected';
  return traceMiddleware(`body:${schemaName}`);
});

function handler(name: string) {
  return async (req: TracedRequest, res: Response): Promise<void> => {
    res.status(200).json({ name, trace: req.routeTrace });
  };
}

const controller: IClientsRouteController = {
  list: handler('list'),
  create: handler('create'),
  get: handler('get'),
  update: handler('update'),
  patch: handler('patch'),
  destroy: handler('destroy'),
  activate: handler('activate'),
  deactivate: handler('deactivate'),
  regenerateSecret: handler('regenerateSecret'),
  stats: handler('stats'),
};

type RouteCase = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  handler: string;
  scope: string;
  rate: string;
  bodySchema?: 'create' | 'update';
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/clients/',
    handler: 'list',
    scope: SCOPES.CLIENTS_READ,
    rate: 'read',
  },
  {
    method: 'post',
    path: '/clients/',
    handler: 'create',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'write',
    bodySchema: 'create',
  },
  {
    method: 'get',
    path: '/clients/client-1',
    handler: 'get',
    scope: SCOPES.CLIENTS_READ,
    rate: 'read',
  },
  {
    method: 'put',
    path: '/clients/client-1',
    handler: 'update',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'write',
    bodySchema: 'update',
  },
  {
    method: 'patch',
    path: '/clients/client-1',
    handler: 'patch',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'write',
    bodySchema: 'update',
  },
  {
    method: 'delete',
    path: '/clients/client-1',
    handler: 'destroy',
    scope: SCOPES.CLIENTS_DELETE,
    rate: 'delete',
  },
  {
    method: 'post',
    path: '/clients/client-1/activate',
    handler: 'activate',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'write',
  },
  {
    method: 'post',
    path: '/clients/client-1/deactivate',
    handler: 'deactivate',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'write',
  },
  {
    method: 'post',
    path: '/clients/client-1/secret',
    handler: 'regenerateSecret',
    scope: SCOPES.CLIENTS_WRITE,
    rate: 'sensitive',
  },
  {
    method: 'get',
    path: '/clients/client-1/stats',
    handler: 'stats',
    scope: SCOPES.CLIENTS_READ,
    rate: 'read',
  },
];

describe('clientRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/clients', clientRoutes(controller));

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

  it('does not route client actions or stats through the single-client handler', async () => {
    const app = express();
    app.use('/clients', clientRoutes(controller));

    const [activate, deactivate, secret, stats] = await Promise.all([
      request(app).post('/clients/client-1/activate'),
      request(app).post('/clients/client-1/deactivate'),
      request(app).post('/clients/client-1/secret'),
      request(app).get('/clients/client-1/stats'),
    ]);

    expect([
      activate.body.name,
      deactivate.body.name,
      secret.body.name,
      stats.body.name,
    ]).toEqual(['activate', 'deactivate', 'regenerateSecret', 'stats']);
  });
});
