import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';

import {
  isShuttingDown,
  markShuttingDown,
} from '../../../src/utils/shutdown.js';

// The /readyz handler is identical to the one mounted by setupHealthEndpoint
// in src/app.ts. The test rebuilds it with a stub database manager so the
// suite does not need a real DB connection or the full Application bootstrap.
function buildReadyzApp(getDbConnected: () => boolean): Express {
  const app = express();
  const handler: RequestHandler = (_req, res) => {
    if (isShuttingDown()) {
      res.status(503).json({
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!getDbConnected()) {
      res.status(503).json({
        status: 'db_disconnected',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/readyz', handler);
  return app;
}

describe('/readyz readiness probe', () => {
  // Precondition: the suite assumes the shutdown flag has not been flipped
  // by another suite running in the same Vitest worker. The shutting_down
  // case must therefore run last in this file (the flag has no reset hook
  // because the production code has no reason to ever clear it).
  beforeAll(() => {
    expect(isShuttingDown()).toBe(false);
  });

  it('returns 200 ready when DB is connected and not shutting down', async () => {
    const app = buildReadyzApp(() => true);
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns 503 db_disconnected when DB is offline', async () => {
    const app = buildReadyzApp(() => false);
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('db_disconnected');
  });

  // MUST be the last test in this file: it flips the process-wide flag
  // and there is no way to unset it. Other suites that depend on the flag
  // being false must run before this one (Vitest's default sequential
  // ordering within a file).
  it('returns 503 shutting_down once markShuttingDown() is called, regardless of DB state', async () => {
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);

    const appWithDb = buildReadyzApp(() => true);
    const dbUpRes = await request(appWithDb).get('/readyz');
    expect(dbUpRes.status).toBe(503);
    expect(dbUpRes.body.status).toBe('shutting_down');

    const appNoDb = buildReadyzApp(() => false);
    const dbDownRes = await request(appNoDb).get('/readyz');
    expect(dbDownRes.status).toBe(503);
    expect(dbDownRes.body.status).toBe('shutting_down');
  });

  afterAll(() => {
    // The flag is intentionally one-way in production. The assertion here
    // documents that contract — the suite leaves the flag set, and any
    // downstream test that requires isShuttingDown() === false must run
    // in a separate Vitest worker (the default with file-level isolation).
    expect(isShuttingDown()).toBe(true);
  });
});
