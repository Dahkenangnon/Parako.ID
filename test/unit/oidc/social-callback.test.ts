import { afterEach, describe, expect, it, vi } from 'vitest';

import { OIDCSocialCallbackHandler } from '../../../src/oidc/flows/handlers/social-callback.js';

describe('OIDC social callback handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createHarness = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const activityService = {
      failed: vi.fn(),
      getDeviceHistoryForUser: vi.fn().mockResolvedValue([]),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    };
    const config = {
      deployment: {
        routes: {
          auth: '/auth',
          auth_routes: { phone_verification: '/phone-verification' },
        },
      },
      oidc: { path: '/oidc/v1' },
      security: {
        authentication: {
          session: { require_2fa_for_new_device: false },
          signup: { require_phone_verification: false },
        },
      },
    };
    const configManager = { getConfig: vi.fn(() => config) };
    const viewResolver = {
      views: { auth: { oidc: { error: 'auth/oidc/error' } } },
    };
    const user = {
      _id: 'user-id',
      email: 'alice@example.test',
      email_verified: true,
      family_name: 'Doe',
      given_name: 'Alice',
      phone_number: '+22997000000',
      phone_number_verified: true,
      picture: 'https://images.example.test/alice.png',
      roles: ['user'],
      username: 'alice',
    };
    const callbackResult = {
      success: true,
      user,
    };
    const socialLoginManager = {
      handleCallback: vi.fn().mockResolvedValue(callbackResult),
    };
    const oidcContext = {
      client_id: 'demo-rp',
      timestamp: Date.now(),
      uid: 'interaction-id',
    };
    const flash = {
      error: vi.fn(),
      success: vi.fn(),
    };
    const sessionManager = {
      enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
      flash: vi.fn(() => flash),
      get: vi.fn((_req, key) =>
        key === 'oidcSocialContext' ? oidcContext : null
      ),
      getActiveUser: vi.fn(() => null),
      regenerate: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(),
      set: vi.fn(),
      setAuthenticated: vi.fn(),
    };
    const notificationService = {
      sendNewSessionAlert: vi.fn(),
      sendOtp: vi.fn(),
    };
    const clientDetails = {
      fingerprint: 'fingerprint-123',
      ip: '192.0.2.10',
      user_agent: 'Test Browser',
    };
    const clientDeviceInfoManager = {
      evaluateDeviceMatch: vi.fn(() => ({
        confidence_score: 100,
        is_new_device: false,
        requires_2fa: false,
        risk_level: 'low',
      })),
      extractDeviceInfoFromRequest: vi.fn<() => { user_agent: string } | null>(
        () => ({
          user_agent: 'Browser supplied device',
        })
      ),
      getClientInfoFromRequest: vi.fn(() => clientDetails),
    };
    const geolocationService = {
      checkImpossibleTravel: vi.fn(),
      getLocationFromIP: vi.fn(),
      isEnabled: vi.fn(() => false),
      isHighRiskRegion: vi.fn(),
    };
    const ipReputationService = {
      checkIPReputation: vi.fn(),
      isEnabled: vi.fn(() => false),
    };
    const authService = {
      generateEmailOtp: vi.fn(),
      generatePhoneVerificationChallenge: vi.fn(),
    };
    const mfaUtils = { isTotpEnabled: vi.fn(() => false) };
    const metricsService = { recordFederationLogin: vi.fn() };
    const smsService = {
      sendVerificationCode: vi.fn().mockResolvedValue({ success: true }),
    };
    const handler = new OIDCSocialCallbackHandler(
      logger as any,
      activityService as any,
      configManager as any,
      viewResolver as any,
      socialLoginManager as any,
      sessionManager as any,
      notificationService as any,
      clientDeviceInfoManager as any,
      geolocationService as any,
      ipReputationService as any,
      authService as any,
      mfaUtils as any,
      metricsService as any,
      smsService as any
    );
    const request: {
      headers: { 'user-agent'?: string };
      ip?: string;
      params: { provider: string };
      query: { code: string; state: string };
      session: { id: string };
    } = {
      headers: { 'user-agent': 'Test Browser' },
      ip: '192.0.2.10',
      params: { provider: 'google' },
      query: { code: 'authorization-code', state: 'provider-state' },
      session: { id: 'browser-session' },
    };
    const response = {
      redirect: vi.fn(),
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    return {
      activityService,
      authService,
      callbackResult,
      clientDeviceInfoManager,
      config,
      configManager,
      geolocationService,
      handler,
      ipReputationService,
      logger,
      metricsService,
      mfaUtils,
      next: vi.fn(),
      notificationService,
      oidcContext,
      request,
      response,
      sessionManager,
      smsService,
      socialLoginManager,
      user,
      viewResolver,
    };
  };

  it('rejects a callback without its server-side OIDC correlation context', async () => {
    const harness = createHarness();
    harness.sessionManager.get.mockReturnValue(null);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Session Expired',
        error: 'Social login session expired. Please try again.',
        redirectUrl: '/auth/login',
      }
    );
    expect(harness.socialLoginManager.handleCallback).not.toHaveBeenCalled();
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
  });

  it('removes and rejects an expired social callback context', async () => {
    const harness = createHarness();
    harness.oidcContext.timestamp = Date.now() - 10 * 60 * 1000 - 1;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Session Expired',
        error: 'Social login session expired. Please try again.',
        redirectUrl: '/oidc/v1/interaction/interaction-id',
      }
    );
    expect(harness.socialLoginManager.handleCallback).not.toHaveBeenCalled();
  });

  it('audits and renders a provider callback failure', async () => {
    const harness = createHarness();
    harness.socialLoginManager.handleCallback.mockResolvedValue({
      error: 'The provider denied access',
      requiresLinking: true,
      success: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'google',
      'failure'
    );
    expect(harness.activityService.failed).toHaveBeenCalledWith(
      'oidc_social_login_failed',
      'Social login with google failed',
      null,
      expect.objectContaining({
        actor: { actor_type: 'anonymous' },
        target: expect.objectContaining({
          entity_data: {
            errorMessage: 'The provider denied access',
            provider: 'google',
            requiresLinking: true,
          },
        }),
      })
    );
    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'Social Authentication Failed',
      error: 'The provider denied access',
      redirectUrl: '/oidc/v1/interaction/interaction-id',
    });
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
  });

  it('renders a safe error when a successful callback has no user', async () => {
    const harness = createHarness();
    harness.socialLoginManager.handleCallback.mockResolvedValue({
      success: true,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'User Not Found',
      error: 'User not found after social authentication',
      redirectUrl: '/oidc/v1/interaction/interaction-id',
    });
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
  });

  it('regenerates the session, authenticates the user, audits success, and resumes OIDC', async () => {
    const harness = createHarness();
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_123);
    harness.oidcContext.timestamp = 1_700_000_000_000;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.regenerate).toHaveBeenCalledWith(
      harness.request
    );
    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
      harness.request,
      {
        currentActiveLoggedUser: {
          email: 'alice@example.test',
          email_verified: true,
          family_name: 'Doe',
          full_name: 'Alice Doe',
          given_name: 'Alice',
          id: 'user-id',
          is_admin: false,
          last_used: 1_700_000_000_123,
          phone_number: '+22997000000',
          phone_number_verified: true,
          picture: 'https://images.example.test/alice.png',
          roles: ['user'],
          username: 'alice',
        },
      }
    );
    expect(harness.sessionManager.enforceSessionLimit).toHaveBeenCalledWith(
      'alice',
      'browser-session'
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'oidc_social_login_success',
      'User logged in with social provider via OIDC',
      harness.user,
      expect.objectContaining({
        actor: harness.user,
        target: expect.objectContaining({
          entity_data: { isNewLink: undefined, provider: 'google' },
        }),
      })
    );
    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'google',
      'success'
    );
    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('requires phone possession proof before resuming an OIDC social login', async () => {
    const harness = createHarness();
    harness.config.security.authentication.signup.require_phone_verification = true;
    harness.user.phone_number_verified = false;
    harness.authService.generatePhoneVerificationChallenge.mockResolvedValue({
      code: '123456',
      verificationToken: 'phone-token',
      user: harness.user,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(
      harness.authService.generatePhoneVerificationChallenge
    ).toHaveBeenCalledWith('user-id');
    expect(harness.smsService.sendVerificationCode).toHaveBeenCalledWith(
      '+22997000000',
      '123456',
      '192.0.2.10'
    );
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'phoneVerificationOidcContinuation',
      {
        interactionUid: 'interaction-id',
        createdAt: expect.any(Number),
      }
    );
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/auth/phone-verification?token=phone-token'
    );
  });

  it('keeps phone verification completable when social-login SMS delivery reports failure', async () => {
    const harness = createHarness();
    harness.config.security.authentication.signup.require_phone_verification = true;
    harness.user.phone_number_verified = false;
    harness.authService.generatePhoneVerificationChallenge.mockResolvedValue({
      code: '123456',
      verificationToken: 'phone-token',
      user: harness.user,
    });
    harness.smsService.sendVerificationCode.mockResolvedValue({
      error: 'SMS provider unavailable',
      success: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'phoneVerificationOidcContinuation',
      expect.objectContaining({ interactionUid: 'interaction-id' })
    );
    expect(harness.sessionManager.flash().error).toHaveBeenCalledWith(
      'We could not send the verification code. Please try resending it.'
    );
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/auth/phone-verification?token=phone-token'
    );
  });

  it('fails closed when social-login session regeneration fails', async () => {
    const harness = createHarness();
    harness.sessionManager.regenerate.mockRejectedValue(
      new Error('session store unavailable')
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.activityService.success).not.toHaveBeenCalled();
    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'google',
      'failure'
    );
    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext'
    );
    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'Social Login Error',
      error: 'An unexpected error occurred during social authentication.',
      redirectUrl: '/oidc/v1/interaction/interaction-id',
    });
  });

  it('starts email verification before authenticating a social login on a new device', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 90,
      is_new_device: true,
      requires_2fa: false,
      risk_level: 'medium',
    });
    harness.authService.generateEmailOtp.mockResolvedValue({ code: '654321' });
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_123_000);
    harness.oidcContext.timestamp = 1_700_000_000_000;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.authService.generateEmailOtp).toHaveBeenCalledWith(
      'user-id'
    );
    expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      '654321',
      { deviceInfo: 'Browser supplied device', ip: '192.0.2.10' }
    );
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.objectContaining({
        clientId: 'demo-rp',
        created_at: 1_700_000_123_000,
        device_info: {
          additional_risk_factors: [],
          confidence_score: 90,
          is_new_device: true,
          risk_level: 'medium',
        },
        interactionUid: 'interaction-id',
        method: 'email',
        socialProvider: 'google',
        userId: 'user-id',
      })
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id/new-device-verify'
    );
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
  });

  it('does not store an unusable social-login email challenge when OTP delivery fails', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 20,
      is_new_device: true,
      requires_2fa: true,
      risk_level: 'high',
    });
    harness.authService.generateEmailOtp.mockRejectedValue(
      new Error('email provider unavailable')
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.set).not.toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.anything()
    );
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'google',
      'failure'
    );
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'Social Login Error',
      error: 'An unexpected error occurred during social authentication.',
      redirectUrl: '/oidc/v1/interaction/interaction-id',
    });
  });

  it('requires TOTP verification when social-login network and location signals are risky', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
      { ip: '198.51.100.8' },
    ]);
    harness.ipReputationService.isEnabled.mockReturnValue(true);
    harness.ipReputationService.checkIPReputation.mockResolvedValue({
      isProxy: true,
      isTor: false,
      isVPN: true,
      riskLevel: 'critical',
      success: true,
    });
    const currentLocation = { country: 'BJ', success: true };
    const previousLocation = { country: 'CA', success: true };
    harness.geolocationService.isEnabled.mockReturnValue(true);
    harness.geolocationService.isHighRiskRegion.mockReturnValue(true);
    harness.geolocationService.getLocationFromIP
      .mockResolvedValueOnce(currentLocation)
      .mockResolvedValueOnce(previousLocation);
    harness.geolocationService.checkImpossibleTravel.mockReturnValue({
      distanceKm: 8_000,
      isImpossible: true,
    });
    harness.mfaUtils.isTotpEnabled.mockReturnValue(true);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.objectContaining({
        device_info: expect.objectContaining({
          additional_risk_factors: [
            'vpn_detected',
            'high_fraud_score',
            'high_risk_region',
            'impossible_travel',
          ],
        }),
        method: 'totp',
      })
    );
    expect(harness.authService.generateEmailOtp).not.toHaveBeenCalled();
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id/new-device-verify'
    );
  });

  it('continues a low-risk social login when optional risk providers fail', async () => {
    const harness = createHarness();
    const ipError = new Error('IP provider unavailable');
    const geoError = new Error('geo provider unavailable');
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
      { ip: '198.51.100.8' },
    ]);
    harness.ipReputationService.isEnabled.mockReturnValue(true);
    harness.ipReputationService.checkIPReputation.mockRejectedValue(ipError);
    harness.geolocationService.isEnabled.mockReturnValue(true);
    harness.geolocationService.getLocationFromIP.mockRejectedValue(geoError);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.logger.debug).toHaveBeenCalledWith(
      'IP reputation check failed, continuing',
      { error: ipError.message }
    );
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'Geolocation check failed, continuing',
      { error: geoError.message }
    );
    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledOnce();
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('uses safe profile defaults for a sparse social account', async () => {
    const harness = createHarness();
    const partialUser = {
      _id: undefined,
      email: undefined,
      email_verified: false,
      family_name: undefined,
      given_name: undefined,
      phone_number: undefined,
      phone_number_verified: false,
      picture: undefined,
      roles: undefined,
      username: 'minimal-user',
    };
    harness.socialLoginManager.handleCallback.mockResolvedValue({
      success: true,
      user: partialUser,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
      harness.request,
      {
        currentActiveLoggedUser: {
          email: undefined,
          email_verified: false,
          family_name: '',
          full_name: '',
          given_name: '',
          id: '',
          is_admin: undefined,
          last_used: expect.any(Number),
          phone_number: '',
          phone_number_verified: false,
          picture: '',
          roles: ['user'],
          username: 'minimal-user',
        },
      }
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('sends configured new-session notifications with request fallbacks', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      notify_new_session: true,
      require_2fa_for_new_device: false,
    } as any;
    delete (harness.request as any).ip;
    delete harness.request.headers['user-agent'];

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(
      harness.notificationService.sendNewSessionAlert
    ).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      { ip: 'unknown', timestamp: expect.any(Date), userAgent: 'unknown' }
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('completes social login when session-limit and notification side effects fail', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      notify_new_session: true,
      require_2fa_for_new_device: false,
    } as any;
    harness.sessionManager.enforceSessionLimit.mockRejectedValue(
      new Error('session-limit store unavailable')
    );
    harness.notificationService.sendNewSessionAlert.mockRejectedValue(
      new Error('notification provider unavailable')
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'Failed to enforce session limit after social login',
      })
    );
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'Failed to send new session notification',
      })
    );
    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'google',
      'success'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it.each([
    { ageMs: 30_000, expectedLinkedAudit: true },
    { ageMs: 120_000, expectedLinkedAudit: false },
  ])(
    'audits provider linking only for a recently created integration',
    async ({ ageMs, expectedLinkedAudit }) => {
      const harness = createHarness();
      const now = 1_700_000_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      harness.oidcContext.timestamp = now;
      harness.socialLoginManager.handleCallback.mockResolvedValue({
        integration: {
          created_at: new Date(now - ageMs),
          provider_sub: 'provider-user-id',
          provider_username: 'alice-provider',
        },
        success: true,
        user: harness.user,
      });

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next
      );

      if (expectedLinkedAudit) {
        expect(harness.activityService.success).toHaveBeenCalledWith(
          'social_provider_linked',
          'User linked google account',
          harness.user,
          expect.objectContaining({
            target: expect.objectContaining({
              entity_data: {
                provider: 'google',
                providerSub: 'provider-user-id',
                providerUsername: 'alice-provider',
              },
            }),
          })
        );
      } else {
        expect(harness.activityService.success).not.toHaveBeenCalledWith(
          'social_provider_linked',
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      }
    }
  );

  it('renders a safe default message when a provider failure has no detail', async () => {
    const harness = createHarness();
    harness.socialLoginManager.handleCallback.mockResolvedValue({
      success: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'Social Authentication Failed',
      error: 'Social authentication failed. Please try again.',
      redirectUrl: '/oidc/v1/interaction/interaction-id',
    });
  });

  it('renders a safe 400 response for an unsupported callback provider', async () => {
    const harness = createHarness();
    harness.request.params.provider = 'unsupported';

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Invalid Request',
        error:
          'The request could not be processed. Please return to the previous page and try again.',
        redirectUrl: '/auth/login',
      }
    );
    expect(harness.socialLoginManager.handleCallback).not.toHaveBeenCalled();
  });

  it('uses safe unknown fallbacks when callback state disappears during recovery', async () => {
    const harness = createHarness();
    harness.sessionManager.get
      .mockReturnValueOnce(harness.oidcContext)
      .mockReturnValueOnce(null);
    harness.socialLoginManager.handleCallback.mockImplementation(async () => {
      (harness.request.params as any).provider = undefined;
      throw new Error('callback exchange failed');
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.metricsService.recordFederationLogin).toHaveBeenCalledWith(
      'unknown',
      'failure'
    );
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      title: 'Social Login Error',
      error: 'An unexpected error occurred during social authentication.',
      redirectUrl: '/oidc/v1/interaction/unknown',
    });
  });

  it.each([
    { reputation: { success: false } },
    {
      reputation: {
        isProxy: false,
        isTor: false,
        isVPN: false,
        riskLevel: 'low',
        success: true,
      },
    },
  ])(
    'does not challenge for a non-risky reputation result',
    async ({ reputation }) => {
      const harness = createHarness();
      harness.config.security.authentication.session = {
        require_2fa_for_new_device: true,
      } as any;
      harness.ipReputationService.isEnabled.mockReturnValue(true);
      harness.ipReputationService.checkIPReputation.mockResolvedValue(
        reputation
      );

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next
      );

      expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledOnce();
      expect(harness.response.redirect).toHaveBeenCalledWith(
        '/oidc/v1/interaction/interaction-id'
      );
    }
  );

  it.each([
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
          { ip: '198.51.100.8' },
        ]);
        harness.geolocationService.getLocationFromIP.mockResolvedValue({
          success: false,
        });
      },
      label: 'the current location is unavailable',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.activityService.getDeviceHistoryForUser.mockResolvedValue([{}]);
        harness.geolocationService.getLocationFromIP.mockResolvedValue({
          country: 'BJ',
          success: true,
        });
      },
      label: 'the previous device has no IP address',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
          { ip: '198.51.100.8' },
        ]);
        harness.geolocationService.getLocationFromIP
          .mockResolvedValueOnce({ country: 'BJ', success: true })
          .mockResolvedValueOnce({ success: false });
      },
      label: 'the previous location is unavailable',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
          { ip: '198.51.100.8' },
        ]);
        harness.geolocationService.getLocationFromIP
          .mockResolvedValueOnce({ country: 'BJ', success: true })
          .mockResolvedValueOnce({ country: 'TG', success: true });
        harness.geolocationService.checkImpossibleTravel.mockReturnValue({
          isImpossible: false,
        });
      },
      label: 'travel is physically plausible',
    },
  ])('does not challenge when $label', async ({ arrange }) => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.geolocationService.isEnabled.mockReturnValue(true);
    harness.geolocationService.isHighRiskRegion.mockReturnValue(false);
    arrange(harness);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledOnce();
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('uses a safe device label when social callback metadata is absent', async () => {
    const harness = createHarness();
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 100,
      is_new_device: true,
      requires_2fa: false,
      risk_level: 'medium',
    });
    harness.clientDeviceInfoManager.extractDeviceInfoFromRequest.mockReturnValue(
      null
    );
    harness.authService.generateEmailOtp.mockResolvedValue({ code: '654321' });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      '654321',
      { deviceInfo: 'Unknown Device', ip: '192.0.2.10' }
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id/new-device-verify'
    );
  });
});
