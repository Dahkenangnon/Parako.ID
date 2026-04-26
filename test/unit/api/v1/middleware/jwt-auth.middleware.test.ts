import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import {
  createJwtAuthMiddleware,
  clearJwksCache,
  type JwtAuthDependencies,
} from '../../../../../src/api/v1/middleware/jwt-auth.middleware.js';
import { ERROR_TYPES } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_ISSUER = 'https://test.parako.id/oidc/v1';
const PLATFORM_ISSUER = 'https://test.parako.id/_platforms';
const EXPECTED_AUDIENCE = 'urn:parako:api:v1';
const TEST_TENANT = 'test-tenant';

// ---------------------------------------------------------------------------
// Test key material (generated once per test suite, shared across tests)
// ---------------------------------------------------------------------------

let rsaPrivateKey: jose.CryptoKey;
let rsaPublicJWK: jose.JWK;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse() {
  const res: Record<string, unknown> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res as unknown as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

function createMockRequest(authHeader?: string) {
  const req: Record<string, unknown> = {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    path: '/api/v1/test',
  };
  return req as unknown as Express.Request & {
    headers: Record<string, string>;
    path: string;
  };
}

function createDeps(
  overrides: Partial<JwtAuthDependencies> = {}
): JwtAuthDependencies {
  return {
    keyStore: {
      getPublicJWKS: vi.fn().mockResolvedValue({ keys: [rsaPublicJWK] }),
    },
    configManager: {
      getConfig: vi.fn().mockReturnValue({ oidc: { issuer: TEST_ISSUER } }),
    },
    logger: {
      warn: vi.fn(),
      debug: vi.fn(),
    },
    getTenantId: vi.fn().mockReturnValue(TEST_TENANT),
    ...overrides,
  };
}

async function signToken(
  payload: Record<string, unknown>,
  privateKey: jose.CryptoKey,
  options?: {
    alg?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    noExpiry?: boolean;
  }
): Promise<string> {
  const builder = new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: options?.alg ?? 'RS256' })
    .setIssuedAt()
    .setIssuer(options?.issuer ?? TEST_ISSUER)
    .setAudience(options?.audience ?? EXPECTED_AUDIENCE);

  if (!options?.noExpiry) {
    builder.setExpirationTime(options?.expiresIn ?? '1h');
  }

  return builder.sign(privateKey);
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Generate a fresh RSA keypair for each test run if not yet created.
  // We generate once globally for performance but reset cache per test.
  if (!rsaPrivateKey) {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    rsaPrivateKey = privateKey;
    rsaPublicJWK = await jose.exportJWK(publicKey);
    rsaPublicJWK.alg = 'RS256';
    rsaPublicJWK.use = 'sig';
    rsaPublicJWK.kid = 'test-key-1';
  }

  clearJwksCache();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/middleware/jwt-auth', () => {
  // -----------------------------------------------------------------------
  // 1. Valid JWT
  // -----------------------------------------------------------------------
  describe('valid token', () => {
    it('should set req.apiAuth with correct fields and call next()', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'my-client', scope: 'parako:clients:read' },
        rsaPrivateKey
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();

      const apiAuth = (req as any).apiAuth;
      expect(apiAuth).toBeDefined();
      expect(apiAuth.client_id).toBe('my-client');
      expect(apiAuth.scope).toBe('parako:clients:read');
      expect(apiAuth.iss).toBe(TEST_ISSUER);
      expect(apiAuth.aud).toBe(EXPECTED_AUDIENCE);
      expect(typeof apiAuth.exp).toBe('number');
      expect(typeof apiAuth.iat).toBe('number');
      expect(apiAuth.exp).toBeGreaterThan(apiAuth.iat);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Missing Authorization header
  // -----------------------------------------------------------------------
  describe('missing Authorization header', () => {
    it('should return 401 with unauthorized error', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const req = createMockRequest(); // no auth header
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.UNAUTHORIZED,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. Malformed Authorization header
  // -----------------------------------------------------------------------
  describe('malformed Authorization header', () => {
    it('should return 401 when no Bearer prefix', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const req = createMockRequest('Basic dXNlcjpwYXNz');
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.UNAUTHORIZED,
          status: 401,
        })
      );
    });

    it('should return 401 when Bearer token is empty', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const req = createMockRequest('Bearer ');
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Expired token
  // -----------------------------------------------------------------------
  describe('expired token', () => {
    it('should return 401 with token-expired error', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Create a token that expired 1 hour ago
      const token = await new jose.SignJWT({
        client_id: 'my-client',
        scope: 'parako:clients:read',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .setIssuer(TEST_ISSUER)
        .setAudience(EXPECTED_AUDIENCE)
        .sign(rsaPrivateKey);

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_EXPIRED,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 5. Wrong audience
  // -----------------------------------------------------------------------
  describe('wrong audience', () => {
    it('should return 401 with token-invalid error', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'my-client', scope: 'parako:clients:read' },
        rsaPrivateKey,
        { audience: 'urn:resource:wrong-audience' }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 6. Wrong issuer
  // -----------------------------------------------------------------------
  describe('wrong issuer', () => {
    it('should return 401 with token-invalid error', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'my-client', scope: 'parako:clients:read' },
        rsaPrivateKey,
        { issuer: 'https://evil.example.com' }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. HS256 algorithm rejection
  // -----------------------------------------------------------------------
  describe('HS256 algorithm', () => {
    it('should return 401 — not in algorithm allowlist', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Create a symmetric key token (HS256)
      const secret = new TextEncoder().encode(
        'super-secret-key-at-least-256-bits-long-for-hs256!'
      );

      const token = await new jose.SignJWT({
        client_id: 'my-client',
        scope: 'parako:clients:read',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer(TEST_ISSUER)
        .setAudience(EXPECTED_AUDIENCE)
        .sign(secret);

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 8. "none" algorithm rejection
  // -----------------------------------------------------------------------
  describe('none algorithm', () => {
    it('should return 401 — unsigned tokens are rejected', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Create an unsigned JWT by hand (alg: none)
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' })
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          client_id: 'my-client',
          scope: 'parako:clients:read',
          iss: TEST_ISSUER,
          aud: EXPECTED_AUDIENCE,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');

      const unsignedToken = `${header}.${payload}.`;

      const req = createMockRequest(`Bearer ${unsignedToken}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. Platform scope with non-platform issuer
  // -----------------------------------------------------------------------
  describe('platform scope with non-platform issuer', () => {
    it('should return 403 with forbidden error', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Use a platform-only scope but issue from a regular (non-platform) issuer
      const token = await signToken(
        { client_id: 'my-client', scope: 'parako:tenants:read' },
        rsaPrivateKey,
        { issuer: TEST_ISSUER }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.FORBIDDEN,
          status: 403,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 10. Platform scope with platform issuer
  // -----------------------------------------------------------------------
  describe('platform scope with platform issuer', () => {
    it('should succeed when issuer contains _platforms', async () => {
      const deps = createDeps({
        configManager: {
          getConfig: vi
            .fn()
            .mockReturnValue({ oidc: { issuer: PLATFORM_ISSUER } }),
        },
      });
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'platform-client', scope: 'parako:tenants:read' },
        rsaPrivateKey,
        { issuer: PLATFORM_ISSUER }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();

      const apiAuth = (req as any).apiAuth;
      expect(apiAuth).toBeDefined();
      expect(apiAuth.client_id).toBe('platform-client');
      expect(apiAuth.scope).toBe('parako:tenants:read');
      expect(apiAuth.iss).toBe(PLATFORM_ISSUER);
    });
  });

  // -----------------------------------------------------------------------
  // 11. JWKS cache hit
  // -----------------------------------------------------------------------
  describe('JWKS cache', () => {
    it('should call getPublicJWKS only once for multiple requests', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token1 = await signToken(
        { client_id: 'client-1', scope: 'parako:clients:read' },
        rsaPrivateKey
      );
      const token2 = await signToken(
        { client_id: 'client-2', scope: 'parako:users:read' },
        rsaPrivateKey
      );

      // First request — cache miss
      const req1 = createMockRequest(`Bearer ${token1}`);
      const res1 = createMockResponse();
      const next1 = vi.fn();
      await middleware(req1 as any, res1 as any, next1);
      expect(next1).toHaveBeenCalledOnce();

      // Second request — cache hit
      const req2 = createMockRequest(`Bearer ${token2}`);
      const res2 = createMockResponse();
      const next2 = vi.fn();
      await middleware(req2 as any, res2 as any, next2);
      expect(next2).toHaveBeenCalledOnce();

      // getPublicJWKS should have been called exactly once
      expect(deps.keyStore.getPublicJWKS).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Cache invalidation via clearJwksCache
  // -----------------------------------------------------------------------
  describe('cache invalidation', () => {
    it('should force JWKS reload after clearJwksCache()', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token1 = await signToken(
        { client_id: 'client-1', scope: 'parako:clients:read' },
        rsaPrivateKey
      );
      const token2 = await signToken(
        { client_id: 'client-2', scope: 'parako:users:read' },
        rsaPrivateKey
      );

      // First request — loads JWKS
      const req1 = createMockRequest(`Bearer ${token1}`);
      const res1 = createMockResponse();
      await middleware(req1 as any, res1 as any, vi.fn());

      expect(deps.keyStore.getPublicJWKS).toHaveBeenCalledTimes(1);

      // Clear cache
      clearJwksCache();

      // Second request — should reload JWKS
      const req2 = createMockRequest(`Bearer ${token2}`);
      const res2 = createMockResponse();
      await middleware(req2 as any, res2 as any, vi.fn());

      expect(deps.keyStore.getPublicJWKS).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle keyStore.getPublicJWKS failure gracefully', async () => {
      const deps = createDeps({
        keyStore: {
          getPublicJWKS: vi
            .fn()
            .mockRejectedValue(new Error('DB connection lost')),
        },
      });
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'my-client', scope: 'parako:clients:read' },
        rsaPrivateKey
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });

    it('should handle token with multiple scopes including platform-only', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Mix of regular and platform-only scopes from a regular issuer
      const token = await signToken(
        {
          client_id: 'my-client',
          scope: 'parako:clients:read parako:tenants:write',
        },
        rsaPrivateKey,
        { issuer: TEST_ISSUER }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should handle token with empty scope string', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const token = await signToken(
        { client_id: 'my-client', scope: '' },
        rsaPrivateKey
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
      expect((req as any).apiAuth.scope).toBe('');
    });

    it('should handle completely garbled token', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const req = createMockRequest('Bearer not.a.valid.jwt.at.all');
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_TYPES.TOKEN_INVALID,
          status: 401,
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // JWT auth — WWW-Authenticate header (RFC 6750)
  // -----------------------------------------------------------------------
  describe('WWW-Authenticate header (RFC 6750)', () => {
    it('should include WWW-Authenticate: Bearer on 401 for missing token', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);
      const req = createMockRequest(); // no auth header
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('Bearer realm="parako-management-api"')
      );
    });

    it('should include error="invalid_token" for expired token', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Create a token that expired 1 hour ago
      const token = await new jose.SignJWT({
        client_id: 'c',
        scope: 'parako:clients:read',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .setIssuer(TEST_ISSUER)
        .setAudience(EXPECTED_AUDIENCE)
        .sign(rsaPrivateKey);

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();

      await middleware(req as any, res as any, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="invalid_token"')
      );
    });

    it('should include error="invalid_request" for missing Authorization header', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req as any, res as any, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="invalid_request"')
      );
    });

    it('should include error="invalid_token" for garbled token', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      const req = createMockRequest('Bearer not.a.valid.jwt');
      const res = createMockResponse();

      await middleware(req as any, res as any, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="invalid_token"')
      );
    });

    it('should NOT include WWW-Authenticate on 403 responses', async () => {
      const deps = createDeps();
      const middleware = createJwtAuthMiddleware(deps);

      // Use a platform-only scope with non-platform issuer to get 403
      const token = await signToken(
        { client_id: 'c', scope: 'parako:tenants:read' },
        rsaPrivateKey,
        { issuer: TEST_ISSUER }
      );

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();

      await middleware(req as any, res as any, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      const wwwAuthCalls = (res.setHeader as any).mock.calls.filter(
        (c: any[]) => c[0] === 'WWW-Authenticate'
      );
      expect(wwwAuthCalls).toHaveLength(0);
    });
  });
});
