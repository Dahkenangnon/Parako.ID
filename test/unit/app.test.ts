import { resolve } from 'node:path';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import nunjucks from 'nunjucks';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Application } from '../../src/app.js';
import { HARDENING } from '../../src/config/hardening-defaults.js';
import type { IConfigManager } from '../../src/di/interfaces/config-manager.interface.js';
import type { IDatabaseConnectionManager } from '../../src/di/interfaces/database-connection-manager.interface.js';
import type { IFileSystemUtils } from '../../src/di/interfaces/file-system-utils.interface.js';
import type { ILocalsMiddleware } from '../../src/di/interfaces/locals-middleware.interface.js';
import type { ILogger } from '../../src/di/interfaces/logger.interface.js';
import type { IMainRoutesManager } from '../../src/di/interfaces/main-routes-manager.interface.js';
import type { IMetricsService } from '../../src/di/interfaces/metrics-service.interface.js';
import type { IOidcManager } from '../../src/di/interfaces/oidc-manager.interface.js';
import type { IRequestLoggerMiddleware } from '../../src/di/interfaces/request-logger-middleware.interface.js';
import type { ISecurityMiddleware } from '../../src/di/interfaces/security-middleware.interface.js';
import type { ISessionManager } from '../../src/di/interfaces/session-manager.interface.js';
import type { ITenantContextMiddleware } from '../../src/di/interfaces/tenant-context-middleware.interface.js';
import type { IUIMiddleware } from '../../src/di/interfaces/ui-middleware.interface.js';
import type { IViewResolver } from '../../src/di/interfaces/view-resolver.interface.js';

interface RateLimitOptions {
  max?: () => Promise<number>;
  skip?: (req: Request) => boolean;
  handler?: (
    req: Request,
    res: Response,
    next: NextFunction,
    options: { statusCode: number; message?: string }
  ) => void;
}

interface CompressionOptions {
  filter?: (req: Request, res: Response) => boolean;
}

const boundaryState = vi.hoisted(() => ({
  compressionFilterResult: true,
  compressionOptions: [] as CompressionOptions[],
  configuredNunjucks: [] as unknown[],
  htmlErrors: [] as unknown[],
  mediaCalls: [] as Array<{
    basePath: string;
    secret: string;
  }>,
  mongoSanitizeOptions: [] as Array<{
    onSanitize?: (event: { req: Request; key: string }) => void;
  }>,
  precompressedRoots: [] as string[],
  rateLimitOptions: [] as RateLimitOptions[],
  shuttingDown: false,
  strictTenantModeCalls: 0,
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn((options: RateLimitOptions) => {
    boundaryState.rateLimitOptions.push(options);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }),
}));

vi.mock('compression', () => {
  const compression = Object.assign(
    vi.fn((options: CompressionOptions) => {
      boundaryState.compressionOptions.push(options);
      return (_req: Request, _res: Response, next: NextFunction) => next();
    }),
    {
      filter: vi.fn(() => boundaryState.compressionFilterResult),
    }
  );
  return { default: compression };
});

vi.mock('../../src/middlewares/precompressed-static.middleware.js', () => ({
  createPrecompressedStaticMiddleware: vi.fn((root: string) => {
    boundaryState.precompressedRoots.push(root);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }),
}));

vi.mock('../../src/routes/media.js', () => ({
  createMediaFileRoutes: vi.fn((basePath: string, secret: string) => {
    boundaryState.mediaCalls.push({ basePath, secret });
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }),
}));

vi.mock('../../src/middlewares/mongo-sanitize.middleware.js', () => ({
  default: vi.fn(
    (options: {
      onSanitize?: (event: { req: Request; key: string }) => void;
    }) => {
      boundaryState.mongoSanitizeOptions.push(options);
      return (_req: Request, _res: Response, next: NextFunction) => next();
    }
  ),
}));

vi.mock('../../src/utils/views.js', () => ({
  configureNunjucks: vi.fn((environment: unknown) => {
    boundaryState.configuredNunjucks.push(environment);
  }),
}));

vi.mock('../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    enableStrictMode: vi.fn(() => {
      boundaryState.strictTenantModeCalls += 1;
    }),
  },
}));

vi.mock('../../src/utils/shutdown.js', () => ({
  isShuttingDown: vi.fn(() => boundaryState.shuttingDown),
}));

vi.mock('../../src/middlewares/html-error-handler.middleware.js', () => ({
  createHtmlErrorHandler: vi.fn(
    () =>
      (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        boundaryState.htmlErrors.push(error);
        res.status(500).json({ status: 'html_error' });
      }
  ),
}));

const passThrough = (_req: Request, _res: Response, next: NextFunction) => {
  next();
};

function createApplication(
  options: {
    environment?: string;
    metricsEnabled?: boolean;
    metricsGet?: () => Promise<string>;
    multiTenancyEnabled?: boolean;
    oidcPath?: string;
    oidcStart?: (app: express.Express) => Promise<void>;
    ping?: () => Promise<boolean>;
    isConnected?: () => boolean;
    registerRoutes?: (app: express.Express) => void;
    trustProxyHops?: number;
    uploadDir?: string;
    viewConfigurationFails?: boolean;
  } = {}
) {
  const config = {
    deployment: {
      environment: options.environment ?? 'test',
      server: {
        allowed_origins: [] as string[],
        dev_allowed_origins: ['http://localhost:3000'],
        trust_proxy_hops: options.trustProxyHops ?? 1,
      },
    },
    security: {
      protection: {
        rate_limiting: {
          enabled: false,
          requests_per_minute: 100,
          window_minutes: 15,
        },
      },
      secrets: { cookie_secrets: ['unit-test-cookie-secret'] },
    },
    features: {
      metrics: { path: '/metrics' },
      multi_tenancy: {
        enabled: options.multiTenancyEnabled ?? false,
        tenant_header: 'x-tenant-id',
      },
    },
    integrations: {
      file_storage: { upload_dir: options.uploadDir ?? 'runtime/uploads' },
    },
    oidc: { path: options.oidcPath ?? '/oidc/v1' },
  };

  const configManager = {
    getConfig: vi.fn(() => config),
  };
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
  const nunjucksEnvironment = {} as nunjucks.Environment;
  const viewResolver = {
    views: {
      errors: {
        notfound: 'error/404.njk',
        server_error: 'error/500.njk',
      },
    },
    configureExpressViews: vi.fn((app: express.Express) => {
      if (options.viewConfigurationFails) return null;
      app.set('views', resolve(process.cwd(), 'src/views'));
      app.engine('njk', (_filePath, renderOptions, callback) => {
        const view = renderOptions as Record<string, unknown>;
        callback(
          null,
          JSON.stringify({
            message: view.message,
            title: view.title,
            url: view.url,
          })
        );
      });
      return nunjucksEnvironment;
    }),
  };
  const sessionManager = {
    initialize: vi.fn(),
    activityTracker: vi.fn(() => passThrough),
    sessionBindingValidator: vi.fn(() => passThrough),
    idleTimeoutMiddleware: vi.fn(() => passThrough),
    absoluteTimeoutMiddleware: vi.fn(() => passThrough),
    flashMiddleware: vi.fn(() => passThrough),
    flash: vi.fn(),
  };
  const localsMiddleware = {
    configLocals: passThrough,
    buildRoutes: passThrough,
  };
  const uiMiddleware = {
    setAllUILocals: passThrough,
    initI18n: passThrough,
    handleLanguage: passThrough,
    addI18nHelpers: passThrough,
  };
  const securityMiddleware = {
    generateCsrfToken: passThrough,
  };
  const mainRoutesManager = {
    registerLocaleExtractor: vi.fn(),
    registerRoutes: vi.fn(options.registerRoutes ?? (() => undefined)),
  };
  const oidcManager = {
    start: vi.fn(options.oidcStart ?? (async () => undefined)),
  };
  const fileSystem = {
    rootDir: process.cwd(),
  };
  const requestLogger = {
    handler: passThrough,
  };
  const database = {
    isConnected: vi.fn(options.isConnected ?? (() => true)),
    ping: vi.fn(options.ping ?? (async () => true)),
  };
  const metrics = {
    isEnabled: vi.fn(() => options.metricsEnabled ?? false),
    getMetrics: vi.fn(options.metricsGet ?? (async () => '# metrics\n')),
    getContentType: vi.fn(() => 'text/plain; version=0.0.4'),
  };
  const tenantContextMiddleware = {
    handler: passThrough,
  };

  const application = new Application(
    configManager as unknown as IConfigManager,
    logger as unknown as ILogger,
    viewResolver as unknown as IViewResolver,
    sessionManager as unknown as ISessionManager,
    localsMiddleware as unknown as ILocalsMiddleware,
    uiMiddleware as unknown as IUIMiddleware,
    securityMiddleware as unknown as ISecurityMiddleware,
    mainRoutesManager as unknown as IMainRoutesManager,
    oidcManager as unknown as IOidcManager,
    fileSystem as unknown as IFileSystemUtils,
    requestLogger as unknown as IRequestLoggerMiddleware,
    database as unknown as IDatabaseConnectionManager,
    metrics as unknown as IMetricsService,
    tenantContextMiddleware as unknown as ITenantContextMiddleware
  );

  return {
    application,
    config,
    configManager,
    database,
    fileSystem,
    localsMiddleware,
    logger,
    mainRoutesManager,
    metrics,
    nunjucksEnvironment,
    oidcManager,
    requestLogger,
    securityMiddleware,
    sessionManager,
    tenantContextMiddleware,
    uiMiddleware,
    viewResolver,
  };
}

describe('Application', () => {
  beforeEach(() => {
    boundaryState.compressionFilterResult = true;
    boundaryState.compressionOptions.length = 0;
    boundaryState.configuredNunjucks.length = 0;
    boundaryState.htmlErrors.length = 0;
    boundaryState.mediaCalls.length = 0;
    boundaryState.mongoSanitizeOptions.length = 0;
    boundaryState.precompressedRoots.length = 0;
    boundaryState.rateLimitOptions.length = 0;
    boundaryState.shuttingDown = false;
    boundaryState.strictTenantModeCalls = 0;
  });

  it('reports a rejected database readiness ping as unavailable JSON', async () => {
    const { application, logger } = createApplication({
      ping: async () => {
        throw new Error('database temporarily unavailable');
      },
    });
    const app = await application.initialize();

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
    expect(response.type).toMatch(/json/);
    expect(response.body).toMatchObject({ status: 'db_disconnected' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Readiness database check failed',
      { error: 'database temporarily unavailable' }
    );
  });

  it('initializes the composition root exactly once', async () => {
    const {
      application,
      mainRoutesManager,
      nunjucksEnvironment,
      oidcManager,
      sessionManager,
      viewResolver,
    } = createApplication();

    expect(application.isInitialized).toBe(false);

    const first = await application.initialize();
    const second = await application.initialize();

    expect(second).toBe(first);
    expect(application.isInitialized).toBe(true);
    expect(first.enabled('x-powered-by')).toBe(false);
    expect(first.get('env')).toBe('test');
    expect(first.get('strict routing')).toBe(false);
    expect(first.get('etag')).toBe('weak');
    expect(first.get('json escape')).toBe(true);
    expect(first.get('view engine')).toBe('njk');
    expect(first.get('view cache')).toBe(false);
    expect(viewResolver.configureExpressViews).toHaveBeenCalledOnce();
    expect(boundaryState.configuredNunjucks).toEqual([nunjucksEnvironment]);
    expect(sessionManager.initialize).toHaveBeenCalledOnce();
    expect(mainRoutesManager.registerLocaleExtractor).toHaveBeenCalledOnce();
    expect(mainRoutesManager.registerRoutes).toHaveBeenCalledOnce();
    expect(oidcManager.start).toHaveBeenCalledOnce();
  });

  it('leaves provider request bodies unread while parsing Parako interaction forms', async () => {
    const { application } = createApplication({
      oidcStart: async app => {
        app.post('/oidc/v1/token', (req, res) => {
          res.json({ body: req.body ?? null, readable: req.readable });
        });
        app.post('/oidc/v1/interaction/test/login', (req, res) => {
          res.json({ body: req.body ?? null, readable: req.readable });
        });
      },
    });
    const app = await application.initialize();

    const providerRequest = await request(app)
      .post('/oidc/v1/token')
      .type('form')
      .send({ grant_type: 'authorization_code' });
    expect(providerRequest.status).toBe(200);
    expect(providerRequest.body).toEqual({ body: null, readable: true });

    const interactionRequest = await request(app)
      .post('/oidc/v1/interaction/test/login')
      .type('form')
      .send({ username: 'alice@example.test' });
    expect(interactionRequest.status).toBe(200);
    expect(interactionRequest.body).toEqual({
      body: { username: 'alice@example.test' },
      readable: false,
    });
  });

  it('leaves OIDC CORS response handling to the provider', async () => {
    const { application } = createApplication({
      oidcStart: async app => {
        app.get('/oidc/v1/userinfo', (_req, res) => {
          const upstreamCorsHeaders = Object.keys(res.getHeaders()).filter(
            header => header.startsWith('access-control-')
          );
          res.status(upstreamCorsHeaders.length === 0 ? 200 : 409).json({
            upstreamCorsHeaders,
          });
        });
      },
    });
    const app = await application.initialize();

    const response = await request(app)
      .get('/oidc/v1/userinfo')
      .set('Origin', 'https://registered-rp.example.test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ upstreamCorsHeaders: [] });
  });

  it('uses the standard OIDC path when a legacy configuration leaves it blank', async () => {
    const { application } = createApplication({
      oidcPath: '',
      oidcStart: async app => {
        app.post('/oidc/v1/token', (req, res) => {
          res.json({ body: req.body ?? null, readable: req.readable });
        });
      },
    });
    const app = await application.initialize();

    const response = await request(app)
      .post('/oidc/v1/token')
      .type('form')
      .send({ grant_type: 'authorization_code' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ body: null, readable: true });
  });

  it('logs and rethrows a view-engine initialization failure', async () => {
    const { application, logger, oidcManager } = createApplication({
      viewConfigurationFails: true,
    });

    await expect(application.initialize()).rejects.toThrow(
      'Failed to configure Nunjucks environment'
    );

    expect(application.isInitialized).toBe(false);
    expect(oidcManager.start).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      step: 'initialization',
    });
  });

  it('logs the OIDC boundary and application initialization contexts on failure', async () => {
    const failure = new Error('provider failed');
    const { application, logger } = createApplication({
      oidcStart: async () => {
        throw failure;
      },
    });

    await expect(application.initialize()).rejects.toBe(failure);

    expect(application.isInitialized).toBe(false);
    expect(logger.error).toHaveBeenNthCalledWith(1, failure, {
      step: 'oidc_initialization',
    });
    expect(logger.error).toHaveBeenNthCalledWith(2, failure, {
      step: 'initialization',
    });
  });

  it('serves liveness and each database readiness state', async () => {
    const { application, database } = createApplication();
    const app = await application.initialize();

    const liveness = await request(app).get('/health');
    expect(liveness.status).toBe(200);
    expect(liveness.body).toMatchObject({ status: 'ok' });
    expect(liveness.body.timestamp).toEqual(expect.any(String));

    database.isConnected.mockReturnValue(false);
    const disconnected = await request(app).get('/health?deep=true');
    expect(disconnected.status).toBe(503);
    expect(disconnected.body).toMatchObject({
      status: 'degraded',
      checks: { database: 'disconnected' },
    });

    database.isConnected.mockReturnValue(true);
    database.ping.mockResolvedValue(false);
    const unreachable = await request(app).get('/health?deep=true');
    expect(unreachable.status).toBe(503);
    expect(unreachable.body).toMatchObject({
      status: 'degraded',
      checks: { database: 'unreachable' },
    });

    database.ping.mockResolvedValue(true);
    const ready = await request(app).get('/health?deep=true');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });

    database.ping.mockRejectedValueOnce(new Error('ping failed'));
    const errored = await request(app).get('/health?deep=true');
    expect(errored.status).toBe(503);
    expect(errored.body).toMatchObject({
      status: 'error',
      checks: { database: 'error' },
    });
  });

  it('serves every readiness-probe state without querying during shutdown', async () => {
    const { application, database } = createApplication();
    const app = await application.initialize();

    database.isConnected.mockReturnValue(false);
    const disconnected = await request(app).get('/readyz');
    expect(disconnected.status).toBe(503);
    expect(disconnected.body.status).toBe('db_disconnected');

    database.isConnected.mockReturnValue(true);
    database.ping.mockResolvedValue(false);
    const unreachable = await request(app).get('/readyz');
    expect(unreachable.status).toBe(503);
    expect(unreachable.body.status).toBe('db_disconnected');

    database.ping.mockResolvedValue(true);
    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');

    database.isConnected.mockClear();
    database.ping.mockClear();
    boundaryState.shuttingDown = true;
    const shuttingDown = await request(app).get('/readyz');
    expect(shuttingDown.status).toBe(503);
    expect(shuttingDown.body.status).toBe('shutting_down');
    expect(database.isConnected).not.toHaveBeenCalled();
    expect(database.ping).not.toHaveBeenCalled();
  });

  it('normalizes a non-Error readiness rejection before logging it', async () => {
    const { application, logger } = createApplication({
      ping: async () => Promise.reject('adapter offline'),
    });
    const app = await application.initialize();

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith(
      'Readiness database check failed',
      { error: 'adapter offline' }
    );
  });

  it('times out stalled database checks for both health endpoints', async () => {
    const { application } = createApplication({
      ping: () => new Promise<boolean>(() => undefined),
    });
    const app = await application.initialize();

    const health = await request(app).get('/health?deep=true');
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({
      status: 'degraded',
      checks: { database: 'unreachable' },
    });

    const readiness = await request(app).get('/readyz');
    expect(readiness.status).toBe(503);
    expect(readiness.body.status).toBe('db_disconnected');
  }, 10_000);

  it('exposes metrics only when enabled and contains collection failures', async () => {
    const { application, logger, metrics } = createApplication({
      metricsEnabled: true,
    });
    const app = await application.initialize();

    const success = await request(app).get('/metrics');
    expect(success.status).toBe(200);
    expect(success.headers['content-type']).toContain('text/plain');
    expect(success.text).toBe('# metrics\n');
    expect(metrics.getContentType).toHaveBeenCalledOnce();

    const failure = new Error('metrics unavailable');
    metrics.getMetrics.mockRejectedValueOnce(failure);
    const errored = await request(app).get('/metrics');
    expect(errored.status).toBe(500);
    expect(errored.text).toBe('');
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'metrics_endpoint',
    });
  });

  it('does not mount a metrics route when metrics are disabled', async () => {
    const { application, metrics } = createApplication();
    const app = await application.initialize();

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(404);
    expect(metrics.getMetrics).not.toHaveBeenCalled();
  });

  it('adds request path and year locals before application routes', async () => {
    const { application } = createApplication({
      registerRoutes: app => {
        app.get('/locals-check', (req, res) => {
          res.json({
            currentYear: res.locals.currentYear,
            reqPath: res.locals.reqPath,
            requestPath: req.path,
          });
        });
      },
    });
    const app = await application.initialize();

    const response = await request(app).get('/locals-check');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      currentYear: new Date().getFullYear(),
      reqPath: '/locals-check',
      requestPath: '/locals-check',
    });
  });

  it('uses live rate-limit configuration and exempts only static assets', async () => {
    const { application, config, logger } = createApplication();
    await application.initialize();
    const limiter = boundaryState.rateLimitOptions.at(-1);

    expect(limiter?.max).toBeTypeOf('function');
    expect(limiter?.skip).toBeTypeOf('function');
    expect(limiter?.handler).toBeTypeOf('function');
    expect(await limiter?.max?.()).toBe(100);

    config.security.protection.rate_limiting.requests_per_minute = 37;
    expect(await limiter?.max?.()).toBe(37);

    const requestFor = (path: string) => ({ path }) as Request;
    expect(limiter?.skip?.(requestFor('/authorize'))).toBe(true);

    config.security.protection.rate_limiting.enabled = true;
    expect(limiter?.skip?.(requestFor('/favicon.ico'))).toBe(true);
    expect(limiter?.skip?.(requestFor('/css/app.css'))).toBe(true);
    expect(limiter?.skip?.(requestFor('/authorize'))).toBe(false);

    const status = vi.fn();
    const type = vi.fn();
    const send = vi.fn();
    const response = { status, type, send } as unknown as Response;
    status.mockReturnValue(response);
    type.mockReturnValue(response);
    const limitedRequest = {
      ip: '192.0.2.10',
      originalUrl: '/authorize',
    } as Request;

    limiter?.handler?.(limitedRequest, response, vi.fn(), {
      statusCode: 429,
      message: 'Slow down',
    });
    expect(status).toHaveBeenCalledWith(429);
    expect(type).toHaveBeenCalledWith('text/plain');
    expect(send).toHaveBeenLastCalledWith('Slow down');

    limiter?.handler?.(limitedRequest, response, vi.fn(), {
      statusCode: 429,
      message: '',
    });
    expect(send).toHaveBeenLastCalledWith(
      'Too many requests, please try again later.'
    );
    expect(logger.warn).toHaveBeenCalledWith('rate_limit_exceeded', {
      ip: '192.0.2.10',
      path: '/authorize',
    });
  });

  it('applies the hardened compression filter to headers and content types', async () => {
    const { application } = createApplication();
    await application.initialize();
    const filter = boundaryState.compressionOptions.at(-1)?.filter;
    expect(filter).toBeTypeOf('function');

    const responseHeader = vi.fn();
    const response = { getHeader: responseHeader } as unknown as Response;

    expect(
      filter?.(
        { headers: { 'x-no-compression': '1' } } as unknown as Request,
        response
      )
    ).toBe(false);

    responseHeader.mockReturnValue('text/html; charset=utf-8');
    expect(filter?.({ headers: {} } as Request, response)).toBe(false);

    responseHeader.mockReturnValue(123);
    boundaryState.compressionFilterResult = false;
    expect(filter?.({ headers: {} } as Request, response)).toBe(false);

    const compressionHardening = HARDENING.compression as {
      compressHtml: boolean;
    };
    const originalCompressHtml = compressionHardening.compressHtml;
    compressionHardening.compressHtml = true;
    boundaryState.compressionFilterResult = true;
    try {
      responseHeader.mockReturnValue('text/html');
      expect(filter?.({ headers: {} } as Request, response)).toBe(true);
    } finally {
      compressionHardening.compressHtml = originalCompressHtml;
    }
  });

  it('enforces HTTPS in production while honoring the explicit forwarded protocol', async () => {
    const { application, logger } = createApplication({
      environment: 'production',
      trustProxyHops: 0,
      registerRoutes: app => {
        app.get('/probe', (_req, res) => res.send('ok'));
      },
    });
    const app = await application.initialize();

    const redirected = await request(app)
      .get('/probe?check=1')
      .set('Host', 'id.example.test');
    expect(redirected.status).toBe(301);
    expect(redirected.headers.location).toBe(
      'https://id.example.test/probe?check=1'
    );

    const forwarded = await request(app)
      .get('/probe')
      .set('X-Forwarded-Proto', 'https');
    expect(forwarded.status).toBe(200);
    expect(forwarded.text).toBe('ok');
    expect(app.get('view cache')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'CORS allowlist is empty in production — cross-origin browser callers will be rejected'
    );
  });

  it('uses the safe trust-proxy default and accepts a configured production CORS origin', async () => {
    const { application, config, logger } = createApplication({
      environment: 'production',
    });
    Reflect.deleteProperty(config.deployment.server, 'trust_proxy_hops');
    config.deployment.server.allowed_origins = ['https://rp.example.test'];

    const app = await application.initialize();

    expect(app.get('trust proxy')).toBe(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('CORS allowlist is empty')
    );
  });

  it('falls back to the standard tenant header when none is configured', async () => {
    const { application, config } = createApplication();
    Reflect.deleteProperty(config.features.multi_tenancy, 'tenant_header');

    await expect(application.initialize()).resolves.toBe(application.app);
  });

  it('parses normal JSON and form bodies but skips the import upload path', async () => {
    const { application } = createApplication({
      registerRoutes: app => {
        app.post('/echo', (req, res) => res.json({ body: req.body }));
        app.post('/admin/settings/import/raw', (req, res) => {
          res.json({ hasBody: req.body !== undefined });
        });
      },
    });
    const app = await application.initialize();

    const json = await request(app).post('/echo').send({ value: 'json' });
    expect(json.status).toBe(200);
    expect(json.body).toEqual({ body: { value: 'json' } });

    const form = await request(app)
      .post('/echo')
      .type('form')
      .send({ value: 'form' });
    expect(form.status).toBe(200);
    expect(form.body).toEqual({ body: { value: 'form' } });

    const importRequest = await request(app)
      .post('/admin/settings/import/raw')
      .set('Content-Type', 'application/json')
      .send('{"value":"raw"}');
    expect(importRequest.status).toBe(200);
    expect(importRequest.body).toEqual({ hasBody: false });

    const invalidJson = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{invalid');
    expect(invalidJson.status).toBe(500);
    expect(invalidJson.body).toEqual({ status: 'html_error' });
    expect(boundaryState.htmlErrors.at(-1)).toBeInstanceOf(SyntaxError);
  });

  it('logs sanitized input metadata through the configured middleware callback', async () => {
    const { application, logger } = createApplication();
    await application.initialize();
    const onSanitize = boundaryState.mongoSanitizeOptions.at(-1)?.onSanitize;
    const sanitizedRequest = {
      ip: '192.0.2.20',
      originalUrl: '/auth/login',
      method: 'POST',
    } as Request;

    onSanitize?.({ req: sanitizedRequest, key: '$where' });

    expect(logger.warn).toHaveBeenCalledWith(
      'MongoDB injection attempt detected',
      {
        ip: '192.0.2.20',
        url: '/auth/login',
        method: 'POST',
        sanitizedField: '$where',
      }
    );
  });

  it('configures static caching and media paths for development and production', async () => {
    const staticSpy = vi
      .spyOn(express, 'static')
      .mockImplementation(
        (() => passThrough) as unknown as typeof express.static
      );
    try {
      const development = createApplication();
      await development.application.initialize();
      const developmentCall = staticSpy.mock.calls.at(-1);
      expect(developmentCall?.[1]).toMatchObject({
        maxAge: 0,
        immutable: false,
        etag: true,
      });
      expect(boundaryState.mediaCalls.at(-1)).toMatchObject({
        basePath: resolve(process.cwd(), 'runtime/uploads'),
        secret: 'unit-test-cookie-secret',
      });

      const production = createApplication({
        environment: 'production',
        uploadDir: '/srv/parako/uploads',
      });
      await production.application.initialize();
      const productionCall = staticSpy.mock.calls.at(-1);
      expect(productionCall?.[1]).toMatchObject({
        maxAge: HARDENING.static.maxAge,
        immutable: HARDENING.static.immutable,
        etag: true,
      });
      expect(boundaryState.mediaCalls.at(-1)).toMatchObject({
        basePath: '/srv/parako/uploads',
      });

      const setHeaders = productionCall?.[1]?.setHeaders;
      const setHeader = vi.fn();
      const staticResponse = { setHeader };
      setHeaders?.(
        staticResponse as never,
        `${process.cwd()}/public/manifest.json`,
        {} as never
      );
      setHeaders?.(
        staticResponse as never,
        `${process.cwd()}/public/service-worker.js`,
        {} as never
      );
      setHeaders?.(
        staticResponse as never,
        `${process.cwd()}/public/app.js`,
        {} as never
      );
      expect(setHeader).toHaveBeenCalledTimes(2);
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, no-cache'
      );
      expect(boundaryState.precompressedRoots).toHaveLength(2);
    } finally {
      staticSpy.mockRestore();
    }
  });

  it('runs request middleware in the security-sensitive order', async () => {
    const fixture = createApplication();
    const events: string[] = [];
    const record =
      (name: string): express.RequestHandler =>
      (_req, _res, next) => {
        events.push(name);
        next();
      };

    fixture.requestLogger.handler = record('request-logger');
    fixture.localsMiddleware.configLocals = record('config-locals');
    fixture.sessionManager.activityTracker.mockReturnValue(record('activity'));
    fixture.sessionManager.sessionBindingValidator.mockReturnValue(
      record('binding')
    );
    fixture.sessionManager.idleTimeoutMiddleware.mockReturnValue(
      record('idle')
    );
    fixture.sessionManager.absoluteTimeoutMiddleware.mockReturnValue(
      record('absolute')
    );
    fixture.sessionManager.flashMiddleware.mockReturnValue(record('flash'));
    fixture.securityMiddleware.generateCsrfToken = record('csrf');
    fixture.tenantContextMiddleware.handler = record('tenant');
    fixture.uiMiddleware.setAllUILocals = record('ui-locals');
    fixture.uiMiddleware.initI18n = record('i18n-init');
    fixture.uiMiddleware.handleLanguage = record('language');
    fixture.localsMiddleware.buildRoutes = record('build-routes');
    fixture.uiMiddleware.addI18nHelpers = record('i18n-helpers');
    fixture.mainRoutesManager.registerLocaleExtractor.mockImplementation(
      app => {
        app.use(record('locale-extractor'));
      }
    );
    fixture.mainRoutesManager.registerRoutes.mockImplementation(app => {
      app.get('/order', (_req, res) => {
        events.push('route');
        res.json({ events });
      });
    });

    const app = await fixture.application.initialize();
    const response = await request(app).get('/order');

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual([
      'request-logger',
      'config-locals',
      'activity',
      'binding',
      'idle',
      'absolute',
      'flash',
      'csrf',
      'tenant',
      'ui-locals',
      'locale-extractor',
      'i18n-init',
      'language',
      'build-routes',
      'i18n-helpers',
      'route',
    ]);
  });

  it('enables strict tenant context only for multi-tenant deployments', async () => {
    const singleTenant = createApplication();
    await singleTenant.application.initialize();
    expect(boundaryState.strictTenantModeCalls).toBe(0);

    const multiTenant = createApplication({ multiTenancyEnabled: true });
    await multiTenant.application.initialize();
    expect(boundaryState.strictTenantModeCalls).toBe(1);
    expect(multiTenant.logger.info).toHaveBeenCalledWith(
      'Tenant context strict mode enabled (multi-tenancy active)'
    );
  });

  it('formats API fallback errors by environment and delegates HTML errors', async () => {
    const development = createApplication({
      environment: 'development',
      registerRoutes: app => {
        app.get('/api/custom-error', (_req, _res, next) => {
          next(Object.assign(new Error('development detail'), { status: 418 }));
        });
        app.get('/html-error', (_req, _res, next) => {
          next(new Error('html failure'));
        });
      },
    });
    const developmentApp = await development.application.initialize();

    const apiError = await request(developmentApp).get('/api/custom-error');
    expect(apiError.status).toBe(418);
    expect(apiError.type).toMatch(/application\/problem\+json/);
    expect(apiError.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 418,
      detail: 'development detail',
    });
    expect(development.logger.error).toHaveBeenCalledWith(expect.any(Error), {
      method: 'GET',
      url: '/api/custom-error',
      context: 'api_fallback_error',
    });

    const htmlError = await request(developmentApp).get('/html-error');
    expect(htmlError.status).toBe(500);
    expect(htmlError.body).toEqual({ status: 'html_error' });
    expect(boundaryState.htmlErrors.at(-1)).toEqual(expect.any(Error));

    const notFound = await request(developmentApp).get('/missing-page');
    expect(notFound.status).toBe(404);
    expect(JSON.parse(notFound.text)).toMatchObject({
      title: 'Page Not Found',
      url: '/missing-page',
    });

    const production = createApplication({
      environment: 'production',
      registerRoutes: app => {
        app.get('/api/error', (_req, _res, next) => {
          next(new Error('private detail'));
        });
      },
    });
    const productionApp = await production.application.initialize();
    const hidden = await request(productionApp)
      .get('/api/error')
      .set('X-Forwarded-Proto', 'https');
    expect(hidden.status).toBe(500);
    expect(hidden.body.detail).toBe('An unexpected error occurred');
  });
});
