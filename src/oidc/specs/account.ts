import { injectable, inject, unmanaged } from 'inversify';
import type {
  AccountClaims,
  ClaimsParameter,
  KoaContextWithOIDC,
} from 'oidc-provider';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IAccount } from '../../di/interfaces/account.interface.js';
import { TYPES } from '../../di/types.js';

/**
 * Account class responsible for managing user account information in the OIDC Provider.
 * This class implements the Account interface required by the OIDC Provider for user authentication
 * and claims management. It handles user lookup, authentication, and claims retrieval.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#accounts}
 *
 * @class Account
 * @implements {IAccount}
 */
@injectable()
export class Account implements IAccount {
  /**
   * The unique identifier (username) for the account
   */
  accountId: string;
  [key: string]: unknown;

  /**
   * Creates an instance of Account.
   *
   * @param {string} id - The unique identifier (username) for the account
   * @throws {Error} If id is not provided
   */
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @unmanaged() id: string
  ) {
    if (!id) {
      this.logger.error('Account id is required');
      throw new Error('Account id is required');
    }
    this.accountId = id;
  }

  /**
   * Retrieves claims for the user account based on the specified parameters.
   * This method is used by the OIDC Provider to get user information for ID tokens
   * or userinfo endpoints. It filters claims based on scope, use parameter, and rejected claims.
   *
   * @param {string} use - Specifies where the claims will be used: "id_token" or "userinfo"
   * @param {string} scope - The OAuth2/OIDC scope requested by the client
   * @param {Object} claims - The claims requested by the client for either "id_token" or "userinfo"
   * @param {string[]} rejected - Array of claim names that were rejected by the end-user
   * @returns {Promise<AccountClaims>} Object containing the user's claims including sub (subject)
   * @throws {Error} If user lookup fails
   */
  async claims(
    use: string,
    scope: string,
    claims: ClaimsParameter,
    rejected: string[]
  ): Promise<AccountClaims> {
    const user = await this.userService.findByUsername(this.accountId);
    if (!user) {
      this.logger.error(
        `User not found at claims Account method: ${this.accountId}`
      );
      throw new Error(`User not found: ${this.accountId}`);
    }

    const result: AccountClaims = { sub: this.accountId };

    const scopes = scope ? scope.split(' ').filter(Boolean) : [];

    const configuredScopes = this.configManager.getConfig().features.oidc
      .scopes || ['openid', 'offline_access'];

    const requestedClaims = (claims as any)?.[use] || {};

    // Use configuration if available, otherwise fall back to defaults
    const scopeToClaims: Record<string, string[]> = {
      openid: ['sub'], // Always included
      profile: [
        'name',
        'family_name',
        'given_name',
        'middle_name',
        'nickname',
        'preferred_username',
        'profile',
        'picture',
        'website',
        'gender',
        'birthdate',
        'zoneinfo',
        'locale',
        'updated_at',
      ],
      email: ['email', 'email_verified'],
      address: [
        'address',
        'street_address',
        'locality',
        'region',
        'postal_code',
        'country',
        'city',
      ],
      phone: ['phone_number', 'phone_number_verified'],
      // Custom scopes for additional user information
      roles: ['roles'],
      preferences: ['prefered_contact', 'prefered_dark_theme', 'theme'],
      professional: ['auth_provider'],
      account: [
        'account_enabled',
        'account_is_anonymized',
        'register_with',
        'last_login',
        'blocked_from',
        'username',
      ],
      // MFA scope for multi-factor authentication information
      mfa: ['mfa_enabled', 'mfa_method', 'mfa_phone_number'],
      // Recovery scope for account recovery information
      recovery: [
        'recovery_enabled',
        'recovery_methods',
        'recovery_secondary_email',
      ],
      ...(this.configManager.getConfig().features.oidc.claims || {}),
    };

    // Dynamically add custom_identifiers scope claims from config
    const ciConfig =
      this.configManager.getConfig().security?.authentication
        ?.custom_identifiers;
    if (ciConfig?.enabled && Array.isArray(ciConfig.fields)) {
      const ciClaimNames = ciConfig.fields.map((f: any) => f.key);
      scopeToClaims['custom_identifiers'] = ciClaimNames;
    }

    const availableClaims = new Set<string>();

    // Always include 'sub' for openid scope
    if (scopes.includes('openid')) {
      availableClaims.add('sub');
    }

    // Add claims based on requested scopes (only if scope is configured)
    scopes.forEach(scopeName => {
      // Only process scopes that are configured in the OIDC configuration
      if (configuredScopes.includes(scopeName)) {
        const claimsForScope = scopeToClaims[scopeName];
        if (claimsForScope) {
          claimsForScope.forEach(claim => availableClaims.add(claim));
        }
      } else {
        this.logger.warn(
          `Scope '${scopeName}' is not configured and will be ignored`,
          {
            requestedScope: scopeName,
            configuredScopes,
          }
        );
      }
    });

    Object.keys(requestedClaims).forEach(claim => {
      availableClaims.add(claim);
    });

    rejected.forEach(claim => availableClaims.delete(claim));

    availableClaims.forEach(claim => {
      switch (claim) {
        case 'sub':
          break;
        case 'updated_at':
          result[claim] = user.updated_at || new Date();
          break;
        case 'address': {
          const address: any = {};
          if (user.street_address) address.street_address = user.street_address;
          if (user.city) address.locality = user.city;
          if (user.region) address.region = user.region;
          if (user.postal_code) address.postal_code = user.postal_code;
          if (user.country) address.country = user.country;

          // Only include address if it has at least one field
          if (Object.keys(address).length > 0) {
            result[claim] = address;
          }
          break;
        }
        case 'locality':
          result[claim] = user.city;
          break;
        case 'birthdate':
          if (user.birthdate) {
            result[claim] = user.birthdate.toISOString().split('T')[0];
          }
          break;
        case 'mfa_enabled':
          result[claim] = user.mfa?.enabled || false;
          break;
        case 'mfa_method': {
          if (user.mfa?.preferred_method) {
            result[claim] = user.mfa.preferred_method;
          } else {
            const methods = user.mfa?.methods;
            if (methods?.totp?.enabled) result[claim] = 'totp';
            else if (methods?.webauthn?.enabled) result[claim] = 'webauthn';
            else if (methods?.email?.enabled) result[claim] = 'email';
          }
          break;
        }
        case 'mfa_phone_number':
          // The claim is kept on the OIDC schema so existing client
          // integrations that ask for it don't error out, but the
          // underlying field is gone from the multi-method MFA model.
          // oidc-provider drops undefined values from the response.
          result[claim] = undefined;
          break;
        case 'recovery_enabled':
          result[claim] = user.recovery?.enabled || false;
          break;
        case 'recovery_methods':
          result[claim] = user.recovery?.methods || [];
          break;
        case 'recovery_secondary_email':
          result[claim] = user.recovery?.secondary_email?.email;
          break;
        case 'custom_identifier_1':
        case 'custom_identifier_2':
        case 'custom_identifier_3':
          break; // Never expose raw slot names — use configured key names
        default: {
          // Check if claim is a custom identifier key — map to slot value
          if (ciConfig?.enabled && Array.isArray(ciConfig.fields)) {
            const ciField = ciConfig.fields.find((f: any) => f.key === claim);
            if (ciField) {
              const slotValue =
                user[`custom_identifier_${ciField.slot}` as keyof typeof user];
              if (slotValue !== undefined && slotValue !== null) {
                result[claim] = slotValue;
              }
              break;
            }
          }
          // For all other claims, directly map from user object
          if (user[claim as keyof typeof user] !== undefined) {
            result[claim] = user[claim as keyof typeof user];
          }
        }
      }
    });

    if (use === 'id_token') {
      // For ID tokens, we might want to be more restrictive
      delete result.phone_number;
      delete result.phone_number_verified;
      delete result.password;
      delete result.password_hash_algo;
      delete result.reset_password_token;
      delete result.reset_password_expires;
      delete result.email_verification_token;
      delete result.email_verification_expires;
      delete result.blocked_from;
      delete result.mfa;
      delete result.mfa_enabled;
      delete result.mfa_method;
      delete result.mfa_phone_number;
      delete result.recovery_enabled;
      delete result.recovery_methods;
      delete result.recovery_secondary_email;
      delete result.dynamic_flags;
      delete result.dynamic_metadata;
      delete result.custom_identifier_1;
      delete result.custom_identifier_2;
      delete result.custom_identifier_3;
      delete result.username;
    }

    // For userinfo endpoint, we can be more permissive but still respect scope
    if (use === 'userinfo') {
      // Additional filtering based on scope for userinfo
      if (!scopes.includes('phone')) {
        delete result.phone_number;
        delete result.phone_number_verified;
      }

      if (!scopes.includes('address')) {
        delete result.address;
      }

      if (!scopes.includes('roles')) {
        delete result.roles;
      }

      if (!scopes.includes('preferences')) {
        delete result.prefered_contact;
        delete result.prefered_dark_theme;
        delete result.theme;
      }

      if (!scopes.includes('professional')) {
        delete result.auth_provider;
      }

      if (!scopes.includes('account')) {
        delete result.account_enabled;
        delete result.account_is_anonymized;
        delete result.register_with;
        delete result.last_login;
        delete result.blocked_from;
        delete result.username;
      }

      if (!scopes.includes('mfa')) {
        delete result.mfa_enabled;
        delete result.mfa_method;
        delete result.mfa_phone_number;
      }

      if (!scopes.includes('recovery')) {
        delete result.recovery_enabled;
        delete result.recovery_methods;
        delete result.recovery_secondary_email;
      }

      if (!scopes.includes('custom_identifiers')) {
        // Strip custom identifier claims (exposed under configured key names)
        if (ciConfig?.enabled && Array.isArray(ciConfig.fields)) {
          for (const f of ciConfig.fields) {
            delete result[f.key];
          }
        }
      }

      // Always strip internal slot names from userinfo
      delete result.custom_identifier_1;
      delete result.custom_identifier_2;
      delete result.custom_identifier_3;
    }

    Object.keys(result).forEach(key => {
      if (result[key] === undefined || result[key] === null) {
        delete result[key];
      }
    });

    this.logger.debug(`Claims returned for user ${this.accountId}:`, {
      use,
      scope,
      claimsCount: Object.keys(result).length,
      claims: Object.keys(result),
    });

    return result;
  }

  /**
   * Method to find and create an Account instance for a given user ID.
   * Used by the OIDC Provider to look up accounts during authentication flows.
   * This method is called when the provider needs to find an account by its ID.
   *
   * @param {Object} ctx - The request context
   * @param {string} id - The username to look up
   * @param {Object} token - The token object (if any)
   * @returns {Promise<Account|undefined>} Account instance if found, undefined otherwise
   */
  async findAccount(
    _ctx: KoaContextWithOIDC,
    id: string,
    _token?: any
  ): Promise<Account | undefined> {
    const user = await this.userService.findByUsername(id);
    if (!user) {
      this.logger.error(`User not found at findAccount Account method: ${id}`);
      return undefined;
    }
    return new Account(
      this.logger,
      this.userService,
      this.configManager,
      user.username
    );
  }
}

/**
 * Factory function to create Account instances with DI
 * This is used by the OIDC Provider configuration
 */
export const createAccountFactory = (
  logger: ILogger,
  userService: IUserService,
  configManager: IConfigManager
) => {
  return async (
    _ctx: KoaContextWithOIDC,
    id: string,
    _token?: any
  ): Promise<Account | undefined> => {
    const user = await userService.findByUsername(id);
    if (!user) {
      logger.error(`User not found at findAccount Account method: ${id}`);
      return undefined;
    }
    return new Account(logger, userService, configManager, user.username);
  };
};

export default Account;
