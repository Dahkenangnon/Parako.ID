import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

import { OIDCBackchannelLogoutService } from '../../../src/oidc/backchannel-logout.service.js';

function createHarness() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      features: { oidc: { backchannel_logout: { enabled: true } } },
    }),
  };
  const clients = new Map<string, Record<string, unknown>>();
  const provider = {
    Client: {
      find: vi.fn(async (clientId: string) => clients.get(clientId)),
    },
  };
  const providerService = {
    getProviderForTenant: vi.fn().mockResolvedValue(provider),
  };
  const service = new (OIDCBackchannelLogoutService as any)(
    logger,
    configManager,
    providerService
  ) as OIDCBackchannelLogoutService;

  return {
    service,
    logger,
    configManager,
    clients,
    provider,
    providerService,
  };
}

function session(payload: Record<string, unknown>) {
  return { _id: 'session-1', payload };
}

describe('OIDCBackchannelLogoutService', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('notifies every registered client with the account and its session identifier', async () => {
    const firstLogout = vi.fn().mockResolvedValue(undefined);
    const secondLogout = vi.fn().mockResolvedValue(undefined);
    harness.clients.set('client-a', {
      backchannelLogoutUri: 'https://a.example.test/backchannel-logout',
      backchannelLogout: firstLogout,
    });
    harness.clients.set('client-b', {
      backchannelLogoutUri: 'https://b.example.test/backchannel-logout',
      backchannelLogout: secondLogout,
    });

    await harness.service.notifySessionRevocation(
      session({
        accountId: 'alice',
        authorizations: {
          'client-a': { sid: 'sid-a' },
          'client-b': { sid: 'sid-b' },
        },
      }),
      'tenant-a'
    );

    expect(harness.providerService.getProviderForTenant).toHaveBeenCalledOnce();
    expect(harness.providerService.getProviderForTenant).toHaveBeenCalledWith(
      'tenant-a'
    );
    expect(harness.provider.Client.find).toHaveBeenCalledTimes(2);
    expect(firstLogout).toHaveBeenCalledWith('alice', 'sid-a');
    expect(secondLogout).toHaveBeenCalledWith('alice', 'sid-b');
  });

  it('does nothing when back-channel logout is disabled', async () => {
    harness.configManager.getConfig.mockReturnValue({
      features: { oidc: { backchannel_logout: { enabled: false } } },
    });

    await harness.service.notifySessionRevocation(
      session({
        accountId: 'alice',
        authorizations: { client: { sid: 'sid' } },
      }),
      'tenant-a'
    );

    expect(harness.providerService.getProviderForTenant).not.toHaveBeenCalled();
  });

  it.each([
    session({}),
    session({ accountId: '' }),
    session({ accountId: 'alice' }),
    session({ accountId: 'alice', authorizations: [] }),
    session({
      accountId: 'alice',
      authorizations: { client: {}, empty: { sid: '' }, malformed: null },
    }),
  ])(
    'ignores a session without a usable notification target %#',
    async value => {
      await harness.service.notifySessionRevocation(value, 'tenant-a');

      expect(
        harness.providerService.getProviderForTenant
      ).not.toHaveBeenCalled();
    }
  );

  it('skips unknown clients and clients without a back-channel logout endpoint', async () => {
    const unreachableMethod = vi.fn();
    harness.clients.set('no-endpoint', {
      backchannelLogout: unreachableMethod,
    });

    await harness.service.notifySessionRevocation(
      session({
        accountId: 'alice',
        authorizations: {
          unknown: { sid: 'sid-unknown' },
          'no-endpoint': { sid: 'sid-no-endpoint' },
        },
      }),
      'tenant-a'
    );

    expect(unreachableMethod).not.toHaveBeenCalled();
    expect(harness.logger.warn).not.toHaveBeenCalled();
  });

  it('continues notifying other clients when one notification fails', async () => {
    const failure = new Error('RP unavailable');
    const successfulLogout = vi.fn().mockResolvedValue(undefined);
    harness.clients.set('failed-client', {
      backchannelLogoutUri: 'https://failed.example.test/backchannel-logout',
      backchannelLogout: vi.fn().mockRejectedValue(failure),
    });
    harness.clients.set('working-client', {
      backchannelLogoutUri: 'https://working.example.test/backchannel-logout',
      backchannelLogout: successfulLogout,
    });

    await expect(
      harness.service.notifySessionRevocation(
        session({
          accountId: 'alice',
          authorizations: {
            'failed-client': { sid: 'sid-failed' },
            'working-client': { sid: 'sid-working' },
          },
        }),
        'tenant-a'
      )
    ).resolves.toBeUndefined();

    expect(successfulLogout).toHaveBeenCalledWith('alice', 'sid-working');
    expect(harness.logger.warn).toHaveBeenCalledWith(
      'OIDC back-channel logout notification failed',
      {
        tenantId: 'tenant-a',
        clientId: 'failed-client',
        accountId: 'alice',
        sid: 'sid-failed',
        error: 'RP unavailable',
      }
    );
  });

  it('does not fail revocation when the tenant provider cannot be resolved', async () => {
    harness.providerService.getProviderForTenant.mockRejectedValue(
      new Error('provider unavailable')
    );

    await expect(
      harness.service.notifySessionRevocation(
        session({
          accountId: 'alice',
          authorizations: { client: { sid: 'sid' } },
        }),
        'tenant-a'
      )
    ).resolves.toBeUndefined();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'OIDC back-channel logout provider unavailable',
      {
        tenantId: 'tenant-a',
        accountId: 'alice',
        error: 'provider unavailable',
      }
    );
  });
});
