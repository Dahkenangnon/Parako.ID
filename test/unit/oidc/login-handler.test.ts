import { afterEach, describe, expect, it, vi } from 'vitest';

import { OIDCLoginHandler } from '../../../src/oidc/flows/handlers/login.js';
import { PhoneVerificationRequiredError } from '../../../src/errors/phone-verification-required.error.js';

type LoginCredentials = {
  identifier?: string;
  isValid: boolean;
  password?: string;
};

type LoginIdentifierType = string | { key: string; slot: number; type: string };

describe('OIDC login handler', () => {
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
    const userService = {
      updateUserLastLoginDate: vi.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: 'user-id',
      email: 'alice@example.test',
      email_verified: true,
      family_name: 'Doe',
      given_name: 'Alice',
      locale: 'fr',
      phone_number: '+22997000000',
      phone_number_verified: true,
      roles: ['user'],
      username: 'alice',
      zoneinfo: 'Africa/Porto-Novo',
    };
    const authService = {
      generateEmailOtp: vi.fn(),
      generatePhoneVerificationChallenge: vi.fn(),
      loginWithCustomIdentifier: vi.fn(),
      loginWithEmail: vi.fn().mockResolvedValue(user),
      loginWithPhoneNumber: vi.fn(),
    };
    const activityService = {
      failed: vi.fn(),
      getDeviceHistoryForUser: vi.fn().mockResolvedValue([]),
      info: vi.fn(),
      isTrustedDevice: vi.fn().mockResolvedValue(false),
      success: vi.fn(),
      warning: vi.fn(),
    };
    const viewResolver = {
      views: { auth: { oidc: { login: 'auth/oidc/login' } } },
    };
    const flash = { error: vi.fn(), success: vi.fn() };
    const sessionManager = {
      enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
      flash: vi.fn(() => flash),
      get: vi.fn((_req, key) => (key === 'csrfToken' ? 'csrf-token' : null)),
      getActiveUser: vi.fn(() => null),
      regenerate: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      setAuthenticated: vi.fn(),
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
      extractDeviceInfoFromRequest: vi.fn<
        (...args: unknown[]) => { user_agent: string } | null
      >(() => ({ user_agent: 'Browser supplied device' })),
      getClientInfoFromRequest: vi.fn(() => clientDetails),
    };
    const oidcUtils = {
      addOrUpdateAccountInSession: vi.fn(() => true),
      detectIdentifierType: vi.fn<(...args: unknown[]) => LoginIdentifierType>(
        () => 'email'
      ),
      validateLoginCredentials: vi.fn<(...args: unknown[]) => LoginCredentials>(
        () => ({ isValid: false })
      ),
    };
    const config = {
      application: { title: 'Parako' },
      deployment: {
        routes: {
          auth: '/auth',
          auth_routes: { phone_verification: '/phone-verification' },
        },
      },
      oidc: { path: '/oidc/v1' },
      security: {
        authentication: {
          login: { login_methods: ['email', 'phone', 'custom_identifier'] },
          session: { require_2fa_for_new_device: false },
        },
      },
    };
    const configManager = { getConfig: vi.fn(() => config) };
    const notificationService = {
      sendNewSessionAlert: vi.fn(),
      sendOtp: vi.fn(),
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
    const mfaUtils = {
      getEnabledMethods: vi.fn<() => string[]>(() => []),
      isMfaEnabled: vi.fn(() => false),
      isTotpEnabled: vi.fn(() => false),
    };
    const metricsService = { recordLoginAttempt: vi.fn() };
    const smsService = {
      sendVerificationCode: vi.fn().mockResolvedValue({ success: true }),
    };
    const handler = new OIDCLoginHandler(
      logger as any,
      userService as any,
      authService as any,
      activityService as any,
      viewResolver as any,
      sessionManager as any,
      clientDeviceInfoManager as any,
      oidcUtils as any,
      configManager as any,
      notificationService as any,
      geolocationService as any,
      ipReputationService as any,
      mfaUtils as any,
      metricsService as any,
      smsService as any
    );
    const params: {
      acr_values?: string;
      client_id: string;
      step_message: string;
    } = {
      client_id: 'demo-rp',
      step_message: '  Sign in to continue  ',
    };
    const interactionDetails = { params, uid: 'interaction-id' };
    const client = { clientId: 'demo-rp' };
    const provider = {
      Client: { find: vi.fn().mockResolvedValue(client) },
      interactionDetails: vi.fn().mockResolvedValue(interactionDetails),
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };
    const request: {
      body: Record<string, unknown>;
      headers: Record<string, string>;
      ip?: string;
      session: { id: string };
    } = {
      body: {},
      headers: { 'user-agent': 'Test Browser' },
      ip: '192.0.2.10',
      session: { id: 'browser-session' },
    };
    const response = {
      locals: {} as Record<string, unknown>,
      redirect: vi.fn(),
      render: vi.fn(),
    };
    const next = vi.fn();

    return {
      activityService,
      authService,
      client,
      clientDeviceInfoManager,
      config,
      configManager,
      flash,
      geolocationService,
      handler,
      interactionDetails,
      ipReputationService,
      logger,
      metricsService,
      mfaUtils,
      next,
      notificationService,
      oidcUtils,
      params,
      provider,
      request,
      response,
      sessionManager,
      smsService,
      userService,
      user,
      viewResolver,
    };
  };

  it('renders a complete retry form when credentials are missing', async () => {
    const harness = createHarness();

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.error).toHaveBeenCalledWith(
      'Credentials are required.'
    );
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/login', {
      client: harness.client,
      uid: 'interaction-id',
      params: harness.params,
      title: 'Sign-in - Parako',
      stepMessage: 'Sign in to continue',
      csrfToken: 'csrf-token',
    });
    expect(harness.authService.loginWithEmail).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('rejects identifier types disabled by the configured login policy', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct horse battery staple',
    });
    harness.config.security.authentication.login.login_methods = ['phone'];

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.metricsService.recordLoginAttempt).toHaveBeenCalledWith(
      'failure',
      'email'
    );
    expect(harness.flash.error).toHaveBeenCalledWith(
      'This login method is not available.'
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.objectContaining({
        client: harness.client,
        csrfToken: 'csrf-token',
        stepMessage: 'Sign in to continue',
      })
    );
    expect(harness.authService.loginWithEmail).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('routes a valid password through phone possession proof without reporting invalid credentials', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct horse battery staple',
    });
    harness.authService.loginWithEmail.mockRejectedValue(
      new PhoneVerificationRequiredError('user-id', '+22997000000')
    );
    harness.authService.generatePhoneVerificationChallenge.mockResolvedValue({
      user: harness.user,
      verificationToken: 'opaque-phone-token',
      code: '123456',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
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
    expect(harness.flash.success).toHaveBeenCalledWith(
      'A verification code has been sent to your phone.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/auth/phone-verification?token=opaque-phone-token'
    );
    expect(harness.response.render).not.toHaveBeenCalled();
    expect(harness.metricsService.recordLoginAttempt).not.toHaveBeenCalledWith(
      'error',
      expect.anything()
    );
  });

  it('keeps the OIDC phone proof resumable when initial SMS delivery fails', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct horse battery staple',
    });
    harness.authService.loginWithEmail.mockRejectedValue(
      new PhoneVerificationRequiredError('user-id', '+22997000000')
    );
    harness.authService.generatePhoneVerificationChallenge.mockResolvedValue({
      user: harness.user,
      verificationToken: 'opaque-phone-token',
      code: '123456',
      expiresAt: new Date(Date.now() + 60_000),
    });
    harness.smsService.sendVerificationCode.mockResolvedValue({
      success: false,
      error: 'provider unavailable',
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'phoneVerificationOidcContinuation',
      expect.objectContaining({ interactionUid: 'interaction-id' })
    );
    expect(harness.flash.error).toHaveBeenCalledWith(
      'We could not send the verification code. Please try resending it.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/auth/phone-verification?token=opaque-phone-token'
    );
    expect(harness.response.render).not.toHaveBeenCalled();
  });

  it('renders login again when a phone verification challenge cannot start', async () => {
    const harness = createHarness();
    const challengeError = new Error('challenge store unavailable');
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct horse battery staple',
    });
    harness.authService.loginWithEmail.mockRejectedValue(
      new PhoneVerificationRequiredError('user-id', '+22997000000')
    );
    harness.authService.generatePhoneVerificationChallenge.mockRejectedValue(
      challengeError
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(challengeError, {
      context: 'Failed to start OIDC phone verification',
      userId: 'user-id',
    });
    expect(harness.flash.error).toHaveBeenCalledWith(
      'Phone verification is required. Please try again.'
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.any(Object)
    );
    expect(harness.response.redirect).not.toHaveBeenCalled();
  });

  it.each([
    {
      detectedType: 'email',
      identifier: 'alice@example.test',
      method: 'email',
      serviceMethod: 'loginWithEmail',
    },
    {
      detectedType: 'phone',
      identifier: '+22997000000',
      method: 'phone',
      serviceMethod: 'loginWithPhoneNumber',
    },
    {
      detectedType: {
        key: 'employee_id',
        slot: 2,
        type: 'custom_identifier',
      },
      identifier: 'EMP-42',
      method: 'custom_identifier',
      serviceMethod: 'loginWithCustomIdentifier',
    },
  ])(
    'routes $method credentials to its authenticator and renders a retry on failure',
    async ({ detectedType, identifier, method, serviceMethod }) => {
      const harness = createHarness();
      const password = 'incorrect-password';
      harness.oidcUtils.validateLoginCredentials.mockReturnValue({
        identifier,
        isValid: true,
        password,
      });
      harness.oidcUtils.detectIdentifierType.mockReturnValue(detectedType);
      (harness.authService as any)[serviceMethod].mockResolvedValue(null);

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next,
        harness.provider as any
      );

      if (method === 'custom_identifier') {
        expect(
          harness.authService.loginWithCustomIdentifier
        ).toHaveBeenCalledWith(2, identifier, password);
      } else {
        expect(
          (harness.authService as any)[serviceMethod]
        ).toHaveBeenCalledWith(identifier, password);
      }
      expect(harness.metricsService.recordLoginAttempt).toHaveBeenCalledWith(
        'failure',
        method
      );
      expect(harness.response.locals.loginFailed).toBe(true);
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid credentials. Please try again.'
      );
      expect(harness.response.render).toHaveBeenCalledWith(
        'auth/oidc/login',
        expect.objectContaining({ csrfToken: 'csrf-token' })
      );
      expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    }
  );

  it('regenerates the browser session and finishes a successful password login', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_123);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    const expectedAccount = {
      id: 'user-id',
      username: 'alice',
      email: 'alice@example.test',
      email_verified: true,
      phone_number: '+22997000000',
      phone_number_verified: true,
      given_name: 'Alice',
      family_name: 'Doe',
      full_name: 'Alice Doe',
      roles: ['user'],
      is_admin: false,
      last_used: 1_700_000_000_123,
      zoneinfo: 'Africa/Porto-Novo',
      locale: 'fr',
    };
    expect(harness.sessionManager.regenerate).toHaveBeenCalledWith(
      harness.request
    );
    expect(harness.oidcUtils.addOrUpdateAccountInSession).toHaveBeenCalledWith(
      harness.request,
      expectedAccount,
      true
    );
    expect(harness.sessionManager.enforceSessionLimit).toHaveBeenCalledWith(
      'alice',
      'browser-session'
    );
    expect(harness.metricsService.recordLoginAttempt).toHaveBeenCalledWith(
      'success',
      'email'
    );
    expect(harness.userService.updateUserLastLoginDate).toHaveBeenCalledWith(
      'user-id',
      'alice'
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'oidc.login.success',
      'User logged in using OIDC',
      harness.user,
      expect.objectContaining({
        actor: harness.user,
        client_id: 'demo-rp',
        ip_address: '192.0.2.10',
        target: { target_type: 'none' },
        user_agent: 'Test Browser',
      })
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        login: { accountId: 'alice', acr: 'urn:pwd', amr: ['pwd'] },
        ts: 1_700_000_000,
      },
      { mergeWithLastSubmission: false }
    );
    expect(harness.response.render).not.toHaveBeenCalled();
    expect(harness.response.redirect).not.toHaveBeenCalled();
  });

  it('fails closed when session regeneration cannot prevent fixation', async () => {
    const harness = createHarness();
    const error = new Error('session store unavailable');
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.sessionManager.regenerate.mockRejectedValue(error);
    Object.assign(harness.request.body, { login_method: 'email' });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(
      harness.oidcUtils.addOrUpdateAccountInSession
    ).not.toHaveBeenCalled();
    expect(harness.sessionManager.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    expect(harness.metricsService.recordLoginAttempt).toHaveBeenCalledWith(
      'error',
      'email'
    );
    expect(harness.response.locals.loginFailed).toBe(true);
    expect(harness.flash.error).toHaveBeenCalledWith(
      'The credentials you provided are not valid.'
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.objectContaining({ csrfToken: 'csrf-token' })
    );
  });

  it('starts email verification before authenticating a new device', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      new_device_2fa_method: 'auto',
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 95,
      is_new_device: true,
      requires_2fa: false,
      risk_level: 'medium',
    });
    harness.authService.generateEmailOtp.mockResolvedValue({ code: '654321' });
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_123_000);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.activityService.isTrustedDevice).toHaveBeenCalledWith(
      'user-id',
      'fingerprint-123'
    );
    expect(harness.authService.generateEmailOtp).toHaveBeenCalledWith(
      'user-id'
    );
    expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      '654321',
      {
        deviceInfo: 'Browser supplied device',
        ip: '192.0.2.10',
      }
    );
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.objectContaining({
        clientId: 'demo-rp',
        created_at: 1_700_000_123_000,
        device_info: {
          confidence_score: 95,
          is_new_device: true,
          risk_level: 'medium',
        },
        email: 'alice@example.test',
        interactionUid: 'interaction-id',
        method: 'email',
        userId: 'user-id',
        username: 'alice',
      })
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id/new-device-verify'
    );
    expect(harness.sessionManager.regenerate).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('does not create an unusable email challenge when OTP delivery fails', async () => {
    const harness = createHarness();
    const error = new Error('email provider unavailable');
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      new_device_2fa_method: 'email',
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 20,
      is_new_device: true,
      requires_2fa: true,
      risk_level: 'high',
    });
    harness.authService.generateEmailOtp.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.set).not.toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.anything()
    );
    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.sessionManager.regenerate).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.objectContaining({ csrfToken: 'csrf-token' })
    );
  });

  it('skips new-device verification for an explicitly trusted device', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.activityService.isTrustedDevice.mockResolvedValue(true);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(
      harness.activityService.getDeviceHistoryForUser
    ).not.toHaveBeenCalled();
    expect(
      harness.clientDeviceInfoManager.evaluateDeviceMatch
    ).not.toHaveBeenCalled();
    expect(harness.sessionManager.set).not.toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.anything()
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

  it.each([
    {
      configuredMethod: undefined,
      expectedMethod: 'totp',
      hasTotp: true,
      label: 'defaults to TOTP when auto-selected and available',
    },
    {
      configuredMethod: 'totp',
      expectedMethod: 'totp',
      hasTotp: true,
      label: 'uses configured TOTP when available',
    },
    {
      configuredMethod: 'totp',
      expectedMethod: 'email',
      hasTotp: false,
      label: 'falls back to email when configured TOTP is unavailable',
    },
  ])('$label', async ({ configuredMethod, expectedMethod, hasTotp }) => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      new_device_2fa_method: configuredMethod,
      require_2fa_for_new_device: true,
    } as any;
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 40,
      is_new_device: false,
      requires_2fa: true,
      risk_level: 'high',
    });
    harness.mfaUtils.isTotpEnabled.mockReturnValue(hasTotp);
    harness.authService.generateEmailOtp.mockResolvedValue({ code: '654321' });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.objectContaining({ method: expectedMethod })
    );
    if (expectedMethod === 'email') {
      expect(harness.notificationService.sendOtp).toHaveBeenCalledOnce();
    } else {
      expect(harness.notificationService.sendOtp).not.toHaveBeenCalled();
    }
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id/new-device-verify'
    );
  });

  it('requires verification when network and location services report risk', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      new_device_2fa_method: 'totp',
      require_2fa_for_new_device: true,
    } as any;
    const oldDevice = { ip: '198.51.100.8' };
    harness.activityService.getDeviceHistoryForUser.mockResolvedValue([
      oldDevice,
    ]);
    harness.clientDeviceInfoManager.evaluateDeviceMatch.mockReturnValue({
      confidence_score: 100,
      is_new_device: false,
      requires_2fa: false,
      risk_level: 'low',
    });
    harness.ipReputationService.isEnabled.mockReturnValue(true);
    harness.ipReputationService.checkIPReputation.mockResolvedValue({
      fraudScore: 98,
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
      speedKmh: 8_000,
    });
    harness.mfaUtils.isTotpEnabled.mockReturnValue(true);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.ipReputationService.checkIPReputation).toHaveBeenCalledWith(
      '192.0.2.10'
    );
    expect(
      harness.geolocationService.getLocationFromIP
    ).toHaveBeenNthCalledWith(1, '192.0.2.10');
    expect(
      harness.geolocationService.getLocationFromIP
    ).toHaveBeenNthCalledWith(2, '198.51.100.8');
    expect(
      harness.geolocationService.checkImpossibleTravel
    ).toHaveBeenCalledWith(previousLocation, currentLocation, 60);
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification',
      expect.objectContaining({ method: 'totp' })
    );
    expect(harness.response.redirect).toHaveBeenCalledOnce();
  });

  it('continues a low-risk login when optional risk providers fail', async () => {
    const harness = createHarness();
    const ipError = new Error('IP provider unavailable');
    const geoError = new Error('geo provider unavailable');
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
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
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.debug).toHaveBeenCalledWith(
      'IP reputation check failed, continuing',
      { error: ipError.message }
    );
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'Geolocation check failed, continuing',
      { error: geoError.message }
    );
    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

  it('uses basic session auth and safe profile defaults when account-list storage declines the update', async () => {
    const harness = createHarness();
    const partialUser = {
      _id: undefined,
      email: undefined,
      email_verified: false,
      family_name: undefined,
      given_name: undefined,
      locale: undefined,
      phone_number: undefined,
      phone_number_verified: false,
      roles: undefined,
      username: 'minimal-user',
      zoneinfo: undefined,
    };
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'minimal@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.authService.loginWithEmail.mockResolvedValue(partialUser);
    harness.oidcUtils.addOrUpdateAccountInSession.mockReturnValue(false);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    const expectedAccount = {
      email: undefined,
      email_verified: false,
      family_name: '',
      full_name: '',
      given_name: '',
      id: '',
      is_admin: undefined,
      last_used: expect.any(Number),
      locale: 'en',
      phone_number: '',
      phone_number_verified: false,
      roles: ['user'],
      username: 'minimal-user',
      zoneinfo: 'UTC',
    };
    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
      harness.request,
      { currentActiveLoggedUser: expectedAccount }
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: expect.objectContaining({ accountId: 'minimal-user' }),
      }),
      { mergeWithLastSubmission: false }
    );
  });

  it.each([
    { enabledMethods: ['totp'], expectedAcr: 'urn:mfa:otp' },
    { enabledMethods: ['email'], expectedAcr: 'urn:mfa:otp' },
    { enabledMethods: ['webauthn'], expectedAcr: 'urn:mfa:otp' },
    { enabledMethods: [], expectedAcr: 'urn:pwd' },
  ])(
    'returns $expectedAcr when an OTP ACR is requested with $enabledMethods',
    async ({ enabledMethods, expectedAcr }) => {
      const harness = createHarness();
      harness.oidcUtils.validateLoginCredentials.mockReturnValue({
        identifier: 'alice@example.test',
        isValid: true,
        password: 'correct-password',
      });
      harness.params.acr_values = 'urn:loa:1 urn:mfa:otp';
      harness.mfaUtils.isMfaEnabled.mockReturnValue(true);
      harness.mfaUtils.getEnabledMethods.mockReturnValue(enabledMethods);

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next,
        harness.provider as any
      );

      const result = harness.provider.interactionFinished.mock.calls[0][2];
      expect(result.login.acr).toBe(expectedAcr);
      if (expectedAcr === 'urn:mfa:otp') {
        expect(result).not.toHaveProperty('ts');
      } else {
        expect(result).toHaveProperty('ts');
      }
    }
  );

  it('sends a new-session notification with request fallbacks when configured', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      notify_new_session: true,
      require_2fa_for_new_device: false,
    } as any;
    delete (harness.request as any).ip;
    delete harness.request.headers['user-agent'];

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(
      harness.notificationService.sendNewSessionAlert
    ).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      {
        ip: 'unknown',
        timestamp: expect.any(Date),
        userAgent: 'unknown',
      }
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

  it('completes login when noncritical persistence and notification side effects fail', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      notify_new_session: true,
      require_2fa_for_new_device: false,
    } as any;
    harness.sessionManager.enforceSessionLimit.mockRejectedValue(
      new Error('session limit store unavailable')
    );
    harness.notificationService.sendNewSessionAlert.mockRejectedValue(
      new Error('notification provider unavailable')
    );
    harness.userService.updateUserLastLoginDate.mockRejectedValue(
      new Error('user store unavailable')
    );
    harness.activityService.success.mockImplementation(() => {
      throw new Error('audit store unavailable');
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'Failed to enforce session limit after OIDC login',
      })
    );
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'Failed to send new session notification',
      })
    );
    expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'Error updating last login date',
    });
    expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'Error logging login activity',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

  it.each([
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.oidcUtils.validateLoginCredentials.mockReturnValue({
          isValid: false,
        });
      },
      error: 'Credentials are required.',
      label: 'missing credentials',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.oidcUtils.validateLoginCredentials.mockReturnValue({
          identifier: 'alice@example.test',
          isValid: true,
          password: 'password',
        });
        harness.config.security.authentication.login.login_methods = ['phone'];
      },
      error: 'This login method is not available.',
      label: 'a disabled login method',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.oidcUtils.validateLoginCredentials.mockReturnValue({
          identifier: 'alice@example.test',
          isValid: true,
          password: 'incorrect-password',
        });
        harness.authService.loginWithEmail.mockResolvedValue(null);
      },
      error: 'Invalid credentials. Please try again.',
      label: 'invalid credentials',
    },
    {
      arrange: (harness: ReturnType<typeof createHarness>) => {
        harness.oidcUtils.validateLoginCredentials.mockReturnValue({
          identifier: 'alice@example.test',
          isValid: true,
          password: 'password',
        });
        harness.oidcUtils.detectIdentifierType.mockImplementation(() => {
          throw new Error('credential parser failed');
        });
      },
      error: 'The credentials you provided are not valid.',
      label: 'an internal login failure',
    },
  ])(
    'renders an empty optional step message for $label',
    async ({ arrange, error }) => {
      const harness = createHarness();
      delete (harness.params as any).step_message;
      arrange(harness);

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next,
        harness.provider as any
      );

      expect(harness.flash.error).toHaveBeenCalledWith(error);
      expect(harness.response.render).toHaveBeenCalledWith(
        'auth/oidc/login',
        expect.objectContaining({ stepMessage: '' })
      );
      expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    }
  );

  it('forwards provider interaction lookup failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('OIDC adapter unavailable');
    harness.provider.interactionDetails.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.next).toHaveBeenCalledWith(error);
    expect(harness.response.render).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'an unavailable reputation result',
      reputation: { success: false },
    },
    {
      label: 'a successful low-risk reputation result',
      reputation: {
        isProxy: false,
        isTor: false,
        isVPN: false,
        riskLevel: 'low',
        success: true,
      },
    },
  ])('does not challenge a known device for $label', async ({ reputation }) => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.ipReputationService.isEnabled.mockReturnValue(true);
    harness.ipReputationService.checkIPReputation.mockResolvedValue(reputation);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

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
      label: 'the current location cannot be resolved',
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
      label: 'the previous location cannot be resolved',
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
  ])('does not challenge a known device when $label', async ({ arrange }) => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      require_2fa_for_new_device: true,
    } as any;
    harness.geolocationService.isEnabled.mockReturnValue(true);
    harness.geolocationService.isHighRiskRegion.mockReturnValue(false);
    arrange(harness);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.redirect).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalledOnce();
  });

  it('uses safe OTP context fallbacks when browser device metadata is absent', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateLoginCredentials.mockReturnValue({
      identifier: 'alice@example.test',
      isValid: true,
      password: 'correct-password',
    });
    harness.config.security.authentication.session = {
      new_device_2fa_method: 'email',
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
    delete (harness.request as any).ip;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
      { email: 'alice@example.test', username: 'alice' },
      '654321',
      { deviceInfo: 'Unknown Device', ip: 'unknown' }
    );
    expect(harness.response.redirect).toHaveBeenCalledOnce();
  });
});
