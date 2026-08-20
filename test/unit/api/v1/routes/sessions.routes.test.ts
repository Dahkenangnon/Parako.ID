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

import type { ISessionsRouteController } from '../../../../../src/api/v1/routes/contracts.js';
import { sessionRoutes } from '../../../../../src/api/v1/routes/sessions.routes.js';
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

const controller: ISessionsRouteController = {
  list: handler('list'),
  get: handler('get'),
  revoke: handler('revoke'),
  bulkRevoke: handler('bulkRevoke'),
};

type RouteCase = {
  method: 'get' | 'delete';
  path: string;
  handler: string;
  scope: string;
  rate: string;
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/sessions/',
    handler: 'list',
    scope: SCOPES.SESSIONS_READ,
    rate: 'read',
  },
  {
    method: 'get',
    path: '/sessions/session-1',
    handler: 'get',
    scope: SCOPES.SESSIONS_READ,
    rate: 'read',
  },
  {
    method: 'delete',
    path: '/sessions/session-1',
    handler: 'revoke',
    scope: SCOPES.SESSIONS_REVOKE,
    rate: 'delete',
  },
  {
    method: 'delete',
    path: '/sessions/',
    handler: 'bulkRevoke',
    scope: SCOPES.SESSIONS_REVOKE,
    rate: 'delete',
  },
];

describe('sessionRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/sessions', sessionRoutes(controller));

      const response = await request(app)
        [routeCase.method](routeCase.path)
        .expect(200);

      expect(response.body).toEqual({
        name: routeCase.handler,
        trace: [`scope:${routeCase.scope}`, `rate:${routeCase.rate}`],
      });
    }
  );
});
