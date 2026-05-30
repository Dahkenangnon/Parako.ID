import express, { Express } from 'express';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import { injectable, inject } from 'inversify';
import { TYPES } from './di/types.js';
import mongoSanitize from './middlewares/mongo-sanitize.middleware.js';
import { configureNunjucks } from './utils/views.js';
import type { IConfigManager } from './di/interfaces/config-manager.interface.js';
import type { ILogger } from './di/interfaces/logger.interface.js';
import type { IViewResolver } from './di/interfaces/view-resolver.interface.js';
import type { ISessionManager } from './di/interfaces/session-manager.interface.js';
import type { ILocalsMiddleware } from './di/interfaces/locals-middleware.interface.js';
import type { IUIMiddleware } from './di/interfaces/ui-middleware.interface.js';
import type { ISecurityMiddleware } from './di/interfaces/security-middleware.interface.js';
import type { IMainRoutesManager } from './di/interfaces/main-routes-manager.interface.js';
import type { IApplication } from './di/interfaces/application.interface.js';
import type { IOidcManager } from './di/interfaces/oidc-manager.interface.js';
import type { IFileSystemUtils } from './di/interfaces/file-system-utils.interface.js';
import type { IRequestLoggerMiddleware } from './di/interfaces/request-logger-middleware.interface.js';
import type { IDatabaseConnectionManager } from './di/interfaces/database-connection-manager.interface.js';
import type { IMetricsService } from './di/interfaces/metrics-service.interface.js';
import type { ITenantContextMiddleware } from './di/interfaces/tenant-context-middleware.interface.js';
import { tenantContext } from './multi-tenancy/tenant-context.js';
import { createMediaFileRoutes } from './routes/media.js';
import { HARDENING } from './config/hardening-defaults.js';
import { varyHeadersMiddleware } from './middlewares/vary-headers.middleware.js';

@injectable()
export class Application implements IApplication {
  public readonly app: Express;
  private nunjucksEnv: nunjucks.Environment | null = null;
  private _isInitialized = false;
  private readonly __dirname: string;
  private environment: string = '';
  private isDevelopment: boolean = false;
  private isProduction: boolean = false;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.LocalsMiddleware)
    private readonly localsMiddleware: ILocalsMiddleware,
    @inject(TYPES.UIMiddleware) private readonly uIMiddleware: IUIMiddleware,
    @inject(TYPES.SecurityMiddleware)
    private readonly securityMiddleware: ISecurityMiddleware,
    @inject(TYPES.MainRoutesManager)
    private readonly mainRoutesManager: IMainRoutesManager,
    @inject(TYPES.OidcManager) private readonly oidcManager: IOidcManager,
    @inject(TYPES.FileSystemUtils) private readonly fileSyst: IFileSystemUtils,
    @inject(TYPES.RequestLoggerMiddleware)
    private readonly requestLoggerMiddleware: IRequestLoggerMiddleware,
    @inject(TYPES.DatabaseConnectionManager)
    private readonly databaseConnectionManager: IDatabaseConnectionManager,
    @inject(TYPES.MetricsService)
    private readonly metricsService: IMetricsService,
    @inject(TYPES.TenantContextMiddleware)
    private readonly tenantContextMiddleware: ITenantContextMiddleware
  ) {
    this.__dirname = path.dirname(fileURLToPath(import.meta.url));
    this.app = express();
  }

  public async initialize(): Promise<Express> {
    if (this._isInitialized) {
      return this.app;
    }
    try {
      this.initializeEnvironment();

      // Public health endpoint (unauthenticated — for Docker/k8s probes)
      this.setupHealthEndpoint();

      // Prometheus metrics endpoint (unauthenticated — for scraping)
      this.setupMetricsEndpoint();

      this.configureBasicSettings();
      this.setupNunjucks();
      this.setupSecurity();
      this.setupMiddleware();
      this.setupSession();
      this.setupTenantContext();
      this.setupI18n();
      this.setupRoutes();
      await this.oidc();
      this.setupErrorHandling();

      this._isInitialized = true;
      this.logger.info('Application initialized successfully');

      return this.app;
    } catch (error) {
      this.logger.error(error as Error, { step: 'initialization' });
      throw error;
    }
  }

  /**
   * Public health endpoint for Docker/k8s probes.
   *
   * GET /health          — lightweight liveness check (no DB query)
   * GET /health?deep=true — readiness check with an actual DB ping
   *
   * Rate-limited to 30 req/min per IP to prevent abuse without blocking
   * legitimate orchestrator probes.
   */
  private setupHealthEndpoint(): void {
    // Lightweight per-IP rate limiter — in-memory, no Redis dependency
    const healthLimiter = rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: false,
      legacyHeaders: false,
      message: { status: 'rate_limited' },
    });

    this.app.get(
      '/health',
      healthLimiter as unknown as express.RequestHandler,
      async (req, res) => {
        const deep = req.query.deep === 'true';

        if (!deep) {
          // Liveness: fast in-memory check (is the process up?)
          const dbOk = this.databaseConnectionManager.isConnected();
          res.status(dbOk ? 200 : 503).json({
            status: dbOk ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Readiness: verify database connectivity with a timeout
        const timeoutMs = 3_000;
        try {
          const dbConnected = this.databaseConnectionManager.isConnected();
          // For deep check, also verify we can reach the DB instance
          let dbReachable = false;
          if (dbConnected) {
            try {
              const result = await Promise.race([
                (async () => {
                  this.databaseConnectionManager.getDB();
                  return true;
                })(),
                new Promise<false>(resolve =>
                  setTimeout(() => resolve(false), timeoutMs)
                ),
              ]);
              dbReachable = result;
            } catch {
              dbReachable = false;
            }
          }

          const ok = dbConnected && dbReachable;
          res.status(ok ? 200 : 503).json({
            status: ok ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            checks: {
              database: ok
                ? 'ok'
                : !dbConnected
                  ? 'disconnected'
                  : 'unreachable',
            },
          });
        } catch {
          res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            checks: { database: 'error' },
          });
        }
      }
    );
  }

  /**
   * Prometheus metrics endpoint for observability scraping.
   * Only mounted when metrics are enabled in configuration.
   * Rate-limited to 60 req/min per IP.
   */
  private setupMetricsEndpoint(): void {
    if (!this.metricsService.isEnabled()) return;

    const config = this.configManager.getConfig();
    const metricsLimiter = rateLimit({
      windowMs: 60_000,
      max: 60,
      standardHeaders: false,
      legacyHeaders: false,
      message: 'Too many requests to metrics endpoint',
    });

    this.app.get(
      config.features.metrics.path,
      metricsLimiter as unknown as express.RequestHandler,
      async (_req, res) => {
        try {
          const metrics = await this.metricsService.getMetrics();
          res.setHeader('Content-Type', this.metricsService.getContentType());
          res.end(metrics);
        } catch (err) {
          this.logger.error(err as Error, { context: 'metrics_endpoint' });
          res.status(500).end();
        }
      }
    );

    this.logger.info('Metrics endpoint configured', {
      path: config.features.metrics.path,
    });
  }

  private initializeEnvironment(): void {
    const config = this.configManager.getConfig();
    this.environment = config.deployment.environment;
    this.isDevelopment = this.environment === 'development';
    this.isProduction = this.environment === 'production';
  }

  private configureBasicSettings(): void {
    this.app.disable('x-powered-by');
    // Express recommends a hop count (integer) over a boolean: a boolean
    // `true` trusts every proxy and lets a client spoof X-Forwarded-For.
    // Reference: https://expressjs.com/en/guide/behind-proxies/
    const trustProxyHops =
      this.configManager.getConfig().deployment.server.trust_proxy_hops ?? 1;
    this.app.set('trust proxy', trustProxyHops);
    this.logger.info('Express trust proxy configured', {
      hops: trustProxyHops,
    });
    this.app.set('env', this.environment);
    this.app.set('strict routing', false);
    this.app.set('etag', 'weak');
    this.app.set('view engine', 'njk');
    this.app.set('view cache', this.isProduction);
  }

  private setupNunjucks(): void {
    this.app.use((req, res, next) => {
      res.locals.currentYear = new Date().getFullYear();
      res.locals.reqPath = req.path;
      next();
    });

    this.nunjucksEnv = this.viewResolver.configureExpressViews(
      this.app,
      nunjucks
    ) as nunjucks.Environment;
    if (!this.nunjucksEnv) {
      throw new Error('Failed to configure Nunjucks environment');
    }

    configureNunjucks(this.nunjucksEnv);
  }

  private setupSecurity(): void {
    if (this.isProduction) {
      this.app.use(this.enforceHTTPS);
      this.logger.info('HTTPS enforcement enabled for production');
    }

    const config = this.configManager.getConfig();
    const rateLimitConfig = config.security.protection.rate_limiting;

    // Rate limiter reads max from live config so admin changes take effect
    // without restart. windowMs is baked (express-rate-limit limitation).
    const limiter = rateLimit({
      windowMs: rateLimitConfig.window_minutes * 60 * 1000,
      max: async () => {
        const current = this.configManager.getConfig();
        return current.security.protection.rate_limiting.requests_per_minute;
      },
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many requests from this IP, please try again later.',
      skip: () => {
        const current = this.configManager.getConfig();
        return !current.security.protection.rate_limiting.enabled;
      },

      handler: (
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
        options: any
      ) => {
        this.logger.warn('rate_limit_exceeded', {
          ip: req.ip,
          path: req.originalUrl,
        });

        res
          .status(options.statusCode)
          .type('text/plain')
          .send(
            options.message || 'Too many requests, please try again later.'
          );
      },
    });

    // Always mount the rate limiter; the `skip` callback dynamically
    // disables it based on live config. Gating the mount on isProduction
    // left auth endpoints wide open in dev / staging, contrary to OWASP
    // (https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
    // and RFC 9700 §4.7.
    this.app.use(limiter as unknown as express.RequestHandler);
    this.logger.info('Rate limiting configured', {
      requestsPerMinute: rateLimitConfig.requests_per_minute,
      windowMinutes: rateLimitConfig.window_minutes,
      enabled: rateLimitConfig.enabled,
    });

    this.app.use(hpp() as unknown as express.RequestHandler);
    this.logger.info('Data sanitization active');

    // CORS — separate allowlists for production vs non-production. Wildcard
    // origin combined with `credentials: true` is forbidden by the Fetch spec
    // (https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSNotSupportingCredentials),
    // so dev mode used to set `origin: true` (reflect any origin) — that lets
    // any localhost-served page send credentialed requests, which is still a
    // hole. Use an explicit dev allowlist instead.
    const tenantHeader =
      config.features?.multi_tenancy?.tenant_header ?? 'x-tenant-id';
    const corsAllowlist = this.isProduction
      ? config.deployment.server.allowed_origins
      : config.deployment.server.dev_allowed_origins;

    if (this.isProduction && corsAllowlist.length === 0) {
      // Fail loud: a production app exposing credentialed endpoints with an
      // empty CORS allowlist will silently reject every cross-origin caller.
      this.logger.warn(
        'CORS allowlist is empty in production — cross-origin browser callers will be rejected'
      );
    }

    this.app.use(
      cors({
        origin: corsAllowlist,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', tenantHeader],
        credentials: true,
        maxAge: 86400,
      })
    );

    // Helmet sets a defense-in-depth header bundle (X-Content-Type-Options,
    // X-Frame-Options, Referrer-Policy, Cross-Origin-*, Origin-Agent-Cluster,
    // Strict-Transport-Security, X-DNS-Prefetch-Control, …). CSP is left
    // unmanaged here because the existing Nunjucks-rendered CSP carries
    // per-page nonces — a follow-up issue will consolidate that into
    // helmet's directive form. Reference: https://github.com/helmetjs/helmet
    this.app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
      })
    );

    this.logger.info('CORS, helmet and rate-limit middleware configured');
  }

  private enforceHTTPS = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      return next();
    }

    const httpsUrl = `https://${req.headers.host}${req.url}`;
    res.redirect(301, httpsUrl);
  };

  /**
   * Negotiated gzip / Brotli compression. Brotli quality and gzip level are
   * tuned to keep CPU bounded on a single core. HTML responses are not
   * compressed by default because they may carry CSRF tokens or session
   * material; compressing them would expose the BREACH side channel
   * described in RFC 7457 section 2.6.
   */
  private buildCompressionMiddleware(): express.RequestHandler {
    return compression({
      threshold: HARDENING.compression.threshold,
      level: HARDENING.compression.gzipLevel,
      brotli: {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]:
            HARDENING.compression.brotliQuality,
        },
      },
      filter: (req: express.Request, res: express.Response) => {
        if (req.headers['x-no-compression']) return false;
        if (!HARDENING.compression.compressHtml) {
          const contentType = res.getHeader('Content-Type');
          if (
            typeof contentType === 'string' &&
            contentType.includes('text/html')
          ) {
            return false;
          }
        }
        return compression.filter(req, res);
      },
    });
  }

  private setupMiddleware(): void {
    // Request logging — early in the stack, hooks into res.finish only
    // (does not wrap req/res, safe with OIDC sessions)
    this.app.use(this.requestLoggerMiddleware.handler);

    // Pre-create body parsers once (avoid creating on every request)
    const jsonParser = express.json({ limit: '10kb' });
    const urlencodedParser = express.urlencoded({
      extended: true,
      limit: '10kb',
    });

    // Combined body parser - single path check instead of two
    this.app.use((req, res, next) => {
      if (req.path.includes('/admin/settings/import/')) {
        return next();
      }
      jsonParser(req, res, err => {
        if (err) return next(err);
        urlencodedParser(req, res, next);
      });
    });

    const config = this.configManager.getConfig();
    this.app.use(cookieParser(config.security.secrets.cookie_secrets[0]));

    this.app.use(this.buildCompressionMiddleware());
    this.app.use(varyHeadersMiddleware);

    this.app.use(
      mongoSanitize({
        replaceWith: '_',
        onSanitize: ({ req, key }) => {
          this.logger.warn('MongoDB injection attempt detected', {
            ip: req.ip,
            url: req.originalUrl,
            method: req.method,
            sanitizedField: key,
          });
        },
      })
    );

    const publicPath = path.resolve(this.__dirname, '../../public');
    this.app.use(
      express.static(publicPath, {
        maxAge: this.isProduction ? HARDENING.static.maxAge : 0,
        immutable: this.isProduction && HARDENING.static.immutable,
        etag: true,
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith(`${path.sep}manifest.json`) ||
            filePath.endsWith(`${path.sep}service-worker.js`)
          ) {
            res.setHeader('Cache-Control', 'public, no-cache');
          }
        },
      })
    );

    // Signed URL media serving (local storage provider)
    // Mounted before session middleware — the signed URL IS the authorization
    const uploadsBasePath = path.resolve(this.fileSyst.rootDir, 'uploads');
    const signingSecret = config.security.secrets.cookie_secrets[0];
    this.app.use(
      '/media/file',
      createMediaFileRoutes(uploadsBasePath, signingSecret, this.isProduction)
    );

    this.app.use(this.localsMiddleware.configLocals);
  }

  private setupSession(): void {
    this.sessionManager.initialize(this.app);
    this.app.use(this.sessionManager.activityTracker());

    // Session security middleware - validates session binding and enforces timeouts
    this.app.use(this.sessionManager.sessionBindingValidator());
    this.app.use(this.sessionManager.idleTimeoutMiddleware());
    this.app.use(this.sessionManager.absoluteTimeoutMiddleware());
    this.logger.info('Session management and security configured');

    this.app.use(this.sessionManager.flashMiddleware());

    this.app.use(this.securityMiddleware.generateCsrfToken);
  }

  /**
   * Mount tenant context middleware.
   * Runs AFTER session (reads session.tenantId) and BEFORE routes
   * so all downstream handlers execute within the correct tenant context.
   */
  private setupTenantContext(): void {
    const config = this.configManager.getConfig();

    // tenantContext.getTenantId() throws if no ALS store is active instead
    // of silently returning DEFAULT_TENANT_ID. This catches middleware
    // ordering bugs and missing run() wrappers that would cause cross-tenant
    // data leaks.
    if (config.features.multi_tenancy.enabled) {
      tenantContext.enableStrictMode();
      this.logger.info(
        'Tenant context strict mode enabled (multi-tenancy active)'
      );
    }

    this.app.use(this.tenantContextMiddleware.handler);
    this.logger.info('Tenant context middleware configured');

    // UI locals MUST run AFTER tenant context so that isAuthenticated()
    // can query the User model (which uses the Mongoose tenant plugin).
    this.app.use(this.uIMiddleware.setAllUILocals);
  }

  private setupI18n(): void {
    // Step 1: Extract locale from URL path and store in req.params
    this.mainRoutesManager.registerLocaleExtractor(this.app);

    // Step 2: Initialize i18n (binds helpers to request)
    this.app.use(this.uIMiddleware.initI18n);

    // Step 3: Detect and set locale from URL path/query/session/etc
    this.app.use(this.uIMiddleware.handleLanguage);

    // Step 4: Build locale-aware routes (must run AFTER handleLanguage)
    this.app.use(this.localsMiddleware.buildRoutes);

    // Step 5: Add i18n helpers to res.locals
    this.app.use(this.uIMiddleware.addI18nHelpers);

    this.logger.info('Internationalization configured');
  }

  private async oidc(): Promise<void> {
    try {
      await this.oidcManager.start(this.app);
      this.logger.info('provider_initialized', {
        status: 'success',
      });
    } catch (error) {
      this.logger.error(error as Error, { step: 'oidc_initialization' });
      throw error;
    }
  }

  private setupRoutes(): void {
    this.mainRoutesManager.registerRoutes(this.app);
    this.logger.info('All routes registered');
  }

  private setupErrorHandling(): void {
    // API-scoped 500 — catch errors that escape the v1 error handler
    this.app.use(
      '/api',
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        this.logger.error(err, {
          method: req.method,
          url: req.originalUrl,
          context: 'api_fallback_error',
        });
        const status = (err as any).status ?? 500;
        res
          .status(status)
          .setHeader('Content-Type', 'application/problem+json')
          .json({
            type: 'about:blank',
            title: 'Internal Server Error',
            status,
            detail: this.isDevelopment
              ? err.message
              : 'An unexpected error occurred',
          });
      }
    );

    // HTML 404 handler — for non-API routes
    this.app.use('/*notfound', (req, res) => {
      res.status(404).render(this.viewResolver.views.errors.notfound, {
        title: 'Page Not Found',
        url: req.path,
      });
    });

    // HTML 500 handler — for non-API routes
    this.app.use(
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        this.logger.error(err, {
          url: req.originalUrl,
          method: req.method,
          ip: req.ip,
        });

        res.status(500).render(this.viewResolver.views.errors.server_error, {
          title: res.locals.app?.title || 'Error',
          t: res.locals.t || ((key: string) => key),
        });
      }
    );
  }

  public get isInitialized(): boolean {
    return this._isInitialized;
  }
}
