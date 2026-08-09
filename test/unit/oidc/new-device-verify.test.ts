import { describe, expect, it, vi } from 'vitest';

import { OIDCNewDeviceVerifyHandler } from '../../../src/oidc/flows/handlers/new-device-verify.js';

describe('OIDC new-device verification handler', () => {
  const createHarness = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const authService = {
      verifyEmailOtp: vi.fn(),
      verifyTotp: vi.fn(),
    };
    const activityService = {
      failed: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    };
    const configManager = {
      getConfig: vi.fn(() => ({
        application: { title: 'Parako' },
        oidc: { path: '/oidc/v1' },
        security: {
          protection: {
            device_matching: { trust_duration_days: 30 },
          },
        },
      })),
    };
    const viewResolver = {
      views: {
        auth: {
          oidc: {
            error: 'auth/oidc/error',
            newDeviceVerify: 'auth/oidc/new-device-verify',
          },
        },
      },
    };
    const pendingVerification: {
      userId: string;
      username: string;
      email?: string;
      method: 'totp' | 'email';
      userAccount: { id: string; username: string; email: string };
      device_info: {
        is_new_device: boolean;
        confidence_score: number;
        risk_level: string;
      };
      interactionUid: string;
      clientId: string;
      created_at: number;
    } = {
      userId: 'user-1',
      username: 'alice',
      email: 'alice@example.test',
      method: 'totp' as const,
      userAccount: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.test',
      },
      device_info: {
        is_new_device: true,
        confidence_score: 0.25,
        risk_level: 'high',
      },
      interactionUid: 'interaction-id',
      clientId: 'demo-rp',
      created_at: Date.now(),
    };
    const flash = { error: vi.fn() };
    const sessionManager = {
      enforceSessionLimit: vi.fn(),
      flash: vi.fn(() => flash),
      get: vi.fn((_req, key) => {
        if (key === 'pendingNewDeviceVerification') {
          return pendingVerification;
        }
        if (key === 'csrfToken') return 'csrf-token';
        return undefined;
      }),
      getActiveUser: vi.fn(),
      regenerate: vi.fn(),
      remove: vi.fn(),
      setAuthenticated: vi.fn(),
    };
    const notificationService = {};
    const oidcUtils = { addOrUpdateAccountInSession: vi.fn() };
    const clientDetails = {
      browser: 'Chrome',
      device: 'Desktop',
      fingerprint: 'fingerprint-1',
      ip: '127.0.0.1',
      os: 'Linux',
      user_agent: 'test-agent',
    };
    const clientDeviceInfoManager = {
      getClientInfoFromRequest: vi.fn(() => clientDetails),
    };
    const handler = new OIDCNewDeviceVerifyHandler(
      logger as any,
      authService as any,
      activityService as any,
      configManager as any,
      viewResolver as any,
      sessionManager as any,
      notificationService as any,
      oidcUtils as any,
      clientDeviceInfoManager as any
    );
    const request: {
      body: { code: string; trust_this_device?: string };
      params: { uid: string };
      session: { id: string };
    } = {
      body: { code: '123456' },
      params: { uid: 'interaction-id' },
      session: { id: 'session-1' },
    };
    const response = {
      redirect: vi.fn(),
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const client = { clientId: 'demo-rp' };
    const provider = {
      Client: { find: vi.fn().mockResolvedValue(client) },
      interactionFinished: vi.fn(),
    };
    const next = vi.fn();

    return {
      activityService,
      authService,
      client,
      clientDetails,
      configManager,
      flash,
      handler,
      logger,
      next,
      oidcUtils,
      pendingVerification,
      provider,
      request,
      response,
      sessionManager,
    };
  };

  it('renders a valid pending verification with masked account context', async () => {
    const harness = createHarness();

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.provider.Client.find).toHaveBeenCalledWith('demo-rp');
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/new-device-verify',
      {
        title: 'Verify New Device - Parako',
        method: 'totp',
        email: 'alice@example.test',
        maskedEmail: 'a****@example.test',
        device_info: harness.pendingVerification.device_info,
        uid: 'interaction-id',
        client: harness.client,
        csrfToken: 'csrf-token',
      }
    );
  });

  it('renders a pending verification for an account without email', async () => {
    const harness = createHarness();
    harness.pendingVerification.email = undefined;

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/new-device-verify',
      expect.objectContaining({
        email: undefined,
        maskedEmail: '',
      })
    );
  });

  it('preserves a non-address email value when masking is not possible', async () => {
    const harness = createHarness();
    harness.pendingVerification.email = 'unavailable';

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/new-device-verify',
      expect.objectContaining({ maskedEmail: 'unavailable' })
    );
  });

  it('returns to the interaction when no pending verification exists', async () => {
    const harness = createHarness();
    harness.sessionManager.get.mockReturnValue(undefined);

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
    expect(harness.provider.Client.find).not.toHaveBeenCalled();
  });

  it('renders a safe client error for an invalid GET interaction id', async () => {
    const harness = createHarness();
    harness.request.params.uid = 'short';

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'InvalidRequest',
      errorMessage:
        'The request could not be processed. Please return to the previous page and try again.',
    });
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('forwards GET dependency failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('client store unavailable');
    harness.provider.Client.find.mockRejectedValue(error);

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'New device verification GET error',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });

  it('discards an expired pending verification before rendering it', async () => {
    const harness = createHarness();
    harness.pendingVerification.created_at = Date.now() - 10 * 60 * 1000 - 1;

    await harness.handler.handleGet(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
    expect(harness.response.render).not.toHaveBeenCalled();
  });

  it('discards an expired pending verification before checking its code', async () => {
    const harness = createHarness();
    harness.pendingVerification.created_at = Date.now() - 10 * 60 * 1000 - 1;

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
    expect(harness.authService.verifyTotp).not.toHaveBeenCalled();
    expect(harness.authService.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('returns to the interaction when POST has no pending verification', async () => {
    const harness = createHarness();
    harness.sessionManager.get.mockReturnValue(undefined);

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
    expect(harness.authService.verifyTotp).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('renders a safe client error for an invalid POST body', async () => {
    const harness = createHarness();
    harness.request.body.code = '';

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'InvalidRequest',
      errorMessage:
        'The request could not be processed. Please return to the previous page and try again.',
    });
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('forwards POST verification dependency failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('verification store unavailable');
    harness.authService.verifyTotp.mockRejectedValue(error);

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'New device verification POST error',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('re-renders the challenge after an invalid TOTP code', async () => {
    const harness = createHarness();
    harness.pendingVerification.email = undefined;
    harness.authService.verifyTotp.mockResolvedValue(false);

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.authService.verifyTotp).toHaveBeenCalledWith(
      'alice',
      '123456'
    );
    expect(harness.flash.error).toHaveBeenCalledWith(
      'Invalid verification code. Please try again.'
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/new-device-verify',
      expect.objectContaining({
        method: 'totp',
        maskedEmail: '',
        client: harness.client,
        csrfToken: 'csrf-token',
      })
    );
    expect(harness.sessionManager.remove).not.toHaveBeenCalled();
  });

  it('re-renders the challenge after an invalid email code', async () => {
    const harness = createHarness();
    (harness.pendingVerification as any).method = 'email';
    harness.pendingVerification.email = 'a@example.test';
    harness.authService.verifyEmailOtp.mockResolvedValue(false);

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.authService.verifyEmailOtp).toHaveBeenCalledWith(
      'user-1',
      '123456'
    );
    expect(harness.authService.verifyTotp).not.toHaveBeenCalled();
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/new-device-verify',
      expect.objectContaining({
        method: 'email',
        maskedEmail: 'a***@example.test',
      })
    );
  });

  it('completes a valid TOTP verification without trusting the device', async () => {
    const harness = createHarness();
    harness.authService.verifyTotp.mockResolvedValue(true);
    harness.oidcUtils.addOrUpdateAccountInSession.mockReturnValue(true);

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'pendingNewDeviceVerification'
    );
    expect(harness.sessionManager.regenerate).toHaveBeenCalledWith(
      harness.request
    );
    expect(harness.oidcUtils.addOrUpdateAccountInSession).toHaveBeenCalledWith(
      harness.request,
      harness.pendingVerification.userAccount,
      true
    );
    expect(harness.sessionManager.enforceSessionLimit).toHaveBeenCalledWith(
      'alice',
      'session-1'
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'new_device_verified',
      'New device verified successfully',
      { id: 'user-1', username: 'alice' },
      expect.objectContaining({
        actor: { username: 'alice', actor_type: 'user' },
        target: { target_type: 'session' },
        device_infos: expect.not.objectContaining({
          device_trust: expect.anything(),
        }),
      })
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        login: {
          accountId: 'alice',
          amr: ['pwd', 'otp'],
          remember: false,
        },
      },
      { mergeWithLastSubmission: false }
    );
  });

  it('completes trusted email verification when session bookkeeping fails', async () => {
    const harness = createHarness();
    const regenerateError = new Error('regeneration unavailable');
    const limitError = new Error('session index unavailable');
    (harness.pendingVerification as any).method = 'email';
    harness.request.body.trust_this_device = 'true';
    harness.authService.verifyEmailOtp.mockResolvedValue(true);
    harness.oidcUtils.addOrUpdateAccountInSession.mockReturnValue(false);
    harness.sessionManager.regenerate.mockRejectedValue(regenerateError);
    harness.sessionManager.enforceSessionLimit.mockRejectedValue(limitError);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    harness.pendingVerification.created_at = 900_000;

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.activityService.success).toHaveBeenCalledWith(
      'new_device_verified',
      'New device verified and trusted for 30 days',
      { id: 'user-1', username: 'alice' },
      expect.objectContaining({
        device_infos: expect.objectContaining({
          device_trust: {
            trusted: true,
            trusted_at: new Date(1_000_000),
            trusted_until: new Date(1_000_000 + 30 * 24 * 60 * 60 * 1000),
            fingerprint: 'fingerprint-1',
          },
        }),
      })
    );
    expect(harness.logger.error).toHaveBeenCalledWith(regenerateError, {
      context: 'Failed to regenerate session after new device verification',
    });
    expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
      harness.request,
      { currentActiveLoggedUser: harness.pendingVerification.userAccount }
    );
    expect(harness.logger.error).toHaveBeenCalledWith(limitError, {
      context: 'Failed to enforce session limit after new device verification',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        login: {
          accountId: 'alice',
          amr: ['pwd', 'email'],
          remember: false,
        },
      },
      { mergeWithLastSubmission: false }
    );
  });

  it('uses the default trust duration when configuration is zero', async () => {
    const harness = createHarness();
    harness.request.body.trust_this_device = 'true';
    harness.authService.verifyTotp.mockResolvedValue(true);
    harness.oidcUtils.addOrUpdateAccountInSession.mockReturnValue(true);
    harness.configManager.getConfig.mockReturnValue({
      application: { title: 'Parako' },
      oidc: { path: '/oidc/v1' },
      security: {
        protection: {
          device_matching: { trust_duration_days: 0 },
        },
      },
    });

    await harness.handler.handlePost(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.activityService.success).toHaveBeenCalledWith(
      'new_device_verified',
      'New device verified and trusted for 30 days',
      expect.anything(),
      expect.anything()
    );
  });
});
