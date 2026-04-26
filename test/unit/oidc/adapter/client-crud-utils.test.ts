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

// ─── generateClientId ───────────────────────────────────────────────────────

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

// ─── generateClientSecret ───────────────────────────────────────────────────

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

// ─── sanitizeClientPayload ──────────────────────────────────────────────────

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

// ─── applyClientDefaults ────────────────────────────────────────────────────

describe('applyClientDefaults', () => {
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

  it('preserves explicitly provided values', () => {
    const result = applyClientDefaults({
      client_id: 'my-id',
      client_name: 'My App',
      application_type: 'spa',
      active: false,
    });
    expect(result.client_id).toBe('my-id');
    expect(result.application_type).toBe('spa');
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

// ─── validateClientData ─────────────────────────────────────────────────────

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

  it('reports multiple errors at once', () => {
    const result = validateClientData({
      application_type: 'invalid' as any,
      redirect_uris: ['javascript:alert(1)'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── validateClientData – redirect URI security ─────────────────────────────

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
});

// ─── filterClients ──────────────────────────────────────────────────────────

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

// ─── clientMatchesSearch ────────────────────────────────────────────────────

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

// ─── computeClientStatistics ────────────────────────────────────────────────

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
});

// ─── encryptClientSecret / decryptClientSecret ──────────────────────────────

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
