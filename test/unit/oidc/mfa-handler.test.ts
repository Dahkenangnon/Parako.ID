import { afterEach, describe, expect, it, vi } from 'vitest';

import { OIDCMfaHandler } from '../../../src/oidc/flows/handlers/mfa.js';

describe('OIDC MFA handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createHarness = () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const userDoc = { id: 'user-1', username: 'alice', mfa: { enabled: true } };
    const userService = {
      findByUsername: vi.fn().mockResolvedValue(userDoc),
      verifyEmailOtp: vi.fn().mockResolvedValue(true),
    };
    const authService = { verifyTotp: vi.fn().mockResolvedValue(true) };
    const activityService = { failed: vi.fn(), success: vi.fn() };
    const configManager = {
      getConfig: vi.fn(() => ({ oidc: { path: '/oidc/v1' } })),
    };
    const viewResolver = {
      views: { auth: { oidc: { error: 'auth/oidc/error' } } },
    };
    const flash = { error: vi.fn() };
    const sessionManager = {
      flash: vi.fn(() => flash),
      getActiveUser: vi.fn(() => ({ id: 'user-1', username: 'alice' })),
    };
    const clientDeviceInfoManager = {
      getClientInfoFromRequest: vi.fn(() => ({
        ip: '127.0.0.1',
        user_agent: 'test',
      })),
    };
    const mfaUtils = {
      getPreferredMethod: vi.fn(() => 'totp'),
      isMfaEnabled: vi.fn(() => true),
    };
    const oidcUtils = {
      validateMfaCode: vi.fn<() => { isValid: boolean; code?: string }>(() => ({
        isValid: true,
        code: '123456',
      })),
    };
    const handler = new OIDCMfaHandler(
      logger as any,
      userService as any,
      authService as any,
      activityService as any,
      configManager as any,
      viewResolver as any,
      sessionManager as any,
      clientDeviceInfoManager as any,
      mfaUtils as any,
      oidcUtils as any
    );
    const interactionDetails = {
      session: { accountId: 'alice', amr: ['pwd'] },
      params: { client_id: 'demo-rp' },
    };
    const provider = {
      interactionDetails: vi.fn().mockResolvedValue(interactionDetails),
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };
    const request = {
      body: { code: '123456', method: 'totp' },
      params: { uid: 'a'.repeat(20) },
    };
    const response = {
      redirect: vi.fn(),
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    return {
      activityService,
      authService,
      flash,
      handler,
      interactionDetails,
      logger,
      mfaUtils,
      next,
      oidcUtils,
      provider,
      request,
      response,
      userDoc,
      userService,
    };
  };

  it('verifies TOTP and completes the interaction with MFA authentication', async () => {
    const harness = createHarness();
    vi.spyOn(Date, 'now').mockReturnValue(123_456_000);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.authService.verifyTotp).toHaveBeenCalledWith(
      'alice',
      '123456'
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        login: {
          accountId: 'alice',
          acr: 'urn:mfa:otp',
          amr: ['pwd', 'otp'],
        },
        ts: 123_456,
      },
      { mergeWithLastSubmission: true }
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'oidc.mfa.verification',
      'MFA verification successful',
      harness.userDoc,
      expect.objectContaining({ client_id: 'demo-rp' })
    );
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing otp authentication method', async () => {
    const harness = createHarness();
    harness.interactionDetails.session.amr = ['pwd', 'otp'];

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: expect.objectContaining({ amr: ['pwd', 'otp'] }),
      }),
      expect.anything()
    );
  });

  it('defaults missing session AMR to password authentication', async () => {
    const harness = createHarness();
    delete (harness.interactionDetails.session as any).amr;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: expect.objectContaining({ amr: ['pwd', 'otp'] }),
      }),
      expect.anything()
    );
  });

  it('verifies an email OTP when explicitly requested', async () => {
    const harness = createHarness();
    harness.request.body.method = 'email';

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.userService.verifyEmailOtp).toHaveBeenCalledWith(
      'alice',
      '123456'
    );
    expect(harness.authService.verifyTotp).not.toHaveBeenCalled();
  });

  it('uses the user preferred MFA method when none is submitted', async () => {
    const harness = createHarness();
    delete (harness.request.body as any).method;
    harness.mfaUtils.getPreferredMethod.mockReturnValue('email');

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.userService.verifyEmailOtp).toHaveBeenCalled();
  });

  it.each([
    { name: 'missing session', session: undefined },
    { name: 'missing account id', session: {} },
  ])('renders a 400 error for $name', async ({ session }) => {
    const harness = createHarness();
    harness.interactionDetails.session = session as any;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'SessionNotFound',
      errorMessage: 'Session expired. Please login again.',
    });
  });

  it('redirects with a validation error when the code is absent', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateMfaCode.mockReturnValue({ isValid: false });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.error).toHaveBeenCalledWith('Code is required');
    expect(harness.response.redirect).toHaveBeenCalledWith(
      `/oidc/v1/interaction/${'a'.repeat(20)}`
    );
  });

  it('rejects verification when the account no longer exists', async () => {
    const harness = createHarness();
    harness.userService.findByUsername.mockResolvedValue(null);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'User not found for MFA verification',
      { accountId: 'alice' }
    );
    expect(harness.flash.error).toHaveBeenCalledWith('Invalid or expired code');
    expect(harness.activityService.failed).toHaveBeenCalled();
  });

  it('rejects unsupported submitted MFA methods', async () => {
    const harness = createHarness();
    harness.request.body.method = 'backup_codes';

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'MFA verification attempted for unsupported method',
      expect.objectContaining({ method: 'backup_codes' })
    );
    expect(harness.flash.error).toHaveBeenCalledWith('Invalid or expired code');
  });

  it('fails closed when OTP verification throws', async () => {
    const harness = createHarness();
    const error = new Error('verification backend unavailable');
    harness.authService.verifyTotp.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'OTP verification error',
      accountId: 'alice',
      errorMessage: 'verification backend unavailable',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
    expect(harness.response.redirect).toHaveBeenCalled();
  });

  it('continues rejection when failed-attempt activity recording fails', async () => {
    const harness = createHarness();
    harness.authService.verifyTotp.mockResolvedValue(false);
    const error = new Error('audit unavailable');
    harness.activityService.failed.mockImplementation(() => {
      throw error;
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error logging failed MFA activity',
    });
    expect(harness.response.redirect).toHaveBeenCalled();
  });

  it('continues completion when success activity recording fails', async () => {
    const harness = createHarness();
    const error = new Error('audit unavailable');
    harness.activityService.success.mockImplementation(() => {
      throw error;
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error logging successful MFA activity',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it.each([
    { field: 'uid', value: 'short' },
    { field: 'method', value: 'invalid-method' },
  ])(
    'renders a safe 400 page for invalid $field input',
    async ({ field, value }) => {
      const harness = createHarness();
      if (field === 'uid') {
        harness.request.params.uid = value;
      } else {
        harness.request.body.method = value;
      }

      await harness.handler.handle(
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
    }
  );

  it('forwards provider completion failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('interaction expired');
    harness.provider.interactionFinished.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error in MFA handler',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });
});
