import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  accountRoutes: vi.fn(),
  adminRoutes: vi.fn(),
  authRoutes: vi.fn(),
  opsRoutes: vi.fn(),
  webauthnRoutes: vi.fn(),
}));

vi.mock('../../../src/routes/accounts.js', () => ({
  accountRoutes: routeMocks.accountRoutes,
}));
vi.mock('../../../src/routes/admin.js', () => ({
  adminRoutes: routeMocks.adminRoutes,
}));
vi.mock('../../../src/routes/auth.js', () => ({
  authRoutes: routeMocks.authRoutes,
}));
vi.mock('../../../src/routes/ops.js', () => ({
  opsRoutes: routeMocks.opsRoutes,
}));
vi.mock('../../../src/routes/webauthn.js', () => ({
  webauthnRoutes: routeMocks.webauthnRoutes,
}));

import { MainRoutesManager } from '../../../src/routes/index.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

interface ManagerOptions {
  apiV1Router?: express.Router;
  multiTenant?: boolean;
  opsSocialCallbackService?: object;
  opsTenantMiddleware?: object;
  platformAdminController?: object;
  platformTenantMiddleware?: object;
}

function makeManager(options: ManagerOptions = {}) {
  const configManager = {
    getConfig: vi.fn(() => ({
      application: {
        locales: {
          available: ['en', 'fr'],
        },
      },
      features: {
        multi_tenancy: {
          enabled: options.multiTenant ?? false,
        },
      },
      deployment: {
        routes: {
          auth: '/auth',
          accounts: '/accounts',
          api: '/api/v1',
          auth_routes: {
            login: '/login',
          },
        },
      },
    })),
  };

  const manager = new MainRoutesManager(
    configManager as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    options.opsTenantMiddleware as never,
    options.opsSocialCallbackService as never,
    {} as never,
    options.platformAdminController as never,
    options.platformTenantMiddleware as never,
    options.apiV1Router as never,
    {} as never
  );

  return { configManager, manager };
}

function markerRouter(name: string): express.Router {
  const router = express.Router();
  router.use((req, res) => {
    res.json({ name, baseUrl: req.baseUrl });
  });
  return router;
}

describe('MainRoutesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.accountRoutes.mockReturnValue(express.Router());
    routeMocks.adminRoutes.mockReturnValue(express.Router());
    routeMocks.authRoutes.mockReturnValue(express.Router());
    routeMocks.opsRoutes.mockReturnValue(express.Router());
    routeMocks.webauthnRoutes.mockReturnValue(express.Router());
  });

  it('extracts a configured locale from the first URL path segment', () => {
    const { configManager, manager } = makeManager();
    const app = { use: vi.fn() };
    const next = vi.fn();
    const request = {
      originalUrl: '/fr/accounts?tab=security',
      url: '/fr/accounts?tab=security',
      path: '/fr/accounts',
    } as { extractedLocale?: string } & Record<string, string>;

    manager.registerLocaleExtractor(app as never);
    const extractor = app.use.mock.calls[0]?.[0];
    expect(extractor).toBeTypeOf('function');

    extractor(request, {}, next);

    expect(request.extractedLocale).toBe('fr');
    expect(next).toHaveBeenCalledOnce();
    expect(configManager.getConfig).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'request URL when original URL is empty',
      { originalUrl: '', url: '/en/accounts', path: '/ignored' },
      'en',
    ],
    [
      'request path when both URL fields are empty',
      { originalUrl: '', url: '', path: '/fr/accounts' },
      'fr',
    ],
    [
      'an unsupported locale',
      {
        originalUrl: '/de/accounts',
        url: '/de/accounts',
        path: '/de/accounts',
      },
      undefined,
    ],
    ['the root path', { originalUrl: '/', url: '/', path: '/' }, undefined],
  ])('delegates after inspecting %s', (_description, request, expected) => {
    const { manager } = makeManager();
    const app = { use: vi.fn() };
    const next = vi.fn();

    manager.registerLocaleExtractor(app as never);
    const extractor = app.use.mock.calls[0]?.[0];
    expect(extractor).toBeTypeOf('function');

    extractor(request, {}, next);

    expect(request).toEqual(
      expected
        ? expect.objectContaining({ extractedLocale: expected })
        : expect.not.objectContaining({ extractedLocale: expect.anything() })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['the unlocalized root', '/', '/auth/login'],
    ['a configured locale root', '/fr', '/fr/auth/login'],
  ])('redirects %s to login', async (_description, path, location) => {
    const { manager } = makeManager();
    const app = express();

    manager.registerRoutes(app);

    await request(app).get(path).expect(302).expect('location', location);
  });

  it('allows an unsupported locale root to fall through', async () => {
    const { manager } = makeManager();
    const app = express();

    manager.registerRoutes(app);

    await request(app).get('/de').expect(404);
  });

  it('mounts application routers at default and localized prefixes', async () => {
    routeMocks.authRoutes.mockReturnValue(markerRouter('auth'));
    routeMocks.accountRoutes.mockReturnValue(markerRouter('account'));
    routeMocks.webauthnRoutes.mockReturnValue(markerRouter('webauthn'));
    routeMocks.adminRoutes.mockReturnValue(markerRouter('admin'));
    const { manager } = makeManager();
    const app = express();

    manager.registerRoutes(app);

    const expectations = [
      ['/auth/probe', 'auth', '/auth'],
      ['/fr/auth/probe', 'auth', '/fr/auth'],
      ['/accounts/probe', 'account', '/accounts'],
      ['/fr/accounts/probe', 'account', '/fr/accounts'],
      ['/api/v1/webauthn/probe', 'webauthn', '/api/v1/webauthn'],
      ['/fr/api/v1/webauthn/probe', 'webauthn', '/fr/api/v1/webauthn'],
      ['/admin/probe', 'admin', '/admin'],
      ['/fr/admin/probe', 'admin', '/fr/admin'],
    ] as const;

    for (const [path, name, baseUrl] of expectations) {
      await request(app).get(path).expect(200, { name, baseUrl });
    }
    expect(routeMocks.authRoutes).toHaveBeenCalledOnce();
    expect(routeMocks.accountRoutes).toHaveBeenCalledOnce();
    expect(routeMocks.webauthnRoutes).toHaveBeenCalledOnce();
    expect(routeMocks.adminRoutes).toHaveBeenCalledOnce();
  });

  it('passes platform management dependencies only in multi-tenant mode', () => {
    const platformAdminController = { dashboard: vi.fn() };
    const platformTenantMiddleware = { handler: vi.fn() };
    const multiTenant = makeManager({
      multiTenant: true,
      platformAdminController,
      platformTenantMiddleware,
    });
    const singleTenant = makeManager({
      platformAdminController,
      platformTenantMiddleware,
    });
    const multiTenantWithoutPlatformDependencies = makeManager({
      multiTenant: true,
    });
    const multiApp = { get: vi.fn(), use: vi.fn() };
    const singleApp = { get: vi.fn(), use: vi.fn() };
    const missingDependenciesApp = { get: vi.fn(), use: vi.fn() };

    multiTenant.manager.registerRoutes(multiApp as never);
    singleTenant.manager.registerRoutes(singleApp as never);
    multiTenantWithoutPlatformDependencies.manager.registerRoutes(
      missingDependenciesApp as never
    );

    expect(routeMocks.adminRoutes.mock.calls[0]?.slice(-2)).toEqual([
      platformAdminController,
      platformTenantMiddleware,
    ]);
    expect(routeMocks.adminRoutes.mock.calls[1]?.slice(-2)).toEqual([
      undefined,
      undefined,
    ]);
    expect(routeMocks.adminRoutes.mock.calls[2]?.slice(-2)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('routes browser WebAuthn APIs before the bearer-authenticated Management API', async () => {
    routeMocks.webauthnRoutes.mockReturnValue(markerRouter('webauthn'));
    const apiV1Router = express.Router();
    apiV1Router.use((_req, res) => res.sendStatus(401));
    const { manager } = makeManager({ apiV1Router });
    const app = express();

    manager.registerRoutes(app);

    await request(app)
      .get('/api/v1/webauthn/credentials')
      .expect(200, { name: 'webauthn', baseUrl: '/api/v1/webauthn' });
  });

  it('dispatches infrastructure requests only inside the _ops tenant context', () => {
    const opsTenantMiddleware = { handler: vi.fn() };
    const opsSocialCallbackService = { handleCallback: vi.fn() };
    const opsRouter = vi.fn();
    routeMocks.opsRoutes.mockReturnValue(opsRouter);
    const { manager } = makeManager({
      opsTenantMiddleware,
      opsSocialCallbackService,
    });
    const app = { get: vi.fn(), use: vi.fn() };

    manager.registerRoutes(app as never);

    const gate = app.use.mock.calls.find(
      ([firstArgument]) => typeof firstArgument === 'function'
    )?.[0];
    expect(gate).toBeTypeOf('function');
    expect(routeMocks.opsRoutes).toHaveBeenCalledExactlyOnceWith(
      opsTenantMiddleware,
      opsSocialCallbackService
    );

    const opsNext = vi.fn();
    const opsRequest = {};
    const opsResponse = {};
    tenantContext.run('_ops', () => gate(opsRequest, opsResponse, opsNext));
    expect(opsRouter).toHaveBeenCalledExactlyOnceWith(
      opsRequest,
      opsResponse,
      opsNext
    );
    expect(opsNext).not.toHaveBeenCalled();

    const tenantNext = vi.fn();
    tenantContext.run('tenant-a', () => gate({}, {}, tenantNext));
    expect(opsRouter).toHaveBeenCalledOnce();
    expect(tenantNext).toHaveBeenCalledOnce();
  });

  it('returns Problem Detail JSON for malformed Management API request bodies', async () => {
    const apiV1Router = express.Router();
    apiV1Router.post('/probe', (_req, res) => res.sendStatus(204));
    const { manager } = makeManager({ apiV1Router });
    const app = express();
    app.use(express.json());
    manager.registerRoutes(app);

    await request(app)
      .post('/api/v1/probe')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(400, {
        type: 'urn:parako:error:validation',
        title: 'Malformed JSON',
        status: 400,
        detail: 'Request body contains invalid JSON',
        instance: '/probe',
      });
  });

  it('returns Problem Detail JSON for oversized Management API request bodies', async () => {
    const apiV1Router = express.Router();
    apiV1Router.post('/probe', (_req, res) => res.sendStatus(204));
    const { manager } = makeManager({ apiV1Router });
    const app = express();
    app.use(express.json({ limit: '16b' }));
    manager.registerRoutes(app);

    await request(app)
      .post('/api/v1/probe')
      .send({ value: 'this body exceeds sixteen bytes' })
      .expect('Content-Type', /application\/problem\+json/)
      .expect(413, {
        type: 'urn:parako:error:body-too-large',
        title: 'Request Body Too Large',
        status: 413,
        detail: 'Request body exceeds maximum allowed size',
        instance: '/probe',
      });
  });

  it('recognizes a status-only oversized-body parser error', async () => {
    const apiV1Router = express.Router();
    const { manager } = makeManager({ apiV1Router });
    const app = express();
    app.use('/api/v1', (_req, _res, next) => {
      next({ type: 'custom.parser.error', status: 413 });
    });
    manager.registerRoutes(app);

    await request(app)
      .post('/api/v1/probe')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(413, {
        type: 'urn:parako:error:body-too-large',
        title: 'Request Body Too Large',
        status: 413,
        detail: 'Request body exceeds maximum allowed size',
        instance: '/probe',
      });
  });

  it('delegates unrelated Management API errors unchanged', async () => {
    const apiV1Router = express.Router();
    const upstreamError = new Error('unrelated upstream failure');
    const downstreamErrorHandler = vi.fn((err, _req, res, _next) => {
      res.status(521).json({ sameError: err === upstreamError });
    });
    const { manager } = makeManager({ apiV1Router });
    const app = express();
    app.use('/api/v1', (_req, _res, next) => next(upstreamError));
    manager.registerRoutes(app);
    app.use(downstreamErrorHandler);

    await request(app).get('/api/v1/probe').expect(521, { sameError: true });
    expect(downstreamErrorHandler).toHaveBeenCalledOnce();
  });
});
