import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

import { WebAuthnService } from '../../../src/services/webauthn.service.js';
import type { WebAuthnCredential } from '../../../src/types/webauthn.js';

const NOW = new Date('2026-08-02T13:00:00.000Z');

function webauthnConfig(overrides: Record<string, unknown> = {}) {
  return {
    security: {
      authentication: {
        multi_factor: {
          webauthn: {
            enabled: true,
            rp_name: 'Parako ID',
            rp_id: 'auth.example.test',
            timeout: 90_000,
            attestation: 'none',
            user_verification: 'preferred',
            resident_key: 'preferred',
            max_credentials_per_user: 3,
            ...overrides,
          },
        },
      },
    },
  };
}

function credential(
  id = 'credential-one',
  overrides: Partial<WebAuthnCredential> = {}
): WebAuthnCredential {
  return {
    credential_id: id,
    credential_public_key: Buffer.from(`key:${id}`).toString('base64url'),
    counter: 4,
    transports: ['internal'],
    device_type: 'singleDevice',
    backed_up: false,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    friendly_name: 'My Passkey',
    ...overrides,
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'user-id',
    username: 'alice',
    mfa: {
      enabled: true,
      methods: {
        webauthn: {
          enabled: true,
          credentials: [credential()],
          verified_at: new Date('2026-07-01T00:00:00.000Z'),
        },
      },
    },
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService(config: unknown = webauthnConfig()) {
  const logger = makeLogger();
  const userService = {
    findByUsername: vi.fn().mockResolvedValue(user()),
    updateById: vi.fn().mockResolvedValue(user()),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const configManager = { getConfig: vi.fn(() => config) };
  const service = new WebAuthnService(
    logger as any,
    userService as any,
    configManager as any
  );
  return { logger, userService, configManager, service };
}

describe('WebAuthnService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.generateRegistrationOptions.mockResolvedValue({
      challenge: 'registration-challenge',
    });
    mocks.generateAuthenticationOptions.mockResolvedValue({
      challenge: 'authentication-challenge',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('configuration', () => {
    it('maps explicit WebAuthn configuration', () => {
      const { service } = makeService(
        webauthnConfig({
          attestation: 'direct',
          user_verification: 'required',
          authenticator_attachment: 'platform',
          resident_key: 'required',
        })
      );

      expect(service.getConfig()).toEqual({
        enabled: true,
        rpName: 'Parako ID',
        rpId: 'auth.example.test',
        timeout: 90_000,
        attestation: 'direct',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        maxCredentialsPerUser: 3,
      });
      expect(service.isEnabled()).toBe(true);
    });

    it('uses safe defaults when the WebAuthn section is absent', () => {
      const { service } = makeService({});

      expect(service.getConfig()).toEqual({
        enabled: false,
        rpName: 'OIDC Provider',
        rpId: 'localhost',
        timeout: 60_000,
        attestation: 'none',
        userVerification: 'preferred',
        authenticatorAttachment: undefined,
        residentKey: 'preferred',
        maxCredentialsPerUser: 10,
      });
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('registration options and verification', () => {
    it('generates stable user-bound options and excludes existing credentials', async () => {
      const { service } = makeService(
        webauthnConfig({
          user_verification: 'required',
          resident_key: 'required',
          authenticator_attachment: 'platform',
        })
      );

      await expect(
        service.generateRegistrationOptions(
          'stable-user-id',
          'alice@example.test',
          'Alice',
          ['existing-one', 'existing-two']
        )
      ).resolves.toEqual({ challenge: 'registration-challenge' });
      expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith({
        rpName: 'Parako ID',
        rpID: 'auth.example.test',
        userID: Buffer.from('stable-user-id', 'utf8'),
        userName: 'alice@example.test',
        userDisplayName: 'Alice',
        attestationType: 'none',
        excludeCredentials: [
          { id: 'existing-one', type: 'public-key' },
          { id: 'existing-two', type: 'public-key' },
        ],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
          requireResidentKey: true,
          authenticatorAttachment: 'platform',
        },
        timeout: 90_000,
      });
    });

    it('omits optional attachment and defaults excluded credentials', async () => {
      const { service } = makeService();

      await service.generateRegistrationOptions('user-id', 'alice', 'Alice');

      expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userID: Buffer.from('user-id', 'utf8'),
          excludeCredentials: [],
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
            requireResidentKey: false,
          },
        })
      );
    });

    it('rejects an empty user ID before generating options', async () => {
      const { service } = makeService();

      await expect(
        service.generateRegistrationOptions('   ', 'alice', 'Alice')
      ).rejects.toThrow('WebAuthn user ID is required');
      expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled();
    });

    it('returns a failed registration result when verification is false', async () => {
      mocks.verifyRegistrationResponse.mockResolvedValue({ verified: false });
      const { service, logger } = makeService();

      await expect(
        service.verifyRegistration(
          'alice',
          { response: {} } as any,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toEqual({
        verified: false,
        error: 'Registration verification failed',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'WebAuthn registration verification failed',
        { userId: 'alice', verified: false }
      );
    });

    it('requires registration info even when the provider reports verified', async () => {
      mocks.verifyRegistrationResponse.mockResolvedValue({ verified: true });
      const { service } = makeService();

      await expect(
        service.verifyRegistration(
          'alice',
          { response: {} } as any,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toMatchObject({ verified: false });
    });

    it('maps a verified registration into a persistable credential', async () => {
      mocks.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-credential',
            publicKey: Uint8Array.from([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      });
      const { service } = makeService(
        webauthnConfig({ user_verification: 'required' })
      );
      const registrationResponse = {
        response: { transports: ['internal', 'hybrid'] },
      } as any;

      await expect(
        service.verifyRegistration(
          'alice',
          registrationResponse,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toEqual({
        verified: true,
        credential: {
          credential_id: 'new-credential',
          credential_public_key: Buffer.from([1, 2, 3]).toString('base64url'),
          counter: 0,
          transports: ['internal', 'hybrid'],
          device_type: 'multiDevice',
          backed_up: true,
          created_at: NOW,
          friendly_name: 'New Passkey',
        },
      });
      expect(mocks.verifyRegistrationResponse).toHaveBeenCalledWith({
        response: registrationResponse,
        expectedChallenge: 'challenge',
        expectedOrigin: 'https://auth.example.test',
        expectedRPID: 'auth.example.test',
        requireUserVerification: true,
      });
    });

    it.each([
      [new Error('invalid attestation'), 'invalid attestation'],
      ['provider failure', 'Verification failed'],
    ])('contains registration verifier failures %#', async (failure, error) => {
      mocks.verifyRegistrationResponse.mockRejectedValue(failure);
      const { service, logger } = makeService();

      await expect(
        service.verifyRegistration(
          'alice',
          { response: {} } as any,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toEqual({ verified: false, error });
      expect(logger.error).toHaveBeenCalledWith(
        'WebAuthn registration verification error',
        {
          userId: 'alice',
          error: failure instanceof Error ? failure.message : String(failure),
        }
      );
    });
  });

  describe('authentication options and verification', () => {
    it('maps stored credentials into authentication options', async () => {
      const first = credential('first');
      const second = credential('second', { transports: undefined });
      const { service } = makeService(
        webauthnConfig({ user_verification: 'discouraged' })
      );

      await expect(
        service.generateAuthenticationOptions('alice', [first, second])
      ).resolves.toEqual({ challenge: 'authentication-challenge' });
      expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith({
        rpID: 'auth.example.test',
        allowCredentials: [
          { id: 'first', type: 'public-key', transports: ['internal'] },
          { id: 'second', type: 'public-key', transports: undefined },
        ],
        userVerification: 'discouraged',
        timeout: 90_000,
      });
    });

    it('returns failure when authentication is not verified', async () => {
      mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: false });
      const { service, logger } = makeService();

      await expect(
        service.verifyAuthentication(
          credential(),
          {} as any,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toEqual({
        verified: false,
        error: 'Authentication verification failed',
      });
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('verifies with the decoded public key and returns the new counter', async () => {
      mocks.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      });
      const stored = credential();
      const { service } = makeService(
        webauthnConfig({ user_verification: 'required' })
      );
      const response = { id: stored.credential_id } as any;

      await expect(
        service.verifyAuthentication(
          stored,
          response,
          'challenge',
          'https://auth.example.test'
        )
      ).resolves.toEqual({
        verified: true,
        credentialId: 'credential-one',
        newCounter: 5,
      });
      expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledWith({
        response,
        expectedChallenge: 'challenge',
        expectedOrigin: 'https://auth.example.test',
        expectedRPID: 'auth.example.test',
        credential: {
          id: 'credential-one',
          publicKey: Buffer.from(stored.credential_public_key, 'base64url'),
          counter: 4,
          transports: ['internal'],
        },
        requireUserVerification: true,
      });
    });

    it.each([
      [new Error('bad signature'), 'bad signature'],
      ['provider failure', 'Verification failed'],
    ])(
      'contains authentication verifier failures %#',
      async (failure, error) => {
        mocks.verifyAuthenticationResponse.mockRejectedValue(failure);
        const { service, logger } = makeService();

        await expect(
          service.verifyAuthentication(
            credential(),
            {} as any,
            'challenge',
            'https://auth.example.test'
          )
        ).resolves.toEqual({ verified: false, error });
        expect(logger.error).toHaveBeenCalledOnce();
      }
    );
  });

  describe('credential lifecycle', () => {
    it('adds a unique credential and enables WebAuthn MFA', async () => {
      const { service, userService, logger } = makeService();
      const next = credential('credential-two');

      await service.addCredential('alice', next);

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: true,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                enabled: true,
                credentials: [credential(), next],
              }),
            }),
          }),
        })
      );
      expect(logger.info).toHaveBeenCalledWith('WebAuthn credential added', {
        username: 'alice',
        credentialId: 'credential-two',
        totalCredentials: 2,
      });
    });

    it('creates the missing MFA structure when adding the first credential', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await service.addCredential('alice', credential());

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: true,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                credentials: [credential()],
                verified_at: NOW,
              }),
            }),
          }),
        })
      );
    });

    it.each([
      [null, 'User not found'],
      [user(), 'Credential already exists'],
      [
        user({
          mfa: {
            methods: {
              webauthn: {
                credentials: [
                  credential('one'),
                  credential('two'),
                  credential('three'),
                ],
              },
            },
          },
        }),
        'Maximum number of passkeys (3) reached',
      ],
    ])('rejects invalid credential additions %#', async (foundUser, error) => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(foundUser);

      await expect(
        service.addCredential('alice', credential())
      ).rejects.toThrow(error);
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('does not report an added credential when persistence returns no user', async () => {
      const { service, userService, logger } = makeService();
      userService.updateById.mockResolvedValue(null);

      await expect(
        service.addCredential('alice', credential('credential-two'))
      ).rejects.toThrow('Failed to update user');
      expect(logger.info).not.toHaveBeenCalledWith(
        'WebAuthn credential added',
        expect.any(Object)
      );
    });

    it('returns false when removing an unknown credential', async () => {
      const { service, userService } = makeService();

      await expect(service.removeCredential('alice', 'missing')).resolves.toBe(
        false
      );
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('returns false when removing from a user without MFA state', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await expect(service.removeCredential('alice', 'missing')).resolves.toBe(
        false
      );
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it.each([
      [{ totp: { enabled: true, secret: 'secret' } }, true],
      [{ email: { enabled: true } }, true],
      [{}, false],
    ])(
      'removes a credential while deriving remaining MFA state %#',
      async (otherMethods, mfaEnabled) => {
        const { service, userService } = makeService();
        userService.findByUsername.mockResolvedValue(
          user({
            mfa: {
              enabled: true,
              methods: {
                ...otherMethods,
                webauthn: {
                  enabled: true,
                  credentials: [credential()],
                  verified_at: NOW,
                },
              },
            },
          })
        );

        await expect(
          service.removeCredential('alice', 'credential-one')
        ).resolves.toBe(true);
        expect(userService.updateById).toHaveBeenCalledWith(
          'user-id',
          expect.objectContaining({
            mfa: expect.objectContaining({
              enabled: mfaEnabled,
              methods: expect.objectContaining({
                webauthn: {
                  enabled: false,
                  credentials: [],
                  verified_at: NOW,
                },
              }),
            }),
          })
        );
      }
    );

    it('renames a credential with a trimmed friendly name', async () => {
      const { service, userService } = makeService();

      await expect(
        service.renameCredential('alice', 'credential-one', '  Laptop  ')
      ).resolves.toBe(true);
      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                credentials: [
                  expect.objectContaining({ friendly_name: 'Laptop' }),
                ],
              }),
            }),
          }),
        })
      );
    });

    it('returns false when renaming an unknown credential', async () => {
      const { service, userService } = makeService();

      await expect(
        service.renameCredential('alice', 'missing', 'Laptop')
      ).resolves.toBe(false);
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('returns false when renaming for a user without MFA state', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await expect(
        service.renameCredential('alice', 'missing', 'Laptop')
      ).resolves.toBe(false);
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('preserves safe disabled defaults when renaming sparse MFA data', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: {
            methods: { webauthn: { credentials: [credential()] } },
          },
        })
      );

      await expect(
        service.renameCredential('alice', 'credential-one', 'Laptop')
      ).resolves.toBe(true);
      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: false,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({ enabled: false }),
            }),
          }),
        })
      );
    });

    it('rejects an empty friendly name at the service boundary', async () => {
      const { service, userService } = makeService();

      await expect(
        service.renameCredential('alice', 'credential-one', '   ')
      ).rejects.toThrow('Friendly name is required');
      expect(userService.findByUsername).not.toHaveBeenCalled();
    });

    it('returns stored credentials and a safe display projection', async () => {
      const stored = credential('display', { last_used_at: NOW });
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: { methods: { webauthn: { credentials: [stored] } } },
        })
      );

      await expect(service.getCredentials('alice')).resolves.toEqual([stored]);
      await expect(service.getPasskeyInfo('alice')).resolves.toEqual([
        {
          credential_id: 'display',
          friendly_name: 'My Passkey',
          device_type: 'singleDevice',
          backed_up: false,
          created_at: stored.created_at,
          last_used_at: NOW,
          transports: ['internal'],
        },
      ]);
    });

    it.each([null, user({ mfa: undefined })])(
      'returns no credentials when user data has none %#',
      async foundUser => {
        const { service, userService } = makeService();
        userService.findByUsername.mockResolvedValue(foundUser);
        await expect(service.getCredentials('alice')).resolves.toEqual([]);
      }
    );

    it('updates a credential counter without changing sibling credentials', async () => {
      const sibling = credential('sibling');
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: {
            enabled: true,
            methods: {
              webauthn: {
                enabled: true,
                credentials: [credential(), sibling],
              },
            },
          },
        })
      );

      await service.updateCredentialCounter('alice', 'credential-one', 5);

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                credentials: [
                  expect.objectContaining({
                    credential_id: 'credential-one',
                    counter: 5,
                  }),
                  sibling,
                ],
              }),
            }),
          }),
        })
      );
    });

    it.each([
      ['missing', 5, 'Credential not found'],
      ['credential-one', 3, 'Credential counter cannot move backwards'],
      [
        'credential-one',
        -1,
        'Credential counter must be a non-negative safe integer',
      ],
      [
        'credential-one',
        Number.NaN,
        'Credential counter must be a non-negative safe integer',
      ],
    ])(
      'rejects unsafe credential counter updates %#',
      async (id, counter, error) => {
        const { service, userService } = makeService();

        await expect(
          service.updateCredentialCounter('alice', id, counter)
        ).rejects.toThrow(error);
        expect(userService.updateById).not.toHaveBeenCalled();
      }
    );

    it('rejects counter updates when sparse MFA data has no credentials', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await expect(
        service.updateCredentialCounter('alice', 'missing', 1)
      ).rejects.toThrow('Credential not found');
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('uses safe disabled defaults when updating a sparse credential counter', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: {
            methods: { webauthn: { credentials: [credential()] } },
          },
        })
      );

      await service.updateCredentialCounter('alice', 'credential-one', 5);

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: false,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({ enabled: false }),
            }),
          }),
        })
      );
    });

    it('updates last-used time only for an existing credential', async () => {
      const { service, userService } = makeService();

      await service.updateCredentialLastUsed('alice', 'credential-one');

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                credentials: [expect.objectContaining({ last_used_at: NOW })],
              }),
            }),
          }),
        })
      );
    });

    it('rejects last-used updates for an unknown credential', async () => {
      const { service, userService } = makeService();

      await expect(
        service.updateCredentialLastUsed('alice', 'missing')
      ).rejects.toThrow('Credential not found');
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('rejects last-used updates when sparse MFA data has no credentials', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await expect(
        service.updateCredentialLastUsed('alice', 'missing')
      ).rejects.toThrow('Credential not found');
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('updates one last-used timestamp while preserving sparse sibling credentials', async () => {
      const sibling = credential('credential-two');
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: {
            methods: {
              webauthn: { credentials: [credential(), sibling] },
            },
          },
        })
      );

      await service.updateCredentialLastUsed('alice', 'credential-one');

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: false,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({
                enabled: false,
                credentials: [
                  expect.objectContaining({ last_used_at: NOW }),
                  sibling,
                ],
              }),
            }),
          }),
        })
      );
    });

    it.each([
      ['addCredential', () => credential('new')],
      ['removeCredential', () => 'credential-one'],
      ['renameCredential', () => ['credential-one', 'Laptop']],
      ['updateCredentialCounter', () => ['credential-one', 5]],
      ['updateCredentialLastUsed', () => 'credential-one'],
      ['enableWebAuthnMfa', () => undefined],
      ['disableWebAuthnMfa', () => undefined],
    ])('rejects %s when the user does not exist', async (method, makeArgs) => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(null);
      const args = makeArgs();
      const normalizedArgs = Array.isArray(args)
        ? args
        : args === undefined
          ? []
          : [args];

      await expect(
        (service as any)[method]('alice', ...normalizedArgs)
      ).rejects.toThrow('User not found');
    });
  });

  describe('discoverable credentials and MFA state', () => {
    it('finds a discoverable credential across returned users', async () => {
      const match = credential('discoverable');
      const { service, userService } = makeService();
      userService.findMany.mockResolvedValue([
        user({ username: 'first', mfa: undefined }),
        user({
          username: 'second',
          mfa: { methods: { webauthn: { credentials: [match] } } },
        }),
      ]);

      await expect(service.findCredentialById('discoverable')).resolves.toEqual(
        { username: 'second', credential: match }
      );
      expect(userService.findMany).toHaveBeenCalledWith({
        'mfa.methods.webauthn.credentials.credential_id': 'discoverable',
      });
    });

    it('returns null when a discoverable credential cannot be found', async () => {
      const { service, userService } = makeService();
      userService.findMany.mockResolvedValue([user({ mfa: undefined })]);

      await expect(service.findCredentialById('missing')).resolves.toBeNull();
    });

    it('rejects duplicate credential ownership instead of choosing an account', async () => {
      const duplicate = credential('duplicated');
      const { service, userService, logger } = makeService();
      userService.findMany.mockResolvedValue([
        user({
          username: 'first',
          mfa: { methods: { webauthn: { credentials: [duplicate] } } },
        }),
        user({
          username: 'second',
          mfa: { methods: { webauthn: { credentials: [duplicate] } } },
        }),
      ]);

      await expect(
        service.findCredentialById('duplicated')
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'WebAuthn credential is assigned to multiple users',
        { credentialId: 'duplicated' }
      );
    });

    it.each([
      [[credential('one'), credential('two'), credential('three')], true],
      [[credential('one')], false],
    ])(
      'checks the configured credential limit %#',
      async (credentials, reached) => {
        const { service, userService } = makeService();
        userService.findByUsername.mockResolvedValue(
          user({ mfa: { methods: { webauthn: { credentials } } } })
        );
        await expect(service.hasReachedMaxCredentials('alice')).resolves.toBe(
          reached
        );
      }
    );

    it('enables WebAuthn MFA while preserving existing credentials', async () => {
      const { service, userService } = makeService();

      await service.enableWebAuthnMfa('alice');

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            enabled: true,
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({ enabled: true }),
            }),
          }),
        })
      );
    });

    it('records the first verification time when enabling sparse WebAuthn data', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(
        user({
          mfa: {
            enabled: false,
            methods: { webauthn: { credentials: [credential()] } },
          },
        })
      );

      await service.enableWebAuthnMfa('alice');

      expect(userService.updateById).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          mfa: expect.objectContaining({
            methods: expect.objectContaining({
              webauthn: expect.objectContaining({ verified_at: NOW }),
            }),
          }),
        })
      );
    });

    it('rejects enabling WebAuthn MFA without credentials', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(user({ mfa: undefined }));

      await expect(service.enableWebAuthnMfa('alice')).rejects.toThrow(
        'Cannot enable WebAuthn MFA without any registered credentials'
      );
    });

    it.each([
      [{ totp: { enabled: true, secret: 'secret' } }, true],
      [{ email: { enabled: true } }, true],
      [{}, false],
    ])(
      'disables WebAuthn while retaining other MFA state %#',
      async (otherMethods, enabled) => {
        const { service, userService } = makeService();
        userService.findByUsername.mockResolvedValue(
          user({
            mfa: {
              enabled: true,
              methods: {
                ...otherMethods,
                webauthn: { enabled: true, credentials: [credential()] },
              },
            },
          })
        );

        await service.disableWebAuthnMfa('alice');

        expect(userService.updateById).toHaveBeenCalledWith(
          'user-id',
          expect.objectContaining({
            mfa: expect.objectContaining({
              enabled,
              methods: expect.objectContaining({
                webauthn: {
                  enabled: false,
                  credentials: [],
                  verified_at: undefined,
                },
              }),
            }),
          })
        );
      }
    );
  });

  describe('default credential names', () => {
    it.each([
      ['Mozilla Macintosh Mac OS', undefined, 'Mac Touch ID'],
      ['Mozilla iPhone Mac OS X', undefined, 'iPhone/iPad'],
      ['Mozilla iPad Mac OS X', undefined, 'iPhone/iPad'],
      ['Mozilla Windows NT 10.0', undefined, 'Windows Hello'],
      ['Mozilla Android 14', undefined, 'Android Device'],
      ['Mozilla Linux x86_64', undefined, 'Linux Device'],
      ['Mozilla iPhone', undefined, 'iPhone'],
      ['Mozilla iPad', undefined, 'iPad'],
      ['Unknown Browser', undefined, 'Passkey'],
      ['Anything', 'cross-platform', 'Security Key'],
    ] as const)(
      'names %s with attachment %s',
      (userAgent, attachment, expected) => {
        const { service } = makeService();
        expect(
          service.generateDefaultCredentialName(userAgent, attachment)
        ).toBe(expected);
      }
    );
  });
});
