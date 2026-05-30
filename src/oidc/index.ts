import { TYPES } from '../di/types.js';
import type { IProviderService } from '../di/interfaces/provider-service.interface.js';
import type { IKoaMiddleware } from '../di/interfaces/koa-middleware.interface.js';
import type { IOIDCMiddleware } from '../di/interfaces/oidc-middleware.interface.js';
import type { IOIDCListenerService } from '../di/interfaces/oidc-listener-service.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ITenantProviderRegistry } from '../di/interfaces/tenant-provider-registry.interface.js';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Provider } from 'oidc-provider';
import { inject, injectable, optional } from 'inversify';
import type { IOidcManager } from '../di/interfaces/oidc-manager.interface.js';
import type { IOidcRoutesManager } from '../di/interfaces/oidc-routes-manager.interface.js';
import { KoaContextWithOIDC } from 'oidc-provider';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../multi-tenancy/tenant-context.js';
import { createOidcCacheMiddleware } from './middleware/cache-headers.js';

@injectable()
export class OidcManager implements IOidcManager {
  /** Cache provider.callback() results. Entries auto-GC when Provider evicted from pool. */
  private readonly callbackCache = new WeakMap<
    Provider,
    ReturnType<Provider['callback']>
  >();

  /**
   * Track which Provider instances have been configured with Koa middleware
   * and event listeners. Maps Provider → configuration Promise so concurrent
   * first-time requests all await the same work. WeakMap ensures old providers
   * are GC'd when evicted from the pool or replaced after recreation.
   */
  private readonly providerConfigPromises = new WeakMap<
    Provider,
    Promise<void>
  >();

  constructor(
    @inject(TYPES.ProviderService)
    private readonly providerService: IProviderService,
    @inject(TYPES.KoaMiddleware) private readonly koaMiddleware: IKoaMiddleware,
    @inject(TYPES.OIDCMiddleware)
    private readonly oidcMiddleware: IOIDCMiddleware,
    @inject(TYPES.OIDCListenerService)
    private readonly oidcListener: IOIDCListenerService,
    @inject(TYPES.OidcRoutesManager)
    private readonly oidRoutes: IOidcRoutesManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapterBridge: IOIDCAdapterBridge,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.TenantProviderRegistry)
    @optional()
    private readonly tenantProviderRegistry?: ITenantProviderRegistry
  ) {}

  /**
   * Get or create the cached callback handler for a Provider.
   * provider.callback() composes Koa middleware into a handler.
   * We cache it because the composed function reads middleware by reference anyway.
   */
  private getProviderCallback(
    provider: Provider
  ): ReturnType<Provider['callback']> {
    let cb = this.callbackCache.get(provider);
    if (!cb) {
      cb = provider.callback();
      this.callbackCache.set(provider, cb);
    }
    return cb;
  }

  /**
   * Apply Koa middleware and event listeners to a Provider instance.
   * Shared between single-tenant and multi-tenant modes so every provider
   * gets the same middleware stack regardless of how it was created.
   */
  private async configureProvider(provider: Provider): Promise<void> {
    // 1. renderMiddleware — enables ctx.render() in Koa context
    provider.use(this.koaMiddleware.renderMiddleware);

    // 2. Pre/Post middleware
    provider.use(async (ctx, next) => {
      await this.oidcMiddleware.preMiddleware(ctx as KoaContextWithOIDC);
      await next();
      await this.oidcMiddleware.postMiddleware(ctx as KoaContextWithOIDC);
    });

    // 3. ETag and Cache-Control for JWKS and discovery responses.
    provider.use(createOidcCacheMiddleware(this.configManager));

    // 4. Event listeners (logging, metrics)
    await this.oidcListener.setupListeners(provider);
  }

  /**
   * Ensure a Provider has been configured. Uses a WeakMap to guarantee each
   * Provider instance is configured exactly once — even under concurrent
   * requests (all callers await the same Promise).
   */
  private ensureProviderConfigured(provider: Provider): Promise<void> {
    let p = this.providerConfigPromises.get(provider);
    if (!p) {
      p = this.configureProvider(provider);
      this.providerConfigPromises.set(provider, p);
    }
    return p;
  }

  /**
   * Check whether a request path matches a given OIDC mount path.
   * Replicates Express's app.use(path, handler) semantics:
   * matches exact path or path followed by '/'.
   */
  private isOidcRequest(reqPath: string, oidcPath: string): boolean {
    return reqPath === oidcPath || reqPath.startsWith(`${oidcPath}/`);
  }

  /**
   * Strip the mount-path prefix from req.url and set req.baseUrl,
   * mimicking what Express does internally for app.use(path, handler).
   * Returns the original values for restoration.
   */
  private stripMountPath(
    req: Request,
    oidcPath: string
  ): { url: string; baseUrl: string } {
    const original = { url: req.url, baseUrl: req.baseUrl };
    let newUrl = req.url.slice(oidcPath.length);
    if (!newUrl.startsWith('/')) {
      newUrl = `/${newUrl}`;
    }
    req.url = newUrl;
    req.baseUrl = `${req.baseUrl || ''}${oidcPath}`;
    return original;
  }

  /**
   * Start the OIDC Module features
   *
   * @param app Express app
   */
  start = async (app: Express): Promise<void> => {
    const config = this.configManager.getConfig();
    const isMultiTenant = config.features.multi_tenancy.enabled;

    // can query sessions/grants without waiting for the first OIDC request.
    // initialize() is idempotent — safe to call again from TenantProviderRegistry.
    await this.oidcAdapterBridge.initialize();

    this.sessionManager.setOidcAdapterBridge(this.oidcAdapterBridge);

    // Uses a swappable Router that rebuilds on config changes.
    this.oidRoutes.registerRoutes(app);

    if (isMultiTenant && this.tenantProviderRegistry) {
      // ── Multi-tenant: dynamic dispatcher ──────────────────────────
      // This avoids circular DI: OidcManager provides the configurator,
      // TenantProviderRegistry calls it when creating providers.
      if (this.tenantProviderRegistry.setProviderConfigurator) {
        this.tenantProviderRegistry.setProviderConfigurator(
          async (tenantProvider: Provider, _tenantId: string) => {
            await this.ensureProviderConfigured(tenantProvider);
          }
        );
      }

      // Dynamic dispatcher: reads oidcPath from config per-request so that
      // path changes via admin portal take effect without app restart.
      app.use(async (req: Request, res: Response, next: NextFunction) => {
        try {
          const currentOidcPath = this.providerService.getOidcPath();
          if (!this.isOidcRequest(req.path, currentOidcPath)) {
            return next();
          }

          const tenantId = tenantContext.getTenantId();

          // Assert ALS context exists in multi-tenant mode (HIGH-2).
          if (tenantId === DEFAULT_TENANT_ID && !tenantContext.getStore()) {
            throw new Error(
              '[OidcManager] No tenant context in multi-tenant mode. ' +
                'Ensure TenantContextMiddleware runs before OIDC routes.'
            );
          }

          const tenantProvider =
            await this.providerService.getProviderForTenant(tenantId);

          const original = this.stripMountPath(req, currentOidcPath);

          const cb = this.getProviderCallback(tenantProvider);
          // MUST await — cb() returns a Promise (Koa composed middleware).
          // Dropping it causes unhandled rejections in Node.js 15+ (CRIT-2).
          await cb(req, res);

          req.url = original.url;
          req.baseUrl = original.baseUrl;
        } catch (error) {
          // (e.g., localhost in dev mode without x-tenant-id header).
          if (
            error instanceof Error &&
            error.message.includes('No tenant resolved')
          ) {
            res.status(400).json({
              error: 'Tenant identification required',
              hint: 'Use a subdomain (e.g., acme.parako.test) or set the x-tenant-id header.',
            });
            return;
          }
          next(error);
        }
      });
    } else {
      // ── Single-tenant: dynamic mount ──────────────────────────────
      const provider = await this.providerService.initProvider();
      await this.ensureProviderConfigured(provider);

      // Dynamic OIDC middleware: reads oidcPath from config and resolves
      // the current Provider per-request. When ProviderService recreates
      // the provider after a config change, this middleware automatically
      // picks up the new provider and lazily configures it (via the
      // ensureProviderConfigured WeakMap). This allows oidcPath changes
      // to take effect without restarting the application.
      app.use(async (req: Request, res: Response, next: NextFunction) => {
        try {
          const currentOidcPath = this.providerService.getOidcPath();
          if (!this.isOidcRequest(req.path, currentOidcPath)) {
            return next();
          }

          const currentProvider = this.providerService.getProvider();
          if (!currentProvider) return next();

          // Lazily configure the provider if it was recreated after a
          // config change (the new instance won't be in the WeakMap yet).
          await this.ensureProviderConfigured(currentProvider);

          const original = this.stripMountPath(req, currentOidcPath);

          const cb = this.getProviderCallback(currentProvider);
          await cb(req, res);

          req.url = original.url;
          req.baseUrl = original.baseUrl;
        } catch (error) {
          next(error);
        }
      });
    }
  };
}
