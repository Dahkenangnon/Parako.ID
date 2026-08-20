import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addClient,
  findClientById,
  generateClientId,
  generateClientSecret,
  loadClientRegistryConfig,
  saveClientRegistryConfig,
} from '../../../scripts/manage/client/local-client-manager.js';

describe('local OIDC client registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preserves HTTPS URLs while parsing comments and trailing commas', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`{
      // RP configuration
      "version": "1.0.0",
      "clients": [{
        "client_id": "demo",
        "application_type": "web",
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "redirect_uris": ["https://rp.example.com/callback"],
        "post_logout_redirect_uris": [],
        "scope": "openid",
      }],
    }`);

    const config = loadClientRegistryConfig();

    expect(config.clients).toHaveLength(1);
    expect(config.clients[0]?.redirect_uris).toEqual([
      'https://rp.example.com/callback',
    ]);
    expect(config.created_at).toBe(Date.now());
    expect(config.updated_at).toBe(Date.now());
  });

  it('returns a timestamped empty registry when no local file exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(loadClientRegistryConfig()).toEqual({
      version: '1.0.0',
      created_at: Date.now(),
      updated_at: Date.now(),
      clients: [],
    });
  });

  it.each([
    ['null', 'Invalid configuration format'],
    ['{"version":"2.0.0","clients":{}}', 'clients must be an array'],
    ['{"clients":[}', 'Invalid JSONC configuration'],
  ])('fails closed for invalid configuration %#', (content, message) => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(content);

    expect(() => loadClientRegistryConfig()).toThrow(message);
  });

  it('normalizes non-Error read failures without exposing file contents', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw 'permission denied';
    });

    expect(() => loadClientRegistryConfig()).toThrow(
      'Failed to load client configuration: permission denied'
    );
  });

  it('generates bounded client identifiers and secrets from secure randomness', () => {
    expect(generateClientId()).toMatch(
      new RegExp(`^client_${Date.now().toString(36)}_[A-Za-z0-9._~-]{8}$`)
    );
    expect(generateClientId('service')).toMatch(
      new RegExp(`^service_${Date.now().toString(36)}_[A-Za-z0-9._~-]{8}$`)
    );
    expect(generateClientSecret(4)).toMatch(/^[A-Za-z0-9._~-]{4}$/);
    expect(generateClientSecret()).toMatch(/^[A-Za-z0-9._~-]{64}$/);
  });

  it('creates the runtime directory and saves a commented registry', () => {
    const config = {
      version: '1.0.0',
      created_at: 1,
      updated_at: 1,
      clients: [],
    };
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdir = vi
      .spyOn(fs, 'mkdirSync')
      .mockImplementation(() => undefined as any);
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const chmod = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});

    saveClientRegistryConfig(config);

    expect(config.updated_at).toBe(Date.now());
    expect(mkdir).toHaveBeenCalledWith(expect.stringMatching(/runtime$/), {
      recursive: true,
    });
    expect(write).toHaveBeenCalledWith(
      expect.stringMatching(/runtime\/parako-rp\.jsonc$/),
      expect.stringContaining('// Parako.ID OIDC Client Registry'),
      { encoding: 'utf8', mode: 0o600 }
    );
    expect(chmod).toHaveBeenCalledWith(
      expect.stringMatching(/runtime\/parako-rp\.jsonc$/),
      0o600
    );
  });

  it.each([
    [new Error('disk full'), 'disk full'],
    ['read only', 'read only'],
  ])('wraps registry persistence failure %#', (failure, message) => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw failure;
    });

    expect(() =>
      saveClientRegistryConfig({
        version: '1.0.0',
        created_at: 1,
        updated_at: 1,
        clients: [],
      })
    ).toThrow(`Failed to save client configuration: ${message}`);
  });

  it('finds a client by identifier or returns null', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        clients: [
          {
            client_id: 'known',
            application_type: 'web',
            token_endpoint_auth_method: 'none',
            grant_types: [],
            response_types: [],
            redirect_uris: [],
            post_logout_redirect_uris: [],
            scope: 'openid',
          },
        ],
      })
    );

    expect(findClientById('known')?.client_id).toBe('known');
    expect(findClientById('missing')).toBeNull();
  });

  it('adds a confidential client with generated identity and safe defaults', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ version: '1.0.0', clients: [] })
    );
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});

    const client = addClient({ client_name: 'Demo' });

    expect(client).toMatchObject({
      client_name: 'Demo',
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [],
      post_logout_redirect_uris: [],
      scope: 'openid',
      accessTokenFormat: 'jwt',
      require_pkce: false,
      active: true,
    });
    expect(client.client_id).toMatch(
      new RegExp(`^client_${Date.now().toString(36)}_[A-Za-z0-9._~-]{8}$`)
    );
    expect(client.client_secret).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    const saved = write.mock.calls[0]?.[1] as string;
    expect(saved).toContain(client.client_id);
    expect(saved).toContain(client.client_secret!);
  });

  it('preserves explicit public-client values without generating a secret', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ version: '1.0.0', clients: [] })
    );
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});

    const client = addClient({
      client_id: 'public-client',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: ['app:/callback'],
      post_logout_redirect_uris: ['app:/logout'],
      scope: 'openid profile',
      accessTokenFormat: 'opaque',
      require_pkce: true,
      allowedResources: ['api'],
      resourcesScopes: 'read',
      isInternalClient: true,
      contacts: ['owner@example.com'],
      tags: ['mobile'],
      active: false,
    });

    expect(client.client_secret).toBeUndefined();
    expect(client).toMatchObject({
      active: false,
      require_pkce: true,
      accessTokenFormat: 'opaque',
      allowedResources: ['api'],
      contacts: ['owner@example.com'],
      tags: ['mobile'],
    });
  });

  it('rejects a duplicate client identifier without writing', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        clients: [
          {
            client_id: 'duplicate',
            application_type: 'web',
            token_endpoint_auth_method: 'none',
            grant_types: [],
            response_types: [],
            redirect_uris: [],
            post_logout_redirect_uris: [],
            scope: 'openid',
          },
        ],
      })
    );
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    expect(() => addClient({ client_id: 'duplicate' })).toThrow(
      "Client with ID 'duplicate' already exists"
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('checks duplicate identifiers against the registry snapshot being updated', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const read = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValueOnce(
        JSON.stringify({
          clients: [
            {
              client_id: 'duplicate',
              token_endpoint_auth_method: 'none',
            },
          ],
        })
      )
      .mockReturnValue(JSON.stringify({ clients: [] }));
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    expect(() => addClient({ client_id: 'duplicate' })).toThrow(
      "Client with ID 'duplicate' already exists"
    );
    expect(read).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
});
