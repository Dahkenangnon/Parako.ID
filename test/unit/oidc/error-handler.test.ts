import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errors as oidcErrors } from 'oidc-provider';

import { OIDCErrorHandler } from '../../../src/oidc/flows/handlers/error.js';

function createHandler(activityFailed = vi.fn()) {
  const viewResolver = {
    views: { auth: { oidc: { error: 'auth/oidc/error' } } },
  };
  const activityService = { failed: activityFailed };
  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn(() => ({
      ip: '127.0.0.1',
      user_agent: 'test',
    })),
  };
  const sessionManager = { getActiveUser: vi.fn(() => null) };

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
  it('renders the provider error description instead of its protocol code', async () => {
    const handler = createHandler();
    const response = createResponse();
    const error = Object.assign(new Error('invalid_request'), {
      error: 'invalid_request',
      error_description: 'The redirect URI is not registered.',
      name: 'invalid_request',
      statusCode: 400,
    });

    await handler.handle(
      error as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'invalid_request',
      errorMessage: 'The redirect URI is not registered.',
    });
  });

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

  it('renders account-selection errors with their valid provider status', async () => {
    const handler = createHandler();
    const response = createResponse();
    const error = Object.assign(new Error('account_selection_required'), {
      name: 'account_selection_required',
      statusCode: 403,
    });

    await handler.handle(
      error as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'account_selection_required',
      errorMessage:
        'No accounts are available for selection. Please sign in first.',
    });
  });

  it('uses a valid legacy status when statusCode is not an error status', async () => {
    const handler = createHandler();
    const response = createResponse();

    await handler.handle(
      {
        error: 'invalid_scope',
        error_description: 'Scope is unavailable.',
        name: '',
        status: 401,
        statusCode: 200,
      } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'invalid_scope',
      errorMessage: 'Scope is unavailable.',
    });
  });

  it('falls back to a sanitized server error and HTTP 500', async () => {
    const handler = createHandler();
    const response = createResponse();

    await handler.handle(
      {
        error: 'attacker_controlled_type',
        error_description: '<script>alert(1)</script>',
        name: '',
        status: 302,
      } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'server_error',
      errorMessage: '<script>alert(1)</script>',
    });
  });

  it('limits rendered provider descriptions to 500 characters', async () => {
    const handler = createHandler();
    const response = createResponse();
    const description = 'x'.repeat(600);

    await handler.handle(
      {
        error: 'invalid_request',
        error_description: description,
        name: 'invalid_request',
        statusCode: 400,
      } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'invalid_request',
      errorMessage: 'x'.repeat(500),
    });
  });

  it('uses a generic message when provider error content is not text', async () => {
    const handler = createHandler();
    const response = createResponse();

    await handler.handle(
      {
        error: 'server_error',
        error_description: { private: 'details' },
        name: 'server_error',
        statusCode: 500,
      } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'server_error',
      errorMessage: 'An error occurred during the authentication process.',
    });
  });

  it('uses safe fallbacks when the provider supplies no error content', async () => {
    const handler = createHandler();
    const response = createResponse();

    await handler.handle(
      { name: '', statusCode: 500 } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.render).toHaveBeenCalledWith('auth/oidc/error', {
      errorType: 'server_error',
      errorMessage: 'An error occurred during the authentication process.',
    });
  });

  it('records provider errors as anonymous system activity', async () => {
    const activityFailed = vi.fn();
    const handler = createHandler(activityFailed);

    await handler.handle(
      {
        error: 'server_error',
        message: 'Provider unavailable',
        name: 'server_error',
        statusCode: 500,
      } as any,
      {} as Request,
      createResponse(),
      vi.fn() as NextFunction
    );

    expect(activityFailed).toHaveBeenCalledWith(
      'oidc.error',
      'OIDC provider error',
      null,
      expect.objectContaining({
        actor: { actor_type: 'anonymous' },
        target: { target_type: 'system' },
      })
    );
  });

  it('still renders the error when activity recording fails', async () => {
    const activityFailed = vi.fn(() => {
      throw new Error('audit unavailable');
    });
    const handler = createHandler(activityFailed);
    const response = createResponse();

    await handler.handle(
      {
        error: 'server_error',
        message: 'Provider unavailable',
        name: 'server_error',
        statusCode: 500,
      } as any,
      {} as Request,
      response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.render).toHaveBeenCalled();
  });
});
