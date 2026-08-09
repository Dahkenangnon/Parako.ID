import type { Express, Request, Response, NextFunction } from 'express';
import session, { SessionOptions, Store } from 'express-session';
import MongoDBStore from 'connect-mongodb-session';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { UAParser } from 'ua-parser-js';
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
import { encryptValue, decryptValue, isEncrypted } from './encryption.js';
import { createConnectRedisClientAdapter } from './connect-redis-client.js';
import {
  DEFAULT_TENANT_ID,
  tenantContext,
} from '../multi-tenancy/tenant-context.js';

/**
 * Fields that contain sensitive data and should be encrypted at rest
 */
const SENSITIVE_SESSION_FIELDS = [
  'authenticatedUsers',
  'csrfToken',
  'authTime',
  'ipAddress',
  'userAgent',
  'deviceId',
  '_metadata',
];

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

/**
 * Encrypted Session Store Wrapper
 * Wraps any session store to provide transparent encryption of sensitive fields
 * Uses the existing encryption utilities from src/utils/encryption.ts
 */
class EncryptedSessionStore extends Store {
  private innerStore: Store;
  private logger: ILogger;

  constructor(innerStore: Store, logger: ILogger) {
    super();
    this.innerStore = innerStore;
    this.logger = logger;
  }

  /**
   * Get session data with decryption
   */
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

  /**
   * Set session data with encryption
   */
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

  /**
   * Destroy session
   */
  destroy(sid: string, callback?: (err?: any) => void): void {
    this.innerStore.destroy(sid, callback);
  }

  /**
   * Touch session (update expiry)
   */
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

  /**
   * Encrypt sensitive fields in session data
   * Uses the existing encryption utilities (AES-256-GCM with ENCRYPTION_KEY env var)
   */
  private encryptSession(
    sessionData: session.SessionData
  ): session.SessionData {
    const encrypted: any = { ...sessionData };

    for (const field of SENSITIVE_SESSION_FIELDS) {
      if (encrypted[field] !== undefined) {
        // Use existing encryption utility - serialize to JSON then encrypt
        const jsonValue = JSON.stringify(encrypted[field]);
        encrypted[`_enc_${field}`] = encryptValue(jsonValue);
        delete encrypted[field];
      }
    }

    encrypted._encrypted = true;
    return encrypted;
  }

  /**
   * Decrypt sensitive fields in session data
   * Uses the existing encryption utilities
   */
  private decryptSession(
    sessionData: session.SessionData
  ): session.SessionData {
    const data: any = sessionData;

    if (!data._encrypted) {
      return sessionData; // Return as-is if not encrypted
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

/**
 * Circuit Breaker States
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit Breaker Session Store Wrapper
 * Provides graceful degradation when the session store is unavailable
 * Returns 503 Service Unavailable when circuit is open
 */
class CircuitBreakerStore extends Store {
  private innerStore: Store;
  private logger: ILogger;

  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailure = 0;
  private successCount = 0;

  private readonly failureThreshold = 5; // Open after 5 consecutive failures
  private readonly resetTimeout = 30000; // 30 seconds before trying again
  private readonly successThreshold = 3; // Consecutive successes to close

  constructor(innerStore: Store, logger: ILogger) {
    super();
    this.innerStore = innerStore;
    this.logger = logger;
  }

  /**
   * Check if circuit allows operation
   */
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

    // half-open state allows execution
    return true;
  }

  /**
   * Record a successful operation
   */
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

  /**
   * Record a failed operation
   */
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

  /**
   * Create circuit breaker error for 503 response
   */
  private createCircuitOpenError(): Error {
    const error = new Error('Session store unavailable - circuit breaker open');
    (error as any).statusCode = 503;
    (error as any).code = 'SERVICE_UNAVAILABLE';
    return error;
  }

  /**
   * Get session data with circuit breaker protection
   */
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

  /**
   * Set session data with circuit breaker protection
   */
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

  /**
   * Destroy session with circuit breaker protection
   */
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

  /**
   * Touch session with circuit breaker protection
   */
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

  /**
   * Get current circuit state (for monitoring/debugging)
   */
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

/**
 * Available session storage backend types
 * - mongodb: MongoDB session store
 * - redis: Redis session store
 * - sqlite: Prisma-backed SQLite session store
 * - postgresql: Prisma-backed PostgreSQL session store
 *
 * Session storage type is automatically determined by the effective OIDC adapter
 */
export type SessionStoreType = 'mongodb' | 'redis' | 'sqlite' | 'postgresql';

/**
 * Flash message types
 */
export type FlashType = 'success' | 'error' | 'info' | 'warning';

/**
 * Flash message object structure
 */
export interface FlashMessage {
  type: FlashType;
  message: string;
  title?: string;
  dismissible?: boolean;
  timeout?: number;
}

/**
 * Flash message options
 */
export interface FlashOptions {
  dismissible?: boolean;
  timeout?: number;
}

/**
 * Flash message container in session
 */
export interface FlashContainer {
  success: FlashMessage[];
  error: FlashMessage[];
  info: FlashMessage[];
  warning: FlashMessage[];
  [key: string]: FlashMessage[];
}

/**
 * User account data in session
 * Contains basic user information required for UI and authentication
 */
export interface SessionUserAccount {
  /** User's unique MongoDB identifier */
  id: string;
  /** User's username (used as accountId in OIDC) */
  username: string;
  /** User's email address */
  email?: string;
  /** Whether the user's email is verified */
  email_verified?: boolean;
  /** User's phone number */
  phone_number?: string;
  /** Whether the user's phone number is verified */
  phone_number_verified?: boolean;
  /** User's first/given name */
  given_name?: string;
  /** User's last/family name */
  family_name?: string;
  /** Full name (computed from given_name and family_name) */
  full_name?: string;
  /** URL to user's profile picture */
  picture?: string;
  /** User roles for authorization */
  roles?: string[];
  /** Whether the user has admin privileges */
  is_admin?: boolean;
  /** Last time this account was used */
  last_used?: number;
  /** User's timezone (IANA format, e.g., 'Africa/Lagos', 'Europe/Paris') */
  zoneinfo?: string;
  /** User's locale preference (e.g., 'en', 'fr') */
  locale?: string;
}

/**
 * Authenticated users container in session
 * Supports multiple accounts with one active account
 */
export interface AuthenticatedUsers {
  /** Currently active user account */
  active: SessionUserAccount;
  /** Other user accounts available for selection */
  others: SessionUserAccount[];
}

/**
 * Session metadata for debugging and auditing
 * Stored when store_metadata config is enabled
 */
export interface SessionMetadata {
  /** When the session was created */
  created_at: Date;
  /** How the session was created */
  createdFrom: 'login' | 'social' | 'api' | 'session-switch' | 'unknown';
  /** IP address when session was created */
  createdIp?: string;
  /** User agent when session was created */
  userAgent?: string;
  /** Browser information */
  browser?: { name?: string; version?: string };
  /** Operating system information */
  os?: { name?: string; version?: string };
  /** Device information */
  device?: { type?: string; vendor?: string; model?: string };
}

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

/**
 * Session data interface - extend this to add custom session data
 * Contains commonly used session properties for authentication and user tracking
 */
export interface SessionData {
  /**
   * Container for authenticated user accounts
   * This is the primary source for user identity information
   */
  authenticatedUsers?: AuthenticatedUsers;
  /** Whether the user is currently authenticated */
  isAuthenticated?: boolean;
  /**
   * Active user's account ID (username) - stored unencrypted for session querying
   * Used to enforce concurrent session limits by querying sessions by user
   */
  accountId?: string;
  /** Timestamp when authentication occurred */
  authTime?: number;
  /** Timestamp of last user activity */
  lastActivity?: number;
  /** Timestamp when the session was created */
  created?: number;
  /** User's IP address */
  ipAddress?: string;
  /** User's browser/client information */
  userAgent?: string;
  /** Unique device identifier */
  deviceId?: string;
  /** CSRF protection token */
  csrfToken?: string;
  /** Flash messages container */
  flash?: FlashContainer;
  /** Session metadata for debugging (when store_metadata enabled) */
  _metadata?: SessionMetadata;
  /** Allow any additional custom properties */
  [key: string]: any;
}
/**
 * Flash Manager - provides a chainable API for flash messages
 */
@injectable()
export class FlashManager implements IFlashManager {
  /**
   * @param request - Express request object
   * @param sessionManager - Session manager instance
   */
  constructor(
    @unmanaged() private request: Request,
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ConfigManager) private configManager: IConfigManager
  ) {
    this.initialize();
  }

  /**
   * Initialize flash container if it doesn't exist
   */
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

  /**
   * Add a flash message of any type
   *
   * @param type - Message type
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  public add(
    type: FlashType,
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    this.addMessage(type, message, title, options);
    return this;
  }

  /**
   * Add a success flash message
   */
  public success(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('success', message, title, options);
  }

  /**
   * Add an error flash message
   */
  public error(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('error', message, title, options);
  }

  /**
   * Add an info flash message
   */
  public info(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('info', message, title, options);
  }

  /**
   * Add a warning flash message
   */
  public warning(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager {
    return this.add('warning', message, title, options);
  }

  /**
   * Add a flash message of specific type
   *
   * @param type - Message type
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @private
   */
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

    // If at total limit, remove oldest message from type with most messages
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

  /**
   * Get all flash messages and clear them
   *
   * @returns Object containing all flash messages
   */
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

  /**
   * Get flash messages without clearing them
   *
   * @returns Object containing all flash messages
   */
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

  /**
   * Clear all flash messages
   *
   * @returns FlashManager instance for chaining
   */
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

/**
 * Configuration options for the SessionManager
 * Session storage type and connection details are automatically determined by OIDC adapter configuration
 */
export interface SessionManagerOptions {
  /** Secret key used to sign the session cookie (min 32 chars in production) */
  secret?: string;
  /** Name of the session cookie */
  name?: string;
  /** Type of session store to use (automatically determined by OIDC adapter configuration) */
  storeType?: SessionStoreType;
  /** Session time-to-live in seconds */
  ttl?: number;
  /** Cookie configuration options */
  cookie?: {
    /** Whether the cookie should only be sent over HTTPS */
    secure?: boolean;
    /** Prevents client-side JavaScript from accessing the cookie */
    httpOnly?: boolean;
    /** Cookie expiration time in milliseconds */
    maxAge?: number;
    /** Cookie domain */
    domain?: string;
    /** Controls when cookies are sent with cross-site requests */
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    /** Cookie path */
    path?: string;
  };
  /** Reset expiration on activity */
  rolling?: boolean;
  /** Save session even if unmodified */
  resave?: boolean;
  /** Save new but unmodified sessions */
  saveUninitialized?: boolean;
  /** Trust proxy headers */
  proxy?: boolean;
  /** MongoDB collection name for sessions (only used when OIDC adapter is MongoDB) */
  collection?: string;
  /** Custom session ID generator function */
  sessionIdGenerator?: () => string;
}

/**
 * SessionManager - Centralized system for managing Express sessions
 *
 * Features:
 * - Multiple storage backends (Memory, MongoDB, Redis)
 * - Session manipulation methods (get, set, clear, etc.)
 * - Type-safe access to session data
 * - Authentication helpers
 * - CSRF protection
 * - Activity tracking
 * - Flash messages
 *
 * Uses the Singleton pattern to ensure only one instance exists.
 */
@injectable()
export class SessionManager implements ISessionManager {
  /** Configuration options */
  private options: SessionManagerOptions;
  /** Session store instance */
  private store: Store | undefined;
  /** Express session middleware */
  private sessionMiddleware: any;
  /** Flag indicating if the manager has been initialized */
  private initialized: boolean = false;
  /** Injected dependencies */
  private configManager: IConfigManager;
  private viewResolver: IViewResolver;
  private logger: ILogger;
  private userService: IUserService;
  private oidcAdapterBridge: IOIDCAdapterBridge | null = null;
  private prismaClient: PrismaClient | null = null;
  private redisClient: Redis | null = null;
  private sessionPrefix: string = '';

  /**
   * Constructor with dependency injection
   *
   * @param configManager - Configuration manager instance
   * @param viewResolver - View resolver instance
   * @param options - Session manager configuration options
   * @throws Error if session secret is insufficient in production
   */
  /** Initial session settings for change detection */
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

  /**
   * Handle configuration changes
   * Detects critical changes that require restart and logs appropriate warnings
   */
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

  /**
   * Merge provided options with default configuration
   * Session storage type is automatically determined by OIDC adapter configuration
   *
   * @param options - User-provided options
   * @returns Complete options with defaults applied
   */
  private mergeWithDefaultOptions(
    options: SessionManagerOptions
  ): SessionManagerOptions {
    const sessionCookieConfig =
      this.configManager.getConfig().deployment.cookies.types.session;
    const defaultCookieConfig =
      this.configManager.getConfig().deployment.cookies.defaults;

    // Security session settings can override deployment cookie settings
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

    // Use OIDC session TTL for Express session (default 14 days = 1209600 seconds)
    // This aligns Express session lifetime with OIDC session lifetime
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
   * Initialize the session manager and attach middleware to Express app
   *
   * @param app - Express application instance
   * @throws Error if initialization fails
   */
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
      this.logger.info(
        `Session middleware configured with ${this.options.storeType} store`
      );

      // Warn if using insecure cookies in development
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

  /**
   * Set the OIDC adapter bridge for concurrent session management
   * This should be called after the OIDC adapter is initialized
   *
   * @param bridge - OIDC adapter bridge instance
   */
  public setOidcAdapterBridge(bridge: IOIDCAdapterBridge): void {
    this.oidcAdapterBridge = bridge;
    this.logger.debug('OIDC adapter bridge set for session management');
  }

  /**
   * Enforce concurrent session limits for a user in the active tenant.
   * Removes oldest Express sessions if the user exceeds the configured limit
   *
   * Note: This is called BEFORE the new session is fully established,
   * so we remove oldest sessions to make room for the new one.
   *
   * @param userId - User ID (username/accountId) to enforce limits for
   * @returns Number of sessions removed
   */
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

      return 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to enforce session limit',
        userId,
      });
      return 0;
    }
  }

  private async enforceSessionLimitMongo(
    userId: string,
    maxConcurrentSessions: number,
    currentSessionId?: string
  ): Promise<number> {
    const db = mongoose.connection.db;
    if (!db) {
      this.logger.warn(
        'Cannot enforce session limit: MongoDB connection not available'
      );
      return 0;
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
      this.logger.warn(
        'Cannot enforce session limit: Redis client not available'
      );
      return 0;
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
        const data = JSON.parse(raw);
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

    // Pipeline delete all at once
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
      this.logger.warn(
        'Cannot enforce session limit: Prisma client not available'
      );
      return 0;
    }

    const tenantId = tenantContext.getTenantId();
    const rows = await (this.prismaClient as any).session.findMany();
    const validSessions: { sid: string; authTime: number }[] = [];

    for (const row of rows) {
      if (row.sid === currentSessionId) continue;
      try {
        const data = JSON.parse(row.data);
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

  /**
   * Revoke all Express sessions for a specific user in the active tenant.
   * Used when admin disables an account to immediately log out the user
   *
   * @param userId - Username or user ID to revoke sessions for
   * @returns Number of sessions revoked
   */
  public async revokeAllSessionsForUser(userId: string): Promise<number> {
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return 0;
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          this.logger.warn(
            'Cannot revoke Express sessions: MongoDB not connected'
          );
          return 0;
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
          this.logger.warn(
            'Cannot revoke Express sessions: Redis client not available'
          );
          return 0;
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
            const data = JSON.parse(raw);
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

        // Pipeline delete all session keys
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
          this.logger.warn(
            'Cannot revoke Express sessions: Prisma client not available'
          );
          return 0;
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const sidsToDelete: string[] = [];

        for (const row of rows) {
          try {
            const data = JSON.parse(row.data);
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

      return 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to revoke Express sessions for user',
        userId,
      });
      return 0;
    }
  }

  /**
   * Find all Express sessions for a specific user in the active tenant.
   * Supports MongoDB, Redis, and Prisma (SQLite/PostgreSQL).
   */
  public async findExpressSessionsForUser(accountId: string): Promise<any[]> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      return [];
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          this.logger.warn(
            'Cannot find Express sessions: MongoDB connection not available'
          );
          return [];
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
          this.logger.warn(
            'Cannot find Express sessions: Redis client not available'
          );
          return [];
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
            const data = JSON.parse(raw);
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
          this.logger.warn(
            'Cannot find Express sessions: Prisma client not available'
          );
          return [];
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const results: any[] = [];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.data);
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

      return [];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to find Express sessions for user',
        accountId,
      });
      return [];
    }
  }

  /**
   * Revoke a single Express session by its session ID in the active tenant.
   * Supports MongoDB, Redis, and Prisma (SQLite/PostgreSQL).
   */
  public async revokeExpressSession(sessionId: string): Promise<boolean> {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return false;
    }

    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          this.logger.warn(
            'Cannot revoke Express session: MongoDB connection not available'
          );
          return false;
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
          this.logger.warn(
            'Cannot revoke Express session: Redis client not available'
          );
          return false;
        }

        const sessionKey = `${this.sessionPrefix}${sessionId}`;
        const raw = await this.redisClient.get(sessionKey);
        if (!raw) {
          return false;
        }

        const tenantId = tenantContext.getTenantId();
        let accountId: string | undefined;
        try {
          const data = JSON.parse(raw);
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
          this.logger.warn(
            'Cannot revoke Express session: Prisma client not available'
          );
          return false;
        }

        const row = await (this.prismaClient as any).session.findUnique({
          where: { sid: sessionId },
        });
        if (!row) {
          return false;
        }

        try {
          const data = JSON.parse(row.data);
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

      return false;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to revoke Express session',
        sessionId,
      });
      return false;
    }
  }

  /**
   * Find authenticated Express sessions across all users in the active tenant.
   * Supports MongoDB, Redis, and Prisma (SQLite/PostgreSQL).
   */
  public async findAllExpressSessions(
    options: { limit?: number; offset?: number; search?: string } = {}
  ): Promise<any[]> {
    const { limit = 20, offset = 0, search } = options;
    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          this.logger.warn(
            'Cannot find Express sessions: MongoDB connection not available'
          );
          return [];
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        const query: any = {
          'session.isAuthenticated': true,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        };
        if (search) {
          query['session.accountId'] = { $regex: search, $options: 'i' };
        }

        return await sessionCollection
          .find(query)
          .sort({ 'session.authTime': -1 })
          .skip(offset)
          .limit(limit)
          .toArray();
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          this.logger.warn(
            'Cannot find Express sessions: Redis client not available'
          );
          return [];
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
              const data = JSON.parse(raw);
              if (!sessionBelongsToTenant(data, tenantId)) continue;
              if (data.isAuthenticated !== true) continue;
              if (
                search &&
                !(data.accountId || '')
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
          this.logger.warn(
            'Cannot find Express sessions: Prisma client not available'
          );
          return [];
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        const results: any[] = [];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.data);
            if (!sessionBelongsToTenant(data, tenantId)) continue;
            if (data.isAuthenticated !== true) continue;
            if (
              search &&
              !(data.accountId || '')
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

      return [];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to find all Express sessions',
      });
      return [];
    }
  }

  /**
   * Count authenticated Express sessions across all users in the active tenant.
   * Supports MongoDB, Redis, and Prisma (SQLite/PostgreSQL).
   */
  public async countAllExpressSessions(): Promise<number> {
    const storeType = this.resolveStoreType();

    try {
      if (storeType === 'mongodb') {
        const db = mongoose.connection.db;
        if (!db) {
          this.logger.warn(
            'Cannot count Express sessions: MongoDB connection not available'
          );
          return 0;
        }

        const collectionName = this.options.collection || 'application_session';
        const sessionCollection = db.collection(collectionName);

        return await sessionCollection.countDocuments({
          'session.isAuthenticated': true,
          ...mongoSessionTenantFilter(tenantContext.getTenantId()),
        });
      } else if (storeType === 'redis') {
        if (!this.redisClient) {
          this.logger.warn(
            'Cannot count Express sessions: Redis client not available'
          );
          return 0;
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
              const data = JSON.parse(raw);
              if (
                sessionBelongsToTenant(data, tenantId) &&
                data.isAuthenticated === true
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
          this.logger.warn(
            'Cannot count Express sessions: Prisma client not available'
          );
          return 0;
        }

        const tenantId = tenantContext.getTenantId();
        const rows = await (this.prismaClient as any).session.findMany();
        let count = 0;
        for (const row of rows) {
          try {
            const data = JSON.parse(row.data);
            if (
              sessionBelongsToTenant(data, tenantId) &&
              data.isAuthenticated === true
            ) {
              count++;
            }
          } catch {
            // best-effort: corrupt JSON contributes 0 to the count.
          }
        }

        return count;
      }

      return 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to count all Express sessions',
      });
      return 0;
    }
  }

  /**
   * Set up the appropriate session store based on OIDC adapter configuration.
   * Uses the bridge's effectiveOidcAdapter() when available so all three components
   * (OIDC adapter, session store, OIDCAdapterBridge) resolve the same type.
   */
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

      // Apply circuit breaker wrapper for graceful degradation
      this.applyCircuitBreakerWrapper();
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Failed to initialize session store: ${this.options.storeType}`,
      });
      throw error;
    }
  }

  /**
   * Apply circuit breaker wrapper to the session store
   * Provides graceful degradation when the store is unavailable
   */
  private applyCircuitBreakerWrapper(): void {
    if (this.store) {
      this.store = new CircuitBreakerStore(this.store, this.logger);
      this.logger.info('Session store circuit breaker enabled');
    }
  }

  /**
   * Apply encryption wrapper to the session store if enabled in config
   * Uses the existing encryption utilities which rely on ENCRYPTION_KEY env var
   */
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

  /**
   * Configure MongoDB session store using OIDC adapter configuration
   *
   * @throws Error if MongoDB URI is missing
   */
  private setupMongoDBStore(): void {
    const config = this.configManager.getConfig();
    const oidcAdapterConfig = config.oidc_storage.oidc_adapter;

    if (!oidcAdapterConfig.mongodb?.uri) {
      throw new Error('MongoDB URI is required for MongoDB session store');
    }

    // Derive touchAfter from idle_timeout_minutes to ensure session updates are
    // persisted before idle timeout kicks in. Default: 30 minutes = 1800 seconds
    const idleTimeoutMinutes =
      config.security?.authentication?.session?.idle_timeout_minutes || 30;
    const touchAfterSeconds = idleTimeoutMinutes * 60;

    const MongoStore = MongoDBStore(session);
    this.store = new MongoStore({
      uri: oidcAdapterConfig.mongodb.uri,
      collection: this.options.collection || 'sessions',
      expires: this.options.ttl,
      connectionOptions: {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
      },
      touchAfter: touchAfterSeconds,
    } as any);

    this.handleStoreErrors(this.store);
    this.logger.info(
      `MongoDB session store configured with collection: ${this.options.collection || 'sessions'}`
    );
  }

  /**
   * Configure Redis session store using OIDC adapter configuration
   */
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

    // Derive session prefix from the unified base prefix.
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

  /**
   * Configure Prisma session store (SQLite or PostgreSQL)
   */
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

  /**
   * Resolve the effective session store type.
   * Uses the OIDC adapter bridge when available, falls back to config.
   */
  private resolveStoreType(): SessionStoreType {
    if (this.oidcAdapterBridge) {
      return this.oidcAdapterBridge.effectiveOidcAdapter();
    }
    const config = this.configManager.getConfig();
    return (
      (config.oidc_storage?.oidc_adapter?.type as SessionStoreType) || 'mongodb'
    );
  }

  /**
   * Build the Redis key for a user's session index set.
   */
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
          const data = JSON.parse(raw);
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

  /**
   * Add a session ID to a user's Redis session index set (fire-and-forget).
   */
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

  /**
   * Remove a session ID from a user's Redis session index set (fire-and-forget).
   */
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

  /**
   * Atomically move a session from one user's index to another's.
   * Used when the active accountId changes on a session (e.g. switchUser).
   */
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
   * Configure the Express session middleware
   */
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
      genid: this.options.sessionIdGenerator,
    };

    this.sessionMiddleware = session(sessionOptions);
  }

  /**
   * Set up error handlers for session store
   *
   * @param store - Session store instance
   */
  private handleStoreErrors(store: any): void {
    if (store && typeof store.on === 'function') {
      store.on('error', (error: Error) => {
        this.logger.error('Session store error', { error: error.message });

        if (
          this.configManager.getConfig().deployment.environment === 'production'
        ) {
          // In a production environment, we might want to try to reconnect
          // or trigger an alert to the operations team
          if (
            this.options.storeType === 'mongodb' &&
            error.message?.includes('disconnected')
          ) {
            this.logger.warn(
              'MongoDB session store disconnected. Attempting to reconnect...'
            );
            // The connection will be automatically retried by MongoDB driver
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

  /**
   * Get the session middleware for manual integration
   *
   * @returns Express middleware function
   * @throws Error if called before initialization
   */
  public getMiddleware(): any {
    if (!this.sessionMiddleware) {
      throw new Error(
        'Session middleware not initialized. Call initialize() first.'
      );
    }
    return this.sessionMiddleware;
  }

  /**
   * Create middleware to track session activity
   * Updates lastActivity timestamp on each request
   *
   * @returns Express middleware function
   */
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

  /**
   * Extract device ID (FingerprintJS visitorId) from request body
   * Device info is sent in a static field named _deviceInfo
   *
   * @param req - Express request object
   * @returns The visitorId string or null if not found/invalid
   */
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

  /**
   * Validate session binding (IP address and User-Agent)
   * Detects potential session hijacking attempts
   *
   * @param req - Express request object
   * @returns Object with validation result and reason for failure
   */
  public validateSessionBinding(req: Request): {
    valid: boolean;
    reason?: string;
  } {
    if (!req.session || !this.get(req, 'isAuthenticated')) {
      return { valid: true }; // Skip validation for unauthenticated sessions
    }

    const config = this.configManager.getConfig();
    const sessionSecurity = config.security?.authentication?.session || {};

    // IP binding validation (optional, configurable)
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

    // User-Agent binding validation (optional, configurable)
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

    // Device ID binding validation (optional, configurable)
    // Validates FingerprintJS visitorId from client against stored value
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

  /**
   * Create middleware to validate session binding (IP/User-Agent)
   * Destroys sessions that fail validation to prevent hijacking
   *
   * @returns Express middleware function
   */
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

  /**
   * Create middleware to enforce server-side idle timeout
   * Destroys sessions that have been idle beyond the configured limit
   *
   * @returns Express middleware function
   */
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

      // Skip if idle timeout is not configured
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

  /**
   * Create middleware to enforce absolute session timeout
   * Destroys sessions that have exceeded their maximum lifetime
   *
   * @returns Express middleware function
   */
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

      // Skip if absolute timeout is not configured
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

  /**
   * Set a value in the session
   *
   * @param req - Express request object
   * @param key - Session property key
   * @param value - Value to store
   * @throws Error if session is unavailable
   */
  public set(req: Request, key: string, value: any): void {
    if (!req.session) {
      throw new Error('Session not available');
    }

    req.session[key] = value;
  }

  /**
   * Get a value from the session
   *
   * @param req - Express request object
   * @param key - Session property key
   * @param defaultValue - A default value to return if not found
   * @returns The stored value or undefined if not found
   */
  public get<T = any>(
    req: Request,
    key: string,
    defaultValue?: any
  ): T | undefined {
    if (!req.session) {
      return undefined;
    }

    return req.session[key] !== undefined
      ? (req.session[key] as T)
      : defaultValue;
  }

  /**
   * Get all session data
   *
   * @param req - Express request object
   * @returns Object containing all session data
   */
  public getAll(req: Request): SessionData {
    if (!req.session) {
      return {};
    }

    const sessionData: SessionData = {};

    Object.keys(req.session).forEach(key => {
      if (key !== 'cookie' && key !== 'id') {
        sessionData[key] = req.session[key as keyof typeof req.session];
      }
    });

    return sessionData;
  }

  /**
   * Remove a value from the session
   *
   * @param req - Express request object
   * @param key - Session property key
   */
  public remove(req: Request, key: string): void {
    if (!req.session) {
      return;
    }

    delete req.session[key];
  }

  /**
   * Clear all session data except for keys specified in preserveKeys
   *
   * @param req - Express request object
   * @param preserveKeys - Array of keys to preserve
   */
  public clear(req: Request, preserveKeys: string[] = []): void {
    if (!req.session) {
      return;
    }

    const currentSession = req.session;

    const preserved: Record<string, any> = {};
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

    Object.keys(preserved).forEach(key => {
      currentSession[key] = preserved[key];
    });
  }

  /**
   * Regenerate the session ID while preserving session data
   * Used for security to prevent session fixation attacks
   *
   * @param req - Express request object
   * @returns Promise resolving when regeneration completes
   * @throws Error if session is unavailable or regeneration fails
   */
  public regenerate(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        return reject(new Error('Session not available'));
      }

      const sessionData = this.getAll(req);
      // Capture old session ID and accountId before regeneration
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

        Object.keys(sessionData).forEach(key => {
          regeneratedSession[key] = sessionData[key];
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

  /**
   * Destroy the current session
   *
   * @param req - Express request object
   * @returns Promise resolving when session is destroyed
   */
  public destroy(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        return resolve();
      }

      // Capture before destroy callback clears the session
      const accountId = this.get<string>(req, 'accountId');
      const sessionId = req.session.id;

      req.session.destroy(err => {
        if (err) {
          return reject(err);
        }

        if (this.redisClient && accountId && sessionId) {
          this.redisIndexRemove(accountId, sessionId);
        }

        // Clear the session reference to prevent any further access
        req.session = null as any;
        resolve();
      });
    });
  }

  /**
   * Clear all authentication-related data from session
   * This should be called before destroy() to ensure clean logout
   *
   * @param req - Express request object
   */
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

  /**
   * Check if session exists
   *
   * @param req - Express request object
   * @returns true if session exists, false otherwise
   */
  public exists(req: Request): boolean {
    return !!req.session;
  }

  /**
   * Check if user is authenticated in current session and their account is enabled
   *
   * @param req - Express request object
   * @returns Promise<boolean> - true if authenticated and account is enabled
   */
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

  /**
   * Set session as authenticated with user data
   *
   * @param req - Express request object
   * @param userData - Additional user data to store in session
   */
  public setAuthenticated(
    req: Request,
    userData: Partial<SessionData> = {}
  ): void {
    let userAccount: SessionUserAccount | undefined;
    if (userData.currentActiveLoggedUser) {
      // Support for the structure passed from OIDC routes
      userAccount = {
        id: userData.currentActiveLoggedUser.id,
        username: userData.currentActiveLoggedUser.username,
        email: userData.currentActiveLoggedUser.email,
        email_verified: userData.currentActiveLoggedUser.email_verified,
        given_name: userData.currentActiveLoggedUser.given_name,
        family_name: userData.currentActiveLoggedUser.family_name,
        full_name: userData.currentActiveLoggedUser.full_name,
        picture: userData.currentActiveLoggedUser.picture,
        roles: userData.currentActiveLoggedUser.roles,
        is_admin: userData.currentActiveLoggedUser.is_admin,
        last_used: Date.now(),
        zoneinfo: userData.currentActiveLoggedUser.zoneinfo,
        locale: userData.currentActiveLoggedUser.locale,
      };
    }

    if (userAccount) {
      const existingAuthUsers = this.get<AuthenticatedUsers>(
        req,
        'authenticatedUsers'
      );

      if (existingAuthUsers) {
        const multiAccountEnabled =
          this.configManager.getConfig().security?.authentication
            ?.session_management?.multiple_accounts?.enabled;

        if (multiAccountEnabled === false) {
          // Multi-account disabled: replace the active account, don't accumulate others
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
        // First login - no existing accounts
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
      const parser = new UAParser(userAgentString);
      const uaResult = parser.getResult();

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

    const sessionData: Partial<SessionData> = {
      ...userData,
      isAuthenticated: true,
      authTime: Date.now(),
      lastActivity: Date.now(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: deviceId || undefined,
      accountId: userAccount?.username ?? userData.accountId,
      _metadata: metadata,
    };

    Object.keys(sessionData).forEach(key => {
      if (key !== 'currentActiveLoggedUser' && key !== 'authenticatedUsers') {
        this.set(req, key, sessionData[key as keyof typeof sessionData]);
      }
    });

    if (this.redisClient && userAccount?.username) {
      this.redisIndexAdd(userAccount.username, req.session.id);
    }
  }

  /**
   * Get the currently active user account
   *
   * @param req - Express request object
   * @returns The active user account or undefined if not authenticated
   */
  public getActiveUser(req: Request): SessionUserAccount | undefined {
    const authUsers = this.get<AuthenticatedUsers>(req, 'authenticatedUsers');
    return authUsers?.active;
  }

  /**
   * Update specific fields of the active user account in session
   *
   * @param req - Express request object
   * @param updates - Partial user data to update
   * @returns true if update was successful, false otherwise
   */
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

  /**
   * Get all authenticated user accounts
   *
   * @param req - Express request object
   * @returns Object containing active and other user accounts
   */
  public getAuthenticatedUsers(req: Request): AuthenticatedUsers | undefined {
    return this.get<AuthenticatedUsers>(req, 'authenticatedUsers');
  }

  /**
   * Switch to a different authenticated user
   *
   * @param req - Express request object
   * @param userId - ID of the user to switch to
   * @returns Result object with success flag and optional reason for failure
   */
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
      // Re-authentication is required - caller must handle this
      this.set(req, 'pendingSwitchUserId', userId);
      this.logger.debug('Account switch requires re-authentication', {
        targetUserId: userId,
        currentUser: authUsers.active?.username,
      });
      return { success: false, reason: 'reauth_required' };
    }

    // Capture old accountId for Redis index update
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

  /**
   * Add another authenticated user to the session
   *
   * @param req - Express request object
   * @param userAccount - User account to add
   * @param setAsActive - Whether to set this user as the active user
   * @returns Result object with success flag and optional reason for failure
   */
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
      // First user - create the container
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
      // Capture old accountId for Redis index update
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

  /**
   * Remove an authenticated user from the session
   * Also revokes OIDC grants for the removed account
   *
   * @param req - Express request object
   * @param userId - ID of the user to remove
   * @returns true if the user was removed, false if not found
   */
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
      // Can't remove active user if it's the only one
      if (authUsers.others.length === 0) {
        return false;
      }

      removedUser = authUsers.active;

      // Make the most recently used other account active
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

  /**
   * Get session's remaining time-to-live in seconds
   *
   * @param req - Express request object
   * @returns Remaining TTL in seconds, or 0 if expired/unavailable
   */
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

  /**
   * Generate a secure CSRF token and store it in the session
   *
   * @param req - Express request object
   * @returns Generated CSRF token
   */
  public generateCsrfToken(req: Request): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.set(req, 'csrfToken', token);
    return token;
  }

  /**
   * Validate a CSRF token against the one stored in session
   *
   * @param req - Express request object
   * @param token - CSRF token to validate
   * @returns true if token is valid, false otherwise
   */
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

  /**
   * Rotate CSRF token after sensitive operations
   * Should be called after: password change, account deletion, session management, MFA changes
   *
   * @param req - Express request object
   * @returns New CSRF token
   */
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

  /**
   * Middleware for CSRF protection
   * Validates CSRF token on non-GET requests
   *
   * @returns Express middleware function
   */
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

  /**
   * Get a FlashManager instance for the request
   *
   * @param req - Express request object
   * @returns FlashManager instance for chaining flash operations
   */
  public flash(req: Request): IFlashManager {
    return new FlashManager(req, this, this.logger, this.configManager);
  }

  /**
   * Middleware to expose flash messages to views
   *
   * @returns Express middleware function
   */
  public flashMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const flashManager = this.flash(req);

      // Make flash messages available to templates
      res.locals.flash = flashManager.peek();

      const originalRender = res.render;
      res.render = function (view: string, options?: any): void {
        const renderOptions = { ...(options || {}), flash: flashManager.all() };
        originalRender.call(this, view, renderOptions);
      };

      // This prevents stale flash messages from persisting after API calls
      const originalJson = res.json.bind(res);
      res.json = function (body?: any): Response {
        // Clear flash messages since they won't be displayed in API response
        flashManager.clear();
        return originalJson(body);
      };

      next();
    };
  }

  /**
   * Get a specific property from the active user
   *
   * @param req - Express request object
   * @param property - Property name to retrieve
   * @returns Property value or undefined if not authenticated or property doesn't exist
   */
  public getUserProperty<K extends keyof SessionUserAccount>(
    req: Request,
    property: K
  ): SessionUserAccount[K] | undefined {
    const activeUser = this.getActiveUser(req);
    return activeUser?.[property];
  }

  /**
   * Check if the active user has a specific role
   *
   * @param req - Express request object
   * @param role - Role to check
   * @returns True if user has the role, false otherwise
   */
  public hasRole(req: Request, role: string): boolean {
    const roles = this.getUserProperty(req, 'roles');
    return roles ? roles.includes(role) : false;
  }

  /**
   * Check if the active user is an admin
   *
   * @param req - Express request object
   * @returns True if user is admin, false otherwise
   */
  public isAdmin(req: Request): boolean {
    return this.getUserProperty(req, 'is_admin') === true;
  }
}

export default SessionManager;
