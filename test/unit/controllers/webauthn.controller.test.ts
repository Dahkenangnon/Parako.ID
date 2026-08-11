import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const activityMocks = vi.hoisted(() => ({
  failed: vi.fn(),
  factory: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../../src/utils/activity-logger.factory.js', () => ({
  activityLoggerFor: activityMocks.factory,
}));

import { WebAuthnController } from '../../../src/controllers/webauthn.controller.js';

type WebAuthnTestConfig = {
  deployment: {
    url?: string;
    routes: {
      accounts: string;
      account_routes: { dashboard: string };
    };
  };
  security: {
    authentication: {
      multi_factor: { webauthn: { rp_id: string } };
    };
  };
  features?: { multi_tenancy: { enabled: boolean } };
};

const pendingUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  email_verified: true,
  phone_number: '+22900000000',
  phone_number_verified: true,
  given_name: 'Alice',
  family_name: 'Doe',
  full_name: 'Alice Doe',
  picture: '/alice.png',
  roles: ['user'],
  is_admin: false,
  mfa_method: 'webauthn',
  ...overrides,
});

function makeHarness() {
  const session = new Map<string, unknown>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const webauthnService = {
    isEnabled: vi.fn().mockReturnValue(true),
    hasReachedMaxCredentials: vi.fn().mockResolvedValue(false),
    getCredentials: vi.fn().mockResolvedValue([]),
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    generateDefaultCredentialName: vi.fn(),
    addCredential: vi.fn(),
    getPasskeyInfo: vi.fn(),
    removeCredential: vi.fn(),
    renameCredential: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
    updateCredentialCounter: vi.fn(),
    updateCredentialLastUsed: vi.fn(),
  };
  const sessionManager = {
    get: vi.fn((_req, key: string) => session.get(key)),
    set: vi.fn((_req, key: string, value: unknown) => session.set(key, value)),
    remove: vi.fn((_req, key: string) => session.delete(key)),
    getActiveUser: vi.fn(),
    regenerate: vi.fn().mockResolvedValue(undefined),
    addAuthenticatedUser: vi.fn(),
    setAuthenticated: vi.fn(),
  };
  const configManager = {
    getConfig: vi.fn<() => WebAuthnTestConfig>(() => ({
      deployment: {
        url: 'https://auth.example.test/oidc/v1',
        routes: {
          accounts: '/accounts',
          account_routes: { dashboard: '/dashboard' },
        },
      },
      security: {
        authentication: {
          multi_factor: { webauthn: { rp_id: 'auth.example.test' } },
        },
      },
    })),
  };
  const controller = new WebAuthnController(
    logger as never,
    webauthnService as never,
    sessionManager as never,
    {} as never,
    configManager as never,
    {} as never,
    {} as never
  );

  return {
    configManager,
    controller,
    logger,
    session,
    sessionManager,
    webauthnService,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const req = {
    body: {},
    headers: {},
    params: {},
    ...overrides,
  };
  return req as typeof req & Request;
}

function response() {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res as typeof res & Response;
}

describe('WebAuthnController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.factory.mockReturnValue({
      failed: activityMocks.failed,
      success: activityMocks.success,
    });
  });

  describe('registration options', () => {
    it('rejects disabled WebAuthn, unauthenticated users, and credential limits', async () => {
      const disabled = makeHarness();
      disabled.webauthnService.isEnabled.mockReturnValue(false);
      const disabledRes = response();
      await disabled.controller.getRegistrationOptions(request(), disabledRes);
      expect(disabledRes.status).toHaveBeenCalledWith(400);
      expect(disabledRes.json).toHaveBeenCalledWith({
        ok: false,
        error: 'WebAuthn is not enabled',
      });

      const anonymous = makeHarness();
      const anonymousRes = response();
      await anonymous.controller.getRegistrationOptions(
        request(),
        anonymousRes
      );
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const limited = makeHarness();
      limited.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      limited.webauthnService.hasReachedMaxCredentials.mockResolvedValue(true);
      const limitedRes = response();
      await limited.controller.getRegistrationOptions(request(), limitedRes);
      expect(limitedRes.status).toHaveBeenCalledWith(400);
      expect(limitedRes.json).toHaveBeenCalledWith({
        ok: false,
        error: 'Maximum number of passkeys reached',
      });
    });

    it('generates options from the active user and stores the challenge', async () => {
      const { controller, session, sessionManager, webauthnService } =
        makeHarness();
      sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
        email: 'alice@example.test',
        given_name: 'Alice',
        family_name: 'Doe',
      });
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
        { credential_id: 'credential-2' },
      ]);
      webauthnService.generateRegistrationOptions.mockResolvedValue({
        challenge: 'register-1',
      });
      const res = response();

      await controller.getRegistrationOptions(request(), res);

      expect(webauthnService.generateRegistrationOptions).toHaveBeenCalledWith(
        'alice',
        'alice@example.test',
        'Alice Doe',
        ['credential-1', 'credential-2']
      );
      expect(session.get('webauthn_challenge')).toEqual({
        challenge: 'register-1',
        expiresAt: expect.any(Number),
        type: 'registration',
      });
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        options: { challenge: 'register-1' },
      });
    });

    it('uses username fallbacks and normalizes non-Error failures', async () => {
      const successful = makeHarness();
      successful.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      successful.webauthnService.generateRegistrationOptions.mockResolvedValue({
        challenge: 'register-1',
      });
      await successful.controller.getRegistrationOptions(request(), response());
      expect(
        successful.webauthnService.generateRegistrationOptions
      ).toHaveBeenCalledWith('alice', 'alice', 'alice', []);

      const failed = makeHarness();
      failed.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      failed.webauthnService.getCredentials.mockRejectedValue('offline');
      const failedRes = response();
      await failed.controller.getRegistrationOptions(request(), failedRes);
      expect(failed.logger.error).toHaveBeenCalledWith(
        'Error generating WebAuthn registration options',
        { error: 'offline' }
      );
      expect(failedRes.status).toHaveBeenCalledWith(500);
    });

    it.each([
      [{ given_name: 'Alice' }, 'Alice'],
      [{ family_name: 'Doe' }, 'Doe'],
    ])(
      'builds a display name from a partial profile',
      async (profile, name) => {
        const { controller, sessionManager, webauthnService } = makeHarness();
        sessionManager.getActiveUser.mockReturnValue({
          username: 'alice',
          ...profile,
        });
        webauthnService.generateRegistrationOptions.mockResolvedValue({
          challenge: 'register-1',
        });

        await controller.getRegistrationOptions(request(), response());

        expect(
          webauthnService.generateRegistrationOptions
        ).toHaveBeenCalledWith('alice', 'alice', name, []);
      }
    );
  });

  describe('registration verification', () => {
    it('rejects disabled, unauthenticated, missing, expired, and wrong-type challenges', async () => {
      const disabled = makeHarness();
      disabled.webauthnService.isEnabled.mockReturnValue(false);
      const disabledRes = response();
      await disabled.controller.verifyRegistration(request(), disabledRes);
      expect(disabledRes.status).toHaveBeenCalledWith(400);

      const anonymous = makeHarness();
      const anonymousRes = response();
      await anonymous.controller.verifyRegistration(request(), anonymousRes);
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const missing = makeHarness();
      missing.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      const missingRes = response();
      await missing.controller.verifyRegistration(request(), missingRes);
      expect(missingRes.status).toHaveBeenCalledWith(400);

      const expired = makeHarness();
      expired.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      expired.session.set('webauthn_challenge', {
        challenge: 'old',
        expiresAt: Date.now() - 1,
        type: 'registration',
      });
      await expired.controller.verifyRegistration(request(), response());
      expect(expired.sessionManager.remove).toHaveBeenCalled();

      const wrongType = makeHarness();
      wrongType.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      wrongType.session.set('webauthn_challenge', {
        challenge: 'auth-only',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      await wrongType.controller.verifyRegistration(request(), response());
      expect(wrongType.sessionManager.remove).not.toHaveBeenCalled();
    });

    it.each([
      ['provider reason', 'Attestation rejected'],
      ['default reason', undefined],
    ])('reports a failed verification with the %s', async (_label, reason) => {
      const { controller, session, sessionManager, webauthnService } =
        makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      session.set('webauthn_challenge', {
        challenge: 'register-1',
        expiresAt: Date.now() + 60_000,
        type: 'registration',
      });
      webauthnService.verifyRegistration.mockResolvedValue({
        verified: false,
        error: reason,
      });
      const res = response();

      await controller.verifyRegistration(
        request({ body: { credential: { response: {} } } }),
        res
      );

      expect(activityMocks.failed).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        error: reason || 'Registration verification failed',
      });
    });

    it('stores a verified credential with a trimmed friendly name', async () => {
      const { controller, session, sessionManager, webauthnService } =
        makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      session.set('webauthn_challenge', {
        challenge: 'register-1',
        expiresAt: Date.now() + 60_000,
        type: 'registration',
      });
      const storedCredential = {
        credential_id: 'credential-1',
        device_type: 'singleDevice',
        backed_up: false,
        created_at: new Date('2026-08-01T00:00:00Z'),
      };
      webauthnService.verifyRegistration.mockResolvedValue({
        verified: true,
        credential: storedCredential,
      });
      const res = response();

      await controller.verifyRegistration(
        request({
          body: {
            credential: { response: { transports: ['internal'] } },
            friendly_name: '  Work laptop  ',
          },
        }),
        res
      );

      expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
        'alice',
        expect.any(Object),
        'register-1',
        'https://auth.example.test'
      );
      expect(webauthnService.addCredential).toHaveBeenCalledWith(
        'alice',
        expect.objectContaining({ friendly_name: 'Work laptop' })
      );
      expect(activityMocks.success).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        credential: expect.objectContaining({
          credential_id: 'credential-1',
          friendly_name: 'Work laptop',
        }),
      });
    });

    it('verifies a tenant ceremony against its validated request origin', async () => {
      const {
        configManager,
        controller,
        session,
        sessionManager,
        webauthnService,
      } = makeHarness();
      configManager.getConfig.mockReturnValue({
        deployment: {
          url: 'https://auth.example.test/oidc/v1',
          routes: {
            accounts: '/accounts',
            account_routes: { dashboard: '/dashboard' },
          },
        },
        features: { multi_tenancy: { enabled: true } },
        security: {
          authentication: {
            multi_factor: { webauthn: { rp_id: 'auth.example.test' } },
          },
        },
      });
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      session.set('webauthn_challenge', {
        challenge: 'register-tenant',
        expiresAt: Date.now() + 60_000,
        type: 'registration',
      });
      webauthnService.verifyRegistration.mockResolvedValue({
        verified: false,
        error: 'Expected regression boundary',
      });

      await controller.verifyRegistration(
        request({
          body: { credential: { response: {} } },
          protocol: 'https',
          get: vi.fn().mockReturnValue('acme.auth.example.test'),
        }),
        response()
      );

      expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
        'alice',
        expect.any(Object),
        'register-tenant',
        'https://acme.auth.example.test'
      );
    });

    it.each([
      ['lookalike host', 'https', 'auth.example.test.attacker.test'],
      ['scheme downgrade', 'http', 'acme.auth.example.test'],
    ])(
      'falls back to the configured origin for an untrusted %s',
      async (_label, protocol, host) => {
        const {
          configManager,
          controller,
          session,
          sessionManager,
          webauthnService,
        } = makeHarness();
        configManager.getConfig.mockReturnValue({
          deployment: {
            url: 'https://auth.example.test/oidc/v1',
            routes: {
              accounts: '/accounts',
              account_routes: { dashboard: '/dashboard' },
            },
          },
          features: { multi_tenancy: { enabled: true } },
          security: {
            authentication: {
              multi_factor: { webauthn: { rp_id: 'auth.example.test' } },
            },
          },
        });
        sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
        session.set('webauthn_challenge', {
          challenge: 'register-untrusted-origin',
          expiresAt: Date.now() + 60_000,
          type: 'registration',
        });
        webauthnService.verifyRegistration.mockResolvedValue({
          verified: false,
          error: 'Expected regression boundary',
        });

        await controller.verifyRegistration(
          request({
            body: { credential: { response: {} } },
            protocol,
            get: vi.fn().mockReturnValue(host),
          }),
          response()
        );

        expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
          'alice',
          expect.any(Object),
          'register-untrusted-origin',
          'https://auth.example.test'
        );
      }
    );

    it.each([
      ['platform', ['internal'], 'Browser key'],
      ['cross-platform', undefined, 'Security key'],
    ])(
      'generates a default %s credential name',
      async (attachment, transports, defaultName) => {
        const {
          controller,
          configManager,
          session,
          sessionManager,
          webauthnService,
        } = makeHarness();
        sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
        session.set('webauthn_challenge', {
          challenge: 'register-1',
          expiresAt: Date.now() + 60_000,
          type: 'registration',
        });
        configManager.getConfig.mockReturnValue({
          deployment: {
            routes: {
              accounts: '/accounts',
              account_routes: { dashboard: '/dashboard' },
            },
          },
          security: {
            authentication: {
              multi_factor: { webauthn: { rp_id: 'fallback.example.test' } },
            },
          },
        });
        webauthnService.verifyRegistration.mockResolvedValue({
          verified: true,
          credential: {
            credential_id: 'credential-1',
            device_type: 'singleDevice',
            backed_up: false,
            created_at: new Date(),
          },
        });
        webauthnService.generateDefaultCredentialName.mockReturnValue(
          defaultName
        );

        await controller.verifyRegistration(
          request({
            body: { credential: { response: { transports } } },
            headers:
              attachment === 'platform' ? { 'user-agent': 'Browser' } : {},
          }),
          response()
        );

        expect(
          webauthnService.generateDefaultCredentialName
        ).toHaveBeenCalledWith(
          attachment === 'platform' ? 'Browser' : '',
          attachment
        );
        expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
          'alice',
          expect.any(Object),
          'register-1',
          'https://fallback.example.test'
        );
      }
    );
  });

  describe('credential management', () => {
    it('lists credentials for an authenticated user', async () => {
      const { controller, sessionManager, webauthnService } = makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      webauthnService.getPasskeyInfo.mockResolvedValue([
        { id: 'credential-1' },
      ]);
      const res = response();
      await controller.listCredentials(request(), res);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        credentials: [{ id: 'credential-1' }],
      });
    });

    it('guards and reports list failures', async () => {
      const anonymous = makeHarness();
      const anonymousRes = response();
      await anonymous.controller.listCredentials(request(), anonymousRes);
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const failed = makeHarness();
      failed.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      failed.webauthnService.getPasskeyInfo.mockRejectedValue('offline');
      const failedRes = response();
      await failed.controller.listCredentials(request(), failedRes);
      expect(failed.logger.error).toHaveBeenCalledWith(
        'Error listing WebAuthn credentials',
        { error: 'offline' }
      );
      expect(failedRes.status).toHaveBeenCalledWith(500);
    });

    it('guards credential removal and reports missing credentials', async () => {
      const anonymous = makeHarness();
      const anonymousRes = response();
      await anonymous.controller.removeCredential(request(), anonymousRes);
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const missingId = makeHarness();
      missingId.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      const missingIdRes = response();
      await missingId.controller.removeCredential(request(), missingIdRes);
      expect(missingIdRes.status).toHaveBeenCalledWith(400);

      const notFound = makeHarness();
      notFound.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      notFound.webauthnService.removeCredential.mockResolvedValue(false);
      const notFoundRes = response();
      await notFound.controller.removeCredential(
        request({ params: { credentialId: 'missing' } }),
        notFoundRes
      );
      expect(notFoundRes.status).toHaveBeenCalledWith(404);
    });

    it('removes a credential and records the activity', async () => {
      const { controller, logger, sessionManager, webauthnService } =
        makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      webauthnService.removeCredential.mockResolvedValue(true);
      const res = response();
      await controller.removeCredential(
        request({ params: { credentialId: 'credential-1' } }),
        res
      );
      expect(activityMocks.success).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('WebAuthn credential removed', {
        username: 'alice',
        credentialId: 'credential-1',
      });
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        message: 'Credential removed successfully',
      });
    });

    it('renames credentials and handles guards, misses, and dependency errors', async () => {
      const anonymous = makeHarness();
      const anonymousRes = response();
      await anonymous.controller.renameCredential(request(), anonymousRes);
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const notFound = makeHarness();
      notFound.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      notFound.webauthnService.renameCredential.mockResolvedValue(false);
      const notFoundRes = response();
      await notFound.controller.renameCredential(
        request({
          params: { credentialId: 'missing' },
          body: { friendlyName: 'Key' },
        }),
        notFoundRes
      );
      expect(notFoundRes.status).toHaveBeenCalledWith(404);

      const successful = makeHarness();
      successful.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      successful.webauthnService.renameCredential.mockResolvedValue(true);
      const successfulRes = response();
      await successful.controller.renameCredential(
        request({
          params: { credentialId: 'credential-1' },
          body: { friendlyName: 'Work key' },
        }),
        successfulRes
      );
      expect(successful.webauthnService.renameCredential).toHaveBeenCalledWith(
        'alice',
        'credential-1',
        'Work key'
      );
      expect(successfulRes.json).toHaveBeenCalledWith({
        ok: true,
        message: 'Credential renamed successfully',
      });

      const failed = makeHarness();
      failed.sessionManager.getActiveUser.mockReturnValue({
        username: 'alice',
      });
      failed.webauthnService.renameCredential.mockRejectedValue('offline');
      const failedRes = response();
      await failed.controller.renameCredential(
        request({
          params: { credentialId: 'credential-1' },
          body: { friendlyName: 'Key' },
        }),
        failedRes
      );
      expect(failed.logger.error).toHaveBeenCalledWith(
        'Error renaming WebAuthn credential',
        { error: 'offline' }
      );
      expect(failedRes.status).toHaveBeenCalledWith(500);
    });

    it('normalizes removal dependency errors', async () => {
      const { controller, logger, sessionManager, webauthnService } =
        makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      webauthnService.removeCredential.mockRejectedValue('offline');
      const res = response();
      await controller.removeCredential(
        request({ params: { credentialId: 'credential-1' } }),
        res
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error removing WebAuthn credential',
        { error: 'offline' }
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('authentication options', () => {
    it('rejects disabled WebAuthn, missing MFA state, wrong methods, and missing passkeys', async () => {
      const disabled = makeHarness();
      disabled.webauthnService.isEnabled.mockReturnValue(false);
      const disabledRes = response();
      await disabled.controller.getAuthenticationOptions(
        request(),
        disabledRes
      );
      expect(disabledRes.status).toHaveBeenCalledWith(400);

      const missing = makeHarness();
      const missingRes = response();
      await missing.controller.getAuthenticationOptions(request(), missingRes);
      expect(missingRes.status).toHaveBeenCalledWith(401);

      const wrong = makeHarness();
      wrong.session.set('pendingMfaUser', pendingUser({ mfa_method: 'totp' }));
      const wrongRes = response();
      await wrong.controller.getAuthenticationOptions(request(), wrongRes);
      expect(wrongRes.status).toHaveBeenCalledWith(400);

      const empty = makeHarness();
      empty.session.set('pendingMfaUser', pendingUser());
      const emptyRes = response();
      await empty.controller.getAuthenticationOptions(request(), emptyRes);
      expect(emptyRes.status).toHaveBeenCalledWith(400);
      expect(emptyRes.json).toHaveBeenCalledWith({
        ok: false,
        error: 'No passkeys registered for this account',
      });
    });

    it('uses pending social MFA state and stores authentication options', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingSocialMfaUser', pendingUser());
      const credentials = [{ credential_id: 'credential-1' }];
      webauthnService.getCredentials.mockResolvedValue(credentials);
      webauthnService.generateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-1',
      });
      const res = response();
      await controller.getAuthenticationOptions(request(), res);
      expect(
        webauthnService.generateAuthenticationOptions
      ).toHaveBeenCalledWith('alice', credentials);
      expect(session.get('webauthn_challenge')).toEqual({
        challenge: 'auth-1',
        expiresAt: expect.any(Number),
        type: 'authentication',
      });
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        options: { challenge: 'auth-1' },
      });
    });

    it('normalizes authentication option dependency errors', async () => {
      const { controller, logger, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingUser());
      webauthnService.getCredentials.mockRejectedValue('offline');
      const res = response();
      await controller.getAuthenticationOptions(request(), res);
      expect(logger.error).toHaveBeenCalledWith(
        'Error generating WebAuthn authentication options',
        { error: 'offline' }
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('authentication verification', () => {
    it('rejects missing state, challenge, credential, and stored credential matches', async () => {
      const noState = makeHarness();
      const noStateRes = response();
      await noState.controller.verifyAuthentication(request(), noStateRes);
      expect(noStateRes.status).toHaveBeenCalledWith(401);

      const noChallenge = makeHarness();
      noChallenge.session.set('pendingMfaUser', pendingUser());
      const noChallengeRes = response();
      await noChallenge.controller.verifyAuthentication(
        request(),
        noChallengeRes
      );
      expect(noChallengeRes.status).toHaveBeenCalledWith(400);

      const noCredential = makeHarness();
      noCredential.session.set('pendingMfaUser', pendingUser());
      noCredential.session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      const noCredentialRes = response();
      await noCredential.controller.verifyAuthentication(
        request(),
        noCredentialRes
      );
      expect(noCredentialRes.json).toHaveBeenCalledWith({
        ok: false,
        error: 'Credential is required',
      });

      const noMatch = makeHarness();
      noMatch.session.set('pendingMfaUser', pendingUser());
      noMatch.session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      noMatch.webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'other' },
      ]);
      const noMatchRes = response();
      await noMatch.controller.verifyAuthentication(
        request({ body: { credential: { id: 'missing' } } }),
        noMatchRes
      );
      expect(noMatch.logger.warn).toHaveBeenCalledWith(
        'No matching credential found for authentication',
        { username: 'alice', credentialId: 'missing' }
      );
      expect(noMatchRes.status).toHaveBeenCalledWith(400);
    });

    it('reports a cryptographically failed assertion', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingUser());
      session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
      ]);
      webauthnService.verifyAuthentication.mockResolvedValue({
        verified: false,
        error: 'Bad signature',
      });
      const res = response();

      await controller.verifyAuthentication(
        request({ body: { credential: { id: 'credential-1' } } }),
        res
      );

      expect(activityMocks.failed).toHaveBeenCalledWith(
        'mfa_webauthn_verification_failed',
        null,
        'WebAuthn MFA verification failed',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updates the counter and last-used time after a verified assertion', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingUser());
      session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
      ]);
      webauthnService.verifyAuthentication.mockResolvedValue({
        verified: true,
        credentialId: 'credential-1',
        newCounter: 12,
      });

      await controller.verifyAuthentication(
        request({ body: { credential: { id: 'credential-1' } } }),
        response()
      );

      expect(webauthnService.updateCredentialCounter).toHaveBeenCalledWith(
        'alice',
        'credential-1',
        12
      );
      expect(webauthnService.updateCredentialLastUsed).toHaveBeenCalledWith(
        'alice',
        'credential-1'
      );
    });

    it.each([new Error('write failed'), 'write failed'])(
      'fails closed when credential state cannot be persisted: %s',
      async updateError => {
        const { controller, logger, session, webauthnService } = makeHarness();
        session.set('pendingMfaUser', pendingUser());
        session.set('webauthn_challenge', {
          challenge: 'auth-1',
          expiresAt: Date.now() + 60_000,
          type: 'authentication',
        });
        webauthnService.getCredentials.mockResolvedValue([
          { credential_id: 'credential-1' },
        ]);
        webauthnService.verifyAuthentication.mockResolvedValue({
          verified: true,
          credentialId: 'credential-1',
          newCounter: 12,
        });
        webauthnService.updateCredentialCounter.mockRejectedValue(updateError);
        const res = response();

        await controller.verifyAuthentication(
          request({ body: { credential: { id: 'credential-1' } } }),
          res
        );

        expect(logger.error).toHaveBeenCalledWith(
          'Error updating credential counter/lastUsed',
          { error: 'write failed' }
        );
        expect(res.status).toHaveBeenCalledWith(500);
        expect(activityMocks.success).not.toHaveBeenCalled();
      }
    );

    it('completes social MFA with optional user defaults and its continue URL', async () => {
      const { controller, session, sessionManager, webauthnService } =
        makeHarness();
      session.set(
        'pendingSocialMfaUser',
        pendingUser({
          continue_url: 'https://rp.example.test/callback',
          phone_number: undefined,
          phone_number_verified: undefined,
        })
      );
      session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
      ]);
      webauthnService.verifyAuthentication.mockResolvedValue({
        verified: true,
        credentialId: 'credential-1',
      });
      const res = response();

      await controller.verifyAuthentication(
        request({ body: { credential: { id: 'credential-1' } } }),
        res
      );

      expect(activityMocks.success).toHaveBeenCalledWith(
        'mfa_webauthn_verification_success',
        null,
        'WebAuthn MFA verification successful via social login',
        expect.any(Object)
      );
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            phone_number: '',
            phone_number_verified: false,
          }),
        }
      );
      expect(sessionManager.addAuthenticatedUser).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        redirectUrl: 'https://rp.example.test/callback',
      });
    });

    it.each([new Error('regenerate failed'), 'regenerate failed'])(
      'continues securely when session regeneration reports %s',
      async regenerationError => {
        const { controller, logger, session, sessionManager, webauthnService } =
          makeHarness();
        session.set('pendingMfaUser', pendingUser());
        session.set('webauthn_challenge', {
          challenge: 'auth-1',
          expiresAt: Date.now() + 60_000,
          type: 'authentication',
        });
        webauthnService.getCredentials.mockResolvedValue([
          { credential_id: 'credential-1' },
        ]);
        webauthnService.verifyAuthentication.mockResolvedValue({
          verified: true,
          credentialId: 'credential-1',
        });
        sessionManager.regenerate.mockRejectedValue(regenerationError);
        const res = response();

        await controller.verifyAuthentication(
          request({ body: { credential: { id: 'credential-1' } } }),
          res
        );

        expect(logger.error).toHaveBeenCalledWith(
          'Failed to regenerate session after MFA verification',
          { error: 'regenerate failed' }
        );
        expect(sessionManager.setAuthenticated).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ ok: true })
        );
      }
    );

    it('normalizes outer authentication dependency failures', async () => {
      const { controller, logger, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingUser());
      session.set('webauthn_challenge', {
        challenge: 'auth-1',
        expiresAt: Date.now() + 60_000,
        type: 'authentication',
      });
      webauthnService.getCredentials.mockRejectedValue('offline');
      const res = response();
      await controller.verifyAuthentication(
        request({ body: { credential: { id: 'credential-1' } } }),
        res
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error verifying WebAuthn authentication',
        { error: 'offline' }
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  it('logs Error instances from each remaining controller dependency boundary', async () => {
    const registrationOptions = makeHarness();
    registrationOptions.sessionManager.getActiveUser.mockReturnValue({
      username: 'alice',
    });
    registrationOptions.webauthnService.getCredentials.mockRejectedValue(
      new Error('registration options failed')
    );
    await registrationOptions.controller.getRegistrationOptions(
      request(),
      response()
    );
    expect(registrationOptions.logger.error).toHaveBeenCalledWith(
      'Error generating WebAuthn registration options',
      { error: 'registration options failed' }
    );

    const registrationVerify = makeHarness();
    registrationVerify.sessionManager.getActiveUser.mockReturnValue({
      username: 'alice',
    });
    registrationVerify.session.set('webauthn_challenge', {
      challenge: 'register-1',
      expiresAt: Date.now() + 60_000,
      type: 'registration',
    });
    registrationVerify.webauthnService.verifyRegistration.mockRejectedValue(
      'registration verify failed'
    );
    await registrationVerify.controller.verifyRegistration(
      request({ body: { credential: { response: {} } } }),
      response()
    );
    expect(registrationVerify.logger.error).toHaveBeenCalledWith(
      'Error verifying WebAuthn registration',
      { error: 'registration verify failed' }
    );

    const list = makeHarness();
    list.sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
    list.webauthnService.getPasskeyInfo.mockRejectedValue(
      new Error('list failed')
    );
    await list.controller.listCredentials(request(), response());
    expect(list.logger.error).toHaveBeenCalledWith(
      'Error listing WebAuthn credentials',
      { error: 'list failed' }
    );

    const remove = makeHarness();
    remove.sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
    remove.webauthnService.removeCredential.mockRejectedValue(
      new Error('remove failed')
    );
    await remove.controller.removeCredential(
      request({ params: { credentialId: 'credential-1' } }),
      response()
    );
    expect(remove.logger.error).toHaveBeenCalledWith(
      'Error removing WebAuthn credential',
      { error: 'remove failed' }
    );

    const rename = makeHarness();
    rename.sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
    rename.webauthnService.renameCredential.mockRejectedValue(
      new Error('rename failed')
    );
    await rename.controller.renameCredential(
      request({
        params: { credentialId: 'credential-1' },
        body: { friendlyName: 'Key' },
      }),
      response()
    );
    expect(rename.logger.error).toHaveBeenCalledWith(
      'Error renaming WebAuthn credential',
      { error: 'rename failed' }
    );

    const authenticationOptions = makeHarness();
    authenticationOptions.session.set('pendingMfaUser', pendingUser());
    authenticationOptions.webauthnService.getCredentials.mockRejectedValue(
      new Error('authentication options failed')
    );
    await authenticationOptions.controller.getAuthenticationOptions(
      request(),
      response()
    );
    expect(authenticationOptions.logger.error).toHaveBeenCalledWith(
      'Error generating WebAuthn authentication options',
      { error: 'authentication options failed' }
    );
  });

  it('completes regular WebAuthn MFA without labeling it as social login', async () => {
    const { controller, session, sessionManager, webauthnService } =
      makeHarness();
    const user = pendingUser();
    session.set('pendingMfaUser', user);
    session.set('webauthn_challenge', {
      challenge: 'challenge-1',
      expiresAt: Date.now() + 60_000,
      type: 'authentication',
    });
    webauthnService.getCredentials.mockResolvedValue([
      { credential_id: 'credential-1' },
    ]);
    webauthnService.verifyAuthentication.mockResolvedValue({
      verified: true,
      credentialId: 'credential-1',
    });
    const res = response();

    await controller.verifyAuthentication(
      request({ body: { credential: { id: 'credential-1' } } }),
      res
    );

    expect(activityMocks.success).toHaveBeenCalledWith(
      'mfa_webauthn_verification_success',
      null,
      'WebAuthn MFA verification successful',
      expect.any(Object)
    );
    expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
      expect.anything(),
      {
        currentActiveLoggedUser: expect.objectContaining({ username: 'alice' }),
      }
    );
    expect(sessionManager.addAuthenticatedUser).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      redirectUrl: '/accounts/dashboard',
    });
  });

  it('consumes a registration challenge even when cryptographic verification throws', async () => {
    const { controller, session, sessionManager, webauthnService } =
      makeHarness();
    sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
    session.set('webauthn_challenge', {
      challenge: 'challenge-1',
      expiresAt: Date.now() + 60_000,
      type: 'registration',
    });
    webauthnService.verifyRegistration.mockRejectedValue(
      new Error('malformed assertion')
    );
    const req = request({
      body: { credential: { response: {} }, friendly_name: 'Laptop' },
    });
    const res = response();

    await controller.verifyRegistration(req, res);

    expect(sessionManager.remove).toHaveBeenCalledWith(
      req,
      'webauthn_challenge'
    );
    expect(session.has('webauthn_challenge')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('consumes an authentication challenge even when cryptographic verification throws', async () => {
    const { controller, session, sessionManager, webauthnService } =
      makeHarness();
    session.set('pendingMfaUser', pendingUser());
    session.set('webauthn_challenge', {
      challenge: 'challenge-1',
      expiresAt: Date.now() + 60_000,
      type: 'authentication',
    });
    webauthnService.getCredentials.mockResolvedValue([
      { credential_id: 'credential-1' },
    ]);
    webauthnService.verifyAuthentication.mockRejectedValue(
      new Error('malformed assertion')
    );
    const req = request({ body: { credential: { id: 'credential-1' } } });
    const res = response();

    await controller.verifyAuthentication(req, res);

    expect(sessionManager.remove).toHaveBeenCalledWith(
      req,
      'webauthn_challenge'
    );
    expect(session.has('webauthn_challenge')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
