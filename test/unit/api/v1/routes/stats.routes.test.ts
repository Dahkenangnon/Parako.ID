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

import type { IStatsRouteController } from '../../../../../src/api/v1/routes/index.js';
import { statsRoutes } from '../../../../../src/api/v1/routes/stats.routes.js';
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

const controller: IStatsRouteController = {
  overview: handler('overview'),
  health: handler('health'),
};

describe('statsRoutes', () => {
  it.each([
    ['/stats/', 'overview'],
    ['/stats/health', 'health'],
  ] as const)(
    'wires GET %s through the statistics read boundary',
    async (path, handlerName) => {
      const app = express();
      app.use('/stats', statsRoutes(controller));

      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        name: handlerName,
        trace: [`scope:${SCOPES.STATS_READ}`, 'rate:read'],
      });
    }
  );
});
