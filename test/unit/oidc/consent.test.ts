import { describe, expect, it, vi } from 'vitest';

import { OIDCConsentHandler } from '../../../src/oidc/flows/handlers/consent.js';

describe('OIDC consent handler', () => {
  const createGrant = (savedId = 'grant-1') => ({
    addOIDCClaims: vi.fn(),
    addOIDCScope: vi.fn(),
    addResourceScope: vi.fn(),
    save: vi.fn().mockResolvedValue(savedId),
  });

  const createHarness = () => {
    const createdGrants: Array<
      ReturnType<typeof createGrant> & { input: unknown }
    > = [];
    const existingGrant = createGrant('existing-grant');

    function Grant(
      this: ReturnType<typeof createGrant> & { input: unknown },
      input: unknown
    ) {
      Object.assign(this, createGrant(), { input });
      createdGrants.push(this);
    }
    Grant.find = vi.fn().mockResolvedValue(existingGrant);

    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const activityService = { success: vi.fn() };
    const clientDeviceInfoManager = {
      getClientInfoFromRequest: vi.fn(() => ({
        ip: '127.0.0.1',
        user_agent: 'test',
      })),
    };
    const sessionManager = { getActiveUser: vi.fn(() => null) };
    const oidcUtils = { syncSessionAfterConsent: vi.fn() };
    const viewResolver = {
      views: { auth: { oidc: { error: 'auth/oidc/error' } } },
    };
    const interactionDetails = {
      prompt: {
        name: 'consent',
        details: {
          missingOIDCScope: ['openid', 'profile'],
          missingOIDCClaims: ['email', 'email_verified'],
          missingResourceScopes: {
            'https://api.example.test': ['read', 'write'],
          },
        },
      },
      params: { client_id: 'demo-rp' },
      session: { accountId: 'user-1' },
    };
    const provider = {
      Grant,
      interactionDetails: vi.fn().mockResolvedValue(interactionDetails),
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new OIDCConsentHandler(
      logger as any,
      activityService as any,
      viewResolver as any,
      oidcUtils as any,
      clientDeviceInfoManager as any,
      sessionManager as any
    );
    const request = { params: { uid: 'a'.repeat(20) } };
    const response = {
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    return {
      activityService,
      clientDeviceInfoManager,
      createdGrants,
      existingGrant,
      Grant,
      handler,
      interactionDetails,
      logger,
      next,
      oidcUtils,
      provider,
      request,
      response,
      sessionManager,
    };
  };

  it('creates and completes a grant with every requested scope and claim', async () => {
    const harness = createHarness();

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.createdGrants).toHaveLength(1);
    const grant = harness.createdGrants[0];
    expect(grant.input).toEqual({ accountId: 'user-1', clientId: 'demo-rp' });
    expect(grant.addOIDCScope).toHaveBeenCalledWith('openid profile');
    expect(grant.addOIDCClaims).toHaveBeenCalledWith([
      'email',
      'email_verified',
    ]);
    expect(grant.addResourceScope).toHaveBeenCalledWith(
      'https://api.example.test',
      'read write'
    );
    expect(grant.save).toHaveBeenCalledOnce();
    expect(harness.oidcUtils.syncSessionAfterConsent).toHaveBeenCalledWith(
      harness.request,
      'user-1'
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { consent: { grantId: 'grant-1' } },
      { mergeWithLastSubmission: true }
    );
    expect(harness.activityService.success).toHaveBeenCalledWith(
      'oidc.confirm',
      'User consented to OIDC grant',
      null,
      expect.objectContaining({
        client_id: 'demo-rp',
        actor: { username: 'user-1', actor_type: 'user' },
      })
    );
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('updates an existing grant without replacing the interaction grant id', async () => {
    const harness = createHarness();
    Object.assign(harness.interactionDetails, {
      grantId: 'existing-grant',
      prompt: { name: 'consent', details: {} },
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.Grant.find).toHaveBeenCalledWith('existing-grant');
    expect(harness.createdGrants).toHaveLength(0);
    expect(harness.existingGrant.save).toHaveBeenCalledOnce();
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { consent: {} },
      { mergeWithLastSubmission: true }
    );
  });

  it('ignores malformed optional missing-scope collections', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt.details = {
      missingOIDCScope: 'openid' as any,
      missingOIDCClaims: 'email' as any,
      missingResourceScopes: {
        'https://api.example.test': 'read',
      } as any,
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    const grant = harness.createdGrants[0];
    expect(grant.addOIDCScope).not.toHaveBeenCalled();
    expect(grant.addOIDCClaims).not.toHaveBeenCalled();
    expect(grant.addResourceScope).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
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
      errorMessage:
        'Your session has expired or is invalid. Please try authenticating again.',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('renders a 400 error when the interaction is not awaiting consent', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt.name = 'login';

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'InvalidPrompt',
      errorMessage: 'Invalid interaction prompt. Expected consent prompt.',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('renders a safe 400 page for an invalid interaction id', async () => {
    const harness = createHarness();
    harness.request.params.uid = 'short';

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
  });

  it('continues consent completion when activity recording fails', async () => {
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
      context: 'Error logging consent activity',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it('forwards provider failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('interaction expired');
    harness.provider.interactionDetails.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error in consent handler',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });
});
