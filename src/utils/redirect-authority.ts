import type { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { IRedirectAuthority } from '../di/interfaces/redirect-authority.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IOIDCClientMerger } from '../di/interfaces/oidc-client-merger.interface.js';
import { TYPES } from '../di/types.js';
import { URL } from 'node:url';

/**
 * Interface for redirect intent stored in session
 */
export interface RedirectIntent {
  url: string;
  intent: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration options for redirect validation
 */
export interface RedirectValidationOptions {
  allowLocal?: boolean;
  requireHttps?: boolean;
  maxLength?: number;
  customValidator?: (url: string) => boolean;
}

/**
 * Result of redirect validation
 */
export interface RedirectValidationResult {
  isValid: boolean;
  url: string | null;
  reason?: string;
}

/**
 * Fluent redirect builder for secure redirects
 */
export class RedirectBuilder {
  private response: Response;
  private redirectAuthority: RedirectAuthority;
  private validationOptions: RedirectValidationOptions;

  constructor(
    response: Response,
    redirectAuthority: RedirectAuthority,
    validationOptions: RedirectValidationOptions = {}
  ) {
    this.response = response;
    this.redirectAuthority = redirectAuthority;
    this.validationOptions = validationOptions;
  }

  /**
   * Redirect to the specified URL (will be validated)
   * @param url - URL to redirect to
   * @returns RedirectBuilder for method chaining
   */
  to(url: string | undefined): RedirectBuilder {
    if (!url) {
      return this;
    }

    const validation = this.redirectAuthority.validateUrl(
      url,
      this.validationOptions
    );

    if (validation.isValid && validation.url) {
      this.response.redirect(validation.url);
    }

    return this;
  }

  /**
   * Fallback URL if the previous URL validation failed
   * @param fallbackUrl - Fallback URL to redirect to
   * @returns RedirectBuilder for method chaining
   */
  or(fallbackUrl: string): RedirectBuilder {
    if (!this.response.headersSent) {
      this.response.redirect(fallbackUrl);
    }

    return this;
  }

  /**
   * Set custom validation options
   * @param options - Validation options
   * @returns RedirectBuilder for method chaining
   */
  withOptions(options: RedirectValidationOptions): RedirectBuilder {
    this.validationOptions = { ...this.validationOptions, ...options };
    return this;
  }
}

/**
 * RedirectAuthority class handles secure URL validation and intent management
 *
 * This utility provides enterprise-grade redirect security by:
 * - Validating URLs against trusted domains
 * - Managing redirect intents in secure session storage
 * - Preventing open redirect vulnerabilities
 * - Supporting wildcard domain patterns
 */
@injectable()
export default class RedirectAuthority implements IRedirectAuthority {
  /**
   * Default intent expiration time (1 hour in milliseconds)
   */
  private static readonly DEFAULT_INTENT_EXPIRATION = 3600000; // 1 hour

  /**
   * Maximum URL length allowed
   */
  private static readonly MAX_URL_LENGTH = 2048;

  /**
   * Injected dependencies
   */
  private configManager: IConfigManager;
  private sessionManager: ISessionManager;
  private logger: ILogger;

  /**
   * Cache for OIDC client redirect URI domains
   * Cleared every 5 minutes to allow for new clients
   */
  private oidcClientDomainsCache: Set<string> | null = null;
  private oidcClientDomainsCacheTime: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Constructor with dependency injection
   * @param configManager - Configuration manager instance
   * @param sessionManager - Session manager instance
   * @param logger - Logger instance
   * @param oidcAdapter - OIDC adapter bridge instance (optional)
   * @param oidcClientMerger - OIDC client merger instance (optional)
   */
  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.SessionManager) sessionManager: ISessionManager,
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter?: IOIDCAdapterBridge,
    @inject(TYPES.OIDCClientMerger)
    private readonly oidcClientMerger?: IOIDCClientMerger
  ) {
    this.configManager = configManager;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }

  /**
   * Fetches all domains from OIDC client redirect URIs
   * Uses caching to avoid database queries on every validation
   *
   * @returns Set of trusted domains from OIDC clients
   */
  private async getOidcClientDomains(): Promise<Set<string>> {
    const now = Date.now();

    if (
      this.oidcClientDomainsCache &&
      now - this.oidcClientDomainsCacheTime < this.CACHE_TTL
    ) {
      return this.oidcClientDomainsCache;
    }

    const domains = new Set<string>();

    try {
      if (this.oidcAdapter) {
        const clients = await this.oidcAdapter.client.findAllClients({
          active: true,
        });

        for (const client of clients) {
          const redirectUris = client.redirect_uris || [];
          for (const uri of redirectUris) {
            try {
              const parsedUri = new URL(uri);
              const hostname = parsedUri.hostname.toLowerCase();
              domains.add(hostname);

              this.logger.debug('OIDC client redirect URI domain extracted', {
                client_id: client.client_id,
                uri,
                hostname,
              });
            } catch (error) {
              this.logger.warn('Invalid redirect URI in OIDC client', {
                client_id: client.client_id,
                uri,
                error: (error as Error).message,
              });
            }
          }
        }
      }

      // Also fetch from static/dynamic clients via merger
      if (this.oidcClientMerger) {
        try {
          const staticClients = this.oidcClientMerger.loadClients();
          for (const client of staticClients) {
            const redirectUris = client.redirect_uris || [];
            for (const uri of redirectUris) {
              try {
                const parsedUri = new URL(uri);
                const hostname = parsedUri.hostname.toLowerCase();
                domains.add(hostname);
              } catch {
                // best-effort: skip non-URL redirect_uri entries (e.g.
                // native scheme handlers) when collecting authority hosts.
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to load static OIDC clients', {
            error: (error as Error).message,
          });
        }
      }

      this.logger.info('OIDC client domains loaded and cached', {
        domainsCount: domains.size,
        domains: Array.from(domains),
        ttl: this.CACHE_TTL / 1000,
      });

      this.oidcClientDomainsCache = domains;
      this.oidcClientDomainsCacheTime = now;

      return domains;
    } catch (error) {
      this.logger.error(
        'Failed to fetch OIDC client domains, using empty set',
        {
          error: (error as Error).message,
        }
      );
      return this.oidcClientDomainsCache || new Set<string>();
    }
  }

  /**
   * Validates a URL against trusted domains and security policies
   *
   * @param url - The URL to validate
   * @param options - Validation options
   * @returns Validation result with isValid flag and processed URL
   */
  validateUrl(
    url: string,
    options: RedirectValidationOptions = {}
  ): RedirectValidationResult {
    const {
      allowLocal = true,
      requireHttps = false,
      maxLength = RedirectAuthority.MAX_URL_LENGTH,
      customValidator,
    } = options;

    if (!url || typeof url !== 'string') {
      return {
        isValid: false,
        url: null,
        reason: 'URL is required and must be a string',
      };
    }

    if (url.length > maxLength) {
      return {
        isValid: false,
        url: null,
        reason: `URL exceeds maximum length of ${maxLength} characters`,
      };
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return { isValid: false, url: null, reason: 'URL cannot be empty' };
    }

    try {
      // Block protocol-relative URLs (e.g., //evil.com) to prevent open redirects
      if (trimmedUrl.startsWith('//')) {
        return {
          isValid: false,
          url: null,
          reason: 'Protocol-relative URLs are not allowed',
        };
      }

      if (trimmedUrl.startsWith('/')) {
        if (!allowLocal) {
          return {
            isValid: false,
            url: null,
            reason: 'Local paths are not allowed',
          };
        }

        if (trimmedUrl.includes('//') || trimmedUrl.includes('\\')) {
          return {
            isValid: false,
            url: null,
            reason: 'Invalid characters in local path',
          };
        }

        if (customValidator && !customValidator(trimmedUrl)) {
          return {
            isValid: false,
            url: null,
            reason: 'URL failed custom validation',
          };
        }

        return { isValid: true, url: trimmedUrl };
      }

      const parsedUrl = new URL(trimmedUrl);

      if (requireHttps && parsedUrl.protocol !== 'https:') {
        return {
          isValid: false,
          url: null,
          reason: 'HTTPS is required for external URLs',
        };
      }

      // Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          isValid: false,
          url: null,
          reason: 'Only HTTP and HTTPS protocols are allowed',
        };
      }

      const currentDomain = this.configManager.getConfig().deployment.url;
      if (currentDomain) {
        try {
          const currentUrl = new URL(currentDomain);
          if (parsedUrl.origin === currentUrl.origin) {
            if (customValidator && !customValidator(trimmedUrl)) {
              return {
                isValid: false,
                url: null,
                reason: 'URL failed custom validation',
              };
            }
            return { isValid: true, url: trimmedUrl };
          }
        } catch (error) {
          this.logger.warn((error as Error).message, {
            url: currentDomain,
          });
        }
      }

      const trustedDomains =
        this.configManager.getConfig().security.protection.trusted_domains;
      this.logger.info('REDIRECT_AUTHORITY: Checking trusted domains', {
        url: trimmedUrl,
        hostname: parsedUrl.hostname,
        trustedDomains,
        trustedDomainsCount: trustedDomains.length,
      });

      const hostname = parsedUrl.hostname.toLowerCase();
      let domainMatched = false;
      let matchedDomain = '';
      let matchSource: 'trusted_domains' | 'oidc_clients' = 'trusted_domains';

      // First, check manual trusted domains
      for (const trustedDomain of trustedDomains) {
        const domain = trustedDomain.toLowerCase().trim();

        if (!domain) continue;

        if (domain.startsWith('*.')) {
          // Wildcard domain matching (*.example.com)
          const baseDomain = domain.substring(2);
          if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
            domainMatched = true;
            matchedDomain = domain;
            matchSource = 'trusted_domains';
            break;
          }
        } else if (hostname === domain) {
          domainMatched = true;
          matchedDomain = domain;
          matchSource = 'trusted_domains';
          break;
        }
      }

      this.logger.info('REDIRECT_AUTHORITY: Domain matching result (manual)', {
        url: trimmedUrl,
        hostname,
        domainMatched,
        matchedDomain,
        trustedDomains,
      });

      // If not matched and we have OIDC services, check OIDC client domains
      // Note: This is synchronous, but we'll use the cached domains if available
      // For first-time use, domains won't be cached, but that's acceptable
      if (!domainMatched && (this.oidcAdapter || this.oidcClientMerger)) {
        // Use cached OIDC domains if available
        if (
          this.oidcClientDomainsCache &&
          Date.now() - this.oidcClientDomainsCacheTime < this.CACHE_TTL
        ) {
          const oidcDomains = this.oidcClientDomainsCache;
          if (oidcDomains.has(hostname)) {
            domainMatched = true;
            matchedDomain = hostname;
            matchSource = 'oidc_clients';
            this.logger.info(
              'REDIRECT_AUTHORITY: Domain matched from OIDC clients (cached)',
              {
                url: trimmedUrl,
                hostname,
                matchedDomain,
                cachedDomainsCount: oidcDomains.size,
              }
            );
          }
        } else {
          this.logger.info(
            'REDIRECT_AUTHORITY: OIDC client domains not cached or expired',
            {
              hasCachedDomains: !!this.oidcClientDomainsCache,
              cacheAge: this.oidcClientDomainsCache
                ? Date.now() - this.oidcClientDomainsCacheTime
                : 0,
              cacheTTL: this.CACHE_TTL,
            }
          );
        }
      }

      if (!domainMatched) {
        const suggestionMessage =
          trustedDomains.length === 0
            ? `No trusted domains configured. Add '${hostname}' to trusted domains or register it as an OIDC client redirect URI.`
            : `Domain '${hostname}' is not in the list of trusted domains: ${trustedDomains.join(', ')}. You can also register it as an OIDC client redirect URI.`;

        this.logger.warn('REDIRECT_AUTHORITY: Domain not trusted', {
          url: trimmedUrl,
          hostname,
          trustedDomainsConfigured: trustedDomains.length,
          trustedDomains,
          hasOidcAdapter: !!this.oidcAdapter,
          oidcDomainsCached: !!this.oidcClientDomainsCache,
        });

        return {
          isValid: false,
          url: null,
          reason: suggestionMessage,
        };
      }

      this.logger.info('REDIRECT_AUTHORITY: Domain validated successfully', {
        url: trimmedUrl,
        hostname,
        matchedDomain,
        matchSource,
      });

      if (customValidator && !customValidator(trimmedUrl)) {
        return {
          isValid: false,
          url: null,
          reason: 'URL failed custom validation',
        };
      }

      return { isValid: true, url: trimmedUrl };
    } catch (error) {
      this.logger.error((error as Error).message, {
        url: trimmedUrl,
      });
      return {
        isValid: false,
        url: null,
        reason: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Stores a redirect intent securely in the user's session
   *
   * @param req - Express request object
   * @param url - The redirect URL (will be validated)
   * @param intent - The purpose/intent of the redirect
   * @param metadata - Optional metadata to store with the intent
   * @param options - Validation options
   * @returns Whether the intent was successfully stored
   */
  async storeIntent(
    req: Request,
    url: string,
    intent: string,
    metadata: Record<string, unknown> = {},
    options: RedirectValidationOptions = {}
  ): Promise<boolean> {
    this.logger.info(
      'REDIRECT_AUTHORITY: Attempting to store redirect intent',
      {
        url,
        intent,
        sessionId: req.session?.id || 'no-session',
        hasSession: !!req.session,
      }
    );

    if (!intent || typeof intent !== 'string') {
      this.logger.warn(
        'REDIRECT_AUTHORITY: Invalid intent provided to storeIntent',
        {
          intent,
        }
      );
      return false;
    }

    // Prime OIDC client domains cache if needed (async, non-blocking)
    if (
      (!this.oidcClientDomainsCache ||
        Date.now() - this.oidcClientDomainsCacheTime >= this.CACHE_TTL) &&
      (this.oidcAdapter || this.oidcClientMerger)
    ) {
      // Don't await - let it populate in background
      this.getOidcClientDomains().catch(error => {
        this.logger.warn('Failed to prime OIDC client domains cache', {
          error: (error as Error).message,
        });
      });
    }

    const validation = this.validateUrl(url, options);
    this.logger.info('REDIRECT_AUTHORITY: URL validation result', {
      url,
      intent,
      isValid: validation.isValid,
      validatedUrl: validation.url,
      reason: validation.reason,
    });

    // If validation failed due to missing trusted domains, try loading OIDC domains and retry
    if (
      !validation.isValid &&
      validation.reason?.includes('not in the list of trusted domains') &&
      (this.oidcAdapter || this.oidcClientMerger)
    ) {
      this.logger.info(
        'REDIRECT_AUTHORITY: First validation failed, loading OIDC domains and retrying',
        {
          url,
          intent,
          reason: validation.reason,
        }
      );

      try {
        await this.getOidcClientDomains();

        const retryValidation = this.validateUrl(url, options);
        this.logger.info('REDIRECT_AUTHORITY: Retry validation result', {
          url,
          intent,
          isValid: retryValidation.isValid,
          validatedUrl: retryValidation.url,
          reason: retryValidation.reason,
        });

        if (!retryValidation.isValid || !retryValidation.url) {
          this.logger.warn(
            'REDIRECT_AUTHORITY: Invalid URL provided to storeIntent (after retry)',
            {
              url,
              intent,
              reason: retryValidation.reason,
            }
          );
          return false;
        }

        // Use retry validation result
        return this.persistIntent(req, retryValidation.url, intent, metadata);
      } catch (error) {
        this.logger.error(
          'REDIRECT_AUTHORITY: Error during OIDC domain load and retry',
          {
            error: (error as Error).message,
            url,
            intent,
          }
        );
        return false;
      }
    }

    if (!validation.isValid || !validation.url) {
      this.logger.warn(
        'REDIRECT_AUTHORITY: Invalid URL provided to storeIntent',
        {
          url,
          intent,
          reason: validation.reason,
        }
      );
      return false;
    }

    return this.persistIntent(req, validation.url, intent, metadata);
  }

  /**
   * Internal method to persist redirect intent to session
   *
   * @param req - Express request object
   * @param url - Validated URL
   * @param intent - Intent type
   * @param metadata - Optional metadata
   * @returns Whether the intent was successfully stored
   */
  private persistIntent(
    req: Request,
    url: string,
    intent: string,
    metadata: Record<string, unknown> = {}
  ): boolean {
    try {
      const redirectIntent: RedirectIntent = {
        url,
        intent: intent.toLowerCase().trim(),
        timestamp: Date.now(),
        metadata,
      };

      this.sessionManager.set(req, 'redirectIntent', redirectIntent);

      this.logger.info(
        'REDIRECT_AUTHORITY: Redirect intent stored successfully',
        {
          intent: redirectIntent.intent,
          url: redirectIntent.url,
          sessionId: req.session?.id || 'no-session',
        }
      );

      return true;
    } catch (error) {
      this.logger.error('REDIRECT_AUTHORITY: Error storing redirect intent', {
        error,
        intent,
        url,
      });
      return false;
    }
  }

  /**
   * Retrieves a redirect intent from the user's session
   *
   * @param req - Express request object
   * @param expectedIntent - The expected intent type
   * @param consume - Whether to remove the intent after retrieval (default: true)
   * @param maxAge - Maximum age of intent in milliseconds (default: 1 hour)
   * @returns The redirect URL or null if not found/invalid
   */
  getIntent(
    req: Request,
    expectedIntent: string,
    consume: boolean = true,
    maxAge: number = RedirectAuthority.DEFAULT_INTENT_EXPIRATION
  ): string | null {
    this.logger.info(
      'REDIRECT_AUTHORITY: Attempting to retrieve redirect intent',
      {
        expectedIntent,
        consume,
        sessionId: req.session?.id || 'no-session',
        hasSession: !!req.session,
      }
    );

    if (!expectedIntent || typeof expectedIntent !== 'string') {
      this.logger.warn('REDIRECT_AUTHORITY: Invalid expectedIntent provided', {
        expectedIntent,
      });
      return null;
    }

    try {
      const redirectIntent: RedirectIntent | undefined =
        this.sessionManager.get(req, 'redirectIntent');

      this.logger.info(
        'REDIRECT_AUTHORITY: Retrieved redirect intent from session',
        {
          found: !!redirectIntent,
          redirectIntent: redirectIntent
            ? {
                url: redirectIntent.url,
                intent: redirectIntent.intent,
                timestamp: redirectIntent.timestamp,
                age: Date.now() - redirectIntent.timestamp,
              }
            : null,
          sessionId: req.session?.id || 'no-session',
        }
      );

      if (!redirectIntent) {
        this.logger.info(
          'REDIRECT_AUTHORITY: No redirect intent found in session'
        );
        return null;
      }

      const normalizedExpected = expectedIntent.toLowerCase().trim();
      const normalizedStored = redirectIntent.intent.toLowerCase().trim();

      if (normalizedStored !== normalizedExpected) {
        this.logger.info('REDIRECT_AUTHORITY: Intent type mismatch', {
          expected: normalizedExpected,
          stored: normalizedStored,
        });
        return null;
      }

      const age = Date.now() - redirectIntent.timestamp;
      if (age > maxAge) {
        this.logger.info('REDIRECT_AUTHORITY: Redirect intent expired', {
          intent: redirectIntent.intent,
          age: Math.round(age / 1000),
          maxAge: Math.round(maxAge / 1000),
        });

        this.sessionManager.remove(req, 'redirectIntent');
        return null;
      }

      // Consume intent if requested
      if (consume) {
        this.sessionManager.remove(req, 'redirectIntent');
        this.logger.info('REDIRECT_AUTHORITY: Redirect intent consumed', {
          intent: redirectIntent.intent,
          url: redirectIntent.url,
        });
      }

      return redirectIntent.url;
    } catch (error) {
      this.logger.error(
        'REDIRECT_AUTHORITY: Error retrieving redirect intent',
        {
          error,
          expectedIntent,
        }
      );
      return null;
    }
  }

  /**
   * Gets redirect intent with metadata
   *
   * @param req - Express request object
   * @param expectedIntent - The expected intent type
   * @param consume - Whether to remove the intent after retrieval
   * @param maxAge - Maximum age of intent in milliseconds
   * @returns The redirect intent object or null
   */
  getIntentWithMetadata(
    req: Request,
    expectedIntent: string,
    consume: boolean = true,
    maxAge: number = RedirectAuthority.DEFAULT_INTENT_EXPIRATION
  ): RedirectIntent | null {
    if (!expectedIntent || typeof expectedIntent !== 'string') {
      return null;
    }

    try {
      const redirectIntent: RedirectIntent | undefined =
        this.sessionManager.get(req, 'redirectIntent');

      if (!redirectIntent) {
        return null;
      }

      const normalizedExpected = expectedIntent.toLowerCase().trim();
      const normalizedStored = redirectIntent.intent.toLowerCase().trim();

      if (normalizedStored !== normalizedExpected) {
        return null;
      }

      const age = Date.now() - redirectIntent.timestamp;
      if (age > maxAge) {
        this.sessionManager.remove(req, 'redirectIntent');
        return null;
      }

      // Consume intent if requested
      if (consume) {
        this.sessionManager.remove(req, 'redirectIntent');
      }

      return redirectIntent;
    } catch (error) {
      this.logger.error('Error retrieving redirect intent with metadata', {
        error,
        expectedIntent,
      });
      return null;
    }
  }

  /**
   * Checks if a redirect intent exists without consuming it
   *
   * @param req - Express request object
   * @param expectedIntent - The expected intent type (optional)
   * @returns Whether a valid intent exists
   */
  hasIntent(req: Request, expectedIntent?: string): boolean {
    try {
      const redirectIntent: RedirectIntent | undefined =
        this.sessionManager.get(req, 'redirectIntent');

      if (!redirectIntent) {
        return false;
      }

      const age = Date.now() - redirectIntent.timestamp;
      if (age > RedirectAuthority.DEFAULT_INTENT_EXPIRATION) {
        return false;
      }

      if (expectedIntent) {
        const normalizedExpected = expectedIntent.toLowerCase().trim();
        const normalizedStored = redirectIntent.intent.toLowerCase().trim();
        return normalizedStored === normalizedExpected;
      }

      return true;
    } catch (error) {
      this.logger.error('Error checking redirect intent', {
        error,
        expectedIntent,
      });
      return false;
    }
  }

  /**
   * Clears any stored redirect intent
   *
   * @param req - Express request object
   * @returns Whether intent was cleared
   */
  clearIntent(req: Request): boolean {
    try {
      this.sessionManager.remove(req, 'redirectIntent');
      return true;
    } catch (error) {
      this.logger.error('Error clearing redirect intent', { error });
      return false;
    }
  }

  /**
   * Builds a redirect URL with query parameters
   *
   * @param baseUrl - The base URL
   * @param params - Query parameters to add
   * @returns The URL with parameters
   */
  buildRedirectUrl(
    baseUrl: string,
    params: Record<string, string> = {}
  ): string {
    if (!baseUrl) {
      return '';
    }

    try {
      const url = new URL(baseUrl);

      Object.entries(params).forEach(([key, value]) => {
        if (key && value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });

      return url.toString();
    } catch (error) {
      this.logger.error((error as Error).message, {
        baseUrl,
        params,
      });
      // If URL parsing fails, fall back to simple string concatenation
      const separator = baseUrl.includes('?') ? '&' : '?';
      const queryString = Object.entries(params)
        .filter(([key, value]) => key && value !== undefined && value !== null)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        )
        .join('&');

      return queryString ? `${baseUrl}${separator}${queryString}` : baseUrl;
    }
  }

  /**
   * Validates and builds a secure redirect URL with parameters
   *
   * @param baseUrl - The base URL to validate and use
   * @param params - Query parameters to add
   * @param options - Validation options
   * @returns The validated URL with parameters, or null if invalid
   */
  buildSecureRedirectUrl(
    baseUrl: string,
    params: Record<string, string> = {},
    options: RedirectValidationOptions = {}
  ): string | null {
    const validation = this.validateUrl(baseUrl, options);
    if (!validation.isValid || !validation.url) {
      return null;
    }

    return this.buildRedirectUrl(validation.url, params);
  }

  /**
   * Creates a fluent redirect builder for secure redirects
   *
   * @param response - Express response object
   * @param options - Optional validation options
   * @returns RedirectBuilder instance for method chaining
   *
   * @example
   * // Basic usage
   * redirectAuthority.redirect(res).to(userUrl).or(fallbackUrl);
   *
   * // With custom validation options
   * redirectAuthority.redirect(res)
   *   .withOptions({ requireHttps: true })
   *   .to(userUrl)
   *   .or(fallbackUrl);
   */
  redirect(
    response: Response,
    options: RedirectValidationOptions = {}
  ): RedirectBuilder {
    return new RedirectBuilder(response, this, options);
  }
}
