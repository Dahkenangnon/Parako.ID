import type { Express, Request, Response, NextFunction } from 'express';
import session, { SessionOptions, Store } from 'express-session';
import MongoStore from 'connect-mongo';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { injectable, inject, unmanaged } from 'inversify';
import type { PrismaClient } from '@prisma/client';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import type {
  ISessionManager,
  AddAuthenticatedUserResult,
  SwitchUserResult,
} from '../di/interfaces/session-manager.interface.js';
import type { IFlashManager } from '../di/interfaces/flash-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import { TYPES } from '../di/types.js';
import { PrismaSessionStore } from './prisma-session-store.js';
import { createTenantSessionId } from './session-id.js';
import { decodePersistedSession } from './session-persistence.js';
import { encryptValue, decryptValue, isEncrypted } from './encryption.js';
import { createConnectRedisClientAdapter } from './connect-redis-client.js';
import {
  DEFAULT_TENANT_ID,
  tenantContext,
} from '../multi-tenancy/tenant-context.js';
import { escapeRegExp } from '../validators/listing-query.js';
import { parseUserAgent } from './user-agent.js';
import type {
  AuthenticatedUsers,
  FlashContainer,
  FlashMessage,
  FlashOptions,
  FlashType,
  SessionAuthenticationData,
  SessionData,
  SessionMetadata,
  SessionUserAccount,
} from '../types/session-data.js';

const SENSITIVE_SESSION_FIELDS = [
  'authenticatedUsers',
  'csrfToken',
  'authTime',
  'ipAddress',
  'userAgent',
  'deviceId',
  '_metadata',
];

function normalizeSessionAccountId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeSessionAuthTime(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  return 0;
}

function mongoSessionTenantFilter(tenantId: string): Record<string, unknown> {
  if (tenantId !== DEFAULT_TENANT_ID) {
    return { 'session.tenantId': tenantId };
  }

  return {
    $or: [
      { 'session.tenantId': DEFAULT_TENANT_ID },
      { 'session.tenantId': { $exists: false } },
    ],
  };
}

function sessionBelongsToTenant(
  sessionData: unknown,
  tenantId: string
): boolean {
  if (
    !sessionData ||
    typeof sessionData !== 'object' ||
    Array.isArray(sessionData)
  ) {
    return false;
  }

  const storedTenantId = (sessionData as { tenantId?: unknown }).tenantId;
  return (
    storedTenantId === tenantId ||
    (tenantId === DEFAULT_TENANT_ID && storedTenantId === undefined)
  );
}

/** Transparently encrypts sensitive fields before delegating to a session store. */
class EncryptedSessionStore extends Store {
  private innerStore: Store;
  private logger: ILogger;

  constructor(innerStore: Store, logger: ILogger) {
    super();
    this.innerStore = innerStore;
    this.logger = logger;
  }

  get(
    sid: string,
    callback: (err: any, session?: session.SessionData | null) => void
  ): void {
    this.innerStore.get(sid, (err, sessionData) => {
      if (err || !sessionData) {
        return callback(err, sessionData);
      }

      try {
        const decrypted = this.decryptSession(sessionData);
        callback(null, decrypted);
      } catch (decryptError) {
        this.logger.error(decryptError as Error, {
          context: 'Failed to decrypt session data',
          sessionId: sid,
        });
        callback(decryptError);
      }
    });
  }

  set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void
  ): void {
    try {
      const encrypted = this.encryptSession(sessionData);
      this.innerStore.set(sid, encrypted, callback);
    } catch (encryptError) {
      this.logger.error(encryptError as Error, {
        context: 'Failed to encrypt session data',
        sessionId: sid,
      });
      if (callback) {
        callback(encryptError);
        return;
      }

      throw encryptError;
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    this.innerStore.destroy(sid, callback);
  }

  touch?(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void
  ): void {
    if (this.innerStore.touch) {
      try {
        const encrypted = this.encryptSession(sessionData);
        this.innerStore.touch(sid, encrypted, callback);
      } catch (encryptError) {
        this.logger.error(encryptError as Error, {
          context: 'Failed to encrypt session data during touch',
          sessionId: sid,
        });
        if (callback) {
          callback(encryptError);
          return;
        }

        throw encryptError;
      }
    } else if (callback) {
      callback();
    }
  }

  private encryptSession(
    sessionData: session.SessionData
  ): session.SessionData {
    const encrypted: any = { ...sessionData };

    for (const field of SENSITIVE_SESSION_FIELDS) {
      if (encrypted[field] !== undefined) {
        const jsonValue = JSON.stringify(encrypted[field]);
        encrypted[`_enc_${field}`] = encryptValue(jsonValue);
        delete encrypted[field];
      }
    }

    encrypted._encrypted = true;
    return encrypted;
  }

  private decryptSession(
    sessionData: session.SessionData
  ): session.SessionData {
    const data: any = sessionData;

    if (!data._encrypted) {
      return sessionData;
    }

    const decrypted: any = { ...sessionData };
    delete decrypted._encrypted;

    for (const field of SENSITIVE_SESSION_FIELDS) {
      if (decrypted[field] !== undefined) {
        throw new Error(`Sensitive field is not encrypted: ${field}`);
      }

      const encryptedKey = `_enc_${field}`;
      const encryptedValue = decrypted[encryptedKey];
      if (encryptedValue !== undefined) {
        if (
          typeof encryptedValue !== 'string' ||
          !isEncrypted(encryptedValue)
        ) {
          throw new Error(`Invalid encrypted session field: ${field}`);
        }

        const jsonValue = decryptValue(encryptedValue);
        decrypted[field] = JSON.parse(jsonValue);
        delete decrypted[encryptedKey];
      }
    }

    return decrypted;
  }
}

type CircuitState = 'closed' | 'open' | 'half-open';

/** Fails session operations fast with HTTP 503 while the backing store is unhealthy. */
class CircuitBreakerStore extends Store {
  private innerStore: Store;
  private logger: ILogger;

  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailure = 0;
  private successCount = 0;

  private readonly failureThreshold = 5;
  private readonly resetTimeout = 30_000;
  private readonly successThreshold = 3;

  constructor(innerStore: Store, logger: ILogger) {
    super();
    this.innerStore = innerStore;
    this.logger = logger;
  }

  private canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailure;
      if (timeSinceFailure >= this.resetTimeout) {
        this.state = 'half-open';
        this.logger.info('Circuit breaker transitioning to half-open');
        return true;
      }
      return false;
    }

    return true;
  }

  private recordSuccess(): void {
    this.failures = 0;

    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
        this.successCount = 0;
        this.logger.info('Circuit breaker closed - store recovered');
      }
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    this.successCount = 0;

    if (this.state === 'half-open') {
      this.state = 'open';
      this.logger.warn(
        'Circuit breaker re-opened after failure in half-open state'
      );
    } else if (
      this.state === 'closed' &&
      this.failures >= this.failureThreshold
    ) {
      this.state = 'open';
      this.logger.error('Circuit breaker opened - session store unavailable', {
        failures: this.failures,
        threshold: this.failureThreshold,
      });
    }
  }

  private createCircuitOpenError(): Error {
    const error = new Error('Session store unavailable - circuit breaker open');
    (error as any).statusCode = 503;
    (error as any).code = 'SERVICE_UNAVAILABLE';
    return error;
  }

  get(
    sid: string,
    callback: (err: any, session?: session.SessionData | null) => void
  ): void {
    if (!this.canExecute()) {
      return callback(this.createCircuitOpenError(), null);
    }

    this.innerStore.get(sid, (err, sessionData) => {
      if (err) {
        this.recordFailure();
        return callback(err, sessionData);
      }

      this.recordSuccess();
      callback(null, sessionData);
    });
  }

  set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void
  ): void {
    if (!this.canExecute()) {
      if (callback) callback(this.createCircuitOpenError());
      return;
    }

    let storeCallbackEntered = false;
    try {
      this.innerStore.set(sid, sessionData, err => {
        storeCallbackEntered = true;
        if (err) {
          this.recordFailure();
          if (callback) callback(err);
          return;
        }

        this.recordSuccess();
        if (callback) callback();
      });
    } catch (error) {
      if (!storeCallbackEntered) {
        this.recordFailure();
      }
      throw error;
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    if (!this.canExecute()) {
      if (callback) callback(this.createCircuitOpenError());
      return;
    }

    let storeCallbackEntered = false;
    try {
      this.innerStore.destroy(sid, err => {
        storeCallbackEntered = true;
        if (err) {
          this.recordFailure();
          if (callback) callback(err);
          return;
        }

        this.recordSuccess();
        if (callback) callback();
      });
    } catch (error) {
      if (!storeCallbackEntered) {
        this.recordFailure();
      }
      throw error;
    }
  }

  touch?(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void
  ): void {
    if (!this.canExecute()) {
      if (callback) callback(this.createCircuitOpenError());
      return;
    }

    if (this.innerStore.touch) {
      let storeCallbackEntered = false;
      const handleTouch = (err?: any): void => {
        storeCallbackEntered = true;
        if (err) {
          this.recordFailure();
          if (callback) callback(err);
          return;
        }

        this.recordSuccess();
        if (callback) callback();
      };

      // Concrete stores use the standard error-first callback at runtime,
      // while @types/express-session currently declares a no-argument callback.
      try {
        this.innerStore.touch(sid, sessionData, handleTouch as () => void);
      } catch (error) {
        if (!storeCallbackEntered) {
          this.recordFailure();
        }
        throw error;
      }
    } else if (callback) {
      callback();
    }
  }

  getCircuitState(): {
    state: CircuitState;
    failures: number;
    lastFailure: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
    };
  }
}

/** Selected from the effective OIDC adapter configuration. */
export type SessionStoreType = 'mongodb' | 'redis' | 'sqlite' | 'postgresql';

function isSessionCreationSource(
  value: unknown
): value is SessionMetadata['createdFrom'] {
  return (
    value === 'login' ||
    value === 'social' ||
    value === 'api' ||
    value === 'session-switch' ||
    value === 'unknown'
  );
}

@injectable()
export class FlashManager implements IFlashManager {
  constructor(
    @unmanaged() private request: Request,
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ConfigManager) private configManager: IConfigManager
  ) {
    this.initialize();
  }

  private initialize(): void {
    if (!this.sessionManager.exists(this.request)) {
      throw new Error('Session not available');
    }

    const currentFlash = this.sessionManager.get<Partial<FlashContainer>>(
      this.request,
      'flash'
    );
    const normalizedFlash: FlashContainer = {
      success: Array.isArray(currentFlash?.success) ? currentFlash.success : [],
      error: Array.isArray(currentFlash?.error) ? currentFlash.error : [],
      info: Array.isArray(currentFlash?.info) ? currentFlash.info : [],
      warning: Array.isArray(currentFlash?.warning) ? currentFlash.warning : [],
    };

    if (
      !currentFlash ||
      !Array.isArray(currentFlash.success) ||
      !Array.isArray(currentFlash.error) ||
      !Array.isArray(currentFlash.info) ||
      !Array.isArray(currentFlash.warning)
    ) {
      this.sessionManager.set(this.request, 'flash', normalizedFlash);
    }
  }

  public add(
    type: FlashType,
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    this.addMessage(type, message, title, options);
    return this;
  }

  public success(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('success', message, title, options);
  }

  public error(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('error', message, title, options);
  }

  public info(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('info', message, title, options);
  }

  public warning(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('warning', message, title, options);
  }

  private addMessage(
    type: FlashType,
    message: string,
    title?: string,
    options?: FlashOptions
  ): void {
    const flash = this.sessionManager.get<FlashContainer>(
      this.request,
      'flash'
    );
    if (!flash) return;

    const config = this.configManager.getConfig();
    const sessionConfig = config.security?.authentication?.session;
    const maxPerType = sessionConfig?.max_flash_messages_per_type || 10;
    const maxTotal = sessionConfig?.max_flash_messages_total || 20;

    let totalCount = Object.values(flash).reduce(
      (sum: number, arr: FlashMessage[]) => sum + arr.length,
      0
    );

    // Apply the per-type replacement first so the same insertion does not
    // also evict an unrelated message at the total limit.
    if (flash[type].length >= maxPerType) {
      flash[type].shift();
      totalCount -= 1;
      this.logger.debug('Flash message removed (type limit reached)', {
        type,
        maxPerType,
      });
    }

    if (totalCount >= maxTotal) {
      const types: FlashType[] = ['success', 'error', 'info', 'warning'];
      const typeWithMost = types.reduce((a, b) =>
        flash[a].length > flash[b].length ? a : b
      );
      flash[typeWithMost].shift();
      this.logger.debug('Flash message removed (total limit reached)', {
        type: typeWithMost,
        maxTotal,
      });
    }

    const flashMessage: FlashMessage = {
      type,
      message,
      title,
      dismissible: options?.dismissible ?? true,
      timeout: options?.timeout,
    };

    flash[type].push(flashMessage);
    this.sessionManager.set(this.request, 'flash', flash);
  }

  public all(): FlashContainer {
    const flash = this.sessionManager.get<FlashContainer>(
      this.request,
      'flash'
    );

    if (!flash) {
      return {
        success: [],
        error: [],
        info: [],
        warning: [],
      };
    }

    const flashCopy = { ...flash };

    this.clear();

    return flashCopy;
  }

  public peek(): FlashContainer {
    const flash = this.sessionManager.get<FlashContainer>(
      this.request,
      'flash'
    );

    if (!flash) {
      return {
        success: [],
        error: [],
        info: [],
        warning: [],
      };
    }

    return { ...flash };
  }

  public clear(): IFlashManager {
    this.sessionManager.set(this.request, 'flash', {
      success: [],
      error: [],
      info: [],
      warning: [],
    });

    return this;
  }
}

export interface SessionManagerOptions {
  secret?: string;
  name?: string;
  storeType?: SessionStoreType;
  ttl?: number;
  cookie?: {
    secure?: boolean;
    httpOnly?: boolean;
    maxAge?: number;
    domain?: string;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    path?: string;
  };
  rolling?: boolean;
  resave?: boolean;
  saveUninitialized?: boolean;
  proxy?: boolean;
  collection?: string;
  sessionIdGenerator?: (request?: Request) => string;
}

/** Coordinates Express sessions across the configured persistent store. */
@injectable()
export class SessionManager implements ISessionManager {
  private options: SessionManagerOptions;
  private store: Store | undefined;
  private sessionMiddleware: any;
  private initialized: boolean = false;
  private configManager: IConfigManager;
  private viewResolver: IViewResolver;
  private logger: ILogger;
  private userService: IUserService;
  private oidcAdapterBridge: IOIDCAdapterBridge | null = null;
  private prismaClient: PrismaClient | null = null;
  private redisClient: Redis | null = null;
  private sessionPrefix: string = '';

  private initialSessionSettings: {
    cookieSecrets: string[];
    storeType: string;
  } | null = null;

  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.ViewResolver) viewResolver: IViewResolver,
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.PrismaClient) prismaClient: PrismaClient | null,
    options: SessionManagerOptions = {}
  ) {
    this.configManager = configManager;
    this.viewResolver = viewResolver;
    this.logger = logger;
    this.userService = userService;
    this.prismaClient = prismaClient;
    this.options = this.mergeWithDefaultOptions(options);

    if (
      this.configManager.getConfig().deployment.environment === 'production' &&
      (!this.options.secret || this.options.secret.length < 32)
    ) {
      throw new Error(
        'Session secret must be at least 32 characters in production mode'
      );
    }

    const initialConfig = this.configManager.getConfig();
    this.initialSessionSettings = {
      cookieSecrets: [...initialConfig.security.secrets.cookie_secrets],
      storeType: initialConfig.oidc_storage.oidc_adapter.type,
    };

    this.configManager.subscribe(
      'SessionManager',
      this.handleConfigChange.bind(this)
    );
  }

  private handleConfigChange(updatedConfig: any): void {
    if (!this.initialSessionSettings) {
      return;
    }

    const criticalChanges: string[] = [];

    const newSecrets = updatedConfig.security?.secrets?.cookie_secrets || [];
    const secretsChanged =
      JSON.stringify(newSecrets) !==
      JSON.stringify(this.initialSessionSettings.cookieSecrets);
    if (secretsChanged) {
      criticalChanges.push('security.secrets.cookie_secrets');
    }

    const newStoreType = updatedConfig.oidc_storage?.oidc_adapter?.type;
    if (newStoreType !== this.initialSessionSettings.storeType) {
      criticalChanges.push('oidc_storage.oidc_adapter.type');
    }

    if (criticalChanges.length > 0) {
      this.logger.warn(
        '[SessionManager] Critical session settings changed. ' +
          'Application restart required for changes to take effect.',
        {
          changedSettings: criticalChanges,
          warning:
            'Existing sessions will continue using old settings until restart',
        }
      );
    }

    this.logger.info(
      '[SessionManager] Configuration updated. ' +
        'Timeout settings will apply to new sessions.',
      {
        idleTimeout:
          updatedConfig.security?.authentication?.session?.idle_timeout_minutes,
        absoluteTimeout:
          updatedConfig.security?.authentication?.session
            ?.absolute_timeout_hours,
        maxConcurrentSessions:
          updatedConfig.security?.authentication?.session
            ?.max_concurrent_sessions,
      }
    );
  }

  private mergeWithDefaultOptions(
    options: SessionManagerOptions
  ): SessionManagerOptions {
    const sessionCookieConfig =
      this.configManager.getConfig().deployment.cookies.types.session;
    const defaultCookieConfig =
      this.configManager.getConfig().deployment.cookies.defaults;

    const securitySessionConfig =
      this.configManager.getConfig().security?.authentication?.session;

    const cookiesSecrets =
      this.configManager.getConfig().security.secrets.cookie_secrets;
    const cSecret = cookiesSecrets.length > 0 ? cookiesSecrets[0] : 'secrets';

    // Bridge's effectiveOidcAdapter() is preferred but may not be set at construction time.
    // We fall back to the DB config type here; setupStore() re-resolves using the bridge.
    const oidcAdapterConfig =
      this.configManager.getConfig().oidc_storage.oidc_adapter;
    const storeType: SessionStoreType =
      oidcAdapterConfig.type as SessionStoreType;

    const cookieName =
      options.name ||
      securitySessionConfig?.cookie_name ||
      sessionCookieConfig.name ||
      'application_session';

    const sameSite =
      options.cookie?.sameSite ||
      securitySessionConfig?.same_site ||
      sessionCookieConfig.sameSite ||
      'lax';

    const oidcSessionTtl =
      this.configManager.getConfig().oidc.token_ttl.session || 1209600;

    return {
      secret: options.secret || cSecret,
      name: cookieName,
      storeType,
      ttl: options.ttl || oidcSessionTtl,
      cookie: {
        secure:
          options.cookie?.secure ??
          (this.configManager.getConfig().deployment.environment ===
          'production'
            ? true // Always secure in production
            : sessionCookieConfig.secure),
        httpOnly: options.cookie?.httpOnly ?? sessionCookieConfig.httpOnly,
        maxAge: options.cookie?.maxAge ?? oidcSessionTtl * 1000, // Convert seconds to ms
        domain: options.cookie?.domain,
        sameSite: sameSite as 'lax' | 'strict' | 'none',
        path: options.cookie?.path ?? defaultCookieConfig.path,
      },
      rolling: options.rolling ?? true,
      resave: options.resave ?? false,
      saveUninitialized: options.saveUninitialized ?? false,
      proxy:
        options.proxy ??
        this.configManager.getConfig().deployment.environment === 'production',
      collection: options.collection || cookieName,
      sessionIdGenerator:
        options.sessionIdGenerator || (() => crypto.randomUUID()),
    };
  }

  /**
   * Resolve enough tenant identity to create a tenant-scoped session ID.
   *
   * This deliberately mirrors the configured header/subdomain extraction used
   * by TenantContextMiddleware, but does not authorize the tenant. The complete
   * ID is signed by express-session, and the middleware still validates tenant
   * existence and status before any application route runs.
   */
  private resolveNewSessionTenantId(request?: Request): string {
    const multiTenancy = this.configManager.getConfig().features?.multi_tenancy;
    if (!multiTenancy?.enabled || !request) {
      return DEFAULT_TENANT_ID;
    }

    let candidate = DEFAULT_TENANT_ID;
    for (const source of multiTenancy.extraction_priority ?? []) {
      if (source === 'header') {
        const headerName = multiTenancy.tenant_header || 'x-tenant-id';
        const value = request.headers?.[headerName];
        if (typeof value === 'string' && value.length > 0) {
          candidate = value;
          break;
        }
      }

      if (source === 'subdomain' && typeof request.hostname === 'string') {
        const parts = request.hostname.split('.');
        if (parts.length >= 3) {
          candidate = parts[0];
          break;
        }
      }
    }

    try {
      createTenantSessionId(candidate, 'validation');
      return candidate;
    } catch {
      return DEFAULT_TENANT_ID;
    }
  }

  private generateSessionId(request?: Request): string {
    const randomComponent = this.options.sessionIdGenerator!(request);
    const multiTenancy = this.configManager.getConfig().features?.multi_tenancy;
    if (!multiTenancy?.enabled) {
      return randomComponent;
    }

    return createTenantSessionId(
      this.resolveNewSessionTenantId(request),
      randomComponent
    );
  }

  public initialize(app: Express): void {
    if (this.initialized) {
      this.logger.info('Session manager already initialized');
      return;
    }

    if (!app || typeof app.use !== 'function') {
      throw new Error('Failed to initialize session middleware');
    }

    this.setupStore();
    this.setupMiddleware();

    if (app && this.sessionMiddleware) {
      app.use(this.sessionMiddleware);
      app.use(this.redirectAfterSessionSaveMiddleware());
      this.logger.info(
        `Session middleware configured with ${this.options.storeType} store`
      );

      const environment = this.configManager.getConfig().deployment.environment;
      const sessionCookieConfig =
        this.configManager.getConfig().deployment.cookies.types.session;
      if (environment !== 'production' && !sessionCookieConfig.secure) {
        this.logger.warn(
          'Session cookies are not secure (HTTP only). ' +
            'This is acceptable for local development but should never be used with real user data. ' +
            'Set deployment.cookies.types.session.secure=true or use HTTPS.',
          { context: 'session_security_warning' }
        );
      }

      this.initialized = true;
    } else {
      throw new Error('Failed to initialize session middleware');
    }
  }

  public setOidcAdapterBridge(bridge: IOIDCAdapterBridge): void {
    this.oidcAdapterBridge = bridge;
    this.logger.debug('OIDC adapter bridge set for session management');
  }

  /** Reserves room for the new session by removing the tenant's oldest sessions. */
  public async enforceSessionLimit(
    userId: string,
    currentSessionId?: string
  ): Promise<number> {
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return 0;
    }

    const config = this.configManager.getConfig();
    const maxConcurrentSessions =
      config.security?.authentication?.session?.max_concurrent_sessions;

    if (!maxConcurrentSessions || maxConcurrentSessions <= 0) {
      return 0;
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        return await this.enforceSessionLimitMongo(
          userId,
          maxConcurrentSessions,
          currentSessionId
        );
      } else if (storeType === 'redis') {
        return await this.enforceSessionLimitRedis(
          userId,
          maxConcurrentSessions,
          currentSessionId
        );
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        return await this.enforceSessionLimitPrisma(
          userId,
          maxConcurrentSessions,
          currentSessionId
        );
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to enforce session limit',
        userId,
      });
      throw error;
    }
  }

  private async enforceSessionLimitMongo(
    userId: string,
    maxConcurrentSessions: number,
    currentSessionId?: string
  ): Promise<number> {
    const db = mongoose.connection.db;
    if (!db) {
      throw this.unavailableSessionStore('enforce session limit', 'MongoDB');
    }

    const collectionName = this.options.collection || 'application_session';
    const sessionCollection = db.collection(collectionName);
    const tenantId = tenantContext.getTenantId();

    const query: Record<string, any> = {
      'session.accountId': userId,
      ...mongoSessionTenantFilter(tenantId),
    };
    if (currentSessionId) {
      query._id = { $ne: currentSessionId };
    }

    const sessions = await sessionCollection
      .find(query)
      .sort({ 'session.authTime': 1 })
      .toArray();

    this.logger.debug('Found Express sessions for user (excluding current)', {
      userId,
      sessionCount: sessions.length,
      maxConcurrentSessions,
      currentSessionExcluded: !!currentSessionId,
    });

    if (sessions.length < maxConcurrentSessions) {
      return 0;
    }

    const sessionsToRemoveCount = sessions.length - maxConcurrentSessions + 1;
    const sessionsToRemove = sessions.slice(0, sessionsToRemoveCount);

    let removedCount = 0;
    for (const sessionDoc of sessionsToRemove) {
      const sessionId = sessionDoc._id;
      if (sessionId) {
        const result = await sessionCollection.deleteOne({
          _id: sessionId,
          ...mongoSessionTenantFilter(tenantId),
        });
        if (result.deletedCount > 0) {
          removedCount++;
          this.logger.debug('Removed session due to concurrent limit', {
            sessionId: sessionId.toString(),
            userId,
          });
        }
      }
    }

    if (removedCount > 0) {
      this.logger.info('Removed sessions due to concurrent session limit', {
        userId,
        removedCount,
        maxConcurrentSessions,
        totalSessionsBefore: sessions.length,
      });
    }

    return removedCount;
  }

  private async enforceSessionLimitRedis(
    userId: string,
    maxConcurrentSessions: number,
    currentSessionId?: string
  ): Promise<number> {
    if (!this.redisClient) {
      throw this.unavailableSessionStore('enforce session limit', 'Redis');
    }

    const tenantId = tenantContext.getTenantId();
    const key = this.redisUserSessionsKey(userId, tenantId);
    const sessionIds = await this.findRedisSessionIdsForAccount(
      userId,
      currentSessionId ? [currentSessionId] : [],
      tenantId
    );

    const validSessions: { sid: string; authTime: number }[] = [];
    const staleIds: string[] = [];

    for (const sid of sessionIds) {
      if (sid === currentSessionId) continue;
      const raw = await this.redisClient.get(`${this.sessionPrefix}${sid}`);
      if (!raw) {
        staleIds.push(sid);
        continue;
      }
      try {
        const data = decodePersistedSession(
          raw,
          'redis.application_session.data'
        );
        if (
          sessionBelongsToTenant(data, tenantId) &&
          data.accountId === userId
        ) {
          validSessions.push({
            sid,
            authTime: normalizeSessionAuthTime(data.authTime),
          });
        }
      } catch {
        staleIds.push(sid);
      }
    }

    // Lazy cleanup of stale entries — best-effort; index lag is recoverable
    // on the next sweep so failures only warrant a warn-level log.
    if (staleIds.length > 0) {
      const logCleanupFailure = (err: unknown): void => {
        this.logger.warn('Redis session-index lazy cleanup failed (srem)', {
          step: 'redis-session-index-cleanup',
          key,
          err: err instanceof Error ? err.message : String(err),
        });
      };

      try {
        this.redisClient.srem(key, ...staleIds).catch(logCleanupFailure);
      } catch (err) {
        logCleanupFailure(err);
      }
    }

    this.logger.debug('Found Express sessions for user (excluding current)', {
      userId,
      sessionCount: validSessions.length,
      maxConcurrentSessions,
      currentSessionExcluded: !!currentSessionId,
    });

    if (validSessions.length < maxConcurrentSessions) {
      return 0;
    }

    validSessions.sort((a, b) => a.authTime - b.authTime);

    const sessionsToRemoveCount =
      validSessions.length - maxConcurrentSessions + 1;
    const sessionsToRemove = validSessions.slice(0, sessionsToRemoveCount);

    const pipeline = this.redisClient.multi();
    for (const { sid } of sessionsToRemove) {
      pipeline.del(`${this.sessionPrefix}${sid}`);
      pipeline.srem(key, sid);
    }
    const results = await pipeline.exec();
    const removedCount = sessionsToRemove.reduce((count, _session, index) => {
      const deleteResult = results?.[index * 2];
      if (!deleteResult) return count;

      const [deleteError, deleted] = deleteResult;
      if (deleteError || typeof deleted !== 'number') return count;

      return deleted > 0 ? count + 1 : count;
    }, 0);
    if (removedCount > 0) {
      this.logger.info('Removed sessions due to concurrent session limit', {
        userId,
        removedCount,
        maxConcurrentSessions,
        totalSessionsBefore: validSessions.length,
      });
    }

    return removedCount;
  }

  private async enforceSessionLimitPrisma(
    userId: string,
    maxConcurrentSessions: number,
    currentSessionId?: string
  ): Promise<number> {
    if (!this.prismaClient) {
      throw this.unavailableSessionStore('enforce session limit', 'Prisma');
    }

    const tenantId = tenantContext.getTenantId();
    const rows = await (this.prismaClient as any).session.findMany();
    const validSessions: { sid: string; authTime: number }[] = [];

    for (const row of rows) {
      if (row.sid === currentSessionId) continue;
      try {
        const data = decodePersistedSession(
          row.data,
          'prisma.application_session.data'
        );
        if (
          sessionBelongsToTenant(data, tenantId) &&
          data.accountId === userId
        ) {
          validSessions.push({
            sid: row.sid,
            authTime: normalizeSessionAuthTime(data.authTime),
          });
        }
      } catch {
        // best-effort: skip session rows with unparsable JSON payload.
      }
    }

    this.logger.debug('Found Express sessions for user (excluding current)', {
      userId,
      sessionCount: validSessions.length,
      maxConcurrentSessions,
      currentSessionExcluded: !!currentSessionId,
    });

    if (validSessions.length < maxConcurrentSessions) {
      return 0;
    }

    validSessions.sort((a, b) => a.authTime - b.authTime);

    const sessionsToRemoveCount =
      validSessions.length - maxConcurrentSessions + 1;
    const sessionsToRemove = validSessions.slice(0, sessionsToRemoveCount);

    let removedCount = 0;
    for (const { sid } of sessionsToRemove) {
      const result = await (this.prismaClient as any).session.deleteMany({
        where: { sid },
      });
      if (result.count > 0) {
        removedCount++;
        this.logger.debug('Removed session due to concurrent limit', {
          sessionId: sid,
          userId,
        });
      }
    }

    if (removedCount > 0) {
      this.logger.info('Removed sessions due to concurrent session limit', {
        userId,
        removedCount,
        maxConcurrentSessions,
        totalSessionsBefore: validSessions.length,
      });
    }

    return removedCount;
  }

  public async revokeAllSessionsForUser(userId: string): Promise<number> {
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return 0;
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          throw this.unavailableSessionStore(
            'revoke Express sessions',
            'MongoDB'
          );
        }

        const collection = db.collection(
          this.options.collection || 'application_session'
        );

        const result = await collection.deleteMany({
          'session.accountId': userId,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        });

        if (result.deletedCount > 0) {
          this.logger.info('Revoked Express sessions for user', {
            userId,
            deletedCount: result.deletedCount,
          });
        }

        return result.deletedCount;
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          throw this.unavailableSessionStore(
            'revoke Express sessions',
            'Redis'
          );
        }

        const tenantId = tenantContext.getTenantId();
        const key = this.redisUserSessionsKey(userId, tenantId);
        const sessionIds = await this.findRedisSessionIdsForAccount(
          userId,
          [],
          tenantId
        );

        if (sessionIds.length === 0) {
          // Clear a stale or cross-account index even when no authoritative
          // session belongs to this user. Never delete the indexed session
          // keys themselves unless the authoritative scan attributes them.
          await this.redisClient.del(key);
          return 0;
        }

        const revocableSessionIds: string[] = [];
        for (const sid of sessionIds) {
          const raw = await this.redisClient.get(`${this.sessionPrefix}${sid}`);
          if (!raw) continue;

          try {
            const data = decodePersistedSession(
              raw,
              'redis.application_session.data'
            );
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.accountId === userId
            ) {
              revocableSessionIds.push(sid);
            }
          } catch {
            // Fail closed when current ownership cannot be verified.
          }
        }

        if (revocableSessionIds.length === 0) {
          await this.redisClient.del(key);
          return 0;
        }

        const pipeline = this.redisClient.multi();
        for (const sid of revocableSessionIds) {
          pipeline.del(`${this.sessionPrefix}${sid}`);
        }
        pipeline.del(key);
        const results = await pipeline.exec();
        const deletedCount = revocableSessionIds.reduce(
          (count, _sid, index) => {
            const commandResult = results?.[index];
            if (!commandResult) return count;

            const [commandError, deleted] = commandResult;
            if (commandError || typeof deleted !== 'number') return count;

            return deleted > 0 ? count + 1 : count;
          },
          0
        );

        if (deletedCount > 0) {
          this.logger.info('Revoked Express sessions for user', {
            userId,
            deletedCount,
          });
        }

        return deletedCount;
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        if (!this.prismaClient) {
          throw this.unavailableSessionStore(
            'revoke Express sessions',
            'Prisma'
          );
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const sidsToDelete: string[] = [];

        for (const row of rows) {
          try {
            const data = decodePersistedSession(
              row.data,
              'prisma.application_session.data'
            );
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.accountId === userId
            ) {
              sidsToDelete.push(row.sid);
            }
          } catch {
            // best-effort: skip session rows with unparsable JSON payload.
          }
        }

        if (sidsToDelete.length === 0) {
          return 0;
        }

        const result = await (this.prismaClient as any).session.deleteMany({
          where: { sid: { in: sidsToDelete } },
        });

        if (result.count > 0) {
          this.logger.info('Revoked Express sessions for user', {
            userId,
            deletedCount: result.count,
          });
        }

        return result.count;
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to revoke Express sessions for user',
        userId,
      });
      throw error;
    }
  }

  public async findExpressSessionsForUser(accountId: string): Promise<any[]> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      return [];
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          throw this.unavailableSessionStore(
            'find Express sessions',
            'MongoDB'
          );
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        return await sessionCollection
          .find({
            'session.accountId': accountId,
            'session.isAuthenticated': true,
            ...mongoSessionTenantFilter(tenantContext.getTenantId()),
          })
          .sort({ 'session.authTime': -1 })
          .toArray();
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          throw this.unavailableSessionStore('find Express sessions', 'Redis');
        }

        const tenantId = tenantContext.getTenantId();
        const sessionIds = await this.findRedisSessionIdsForAccount(
          accountId,
          [],
          tenantId
        );
        const results: any[] = [];

        for (const sid of sessionIds) {
          const raw = await this.redisClient.get(`${this.sessionPrefix}${sid}`);
          if (!raw) {
            continue;
          }
          try {
            const data = decodePersistedSession(
              raw,
              'redis.application_session.data'
            );
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.accountId === accountId &&
              data.isAuthenticated === true
            ) {
              results.push({ _id: sid, session: data });
            }
          } catch {
            // The authoritative scan already excluded malformed payloads.
          }
        }

        results.sort((a, b) => {
          const aTime = normalizeSessionAuthTime(a.session.authTime);
          const bTime = normalizeSessionAuthTime(b.session.authTime);
          return bTime - aTime;
        });
        return results;
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        if (!this.prismaClient) {
          throw this.unavailableSessionStore('find Express sessions', 'Prisma');
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const results: any[] = [];
        for (const row of rows) {
          try {
            const data = decodePersistedSession(
              row.data,
              'prisma.application_session.data'
            );
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.accountId === accountId &&
              data.isAuthenticated === true
            ) {
              results.push({ _id: row.sid, session: data });
            }
          } catch {
            // best-effort: skip session rows with unparsable JSON payload.
          }
        }
        results.sort((a, b) => {
          const aTime = normalizeSessionAuthTime(a.session.authTime);
          const bTime = normalizeSessionAuthTime(b.session.authTime);
          return bTime - aTime;
        });
        return results;
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to find Express sessions for user',
        accountId,
      });
      throw error;
    }
  }

  public async revokeExpressSession(sessionId: string): Promise<boolean> {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return false;
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          throw this.unavailableSessionStore(
            'revoke Express session',
            'MongoDB'
          );
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        const result = await sessionCollection.deleteOne({
          _id: sessionId as any,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        });

        if (result.deletedCount > 0) {
          this.logger.info('Revoked Express session', { sessionId });
          return true;
        }
        return false;
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          throw this.unavailableSessionStore('revoke Express session', 'Redis');
        }

        const sessionKey = `${this.sessionPrefix}${sessionId}`;
        const raw = await this.redisClient.get(sessionKey);
        if (!raw) {
          return false;
        }

        const tenantId = tenantContext.getTenantId();
        let accountId: string | undefined;
        try {
          const data = decodePersistedSession(
            raw,
            'redis.application_session.data'
          );
          if (!sessionBelongsToTenant(data, tenantId)) {
            return false;
          }
          if (
            typeof data.accountId === 'string' &&
            data.accountId.trim().length > 0
          ) {
            accountId = data.accountId;
          }
        } catch {
          return false;
        }

        const deleted = await this.redisClient.del(sessionKey);

        if (deleted > 0) {
          if (accountId) {
            this.redisIndexRemove(accountId, sessionId);
          }
          this.logger.info('Revoked Express session', { sessionId });
          return true;
        }
        return false;
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        if (!this.prismaClient) {
          throw this.unavailableSessionStore(
            'revoke Express session',
            'Prisma'
          );
        }

        const row = await (this.prismaClient as any).session.findUnique({
          where: { sid: sessionId },
        });
        if (!row) {
          return false;
        }

        try {
          const data = decodePersistedSession(
            row.data,
            'prisma.application_session.data'
          );
          if (!sessionBelongsToTenant(data, tenantContext.getTenantId())) {
            return false;
          }
        } catch {
          return false;
        }

        const result = await (this.prismaClient as any).session.deleteMany({
          where: { sid: sessionId, data: row.data },
        });

        if (result.count > 0) {
          this.logger.info('Revoked Express session', { sessionId });
          return true;
        }
        return false;
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to revoke Express session',
        sessionId,
      });
      throw error;
    }
  }

  public async findAllExpressSessions(
    options: { limit?: number; offset?: number; search?: string } = {}
  ): Promise<any[]> {
    const { limit = 20, offset = 0, search } = options;
    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          throw this.unavailableSessionStore(
            'list Express sessions',
            'MongoDB'
          );
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        const query: any = {
          'session.isAuthenticated': true,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        };
        if (search) {
          query['session.accountId'] = {
            $regex: escapeRegExp(search),
            $options: 'i',
          };
        }

        return await sessionCollection
          .find(query)
          .sort({ 'session.authTime': -1 })
          .skip(offset)
          .limit(limit)
          .toArray();
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          throw this.unavailableSessionStore('list Express sessions', 'Redis');
        }

        const tenantId = tenantContext.getTenantId();
        const results: any[] = [];
        let cursor = '0';
        const pattern = `${this.sessionPrefix}*`;
        const sessionIndexPrefix = `${this.sessionPrefix.replace(/:$/, '')}:user-sessions:`;

        do {
          const [nextCursor, keys] = await this.redisClient.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
          );
          cursor = nextCursor;

          for (const key of keys) {
            if (key.startsWith(sessionIndexPrefix)) continue;
            const raw = await this.redisClient.get(key);
            if (!raw) continue;
            try {
              const data = decodePersistedSession(
                raw,
                'redis.application_session.data'
              );
              if (!sessionBelongsToTenant(data, tenantId)) continue;
              if (data.isAuthenticated !== true) continue;
              if (
                search &&
                !normalizeSessionAccountId(data.accountId)
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
                continue;

              const sid = key.replace(this.sessionPrefix, '');
              results.push({ _id: sid, session: data });
            } catch {
              // best-effort: skip Redis keys with malformed session payloads.
            }
          }
        } while (cursor !== '0');

        results.sort((a, b) => {
          const aTime = normalizeSessionAuthTime(a.session.authTime);
          const bTime = normalizeSessionAuthTime(b.session.authTime);
          return bTime - aTime;
        });

        return results.slice(offset, offset + limit);
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        if (!this.prismaClient) {
          throw this.unavailableSessionStore('list Express sessions', 'Prisma');
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const results: any[] = [];
        for (const row of rows) {
          try {
            const data = decodePersistedSession(
              row.data,
              'prisma.application_session.data'
            );
            if (!sessionBelongsToTenant(data, tenantId)) continue;
            if (data.isAuthenticated !== true) continue;
            if (
              search &&
              !normalizeSessionAccountId(data.accountId)
                .toLowerCase()
                .includes(search.toLowerCase())
            )
              continue;
            results.push({ _id: row.sid, session: data });
          } catch {
            // best-effort: skip rows that fail JSON.parse or property lookup.
          }
        }

        results.sort((a, b) => {
          const aTime = normalizeSessionAuthTime(a.session.authTime);
          const bTime = normalizeSessionAuthTime(b.session.authTime);
          return bTime - aTime;
        });

        return results.slice(offset, offset + limit);
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to find all Express sessions',
      });
      throw error;
    }
  }

  public async countAllExpressSessions(search?: string): Promise<number> {
    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          throw this.unavailableSessionStore(
            'count Express sessions',
            'MongoDB'
          );
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        const query: Record<string, unknown> = {
          'session.isAuthenticated': true,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        };
        if (search) {
          query['session.accountId'] = {
            $regex: escapeRegExp(search),
            $options: 'i',
          };
        }

        return await sessionCollection.countDocuments(query);
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          throw this.unavailableSessionStore('count Express sessions', 'Redis');
        }

        const tenantId = tenantContext.getTenantId();
        let count = 0;
        let cursor = '0';
        const pattern = `${this.sessionPrefix}*`;
        const sessionIndexPrefix = `${this.sessionPrefix.replace(/:$/, '')}:user-sessions:`;

        do {
          const [nextCursor, keys] = await this.redisClient.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
          );
          cursor = nextCursor;

          for (const key of keys) {
            if (key.startsWith(sessionIndexPrefix)) continue;
            const raw = await this.redisClient.get(key);
            if (!raw) continue;
            try {
              const data = decodePersistedSession(
                raw,
                'redis.application_session.data'
              );
              if (
                sessionBelongsToTenant(data, tenantId) &&
                data.isAuthenticated === true &&
                (!search ||
                  normalizeSessionAccountId(data.accountId)
                    .toLowerCase()
                    .includes(search.toLowerCase()))
              ) {
                count++;
              }
            } catch {
              // best-effort: corrupt JSON contributes 0 to the count.
            }
          }
        } while (cursor !== '0');

        return count;
      } else if (storeType === 'sqlite' || storeType === 'postgresql') {
        if (!this.prismaClient) {
          throw this.unavailableSessionStore(
            'count Express sessions',
            'Prisma'
          );
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        let count = 0;
        for (const row of rows) {
          try {
            const data = decodePersistedSession(
              row.data,
              'prisma.application_session.data'
            );
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.isAuthenticated === true &&
              (!search ||
                normalizeSessionAccountId(data.accountId)
                  .toLowerCase()
                  .includes(search.toLowerCase()))
            ) {
              count++;
            }
          } catch {
            // best-effort: corrupt JSON contributes 0 to the count.
          }
        }

        return count;
      }

      throw this.unsupportedSessionStore(storeType);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to count all Express sessions',
      });
      throw error;
    }
  }

  /** Uses the bridge's effective adapter so all session components select one backend. */
  private setupStore(): void {
    const effectiveType: SessionStoreType = this.oidcAdapterBridge
      ? this.oidcAdapterBridge.effectiveOidcAdapter()
      : (this.options.storeType ?? 'mongodb');
    this.options.storeType = effectiveType;

    try {
      switch (effectiveType) {
        case 'mongodb':
          this.setupMongoDBStore();
          break;
        case 'redis':
          this.setupRedisStore();
          break;
        case 'sqlite':
        case 'postgresql':
          this.setupPrismaStore();
          break;
        default:
          throw new Error(`Unsupported session store type: ${effectiveType}`);
      }

      this.applyEncryptionWrapper();

      this.applyCircuitBreakerWrapper();
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Failed to initialize session store: ${this.options.storeType}`,
      });
      throw error;
    }
  }

  private applyCircuitBreakerWrapper(): void {
    if (this.store) {
      this.store = new CircuitBreakerStore(this.store, this.logger);
      this.logger.info('Session store circuit breaker enabled');
    }
  }

  private applyEncryptionWrapper(): void {
    const config = this.configManager.getConfig();
    const encryptionEnabled =
      config.security?.authentication?.session?.encrypt_session_data;

    if (encryptionEnabled && this.store) {
      this.store = new EncryptedSessionStore(this.store, this.logger);
      this.logger.info(
        'Session encryption enabled (AES-256-GCM via ENCRYPTION_KEY)'
      );
    }
  }

  private setupMongoDBStore(): void {
    const config = this.configManager.getConfig();
    const oidcAdapterConfig = config.oidc_storage.oidc_adapter;

    if (!oidcAdapterConfig.mongodb?.uri) {
      throw new Error('MongoDB URI is required for MongoDB session store');
    }

    // Persist touches often enough for the configured idle timeout to remain authoritative.
    const idleTimeoutMinutes =
      config.security?.authentication?.session?.idle_timeout_minutes || 30;
    const touchAfterSeconds = idleTimeoutMinutes * 60;

    this.store = MongoStore.create({
      mongoUrl: oidcAdapterConfig.mongodb.uri,
      collectionName: this.options.collection || 'sessions',
      ttl: this.options.ttl,
      stringify: false,
      mongoOptions: {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
      },
      touchAfter: touchAfterSeconds,
    });

    this.handleStoreErrors(this.store);
    this.logger.info(
      `MongoDB session store configured with collection: ${this.options.collection || 'sessions'}`
    );
  }

  private setupRedisStore(): void {
    const config = this.configManager.getConfig();
    const oidcAdapterConfig = config.oidc_storage.oidc_adapter;

    if (!oidcAdapterConfig.redis) {
      throw new Error(
        'Redis configuration is required for Redis session store'
      );
    }

    const redisConfig = oidcAdapterConfig.redis;
    const redisUrl = `redis://${redisConfig.host}:${redisConfig.port}/${redisConfig.database}`;

    const redisClient = new Redis(redisUrl, {
      password: redisConfig.password,
    });
    this.redisClient = redisClient;

    redisClient.on('error', err => {
      this.logger.error('Redis session store connection error', {
        error: String(err),
      });
    });

    redisClient.on('connect', () => {
      this.logger.info('Redis session store connected successfully');
    });

    const basePrefix = config.deployment?.redis_prefix || 'parako';
    const sessionPrefix = `${basePrefix}:session:`;
    this.sessionPrefix = sessionPrefix;

    this.store = new RedisStore({
      client: createConnectRedisClientAdapter(redisClient),
      prefix: sessionPrefix,
      ttl: this.options.ttl,
    });

    this.handleStoreErrors(this.store);
    this.logger.info('Redis session store configured');
  }

  private setupPrismaStore(): void {
    if (!this.prismaClient) {
      throw new Error(
        'Prisma client not available for session store. Ensure STORAGE_ADAPTER=sqlite or postgresql.'
      );
    }
    const store = new PrismaSessionStore(
      this.prismaClient,
      this.options.ttl ?? 86400,
      this.logger
    );
    store.startCleanup();
    this.store = store;
    this.handleStoreErrors(this.store);
    this.logger.info('Prisma session store configured');
  }

  private resolveStoreType(): SessionStoreType {
    if (this.oidcAdapterBridge) {
      return this.oidcAdapterBridge.effectiveOidcAdapter();
    }
    const config = this.configManager.getConfig();
    return (
      (config.oidc_storage?.oidc_adapter?.type as SessionStoreType) || 'mongodb'
    );
  }

  private unavailableSessionStore(operation: string, store: string): Error {
    return new Error(
      `Cannot ${operation}: ${store} session store is unavailable`
    );
  }

  private unsupportedSessionStore(storeType: never): Error {
    return new Error(`Unsupported session store type: ${String(storeType)}`);
  }

  private redisUserSessionsKey(
    accountId: string,
    tenantId = tenantContext.getTenantId()
  ): string {
    const base = this.sessionPrefix.replace(/:$/, '');
    if (tenantId !== DEFAULT_TENANT_ID) {
      return `${base}:user-sessions:${tenantId}:${accountId}`;
    }
    return `${base}:user-sessions:${accountId}`;
  }

  /**
   * Reconcile a tenant-scoped user index against authoritative Redis sessions.
   * Administrative revocation must not miss a live session because an earlier
   * fire-and-forget index update failed, or delete another user's session due
   * to a stale cross-account index entry.
   */
  private async findRedisSessionIdsForAccount(
    accountId: string,
    protectedSessionIds: readonly string[] = [],
    tenantId = tenantContext.getTenantId()
  ): Promise<string[]> {
    if (!this.redisClient) return [];

    const indexKey = this.redisUserSessionsKey(accountId, tenantId);
    const indexedIds = new Set(await this.redisClient.smembers(indexKey));
    const actualIds = new Set<string>();
    const indexPrefix = `${this.sessionPrefix.replace(/:$/, '')}:user-sessions:`;
    const pattern = `${this.sessionPrefix}*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        if (key.startsWith(indexPrefix)) continue;

        const raw = await this.redisClient.get(key);
        if (!raw) continue;

        try {
          const data = decodePersistedSession(
            raw,
            'redis.application_session.data'
          );
          if (
            sessionBelongsToTenant(data, tenantId) &&
            data.accountId === accountId
          ) {
            actualIds.add(key.slice(this.sessionPrefix.length));
          }
        } catch {
          // Malformed sessions cannot be safely attributed to an account.
        }
      }
    } while (cursor !== '0');

    const protectedIds = new Set(protectedSessionIds);
    const expectedIndexedIds = new Set(actualIds);
    for (const sessionId of indexedIds) {
      if (protectedIds.has(sessionId)) {
        expectedIndexedIds.add(sessionId);
      }
    }
    const indexIsConsistent =
      indexedIds.size === expectedIndexedIds.size &&
      [...indexedIds].every(sessionId => expectedIndexedIds.has(sessionId));
    if (!indexIsConsistent) {
      this.logger.warn(
        'Redis session index inconsistent; using authoritative session scan',
        {
          accountId,
          indexedCount: indexedIds.size,
          actualCount: actualIds.size,
        }
      );
    }

    const staleIds = [...indexedIds].filter(
      sessionId => !actualIds.has(sessionId) && !protectedIds.has(sessionId)
    );
    if (staleIds.length > 0) {
      const logCleanupFailure = (err: unknown): void => {
        this.logger.warn('Redis session-index lazy cleanup failed (srem)', {
          step: 'redis-session-index-cleanup',
          key: indexKey,
          err: err instanceof Error ? err.message : String(err),
        });
      };

      try {
        this.redisClient.srem(indexKey, ...staleIds).catch(logCleanupFailure);
      } catch (err) {
        logCleanupFailure(err);
      }
    }

    return [...actualIds];
  }

  /** Best-effort index maintenance; authoritative scans repair missed writes. */
  private redisIndexAdd(accountId: string, sessionId: string): void {
    if (!this.redisClient || !accountId) return;
    try {
      const key = this.redisUserSessionsKey(accountId);
      const ttl = this.options.ttl || 86400;
      this.redisClient
        .multi()
        .sadd(key, sessionId)
        .expire(key, ttl)
        .exec()
        .catch(err => {
          this.logger.warn('Failed to update Redis session index (add)', {
            accountId,
            sessionId,
            error: String(err),
          });
        });
    } catch (err) {
      this.logger.warn('Failed to update Redis session index (add)', {
        accountId,
        sessionId,
        error: String(err),
      });
    }
  }

  private redisIndexRemove(accountId: string, sessionId: string): void {
    if (!this.redisClient || !accountId) return;
    const logFailure = (err: unknown): void => {
      this.logger.warn('Failed to update Redis session index (remove)', {
        accountId,
        sessionId,
        error: String(err),
      });
    };

    try {
      const key = this.redisUserSessionsKey(accountId);
      this.redisClient.srem(key, sessionId).catch(logFailure);
    } catch (err) {
      logFailure(err);
    }
  }

  /** Keeps the Redis user index consistent when the active account changes. */
  private redisIndexReplace(
    oldAccountId: string,
    newAccountId: string,
    sessionId: string
  ): void {
    if (!this.redisClient) return;
    const logFailure = (err: unknown): void => {
      this.logger.warn('Failed to update Redis session index (replace)', {
        oldAccountId,
        newAccountId,
        sessionId,
        error: String(err),
      });
    };

    try {
      const ttl = this.options.ttl || 86400;
      const pipeline = this.redisClient.multi();
      if (oldAccountId) {
        pipeline.srem(this.redisUserSessionsKey(oldAccountId), sessionId);
      }
      if (newAccountId) {
        const newKey = this.redisUserSessionsKey(newAccountId);
        pipeline.sadd(newKey, sessionId);
        pipeline.expire(newKey, ttl);
      }
      pipeline.exec().catch(logFailure);
    } catch (err) {
      logFailure(err);
    }
  }

  /**
   * Hold redirects until the current session has reached its backing store.
   *
   * express-session normally saves from its res.end() wrapper. That wrapper
   * may write response headers before an asynchronous store callback returns,
   * allowing a browser to follow a Location header and read stale session
   * state. Persisting first prevents flash messages and authentication changes
   * from being lost when database-backed stores have non-trivial latency.
   */
  private redirectAfterSessionSaveMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      const originalRedirect = res.redirect.bind(res);

      res.redirect = ((...args: unknown[]): Response => {
        const performRedirect = (): Response =>
          Reflect.apply(originalRedirect, res, args) as Response;

        if (!req.session || typeof req.session.save !== 'function') {
          return performRedirect();
        }

        req.session.save(error => {
          if (error) {
            next(error);
            return;
          }

          performRedirect();
        });

        return res;
      }) as Response['redirect'];

      next();
    };
  }

  private setupMiddleware(): void {
    const sessionOptions: SessionOptions = {
      secret: this.options.secret!,
      name: this.options.name,
      cookie: this.options.cookie as any,
      rolling: this.options.rolling,
      resave: this.options.resave,
      saveUninitialized: this.options.saveUninitialized,
      proxy: this.options.proxy,
      store: this.store,
      genid: this.generateSessionId.bind(this),
    };

    this.sessionMiddleware = session(sessionOptions);
  }

  private handleStoreErrors(store: any): void {
    if (store && typeof store.on === 'function') {
      store.on('error', (error: Error) => {
        this.logger.error('Session store error', { error: error.message });

        if (
          this.configManager.getConfig().deployment.environment === 'production'
        ) {
          if (
            this.options.storeType === 'mongodb' &&
            error.message?.includes('disconnected')
          ) {
            this.logger.warn(
              'MongoDB session store disconnected. Attempting to reconnect...'
            );
          }
        }
      });

      if (store.client && typeof store.client.on === 'function') {
        store.client.on('reconnect', () => {
          this.logger.info('Session store successfully reconnected');
        });
      }
    }
  }

  public getMiddleware(): any {
    if (!this.sessionMiddleware) {
      throw new Error(
        'Session middleware not initialized. Call initialize() first.'
      );
    }
    return this.sessionMiddleware;
  }

  public activityTracker(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, _res: Response, next: NextFunction) => {
      if (req.session) {
        req.session.lastActivity = Date.now();
        if (!req.session.created) {
          req.session.created = Date.now();
        }
      }
      next();
    };
  }

  /** Reads the FingerprintJS visitor ID from the static `_deviceInfo` field. */
  private extractDeviceIdFromRequest(req: Request): string | null {
    try {
      const csrfToken = this.get<string>(req, 'csrfToken');
      if (!csrfToken) {
        return null;
      }

      const deviceFieldName = '_deviceInfo';
      const deviceData = req.body?.[deviceFieldName];

      if (!deviceData || typeof deviceData !== 'string') {
        return null;
      }

      let parsedData: { visitorId?: string };
      try {
        parsedData = JSON.parse(deviceData);
      } catch {
        try {
          const decoded = Buffer.from(deviceData, 'base64').toString('utf-8');
          parsedData = JSON.parse(decoded);
        } catch {
          return null;
        }
      }

      const visitorId = parsedData?.visitorId;
      return typeof visitorId === 'string' && visitorId.trim().length > 0
        ? visitorId
        : null;
    } catch {
      return null;
    }
  }

  public validateSessionBinding(req: Request): {
    valid: boolean;
    reason?: string;
  } {
    if (!req.session || !this.get(req, 'isAuthenticated')) {
      return { valid: true }; // Skip validation for unauthenticated sessions
    }

    const config = this.configManager.getConfig();
    const sessionSecurity = config.security?.authentication?.session || {};

    if (sessionSecurity.bind_ip) {
      const storedIp = this.get<string>(req, 'ipAddress');
      const currentIp = req.ip;

      if (storedIp && currentIp && storedIp !== currentIp) {
        this.logger.warn('Session IP mismatch detected', {
          storedIp,
          currentIp,
          sessionId: req.session?.id,
        });
        return {
          valid: false,
          reason: 'ip_mismatch',
        };
      }
    }

    if (sessionSecurity.bind_user_agent) {
      const storedUA = this.get<string>(req, 'userAgent');
      const currentUA = req.headers['user-agent'];

      if (storedUA && currentUA && storedUA !== currentUA) {
        this.logger.warn('Session User-Agent mismatch detected', {
          storedUA: storedUA.substring(0, 50),
          currentUA: currentUA?.substring(0, 50),
          sessionId: req.session?.id,
        });
        return {
          valid: false,
          reason: 'user_agent_mismatch',
        };
      }
    }

    if (sessionSecurity.bind_device) {
      const storedDeviceId = this.get<string>(req, 'deviceId');
      const currentDeviceId = this.extractDeviceIdFromRequest(req);

      if (
        storedDeviceId &&
        currentDeviceId &&
        storedDeviceId !== currentDeviceId
      ) {
        this.logger.warn('Session device ID mismatch detected', {
          storedDeviceId: `${storedDeviceId.substring(0, 20)}...`,
          currentDeviceId: `${currentDeviceId.substring(0, 20)}...`,
          sessionId: req.session?.id,
        });
        return {
          valid: false,
          reason: 'device_mismatch',
        };
      }
    }

    return { valid: true };
  }

  /** Destroys sessions whose configured request bindings no longer match. */
  public sessionBindingValidator(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      const validation = this.validateSessionBinding(req);

      if (!validation.valid) {
        this.logger.warn(
          'Session binding validation failed, destroying session',
          {
            reason: validation.reason,
            sessionId: req.session?.id,
          }
        );

        try {
          await this.destroy(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to destroy invalid session',
          });
        }

        const loginUrl = `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`;
        return res.redirect(`${loginUrl}?reason=session_invalid`);
      }

      next();
    };
  }

  public idleTimeoutMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.session || !this.get(req, 'isAuthenticated')) {
        return next();
      }

      const config = this.configManager.getConfig();
      const idleTimeoutMinutes =
        config.security?.authentication?.session?.idle_timeout_minutes;

      if (!idleTimeoutMinutes || idleTimeoutMinutes <= 0) {
        return next();
      }

      const lastActivity = this.get<number>(req, 'lastActivity') || 0;
      const now = Date.now();
      const idleTimeMs = idleTimeoutMinutes * 60 * 1000;

      if (now - lastActivity > idleTimeMs) {
        const activeUser = this.getActiveUser(req);
        this.logger.info('Session idle timeout exceeded', {
          userId: activeUser?.id,
          username: activeUser?.username,
          idleMinutes: Math.floor((now - lastActivity) / 60000),
          configuredLimit: idleTimeoutMinutes,
        });

        try {
          await this.destroy(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to destroy idle session',
          });
        }

        const loginUrl = `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`;
        return res.redirect(`${loginUrl}?reason=idle_timeout`);
      }

      next();
    };
  }

  public absoluteTimeoutMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.session || !this.get(req, 'isAuthenticated')) {
        return next();
      }

      const config = this.configManager.getConfig();
      const absoluteTimeoutHours =
        config.security?.authentication?.session?.absolute_timeout_hours;

      if (!absoluteTimeoutHours || absoluteTimeoutHours <= 0) {
        return next();
      }

      const authTime = this.get<number>(req, 'authTime') || 0;
      const now = Date.now();
      const maxLifetimeMs = absoluteTimeoutHours * 60 * 60 * 1000;

      if (now - authTime > maxLifetimeMs) {
        const activeUser = this.getActiveUser(req);
        this.logger.info('Session absolute timeout exceeded', {
          userId: activeUser?.id,
          username: activeUser?.username,
          sessionAgeHours: Math.floor((now - authTime) / 3600000),
          configuredLimit: absoluteTimeoutHours,
        });

        try {
          await this.destroy(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to destroy expired session',
          });
        }

        const loginUrl = `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`;
        return res.redirect(`${loginUrl}?reason=session_expired`);
      }

      next();
    };
  }

  private sessionRecord(req: Request): Record<string, unknown> {
    return req.session as unknown as Record<string, unknown>;
  }

  public set<T>(req: Request, key: string, value: T): void {
    if (!req.session) {
      throw new Error('Session not available');
    }

    this.sessionRecord(req)[key] = value;
  }

  public get<T = unknown>(
    req: Request,
    key: string,
    defaultValue?: T
  ): T | undefined {
    if (!req.session) {
      return undefined;
    }

    const value = this.sessionRecord(req)[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  public getAll(req: Request): SessionData {
    if (!req.session) {
      return {};
    }

    const sessionData: Record<string, unknown> = {};
    const storedSession = this.sessionRecord(req);

    Object.keys(storedSession).forEach(key => {
      if (key !== 'cookie' && key !== 'id') {
        sessionData[key] = storedSession[key];
      }
    });

    return sessionData as SessionData;
  }

  public remove(req: Request, key: string): void {
    if (!req.session) {
      return;
    }

    delete this.sessionRecord(req)[key];
  }

  public clear(req: Request, preserveKeys: string[] = []): void {
    if (!req.session) {
      return;
    }

    const currentSession = this.sessionRecord(req);

    const preserved: Record<string, unknown> = {};
    preserveKeys.forEach(key => {
      if (currentSession[key] !== undefined) {
        preserved[key] = currentSession[key];
      }
    });

    Object.keys(currentSession).forEach(key => {
      if (key !== 'cookie' && !preserveKeys.includes(key)) {
        delete currentSession[key];
      }
    });

    Object.assign(currentSession, preserved);
  }

  /** Regenerates the identifier without dropping data to prevent session fixation. */
  public regenerate(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        return reject(new Error('Session not available'));
      }

      const sessionData = this.getAll(req);
      const oldSessionId = req.session.id;
      const accountId = sessionData.accountId as string | undefined;

      req.session.regenerate(err => {
        if (err) {
          return reject(err);
        }

        const regeneratedSession = req.session;
        if (!regeneratedSession) {
          return reject(new Error('Session not available after regeneration'));
        }

        const regeneratedRecord = regeneratedSession as unknown as Record<
          string,
          unknown
        >;
        const storedData = sessionData as unknown as Record<string, unknown>;
        Object.keys(storedData).forEach(key => {
          regeneratedRecord[key] = storedData[key];
        });

        if (this.redisClient && accountId) {
          const newSessionId = regeneratedSession.id;
          const key = this.redisUserSessionsKey(accountId);
          const ttl = this.options.ttl || 86400;
          const indexUpdate = this.redisClient
            .multi()
            .srem(key, oldSessionId)
            .sadd(key, newSessionId)
            .expire(key, ttl)
            .exec()
            .catch(indexErr => {
              this.logger.warn(
                'Failed to update Redis session index (regenerate)',
                {
                  accountId,
                  oldSessionId,
                  newSessionId,
                  error: String(indexErr),
                }
              );
            });

          void indexUpdate.then(() => resolve());
          return;
        }

        resolve();
      });
    });
  }

  public destroy(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        return resolve();
      }

      const accountId = this.get<string>(req, 'accountId');
      const sessionId = req.session.id;

      req.session.destroy(err => {
        if (err) {
          return reject(err);
        }

        if (this.redisClient && accountId && sessionId) {
          this.redisIndexRemove(accountId, sessionId);
        }

        req.session = null as any;
        resolve();
      });
    });
  }

  /** Clears authentication state before the session is destroyed during logout. */
  public clearAuthenticationData(req: Request): void {
    if (!req.session) {
      return;
    }

    if (this.redisClient) {
      const accountId = this.get<string>(req, 'accountId');
      if (accountId) {
        this.redisIndexRemove(accountId, req.session.id);
      }
    }

    this.remove(req, 'isAuthenticated');
    this.remove(req, 'authenticatedUsers');
    this.remove(req, 'accountId');
    this.remove(req, 'authTime');
    this.remove(req, 'lastActivity');
    this.remove(req, 'deviceId');
    this.remove(req, 'sessionRegenerated');

    this.remove(req, 'oidc');
    this.remove(req, 'interaction');

    this.remove(req, 'addAccountIntent');
    this.remove(req, 'currentActiveLoggedUser');
  }

  public exists(req: Request): boolean {
    return !!req.session;
  }

  public async isAuthenticated(req: Request): Promise<boolean> {
    if (!this.exists(req)) {
      return false;
    }

    const isExplicitlyAuthenticated = this.get(req, 'isAuthenticated') === true;
    const activeUser = this.getActiveUser(req);

    if (
      !isExplicitlyAuthenticated ||
      !activeUser ||
      typeof activeUser.id !== 'string' ||
      activeUser.id.trim().length === 0
    ) {
      return false;
    }

    try {
      // In multi-tenant mode, findById() is filtered by the Mongoose tenant
      // plugin — returns null if the user belongs to a different tenant.
      const user = await this.userService.findById(activeUser.id);
      if (!user && activeUser.id) {
        this.logger.warn('session_user_not_found_in_tenant', {
          userId: activeUser.id,
          username: activeUser.username,
          hint: 'User may belong to a different tenant than the current request context',
        });
      }
      return !!(user && user.account_enabled === true);
    } catch (error) {
      this.logger.error('Failed to verify user account status', {
        userId: activeUser.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  public setAuthenticated(
    req: Request,
    userData: SessionAuthenticationData = {}
  ): void {
    const currentActiveLoggedUser = userData.currentActiveLoggedUser;
    const accountId =
      currentActiveLoggedUser?.id ?? currentActiveLoggedUser?._id;
    let userAccount: SessionUserAccount | undefined;
    if (
      currentActiveLoggedUser &&
      typeof accountId === 'string' &&
      accountId.trim().length > 0 &&
      currentActiveLoggedUser.username.trim().length > 0
    ) {
      userAccount = {
        id: accountId,
        username: currentActiveLoggedUser.username,
        email: currentActiveLoggedUser.email,
        email_verified: currentActiveLoggedUser.email_verified,
        given_name: currentActiveLoggedUser.given_name,
        family_name: currentActiveLoggedUser.family_name,
        full_name: currentActiveLoggedUser.full_name,
        picture: currentActiveLoggedUser.picture,
        roles: currentActiveLoggedUser.roles,
        is_admin: currentActiveLoggedUser.is_admin,
        last_used: Date.now(),
        zoneinfo: currentActiveLoggedUser.zoneinfo,
        locale: currentActiveLoggedUser.locale,
      };
    }

    if (!userAccount) {
      throw new TypeError(
        'Authenticated session requires a stable account id and username'
      );
    }

    {
      const existingAuthUsers = this.get<AuthenticatedUsers>(
        req,
        'authenticatedUsers'
      );

      if (existingAuthUsers) {
        const multiAccountEnabled =
          this.configManager.getConfig().security?.authentication
            ?.session_management?.multiple_accounts?.enabled;

        if (multiAccountEnabled === false) {
          this.set(req, 'authenticatedUsers', {
            active: userAccount,
            others: [],
          });
        } else {
          const otherAccounts = Array.isArray(existingAuthUsers.others)
            ? [...existingAuthUsers.others]
            : [];
          const existingIndex = otherAccounts.findIndex(
            account =>
              account.id === userAccount?.id ||
              account.username === userAccount?.username
          );

          if (existingIndex >= 0) {
            otherAccounts.splice(existingIndex, 1);
          }

          if (
            existingAuthUsers.active &&
            existingAuthUsers.active.id !== userAccount.id &&
            existingAuthUsers.active.username !== userAccount.username
          ) {
            otherAccounts.push({
              ...existingAuthUsers.active,
              last_used: Date.now(),
            });
          }

          this.set(req, 'authenticatedUsers', {
            active: userAccount,
            others: otherAccounts,
          });
        }
      } else {
        this.set(req, 'authenticatedUsers', {
          active: userAccount,
          others: [],
        });
      }
    }

    const deviceId = this.extractDeviceIdFromRequest(req);

    const config = this.configManager.getConfig();
    const storeMetadata =
      config.security?.authentication?.session?.store_metadata;
    let metadata: SessionMetadata | undefined;

    if (storeMetadata) {
      const userAgentString = req.headers['user-agent'] || '';
      const uaResult = parseUserAgent(userAgentString);

      let createdFrom: SessionMetadata['createdFrom'] = 'unknown';
      if (isSessionCreationSource(userData.createdFrom)) {
        createdFrom = userData.createdFrom;
      } else if (
        req.path?.includes('/social') ||
        req.path?.includes('/callback')
      ) {
        createdFrom = 'social';
      } else if (req.path?.includes('/api')) {
        createdFrom = 'api';
      } else if (req.path?.includes('/login') || req.path?.includes('/auth')) {
        createdFrom = 'login';
      }

      metadata = {
        created_at: new Date(),
        createdFrom,
        createdIp: req.ip,
        userAgent: userAgentString,
        browser: {
          name: uaResult.browser.name,
          version: uaResult.browser.version,
        },
        os: {
          name: uaResult.os.name,
          version: uaResult.os.version,
        },
        device: {
          type: uaResult.device.type || 'desktop',
          vendor: uaResult.device.vendor,
          model: uaResult.device.model,
        },
      };
    }

    const sessionData: Record<string, unknown> = {
      ...userData,
      ...userData.extensions,
      isAuthenticated: true,
      authTime: Date.now(),
      lastActivity: Date.now(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: deviceId || undefined,
      accountId: userAccount?.username ?? userData.accountId,
      _metadata: metadata,
    };
    delete sessionData.currentActiveLoggedUser;
    delete sessionData.authenticatedUsers;
    delete sessionData.extensions;

    Object.entries(sessionData).forEach(([key, value]) => {
      this.set(req, key, value);
    });

    if (this.redisClient && userAccount?.username) {
      this.redisIndexAdd(userAccount.username, req.session.id);
    }
  }

  public getActiveUser(req: Request): SessionUserAccount | undefined {
    const authUsers = this.get<AuthenticatedUsers>(req, 'authenticatedUsers');
    return authUsers?.active;
  }

  public updateActiveUserData(
    req: Request,
    updates: Partial<SessionUserAccount>
  ): boolean {
    const authUsers = this.get<AuthenticatedUsers>(req, 'authenticatedUsers');
    if (!authUsers?.active) {
      return false;
    }

    const oldUsername = authUsers.active.username;
    const updatedUsername =
      typeof updates.username === 'string' && updates.username.trim().length > 0
        ? updates.username
        : oldUsername;
    const updatedId =
      typeof updates.id === 'string' && updates.id.trim().length > 0
        ? updates.id
        : authUsers.active.id;
    const updatedActive = {
      ...authUsers.active,
      ...updates,
      id: updatedId,
      username: updatedUsername,
    };

    this.set(req, 'authenticatedUsers', {
      ...authUsers,
      active: updatedActive,
    });

    if (oldUsername !== updatedUsername) {
      this.set(req, 'accountId', updatedUsername);

      if (this.redisClient) {
        this.redisIndexReplace(oldUsername, updatedUsername, req.session.id);
      }
    }

    return true;
  }

  public getAuthenticatedUsers(req: Request): AuthenticatedUsers | undefined {
    return this.get<AuthenticatedUsers>(req, 'authenticatedUsers');
  }

  public switchUser(req: Request, userId: string): SwitchUserResult {
    const authUsers = this.get<AuthenticatedUsers>(req, 'authenticatedUsers');

    if (!authUsers?.active || !Array.isArray(authUsers.others)) {
      return { success: false, reason: 'user_not_found' };
    }

    const userIndex = authUsers.others.findIndex(
      user => user.id === userId || user.username === userId
    );

    if (userIndex < 0) {
      return { success: false, reason: 'user_not_found' };
    }

    const config = this.configManager.getConfig();
    const requireReauth =
      config.security?.authentication?.session?.require_reauth_on_switch;

    if (requireReauth) {
      this.set(req, 'pendingSwitchUserId', userId);
      this.logger.debug('Account switch requires re-authentication', {
        targetUserId: userId,
        currentUser: authUsers.active?.username,
      });
      return { success: false, reason: 'reauth_required' };
    }

    const oldAccountId = authUsers.active?.username;

    const newActiveUser = authUsers.others[userIndex];

    authUsers.others.splice(userIndex, 1);

    authUsers.others.push({
      ...authUsers.active,
      last_used: Date.now(),
    });

    newActiveUser.last_used = Date.now();
    authUsers.active = newActiveUser;

    this.set(req, 'authenticatedUsers', authUsers);

    this.set(req, 'accountId', newActiveUser.username);

    if (this.redisClient && oldAccountId !== newActiveUser.username) {
      this.redisIndexReplace(
        oldAccountId,
        newActiveUser.username,
        req.session.id
      );
    }

    return { success: true };
  }

  public addAuthenticatedUser(
    req: Request,
    userAccount: SessionUserAccount,
    setAsActive = false
  ): AddAuthenticatedUserResult {
    const sessionUserAccount = { ...userAccount };
    const storedAuthUsers = this.get<AuthenticatedUsers>(
      req,
      'authenticatedUsers'
    );

    const config = this.configManager.getConfig();
    const maxAccountsPerSession =
      config.security?.authentication?.session?.max_accounts_per_session || 5;

    if (!storedAuthUsers?.active) {
      this.set(req, 'authenticatedUsers', {
        active: sessionUserAccount,
        others: [],
      });

      this.set(req, 'accountId', sessionUserAccount.username);

      if (this.redisClient && sessionUserAccount.username) {
        this.redisIndexAdd(sessionUserAccount.username, req.session.id);
      }

      return { success: true };
    }

    const authUsers: AuthenticatedUsers = {
      active: { ...storedAuthUsers.active },
      others: Array.isArray(storedAuthUsers.others)
        ? [...storedAuthUsers.others]
        : [],
    };

    const multiAccountEnabled =
      config.security?.authentication?.session_management?.multiple_accounts
        ?.enabled;
    if (multiAccountEnabled === false) {
      return { success: false, reason: 'multi_account_disabled' };
    }

    const existsInActive =
      authUsers.active.id === userAccount.id ||
      authUsers.active.username === userAccount.username;
    const existsInOthers = authUsers.others.some(
      user =>
        user.id === userAccount.id || user.username === userAccount.username
    );

    if (existsInActive || existsInOthers) {
      return { success: false, reason: 'already_exists' };
    }

    const currentCount = 1 + authUsers.others.length; // active + others
    if (currentCount >= maxAccountsPerSession) {
      this.logger.warn('Max accounts per session limit reached', {
        currentCount,
        maxAccountsPerSession,
        attemptedUser: userAccount.username,
      });
      return { success: false, reason: 'max_limit_reached' };
    }

    if (setAsActive) {
      const oldAccountId = authUsers.active?.username;

      authUsers.others.push({
        ...authUsers.active,
        last_used: Date.now(),
      });

      sessionUserAccount.last_used = Date.now();
      authUsers.active = sessionUserAccount;

      this.set(req, 'accountId', sessionUserAccount.username);

      if (this.redisClient && oldAccountId !== sessionUserAccount.username) {
        this.redisIndexReplace(
          oldAccountId,
          sessionUserAccount.username,
          req.session.id
        );
      }
    } else {
      sessionUserAccount.last_used = Date.now();
      authUsers.others.push(sessionUserAccount);
    }

    this.set(req, 'authenticatedUsers', authUsers);

    return { success: true };
  }

  /** Also revokes OIDC grants owned by the removed account. */
  public async removeAuthenticatedUser(
    req: Request,
    userId: string
  ): Promise<boolean> {
    const storedAuthUsers = this.get<AuthenticatedUsers>(
      req,
      'authenticatedUsers'
    );

    if (!storedAuthUsers?.active || !Array.isArray(storedAuthUsers.others)) {
      return false;
    }

    const authUsers: AuthenticatedUsers = {
      active: { ...storedAuthUsers.active },
      others: [...storedAuthUsers.others],
    };

    let removedUser: SessionUserAccount | undefined;

    if (
      authUsers.active.id === userId ||
      authUsers.active.username === userId
    ) {
      if (authUsers.others.length === 0) {
        return false;
      }

      removedUser = authUsers.active;

      authUsers.others.sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
      authUsers.active = authUsers.others.shift() as SessionUserAccount;

      this.set(req, 'authenticatedUsers', authUsers);

      this.set(req, 'accountId', authUsers.active.username);

      if (this.redisClient) {
        this.redisIndexReplace(
          removedUser.username,
          authUsers.active.username,
          req.session.id
        );
      }
    } else {
      const userIndex = authUsers.others.findIndex(
        user => user.id === userId || user.username === userId
      );

      if (userIndex < 0) return false;

      removedUser = authUsers.others[userIndex];

      authUsers.others.splice(userIndex, 1);

      this.set(req, 'authenticatedUsers', authUsers);
    }

    if (removedUser && this.oidcAdapterBridge) {
      try {
        const grantAdapter = this.oidcAdapterBridge.grant;
        if (
          grantAdapter &&
          typeof (grantAdapter as any).revokeAllGrantsForAccount === 'function'
        ) {
          await (grantAdapter as any).revokeAllGrantsForAccount(
            removedUser.username
          );
          this.logger.info('Revoked OIDC grants for removed account', {
            userId: removedUser.id,
            username: removedUser.username,
          });
        }
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to revoke OIDC grants on account removal',
          userId: removedUser.id,
          username: removedUser.username,
        });
      }
    }

    return true;
  }

  public getTTL(req: Request): number {
    if (!req.session || !req.session.cookie) {
      return 0;
    }

    const expires = req.session.cookie.expires;
    if (expires === undefined || expires === null) {
      return this.options.ttl || 0;
    }

    if (typeof expires === 'number') {
      if (!Number.isFinite(expires)) return 0;
      return Math.max(0, Math.floor((expires - Date.now()) / 1000));
    }

    if (expires instanceof Date) {
      const expiresAt = expires.getTime();
      if (!Number.isFinite(expiresAt)) return 0;
      return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    }

    return 0;
  }

  public generateCsrfToken(req: Request): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.set(req, 'csrfToken', token);
    return token;
  }

  public validateCsrfToken(req: Request, token: string): boolean {
    const storedToken = this.get<string>(req, 'csrfToken');
    if (
      typeof storedToken !== 'string' ||
      storedToken.length === 0 ||
      typeof token !== 'string'
    ) {
      return false;
    }

    const storedTokenBuffer = Buffer.from(storedToken, 'utf8');
    const tokenBuffer = Buffer.from(token, 'utf8');

    return (
      storedTokenBuffer.length === tokenBuffer.length &&
      crypto.timingSafeEqual(storedTokenBuffer, tokenBuffer)
    );
  }

  /** Rotates the token after security-sensitive account operations. */
  public rotateCsrfToken(req: Request): string {
    const oldToken = this.get<string>(req, 'csrfToken');
    const newToken = crypto.randomBytes(32).toString('hex');
    this.set(req, 'csrfToken', newToken);

    this.logger.debug('CSRF token rotated after sensitive operation', {
      sessionId: req.session?.id,
      hadOldToken: !!oldToken,
    });

    return newToken;
  }

  public csrfProtection(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }

      // Skip CSRF validation for update-profile route (has custom validation after multer)
      if (req.path === '/accounts/update-profile') {
        return next();
      }

      const token =
        (req.headers['x-csrf-token'] as string) ||
        req.body?._csrf ||
        (req.query?._csrf as string);

      if (!token || !this.validateCsrfToken(req, token)) {
        const config = this.configManager.getConfig();
        const oidcPath = config.oidc.path;
        const oidcRoutes = config.oidc.routes;

        // These are OAuth2/OIDC protocol endpoints that clients POST to directly
        const exemptOidcEndpoints = [
          `${oidcPath}${oidcRoutes.token || '/token'}`,
          `${oidcPath}${oidcRoutes.userinfo || '/me'}`,
          `${oidcPath}${oidcRoutes.introspection || '/token/introspection'}`,
          `${oidcPath}${oidcRoutes.revocation || '/token/revocation'}`,
          `${oidcPath}${oidcRoutes.device_authorization || '/device/auth'}`,
          `${oidcPath}/jwks`,
          `${oidcPath}/.well-known/openid-configuration`,
          `${oidcPath}/reg`, // Dynamic client registration
        ];

        const isExemptOidcEndpoint = exemptOidcEndpoints.some(endpoint => {
          return (
            req.path === endpoint ||
            req.path.startsWith(`${endpoint}/`) ||
            req.path.startsWith(`${endpoint}?`)
          );
        });

        if (isExemptOidcEndpoint) {
          this.logger.debug(
            `CSRF validation skipped for OIDC spec endpoint: ${req.path}`
          );
          return next();
        }

        if (req.path.includes('/api')) {
          const authHeader = req.headers.authorization;

          if (
            authHeader?.startsWith('Bearer ') &&
            authHeader.slice('Bearer '.length).trim().length > 0
          ) {
            this.logger.debug(
              `CSRF bypassed for API with Bearer auth: ${req.path}`
            );
            return next();
          }

          // Allow if request is same-origin (internal AJAX calls)
          const origin = req.headers.origin as string | undefined;
          const referer = req.headers.referer as string | undefined;
          const appUrl = config.deployment.url;

          let appOrigin: string | undefined;
          try {
            appOrigin = new URL(appUrl).origin;
          } catch {
            this.logger.error('Invalid deployment URL for CSRF validation', {
              deploymentUrl: appUrl,
            });
          }

          const matchesAppOrigin = (value: string | undefined): boolean => {
            if (!value || !appOrigin) return false;

            try {
              return new URL(value).origin === appOrigin;
            } catch {
              return false;
            }
          };

          const isSameOrigin =
            matchesAppOrigin(origin) || matchesAppOrigin(referer);

          if (isSameOrigin) {
            this.logger.debug(
              `CSRF bypassed for same-origin API request: ${req.path}`
            );
            return next();
          }

          this.logger.warn(
            'API request rejected - no Bearer token or same-origin',
            {
              path: req.path,
              origin,
              referer,
              expectedOrigin: appOrigin,
            }
          );

          return res.status(403).json({
            ok: false,
            error: 'Forbidden - invalid origin or missing Bearer token',
          });
        }

        // OIDC interaction routes (login, consent, etc.) MUST have CSRF protection
        // These use form submissions from our own pages
        this.logger.warn('CSRF validation failed', {
          ip: req.ip,
          url: req.originalUrl,
          method: req.method,
          providedToken: token ? 'present' : 'missing',
          sessionToken: this.get<string>(req, 'csrfToken')
            ? 'present'
            : 'missing',
        });

        res.status(403).render(this.viewResolver.views.errors.forbidden, {
          title: 'Forbidden',
          message: 'CSRF token validation failed',
        });
        return;
      }

      next();
    };
  }

  public flash(req: Request): IFlashManager {
    return new FlashManager(req, this, this.logger, this.configManager);
  }

  public flashMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const flashManager = this.flash(req);

      res.locals.flash = flashManager.peek();

      const originalRender = res.render;
      res.render = function (view: string, options?: any): void {
        const renderOptions = { ...(options || {}), flash: flashManager.all() };
        originalRender.call(this, view, renderOptions);
      };

      const originalJson = res.json.bind(res);
      res.json = function (body?: any): Response {
        flashManager.clear();
        return originalJson(body);
      };

      next();
    };
  }

  public getUserProperty<K extends keyof SessionUserAccount>(
    req: Request,
    property: K
  ): SessionUserAccount[K] | undefined {
    const activeUser = this.getActiveUser(req);
    return activeUser?.[property];
  }

  public hasRole(req: Request, role: string): boolean {
    const roles = this.getUserProperty(req, 'roles');
    return roles ? roles.includes(role) : false;
  }

  public isAdmin(req: Request): boolean {
    return this.getUserProperty(req, 'is_admin') === true;
  }
}

export default SessionManager;
