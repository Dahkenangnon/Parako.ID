import { Request } from 'express';
import { injectable, inject, unmanaged } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type {
  IBaseSocialLogin,
  SocialLoginResult,
} from '../di/interfaces/base-social-login.interface.js';
import { TYPES } from '../di/types.js';
import {
  type ISocialIntegration,
  type SocialProvider,
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import { capitalizeFirstLetter } from '../utils/misc.js';
import { ensureDecrypted } from '../utils/encryption.js';
import { buildExternalApplicationUrl } from '../utils/external-application-url.js';
import { getUserFriendlyError } from './social-login-errors.js';

@injectable()
export abstract class BaseSocialLogin implements IBaseSocialLogin {
  protected readonly provider: SocialProvider;
  protected isInitialized = false;

  constructor(
    @inject(TYPES.Logger) protected logger: ILogger,
    @inject(TYPES.ConfigManager) protected configManager: IConfigManager,
    @inject(TYPES.SessionManager) protected sessionManager: ISessionManager,
    @inject(TYPES.UserService) protected userService: IUserService,
    @inject(TYPES.SocialIntegrationService)
    protected socialIntegrationService: ISocialIntegrationService,
    @unmanaged() provider: SocialProvider
  ) {
    this.provider = provider;
  }

  protected getSocialBehaviorConfig() {
    const config = this.configManager.getConfig();
    return {
      existingUserNoIntegration:
        config.features.social_providers.behavior.existing_user_no_integration,
      noUserAccount: config.features.social_providers.behavior.no_user_account,
      missingContactInfo:
        config.features.social_providers.behavior.missing_contact_info,
      requirePasswordOnRegistration:
        config.features.social_providers.behavior
          .require_password_on_registration,
      allowMultipleProviders:
        config.features.social_providers.behavior.options
          .allow_multiple_providers,
      autoVerifyEmail:
        config.features.social_providers.behavior.options.auto_verify_email,
      showHelpfulErrors:
        config.features.social_providers.behavior.options.show_helpful_errors,
      maxProvidersPerUser:
        config.features.social_providers.behavior.options
          .max_providers_per_user,
    };
  }

  public abstract getAuthorizationUrl(req: Request): Promise<string>;

  public abstract handleCallback(req: Request): Promise<SocialLoginResult>;

  public async linkToUser(
    userId: string,
    providerData: ProviderUserData,
    tokens: TokenData
  ): Promise<ISocialIntegration> {
    // Check if this integration is already linked to another user (active only)
    const existingIntegrationByProvider =
      await this.socialIntegrationService.findByProviderSub(
        providerData.sub,
        this.provider
      );

    if (existingIntegrationByProvider) {
      if (existingIntegrationByProvider.user_id === userId) {
        throw new Error(`User already has a ${this.provider} integration`);
      }
      throw new Error(
        `This ${this.provider} account is already linked to another user`
      );
    }

    // Check if user already has this integration (active only)
    const existingUserIntegration =
      await this.socialIntegrationService.findByUserAndMethod(
        userId,
        this.provider
      );
    if (existingUserIntegration) {
      throw new Error(`User already has a ${this.provider} integration`);
    }

    const deactivatedIntegration =
      await this.socialIntegrationService.findByUserAndMethodIncludingInactive(
        userId,
        this.provider
      );
    if (deactivatedIntegration) {
      // Reactivate the existing integration with new data
      await this.socialIntegrationService.updateIntegrationProviderData(
        deactivatedIntegration._id as string,
        providerData
      );
      await this.socialIntegrationService.updateIntegrationTokens(
        deactivatedIntegration._id as string,
        tokens
      );
      await this.socialIntegrationService.activateIntegration(
        deactivatedIntegration._id as string
      );

      this.logger.info(`Reactivated ${this.provider} integration for user`, {
        userId,
        provider: this.provider,
        integrationId: deactivatedIntegration._id,
      });

      return deactivatedIntegration;
    }

    return this.socialIntegrationService.createIntegration(
      userId,
      this.provider,
      providerData,
      tokens
    );
  }

  /** Attempts provider-side token revocation before unlinking locally. */
  public async unlinkFromUser(userId: string): Promise<void> {
    const userIntegration =
      await this.socialIntegrationService.findByUserAndMethod(
        userId,
        this.provider
      );
    if (!userIntegration) {
      throw new Error(`No ${this.provider} integration found for user`);
    }

    // This is a best-effort operation - we proceed with unlink even if revocation fails
    if (userIntegration.tokens?.access_token) {
      try {
        const decryptedAccessToken = ensureDecrypted(
          userIntegration.tokens.access_token
        );
        await this.revokeToken(decryptedAccessToken);
        this.logger.info(`Revoked ${this.provider} token for user`, {
          userId,
          provider: this.provider,
        });
      } catch (revokeError) {
        this.logger.warn(`Failed to revoke ${this.provider} token`, {
          userId,
          provider: this.provider,
          error: (revokeError as Error).message,
        });
      }
    }

    await this.socialIntegrationService.deactivateIntegration(
      userIntegration._id as string
    );
    this.logger.info(`Unlinked ${this.provider} integration from user`, {
      userId,
      provider: this.provider,
    });
  }

  /** Providers without a revocation endpoint intentionally inherit this no-op. */
  protected async revokeToken(_accessToken: string): Promise<void> {
    // Default: no-op, providers that support revocation should override
    this.logger.debug(`Token revocation not implemented for ${this.provider}`, {
      provider: this.provider,
    });
  }

  public async getSocialIntegrations(
    userId: string
  ): Promise<ISocialIntegration[]> {
    return this.socialIntegrationService.findByUser(userId);
  }

  /**
   * Complete a Tier 1 (external) social auth flow with pre-fetched user data.
   *
   * Public wrapper around handleUserIntegration() for use by the Tier 1
   * completion handler, which performs the token exchange and profile fetch
   * outside the provider class.
   */
  public async completeExternalAuth(
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult> {
    return this.handleUserIntegration(providerData, tokens, req);
  }

  protected abstract mapProviderUserData(userInfo: any): ProviderUserData;

  protected abstract mapTokenData(tokenSet: any): TokenData;

  protected async handleUserIntegration(
    mappedProviderData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult> {
    const config = this.getSocialBehaviorConfig();

    const socialRegister =
      this.sessionManager.get<Record<string, any>>(req, 'socialRegister') || {};
    const isRegistration =
      socialRegister[req.params?.provider]?.intent === 'register';

    // Contact claims are needed only when creating or linking a local account.
    // A returning provider subject is already bound to a local user whose
    // contact policy was enforced when the integration was created. Resolve
    // that binding before applying missing-contact registration policy because
    // providers may legitimately omit email and phone claims on later logins.
    const existingIntegration =
      await this.socialIntegrationService.findByProviderSub(
        mappedProviderData.sub,
        this.provider
      );
    const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);

    if (existingIntegration) {
      if (
        authenticatedUsers?.active &&
        existingIntegration.user_id !== authenticatedUsers.active.id
      ) {
        return {
          success: false,
          error: `This ${this.provider} account is already linked to another user`,
        };
      }

      const existingUser = await this.userService.findById(
        existingIntegration.user_id
      );
      if (!existingUser) {
        this.logger.error(
          `User not found for existing ${this.provider} integration`,
          {
            provider: this.provider,
            integrationId: existingIntegration._id,
            userId: existingIntegration.user_id,
          }
        );
        return {
          success: false,
          error: 'User not found for existing integration',
        };
      }

      await this.socialIntegrationService.updateIntegrationProviderData(
        existingIntegration._id as string,
        mappedProviderData
      );
      await this.socialIntegrationService.updateIntegrationTokens(
        existingIntegration._id as string,
        tokens
      );
      await this.socialIntegrationService.markIntegrationAsUsed(
        existingIntegration._id as string
      );

      return {
        success: true,
        user: existingUser,
        integration: existingIntegration,
      };
    }

    if (!mappedProviderData.email && !mappedProviderData.phone_number) {
      if (config.missingContactInfo === 'redirect_to_form' && isRegistration) {
        return {
          success: false,
          requiresLinking: true,
          error: `Please provide your contact information to complete the ${capitalizeFirstLetter(this.provider)} registration process`,
          providerData: mappedProviderData,
          tokens,
        };
      }

      return {
        success: false,
        error: `${capitalizeFirstLetter(this.provider)} account must have an email address or phone number to sign in`,
      };
    }

    if (authenticatedUsers?.active) {
      const currentlyLoggedInUser = authenticatedUsers.active;

      // Check if this integration is already linked to another user (active only)
      const existingUserIntegration =
        await this.socialIntegrationService.findByUserAndMethod(
          currentlyLoggedInUser.id,
          this.provider
        );

      if (existingUserIntegration) {
        return {
          success: false,
          error: `This ${this.provider} account is already linked to your account`,
        };
      }

      const deactivatedIntegration =
        await this.socialIntegrationService.findByUserAndMethodIncludingInactive(
          currentlyLoggedInUser.id,
          this.provider
        );

      if (deactivatedIntegration) {
        const user = await this.userService.findById(currentlyLoggedInUser.id);
        if (!user) {
          this.logger.error(
            `User not found while reactivating ${this.provider} integration`,
            {
              provider: this.provider,
              integrationId: deactivatedIntegration._id,
              userId: currentlyLoggedInUser.id,
            }
          );
          return {
            success: false,
            error: 'User not found for existing integration',
          };
        }

        // Reactivate the existing integration with new data
        await this.socialIntegrationService.updateIntegrationProviderData(
          deactivatedIntegration._id as string,
          mappedProviderData
        );
        await this.socialIntegrationService.updateIntegrationTokens(
          deactivatedIntegration._id as string,
          tokens
        );
        await this.socialIntegrationService.activateIntegration(
          deactivatedIntegration._id as string
        );

        this.logger.info(
          `Reactivated ${this.provider} integration for user during linking`,
          {
            userId: currentlyLoggedInUser.id,
            provider: this.provider,
            integrationId: deactivatedIntegration._id,
          }
        );

        return {
          success: true,
          user,
          integration: deactivatedIntegration,
        };
      }

      const userIntegrations = await this.socialIntegrationService.findByUser(
        currentlyLoggedInUser.id
      );
      if (!config.allowMultipleProviders && userIntegrations.length > 0) {
        return {
          success: false,
          error: 'Multiple social providers are not allowed for this account',
        };
      }

      if (userIntegrations.length >= config.maxProvidersPerUser) {
        return {
          success: false,
          error: `Maximum number of social providers (${config.maxProvidersPerUser}) reached for this account`,
        };
      }

      // Use try-catch with compensating action to prevent orphaned integrations
      let newIntegration;
      try {
        newIntegration = await this.socialIntegrationService.createIntegration(
          currentlyLoggedInUser.id,
          this.provider,
          mappedProviderData,
          tokens
        );

        const user = await this.userService.findById(currentlyLoggedInUser.id);
        if (!user) {
          throw new Error('User not found after integration creation');
        }

        return {
          success: true,
          user,
          integration: newIntegration,
        };
      } catch (linkError) {
        // Compensating action: if integration was created but subsequent operation failed,
        // deactivate it to prevent orphaned/inconsistent data
        if (newIntegration?._id) {
          try {
            await this.socialIntegrationService.deactivateIntegration(
              newIntegration._id as string
            );
            this.logger.warn(
              'Deactivated orphaned integration after link failure',
              {
                provider: this.provider,
                integrationId: newIntegration._id,
                userId: currentlyLoggedInUser.id,
              }
            );
          } catch (deactivateError) {
            this.logger.error(deactivateError as Error, {
              context: 'failed_to_deactivate_orphaned_integration',
              provider: this.provider,
              integrationId: newIntegration._id,
            });
          }
        }
        throw linkError;
      }
    }

    if (mappedProviderData.email) {
      const existingUserByEmail = await this.userService.findByEmail(
        mappedProviderData.email
      );
      if (existingUserByEmail) {
        if (config.existingUserNoIntegration === 'auto_link') {
          // Security: Only auto-link if email is verified by provider
          // This prevents email takeover attacks where someone creates
          // a social account with an unverified email matching an existing user
          if (mappedProviderData.email_verified !== true) {
            this.logger.warn(
              'Auto-link blocked: email not verified by provider',
              {
                provider: this.provider,
                email: mappedProviderData.email,
                email_verified: mappedProviderData.email_verified,
              }
            );
            const errorMessage = config.showHelpfulErrors
              ? `Your ${capitalizeFirstLetter(this.provider)} email must be verified before we can link it to your existing account. Please verify your email with ${capitalizeFirstLetter(this.provider)} and try again.`
              : `Email verification required. Please verify your email and try again.`;

            return {
              success: false,
              requiresLinking: true,
              error: errorMessage,
              providerData: mappedProviderData,
              tokens,
            };
          }

          // Automatically create integration and log user in
          // The user is already fetched, so main risk is integration creation failure
          // which is handled atomically by the service
          const newIntegration =
            await this.socialIntegrationService.createIntegration(
              existingUserByEmail._id as string,
              this.provider,
              mappedProviderData,
              tokens
            );

          this.logger.info('Auto-linked social provider to existing user', {
            provider: this.provider,
            userId: existingUserByEmail._id,
            integrationId: newIntegration._id,
          });

          return {
            success: true,
            user: existingUserByEmail,
            integration: newIntegration,
          };
        } else {
          const errorMessage = config.showHelpfulErrors
            ? `An account with email ${mappedProviderData.email} already exists. Please log in first, then link your ${capitalizeFirstLetter(this.provider)} account from your account settings.`
            : `Account already exists with this email address.`;

          return {
            success: false,
            requiresLinking: true,
            error: errorMessage,
            providerData: mappedProviderData,
            tokens,
          };
        }
      }
    }

    // No existing integration and no logged-in user - check if registration is allowed
    if (config.noUserAccount === 'require_existing_account') {
      const errorMessage = config.showHelpfulErrors
        ? `No account found with this ${capitalizeFirstLetter(this.provider)} account. Please create an account first, then link your ${capitalizeFirstLetter(this.provider)} account from your account settings.`
        : `No account found. Please create an account first.`;

      return {
        success: false,
        requiresLinking: true,
        error: errorMessage,
        providerData: mappedProviderData,
        tokens,
      };
    }

    return {
      success: false,
      requiresLinking: true,
      error: `No account found. Registration will be completed.`,
      existingIntegration: undefined,
      providerData: mappedProviderData,
      tokens,
    };
  }

  protected verifyOAuthState(req: Request): {
    isValid: boolean;
    error?: string;
    sessionData?: any;
  } {
    const { code, error, state } = req.query;
    const socialLoginSession = this.sessionManager.get<Record<string, any>>(
      req,
      'socialLogin',
      {}
    );
    const providerSessionData = socialLoginSession?.[this.provider];

    const hasProviderError = typeof error === 'string' && error.length > 0;
    if ((!code && !hasProviderError) || !state || !providerSessionData) {
      this.logger.error(`Invalid callback parameters for ${this.provider}`, {
        provider: this.provider,
        hasCode: !!code,
        hasState: !!state,
        hasSessionData: !!providerSessionData,
      });
      return {
        isValid: false,
        error:
          'Invalid callback parameters - missing code, state, or session data',
      };
    }

    // Verify OAuth state parameter to prevent CSRF attacks
    if (state !== providerSessionData.state) {
      this.logger.error(`OAuth state mismatch for ${this.provider}`, {
        provider: this.provider,
        // Don't log actual state values - just indicate mismatch
        stateMatch: false,
        hasReceivedState: !!state,
        hasExpectedState: !!providerSessionData.state,
      });
      return {
        isValid: false,
        error: 'Invalid OAuth state parameter - possible CSRF attack',
      };
    }

    return {
      isValid: true,
      sessionData: providerSessionData,
    };
  }

  /**
   * Translate an OAuth authorization error only after verifyOAuthState() has
   * authenticated the callback to the browser session. This preserves useful
   * provider feedback without trusting attacker-controlled callback text.
   */
  protected getVerifiedOAuthCallbackError(req: Request): string | undefined {
    const { error, error_description: description } = req.query;
    if (typeof error !== 'string' || error.length === 0) {
      return undefined;
    }

    const technicalError =
      typeof description === 'string' && description.length > 0
        ? `${error}: ${description}`
        : error;
    return getUserFriendlyError(this.provider, technicalError);
  }

  protected getDefaultProviderConfig<T>(provider: SocialProvider): T {
    const config = this.configManager.getConfig();
    const featuresSocialProviders = config.features.social_providers;
    const rawConfig =
      featuresSocialProviders[provider as keyof typeof featuresSocialProviders];

    // Use configuration directly as defined in schema (underscore-based)
    const providerConfig = {
      ...rawConfig,
      // Tenant-owned provider credentials use a tenant-local callback so the
      // browser returns with the tenant's session cookie and OAuth state.
      redirect_uri: buildExternalApplicationUrl(
        config,
        `/auth/social/${provider}/callback`
      ),
    };

    return providerConfig as T;
  }

  /** Removes OAuth state after both success and failure so it cannot be replayed. */
  protected cleanupSocialLoginSession(req: Request): void {
    try {
      const socialLogin = this.sessionManager.get<Record<string, any>>(
        req,
        'socialLogin',
        {}
      );
      if (socialLogin?.[this.provider]) {
        delete socialLogin[this.provider];
        this.sessionManager.set(req, 'socialLogin', socialLogin);
        this.logger.debug('Cleaned up social login session data', {
          provider: this.provider,
        });
      }
    } catch (err) {
      this.logger.debug('Failed to cleanup social login session', {
        provider: this.provider,
        error: (err as Error).message,
      });
    }
  }

  // protected buildProviderConfig<T>(
  //   provider: SocialProvider,
  //   customConfig?: Partial<T>
  // ): T {

  //   // Merge default config with custom overrides (if provided)
  // }
}
