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

import { auditRoutes } from '../../../../../src/api/v1/routes/audit.routes.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';
import type { IAuditRouteController } from '../../../../../src/api/v1/routes/contracts.js';

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

const controller: IAuditRouteController = {
  list: handler('list'),
  get: handler('get'),
  types: handler('types'),
  stats: handler('stats'),
};

describe('auditRoutes', () => {
  it.each([
    {
      path: '/audit/types',
      handler: 'types',
      scope: SCOPES.AUDIT_READ,
    },
    {
      path: '/audit/stats',
      handler: 'stats',
      scope: SCOPES.STATS_READ,
    },
    { path: '/audit/', handler: 'list', scope: SCOPES.AUDIT_READ },
    {
      path: '/audit/activity-123',
      handler: 'get',
      scope: SCOPES.AUDIT_READ,
    },
  ])(
    'wires GET $path through the expected scope and read limiter',
    async ({ path, handler: expectedHandler, scope }) => {
      const app = express();
      app.use('/audit', auditRoutes(controller));

      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        name: expectedHandler,
        trace: [`scope:${scope}`, 'rate:read'],
      });
    }
  );

  it('registers static routes before the dynamic activity route', async () => {
    const app = express();
    app.use('/audit', auditRoutes(controller));

    const [typesResponse, statsResponse] = await Promise.all([
      request(app).get('/audit/types'),
      request(app).get('/audit/stats'),
    ]);

    expect(typesResponse.body.name).toBe('types');
    expect(statsResponse.body.name).toBe('stats');
  });
});
