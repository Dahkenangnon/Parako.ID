import type { KoaContextWithOIDC } from 'oidc-provider';
import type { Request } from 'express';
import type { SessionUserAccount } from '../utils/session.js';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IOIDCUtils } from '../di/interfaces/oidc-utils.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import { TYPES } from '../di/types.js';
import { UAParser } from 'ua-parser-js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import {
  validateCharsetMask,
  validateWithRegex,
} from '../utils/custom-identifier-validation.js';

@injectable()
export class OIDCUtils implements IOIDCUtils {
  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge
  ) {}

  /**
   * Get the user's preferred locale from the Koa context
   *
   * Checks the following sources in order of priority (OIDC spec compliant):
   * 1. ui_locales query parameter (OIDC standard - comma-separated list)
   * 2. lang query parameter (backward compatibility)
   * 3. Cookie (locale=xx)
   * 4. Accept-Language header
   *
   * @param ctx - The Koa context object
   * @param defaultLocale - Default locale if none is found
   * @returns The determined locale code (e.g., 'en', 'fr')
   */
  public getLocale(ctx: KoaContextWithOIDC, defaultLocale = 'en'): string {
    if (!ctx) {
      return defaultLocale;
    }

    const config = this.configManager.getConfig();
    const availableLocales = config.application.locales.available;

    // Priority 1: Check ui_locales parameter (OIDC spec - comma-separated list)
    // Format: "fr-CA,fr,en" - returns first supported locale
    if (ctx.query && ctx.query.ui_locales) {
      const uiLocales = (ctx.query.ui_locales as string)
        .split(',')
        .map(l => l.trim());
      for (const locale of uiLocales) {
        const langCode = locale.split('-')[0].toLowerCase();
        if (availableLocales.includes(langCode)) {
          return langCode;
        }
      }
    }

    if (ctx.originalUrl && ctx.originalUrl.includes('?')) {
      const urlParams = new URLSearchParams(ctx.originalUrl.split('?')[1]);
      const uiLocalesParam = urlParams.get('ui_locales');
      if (uiLocalesParam) {
        const uiLocales = uiLocalesParam.split(',').map(l => l.trim());
        for (const locale of uiLocales) {
          const langCode = locale.split('-')[0].toLowerCase();
          if (availableLocales.includes(langCode)) {
            return langCode;
          }
        }
      }
    }

    // Priority 2: Check lang parameter (backward compatibility)
    if (ctx.query && ctx.query.lang) {
      const langCode = (ctx.query.lang as string).toLowerCase();
      if (availableLocales.includes(langCode)) {
        return langCode;
      }
    }

    if (ctx.originalUrl && ctx.originalUrl.includes('?')) {
      const urlParams = new URLSearchParams(ctx.originalUrl.split('?')[1]);
      const langParam = urlParams.get('lang');
      if (langParam && availableLocales.includes(langParam.toLowerCase())) {
        return langParam.toLowerCase();
      }
    }

    // Priority 3: Check cookie
    const cookies = this.parseCookies(ctx);
    if (cookies['locale'] && availableLocales.includes(cookies['locale'])) {
      return cookies['locale'];
    }

    // Priority 4: Check Accept-Language header
    if (
      ctx.request &&
      ctx.request.header &&
      ctx.request.header['accept-language']
    ) {
      const acceptLanguage = ctx.request.header['accept-language'];
      const preferredLocale = acceptLanguage
        .split(',')[0]
        .trim()
        .split('-')[0]
        .toLowerCase();
      if (preferredLocale && availableLocales.includes(preferredLocale)) {
        return preferredLocale;
      }
    }

    return defaultLocale;
  }

  /**
   * Parse cookies from Koa context
   *
   * @param ctx - The Koa context
   * @returns Object with cookie name-value pairs
   */
  public parseCookies(ctx: KoaContextWithOIDC): Record<string, string> {
    const cookies: Record<string, string> = {};

    if (!ctx.request || !ctx.request.header || !ctx.request.header.cookie) {
      return cookies;
    }

    const cookieHeader = ctx.request.header.cookie;
    if (typeof cookieHeader === 'string') {
      cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.trim().split('=');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          cookies[name] = value;
        }
      });
    }

    return cookies;
  }

  /**
   * Helper function to add or update an authenticated user in the session
   * Handles both new and existing accounts properly for multiple account sessions
   *
   * @param req - Express request object
   * @param userAccount - User account data to add/update
   * @param makeActive - Whether to make this account the active one
   * @returns boolean indicating success
   */
  public addOrUpdateAccountInSession(
    req: Request,
    userAccount: SessionUserAccount,
    makeActive: boolean = true
  ): boolean {
    try {
      const existingAuthUsers = this.sessionManager.getAuthenticatedUsers(req);

      if (existingAuthUsers) {
        const accountExists =
          existingAuthUsers.active?.id === userAccount.id ||
          existingAuthUsers.active?.username === userAccount.username ||
          existingAuthUsers.others.some(
            acc =>
              acc.id === userAccount.id || acc.username === userAccount.username
          );

        if (accountExists && makeActive) {
          // Account exists, switch to it if it's not already active
          if (
            existingAuthUsers.active?.id !== userAccount.id &&
            existingAuthUsers.active?.username !== userAccount.username
          ) {
            const switchResult = this.sessionManager.switchUser(
              req,
              userAccount.id
            );
            // For OIDC flows, if reauth is required we still return success
            // and let the OIDC flow handle the reauth prompt
            return (
              switchResult.success || switchResult.reason === 'reauth_required'
            );
          }
          // Already active, just update lastUsed
          existingAuthUsers.active.last_used = Date.now();
          this.sessionManager.set(req, 'authenticatedUsers', existingAuthUsers);
          return true;
        } else if (!accountExists) {
          // New account, add it
          const result = this.sessionManager.addAuthenticatedUser(
            req,
            userAccount,
            makeActive
          );
          return result.success;
        }
        return true; // Account exists but we're not making it active
      } else {
        // No existing session, create new one
        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: userAccount,
        });
        return true;
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error managing account in session',
        username: userAccount.username,
      });
      return false;
    }
  }

  /**
   * Sync Express session with OIDC session after consent
   */
  public async syncSessionAfterConsent(
    req: Request,
    accountId: string
  ): Promise<void> {
    try {
      if (accountId) {
        const currentActiveUser = this.sessionManager.getActiveUser(req);

        // Only sync if the accountId doesn't match the current active user
        if (
          !currentActiveUser ||
          (currentActiveUser.username !== accountId &&
            currentActiveUser.id !== accountId)
        ) {
          const existingAuthUsers =
            this.sessionManager.getAuthenticatedUsers(req);
          let accountFound = false;

          if (existingAuthUsers) {
            const existingAccount = existingAuthUsers.others.find(
              acc => acc.username === accountId || acc.id === accountId
            );

            if (existingAccount) {
              const switchResult = this.sessionManager.switchUser(
                req,
                existingAccount.id
              );
              if (switchResult.success) {
                accountFound = true;
                this.logger.debug(
                  'Switched to existing account during OIDC consent',
                  {
                    switchedTo: accountId,
                  }
                );
              } else if (switchResult.reason === 'reauth_required') {
                // Reauth required - still mark as found but don't switch
                accountFound = true;
                this.logger.debug(
                  'Account switch requires re-authentication during OIDC consent',
                  {
                    switchedTo: accountId,
                  }
                );
              }
            }
          }

          // If account not found in session, fetch from database and add
          if (!accountFound) {
            const user = await this.userService.findByUsername(accountId);
            if (user) {
              const userAccount: SessionUserAccount = {
                id: user._id?.toString() || '',
                username: user.username,
                email: user.email,
                email_verified: user.email_verified || false,
                given_name: user.given_name || '',
                family_name: user.family_name || '',
                full_name:
                  `${user.given_name || ''} ${user.family_name || ''}`.trim(),
                roles: user.roles || ['user'],
                is_admin:
                  user.roles &&
                  (user.roles.includes('admin') ||
                    user.roles.includes('superadmin')),
                last_used: Date.now(),
              };

              // Use helper function to manage the account in session
              const sessionSuccess = this.addOrUpdateAccountInSession(
                req,
                userAccount,
                true
              );

              if (sessionSuccess) {
                this.logger.debug(
                  'Successfully managed account in OIDC consent session',
                  {
                    username: accountId,
                  }
                );
              } else {
                this.logger.warn(
                  'Failed to manage account in consent session',
                  {
                    username: accountId,
                  }
                );
              }
            }
          }
        } else {
          this.logger.debug('Account already active, no session sync needed', {
            username: accountId,
          });
        }
      }
    } catch (sessionError) {
      this.logger.error(sessionError as Error, {
        context: 'Error syncing session after OIDC consent',
      });
    }
  }

  /**
   * Prepare template variables for OIDC interaction pages
   */
  public prepareTemplateVariables(prompt: any, _params: any, req: Request) {
    const missingOIDCScope = new Set<string>(
      Array.isArray(prompt.details.missingOIDCScope)
        ? prompt.details.missingOIDCScope
        : []
    );
    missingOIDCScope.delete('openid');
    missingOIDCScope.delete('offline_access');

    const missingOIDCClaims = new Set<string>(
      Array.isArray(prompt.details.missingOIDCClaims)
        ? prompt.details.missingOIDCClaims
        : []
    );
    ['sub', 'sid', 'auth_time', 'acr', 'amr', 'iss'].forEach(claim =>
      missingOIDCClaims.delete(claim)
    );

    return {
      missingOIDCScope: Array.from(missingOIDCScope),
      missingOIDCClaims: Array.from(missingOIDCClaims),
      missingResourceScopes: prompt.details.missingResourceScopes || {},
      rar: prompt.details.rar || [],
      csrfToken: this.sessionManager.get(req, 'csrfToken'),
    };
  }

  /**
   * Format user data for templates
   */
  public formatUserForTemplate(activeUser: any) {
    if (!activeUser) return null;

    return {
      displayName: activeUser.full_name || activeUser.username,
      full_name: activeUser.full_name,
      username: activeUser.username,
      email: activeUser.email,
      email_verified: activeUser.email_verified,
      given_name: activeUser.given_name,
      family_name: activeUser.family_name,
      picture: activeUser.picture,
      initials: (() => {
        const firstName = activeUser.given_name || '';
        const lastName = activeUser.family_name || '';
        if (firstName || lastName) {
          return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
        }
        return activeUser.username
          ? activeUser.username.substring(0, 2).toUpperCase()
          : 'U';
      })(),
    };
  }

  /**
   * Transform scopes into readable format for templates
   */
  public transformScopesForTemplate(missingOIDCScope: Set<string>) {
    if (Array.from(missingOIDCScope).length > 0) {
      return Array.from(missingOIDCScope).map(scope => {
        switch (scope) {
          case 'email':
            return 'Read your email address';
          case 'profile':
            return 'Access your basic profile information';
          case 'phone':
            return 'Access your phone number';
          case 'address':
            return 'Access your address information';
          default:
            return `Access to ${scope}`;
        }
      });
    }
    return ['Access your basic account information']; // Default scope if none provided
  }

  /**
   * Prepare accounts list for account selection template
   */
  public prepareAccountsList(authenticatedUsers: any) {
    const accounts = [];

    if (authenticatedUsers.active) {
      accounts.push({
        id: authenticatedUsers.active.id,
        name:
          authenticatedUsers.active.full_name ||
          authenticatedUsers.active.username,
        email: authenticatedUsers.active.email || '',
        avatar: authenticatedUsers.active.picture || '',
        initials: (() => {
          const firstName = authenticatedUsers.active.given_name || '';
          const lastName = authenticatedUsers.active.family_name || '';
          if (firstName || lastName) {
            return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
          }
          return authenticatedUsers.active.username
            ? authenticatedUsers.active.username.substring(0, 2).toUpperCase()
            : 'U';
        })(),
        is_active: true,
      });
    }

    authenticatedUsers.others.forEach((account: any) => {
      accounts.push({
        id: account.id,
        name: account.full_name || account.username,
        email: account.email || '',
        avatar: account.picture || '',
        initials: (() => {
          const firstName = account.given_name || '';
          const lastName = account.family_name || '';
          if (firstName || lastName) {
            return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
          }
          return account.username
            ? account.username.substring(0, 2).toUpperCase()
            : 'U';
        })(),
        is_active: false,
      });
    });

    return accounts;
  }

  /**
   * Validate login credentials
   */
  public validateLoginCredentials(req: Request): {
    isValid: boolean;
    identifier?: string;
    password?: string;
  } {
    const identifier = req.body.login;
    const password = req.body.password;

    if (!identifier || !password) {
      this.logger.info('Missing credentials in OIDC login');
      return { isValid: false };
    }

    return { isValid: true, identifier, password };
  }

  /**
   * Detect the type of identifier (email, phone, or custom identifier)
   *
   * This enables a single "identifier" field on the login form that auto-detects
   * whether the user entered an email, phone number, or custom identifier.
   *
   * @param identifier - The identifier string to analyze
   * @returns The detected identifier type
   */
  public detectIdentifierType(
    identifier: string
  ):
    | 'email'
    | 'phone'
    | { type: 'custom_identifier'; slot: 1 | 2 | 3; key: string } {
    if (!identifier || typeof identifier !== 'string') {
      return 'email';
    }

    const trimmed = identifier.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(trimmed)) {
      return 'email';
    }

    // Must have at least 7 digits to be considered a phone number
    const phoneRegex = /^[+]?[\d\s\-().]{7,}$/;
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (phoneRegex.test(trimmed) && digitCount >= 7) {
      return 'phone';
    }

    // Try to match against configured loginable custom identifier fields
    const loginableFields = this.getLoginableCustomIdentifierFields();

    // Try fields with validation patterns first (more specific)
    for (const field of loginableFields) {
      if (field.validation_type === 'regex' && field.pattern) {
        if (validateWithRegex(trimmed, field.pattern)) {
          return {
            type: 'custom_identifier',
            slot: field.slot as 1 | 2 | 3,
            key: field.key,
          };
        }
      } else if (
        field.validation_type === 'charset_mask' &&
        field.charset &&
        field.mask
      ) {
        if (validateCharsetMask(trimmed, field.charset, field.mask)) {
          return {
            type: 'custom_identifier',
            slot: field.slot as 1 | 2 | 3,
            key: field.key,
          };
        }
      }
    }

    // Fallback: if there's exactly one patternless loginable field, use it
    const patternlessFields = loginableFields.filter(
      f => f.validation_type === 'none'
    );
    if (patternlessFields.length === 1) {
      const f = patternlessFields[0];
      return {
        type: 'custom_identifier',
        slot: f.slot as 1 | 2 | 3,
        key: f.key,
      };
    }

    // Default: first loginable field or fallback to email
    if (loginableFields.length > 0) {
      return {
        type: 'custom_identifier',
        slot: loginableFields[0].slot as 1 | 2 | 3,
        key: loginableFields[0].key,
      };
    }

    // No custom identifiers configured — default to email
    return 'email';
  }

  private getLoginableCustomIdentifierFields(): Array<{
    slot: number;
    key: string;
    validation_type: string;
    pattern?: string;
    charset?: string;
    mask?: string;
  }> {
    const config = this.configManager.getConfig();
    const ciConfig = config.security.authentication.custom_identifiers;
    if (!ciConfig?.enabled) return [];
    return (ciConfig.fields ?? []).filter((f: any) => f.usable_for_login);
  }

  /**
   * Validate MFA code
   */
  public validateMfaCode(req: Request): { isValid: boolean; code?: string } {
    const code = (req.body.code as string | undefined)?.trim();

    if (!code) {
      this.logger.info('Missing MFA code');
      return { isValid: false };
    }

    return { isValid: true, code };
  }

  /**
   * Validate account selection
   */
  public validateAccountSelection(req: Request): {
    isValid: boolean;
    accountId?: string;
  } {
    const selectedAccountId = req.body.account_id;

    if (!selectedAccountId) {
      this.logger.warn('No account selected in select_account interaction');
      return { isValid: false };
    }

    return { isValid: true, accountId: selectedAccountId };
  }

  /**
   * Check if user has valid MFA setup (supports multi-method schema)
   */
  public validateMfaSetup(user: any): {
    hasMfa: boolean;
    method?: string;
    methods?: string[];
  } {
    if (!user || !user.mfa?.enabled) {
      return { hasMfa: false };
    }

    const methods: string[] = [];

    if (user.mfa?.methods?.totp?.enabled && user.mfa?.methods?.totp?.secret) {
      methods.push('totp');
    }
    if (user.mfa?.methods?.email?.enabled) {
      methods.push('email');
    }
    if (
      user.mfa?.methods?.webauthn?.enabled &&
      user.mfa?.methods?.webauthn?.credentials?.length > 0
    ) {
      methods.push('webauthn');
    }

    if (methods.length === 0) {
      return { hasMfa: false };
    }

    const preferred_method =
      user.mfa?.preferred_method && methods.includes(user.mfa.preferred_method)
        ? user.mfa.preferred_method
        : methods[0];

    return { hasMfa: true, method: preferred_method, methods };
  }

  /**
   * Get application title
   */
  public getAppTitle(): string {
    const config = this.configManager.getConfig();
    return config.application.title;
  }

  /**
   * Parse user agent string to extract browser and OS information using ua-parser-js
   */
  public parseUserAgent(userAgent: string): {
    browser: string;
    os: string;
    device: string;
  } {
    if (!userAgent)
      return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };

    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    const browser = result.browser.name || 'Unknown';
    const os = result.os.name || 'Unknown';
    const device = result.device.type || 'desktop';

    return { browser, os, device };
  }

  /**
   * Format timestamp to relative time (e.g., "2 hours ago", "3 days from now")
   */
  public formatTimeAgo(timestamp: number, future: boolean = false): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = future
      ? date.getTime() - now.getTime()
      : now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0)
      return `${days} day${days > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`;
    if (hours > 0)
      return `${hours} hour${hours > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`;
    if (minutes > 0)
      return `${minutes} minute${minutes > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`;
    return future ? 'Just now' : 'Just now';
  }

  /**
   * Format timestamp to readable date string
   */
  public formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  /**
   * Get client information for connected applications
   */
  public async getClientInfo(clientIds: string[]): Promise<any[]> {
    if (clientIds.length === 0) return [];

    try {
      const clients = await Promise.all(
        clientIds.map(async clientId => {
          try {
            const client = await this.oidcAdapter.client.find(clientId);
            if (client) {
              return {
                id: clientId,
                name:
                  (client as any).clientName ||
                  (client as any).clientId ||
                  'Connected Application',
                developer:
                  (client as any).clientUri &&
                  typeof (client as any).clientUri === 'string'
                    ? new URL((client as any).clientUri).hostname
                    : 'Unknown Developer',
              };
            }
          } catch (error) {
            this.logger.error(error as Error, {
              context: `Failed to get client info for ${clientId}`,
            });
          }

          return {
            id: clientId,
            name: 'Connected Application',
            developer: 'Unknown Developer',
          };
        })
      );

      return clients;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to get client info',
      });
      return clientIds.map(clientId => ({
        id: clientId,
        name: 'Connected Application',
        developer: 'Unknown Developer',
      }));
    }
  }

  /**
   * Process session data and enrich with additional information
   */
  public async processSessionData(session: any): Promise<any> {
    const payload = session.payload as any;
    const loginTime = payload.loginTs || payload.iat;
    const accountId = payload.accountId;

    let userInfo = {
      username: accountId,
      email: 'Unknown',
      full_name: 'Unknown User',
      given_name: '',
      family_name: '',
    };

    try {
      const userActivities =
        await this.activityService.findActivitiesAroundTime(
          accountId,
          loginTime,
          300 // 5-minute window
        );

      if (userActivities.length > 0) {
        const latestActivity = userActivities[0];
        userInfo = {
          username: accountId,
          email: latestActivity.actor?.email || 'Unknown',
          full_name: latestActivity.actor?.full_name || 'Unknown User',
          given_name: latestActivity.actor?.given_name || '',
          family_name: latestActivity.actor?.family_name || '',
        };
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Could not get user info for ${accountId}`,
      });
    }

    const deviceInfo = this.parseUserAgent(payload.userAgent || '');

    const clientIds = payload.authorizations
      ? Object.keys(payload.authorizations)
      : [];
    const clients = await this.getClientInfo(clientIds);

    const now = Math.floor(Date.now() / 1000);
    const isExpired = payload.exp && payload.exp <= now;
    const sessionAge = this.formatTimeAgo(loginTime);
    const expiresIn = payload.exp
      ? this.formatTimeAgo(payload.exp, true)
      : 'Unknown';

    return {
      id: payload.jti || session._id,
      accountId,
      userInfo,
      device: `${deviceInfo.browser} on ${deviceInfo.os}`,
      deviceType: deviceInfo.device,
      ip: payload.ip_address || 'Unknown',
      location: 'Online', // Could be enhanced with geolocation
      startTime: this.formatDate(loginTime),
      lastActive: this.formatTimeAgo(loginTime),
      loginTimestamp: loginTime,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      expiresIn,
      sessionAge,
      isExpired,
      status: isExpired ? 'expired' : 'active',
      clients,
      amr: payload.amr || [],
      acr: payload.acr || '',
      user_agent: payload.user_agent || 'Unknown',
    };
  }

  /**
   * Process session data for export (simplified version)
   */
  public async processSessionForExport(session: any): Promise<any> {
    const payload = session.payload as any;
    const loginTime = payload.loginTs || payload.iat;
    const accountId = payload.accountId;

    let userInfo = {
      email: 'Unknown',
      full_name: 'Unknown User',
    };

    try {
      const userActivities =
        await this.activityService.findActivitiesAroundTime(
          accountId,
          loginTime,
          300
        );

      if (userActivities.length > 0) {
        const latestActivity = userActivities[0];
        userInfo = {
          email: latestActivity.actor?.email || 'Unknown',
          full_name: latestActivity.actor?.full_name || 'Unknown User',
        };
      }
    } catch (error) {
      this.logger.debug('Error getting user info for export, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const deviceInfo = this.parseUserAgent(payload.userAgent || '');
    const now = Math.floor(Date.now() / 1000);
    const isExpired = payload.exp && payload.exp <= now;

    return {
      'Session ID': payload.jti || session._id,
      Username: accountId,
      Email: userInfo.email,
      'Full Name': userInfo.full_name,
      Device: `${deviceInfo.browser} on ${deviceInfo.os}`,
      'Device Type': deviceInfo.device,
      'IP Address': payload.ip_address || 'Unknown',
      'Login Time': this.formatDate(loginTime),
      'Expires At': payload.exp ? this.formatDate(payload.exp) : 'Unknown',
      Status: isExpired ? 'Expired' : 'Active',
      'Session Age': this.formatTimeAgo(loginTime),
      AMR: (payload.amr || []).join(', '),
      ACR: payload.acr || 'Unknown',
    };
  }
}
