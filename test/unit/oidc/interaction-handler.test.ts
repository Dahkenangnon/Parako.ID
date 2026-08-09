import { describe, expect, it, vi } from 'vitest';

import { OIDCInteractionHandler } from '../../../src/oidc/flows/handlers/interaction.js';

describe('OIDC interaction handler', () => {
  const createHarness = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const userDoc = {
      email: 'alice@example.test',
      family_name: 'Doe',
      given_name: 'Alice',
      mfa: { enabled: true, methods: ['totp'], preferred_method: 'totp' },
      username: 'alice',
    };
    const userService = {
      findByUsername: vi.fn().mockResolvedValue(userDoc),
      setEmailOtp: vi.fn(),
      updateUserLastLoginDate: vi.fn(),
    };
    const configManager = {
      getConfig: vi.fn(() => ({
        application: { title: 'Parako' },
        deployment: { url: 'https://idp.example.test' },
        oidc: { path: '/oidc/v1' },
      })),
    };
    const viewResolver = {
      views: {
        auth: {
          account_select: 'auth/account-select',
          oidc: {
            consent: 'auth/oidc/consent',
            error: 'auth/oidc/error',
            login: 'auth/oidc/login',
            mfa: 'auth/oidc/mfa',
            mfa_select: 'auth/oidc/mfa-select',
            mfa_webauthn: 'auth/oidc/mfa-webauthn',
          },
        },
      },
    };
    const sessionManager = {
      generateCsrfToken: vi.fn(),
      get: vi.fn((_req: unknown, key: string): string | null =>
        key === 'csrfToken' ? 'csrf-token' : null
      ),
      getActiveUser: vi.fn((): { id: string; username: string } | null => ({
        id: 'user-1',
        username: 'alice',
      })),
      getAuthenticatedUsers: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      set: vi.fn(),
    };
    const notificationService = { sendTemplatedEmail: vi.fn() };
    const mfaUtils = {
      generateEmailOtp: vi.fn(() => ({ code: '123456' })),
      getEnabledMethods: vi.fn((): string[] => ['totp']),
    };
    const oidcUtils = {
      formatUserForTemplate: vi.fn(),
      prepareAccountsList: vi.fn(),
      prepareTemplateVariables: vi.fn((): Record<string, unknown> => ({
        missingOIDCScope: [],
      })),
      transformScopesForTemplate: vi.fn(),
    };
    const handler = new OIDCInteractionHandler(
      logger as any,
      userService as any,
      configManager as any,
      viewResolver as any,
      sessionManager as any,
      notificationService as any,
      mfaUtils as any,
      oidcUtils as any
    );
    const interactionDetails: {
      uid: string;
      grantId?: string;
      prompt: { name: string; details: Record<string, unknown> };
      params: { client_id: string; redirect_uri: string };
      session: { accountId: string };
    } = {
      uid: 'interaction-id',
      prompt: { name: 'mfa', details: {} },
      params: {
        client_id: 'demo-rp',
        redirect_uri: 'https://rp.example.test/callback',
      },
      session: { accountId: 'alice' },
    };
    const client = { clientId: 'demo-rp', isInternalClient: false };
    const provider = {
      Client: { find: vi.fn().mockResolvedValue(client) },
      interactionDetails: vi.fn().mockResolvedValue(interactionDetails),
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };
    const request = {};
    const response = {
      getHeader: vi.fn(),
      locals: {},
      redirect: vi.fn(),
      render: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    return {
      client,
      configManager,
      handler,
      interactionDetails,
      logger,
      mfaUtils,
      next,
      notificationService,
      oidcUtils,
      provider,
      request,
      response,
      sessionManager,
      userDoc,
      userService,
    };
  };

  it('fails closed when MFA account loading fails', async () => {
    const harness = createHarness();
    const error = new Error('MFA storage unavailable');
    harness.userService.findByUsername.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.next).toHaveBeenCalledWith(error);
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('renders the login interaction for an unauthenticated browser session', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    Object.assign(harness.interactionDetails.params, {
      step_message: '  Sign in to continue  ',
    });
    harness.sessionManager.isAuthenticated.mockResolvedValue(false);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/login', {
      client: harness.client,
      uid: 'interaction-id',
      details: {},
      params: harness.interactionDetails.params,
      title: 'Sign-in - Parako',
      stepMessage: 'Sign in to continue',
      csrfToken: 'csrf-token',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('initializes a CSRF token before rendering an interaction form', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.isAuthenticated.mockResolvedValue(false);
    harness.sessionManager.get
      .mockReturnValueOnce(null)
      .mockReturnValue('generated-csrf-token');

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.generateCsrfToken).toHaveBeenCalledWith(
      harness.request
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.objectContaining({ csrfToken: 'generated-csrf-token' })
    );
  });

  it('continues an authenticated login and refreshes its usage timestamps', async () => {
    const harness = createHarness();
    const active = { id: 'user-1', username: 'alice', last_used: 0 };
    const authenticatedUsers = { active, others: [] };
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.getActiveUser.mockReturnValue(active);
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue(
      authenticatedUsers
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(active.last_used).toBe(123_456);
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'authenticatedUsers',
      authenticatedUsers
    );
    expect(harness.userService.updateUserLastLoginDate).toHaveBeenCalledWith(
      'user-1',
      'alice'
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { login: { accountId: 'alice' } },
      { mergeWithLastSubmission: false }
    );
  });

  it('continues an authenticated login when timestamp persistence fails', async () => {
    const harness = createHarness();
    const sessionError = new Error('session store unavailable');
    const userError = new Error('user store unavailable');
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.getAuthenticatedUsers.mockImplementation(() => {
      throw sessionError;
    });
    harness.userService.updateUserLastLoginDate.mockRejectedValue(userError);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(sessionError, {
      context: 'Error updating lastUsed timestamp',
    });
    expect(harness.logger.error).toHaveBeenCalledWith(userError, {
      context: 'Error updating last login date',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { login: { accountId: 'alice' } },
      { mergeWithLastSubmission: false }
    );
  });

  it('continues an authenticated login without an account registry entry', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.set).not.toHaveBeenCalled();
    expect(harness.userService.updateUserLastLoginDate).toHaveBeenCalledWith(
      'user-1',
      'alice'
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it('renders a usable login form when an authenticated session has no active user', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.getActiveUser.mockReturnValue(null);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith('auth/oidc/login', {
      client: harness.client,
      uid: 'interaction-id',
      details: {},
      params: harness.interactionDetails.params,
      title: 'Sign-in - Parako',
      stepMessage: '',
      csrfToken: 'csrf-token',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('rejects internal-client consent without an authenticated OIDC session', async () => {
    const harness = createHarness();
    harness.client.isInternalClient = true;
    harness.interactionDetails.prompt = { name: 'consent', details: {} };
    harness.interactionDetails.session = undefined as any;

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

  it('automatically grants all requested permissions to a trusted internal client', async () => {
    const harness = createHarness();
    const grant = {
      addOIDCClaims: vi.fn(),
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-1'),
    };
    const Grant = vi.fn(function (this: any, input: unknown) {
      Object.assign(this, grant, { input });
    });
    (harness.provider as any).Grant = Grant;
    harness.client.isInternalClient = true;
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: {
        missingOIDCClaims: ['email'],
        missingOIDCScope: ['openid', 'profile'],
        missingResourceScopes: {
          'https://api.example.test': ['read', 'write'],
        },
      },
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(Grant).toHaveBeenCalledWith({
      accountId: 'alice',
      clientId: 'demo-rp',
    });
    expect(grant.addOIDCScope).toHaveBeenCalledWith('openid profile');
    expect(grant.addOIDCClaims).toHaveBeenCalledWith(['email']);
    expect(grant.addResourceScope).toHaveBeenCalledWith(
      'https://api.example.test',
      'read write'
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { consent: { grantId: 'grant-1' } },
      { mergeWithLastSubmission: true }
    );
  });

  it('reuses an existing grant for a trusted internal client', async () => {
    const harness = createHarness();
    const grant = {
      addOIDCClaims: vi.fn(),
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('existing-grant'),
    };
    const find = vi.fn().mockResolvedValue(grant);
    (harness.provider as any).Grant = { find };
    harness.client.isInternalClient = true;
    harness.interactionDetails.grantId = 'existing-grant';
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: {},
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(find).toHaveBeenCalledWith('existing-grant');
    expect(grant.save).toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      { consent: {} },
      { mergeWithLastSubmission: true }
    );
  });

  it('ignores malformed permission lists for a trusted internal client', async () => {
    const harness = createHarness();
    const grant = {
      addOIDCClaims: vi.fn(),
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-1'),
    };
    (harness.provider as any).Grant = vi.fn(function (this: any) {
      Object.assign(this, grant);
    });
    harness.client.isInternalClient = true;
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: {
        missingOIDCClaims: 'email',
        missingOIDCScope: 'openid',
        missingResourceScopes: {
          'https://api.example.test': 'read',
        },
      },
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(grant.addOIDCScope).not.toHaveBeenCalled();
    expect(grant.addOIDCClaims).not.toHaveBeenCalled();
    expect(grant.addResourceScope).not.toHaveBeenCalled();
    expect(grant.save).toHaveBeenCalled();
  });

  it('returns an MFA prompt without an active browser account to the interaction', async () => {
    const harness = createHarness();
    harness.sessionManager.getActiveUser.mockReturnValue(null);

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

  it('completes password authentication when the account has no MFA configuration', async () => {
    const harness = createHarness();
    harness.userService.findByUsername.mockResolvedValue({
      username: 'alice',
    });
    vi.spyOn(Date, 'now').mockReturnValue(123_456_000);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        login: {
          accountId: 'alice',
          amr: ['pwd'],
          acr: 'urn:pwd',
        },
        ts: 123_456,
      },
      { mergeWithLastSubmission: false }
    );
  });

  it('completes password authentication when no configured MFA method is usable', async () => {
    const harness = createHarness();
    harness.mfaUtils.getEnabledMethods.mockReturnValue([]);

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
        login: {
          accountId: 'alice',
          amr: ['pwd'],
          acr: 'urn:pwd',
        },
      }),
      { mergeWithLastSubmission: false }
    );
  });

  it('renders method selection when multiple MFA methods are available', async () => {
    const harness = createHarness();
    harness.mfaUtils.getEnabledMethods.mockReturnValue([
      'totp',
      'email',
      'webauthn',
    ]);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/mfa-select',
      expect.objectContaining({
        enabledMethods: { totp: true, email: true, webauthn: true },
        selectUrl: '/oidc/v1/interaction/interaction-id/mfa/select',
        csrfToken: 'csrf-token',
      })
    );
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('renders WebAuthn verification after that MFA method is selected', async () => {
    const harness = createHarness();
    harness.mfaUtils.getEnabledMethods.mockReturnValue(['totp', 'webauthn']);
    harness.sessionManager.get.mockImplementation((_req, key) =>
      key === 'selectedMfaMethod' ? 'webauthn' : 'csrf-token'
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'selectedMfaMethod',
      null
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/mfa-webauthn',
      expect.objectContaining({
        user: expect.objectContaining({
          username: 'alice',
          mfa_method: 'webauthn',
        }),
        csrfToken: 'csrf-token',
      })
    );
  });

  it('renders TOTP verification when it is the preferred enabled method', async () => {
    const harness = createHarness();

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.info).toHaveBeenCalledWith(
      'TOTP MFA requested for user',
      { username: 'alice' }
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/mfa',
      expect.objectContaining({
        user: expect.objectContaining({ mfa_method: 'totp' }),
        csrfToken: 'csrf-token',
      })
    );
  });

  it('fails closed when an enabled MFA method has no interaction implementation', async () => {
    const harness = createHarness();
    harness.mfaUtils.getEnabledMethods.mockReturnValue(['sms']);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unsupported MFA method: sms' })
    );
    expect(harness.response.render).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('falls back to an enabled MFA method when the stored preference is stale', async () => {
    const harness = createHarness();
    harness.mfaUtils.getEnabledMethods.mockReturnValue(['email']);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.mfaUtils.generateEmailOtp).toHaveBeenCalledWith(600);
    expect(harness.userService.setEmailOtp).toHaveBeenCalledWith(
      'alice',
      '123456',
      600
    );
    expect(harness.notificationService.sendTemplatedEmail).toHaveBeenCalled();
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/mfa',
      expect.objectContaining({
        user: expect.objectContaining({ mfa_method: 'email' }),
      })
    );
  });

  it('renders email MFA safely for a user with a sparse profile', async () => {
    const harness = createHarness();
    harness.userDoc.mfa.preferred_method = 'email';
    harness.mfaUtils.getEnabledMethods.mockReturnValue(['email']);
    delete (harness.userDoc as any).email;
    delete (harness.userDoc as any).given_name;
    delete (harness.userDoc as any).family_name;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
      '',
      'Your Parako login code',
      'email/mail.njk',
      expect.objectContaining({ username: '' })
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/mfa',
      expect.objectContaining({
        user: expect.objectContaining({ mfa_method: 'email' }),
      })
    );
  });

  it('renders requested scopes and user context for external-client consent', async () => {
    const harness = createHarness();
    Object.assign(harness.client, {
      clientName: 'Example RP',
      logoUri: 'https://rp.example.test/logo.png',
      policyUri: 'https://rp.example.test/policy',
      tosUri: 'https://rp.example.test/terms',
      clientUri: 'https://rp.example.test',
    });
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: { missingOIDCScope: ['openid', 'email'] },
    };
    const formattedUser = { username: 'alice', email: 'alice@example.test' };
    const scopes = [{ name: 'openid' }, { name: 'email' }];
    harness.oidcUtils.prepareTemplateVariables.mockReturnValue({
      missingOIDCScope: ['openid', 'email'],
    });
    harness.oidcUtils.formatUserForTemplate.mockReturnValue(formattedUser);
    harness.oidcUtils.transformScopesForTemplate.mockReturnValue(scopes);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/consent',
      expect.objectContaining({
        client: {
          clientName: 'Example RP',
          clientId: 'demo-rp',
          policyUri: 'https://rp.example.test/policy',
          tosUri: 'https://rp.example.test/terms',
          clientUri: 'https://rp.example.test',
          logoUri: 'https://rp.example.test/logo.png',
        },
        user: formattedUser,
        scopes,
        csrfToken: 'csrf-token',
      })
    );
  });

  it('renders snake_case metadata for an external-client consent', async () => {
    const harness = createHarness();
    delete (harness.client as any).clientId;
    Object.assign(harness.client, {
      client_id: 'snake-rp',
      client_name: 'Snake RP',
      client_uri: 'https://snake.example.test',
      logo_uri: 'https://snake.example.test/logo.png',
      policy_uri: 'https://snake.example.test/policy',
      tos_uri: 'https://snake.example.test/terms',
    });
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: { missingOIDCScope: [] },
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/consent',
      expect.objectContaining({
        client: {
          clientName: 'Snake RP',
          clientId: 'snake-rp',
          policyUri: 'https://snake.example.test/policy',
          tosUri: 'https://snake.example.test/terms',
          clientUri: 'https://snake.example.test',
          logoUri: 'https://snake.example.test/logo.png',
        },
      })
    );
  });

  it('uses safe presentation defaults for minimal external-client metadata', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = {
      name: 'consent',
      details: { missingOIDCScope: [] },
    };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/consent',
      expect.objectContaining({
        client: {
          clientName: 'Application',
          clientId: 'demo-rp',
          policyUri: undefined,
          tosUri: undefined,
          clientUri: undefined,
          logoUri: '/images/logo-light.png',
        },
      })
    );
  });

  it('renders a sign-in recovery choice when account selection has no accounts', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = {
      name: 'select_account',
      details: {},
    };
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/account-select',
      expect.objectContaining({
        accounts: [],
        noAccountsAvailable: true,
        continueUrl:
          'https://idp.example.test/oidc/v1/interaction/interaction-id',
        csrfToken: 'csrf-token',
      })
    );
  });

  it('renders sign-in recovery when the account registry has no active or alternate account', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = {
      name: 'select_account',
      details: {},
    };
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: null,
      others: undefined,
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/account-select',
      expect.objectContaining({
        accounts: [],
        noAccountsAvailable: true,
      })
    );
    expect(harness.oidcUtils.prepareAccountsList).not.toHaveBeenCalled();
  });

  it('renders sign-in recovery when the alternate-account list is empty', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = {
      name: 'select_account',
      details: {},
    };
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: null,
      others: [],
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/account-select',
      expect.objectContaining({
        accounts: [],
        noAccountsAvailable: true,
      })
    );
    expect(harness.oidcUtils.prepareAccountsList).not.toHaveBeenCalled();
  });

  it('renders the accounts available for selection', async () => {
    const harness = createHarness();
    const authenticatedUsers = {
      active: { id: 'user-1', username: 'alice' },
      others: [{ id: 'user-2', username: 'bob' }],
    };
    const accounts = [
      { id: 'user-1', username: 'alice' },
      { id: 'user-2', username: 'bob' },
    ];
    harness.interactionDetails.prompt = {
      name: 'select_account',
      details: {},
    };
    harness.sessionManager.getAuthenticatedUsers.mockReturnValue(
      authenticatedUsers
    );
    harness.oidcUtils.prepareAccountsList.mockReturnValue(accounts);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.oidcUtils.prepareAccountsList).toHaveBeenCalledWith(
      authenticatedUsers
    );
    expect(harness.response.locals).toEqual(
      expect.objectContaining({ csrfToken: 'csrf-token' })
    );
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/account-select',
      expect.objectContaining({
        accounts,
        continueUrl:
          'https://idp.example.test/oidc/v1/interaction/interaction-id',
      })
    );
  });

  it('delegates an unknown interaction prompt to the next handler', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'custom_prompt', details: {} };

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.next).toHaveBeenCalledWith();
    expect(harness.response.render).not.toHaveBeenCalled();
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('forwards provider interaction failures to Express', async () => {
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
      context: 'Error in interaction handler',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });

  it('allows the registered redirect origin in the interaction form CSP', async () => {
    const harness = createHarness();
    harness.interactionDetails.prompt = { name: 'login', details: {} };
    harness.sessionManager.isAuthenticated.mockResolvedValue(false);
    harness.response.getHeader.mockReturnValue(
      "default-src 'self'; form-action 'self'"
    );

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'self'; form-action 'self' https://rp.example.test"
    );
  });
});
