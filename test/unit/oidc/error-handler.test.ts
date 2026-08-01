import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errors as oidcErrors } from 'oidc-provider';

import { OIDCErrorHandler } from '../../../src/oidc/flows/handlers/error.js';

function createHandler() {
  const viewResolver = {
    views: { auth: { oidc: { error: 'auth/oidc/error' } } },
  };
  const activityService = {};
  const clientDeviceInfoManager = {};
  const sessionManager = {};

  return new OIDCErrorHandler(
    viewResolver as never,
    activityService as never,
    clientDeviceInfoManager as never,
    sessionManager as never
  );
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    render: vi.fn(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
  };
}

describe('OIDCErrorHandler', () => {
  it('renders a replayed interaction as an expired 400 response', async () => {
    const handler = createHandler();
    const response = createResponse();
    const error = new oidcErrors.SessionNotFound(
      'interaction session not found'
    );

    await handler.handle(
      error,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.render).toHaveBeenCalledWith(
      'auth/oidc/error',
      expect.objectContaining({
        errorType: 'expired_session',
      })
    );
  });
});
