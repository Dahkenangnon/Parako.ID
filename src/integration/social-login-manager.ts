import { injectable, inject } from 'inversify';
import { Request } from 'express';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISocialLoginManager } from '../di/interfaces/social-login-manager.interface.js';
import {
  type IBaseSocialLogin,
  type SocialLoginResult,
} from '../di/interfaces/base-social-login.interface.js';
import { TYPES } from '../di/types.js';
import { findInvalidSocialProviderCredential } from '../config/social-providers.js';
import {
  type SocialProvider,
  type ISocialIntegration,
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';

@injectable()
export class SocialLoginManager implements ISocialLoginManager {
  private providers: Map<SocialProvider, IBaseSocialLogin> = new Map();

  constructor(
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.GitHubSocialLogin)
    private githubSocialLogin: IBaseSocialLogin,
    @inject(TYPES.GoogleSocialLogin)
    private googleSocialLogin: IBaseSocialLogin,
    @inject(TYPES.MicrosoftSocialLogin)
    private microsoftSocialLogin: IBaseSocialLogin,
    @inject(TYPES.LinkedInSocialLogin)
    private linkedinSocialLogin: IBaseSocialLogin,
    @inject(TYPES.FacebookSocialLogin)
    private facebookSocialLogin: IBaseSocialLogin
  ) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    try {
      const config = this.configManager.getConfig();
      const enabledProviders = config.features.social_providers
        .enabled as string[];

      if (
        enabledProviders.includes('google') &&
        this.isProviderConfigured('google')
      ) {
        this.providers.set('google', this.googleSocialLogin);
        this.logger.info(
          'Google social login provider initialized (OpenID Connect)'
        );
      }

      if (
        enabledProviders.includes('github') &&
        this.isProviderConfigured('github')
      ) {
        this.providers.set('github', this.githubSocialLogin);
        this.logger.info('GitHub social login provider initialized');
      }

      if (
        enabledProviders.includes('microsoft') &&
        this.isProviderConfigured('microsoft')
      ) {
        this.providers.set('microsoft', this.microsoftSocialLogin);
        this.logger.info(
          'Microsoft social login provider initialized (OpenID Connect)'
        );
      }

      if (
        enabledProviders.includes('linkedin') &&
        this.isProviderConfigured('linkedin')
      ) {
        this.providers.set('linkedin', this.linkedinSocialLogin);
        this.logger.info('LinkedIn social login provider initialized (OAuth2)');
      }

      if (
        enabledProviders.includes('facebook') &&
        this.isProviderConfigured('facebook')
      ) {
        this.providers.set('facebook', this.facebookSocialLogin);
        this.logger.info('Facebook social login provider initialized (OAuth2)');
      }

      this.logger.info(
        `Social login manager initialized with ${this.providers.size} providers`,
        {
          providers: Array.from(this.providers.keys()),
          enabledProviders,
        }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_login_manager_initialization_failed',
      });
    }
  }

  private isProviderConfigured(provider: SocialProvider): boolean {
    try {
      const config = this.configManager.getConfig();
      const featuresSocialProviders = config.features.social_providers;
      const providerConfig = featuresSocialProviders[
        provider as keyof typeof featuresSocialProviders
      ] as {
        client_id?: string;
        client_secret?: string;
      };
      return (
        findInvalidSocialProviderCredential(provider, providerConfig) === null
      );
    } catch (error) {
      this.logger.warn(
        `Failed to check configuration for provider ${provider}`,
        {
          provider,
          error: (error as Error).message,
        }
      );
      return false;
    }
  }

  public getProvider(provider: SocialProvider): IBaseSocialLogin | undefined {
    return this.providers.get(provider);
  }

  public getAvailableProviders(): SocialProvider[] {
    return Array.from(this.providers.keys());
  }

  public isProviderAvailable(provider: SocialProvider): boolean {
    return this.providers.has(provider);
  }

  public async getAuthorizationUrl(
    provider: SocialProvider,
    req: Request
  ): Promise<string> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} is not available`);
    }

    return providerInstance.getAuthorizationUrl(req);
  }

  public async handleCallback(
    provider: SocialProvider,
    req: Request
  ): Promise<SocialLoginResult> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      return {
        success: false,
        error: `Provider ${provider} is not available`,
      };
    }

    return providerInstance.handleCallback(req);
  }

  public async linkToUser(
    provider: SocialProvider,
    userId: string,
    providerData: ProviderUserData,
    tokens: TokenData
  ): Promise<ISocialIntegration> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} is not available`);
    }

    return providerInstance.linkToUser(userId, providerData, tokens);
  }

  public async unlinkFromUser(
    provider: SocialProvider,
    userId: string
  ): Promise<void> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} is not available`);
    }

    return providerInstance.unlinkFromUser(userId);
  }

  public async getUserIntegrations(
    provider: SocialProvider,
    userId: string
  ): Promise<ISocialIntegration[]> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} is not available`);
    }

    return providerInstance.getSocialIntegrations(userId);
  }

  /**
   * Complete a Tier 1 social auth flow with pre-fetched user data.
   * Delegates to the provider's completeExternalAuth() method which
   * calls handleUserIntegration() internally.
   */
  public async completeTier1Flow(
    provider: SocialProvider,
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult> {
    const providerInstance = this.getProvider(provider);
    if (!providerInstance) {
      return {
        success: false,
        error: `Provider ${provider} is not available`,
      };
    }

    return providerInstance.completeExternalAuth(providerData, tokens, req);
  }
}
