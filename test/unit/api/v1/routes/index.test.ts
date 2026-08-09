import express, {
  Router,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeFactoryMocks = vi.hoisted(() => ({
  clientRoutes: vi.fn(),
  userRoutes: vi.fn(),
  sessionRoutes: vi.fn(),
  jwksRoutes: vi.fn(),
  auditRoutes: vi.fn(),
  statsRoutes: vi.fn(),
  tenantRoutes: vi.fn(),
  registrationTokenRoutes: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('../../../../../src/api/v1/routes/clients.routes.js', () => ({
  clientRoutes: routeFactoryMocks.clientRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/users.routes.js', () => ({
  userRoutes: routeFactoryMocks.userRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/sessions.routes.js', () => ({
  sessionRoutes: routeFactoryMocks.sessionRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/jwks.routes.js', () => ({
  jwksRoutes: routeFactoryMocks.jwksRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/audit.routes.js', () => ({
  auditRoutes: routeFactoryMocks.auditRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/stats.routes.js', () => ({
  statsRoutes: routeFactoryMocks.statsRoutes,
}));
vi.mock('../../../../../src/api/v1/routes/tenants.routes.js', () => ({
  tenantRoutes: routeFactoryMocks.tenantRoutes,
}));
vi.mock(
  '../../../../../src/api/v1/routes/registration-tokens.routes.js',
  () => ({
    registrationTokenRoutes: routeFactoryMocks.registrationTokenRoutes,
  })
);
vi.mock('../../../../../src/api/v1/errors.js', () => ({
  notFound: routeFactoryMocks.notFound,
}));

import {
  createApiV1Router,
  type ApiV1Dependencies,
} from '../../../../../src/api/v1/routes/index.js';

type TracedRequest = Request & { routeTrace?: string[] };

function traceMiddleware(label: string): RequestHandler {
  return (req: TracedRequest, _res: Response, next: NextFunction) => {
    req.routeTrace ??= [];
    req.routeTrace.push(label);
    next();
  };
}

function domainRouter(domain: string): Router {
  const router = Router();
  router.use((req: TracedRequest, res: Response) => {
    res.status(200).json({ domain, trace: req.routeTrace });
  });
  return router;
}

const unusedHandler: RequestHandler = (_req, _res, next) => next();

function createDependencies(): ApiV1Dependencies {
  const jwtAuth = traceMiddleware('jwt');
  const auditLogger = traceMiddleware('audit');
  const errorHandler: ErrorRequestHandler = (
    error: Error,
    req: TracedRequest,
    res: Response,
    _next: NextFunction
  ) => {
    res.status(404).json({ error: error.message, trace: req.routeTrace });
  };

  return {
    jwtAuth,
    auditLogger,
    errorHandler,
    clientsController: {
      list: unusedHandler,
      create: unusedHandler,
      get: unusedHandler,
      update: unusedHandler,
      patch: unusedHandler,
      destroy: unusedHandler,
      activate: unusedHandler,
      deactivate: unusedHandler,
      regenerateSecret: unusedHandler,
      stats: unusedHandler,
    },
    usersController: {
      list: unusedHandler,
      create: unusedHandler,
      get: unusedHandler,
      update: unusedHandler,
      patch: unusedHandler,
      destroy: unusedHandler,
      lock: unusedHandler,
      unlock: unusedHandler,
      passwordReset: unusedHandler,
      mfaReset: unusedHandler,
      activities: unusedHandler,
      sessions: unusedHandler,
    },
    sessionsController: {
      list: unusedHandler,
      get: unusedHandler,
      revoke: unusedHandler,
      bulkRevoke: unusedHandler,
    },
    jwksController: {
      list: unusedHandler,
      get: unusedHandler,
      rotate: unusedHandler,
      retireExpired: unusedHandler,
      retire: unusedHandler,
    },
    auditController: {
      list: unusedHandler,
      get: unusedHandler,
      types: unusedHandler,
      stats: unusedHandler,
    },
    statsController: {
      overview: unusedHandler,
      health: unusedHandler,
    },
    tenantsController: {
      list: unusedHandler,
      create: unusedHandler,
      get: unusedHandler,
      getConfig: unusedHandler,
      updateConfig: unusedHandler,
    },
    registrationTokensController: {
      list: unusedHandler,
      create: unusedHandler,
      get: unusedHandler,
      destroy: unusedHandler,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  routeFactoryMocks.clientRoutes.mockReturnValue(domainRouter('clients'));
  routeFactoryMocks.userRoutes.mockReturnValue(domainRouter('users'));
  routeFactoryMocks.sessionRoutes.mockReturnValue(domainRouter('sessions'));
  routeFactoryMocks.jwksRoutes.mockReturnValue(domainRouter('jwks'));
  routeFactoryMocks.auditRoutes.mockReturnValue(domainRouter('audit'));
  routeFactoryMocks.statsRoutes.mockReturnValue(domainRouter('stats'));
  routeFactoryMocks.tenantRoutes.mockReturnValue(domainRouter('tenants'));
  routeFactoryMocks.registrationTokenRoutes.mockReturnValue(
    domainRouter('registrationTokens')
  );
  routeFactoryMocks.notFound.mockImplementation(
    (message: string) => new Error(message)
  );
});

describe('createApiV1Router', () => {
  it.each([
    ['/api/v1/clients/', 'clients'],
    ['/api/v1/users/', 'users'],
    ['/api/v1/sessions/', 'sessions'],
    ['/api/v1/jwks/', 'jwks'],
    ['/api/v1/audit/', 'audit'],
    ['/api/v1/stats/', 'stats'],
    ['/api/v1/tenants/', 'tenants'],
    ['/api/v1/registration-tokens/', 'registrationTokens'],
  ] as const)(
    'applies global middleware before dispatching %s',
    async (path, domain) => {
      const app = express();
      app.use('/api/v1', createApiV1Router(createDependencies()));

      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({ domain, trace: ['jwt', 'audit'] });
      expect(routeFactoryMocks.notFound).not.toHaveBeenCalled();
    }
  );

  it('injects each controller into its matching domain route factory', () => {
    const dependencies = createDependencies();

    createApiV1Router(dependencies);

    expect(routeFactoryMocks.clientRoutes).toHaveBeenCalledWith(
      dependencies.clientsController
    );
    expect(routeFactoryMocks.userRoutes).toHaveBeenCalledWith(
      dependencies.usersController
    );
    expect(routeFactoryMocks.sessionRoutes).toHaveBeenCalledWith(
      dependencies.sessionsController
    );
    expect(routeFactoryMocks.jwksRoutes).toHaveBeenCalledWith(
      dependencies.jwksController
    );
    expect(routeFactoryMocks.auditRoutes).toHaveBeenCalledWith(
      dependencies.auditController
    );
    expect(routeFactoryMocks.statsRoutes).toHaveBeenCalledWith(
      dependencies.statsController
    );
    expect(routeFactoryMocks.tenantRoutes).toHaveBeenCalledWith(
      dependencies.tenantsController
    );
    expect(routeFactoryMocks.registrationTokenRoutes).toHaveBeenCalledWith(
      dependencies.registrationTokensController
    );
  });

  it.each(['/api/v1/missing', '/api/v1/'])(
    'passes unmatched path %s to the injected error handler',
    async path => {
      const app = express();
      app.use('/api/v1', createApiV1Router(createDependencies()));

      const response = await request(app).get(path).expect(404);

      expect(response.body).toEqual({
        error: `No endpoint matches GET ${path}`,
        trace: ['jwt', 'audit'],
      });
      expect(routeFactoryMocks.notFound).toHaveBeenCalledWith(
        `No endpoint matches GET ${path}`
      );
    }
  );
});
