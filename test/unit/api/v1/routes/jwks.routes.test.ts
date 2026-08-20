import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const middlewareMocks = vi.hoisted(() => ({
  requireScope: vi.fn(),
  apiRateLimiter: vi.fn(),
}));

vi.mock(
  '../../../../../src/api/v1/middleware/scope-guard.middleware.js',
  () => ({ requireScope: middlewareMocks.requireScope })
);
vi.mock(
  '../../../../../src/api/v1/middleware/rate-limiter.middleware.js',
  () => ({ apiRateLimiter: middlewareMocks.apiRateLimiter })
);

import type { IJwksRouteController } from '../../../../../src/api/v1/routes/contracts.js';
import { jwksRoutes } from '../../../../../src/api/v1/routes/jwks.routes.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';

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

function handler(name: string) {
  return async (req: TracedRequest, res: Response): Promise<void> => {
    res.status(200).json({ name, trace: req.routeTrace });
  };
}

const controller: IJwksRouteController = {
  list: handler('list'),
  get: handler('get'),
  rotate: handler('rotate'),
  retire: handler('retire'),
  retireExpired: handler('retireExpired'),
};

type RouteCase = {
  method: 'get' | 'post' | 'delete';
  path: string;
  handler: string;
  scope: string;
  rate: string;
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/jwks/',
    handler: 'list',
    scope: SCOPES.JWKS_READ,
    rate: 'read',
  },
  {
    method: 'post',
    path: '/jwks/rotate',
    handler: 'rotate',
    scope: SCOPES.JWKS_ROTATE,
    rate: 'sensitive',
  },
  {
    method: 'post',
    path: '/jwks/retire-expired',
    handler: 'retireExpired',
    scope: SCOPES.JWKS_ROTATE,
    rate: 'sensitive',
  },
  {
    method: 'get',
    path: '/jwks/key-1',
    handler: 'get',
    scope: SCOPES.JWKS_READ,
    rate: 'read',
  },
  {
    method: 'delete',
    path: '/jwks/key-1',
    handler: 'retire',
    scope: SCOPES.JWKS_ROTATE,
    rate: 'sensitive',
  },
];

describe('jwksRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/jwks', jwksRoutes(controller));

      const response = await request(app)
        [routeCase.method](routeCase.path)
        .expect(200);

      expect(response.body).toEqual({
        name: routeCase.handler,
        trace: [`scope:${routeCase.scope}`, `rate:${routeCase.rate}`],
      });
    }
  );

  it('registers static key-management routes before the dynamic key route', async () => {
    const app = express();
    app.use('/jwks', jwksRoutes(controller));

    const [rotate, retireExpired] = await Promise.all([
      request(app).post('/jwks/rotate'),
      request(app).post('/jwks/retire-expired'),
    ]);

    expect([rotate.body.name, retireExpired.body.name]).toEqual([
      'rotate',
      'retireExpired',
    ]);
  });
});
