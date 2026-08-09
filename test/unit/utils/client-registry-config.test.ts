import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientRegistryManager, {
  OidcClientSchema,
} from '../../../src/utils/client-registry-config.js';
import type { IConfigFileReader } from '../../../src/di/interfaces/config-file-reader.interface.js';
import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function createManager(
  configFileReader: IConfigFileReader = {
    readJsoncFile: vi.fn(),
    readJsoncFileAsync: vi.fn(),
  } as unknown as IConfigFileReader
): ClientRegistryManager {
  const fileSystemUtils = {
    rootDir: '/srv/parako',
  } as unknown as IFileSystemUtils;

  return new ClientRegistryManager(configFileReader, fileSystemUtils);
}

describe('OidcClientSchema', () => {
  it('normalizes the legacy SPA label to provider-compliant metadata', () => {
    expect(
      OidcClientSchema.parse({
        client_id: 'spa-client',
        client_name: 'SPA Client',
        application_type: 'spa',
        token_endpoint_auth_method: 'none',
      })
    ).toMatchObject({
      application_type: 'web',
      preset: 'spa',
    });
  });

  it('rejects whitespace-only client identifiers and names', () => {
    const result = OidcClientSchema.safeParse({
      client_id: '   ',
      client_name: '\t',
      application_type: 'web',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['client_id', 'client_name'])
      );
    }
  });

  it('preserves a configured JSON Web Key Set', () => {
    const jwks = {
      keys: [
        {
          kty: 'RSA',
          kid: 'client-signing-key',
          use: 'sig',
          alg: 'RS256',
          n: 'test-modulus',
          e: 'AQAB',
        },
      ],
    };

    const client = OidcClientSchema.parse({
      client_id: 'private-key-client',
      client_name: 'Private Key Client',
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks,
    });

    expect(client.jwks).toEqual(jwks);
  });

  it('rejects provider-invalid JWT client authentication metadata', () => {
    for (const metadata of [
      {
        token_endpoint_auth_method: 'private_key_jwt',
      },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'HS256',
        jwks_uri: 'https://rp.example.test/jwks.json',
      },
      {
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: 'RS256',
      },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'https://rp.example.test/jwks.json',
        jwks: { keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }] },
      },
    ]) {
      expect(
        OidcClientSchema.safeParse({
          client_id: 'invalid-key-client',
          client_name: 'Invalid key client',
          application_type: 'web',
          ...metadata,
        }).success
      ).toBe(false);
    }
  });

  it.each([
    ['grant_types', 'password'],
    ['grant_types', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
    ['response_types', 'token'],
    ['response_types', 'code token'],
  ] as const)('rejects unsupported provider %s value %s', (field, value) => {
    expect(
      OidcClientSchema.safeParse({
        client_id: 'unsupported-client',
        client_name: 'Unsupported Client',
        application_type: 'web',
        [field]: [value],
      }).success
    ).toBe(false);
  });

  it('accepts every response type enabled by the provider configuration', () => {
    expect(
      OidcClientSchema.parse({
        client_id: 'supported-client',
        client_name: 'Supported Client',
        application_type: 'web',
        response_types: ['code', 'id_token', 'code id_token', 'none'],
      }).response_types
    ).toEqual(['code', 'id_token', 'code id_token', 'none']);
  });
});

describe('ClientRegistryManager', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid secure random length %s',
    length => {
      const manager = createManager();

      expect(() => manager.generateSecureRandom(length)).toThrow(
        'Secure random length must be a positive finite integer'
      );
    }
  );

  it('rejects generated client secrets shorter than the registry minimum', () => {
    const manager = createManager();

    expect(() => manager.generateClientSecret(31)).toThrow(
      'Client secret length must be at least 32 characters'
    );
  });

  it('caches a missing registry until the cache is explicitly cleared', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(Date, 'now').mockReturnValue(1_785_600_000_000);
    const manager = createManager();

    const first = manager.loadConfig();
    const second = manager.loadConfig();

    expect(first).toEqual({
      version: '1.0.0',
      created_at: 1_785_600_000_000,
      updated_at: 1_785_600_000_000,
      clients: [],
    });
    expect(second).toBe(first);
    expect(existsSpy).toHaveBeenCalledTimes(1);

    manager.clearConfigCache();
    manager.loadConfig();

    expect(existsSpy).toHaveBeenCalledTimes(2);
  });

  it('does not cache missing registries when caching is disabled', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const syncManager = createManager();
    const asyncManager = createManager();

    const firstSync = syncManager.loadConfig(false);
    const secondSync = syncManager.loadConfig(false);
    const firstAsync = await asyncManager.loadConfigAsync(false);
    const secondAsync = await asyncManager.loadConfigAsync(false);

    expect(secondSync).not.toBe(firstSync);
    expect(secondAsync).not.toBe(firstAsync);
    expect(existsSpy).toHaveBeenCalledTimes(4);
  });

  it('loads and validates an existing registry without caching when requested', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(1_785_600_000_000);
    const readJsoncFile = vi.fn().mockReturnValue({ clients: [] });
    const manager = createManager({
      readJsoncFile,
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(manager.loadConfig(false)).toEqual({
      version: '1.0.0',
      created_at: 1_785_600_000_000,
      updated_at: 1_785_600_000_000,
      clients: [],
    });
    manager.loadConfig(false);

    expect(readJsoncFile).toHaveBeenCalledTimes(2);
    expect(readJsoncFile).toHaveBeenCalledWith(
      '/srv/parako/runtime/parako-rp.jsonc'
    );
  });

  it('reports synchronous registry validation failures with field paths', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = createManager({
      readJsoncFile: vi
        .fn()
        .mockReturnValue({ version: 'invalid', clients: [] }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(() => manager.loadConfig()).toThrow(
      'Client configuration validation failed:\nversion: Version must be in semver format (X.Y.Z)'
    );
  });

  it.each([new Error('disk offline'), 'disk offline'])(
    'wraps synchronous reader failure %s with registry context',
    thrown => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const manager = createManager({
        readJsoncFile: vi.fn().mockImplementation(() => {
          throw thrown;
        }),
        readJsoncFileAsync: vi.fn(),
      } as unknown as IConfigFileReader);

      expect(() => manager.loadConfig()).toThrow(
        'Failed to load client configuration: disk offline'
      );
    }
  );

  it('caches an asynchronously loaded missing registry', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(Date, 'now').mockReturnValue(1_785_600_000_000);
    const manager = createManager();

    const first = await manager.loadConfigAsync();
    const second = await manager.loadConfigAsync();

    expect(first).toEqual({
      version: '1.0.0',
      created_at: 1_785_600_000_000,
      updated_at: 1_785_600_000_000,
      clients: [],
    });
    expect(second).toBe(first);
    expect(existsSpy).toHaveBeenCalledTimes(1);
  });

  it('loads an existing registry asynchronously without caching when requested', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readJsoncFileAsync = vi
      .fn()
      .mockResolvedValue({ version: '2.1.0', clients: [] });
    const manager = createManager({
      readJsoncFile: vi.fn(),
      readJsoncFileAsync,
    } as unknown as IConfigFileReader);

    expect((await manager.loadConfigAsync(false)).version).toBe('2.1.0');
    await manager.loadConfigAsync(false);

    expect(readJsoncFileAsync).toHaveBeenCalledTimes(2);
    expect(readJsoncFileAsync).toHaveBeenCalledWith(
      '/srv/parako/runtime/parako-rp.jsonc'
    );
  });

  it('caches an asynchronously loaded existing registry by default', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readJsoncFileAsync = vi
      .fn()
      .mockResolvedValue({ version: '3.0.0', clients: [] });
    const manager = createManager({
      readJsoncFile: vi.fn(),
      readJsoncFileAsync,
    } as unknown as IConfigFileReader);

    const first = await manager.loadConfigAsync();
    const second = await manager.loadConfigAsync();

    expect(second).toBe(first);
    expect(readJsoncFileAsync).toHaveBeenCalledOnce();
  });

  it('reports asynchronous registry validation failures with field paths', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = createManager({
      readJsoncFile: vi.fn(),
      readJsoncFileAsync: vi
        .fn()
        .mockResolvedValue({ version: 'invalid', clients: [] }),
    } as unknown as IConfigFileReader);

    await expect(manager.loadConfigAsync()).rejects.toThrow(
      'Client configuration validation failed:\nversion: Version must be in semver format (X.Y.Z)'
    );
  });

  it.each([new Error('permission denied'), 'permission denied'])(
    'wraps asynchronous reader failure %s with registry context',
    async thrown => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const manager = createManager({
        readJsoncFile: vi.fn(),
        readJsoncFileAsync: vi.fn().mockRejectedValue(thrown),
      } as unknown as IConfigFileReader);

      await expect(manager.loadConfigAsync()).rejects.toThrow(
        'Failed to load client configuration: permission denied'
      );
    }
  );

  it('queries clients by id, application type, and active state', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'active-web',
            application_type: 'web',
            active: true,
          },
          {
            client_id: 'inactive-native',
            application_type: 'native',
            active: false,
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(manager.findClientById('active-web')?.client_id).toBe('active-web');
    expect(manager.findClientById('missing')).toBeNull();
    expect(
      manager.findClientsByType('native').map(client => client.client_id)
    ).toEqual(['inactive-native']);
    expect(manager.findActiveClients().map(client => client.client_id)).toEqual(
      ['active-web']
    );
  });

  it('projects only active clients into provider metadata without undefined fields', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const jwks = { keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }] };
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'active-client',
            client_name: 'Active Client',
            application_type: 'web',
            resourcesScopes: 'api:read',
            jwks,
            active: true,
          },
          {
            client_id: 'inactive-client',
            application_type: 'web',
            active: false,
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    const clients = manager.getOidcProviderClients();

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      client_id: 'active-client',
      resourcesScopes: 'api:read',
      jwks,
    });
    expect(clients[0]).not.toHaveProperty('client_uri');
  });

  it('does not generate a secret for a public client auth method', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manager = createManager();

    const client = manager.addClient({
      client_name: 'Public Web Client',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
    });

    expect(client.client_secret).toBeUndefined();
  });

  it('rejects a duplicate explicit client identifier', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'existing-client',
            application_type: 'web',
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(() =>
      manager.addClient({
        client_id: 'existing-client',
        client_name: 'Duplicate',
        application_type: 'web',
      })
    ).toThrow("Client with ID 'existing-client' already exists");
  });

  it('generates a secret for a confidential auth method regardless of application label', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manager = createManager();

    const client = manager.addClient({
      client_name: 'Confidential SPA Label',
      application_type: 'spa',
      token_endpoint_auth_method: 'client_secret_basic',
    });

    expect(client.client_secret).toHaveLength(64);
  });

  it('does not generate a secret for private_key_jwt clients', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manager = createManager();

    const client = manager.addClient({
      client_name: 'Private key client',
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks_uri: 'https://rp.example.test/jwks.json',
    });

    expect(client.client_secret).toBeUndefined();
  });

  it('does not mutate the caller-owned client input while applying defaults', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manager = createManager();
    const input = {
      client_name: 'Caller Owned Client',
      application_type: 'web' as const,
      token_endpoint_auth_method: 'none' as const,
    };

    const client = manager.addClient(input);

    expect(input).toEqual({
      client_name: 'Caller Owned Client',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
    });
    expect(client.client_id).toMatch(/^client_[a-z0-9]+_[A-Za-z0-9._~-]{8}$/);
    expect(client.created_at).toEqual(expect.any(Number));
    expect(client.updated_at).toEqual(expect.any(Number));
  });

  it('validates and persists updates to an existing client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_785_600_000_000);
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'existing-client',
            client_name: 'Before',
            application_type: 'web',
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    const updated = manager.updateClient('existing-client', {
      client_id: 'existing-client',
      client_name: 'After',
      active: false,
    });

    expect(updated).toMatchObject({
      client_id: 'existing-client',
      client_name: 'After',
      active: false,
      updated_at: 1_785_600_000_000,
    });
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it('rejects updates for a missing client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const manager = createManager();

    expect(() =>
      manager.updateClient('missing-client', { client_name: 'After' })
    ).toThrow("Client with ID 'missing-client' not found");
  });

  it('rejects attempts to change an existing client identifier', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'existing-client',
            application_type: 'web',
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(() =>
      manager.updateClient('existing-client', { client_id: 'replacement' })
    ).toThrow('Cannot change client_id. Use remove and add instead.');
  });

  it('returns false when removing a missing client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const manager = createManager();

    expect(manager.removeClient('missing-client')).toBe(false);
  });

  it('removes and persists an existing client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);
    const manager = createManager({
      readJsoncFile: vi.fn().mockReturnValue({
        clients: [
          {
            client_id: 'existing-client',
            application_type: 'web',
          },
        ],
      }),
      readJsoncFileAsync: vi.fn(),
    } as unknown as IConfigFileReader);

    expect(manager.removeClient('existing-client')).toBe(true);
    expect(manager.findClientById('existing-client')).toBeNull();
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it('does not mutate the caller-owned registry while updating persisted metadata', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_785_600_000_000);
    const manager = createManager();
    const registry = {
      version: '1.0.0',
      created_at: 1,
      updated_at: 2,
      clients: [],
    };

    manager.saveConfig(registry);

    expect(registry.updated_at).toBe(2);
    expect(writeSpy).toHaveBeenCalledWith(
      '/srv/parako/runtime/parako-rp.jsonc',
      expect.stringContaining('"updated_at": 1785600000000'),
      'utf8'
    );
  });

  it('reports save-time registry validation failures with field paths', () => {
    const manager = createManager();

    expect(() =>
      manager.saveConfig({
        version: 'invalid',
        created_at: 1,
        updated_at: 2,
        clients: [],
      } as never)
    ).toThrow(
      'Client configuration validation failed:\nversion: Version must be in semver format (X.Y.Z)'
    );
  });

  it.each([new Error('read-only filesystem'), 'read-only filesystem'])(
    'wraps registry filesystem write failure %s with save context',
    thrown => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw thrown;
      });
      const manager = createManager();

      expect(() =>
        manager.saveConfig({
          version: '1.0.0',
          created_at: 1,
          updated_at: 2,
          clients: [],
        })
      ).toThrow('Failed to save client configuration: read-only filesystem');
    }
  );
});
