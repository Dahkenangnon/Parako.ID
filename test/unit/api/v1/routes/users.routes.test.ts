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

import type { IUsersRouteController } from '../../../../../src/api/v1/routes/contracts.js';
import { userRoutes } from '../../../../../src/api/v1/routes/users.routes.js';
import { SCOPES } from '../../../../../src/api/v1/scopes.js';
import {
  createUserSchema,
  passwordResetSchema,
  updateUserSchema,
} from '../../../../../src/api/v1/validators/users.validator.js';

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
    schema === createUserSchema
      ? 'create'
      : schema === updateUserSchema
        ? 'update'
        : schema === passwordResetSchema
          ? 'passwordReset'
          : 'unexpected';
  return traceMiddleware(`body:${schemaName}`);
});

function handler(name: string) {
  return async (req: TracedRequest, res: Response): Promise<void> => {
    res.status(200).json({ name, trace: req.routeTrace });
  };
}

const controller: IUsersRouteController = {
  list: handler('list'),
  create: handler('create'),
  get: handler('get'),
  update: handler('update'),
  patch: handler('patch'),
  destroy: handler('destroy'),
  lock: handler('lock'),
  unlock: handler('unlock'),
  passwordReset: handler('passwordReset'),
  mfaReset: handler('mfaReset'),
  activities: handler('activities'),
  sessions: handler('sessions'),
};

type RouteCase = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  handler: string;
  scope: string;
  rate: string;
  bodySchema?: 'create' | 'update' | 'passwordReset';
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/users/',
    handler: 'list',
    scope: SCOPES.USERS_READ,
    rate: 'read',
  },
  {
    method: 'post',
    path: '/users/',
    handler: 'create',
    scope: SCOPES.USERS_WRITE,
    rate: 'write',
    bodySchema: 'create',
  },
  {
    method: 'get',
    path: '/users/user-1',
    handler: 'get',
    scope: SCOPES.USERS_READ,
    rate: 'read',
  },
  {
    method: 'put',
    path: '/users/user-1',
    handler: 'update',
    scope: SCOPES.USERS_WRITE,
    rate: 'write',
    bodySchema: 'update',
  },
  {
    method: 'patch',
    path: '/users/user-1',
    handler: 'patch',
    scope: SCOPES.USERS_WRITE,
    rate: 'write',
    bodySchema: 'update',
  },
  {
    method: 'delete',
    path: '/users/user-1',
    handler: 'destroy',
    scope: SCOPES.USERS_DELETE,
    rate: 'delete',
  },
  {
    method: 'post',
    path: '/users/user-1/lock',
    handler: 'lock',
    scope: SCOPES.USERS_WRITE,
    rate: 'write',
  },
  {
    method: 'delete',
    path: '/users/user-1/lock',
    handler: 'unlock',
    scope: SCOPES.USERS_WRITE,
    rate: 'write',
  },
  {
    method: 'post',
    path: '/users/user-1/password-reset',
    handler: 'passwordReset',
    scope: SCOPES.USERS_WRITE,
    rate: 'sensitive',
    bodySchema: 'passwordReset',
  },
  {
    method: 'post',
    path: '/users/user-1/mfa/reset',
    handler: 'mfaReset',
    scope: SCOPES.USERS_WRITE,
    rate: 'sensitive',
  },
  {
    method: 'get',
    path: '/users/user-1/activities',
    handler: 'activities',
    scope: SCOPES.USERS_READ,
    rate: 'read',
  },
  {
    method: 'get',
    path: '/users/user-1/sessions',
    handler: 'sessions',
    scope: SCOPES.SESSIONS_READ,
    rate: 'read',
  },
];

describe('userRoutes', () => {
  it.each(routeCases)(
    'wires $method $path through the expected security chain',
    async routeCase => {
      const app = express();
      app.use('/users', userRoutes(controller));

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

  it('keeps user actions and child resources distinct from the single-user route', async () => {
    const app = express();
    app.use('/users', userRoutes(controller));

    const [lock, passwordReset, mfaReset, activities, sessions] =
      await Promise.all([
        request(app).post('/users/user-1/lock'),
        request(app).post('/users/user-1/password-reset'),
        request(app).post('/users/user-1/mfa/reset'),
        request(app).get('/users/user-1/activities'),
        request(app).get('/users/user-1/sessions'),
      ]);

    expect([
      lock.body.name,
      passwordReset.body.name,
      mfaReset.body.name,
      activities.body.name,
      sessions.body.name,
    ]).toEqual(['lock', 'passwordReset', 'mfaReset', 'activities', 'sessions']);
  });
});
