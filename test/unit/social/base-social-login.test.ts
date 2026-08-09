import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import { BaseSocialLogin } from '../../../src/integration/base-social-login.js';
import type {
  ProviderUserData,
  TokenData,
} from '../../../src/types/social-integration.js';

class TestSocialLogin extends BaseSocialLogin {
  public readonly revokeTokenMock = vi.fn(
    async (_accessToken: string): Promise<void> => undefined
  );

  public async getAuthorizationUrl(_req: Request): Promise<string> {
    return 'https://provider.example.test/authorize';
  }

  public async handleCallback(_req: Request) {
    return { success: false };
  }

  public runUserIntegration(
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ) {
    return this.handleUserIntegration(providerData, tokens, req);
  }

  public runVerifyOAuthState(req: Request) {
    return this.verifyOAuthState(req);
  }

  public runGetDefaultProviderConfig<T>() {
    return this.getDefaultProviderConfig<T>('google');
  }

  public runCleanupSocialLoginSession(req: Request) {
    return this.cleanupSocialLoginSession(req);
  }

  public runDefaultRevokeToken(accessToken: string) {
    return super.revokeToken(accessToken);
  }

  protected override revokeToken(accessToken: string): Promise<void> {
    return this.revokeTokenMock(accessToken);
  }

  protected mapProviderUserData(userInfo: ProviderUserData): ProviderUserData {
    return userInfo;
  }

  protected mapTokenData(tokenSet: TokenData): TokenData {
    return tokenSet;
  }
}

function createDependencies(allowMultipleProviders = true) {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const config = {
    deployment: { url: 'https://parako.example.test' },
    features: {
      social_providers: {
        behavior: {
          existing_user_no_integration: 'require_manual_link',
          no_user_account: 'allow_registration',
          missing_contact_info: 'redirect_to_form',
          require_password_on_registration: false,
          options: {
            allow_multiple_providers: allowMultipleProviders,
            auto_verify_email: true,
            show_helpful_errors: true,
            max_providers_per_user: 5,
          },
        },
        google: {
          client_id: 'google-id',
          client_secret: 'google-secret',
        },
      },
    },
  };
  const configManager = {
    getConfig: vi.fn().mockReturnValue(config),
  };
  const sessionManager = {
    get: vi.fn().mockReturnValue({}),
    getAuthenticatedUsers: vi.fn().mockReturnValue({
      active: { id: 'user-1' },
    }),
    set: vi.fn(),
  };
  const userService = {
    findByEmail: vi.fn(),
    findById: vi.fn().mockResolvedValue({ _id: 'user-1' }),
  };
  const socialIntegrationService = {
    activateIntegration: vi.fn(),
    createIntegration: vi.fn().mockResolvedValue({
      _id: 'google-integration',
      user_id: 'user-1',
      provider: 'google',
    }),
    deactivateIntegration: vi.fn(),
    findByProviderSub: vi.fn().mockResolvedValue(null),
    findByUser: vi.fn().mockResolvedValue([]),
    findByUserAndMethod: vi.fn().mockResolvedValue(null),
    findByUserAndMethodIncludingInactive: vi.fn().mockResolvedValue(null),
    markIntegrationAsUsed: vi.fn(),
    updateIntegrationProviderData: vi.fn(),
    updateIntegrationTokens: vi.fn(),
  };

  return {
    config,
    logger,
    login: new TestSocialLogin(
      logger as unknown as ILogger,
      configManager as unknown as IConfigManager,
      sessionManager as unknown as ISessionManager,
      userService as unknown as IUserService,
      socialIntegrationService as unknown as ISocialIntegrationService,
      'google'
    ),
    sessionManager,
    socialIntegrationService,
    userService,
  };
}

describe('BaseSocialLogin', () => {
  it.each([
    {
      policy: 'reject_login',
      registration: true,
      expected: {
        success: false,
        error:
          'Google account must have an email address or phone number to sign in',
      },
    },
    {
      policy: 'redirect_to_form',
      registration: true,
      expected: {
        success: false,
        requiresLinking: true,
        error:
          'Please provide your contact information to complete the Google registration process',
      },
    },
    {
      policy: 'redirect_to_form',
      registration: false,
      expected: {
        success: false,
        error:
          'Google account must have an email address or phone number to sign in',
      },
    },
  ] as const)(
    'applies $policy to a missing-contact social flow (registration=$registration)',
    async ({ expected, policy, registration }) => {
      const { config, login, sessionManager, socialIntegrationService } =
        createDependencies();
      const providerData = { sub: 'google-subject' } as ProviderUserData;
      const tokens = { access_token: 'access-token' } as TokenData;
      config.features.social_providers.behavior.missing_contact_info = policy;
      sessionManager.get.mockReturnValue(
        registration ? { google: { intent: 'register' } } : {}
      );

      await expect(
        login.runUserIntegration(providerData, tokens, {
          params: { provider: 'google' },
        } as unknown as Request)
      ).resolves.toEqual(
        registration && policy === 'redirect_to_form'
          ? { ...expected, providerData, tokens }
          : expected
      );
      expect(socialIntegrationService.findByProviderSub).not.toHaveBeenCalled();
    }
  );

  it('fails safely when an active integration references a missing user', async () => {
    const { logger, login, socialIntegrationService, userService } =
      createDependencies();
    const existingIntegration = {
      _id: 'google-integration',
      user_id: 'deleted-user',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      is_active: true,
    };
    socialIntegrationService.findByProviderSub.mockResolvedValue(
      existingIntegration
    );
    userService.findById.mockResolvedValue(null);

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).resolves.toEqual({
      success: false,
      error: 'User not found for existing integration',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'User not found for existing google integration',
      {
        provider: 'google',
        integrationId: existingIntegration._id,
        userId: existingIntegration.user_id,
      }
    );
    expect(
      socialIntegrationService.updateIntegrationTokens
    ).not.toHaveBeenCalled();
    expect(
      socialIntegrationService.markIntegrationAsUsed
    ).not.toHaveBeenCalled();
  });

  it('refreshes and reuses a matching active integration', async () => {
    const { login, socialIntegrationService, userService } =
      createDependencies();
    const providerData = {
      sub: 'google-subject',
      email: 'updated@example.test',
    } as ProviderUserData;
    const tokens = { access_token: 'updated-access-token' } as TokenData;
    const existingIntegration = {
      _id: 'google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: providerData.sub,
      provider_data: providerData,
      is_active: true,
    };
    const user = { _id: 'user-1', email: 'user@example.test' };
    socialIntegrationService.findByProviderSub.mockResolvedValue(
      existingIntegration
    );
    userService.findById.mockResolvedValue(user);

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toEqual({
      success: true,
      user,
      integration: existingIntegration,
    });
    expect(
      socialIntegrationService.updateIntegrationProviderData
    ).toHaveBeenCalledWith(existingIntegration._id, providerData);
    expect(
      socialIntegrationService.updateIntegrationTokens
    ).toHaveBeenCalledWith(existingIntegration._id, tokens);
    expect(socialIntegrationService.markIntegrationAsUsed).toHaveBeenCalledWith(
      existingIntegration._id
    );
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('returns a structured conflict when the authenticated user already has the provider', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByUserAndMethod.mockResolvedValue({
      _id: 'google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'another-google-subject',
      provider_data: { sub: 'another-google-subject' },
      is_active: true,
    });

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).resolves.toEqual({
      success: false,
      error: 'This google account is already linked to your account',
    });
    expect(
      socialIntegrationService.findByUserAndMethodIncludingInactive
    ).not.toHaveBeenCalled();
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('reactivates an inactive provider for an existing authenticated user', async () => {
    const { logger, login, socialIntegrationService, userService } =
      createDependencies();
    const providerData = {
      sub: 'new-google-subject',
      email: 'user@example.test',
    } as ProviderUserData;
    const tokens = { access_token: 'new-access-token' } as TokenData;
    const inactiveIntegration = {
      _id: 'inactive-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'old-google-subject',
      provider_data: { sub: 'old-google-subject' },
      is_active: false,
    };
    const user = { _id: 'user-1', email: 'user@example.test' };
    socialIntegrationService.findByUserAndMethodIncludingInactive.mockResolvedValue(
      inactiveIntegration
    );
    userService.findById.mockResolvedValue(user);

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toEqual({
      success: true,
      user,
      integration: inactiveIntegration,
    });
    expect(
      socialIntegrationService.updateIntegrationProviderData
    ).toHaveBeenCalledWith(inactiveIntegration._id, providerData);
    expect(
      socialIntegrationService.updateIntegrationTokens
    ).toHaveBeenCalledWith(inactiveIntegration._id, tokens);
    expect(socialIntegrationService.activateIntegration).toHaveBeenCalledWith(
      inactiveIntegration._id
    );
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Reactivated google integration for user during linking',
      {
        userId: 'user-1',
        provider: 'google',
        integrationId: inactiveIntegration._id,
      }
    );
  });

  it('blocks authenticated linking at the configured provider limit', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByUser.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        _id: `integration-${index}`,
        user_id: 'user-1',
        method: 'github',
        provider_sub: `subject-${index}`,
        provider_data: { sub: `subject-${index}` },
        is_active: true,
      }))
    );

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).resolves.toEqual({
      success: false,
      error: 'Maximum number of social providers (5) reached for this account',
    });
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('preserves creation failures without compensating for a record that was never created', async () => {
    const { login, socialIntegrationService } = createDependencies();
    const createError = new Error('integration write failed');
    socialIntegrationService.createIntegration.mockRejectedValue(createError);

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).rejects.toBe(createError);
    expect(
      socialIntegrationService.deactivateIntegration
    ).not.toHaveBeenCalled();
  });

  it('deactivates a newly created integration when the user disappears', async () => {
    const { logger, login, socialIntegrationService, userService } =
      createDependencies();
    const createdIntegration = {
      _id: 'orphaned-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      is_active: true,
    };
    socialIntegrationService.createIntegration.mockResolvedValue(
      createdIntegration
    );
    userService.findById.mockResolvedValue(null);

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).rejects.toThrow('User not found after integration creation');
    expect(socialIntegrationService.deactivateIntegration).toHaveBeenCalledWith(
      createdIntegration._id
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Deactivated orphaned integration after link failure',
      {
        provider: 'google',
        integrationId: createdIntegration._id,
        userId: 'user-1',
      }
    );
  });

  it('preserves the link failure when orphan deactivation also fails', async () => {
    const { logger, login, socialIntegrationService, userService } =
      createDependencies();
    const createdIntegration = {
      _id: 'orphaned-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      is_active: true,
    };
    const deactivationError = new Error('database unavailable');
    socialIntegrationService.createIntegration.mockResolvedValue(
      createdIntegration
    );
    socialIntegrationService.deactivateIntegration.mockRejectedValueOnce(
      deactivationError
    );
    userService.findById.mockResolvedValue(null);

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).rejects.toThrow('User not found after integration creation');
    expect(logger.error).toHaveBeenCalledWith(deactivationError, {
      context: 'failed_to_deactivate_orphaned_integration',
      provider: 'google',
      integrationId: createdIntegration._id,
    });
  });

  it.each([
    [
      true,
      'Your Google email must be verified before we can link it to your existing account. Please verify your email with Google and try again.',
    ],
    [
      false,
      'Email verification required. Please verify your email and try again.',
    ],
  ] as const)(
    'blocks auto-linking an unverified email (helpful errors=%s)',
    async (showHelpfulErrors, expectedError) => {
      const {
        config,
        logger,
        login,
        sessionManager,
        socialIntegrationService,
        userService,
      } = createDependencies();
      const providerData = {
        sub: 'google-subject',
        email: 'existing@example.test',
        email_verified: false,
      } as ProviderUserData;
      const tokens = { access_token: 'access-token' } as TokenData;
      config.features.social_providers.behavior.existing_user_no_integration =
        'auto_link';
      config.features.social_providers.behavior.options.show_helpful_errors =
        showHelpfulErrors;
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      userService.findByEmail.mockResolvedValue({
        _id: 'existing-user',
        email: providerData.email,
      });

      await expect(
        login.runUserIntegration(providerData, tokens, {
          params: { provider: 'google' },
        } as unknown as Request)
      ).resolves.toEqual({
        success: false,
        requiresLinking: true,
        error: expectedError,
        providerData,
        tokens,
      });
      expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Auto-link blocked: email not verified by provider',
        {
          provider: 'google',
          email: providerData.email,
          email_verified: false,
        }
      );
    }
  );

  it('auto-links a matched user only when the provider email is verified', async () => {
    const {
      config,
      logger,
      login,
      sessionManager,
      socialIntegrationService,
      userService,
    } = createDependencies();
    const providerData = {
      sub: 'google-subject',
      email: 'existing@example.test',
      email_verified: true,
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    const user = { _id: 'existing-user', email: providerData.email };
    const integration = {
      _id: 'auto-linked-integration',
      user_id: user._id,
      method: 'google',
      provider_sub: providerData.sub,
      provider_data: providerData,
      is_active: true,
    };
    config.features.social_providers.behavior.existing_user_no_integration =
      'auto_link';
    sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
    userService.findByEmail.mockResolvedValue(user);
    socialIntegrationService.createIntegration.mockResolvedValue(integration);

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toEqual({ success: true, user, integration });
    expect(socialIntegrationService.createIntegration).toHaveBeenCalledWith(
      user._id,
      'google',
      providerData,
      tokens
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Auto-linked social provider to existing user',
      {
        provider: 'google',
        userId: user._id,
        integrationId: integration._id,
      }
    );
  });

  it.each([
    [
      true,
      'An account with email existing@example.test already exists. Please log in first, then link your Google account from your account settings.',
    ],
    [false, 'Account already exists with this email address.'],
  ] as const)(
    'requires manual linking for a matched email (helpful errors=%s)',
    async (showHelpfulErrors, expectedError) => {
      const {
        config,
        login,
        sessionManager,
        socialIntegrationService,
        userService,
      } = createDependencies();
      const providerData = {
        sub: 'google-subject',
        email: 'existing@example.test',
        email_verified: true,
      } as ProviderUserData;
      const tokens = { access_token: 'access-token' } as TokenData;
      config.features.social_providers.behavior.options.show_helpful_errors =
        showHelpfulErrors;
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      userService.findByEmail.mockResolvedValue({
        _id: 'existing-user',
        email: providerData.email,
      });

      await expect(
        login.runUserIntegration(providerData, tokens, {
          params: { provider: 'google' },
        } as unknown as Request)
      ).resolves.toEqual({
        success: false,
        requiresLinking: true,
        error: expectedError,
        providerData,
        tokens,
      });
      expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      true,
      'No account found with this Google account. Please create an account first, then link your Google account from your account settings.',
    ],
    [false, 'No account found. Please create an account first.'],
  ] as const)(
    'requires an existing local account when configured (helpful errors=%s)',
    async (showHelpfulErrors, expectedError) => {
      const {
        config,
        login,
        sessionManager,
        socialIntegrationService,
        userService,
      } = createDependencies();
      const providerData = {
        sub: 'google-subject',
        email: 'new@example.test',
      } as ProviderUserData;
      const tokens = { access_token: 'access-token' } as TokenData;
      config.features.social_providers.behavior.no_user_account =
        'require_existing_account';
      config.features.social_providers.behavior.options.show_helpful_errors =
        showHelpfulErrors;
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        login.runUserIntegration(providerData, tokens, {
          params: { provider: 'google' },
        } as unknown as Request)
      ).resolves.toEqual({
        success: false,
        requiresLinking: true,
        error: expectedError,
        providerData,
        tokens,
      });
      expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
    }
  );

  it('hands a new phone-only identity to the registration flow', async () => {
    const { login, sessionManager, socialIntegrationService, userService } =
      createDependencies();
    const providerData = {
      sub: 'google-subject',
      phone_number: '+22901020304',
      phone_number_verified: true,
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toEqual({
      success: false,
      requiresLinking: true,
      error: 'No account found. Registration will be completed.',
      existingIntegration: undefined,
      providerData,
      tokens,
    });
    expect(userService.findByEmail).not.toHaveBeenCalled();
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('handles an absent social-registration session as an empty session', async () => {
    const { login, sessionManager } = createDependencies();
    const providerData = {
      sub: 'google-subject',
      phone_number: '+22901020304',
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await expect(
      login.runUserIntegration(providerData, tokens, {} as Request)
    ).resolves.toMatchObject({
      success: false,
      requiresLinking: true,
      providerData,
      tokens,
    });
  });

  it('returns the user social integrations from the integration service', async () => {
    const { login, socialIntegrationService } = createDependencies();
    const integrations = [
      {
        _id: 'google-integration',
        user_id: 'user-1',
        provider: 'google',
      },
    ];
    socialIntegrationService.findByUser.mockResolvedValue(integrations);

    await expect(login.getSocialIntegrations('user-1')).resolves.toBe(
      integrations
    );
    expect(socialIntegrationService.findByUser).toHaveBeenCalledWith('user-1');
  });

  it('completes external authentication through the shared integration flow', async () => {
    const { login, sessionManager } = createDependencies();
    const providerData = {
      sub: 'google-subject',
      phone_number: '+22901020304',
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    const req = { params: { provider: 'google' } } as unknown as Request;
    sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await expect(
      login.completeExternalAuth(providerData, tokens, req)
    ).resolves.toEqual({
      success: false,
      requiresLinking: true,
      error: 'No account found. Registration will be completed.',
      existingIntegration: undefined,
      providerData,
      tokens,
    });
    expect(sessionManager.get).toHaveBeenCalledWith(req, 'socialRegister');
  });

  it('rejects unlinking when the user has no provider integration', async () => {
    const { login, socialIntegrationService } = createDependencies();

    await expect(login.unlinkFromUser('user-1')).rejects.toThrow(
      'No google integration found for user'
    );
    expect(
      socialIntegrationService.deactivateIntegration
    ).not.toHaveBeenCalled();
  });

  it('revokes the access token before deactivating an integration', async () => {
    const { logger, login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByUserAndMethod.mockResolvedValue({
      _id: 'google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: { access_token: 'plain-access-token' },
      is_active: true,
    });

    await expect(login.unlinkFromUser('user-1')).resolves.toBeUndefined();
    expect(login.revokeTokenMock).toHaveBeenCalledWith('plain-access-token');
    expect(login.revokeTokenMock).toHaveBeenCalledBefore(
      socialIntegrationService.deactivateIntegration
    );
    expect(socialIntegrationService.deactivateIntegration).toHaveBeenCalledWith(
      'google-integration'
    );
    expect(logger.info).toHaveBeenCalledWith('Revoked google token for user', {
      userId: 'user-1',
      provider: 'google',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Unlinked google integration from user',
      { userId: 'user-1', provider: 'google' }
    );
  });

  it('deactivates an integration without attempting revocation when no token is stored', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByUserAndMethod.mockResolvedValue({
      _id: 'google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: {},
      is_active: true,
    });

    await expect(login.unlinkFromUser('user-1')).resolves.toBeUndefined();
    expect(login.revokeTokenMock).not.toHaveBeenCalled();
    expect(socialIntegrationService.deactivateIntegration).toHaveBeenCalledWith(
      'google-integration'
    );
  });

  it('deactivates locally when provider token revocation fails', async () => {
    const { logger, login, socialIntegrationService } = createDependencies();
    const revocationError = new Error('provider revocation unavailable');
    socialIntegrationService.findByUserAndMethod.mockResolvedValue({
      _id: 'google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: { access_token: 'plain-access-token' },
      is_active: true,
    });
    login.revokeTokenMock.mockRejectedValueOnce(revocationError);

    await expect(login.unlinkFromUser('user-1')).resolves.toBeUndefined();
    expect(socialIntegrationService.deactivateIntegration).toHaveBeenCalledWith(
      'google-integration'
    );
    expect(logger.warn).toHaveBeenCalledWith('Failed to revoke google token', {
      userId: 'user-1',
      provider: 'google',
      error: revocationError.message,
    });
  });

  it('uses a safe no-op when a provider does not implement token revocation', async () => {
    const { logger, login } = createDependencies();

    await expect(
      login.runDefaultRevokeToken('access-token')
    ).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      'Token revocation not implemented for google',
      { provider: 'google' }
    );
  });

  it.each([
    {
      query: {},
      session: { google: { state: 'expected-state' } },
      flags: { hasCode: false, hasState: false, hasSessionData: true },
    },
    {
      query: { code: 'authorization-code' },
      session: { google: { state: 'expected-state' } },
      flags: { hasCode: true, hasState: false, hasSessionData: true },
    },
    {
      query: { code: 'authorization-code', state: 'expected-state' },
      session: {},
      flags: { hasCode: true, hasState: true, hasSessionData: false },
    },
  ])(
    'rejects incomplete OAuth callback inputs ($flags)',
    ({ flags, query, session }) => {
      const { logger, login, sessionManager } = createDependencies();
      const req = { query } as unknown as Request;
      sessionManager.get.mockReturnValue(session);

      expect(login.runVerifyOAuthState(req)).toEqual({
        isValid: false,
        error:
          'Invalid callback parameters - missing code, state, or session data',
      });
      expect(sessionManager.get).toHaveBeenCalledWith(req, 'socialLogin', {});
      expect(logger.error).toHaveBeenCalledWith(
        'Invalid callback parameters for google',
        { provider: 'google', ...flags }
      );
    }
  );

  it('rejects a mismatched OAuth state without logging either secret value', () => {
    const { logger, login, sessionManager } = createDependencies();
    const req = {
      query: { code: 'authorization-code', state: 'received-state' },
    } as unknown as Request;
    sessionManager.get.mockReturnValue({
      google: { state: 'expected-state', codeVerifier: 'pkce-verifier' },
    });

    expect(login.runVerifyOAuthState(req)).toEqual({
      isValid: false,
      error: 'Invalid OAuth state parameter - possible CSRF attack',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'OAuth state mismatch for google',
      {
        provider: 'google',
        stateMatch: false,
        hasReceivedState: true,
        hasExpectedState: true,
      }
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'received-state'
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'expected-state'
    );
  });

  it('returns provider session data when the OAuth state matches', () => {
    const { logger, login, sessionManager } = createDependencies();
    const req = {
      query: { code: 'authorization-code', state: 'expected-state' },
    } as unknown as Request;
    const providerSessionData = {
      state: 'expected-state',
      codeVerifier: 'pkce-verifier',
    };
    sessionManager.get.mockReturnValue({ google: providerSessionData });

    expect(login.runVerifyOAuthState(req)).toEqual({
      isValid: true,
      sessionData: providerSessionData,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('builds the default provider config without mutating provider fields', () => {
    const { config, login } = createDependencies();
    const providerConfig = login.runGetDefaultProviderConfig<{
      client_id: string;
      client_secret: string;
      redirect_uri: string;
    }>();

    expect(providerConfig).toEqual({
      client_id: 'google-id',
      client_secret: 'google-secret',
      redirect_uri: 'https://parako.example.test/auth/social/google/callback',
    });
    expect(config.features.social_providers.google).toEqual({
      client_id: 'google-id',
      client_secret: 'google-secret',
    });
  });

  it('removes only the current provider from the social login session', () => {
    const { logger, login, sessionManager } = createDependencies();
    const req = {} as Request;
    const socialLogin = {
      google: { state: 'google-state' },
      github: { state: 'github-state' },
    };
    sessionManager.get.mockReturnValue(socialLogin);

    login.runCleanupSocialLoginSession(req);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'Cleaned up social login session data',
      { provider: 'google' }
    );
  });

  it('leaves the session untouched when the provider has no OAuth state', () => {
    const { logger, login, sessionManager } = createDependencies();
    const req = {} as Request;
    sessionManager.get.mockReturnValue({
      github: { state: 'github-state' },
    });

    login.runCleanupSocialLoginSession(req);

    expect(sessionManager.set).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('keeps OAuth session cleanup best-effort when session access fails', () => {
    const { logger, login, sessionManager } = createDependencies();
    const req = {} as Request;
    const sessionError = new Error('session unavailable');
    sessionManager.get.mockImplementation(() => {
      throw sessionError;
    });

    expect(() => login.runCleanupSocialLoginSession(req)).not.toThrow();
    expect(sessionManager.set).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Failed to cleanup social login session',
      { provider: 'google', error: sessionError.message }
    );
  });

  it('reports a same-user provider subject as an existing user integration', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByProviderSub.mockResolvedValue({
      _id: 'existing-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      is_active: true,
    });

    await expect(
      login.linkToUser(
        'user-1',
        { sub: 'google-subject' } as ProviderUserData,
        { access_token: 'access-token' } as TokenData
      )
    ).rejects.toThrow('User already has a google integration');
    expect(socialIntegrationService.findByUserAndMethod).not.toHaveBeenCalled();
  });

  it('rejects a provider subject owned by another user without disclosing the owner', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByProviderSub.mockResolvedValue({
      _id: 'existing-google-integration',
      user_id: 'other-user',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      is_active: true,
    });

    await expect(
      login.linkToUser(
        'user-1',
        { sub: 'google-subject' } as ProviderUserData,
        { access_token: 'access-token' } as TokenData
      )
    ).rejects.toThrow('This google account is already linked to another user');
    expect(socialIntegrationService.findByUserAndMethod).not.toHaveBeenCalled();
  });

  it('rejects a new provider subject when the user already has that method', async () => {
    const { login, socialIntegrationService } = createDependencies();
    socialIntegrationService.findByUserAndMethod.mockResolvedValue({
      _id: 'existing-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'different-google-subject',
      provider_data: { sub: 'different-google-subject' },
      is_active: true,
    });

    await expect(
      login.linkToUser(
        'user-1',
        { sub: 'google-subject' } as ProviderUserData,
        { access_token: 'access-token' } as TokenData
      )
    ).rejects.toThrow('User already has a google integration');
    expect(
      socialIntegrationService.findByUserAndMethodIncludingInactive
    ).not.toHaveBeenCalled();
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('reactivates an inactive integration instead of creating a duplicate', async () => {
    const { logger, login, socialIntegrationService } = createDependencies();
    const inactiveIntegration = {
      _id: 'inactive-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'old-google-subject',
      provider_data: { sub: 'old-google-subject' },
      is_active: false,
    };
    const providerData = {
      sub: 'new-google-subject',
      email: 'user@example.test',
    } as ProviderUserData;
    const tokens = { access_token: 'new-access-token' } as TokenData;
    socialIntegrationService.findByUserAndMethodIncludingInactive.mockResolvedValue(
      inactiveIntegration
    );

    await expect(
      login.linkToUser('user-1', providerData, tokens)
    ).resolves.toBe(inactiveIntegration);
    expect(
      socialIntegrationService.updateIntegrationProviderData
    ).toHaveBeenCalledWith(inactiveIntegration._id, providerData);
    expect(
      socialIntegrationService.updateIntegrationTokens
    ).toHaveBeenCalledWith(inactiveIntegration._id, tokens);
    expect(socialIntegrationService.activateIntegration).toHaveBeenCalledWith(
      inactiveIntegration._id
    );
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Reactivated google integration for user',
      {
        userId: 'user-1',
        provider: 'google',
        integrationId: inactiveIntegration._id,
      }
    );
  });

  it('creates and returns an integration when no conflict exists', async () => {
    const { login, socialIntegrationService } = createDependencies();
    const providerData = {
      sub: 'google-subject',
      email: 'user@example.test',
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    const createdIntegration = {
      _id: 'created-google-integration',
      user_id: 'user-1',
      method: 'google',
      provider_sub: providerData.sub,
      provider_data: providerData,
      tokens,
      is_active: true,
    };
    socialIntegrationService.createIntegration.mockResolvedValue(
      createdIntegration
    );

    await expect(
      login.linkToUser('user-1', providerData, tokens)
    ).resolves.toBe(createdIntegration);
    expect(socialIntegrationService.createIntegration).toHaveBeenCalledWith(
      'user-1',
      'google',
      providerData,
      tokens
    );
  });

  it('blocks a second provider when multiple providers are disabled', async () => {
    const { login, socialIntegrationService } = createDependencies(false);
    socialIntegrationService.findByUser.mockResolvedValue([
      {
        _id: 'github-integration',
        user_id: 'user-1',
        provider: 'github',
      },
    ]);
    const providerData = {
      sub: 'google-subject',
      email: 'user@example.test',
      email_verified: true,
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toEqual({
      success: false,
      error: 'Multiple social providers are not allowed for this account',
    });
    expect(socialIntegrationService.createIntegration).not.toHaveBeenCalled();
  });

  it('allows a first provider when multiple providers are disabled', async () => {
    const { login, socialIntegrationService } = createDependencies(false);
    const providerData = {
      sub: 'google-subject',
      email: 'user@example.test',
      email_verified: true,
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;

    await expect(
      login.runUserIntegration(providerData, tokens, {
        params: { provider: 'google' },
      } as unknown as Request)
    ).resolves.toMatchObject({
      success: true,
      integration: { _id: 'google-integration' },
    });
    expect(socialIntegrationService.createIntegration).toHaveBeenCalledWith(
      'user-1',
      'google',
      providerData,
      tokens
    );
  });

  it('does not reactivate an integration for a deleted authenticated user', async () => {
    const { login, socialIntegrationService, userService } =
      createDependencies();
    const inactiveIntegration = {
      _id: 'inactive-google-integration',
      user_id: 'user-1',
      provider: 'google',
      active: false,
    };
    socialIntegrationService.findByUserAndMethodIncludingInactive.mockResolvedValue(
      inactiveIntegration
    );
    userService.findById.mockResolvedValue(null);

    await expect(
      login.runUserIntegration(
        {
          sub: 'google-subject',
          email: 'user@example.test',
        } as ProviderUserData,
        { access_token: 'access-token' } as TokenData,
        { params: { provider: 'google' } } as unknown as Request
      )
    ).resolves.toEqual({
      success: false,
      error: 'User not found for existing integration',
    });
    expect(
      socialIntegrationService.updateIntegrationProviderData
    ).not.toHaveBeenCalled();
    expect(
      socialIntegrationService.updateIntegrationTokens
    ).not.toHaveBeenCalled();
    expect(socialIntegrationService.activateIntegration).not.toHaveBeenCalled();
  });
});
