import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { opsRoutes } from '../../../src/routes/ops.js';

function makeHarness() {
  const guard = {
    handler: vi.fn((_req, _res, next) => next()),
  };
  const callbackService = {
    handleCallback: vi.fn(),
  };
  const app = express();
  app.use(opsRoutes(guard as never, callbackService as never));

  return { app, callbackService, guard };
}

describe('opsRoutes', () => {
  it('runs the infrastructure guard before returning health status', async () => {
    const { app, callbackService, guard } = makeHarness();

    const response = await request(app).get('/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      timestamp: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      ),
    });
    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).not.toHaveBeenCalled();
  });

  it('returns guarded metrics status without invoking callback handling', async () => {
    const { app, callbackService, guard } = makeHarness();

    await request(app).get('/metrics').expect(200, {
      status: 'ok',
      message: 'Metrics endpoint',
    });

    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['both callback parameters', ''],
    ['the state parameter', '?code=authorization-code'],
    ['the code parameter', '?state=opaque-state'],
  ])('rejects a callback missing %s', async (_description, query) => {
    const { app, callbackService, guard } = makeHarness();

    await request(app)
      .get(`/social/google/callback${query}`)
      .expect(400, { error: 'Missing code or state parameter' });

    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['code', '?code=first-code&code=second-code&state=opaque-state'],
    ['state', '?code=authorization-code&state=first-state&state=second-state'],
  ])(
    'rejects a callback with a repeated %s parameter',
    async (_name, query) => {
      const { app, callbackService, guard } = makeHarness();

      await request(app)
        .get(`/social/google/callback${query}`)
        .expect(400, { error: 'Invalid code or state parameter' });

      expect(guard.handler).toHaveBeenCalledOnce();
      expect(callbackService.handleCallback).not.toHaveBeenCalled();
    }
  );

  it('relays a successful social callback to the tenant redirect URL', async () => {
    const { app, callbackService, guard } = makeHarness();
    callbackService.handleCallback.mockResolvedValue({
      success: true,
      redirectUrl: new URL(
        'https://tenant.example.test/auth/social/callback?ticket=opaque-ticket'
      ),
    });

    await request(app)
      .get('/social/google/callback?code=authorization-code&state=opaque-state')
      .expect(302)
      .expect(
        'location',
        'https://tenant.example.test/auth/social/callback?ticket=opaque-ticket'
      );

    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).toHaveBeenCalledExactlyOnceWith(
      'google',
      'authorization-code',
      'opaque-state'
    );
  });

  it('returns a client error when callback validation is rejected', async () => {
    const { app, callbackService, guard } = makeHarness();
    callbackService.handleCallback.mockResolvedValue({
      success: false,
      error: 'Invalid callback state',
    });

    await request(app)
      .get(
        '/social/github/callback?code=authorization-code&state=invalid-state'
      )
      .expect(400, { error: 'Invalid callback state' });

    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).toHaveBeenCalledExactlyOnceWith(
      'github',
      'authorization-code',
      'invalid-state'
    );
  });

  it('returns a stable server error without exposing callback failures', async () => {
    const { app, callbackService, guard } = makeHarness();
    callbackService.handleCallback.mockRejectedValue(
      new Error('upstream credential leaked detail')
    );

    await request(app)
      .get(
        '/social/microsoft/callback?code=authorization-code&state=opaque-state'
      )
      .expect(500, { error: 'Internal server error' });

    expect(guard.handler).toHaveBeenCalledOnce();
    expect(callbackService.handleCallback).toHaveBeenCalledExactlyOnceWith(
      'microsoft',
      'authorization-code',
      'opaque-state'
    );
  });
});
