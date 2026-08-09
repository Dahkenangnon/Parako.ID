import { describe, expect, it, vi } from 'vitest';

import IssueRefreshToken from '../../../src/oidc/specs/issue-refresh-token.js';

function createClient({
  refreshTokenAllowed = true,
  applicationType = 'web',
  tokenEndpointAuthMethod = 'client_secret_basic',
}: {
  refreshTokenAllowed?: boolean;
  applicationType?: string;
  tokenEndpointAuthMethod?: string;
} = {}) {
  return {
    applicationType,
    tokenEndpointAuthMethod,
    grantTypeAllowed: vi.fn().mockReturnValue(refreshTokenAllowed),
  };
}

describe('OIDC refresh-token issuance policy', () => {
  const shouldIssue = IssueRefreshToken();

  it('rejects clients that may not use the refresh-token grant', async () => {
    const client = createClient({ refreshTokenAllowed: false });
    const code = {
      get scopes(): never {
        throw new Error('code must not be inspected');
      },
    };

    await expect(
      shouldIssue({} as never, client as never, code as never)
    ).resolves.toBe(false);
    expect(client.grantTypeAllowed).toHaveBeenCalledWith('refresh_token');
  });

  it('issues a refresh token when an authorization code has offline_access', async () => {
    const client = createClient();

    await expect(
      shouldIssue(
        {} as never,
        client as never,
        {
          scopes: new Set(['openid', 'offline_access']),
        } as never
      )
    ).resolves.toBe(true);
  });

  it('issues one to a public web client without offline_access', async () => {
    const client = createClient({ tokenEndpointAuthMethod: 'none' });

    await expect(
      shouldIssue(
        {} as never,
        client as never,
        {
          scopes: new Set(['openid']),
        } as never
      )
    ).resolves.toBe(true);
  });

  it.each([
    [
      'a confidential web client',
      { applicationType: 'web', tokenEndpointAuthMethod: 'client_secret_post' },
    ],
    [
      'a public native client',
      { applicationType: 'native', tokenEndpointAuthMethod: 'none' },
    ],
  ])(
    'does not issue one without offline_access to %s',
    async (_case, clientMetadata) => {
      const client = createClient(clientMetadata);

      await expect(
        shouldIssue(
          {} as never,
          client as never,
          {
            scopes: new Set(['openid']),
          } as never
        )
      ).resolves.toBe(false);
    }
  );

  it('issues one for a non-authorization code to a public web client', async () => {
    const client = createClient({ tokenEndpointAuthMethod: 'none' });

    await expect(
      shouldIssue({} as never, client as never, {} as never)
    ).resolves.toBe(true);
  });

  it.each([
    [
      'a confidential web client',
      { applicationType: 'web', tokenEndpointAuthMethod: 'private_key_jwt' },
    ],
    [
      'a public native client',
      { applicationType: 'native', tokenEndpointAuthMethod: 'none' },
    ],
  ])(
    'does not issue one for a non-authorization code to %s',
    async (_case, clientMetadata) => {
      await expect(
        shouldIssue(
          {} as never,
          createClient(clientMetadata) as never,
          {} as never
        )
      ).resolves.toBe(false);
    }
  );
});
