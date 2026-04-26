import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  createApiV1Router,
  type ApiV1Dependencies,
} from '../../../../../src/api/v1/routes/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub controller — every method is a no-op that calls next(). */
function stubController<T>(methods: (keyof T)[]): T {
  const ctrl: Record<string, unknown> = {};
  for (const m of methods) {
    ctrl[m as string] = vi.fn((_req: any, _res: any, next: any) => next());
  }
  return ctrl as T;
}

function createDeps(
  overrides: Partial<ApiV1Dependencies> = {}
): ApiV1Dependencies {
  return {
    jwtAuth: (req: any, _res, next) => {
      // Simulate authenticated request with broad scopes
      req.apiAuth = {
        client_id: 'test-client',
        scope:
          'parako:clients:read parako:users:read parako:sessions:read parako:jwks:read parako:audit:read parako:stats:read parako:tenants:read',
        iss: 'https://test.parako.id/oidc/v1',
        aud: 'urn:parako:api:v1',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      next();
    },
    auditLogger: (_req, _res, next) => next(),
    errorHandler: (err: any, _req: any, res: any, _next: any) => {
      // Mirror the real error handler for testing
      const status = err.status ?? 500;
      res
        .status(status)
        .setHeader('Content-Type', 'application/problem+json')
        .json(err.toJSON ? err.toJSON() : { status, detail: err.message });
    },
    clientsController: stubController([
      'list',
      'create',
      'get',
      'update',
      'patch',
      'destroy',
      'activate',
      'deactivate',
      'regenerateSecret',
      'stats',
    ]),
    usersController: stubController([
      'list',
      'create',
      'get',
      'update',
      'patch',
      'destroy',
      'lock',
      'unlock',
      'passwordReset',
      'mfaReset',
      'activities',
      'sessions',
    ]),
    sessionsController: stubController(['list', 'get', 'revoke', 'bulkRevoke']),
    jwksController: stubController([
      'list',
      'get',
      'rotate',
      'retireExpired',
      'retire',
    ]),
    auditController: stubController(['list', 'get', 'types', 'stats']),
    statsController: stubController(['overview', 'health']),
    tenantsController: stubController([
      'list',
      'create',
      'get',
      'getConfig',
      'updateConfig',
    ]),
    registrationTokensController: stubController([
      'list',
      'create',
      'get',
      'destroy',
    ]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/routes — 404 catch-all', () => {
  it('should return 404 with Problem Detail JSON for unmatched GET path', async () => {
    const deps = createDeps();
    const router = createApiV1Router(deps);

    const app = express();
    app.use('/api/v1', router);

    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'urn:parako:error:not-found',
      title: 'Resource Not Found',
      status: 404,
    });
    expect(res.body.detail).toMatch(/no endpoint matches/i);
  });

  it('should return 404 with Problem Detail JSON for unmatched POST path', async () => {
    const deps = createDeps();
    const router = createApiV1Router(deps);

    const app = express();
    app.use('/api/v1', router);

    const res = await request(app)
      .post('/api/v1/does-not-exist')
      .send({ foo: 'bar' });

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.status).toBe(404);
    expect(res.body.detail).toContain('POST');
  });

  it('should return 404 for unmatched DELETE path', async () => {
    const deps = createDeps();
    const router = createApiV1Router(deps);

    const app = express();
    app.use('/api/v1', router);

    const res = await request(app).delete('/api/v1/unknown/resource');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.detail).toContain('DELETE');
  });

  it('should include the original URL in the error detail', async () => {
    const deps = createDeps();
    const router = createApiV1Router(deps);

    const app = express();
    app.use('/api/v1', router);

    const res = await request(app).get('/api/v1/nonexistent/path');

    expect(res.body.detail).toContain('/api/v1/nonexistent/path');
  });

  it('should still route matched paths normally', async () => {
    const deps = createDeps();

    // Override the stats controller to actually respond
    deps.statsController.health = vi.fn((_req: any, res: any) => {
      res.status(200).json({ status: 'ok' });
    }) as any;

    const router = createApiV1Router(deps);

    const app = express();
    app.use('/api/v1', router);

    const res = await request(app).get('/api/v1/stats/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
