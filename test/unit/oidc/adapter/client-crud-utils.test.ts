/**
 * TDD — Client CRUD utility functions
 *
 * Tests the pure helper functions shared across all adapter backends.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  generateClientId,
  generateClientSecret,
  applyClientDefaults,
  validateClientData,
  filterClients,
  clientMatchesSearch,
  computeClientStatistics,
  encryptClientSecret,
  decryptClientSecret,
  sanitizeClientPayload,
} from '../../../../src/oidc/adapter/client-crud-utils.js';
import type { OidcClientData } from '../../../../src/oidc/adapter/client.interface.js';

describe('generateClientId', () => {
  it('returns a UUID v4 string', () => {
    const id = generateClientId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('returns unique values on each call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateClientId()));
    expect(ids.size).toBe(50);
  });
});

describe('generateClientSecret', () => {
  it('returns a 64-character hex string', () => {
    const secret = generateClientSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns unique values on each call', () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateClientSecret())
    );
    expect(secrets.size).toBe(50);
  });
});

describe('sanitizeClientPayload', () => {
  it('strips empty strings', () => {
    const result = sanitizeClientPayload({ a: 'ok', b: '', c: 'fine' });
    expect(result).toEqual({ a: 'ok', c: 'fine' });
  });

  it('strips null values', () => {
    const result = sanitizeClientPayload({ a: 'ok', b: null, c: 42 });
    expect(result).toEqual({ a: 'ok', c: 42 });
  });

  it('strips undefined values', () => {
    const result = sanitizeClientPayload({ a: 'ok', b: undefined });
    expect(result).toEqual({ a: 'ok' });
  });

  it('preserves non-empty strings, numbers, booleans, arrays, objects', () => {
    const input = {
      str: 'hello',
      num: 0,
      bool: false,
      arr: ['x'],
      obj: { nested: true },
    };
    const result = sanitizeClientPayload(input);
    expect(result).toEqual(input);
  });

  it('returns a shallow copy (does not mutate input)', () => {
    const input = { a: 'ok', b: '' };
    const result = sanitizeClientPayload(input);
    expect(result).not.toBe(input);
    expect(input.b).toBe(''); // original unchanged
  });
});

describe('applyClientDefaults', () => {
  it('uses a stable display name when none is provided', () => {
    expect(applyClientDefaults({}).client_name).toBe('Unnamed Client');
  });

  it('applies defaults for minimal input', () => {
    const result = applyClientDefaults({ client_name: 'Test App' });
    expect(result.client_name).toBe('Test App');
    expect(result.client_id).toBeTruthy();
    expect(result.application_type).toBe('web');
    expect(result.grant_types).toEqual(['authorization_code']);
    expect(result.active).toBe(true);
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });

  it('gives each new client independent mutable default collections', () => {
    const first = applyClientDefaults({ client_name: 'First App' });
    const second = applyClientDefaults({ client_name: 'Second App' });

    expect(first.grant_types).not.toBe(second.grant_types);
    expect(first.response_types).not.toBe(second.response_types);
    expect(first.tags).not.toBe(second.tags);
    expect(first.contacts).not.toBe(second.contacts);

    first.grant_types?.push('refresh_token');
    first.tags?.push('internal');
    expect(second.grant_types).toEqual(['authorization_code']);
    expect(second.tags).toEqual([]);
  });

  it('isolates returned client collections from later input mutations', () => {
    const input = {
      client_name: 'Caller-owned App',
      redirect_uris: ['https://rp.example.test/callback'],
      tags: ['demo'],
    };
    const result = applyClientDefaults(input);

    input.redirect_uris.push('https://attacker.example.test/callback');
    input.tags.push('mutated');

    expect(result.redirect_uris).toEqual(['https://rp.example.test/callback']);
    expect(result.tags).toEqual(['demo']);
  });

  it('preserves explicit values while normalizing the legacy SPA label', () => {
    const result = applyClientDefaults({
      client_id: 'my-id',
      client_name: 'My App',
      application_type: 'spa',
      active: false,
    });
    expect(result.client_id).toBe('my-id');
    expect(result.application_type).toBe('web');
    expect(result.preset).toBe('spa');
    expect(result.active).toBe(false);
  });

  it('generates a client_secret for non-public clients', () => {
    const result = applyClientDefaults({ client_name: 'Web App' });
    expect(result.client_secret).toBeTruthy();
    expect(result.client_secret).toHaveLength(64);
  });

  it('does not generate a client_secret for public clients (auth_method=none)', () => {
    const result = applyClientDefaults({
      client_name: 'SPA',
      token_endpoint_auth_method: 'none',
    });
    expect(result.client_secret).toBeUndefined();
  });

  it('does not generate a client_secret for private_key_jwt clients', () => {
    const result = applyClientDefaults({
      client_name: 'Private key client',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks_uri: 'https://client.example/jwks.json',
    });
    expect(result.client_secret).toBeUndefined();
  });

  it('preserves explicitly provided client_secret', () => {
    const result = applyClientDefaults({
      client_name: 'App',
      client_secret: 'custom-secret-123',
    });
    expect(result.client_secret).toBe('custom-secret-123');
  });

  it('strips undefined/null/empty string fields to prevent MongoDB null storage', () => {
    const result = applyClientDefaults({
      client_name: 'Test',
      client_uri: undefined,
      logo_uri: undefined,
      policy_uri: undefined,
    });
    // Keys should NOT be present (not even as undefined/null)
    expect('client_uri' in result).toBe(false);
    expect('logo_uri' in result).toBe(false);
    expect('policy_uri' in result).toBe(false);
  });
});

describe('validateClientData', () => {
  it('passes for valid data', () => {
    const result = validateClientData({
      client_name: 'Valid App',
      application_type: 'web',
      redirect_uris: ['https://example.com/callback'],
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when client_name is missing', () => {
    const result = validateClientData({ application_type: 'web' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('client_name is required');
  });

  it('fails when client_name is empty', () => {
    const result = validateClientData({ client_name: '  ' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('client_name is required');
  });

  it('fails for invalid application_type', () => {
    const result = validateClientData({
      client_name: 'App',
      application_type: 'desktop' as any,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Invalid application_type');
  });

  it('fails for invalid token_endpoint_auth_method', () => {
    const result = validateClientData({
      client_name: 'App',
      token_endpoint_auth_method: 'magic' as any,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Invalid token_endpoint_auth_method');
  });

  it.each([
    ['grant_types', ['password']],
    ['grant_types', ['urn:example:params:oauth:grant-type:custom']],
    ['response_types', ['token']],
    ['response_types', ['code token']],
  ] as const)('fails for unsupported provider %s', (field, value) => {
    const result = validateClientData({
      client_name: 'App',
      [field]: value,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain(`Invalid ${field}`);
  });

  it('accepts provider-supported grant and response types', () => {
    expect(
      validateClientData({
        client_name: 'Authorization code client',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code', 'none'],
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it('fails for invalid redirect_uris (dangerous protocol)', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['javascript:alert(1)'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('protocol');
  });

  it('fails when id_token_signed_response_alg is empty string', () => {
    const result = validateClientData({
      client_name: 'App',
      id_token_signed_response_alg: '',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('id_token_signed_response_alg');
  });

  it('passes when id_token_signed_response_alg is undefined (omitted)', () => {
    const result = validateClientData({
      client_name: 'App',
    });
    expect(result.isValid).toBe(true);
  });

  it('passes when id_token_signed_response_alg is a valid algorithm', () => {
    const result = validateClientData({
      client_name: 'App',
      id_token_signed_response_alg: 'RS256',
    });
    expect(result.isValid).toBe(true);
  });

  it('requires exactly one usable key source for private_key_jwt clients', () => {
    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
      })
    ).toMatchObject({ isValid: false });

    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'https://rp.example.test/jwks.json',
      })
    ).toEqual({ isValid: true, errors: [] });

    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: {
          keys: [
            {
              kty: 'EC',
              crv: 'P-256',
              x: 'x-coordinate',
              y: 'y-coordinate',
            },
          ],
        },
      })
    ).toEqual({ isValid: true, errors: [] });

    for (const keyMetadata of [
      {
        jwks_uri: 'https://rp.example.test/jwks.json',
        jwks: { keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }] },
      },
      { jwks_uri: 'data:application/json,{}' },
      { jwks: { keys: [] } },
      { jwks: { keys: [{ kty: 'RSA', n: 'missing-exponent' }] } },
      {
        jwks: {
          keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB', d: 'private' }],
        },
      },
    ]) {
      expect(
        validateClientData({
          client_name: 'Private key client',
          token_endpoint_auth_method: 'private_key_jwt',
          ...keyMetadata,
        }).isValid
      ).toBe(false);
    }
  });

  it('rejects symmetric keys in static JWKS metadata', () => {
    const result = validateClientData({
      client_name: 'Private key client',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: { keys: [{ kty: 'oct', k: 'symmetric-secret' }] },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'jwks.keys[0] must not contain a symmetric key'
    );
  });

  it.each([
    { kty: 'future-key-type', alg: '' },
    { kty: 'EC', crv: 'P-999' },
    { kty: 'OKP', crv: 'FutureCurve' },
  ])('accepts provider-ignored public JWK metadata %#', key => {
    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [key] },
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it('rejects malformed key-set URIs and client authentication algorithms', () => {
    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'not an absolute URL',
      }).errors
    ).toContain('jwks_uri must be a safe HTTP(S) URL');

    expect(
      validateClientData({
        client_name: 'Secret JWT client',
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: '' as any,
      }).errors
    ).toContain(
      'token_endpoint_auth_signing_alg must be a non-empty string if provided'
    );
  });

  it('rejects non-plain or typeless JWK entries', () => {
    for (const key of [null, Object.create(null), {}]) {
      const result = validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [key as any] },
      });

      expect(result.isValid).toBe(false);
    }
  });

  it('requires a curve subtype for provider-recognized EC keys', () => {
    const result = validateClientData({
      client_name: 'Private key client',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: { keys: [{ kty: 'EC', x: 'x-coordinate', y: 'y-coordinate' }] },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'jwks.keys[0].crv must be a non-empty string'
    );
  });

  it('validates optional public JWK labels when they are present', () => {
    const malformed = validateClientData({
      client_name: 'Private key client',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: {
        keys: [
          {
            kty: 'RSA',
            n: 'modulus',
            e: 'AQAB',
            alg: '',
            kid: 42,
            use: null,
          },
        ],
      },
    });

    expect(malformed.isValid).toBe(false);
    expect(malformed.errors).toEqual(
      expect.arrayContaining([
        'jwks.keys[0].alg must be a non-empty string if provided',
        'jwks.keys[0].kid must be a non-empty string if provided',
        'jwks.keys[0].use must be a non-empty string if provided',
      ])
    );

    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: {
          keys: [
            {
              kty: 'RSA',
              n: 'modulus',
              e: 'AQAB',
              alg: 'RS256',
              kid: 'signing-key-1',
              use: 'sig',
            },
          ],
        },
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it.each([
    ['a scalar', 'certificate'],
    ['an array with an empty certificate', ['']],
  ])('rejects x5c represented as %s', (_description, x5c) => {
    const result = validateClientData({
      client_name: 'Private key client',
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: {
        keys: [
          {
            kty: 'RSA',
            n: 'modulus',
            e: 'AQAB',
            x5c,
          },
        ],
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'jwks.keys[0].x5c must contain non-empty strings if provided'
    );
  });

  it('accepts a non-empty x5c certificate chain', () => {
    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: {
          keys: [
            {
              kty: 'RSA',
              n: 'modulus',
              e: 'AQAB',
              x5c: ['base64-der-certificate'],
            },
          ],
        },
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it('accepts an empty x5c certificate chain like oidc-provider', () => {
    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: {
          keys: [
            {
              kty: 'RSA',
              n: 'modulus',
              e: 'AQAB',
              x5c: [],
            },
          ],
        },
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it('enforces the provider signing algorithm family for JWT client authentication', () => {
    const publicJwks = {
      keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }],
    };

    for (const client of [
      {
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt' as const,
        token_endpoint_auth_signing_alg: 'HS256',
        jwks: publicJwks,
      },
      {
        client_name: 'Secret JWT client',
        token_endpoint_auth_method: 'client_secret_jwt' as const,
        token_endpoint_auth_signing_alg: 'RS256',
      },
      {
        client_name: 'Basic client',
        token_endpoint_auth_method: 'client_secret_basic' as const,
        token_endpoint_auth_signing_alg: 'RS256',
      },
    ]) {
      expect(validateClientData(client).isValid).toBe(false);
    }

    expect(
      validateClientData({
        client_name: 'Private key client',
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'RS256',
        jwks: publicJwks,
      })
    ).toEqual({ isValid: true, errors: [] });
    expect(
      validateClientData({
        client_name: 'Secret JWT client',
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: 'HS256',
      })
    ).toEqual({ isValid: true, errors: [] });
  });

  it('reports multiple errors at once', () => {
    const result = validateClientData({
      application_type: 'invalid' as any,
      redirect_uris: ['javascript:alert(1)'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateClientData - redirect URI security', () => {
  it('rejects javascript: protocol in redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['javascript:alert(1)'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('protocol');
  });

  it('rejects data: protocol in redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['data:text/html,<script>alert(1)</script>'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('protocol');
  });

  it('rejects file: protocol in redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['file:///etc/passwd'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('protocol');
  });

  it('rejects credentials in redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['https://user:pass@evil.com/callback'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('redential');
  });

  it('rejects wildcard hostnames in redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['https://*.evil.com/callback'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('ildcard');
  });

  it('accepts valid https redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['https://example.com/callback'],
    });
    expect(result.isValid).toBe(true);
  });

  it('accepts http://localhost redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['http://localhost:3000/callback'],
    });
    expect(result.isValid).toBe(true);
  });

  it('accepts http://127.0.0.1 redirect_uris', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['http://127.0.0.1:8080/callback'],
    });
    expect(result.isValid).toBe(true);
  });

  it('accepts custom scheme for native apps (e.g. myapp://callback)', () => {
    const result = validateClientData({
      client_name: 'Native App',
      redirect_uris: ['myapp://callback'],
    });
    expect(result.isValid).toBe(true);
  });

  it('rejects malformed redirect URIs that are not absolute URIs', () => {
    const result = validateClientData({
      client_name: 'App',
      redirect_uris: ['not a uri'],
    });

    expect(result).toEqual({
      isValid: false,
      errors: ['Invalid redirect_uri: not a uri'],
    });
  });
});

describe('filterClients', () => {
  const clients: OidcClientData[] = [
    {
      client_id: 'c1',
      client_name: 'Web App',
      application_type: 'web',
      active: true,
      tags: ['internal'],
    },
    {
      client_id: 'c2',
      client_name: 'SPA Dashboard',
      application_type: 'spa',
      active: false,
      tags: ['external'],
    },
    {
      client_id: 'c3',
      client_name: 'Mobile Client',
      application_type: 'native',
      active: true,
      tags: ['internal', 'mobile'],
    },
  ];

  it('returns all clients when no filters', () => {
    expect(filterClients(clients)).toHaveLength(3);
    expect(filterClients(clients, {})).toHaveLength(3);
  });

  it('filters by application_type', () => {
    const result = filterClients(clients, { application_type: 'spa' });
    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe('c2');
  });

  it('filters by active status', () => {
    const result = filterClients(clients, { active: true });
    expect(result).toHaveLength(2);
  });

  it('filters by tags', () => {
    const result = filterClients(clients, { tags: ['mobile'] });
    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe('c3');
  });

  it('does not match a tag filter when a client has no tags', () => {
    const clientWithoutTags = { ...clients[0], tags: undefined };

    expect(filterClients([clientWithoutTags], { tags: ['internal'] })).toEqual(
      []
    );
  });

  it('filters by search term', () => {
    const result = filterClients(clients, { search: 'dashboard' });
    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe('c2');
  });

  it('combines multiple filters', () => {
    const result = filterClients(clients, {
      active: true,
      tags: ['internal'],
    });
    expect(result).toHaveLength(2);
  });
});

describe('clientMatchesSearch', () => {
  const client: OidcClientData = {
    client_id: 'my-web-app',
    client_name: 'Production API Gateway',
    application_type: 'web',
    description: 'Main API gateway for production',
  };

  it('matches against client_id', () => {
    expect(clientMatchesSearch(client, 'my-web')).toBe(true);
  });

  it('matches against client_name', () => {
    expect(clientMatchesSearch(client, 'api gateway')).toBe(true);
  });

  it('matches against description', () => {
    expect(clientMatchesSearch(client, 'production')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(clientMatchesSearch(client, 'API GATEWAY')).toBe(true);
  });

  it('returns false for non-matching query', () => {
    expect(clientMatchesSearch(client, 'nonexistent')).toBe(false);
  });
});

describe('computeClientStatistics', () => {
  const clients: OidcClientData[] = [
    {
      client_id: 'c1',
      client_name: 'App 1',
      application_type: 'web',
      active: true,
    },
    {
      client_id: 'c2',
      client_name: 'App 2',
      application_type: 'spa',
      active: false,
    },
    {
      client_id: 'c3',
      client_name: 'App 3',
      application_type: 'web',
      active: true,
    },
  ];

  it('computes correct totals', () => {
    const stats = computeClientStatistics(clients);
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.inactive).toBe(1);
  });

  it('groups by application type', () => {
    const stats = computeClientStatistics(clients);
    expect(stats.byType.web).toBe(2);
    expect(stats.byType.spa).toBe(1);
    expect(stats.byType.native).toBe(0);
  });

  it('handles empty array', () => {
    const stats = computeClientStatistics([]);
    expect(stats.total).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.inactive).toBe(0);
  });

  it('counts clients with unknown application types without creating a group', () => {
    const stats = computeClientStatistics([
      {
        client_id: 'legacy-client',
        client_name: 'Legacy client',
        application_type: 'legacy' as OidcClientData['application_type'],
      },
    ]);

    expect(stats).toEqual({
      total: 1,
      active: 1,
      inactive: 0,
      byType: { web: 0, native: 0, spa: 0 },
    });
  });
});

describe('encryptClientSecret / decryptClientSecret', () => {
  const testKey = randomBytes(32).toString('hex');

  // Set up a temporary encryption key for these tests
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = testKey;
  });

  afterAll(() => {
    if (originalKey) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('encrypts a plaintext client_secret', () => {
    const client: OidcClientData = {
      client_id: 'test-id',
      client_name: 'Test',
      application_type: 'web',
      client_secret: 'my-secret-value',
    };
    const encrypted = encryptClientSecret(client);
    expect(encrypted.client_secret).not.toBe('my-secret-value');
    expect(encrypted.client_secret).toMatch(/^ENCRYPTED:v1:/);
    // Other fields unchanged
    expect(encrypted.client_id).toBe('test-id');
    expect(encrypted.client_name).toBe('Test');
  });

  it('decrypts an encrypted client_secret back to plaintext', () => {
    const client: OidcClientData = {
      client_id: 'test-id',
      client_name: 'Test',
      application_type: 'web',
      client_secret: 'my-secret-value',
    };
    const encrypted = encryptClientSecret(client);
    const decrypted = decryptClientSecret(encrypted);
    expect(decrypted.client_secret).toBe('my-secret-value');
  });

  it('passes through a client without client_secret unchanged', () => {
    const client: OidcClientData = {
      client_id: 'public-client',
      client_name: 'SPA',
      application_type: 'web',
    };
    const encrypted = encryptClientSecret(client);
    expect(encrypted).toEqual(client);
    const decrypted = decryptClientSecret(client);
    expect(decrypted).toEqual(client);
  });

  it('passes through already-encrypted secrets without double-encrypting', () => {
    const client: OidcClientData = {
      client_id: 'test-id',
      client_name: 'Test',
      application_type: 'web',
      client_secret: 'my-secret-value',
    };
    const encrypted1 = encryptClientSecret(client);
    const encrypted2 = encryptClientSecret(encrypted1);
    // Should still be able to decrypt to original
    const decrypted = decryptClientSecret(encrypted2);
    expect(decrypted.client_secret).toBe('my-secret-value');
  });

  it('passes through plaintext secrets in decryptClientSecret', () => {
    const client: OidcClientData = {
      client_id: 'test-id',
      client_name: 'Test',
      application_type: 'web',
      client_secret: 'plain-text-secret',
    };
    const decrypted = decryptClientSecret(client);
    expect(decrypted.client_secret).toBe('plain-text-secret');
  });
});
