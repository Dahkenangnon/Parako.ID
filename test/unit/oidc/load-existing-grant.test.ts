import { describe, expect, it, vi } from 'vitest';

import LoadExistingGrant from '../../../src/oidc/specs/load-existing-grant.js';

function createLoader() {
  const logger = { error: vi.fn() };
  return {
    loadGrant: LoadExistingGrant(logger as never),
    logger,
  };
}

describe('OIDC loadExistingGrant', () => {
  it('does not load or create a grant when no client was resolved', async () => {
    const { loadGrant, logger } = createLoader();

    await expect(loadGrant({ oidc: {} } as never)).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not create an internal-client grant without an authenticated account', async () => {
    const { loadGrant, logger } = createLoader();
    const Grant = vi.fn();

    await expect(
      loadGrant({
        oidc: {
          client: { clientId: 'internal-client', isInternalClient: true },
          provider: { Grant },
          session: { grantIdFor: vi.fn().mockReturnValue(undefined) },
        },
      } as never)
    ).resolves.toBeUndefined();
    expect(Grant).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('creates and saves an authenticated internal-client OIDC grant', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    const result = await loadGrant({
      oidc: {
        client: { clientId: 'internal-client', isInternalClient: true },
        params: { scope: 'openid profile' },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(result).toBe(grant);
    expect(Grant).toHaveBeenCalledWith({
      clientId: 'internal-client',
      accountId: 'account-123',
    });
    expect(grant.addOIDCScope).toHaveBeenCalledWith('openid profile');
    expect(grant.addResourceScope).not.toHaveBeenCalled();
    expect(grant.save).toHaveBeenCalledOnce();
  });

  it('grants only internal-client resource scopes allowed by client metadata', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    await loadGrant({
      oidc: {
        client: {
          clientId: 'internal-client',
          isInternalClient: true,
          resourcesScopes: 'api:read api:write',
        },
        params: {
          resource: 'https://api.example',
          scope: 'openid api:read forbidden api:write',
        },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(grant.addResourceScope).toHaveBeenCalledWith(
      'https://api.example',
      'api:read api:write'
    );
  });

  it('adds allowed scopes for every requested resource indicator', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    await loadGrant({
      oidc: {
        client: {
          clientId: 'internal-client',
          isInternalClient: true,
          resourcesScopes: 'api:read',
        },
        params: {
          resource: ['https://api.example', 'https://reports.example'],
          scope: 'openid api:read',
        },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(grant.addResourceScope).toHaveBeenCalledTimes(2);
    expect(grant.addResourceScope).toHaveBeenNthCalledWith(
      1,
      'https://api.example',
      'api:read'
    );
    expect(grant.addResourceScope).toHaveBeenNthCalledWith(
      2,
      'https://reports.example',
      'api:read'
    );
  });

  it('loads the grant selected by the current consent result before the session grant', async () => {
    const { loadGrant } = createLoader();
    const grant = { save: vi.fn() };
    const find = vi.fn().mockResolvedValue(grant);
    const grantIdFor = vi.fn().mockReturnValue('session-grant');

    const result = await loadGrant({
      oidc: {
        client: { clientId: 'external-client' },
        provider: { Grant: { find } },
        result: { consent: { grantId: 'consent-grant' } },
        session: { grantIdFor },
      },
    } as never);

    expect(result).toBe(grant);
    expect(find).toHaveBeenCalledWith('consent-grant');
    expect(grantIdFor).not.toHaveBeenCalled();
  });

  it('loads the client grant recorded in the current session', async () => {
    const { loadGrant } = createLoader();
    const grant = { save: vi.fn() };
    const find = vi.fn().mockResolvedValue(grant);
    const grantIdFor = vi.fn().mockReturnValue('session-grant');

    const result = await loadGrant({
      oidc: {
        client: { clientId: 'external-client' },
        provider: { Grant: { find } },
        session: { grantIdFor },
      },
    } as never);

    expect(result).toBe(grant);
    expect(grantIdFor).toHaveBeenCalledWith('external-client');
    expect(find).toHaveBeenCalledWith('session-grant');
  });

  it('returns no grant when a recorded grant no longer exists', async () => {
    const { loadGrant, logger } = createLoader();
    const find = vi.fn().mockResolvedValue(undefined);

    await expect(
      loadGrant({
        oidc: {
          client: { clientId: 'external-client' },
          provider: { Grant: { find } },
          session: {
            grantIdFor: vi.fn().mockReturnValue('stale-grant'),
          },
        },
      } as never)
    ).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledWith('stale-grant');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('extends an older grant expiration to the authenticated session expiration', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      exp: 100,
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const find = vi.fn().mockResolvedValue(grant);

    const result = await loadGrant({
      oidc: {
        account: { accountId: 'account-123' },
        client: { clientId: 'external-client' },
        provider: { Grant: { find } },
        result: { consent: { grantId: 'existing-grant' } },
        session: { exp: 200, grantIdFor: vi.fn() },
      },
    } as never);

    expect(result).toBe(grant);
    expect(grant.exp).toBe(200);
    expect(grant.save).toHaveBeenCalledOnce();
  });

  it('returns no grant when neither consent nor the session identifies one', async () => {
    const { loadGrant, logger } = createLoader();
    const find = vi.fn();

    const result = await loadGrant({
      oidc: {
        client: { clientId: 'external-client' },
        provider: { Grant: { find } },
        session: { grantIdFor: vi.fn().mockReturnValue(undefined) },
      },
    } as never);

    expect(result).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails closed and logs the original error when the grant store fails', async () => {
    const { loadGrant, logger } = createLoader();
    const error = new Error('grant store unavailable');
    const find = vi.fn().mockRejectedValue(error);

    const result = await loadGrant({
      oidc: {
        client: { clientId: 'external-client' },
        provider: { Grant: { find } },
        session: { grantIdFor: vi.fn().mockReturnValue('existing-grant') },
      },
    } as never);

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Error in loadExistingGrant:', {
      error,
    });
  });

  it('treats a client explicitly marked as non-internal as an external client', async () => {
    const { loadGrant } = createLoader();
    const grant = { save: vi.fn() };
    const find = vi.fn().mockResolvedValue(grant);

    const result = await loadGrant({
      oidc: {
        client: {
          clientId: 'external-client',
          isInternalClient: false,
        },
        provider: { Grant: { find } },
        session: { grantIdFor: vi.fn().mockReturnValue('existing-grant') },
      },
    } as never);

    expect(result).toBe(grant);
    expect(find).toHaveBeenCalledWith('existing-grant');
  });

  it('grants no resource scopes from malformed internal-client metadata', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    await loadGrant({
      oidc: {
        client: {
          clientId: 'internal-client',
          isInternalClient: true,
          resourcesScopes: ['api:read'],
        },
        params: {
          resource: 'https://api.example',
          scope: ['openid', 'api:read'],
        },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(grant.addOIDCScope).not.toHaveBeenCalled();
    expect(grant.addResourceScope).not.toHaveBeenCalled();
    expect(grant.save).toHaveBeenCalledOnce();
  });

  it('ignores empty and non-string resource indicators', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    await loadGrant({
      oidc: {
        client: {
          clientId: 'internal-client',
          isInternalClient: true,
          resourcesScopes: 'api:read',
        },
        params: {
          resource: ['', 42, 'https://api.example'],
          scope: 'openid api:read',
        },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(grant.addResourceScope).toHaveBeenCalledOnce();
    expect(grant.addResourceScope).toHaveBeenCalledWith(
      'https://api.example',
      'api:read'
    );
  });

  it('does not grant scopes for a non-string scalar resource indicator', async () => {
    const { loadGrant } = createLoader();
    const grant = {
      addOIDCScope: vi.fn(),
      addResourceScope: vi.fn(),
      save: vi.fn().mockResolvedValue('grant-id'),
    };
    const Grant = vi.fn(function GrantConstructor() {
      return grant;
    });

    await loadGrant({
      oidc: {
        client: {
          clientId: 'internal-client',
          isInternalClient: true,
          resourcesScopes: 'api:read',
        },
        params: { resource: 42, scope: 'openid api:read' },
        provider: { Grant },
        session: {
          accountId: 'account-123',
          grantIdFor: vi.fn().mockReturnValue(undefined),
        },
      },
    } as never);

    expect(grant.addResourceScope).not.toHaveBeenCalled();
    expect(grant.save).toHaveBeenCalledOnce();
  });
});
