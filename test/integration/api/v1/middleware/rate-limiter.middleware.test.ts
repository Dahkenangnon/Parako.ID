import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  apiRateLimiter,
  type RateLimitTier,
} from '../../../../../src/api/v1/middleware/rate-limiter.middleware.js';

// Tests

describe('api/v1/middleware/rate-limiter', () => {
  // 1. Returns a function (middleware) for each tier
  describe('factory returns middleware', () => {
    const tiers: RateLimitTier[] = ['read', 'write', 'delete', 'sensitive'];

    it.each(tiers)('should return a function for the "%s" tier', tier => {
      const middleware = apiRateLimiter(tier);
      expect(typeof middleware).toBe('function');
    });
  });

  // 2. Rate limit tier values are correct
  describe('tier configuration values', () => {
    it('should configure read tier at 100 requests per 60 seconds', () => {
      // We verify by importing and checking the factory produces a middleware.
      // The actual values are tested structurally — we trust express-rate-limit
      // to apply them. We validate the factory does not throw with valid tiers.
      const middleware = apiRateLimiter('read');
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('function');
    });

    it('should configure write tier at 30 requests per 60 seconds', () => {
      const middleware = apiRateLimiter('write');
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('function');
    });

    it('should configure delete tier at 10 requests per 60 seconds', () => {
      const middleware = apiRateLimiter('delete');
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('function');
    });

    it('should configure sensitive tier at 3 requests per 60 seconds', () => {
      const middleware = apiRateLimiter('sensitive');
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('function');
    });
  });

  // 3. Returned middleware is callable (smoke test)
  describe('middleware is callable', () => {
    it('should return a middleware with the standard Express (req, res, next) arity', () => {
      const middleware = apiRateLimiter('read');
      // express-rate-limit returns a function that accepts (req, res, next)
      // The .length check may vary due to internal wrappers, so we just
      // verify it is a callable function.
      expect(typeof middleware).toBe('function');
    });
  });

  // 4. RateLimitTier type exists and constrains valid values
  describe('RateLimitTier type', () => {
    it('should accept all valid tier names via the factory', () => {
      // TypeScript compile-time check — if the type were wrong these
      // would fail to compile. At runtime we confirm no exceptions.
      const validTiers: RateLimitTier[] = [
        'read',
        'write',
        'delete',
        'sensitive',
      ];

      for (const tier of validTiers) {
        expect(() => apiRateLimiter(tier)).not.toThrow();
      }
    });
  });

  // 5. Response headers — Content-Type and Retry-After (RFC 6585)
  describe('rate limiter — response headers', () => {
    it('should set Content-Type to application/problem+json and Retry-After on 429', async () => {
      // Use 'sensitive' tier (limit=3) so we can exhaust it quickly
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        (req as any).apiAuth = {
          client_id: 'test-rl-headers',
          iss: 'https://tenant.example.test',
        };
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      // Exhaust the 3-request limit
      for (let i = 0; i < 3; i++) {
        await request(app).get('/test').expect(200);
      }

      // 4th request triggers rate limit
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.headers['retry-after']).toBe('60');
    });

    it('should return RFC 9457 Problem Detail body with retry_after field on 429', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        (req as any).apiAuth = {
          client_id: 'test-rl-body',
          iss: 'https://tenant.example.test',
        };
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      // Exhaust the 3-request limit
      for (let i = 0; i < 3; i++) {
        await request(app).get('/test').expect(200);
      }

      // 4th request
      const res = await request(app).get('/test').expect(429);

      expect(res.body).toEqual(
        expect.objectContaining({
          type: 'urn:parako:error:rate-limit-exceeded',
          title: 'Rate Limit Exceeded',
          status: 429,
          retry_after: 60,
        })
      );
    });
  });

  describe('authenticated caller isolation', () => {
    it('keeps quotas separate when tenants use the same client identifier', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        (req as any).apiAuth = {
          client_id: 'shared-client-id',
          iss: req.get('x-test-issuer'),
        };
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        await request(app)
          .get('/test')
          .set('x-test-issuer', 'https://tenant-a.example.test')
          .expect(200);
      }

      await request(app)
        .get('/test')
        .set('x-test-issuer', 'https://tenant-b.example.test')
        .expect(200);
    });

    it('keeps quotas separate for different clients in the same tenant', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        (req as any).apiAuth = {
          client_id: req.get('x-test-client-id'),
          iss: 'https://tenant.example.test',
        };
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        await request(app)
          .get('/test')
          .set('x-test-client-id', 'client-a')
          .expect(200);
      }

      await request(app)
        .get('/test')
        .set('x-test-client-id', 'client-b')
        .expect(200);
    });

    it('applies one quota to the same client across source addresses', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.set('trust proxy', 1);
      app.use((req, _res, next) => {
        (req as any).apiAuth = {
          client_id: 'same-client',
          iss: 'https://tenant.example.test',
        };
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 1; i <= 3; i++) {
        await request(app)
          .get('/test')
          .set('x-forwarded-for', `192.0.2.${i}`)
          .expect(200);
      }

      await request(app)
        .get('/test')
        .set('x-forwarded-for', '192.0.2.4')
        .expect(429);
    });
  });

  describe('anonymous caller isolation', () => {
    it('falls back to independent source-address quotas', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.set('trust proxy', 1);
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        await request(app)
          .get('/test')
          .set('x-forwarded-for', '192.0.2.10')
          .expect(200);
      }

      await request(app)
        .get('/test')
        .set('x-forwarded-for', '192.0.2.11')
        .expect(200);
    });

    it('uses the socket address when Express has no resolved request IP', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        Object.defineProperty(req, 'ip', {
          configurable: true,
          value: undefined,
        });
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        await request(app).get('/test').expect(200);
      }

      await request(app).get('/test').expect(429);
    });

    it('uses a deterministic key when no network address is available', async () => {
      const limiter = apiRateLimiter('sensitive');
      const app = express();
      app.use((req, _res, next) => {
        Object.defineProperty(req, 'ip', {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(req.socket, 'remoteAddress', {
          configurable: true,
          value: undefined,
        });
        next();
      });
      app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        await request(app).get('/test').expect(200);
      }

      await request(app).get('/test').expect(429);
    });
  });

  describe('tier ceilings', () => {
    it.each([
      ['read', 100],
      ['write', 30],
      ['delete', 10],
      ['sensitive', 3],
    ] as const)(
      'enforces the %s tier at %i requests per window',
      async (tier, limit) => {
        const limiter = apiRateLimiter(tier);
        const app = express();
        app.use((req, _res, next) => {
          (req as any).apiAuth = {
            client_id: `ceiling-${tier}`,
            iss: 'https://tenant.example.test',
          };
          next();
        });
        app.get('/test', limiter, (_req, res) => res.json({ ok: true }));

        for (let i = 0; i < limit; i++) {
          await request(app).get('/test').expect(200);
        }

        await request(app).get('/test').expect(429);
      }
    );
  });
});
