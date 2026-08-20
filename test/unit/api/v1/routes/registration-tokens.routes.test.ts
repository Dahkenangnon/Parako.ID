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

import { registrationTokenRoutes } from '../../../../../src/api/v1/routes/registration-tokens.routes.js';
import type { IRegistrationTokensRouteController } from '../../../../../src/api/v1/routes/contracts.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';
import { createRegistrationTokenSchema } from '../../../../../src/api/v1/validators/registration-tokens.validator.js';

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
middlewareMocks.validateBody.mockImplementation((schema: ZodType) =>
  traceMiddleware(
    `body:${schema === createRegistrationTokenSchema ? 'create' : 'unexpected'}`
  )
);

function handler(name: string) {
  return async (req: TracedRequest, res: Response): Promise<void> => {
    res.status(200).json({ name, trace: req.routeTrace });
  };
}

const controller: IRegistrationTokensRouteController = {
  list: handler('list'),
  create: handler('create'),
  get: handler('get'),
  destroy: handler('destroy'),
};

type RouteCase = {
  method: 'get' | 'post' | 'delete';
  path: string;
  handler: string;
  scope: string;
  rate: string;
  bodySchema?: 'create';
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/registration-tokens/',
    handler: 'list',
    scope: SCOPES.REGISTRATION_TOKENS_READ,
    rate: 'read',
  },
  {
    method: 'post',
    path: '/registration-tokens/',
    handler: 'create',
    scope: SCOPES.REGISTRATION_TOKENS_WRITE,
    rate: 'write',
    bodySchema: 'create',
  },
  {
    method: 'get',
    path: '/registration-tokens/token-1',
    handler: 'get',
    scope: SCOPES.REGISTRATION_TOKENS_READ,
    rate: 'read',
  },
  {
    method: 'delete',
    path: '/registration-tokens/token-1',
    handler: 'destroy',
    scope: SCOPES.REGISTRATION_TOKENS_DELETE,
    rate: 'delete',
  },
];

describe('registrationTokenRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/registration-tokens', registrationTokenRoutes(controller));

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
});
