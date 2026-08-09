import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exchangeTier1Code,
  extractBaseDomain,
  fetchTier1UserProfile,
  mapTier1Profile,
  mapTier1Tokens,
  resolveTier1Endpoints,
} from '../../../src/integration/social-tier-utils.js';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

describe('social tier utilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('extractBaseDomain', () => {
    it.each([
      ['https://parako.example/', 'parako.example'],
      ['http://parako.example', 'parako.example'],
      ['parako.example/', 'parako.example'],
      ['', ''],
    ])('normalizes %j to %j', (input, expected) => {
      expect(extractBaseDomain(input)).toBe(expected);
    });
  });

  describe('resolveTier1Endpoints', () => {
    it.each([
      [
        'google',
        'https://oauth2.googleapis.com/token',
        'https://www.googleapis.com/oauth2/v2/userinfo',
      ],
      [
        'microsoft',
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        'https://graph.microsoft.com/oidc/userinfo',
      ],
      [
        'github',
        'https://github.com/login/oauth/access_token',
        'https://api.github.com/user',
      ],
      [
        'linkedin',
        'https://www.linkedin.com/oauth/v2/accessToken',
        'https://api.linkedin.com/v2/userinfo',
      ],
      [
        'facebook',
        'https://graph.facebook.com/v19.0/oauth/access_token',
        'https://graph.facebook.com/me',
      ],
    ])(
      'uses fixed endpoints for %s instead of tenant-supplied URLs',
      (provider, tokenEndpoint, userinfoEndpoint) => {
        expect(
          resolveTier1Endpoints(provider, {
            token_endpoint: 'http://attacker.invalid/token',
            userinfo_endpoint: 'http://attacker.invalid/userinfo',
          })
        ).toEqual({
          token_endpoint: tokenEndpoint,
          userinfo_endpoint: userinfoEndpoint,
        });
      }
    );

    it('uses configured endpoints for an unknown provider when both exist', () => {
      expect(
        resolveTier1Endpoints('custom', {
          token_endpoint: 'https://custom.example/token',
          userinfo_endpoint: 'https://custom.example/userinfo',
        })
      ).toEqual({
        token_endpoint: 'https://custom.example/token',
        userinfo_endpoint: 'https://custom.example/userinfo',
      });
    });

    it.each([
      [{ token_endpoint: 'https://custom.example/token' }],
      [{ userinfo_endpoint: 'https://custom.example/userinfo' }],
      [{}],
    ])('returns null when a custom provider endpoint is incomplete', config => {
      expect(resolveTier1Endpoints('custom', config)).toBeNull();
    });
  });

  describe('exchangeTier1Code', () => {
    const config = {
      token_endpoint: 'https://provider.example/token',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: 'https://ops.example/callback',
    };

    it('posts the authorization-code exchange and returns the token response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: 'access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        exchangeTier1Code('authorization-code', config)
      ).resolves.toEqual({
        access_token: 'access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(config.token_endpoint);
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'parako-id/1.0.0',
        },
      });
      expect(new URLSearchParams(init.body as string)).toEqual(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'authorization-code',
          client_id: 'client-id',
          client_secret: 'client-secret',
          redirect_uri: 'https://ops.example/callback',
        })
      );
    });

    it('reports a bounded provider error when token exchange fails', async () => {
      const providerError = `provider failure: ${'x'.repeat(300)}`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(providerError, { status: 400 }))
      );

      await expect(exchangeTier1Code('bad-code', config)).rejects.toThrow(
        `Token exchange failed (400): ${providerError.slice(0, 200)}`
      );
    });

    it.each([{}, { access_token: 42 }])(
      'rejects a token response without a string access token',
      async body => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));

        await expect(exchangeTier1Code('code', config)).rejects.toThrow(
          'Token exchange response missing access_token'
        );
      }
    );
  });

  describe('fetchTier1UserProfile', () => {
    it('fetches and returns the provider profile with bearer authorization', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ sub: 'provider-user' }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        fetchTier1UserProfile(
          'access-token',
          'https://provider.example/userinfo',
          'google'
        )
      ).resolves.toEqual({ sub: 'provider-user' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://provider.example/userinfo',
        {
          headers: {
            Authorization: 'Bearer access-token',
            Accept: 'application/json',
            'User-Agent': 'parako-id/1.0.0',
          },
        }
      );
    });

    it('reports the provider and status when userinfo fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 503 }))
      );

      await expect(
        fetchTier1UserProfile(
          'access-token',
          'https://provider.example/userinfo',
          'google'
        )
      ).rejects.toThrow('Userinfo fetch failed for google (503)');
    });
  });

  describe('mapTier1Profile', () => {
    it('maps a GitHub profile', () => {
      const raw = {
        id: 123,
        email: 'octo@example.com',
        name: 'Octo Cat',
        avatar_url: 'https://example.com/avatar.png',
        login: 'octocat',
      };

      expect(mapTier1Profile('github', raw)).toEqual({
        sub: '123',
        email: 'octo@example.com',
        name: 'Octo Cat',
        picture: 'https://example.com/avatar.png',
        provider_username: 'octocat',
        raw_data: raw,
      });
      expect(mapTier1Profile('github', {})).toEqual({
        sub: '',
        email: undefined,
        name: undefined,
        picture: undefined,
        provider_username: undefined,
        raw_data: {},
      });
    });

    it('maps Google subject and profile fields with an id fallback', () => {
      const raw = {
        sub: 'google-sub',
        email: 'user@example.com',
        email_verified: true,
        name: 'User Name',
        given_name: 'User',
        family_name: 'Name',
        picture: 'https://example.com/picture.png',
        locale: 'en',
      };

      expect(mapTier1Profile('google', raw)).toEqual({
        ...raw,
        raw_data: raw,
      });
      expect(mapTier1Profile('google', { id: 456 })).toMatchObject({
        sub: '456',
      });
      expect(mapTier1Profile('google', {})).toMatchObject({ sub: '' });
    });

    it.each(['microsoft', 'linkedin'])(
      'maps standard OIDC profile fields for %s',
      provider => {
        const raw = {
          sub: `${provider}-sub`,
          email: 'user@example.com',
          email_verified: false,
          name: 'User Name',
          given_name: 'User',
          family_name: 'Name',
          picture: 'https://example.com/picture.png',
        };

        expect(mapTier1Profile(provider, raw)).toEqual({
          ...raw,
          raw_data: raw,
        });
        expect(mapTier1Profile(provider, {})).toMatchObject({ sub: '' });
      }
    );

    it('maps Facebook nested picture data and tolerates an absent picture', () => {
      const raw = {
        id: 'facebook-id',
        email: 'user@example.com',
        name: 'User Name',
        picture: { data: { url: 'https://example.com/facebook.png' } },
      };

      expect(mapTier1Profile('facebook', raw)).toEqual({
        sub: 'facebook-id',
        email: 'user@example.com',
        name: 'User Name',
        picture: 'https://example.com/facebook.png',
        raw_data: raw,
      });
      expect(mapTier1Profile('facebook', {})).toMatchObject({
        sub: '',
        picture: undefined,
      });
    });

    it('best-effort maps an unknown provider with subject fallbacks', () => {
      const raw = {
        sub: 'custom-sub',
        email: 'user@example.com',
        name: 'User Name',
      };
      expect(mapTier1Profile('custom', raw)).toEqual({
        ...raw,
        raw_data: raw,
      });
      expect(mapTier1Profile('custom', { id: 789 })).toMatchObject({
        sub: '789',
      });
      expect(mapTier1Profile('custom', {})).toMatchObject({ sub: '' });
    });
  });

  describe('mapTier1Tokens', () => {
    it('maps a complete token response and computes expires_at', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'));

      expect(
        mapTier1Tokens({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          id_token: 'id-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile',
        })
      ).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
        token_type: 'Bearer',
        expires_at: new Date('2026-08-08T01:00:00.000Z'),
        scope: 'openid profile',
      });
    });

    it('leaves optional token fields undefined when absent', () => {
      expect(mapTier1Tokens({ access_token: 'access-token' })).toEqual({
        access_token: 'access-token',
        refresh_token: undefined,
        id_token: undefined,
        token_type: undefined,
        expires_at: undefined,
        scope: undefined,
      });
    });
  });
});
