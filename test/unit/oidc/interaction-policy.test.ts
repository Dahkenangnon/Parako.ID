import { beforeEach, describe, expect, it, vi } from 'vitest';

const policyHarness = vi.hoisted(() => {
  const checks = new Map<string, (ctx: unknown) => Promise<unknown>>();
  const basePolicy = { add: vi.fn() };
  const prompts = new Map<string, Record<string, unknown>>();

  class Check {
    static readonly NO_NEED_TO_PROMPT = 'NO_NEED_TO_PROMPT';
    static readonly REQUEST_PROMPT = 'REQUEST_PROMPT';

    constructor(
      name: string,
      _description: string,
      execute: (ctx: unknown) => Promise<unknown>
    ) {
      checks.set(name, execute);
    }
  }

  class Prompt {
    readonly checks = { add: vi.fn() };

    constructor(readonly options: Record<string, unknown>) {
      prompts.set(options.name as string, options);
    }
  }

  return {
    base: vi.fn(() => basePolicy),
    basePolicy,
    Check,
    checks,
    Prompt,
    prompts,
  };
});

vi.mock('oidc-provider', () => ({
  interactionPolicy: {
    base: policyHarness.base,
    Check: policyHarness.Check,
    Prompt: policyHarness.Prompt,
  },
}));

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import Interaction from '../../../src/oidc/specs/interaction.js';

describe('OIDC interaction policy', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let logger: {
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let sessionManager: {
    getAuthenticatedUsers: ReturnType<typeof vi.fn>;
  };
  let userService: { findByUsername: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    config = getDefaultFullConfig();
    logger = { error: vi.fn(), info: vi.fn() };
    sessionManager = { getAuthenticatedUsers: vi.fn() };
    userService = { findByUsername: vi.fn() };
    policyHarness.checks.clear();
    policyHarness.prompts.clear();
    policyHarness.basePolicy.add.mockClear();
  });

  const buildPolicy = () =>
    Interaction(
      { getConfig: vi.fn(() => config) } as any,
      userService as any,
      sessionManager as any,
      logger as any
    );

  const selectAccountCheck = () => {
    buildPolicy();
    return policyHarness.checks.get('select_account_prompt')!;
  };

  const mfaCheck = () => {
    buildPolicy();
    return policyHarness.checks.get('mfa_needed')!;
  };

  it('honors an explicit select_account prompt for a multi-account session', async () => {
    sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: { username: 'alice' },
      others: [{ username: 'bob' }],
    });

    await expect(
      selectAccountCheck()({
        oidc: {
          params: { prompt: 'select_account' },
          session: { accountId: 'alice', amr: [] },
        },
        req: {},
      })
    ).resolves.toBe(policyHarness.Check.REQUEST_PROMPT);
  });

  it('does not treat a prompt substring as select_account', async () => {
    sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: { username: 'alice' },
      others: [{ username: 'bob' }],
    });

    await expect(
      selectAccountCheck()({
        oidc: {
          params: { prompt: 'not_select_account' },
          session: { accountId: 'alice', amr: [] },
        },
        req: {},
      })
    ).resolves.toBe(policyHarness.Check.NO_NEED_TO_PROMPT);
    expect(sessionManager.getAuthenticatedUsers).not.toHaveBeenCalled();
  });

  it('skips account selection when prompt parameters are absent', async () => {
    await expect(selectAccountCheck()({ oidc: {}, req: {} })).resolves.toBe(
      policyHarness.Check.NO_NEED_TO_PROMPT
    );
  });

  it('can request account selection before an OIDC session exists', async () => {
    sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: { username: 'alice' },
      others: [{ username: 'bob' }],
    });

    await expect(
      selectAccountCheck()({
        oidc: { params: { prompt: 'select_account' } },
        req: {},
      })
    ).resolves.toBe(policyHarness.Check.REQUEST_PROMPT);
  });

  it('registers account-selection and MFA prompts before the base policy', () => {
    const interaction = buildPolicy();

    expect(policyHarness.prompts.get('select_account')).toEqual({
      name: 'select_account',
      requestable: true,
    });
    expect(policyHarness.prompts.get('mfa')).toEqual({
      name: 'mfa',
      requestable: false,
    });
    expect(policyHarness.basePolicy.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        options: { name: 'select_account', requestable: true },
      }),
      0
    );
    expect(policyHarness.basePolicy.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ options: { name: 'mfa', requestable: false } }),
      1
    );
    expect(interaction.url({} as any, { uid: 'interaction-id' } as any)).toBe(
      `${config.oidc.path}/interaction/interaction-id`
    );
  });

  it('skips account selection once its AMR marker is present', async () => {
    await expect(
      selectAccountCheck()({
        oidc: {
          params: { prompt: 'login select_account' },
          session: { amr: ['pwd', 'select_account'] },
        },
        req: {},
      })
    ).resolves.toBe(policyHarness.Check.NO_NEED_TO_PROMPT);
  });

  it.each([
    {
      name: 'the request is unavailable',
      ctx: {
        oidc: { params: { prompt: 'select_account' }, session: { amr: [] } },
      },
      authenticatedUsers: undefined,
    },
    {
      name: 'the browser session has no authenticated users',
      ctx: {
        oidc: { params: { prompt: 'select_account' }, session: { amr: [] } },
        req: {},
      },
      authenticatedUsers: undefined,
    },
    {
      name: 'only one account is authenticated',
      ctx: {
        oidc: { params: { prompt: 'select_account' }, session: { amr: [] } },
        req: {},
      },
      authenticatedUsers: { active: { username: 'alice' } },
    },
  ])(
    'skips account selection when $name',
    async ({ ctx, authenticatedUsers }) => {
      sessionManager.getAuthenticatedUsers.mockReturnValue(authenticatedUsers);

      await expect(selectAccountCheck()(ctx)).resolves.toBe(
        policyHarness.Check.NO_NEED_TO_PROMPT
      );
    }
  );

  it('skips MFA when it is globally disabled', async () => {
    config.security.authentication.multi_factor.enabled = false;

    await expect(mfaCheck()({ oidc: {} })).resolves.toBe(
      policyHarness.Check.NO_NEED_TO_PROMPT
    );
    expect(logger.info).toHaveBeenCalledWith(
      'MFA check failed: MFA not enabled globally',
      { mfaEnabled: false }
    );
  });

  it.each([
    { name: 'no requested ACR', params: {}, session: { accountId: 'alice' } },
    {
      name: 'no authenticated account',
      params: { acr_values: 'urn:mfa:otp' },
      session: undefined,
    },
  ])('skips MFA with $name', async ({ params, session }) => {
    config.security.authentication.multi_factor.enabled = true;

    await expect(mfaCheck()({ oidc: { params, session } })).resolves.toBe(
      policyHarness.Check.NO_NEED_TO_PROMPT
    );
    expect(userService.findByUsername).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing user', user: null },
    { name: 'disabled MFA', user: { mfa: { enabled: false, methods: {} } } },
    { name: 'missing methods', user: { mfa: { enabled: true } } },
  ])('skips MFA for a user with $name', async ({ user }) => {
    config.security.authentication.multi_factor.enabled = true;
    userService.findByUsername.mockResolvedValue(user);

    await expect(
      mfaCheck()({
        oidc: {
          params: { acr_values: 'urn:mfa:otp' },
          session: { accountId: 'alice' },
        },
      })
    ).resolves.toBe(policyHarness.Check.NO_NEED_TO_PROMPT);
  });

  it.each([
    {
      name: 'OTP when only WebAuthn is available',
      acrValues: 'urn:mfa:otp',
      methods: {
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
    },
    {
      name: 'WebAuthn when only email OTP is available',
      acrValues: 'urn:mfa:webauthn',
      methods: { email: { enabled: true } },
    },
    {
      name: 'WebAuthn when no credential is registered',
      acrValues: 'urn:mfa:webauthn',
      methods: { webauthn: { enabled: true } },
    },
  ])('skips $name', async ({ acrValues, methods }) => {
    config.security.authentication.multi_factor.enabled = true;
    userService.findByUsername.mockResolvedValue({
      mfa: { enabled: true, methods },
    });

    await expect(
      mfaCheck()({
        oidc: {
          params: { acr_values: acrValues },
          session: { accountId: 'alice' },
        },
      })
    ).resolves.toBe(policyHarness.Check.NO_NEED_TO_PROMPT);
  });

  it.each([
    {
      name: 'OTP',
      acrValues: 'urn:mfa:otp',
      methods: { totp: { enabled: true, secret: 'encrypted-secret' } },
      amr: [],
      expected: policyHarness.Check.REQUEST_PROMPT,
    },
    {
      name: 'email OTP',
      acrValues: 'urn:mfa:otp',
      methods: { email: { enabled: true } },
      amr: [],
      expected: policyHarness.Check.REQUEST_PROMPT,
    },
    {
      name: 'WebAuthn',
      acrValues: 'urn:mfa:webauthn',
      methods: {
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
      amr: [],
      expected: policyHarness.Check.REQUEST_PROMPT,
    },
    {
      name: 'satisfied OTP',
      acrValues: 'urn:mfa:otp',
      methods: { email: { enabled: true } },
      amr: ['otp'],
      expected: policyHarness.Check.NO_NEED_TO_PROMPT,
    },
    {
      name: 'satisfied WebAuthn',
      acrValues: 'urn:mfa:webauthn',
      methods: {
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
      amr: ['hwk'],
      expected: policyHarness.Check.NO_NEED_TO_PROMPT,
    },
    {
      name: 'both methods already satisfied',
      acrValues: 'urn:mfa:otp urn:mfa:webauthn',
      methods: {
        email: { enabled: true },
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
      amr: ['otp', 'hwk'],
      expected: policyHarness.Check.NO_NEED_TO_PROMPT,
    },
    {
      name: 'either requested method satisfied by OTP',
      acrValues: 'urn:mfa:otp urn:mfa:webauthn',
      methods: {
        email: { enabled: true },
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
      amr: ['otp'],
      expected: policyHarness.Check.NO_NEED_TO_PROMPT,
    },
    {
      name: 'either requested method satisfied by WebAuthn',
      acrValues: 'urn:mfa:otp urn:mfa:webauthn',
      methods: {
        email: { enabled: true },
        webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
      },
      amr: ['hwk'],
      expected: policyHarness.Check.NO_NEED_TO_PROMPT,
    },
  ])(
    '$name follows the expected MFA policy result',
    async ({ acrValues, methods, amr, expected }) => {
      config.security.authentication.multi_factor.enabled = true;
      userService.findByUsername.mockResolvedValue({
        mfa: { enabled: true, methods },
      });

      await expect(
        mfaCheck()({
          oidc: {
            params: { acr_values: acrValues },
            session: { accountId: 'alice', amr },
          },
        })
      ).resolves.toBe(expected);
    }
  );

  it('fails open when the MFA user lookup fails', async () => {
    config.security.authentication.multi_factor.enabled = true;
    const error = new Error('database unavailable');
    userService.findByUsername.mockRejectedValue(error);

    await expect(
      mfaCheck()({
        oidc: {
          params: { acr_values: 'urn:mfa:otp' },
          session: { accountId: 'alice' },
        },
      })
    ).resolves.toBe(policyHarness.Check.NO_NEED_TO_PROMPT);
    expect(logger.error).toHaveBeenCalledWith(
      'Error checking user MFA status:',
      { error }
    );
  });

  it('requests MFA when both methods are requested and neither is satisfied', async () => {
    config.security.authentication.multi_factor.enabled = true;
    userService.findByUsername.mockResolvedValue({
      mfa: {
        enabled: true,
        methods: {
          email: { enabled: true },
          webauthn: { enabled: true, credentials: [{ id: 'credential' }] },
        },
      },
    });

    await expect(
      mfaCheck()({
        oidc: {
          params: { acr_values: 'urn:mfa:otp urn:mfa:webauthn' },
          session: { accountId: 'alice' },
        },
      })
    ).resolves.toBe(policyHarness.Check.REQUEST_PROMPT);
  });
});
