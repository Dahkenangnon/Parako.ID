import { describe, expect, it, vi } from 'vitest';

import { OIDCSelectAccountHandler } from '../../../src/oidc/flows/handlers/select-account.js';

describe('OIDC select-account handler', () => {
  const createHarness = () => {
    const active = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.test',
      last_used: 0,
    };
    const other = {
      id: 'user-2',
      username: 'bob',
      email: 'bob@example.test',
      last_used: 0,
    };
    const authenticatedUsers = { active, others: [other] };
    const flash = { error: vi.fn(), info: vi.fn() };
    const sessionManager = {
      flash: vi.fn(() => flash),
      getActiveUser: vi.fn(() => active),
      getAuthenticatedUsers: vi.fn<() => typeof authenticatedUsers | undefined>(
        () => authenticatedUsers
      ),
      set: vi.fn(),
      switchUser: vi.fn<() => { success: boolean; reason?: string }>(() => ({
        success: true,
      })),
    };
    const provider = {
      interactionDetails: vi.fn().mockResolvedValue({
        params: { client_id: 'demo-rp' },
        prompt: { name: 'select_account' },
        uid: 'interaction-id',
      }),
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const activityService = {
      success: vi.fn(),
    };
    const clientDeviceInfoManager = {
      getClientInfoFromRequest: vi.fn(() => ({
        ip: '127.0.0.1',
        user_agent: 'test',
      })),
    };
    const oidcUtils = {
      validateAccountSelection: vi.fn<
        () => { accountId?: string; isValid: boolean }
      >(() => ({
        accountId: 'alice',
        isValid: true,
      })),
    };
    const response = { redirect: vi.fn(), render: vi.fn() };
    const next = vi.fn();
    const request = {};
    const handler = new (OIDCSelectAccountHandler as any)(
      logger,
      activityService,
      { getConfig: vi.fn(() => ({ oidc: { path: '/oidc/v1' } })) },
      { views: { auth: { oidc: { error: 'auth/oidc/error' } } } },
      sessionManager,
      clientDeviceInfoManager,
      oidcUtils
    );

    return {
      active,
      activityService,
      authenticatedUsers,
      clientDeviceInfoManager,
      flash,
      handler,
      logger,
      next,
      oidcUtils,
      other,
      provider,
      request,
      response,
      sessionManager,
    };
  };

  it('marks select_account as satisfied when completing the interaction', async () => {
    const harness = createHarness();

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
        login: expect.objectContaining({
          accountId: 'alice',
          amr: ['pwd', 'select_account'],
        }),
      }),
      { mergeWithLastSubmission: false }
    );
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'authenticatedUsers',
      harness.authenticatedUsers
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'oidc.select_account',
      'User selected account for OIDC login',
      null,
      expect.objectContaining({ client_id: 'demo-rp' })
    );
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('renders an error for a non-selection prompt', async () => {
    const harness = createHarness();
    harness.provider.interactionDetails.mockResolvedValue({
      params: {},
      prompt: { name: 'login' },
      uid: 'interaction-id',
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'InvalidPrompt',
      errorMessage:
        'Invalid interaction prompt. Expected select_account prompt.',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('redirects back when account selection validation fails', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateAccountSelection.mockReturnValue({
      isValid: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.error).toHaveBeenCalledWith(
      'Please select an account to continue.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it.each([
    { name: 'ID', accountId: 'user-1' },
    { name: 'username', accountId: 'alice' },
  ])('selects the active account by $name', async ({ accountId }) => {
    const harness = createHarness();
    harness.oidcUtils.validateAccountSelection.mockReturnValue({
      accountId,
      isValid: true,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.switchUser).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it.each([
    { name: 'ID', accountId: 'user-2' },
    { name: 'username', accountId: 'bob' },
  ])(
    'selects and switches to another account by $name',
    async ({ accountId }) => {
      const harness = createHarness();
      harness.oidcUtils.validateAccountSelection.mockReturnValue({
        accountId,
        isValid: true,
      });

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next,
        harness.provider as any
      );

      expect(harness.sessionManager.switchUser).toHaveBeenCalledWith(
        harness.request,
        'user-2'
      );
      expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
        harness.request,
        harness.response,
        expect.objectContaining({
          login: expect.objectContaining({ accountId: 'bob' }),
        }),
        expect.anything()
      );
    }
  );

  it('rejects a selected account that is absent from the session', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateAccountSelection.mockReturnValue({
      accountId: 'missing',
      isValid: true,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Selected account not found in session',
      { selectedAccountId: 'missing' }
    );
    expect(harness.flash.error).toHaveBeenCalledWith(
      'The selected account is no longer available.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('rejects selection when the browser session has no accounts', async () => {
    const harness = createHarness();
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('requests reauthentication when switching a stale account', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateAccountSelection.mockReturnValue({
      accountId: 'bob',
      isValid: true,
    });
    harness.sessionManager.switchUser.mockReturnValue({
      reason: 'reauth_required',
      success: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.info).toHaveBeenCalledWith(
      'Please re-enter your password to switch accounts.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id?switch_to=user-2'
    );
  });

  it('reports a failed account switch', async () => {
    const harness = createHarness();
    harness.oidcUtils.validateAccountSelection.mockReturnValue({
      accountId: 'bob',
      isValid: true,
    });
    harness.sessionManager.switchUser.mockReturnValue({
      reason: 'store_unavailable',
      success: false,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.error).toHaveBeenCalledWith(
      'Failed to switch to the selected account.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('continues when the last-used timestamp cannot be updated', async () => {
    const harness = createHarness();
    Object.defineProperty(harness.active, 'last_used', {
      configurable: false,
      set: () => {
        throw new Error('session is read-only');
      },
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'session is read-only' }),
      { context: 'Error updating lastUsed timestamp' }
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it('continues when activity logging fails', async () => {
    const harness = createHarness();
    harness.activityService.success.mockImplementation(() => {
      throw new Error('audit unavailable');
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'audit unavailable' }),
      { context: 'Error logging account selection activity' }
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it('redirects back when interaction completion fails', async () => {
    const harness = createHarness();
    harness.provider.interactionFinished.mockRejectedValue(
      new Error('interaction expired')
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.flash.error).toHaveBeenCalledWith(
      'Failed to complete account selection. Please try again.'
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      '/oidc/v1/interaction/interaction-id'
    );
  });

  it('forwards interaction-detail failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('interaction unavailable');
    harness.provider.interactionDetails.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.next).toHaveBeenCalledWith(error);
    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error in select account handler',
    });
  });
});
