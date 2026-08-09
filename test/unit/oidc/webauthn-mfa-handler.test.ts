import { describe, expect, it, vi } from 'vitest';

import { OIDCWebAuthnMfaHandler } from '../../../src/oidc/flows/handlers/webauthn-mfa.js';

describe('OIDC WebAuthn MFA handler', () => {
  const createHarness = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const userDoc = {
      username: 'alice',
      mfa: {
        enabled: true,
        methods: {
          webauthn: { enabled: true, credentials: [{ id: 'credential-1' }] },
        },
      },
    };
    const userService = {
      findByUsername: vi.fn().mockResolvedValue(userDoc),
    };
    const activityService = {
      failed: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    };
    const configManager = {
      getConfig: vi.fn<
        () => {
          deployment: { url?: string };
          oidc: { path: string };
          security: {
            authentication: {
              multi_factor: { webauthn: { rp_id: string } };
            };
          };
        }
      >(() => ({
        deployment: { url: 'https://idp.example.test/oidc/v1' },
        oidc: { path: '/oidc/v1' },
        security: {
          authentication: {
            multi_factor: {
              webauthn: { rp_id: 'idp.example.test' },
            },
          },
        },
      })),
    };
    const viewResolver = {};
    const challengeData = {
      challenge: 'challenge-1',
      uid: 'interaction-id',
      accountId: 'alice',
      expiresAt: Date.now() + 60_000,
    };
    const sessionManager = {
      get: vi.fn<() => typeof challengeData | undefined>(() => challengeData),
      getActiveUser: vi.fn(),
      remove: vi.fn(),
      set: vi.fn(),
    };
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
    const storedCredential = { credential_id: 'credential-1' };
    const webauthnService = {
      generateAuthenticationOptions: vi.fn(),
      getCredentials: vi.fn().mockResolvedValue([storedCredential]),
      isEnabled: vi.fn(() => true),
      updateCredentialCounter: vi.fn(),
      updateCredentialLastUsed: vi.fn(),
      verifyAuthentication: vi.fn().mockResolvedValue({
        verified: true,
        credentialId: 'credential-1',
        newCounter: undefined,
      }),
    };
    const mfaUtils = { isWebAuthnEnabled: vi.fn(() => true) };
    const handler = new OIDCWebAuthnMfaHandler(
      logger as any,
      userService as any,
      activityService as any,
      configManager as any,
      viewResolver as any,
      sessionManager as any,
      clientDeviceInfoManager as any,
      webauthnService as any,
      mfaUtils as any
    );
    const request = {
      body: { credential: { id: 'credential-1' } },
      params: { uid: 'interaction-id' },
    };
    const response = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const interactionDetails = {
      params: { client_id: 'demo-rp' },
      session: { accountId: 'alice', amr: ['pwd'] },
    };
    const provider = {
      interactionDetails: vi.fn().mockResolvedValue(interactionDetails),
      interactionFinished: vi.fn(),
    };
    const next = vi.fn();

    return {
      activityService,
      challengeData,
      configManager,
      handler,
      interactionDetails,
      logger,
      mfaUtils,
      next,
      provider,
      request,
      response,
      sessionManager,
      storedCredential,
      userDoc,
      userService,
      webauthnService,
    };
  };

  it('records last use for a verified counterless authenticator', async () => {
    const harness = createHarness();

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(
      harness.webauthnService.updateCredentialCounter
    ).not.toHaveBeenCalled();
    expect(
      harness.webauthnService.updateCredentialLastUsed
    ).toHaveBeenCalledWith('alice', 'credential-1');
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: {
          accountId: 'alice',
          acr: 'urn:mfa:webauthn',
          amr: ['pwd', 'hwk'],
        },
      }),
      { mergeWithLastSubmission: true }
    );
  });

  it('generates and stores account-bound authentication options', async () => {
    const harness = createHarness();
    const options = { challenge: 'new-challenge', timeout: 60_000 };
    harness.webauthnService.generateAuthenticationOptions.mockResolvedValue(
      options
    );
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.userService.findByUsername).toHaveBeenCalledWith('alice');
    expect(harness.webauthnService.getCredentials).toHaveBeenCalledWith(
      'alice'
    );
    expect(
      harness.webauthnService.generateAuthenticationOptions
    ).toHaveBeenCalledWith('alice', [harness.storedCredential]);
    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'webauthn_oidc_mfa_challenge',
      {
        challenge: 'new-challenge',
        uid: 'interaction-id',
        accountId: 'alice',
        expiresAt: 1_000_000 + 5 * 60 * 1000,
      }
    );
    expect(harness.response.json).toHaveBeenCalledWith({ ok: true, options });
  });

  it('rejects WebAuthn options without an authenticated OIDC session', async () => {
    const harness = createHarness();
    harness.interactionDetails.session = undefined as any;

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(401);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Session expired. Please login again.',
    });
    expect(harness.webauthnService.getCredentials).not.toHaveBeenCalled();
  });

  it('rejects options when WebAuthn is disabled globally', async () => {
    const harness = createHarness();
    harness.webauthnService.isEnabled.mockReturnValue(false);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'WebAuthn is not enabled',
    });
    expect(harness.userService.findByUsername).not.toHaveBeenCalled();
  });

  it('rejects options when the session account no longer exists', async () => {
    const harness = createHarness();
    harness.userService.findByUsername.mockResolvedValue(null);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'User not found',
    });
    expect(harness.webauthnService.getCredentials).not.toHaveBeenCalled();
  });

  it('rejects options when WebAuthn MFA is disabled for the account', async () => {
    const harness = createHarness();
    harness.mfaUtils.isWebAuthnEnabled.mockReturnValue(false);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'WebAuthn MFA is not enabled for this account',
    });
    expect(harness.webauthnService.getCredentials).not.toHaveBeenCalled();
  });

  it('rejects options when the account has no registered passkeys', async () => {
    const harness = createHarness();
    harness.webauthnService.getCredentials.mockResolvedValue([]);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'No passkeys registered for this account',
    });
    expect(
      harness.webauthnService.generateAuthenticationOptions
    ).not.toHaveBeenCalled();
  });

  it('returns a safe options error for an invalid interaction id', async () => {
    const harness = createHarness();
    harness.request.params.uid = 'short';

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error:
        'The request could not be processed. Please return to the previous page and try again.',
    });
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('forwards WebAuthn options dependency failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('interaction store unavailable');
    harness.provider.interactionDetails.mockRejectedValue(error);

    await harness.handler.getOptions(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error generating WebAuthn OIDC MFA options',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });

  it('rejects verification without an authenticated OIDC session', async () => {
    const harness = createHarness();
    harness.interactionDetails.session = undefined as any;

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(401);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Session expired. Please login again.',
    });
    expect(harness.sessionManager.get).not.toHaveBeenCalled();
  });

  it('rejects verification when its challenge is missing', async () => {
    const harness = createHarness();
    harness.sessionManager.get.mockReturnValue(undefined);

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Challenge expired or not found. Please try again.',
    });
    expect(harness.webauthnService.verifyAuthentication).not.toHaveBeenCalled();
  });

  it('removes and rejects an expired WebAuthn challenge', async () => {
    const harness = createHarness();
    harness.challengeData.expiresAt = Date.now() - 1;

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'webauthn_oidc_mfa_challenge'
    );
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.webauthnService.getCredentials).not.toHaveBeenCalled();
  });

  it('rejects a WebAuthn challenge issued for another interaction', async () => {
    const harness = createHarness();
    harness.challengeData.uid = 'other-interaction';

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'WebAuthn challenge mismatch',
      expect.objectContaining({
        expectedUid: 'interaction-id',
        challengeUid: 'other-interaction',
      })
    );
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.webauthnService.getCredentials).not.toHaveBeenCalled();
  });

  it('rejects an assertion from an unregistered credential', async () => {
    const harness = createHarness();
    harness.request.body.credential.id = 'unknown-credential';

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'WebAuthn verification failed',
    });
    expect(harness.webauthnService.verifyAuthentication).not.toHaveBeenCalled();
    expect(harness.sessionManager.remove).not.toHaveBeenCalled();
  });

  it('clears and audits a failed WebAuthn assertion', async () => {
    const harness = createHarness();
    harness.webauthnService.verifyAuthentication.mockResolvedValue({
      verified: false,
      error: 'signature invalid',
    });

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.sessionManager.remove).toHaveBeenCalledWith(
      harness.request,
      'webauthn_oidc_mfa_challenge'
    );
    expect(harness.activityService.failed).toHaveBeenCalledWith(
      'oidc.mfa.webauthn.verification',
      'WebAuthn MFA verification failed',
      null,
      expect.objectContaining({
        client_id: 'demo-rp',
        actor: { username: 'alice', actor_type: 'user' },
      })
    );
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('still rejects a failed assertion when audit logging fails', async () => {
    const harness = createHarness();
    const auditError = new Error('audit store unavailable');
    harness.webauthnService.verifyAuthentication.mockResolvedValue({
      verified: false,
      error: 'signature invalid',
    });
    harness.activityService.failed.mockImplementation(() => {
      throw auditError;
    });

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(auditError, {
      context: 'Error logging failed WebAuthn MFA activity',
    });
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('fails closed when verified credential bookkeeping cannot be persisted', async () => {
    const harness = createHarness();
    const updateError = new Error('credential store unavailable');
    harness.webauthnService.verifyAuthentication.mockResolvedValue({
      verified: true,
      credentialId: 'credential-1',
      newCounter: 42,
    });
    harness.webauthnService.updateCredentialCounter.mockRejectedValue(
      updateError
    );

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(updateError, {
      context: 'Error updating credential counter/lastUsed',
    });
    expect(harness.response.status).toHaveBeenCalledWith(500);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Authentication failed. Please try again.',
    });
    expect(harness.provider.interactionFinished).not.toHaveBeenCalled();
  });

  it('updates a signature counter without duplicating the hardware AMR', async () => {
    const harness = createHarness();
    harness.interactionDetails.session.amr = ['pwd', 'hwk'];
    harness.webauthnService.verifyAuthentication.mockResolvedValue({
      verified: true,
      credentialId: 'credential-1',
      newCounter: 42,
    });
    harness.configManager.getConfig.mockReturnValue({
      deployment: {},
      oidc: { path: '/oidc/v1' },
      security: {
        authentication: {
          multi_factor: {
            webauthn: { rp_id: 'fallback.example.test' },
          },
        },
      },
    });

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.webauthnService.verifyAuthentication).toHaveBeenCalledWith(
      harness.storedCredential,
      harness.request.body.credential,
      'challenge-1',
      'https://fallback.example.test'
    );
    expect(
      harness.webauthnService.updateCredentialCounter
    ).toHaveBeenCalledWith('alice', 'credential-1', 42);
    expect(harness.webauthnService.updateCredentialLastUsed).toHaveBeenCalled();
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: expect.objectContaining({ amr: ['pwd', 'hwk'] }),
      }),
      { mergeWithLastSubmission: true }
    );
  });

  it('completes verified MFA when success audit logging fails', async () => {
    const harness = createHarness();
    const auditError = new Error('audit store unavailable');
    harness.interactionDetails.session.amr = undefined as any;
    harness.activityService.success.mockImplementation(() => {
      throw auditError;
    });

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(auditError, {
      context: 'Error logging successful WebAuthn MFA activity',
    });
    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      expect.objectContaining({
        login: expect.objectContaining({ amr: ['pwd', 'hwk'] }),
      }),
      { mergeWithLastSubmission: true }
    );
  });

  it('returns a safe error for an invalid WebAuthn verification body', async () => {
    const harness = createHarness();
    harness.request.body = {} as any;

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.json).toHaveBeenCalledWith({
      ok: false,
      error:
        'The request could not be processed. Please return to the previous page and try again.',
    });
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('forwards WebAuthn verification dependency failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('credential store unavailable');
    harness.webauthnService.getCredentials.mockRejectedValue(error);

    await harness.handler.verify(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'Error in WebAuthn OIDC MFA verify handler',
    });
    expect(harness.next).toHaveBeenCalledWith(error);
  });
});
