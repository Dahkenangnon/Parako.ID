import { describe, expect, it, vi } from 'vitest';

import { OIDCAbortHandler } from '../../../src/oidc/flows/handlers/abort.js';

describe('OIDC abort handler', () => {
  const createHarness = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const activityService = { warning: vi.fn() };
    const clientDeviceInfoManager = {
      getClientInfoFromRequest: vi.fn(() => ({
        ip: '127.0.0.1',
        user_agent: 'test',
      })),
    };
    const sessionManager = { getActiveUser: vi.fn(() => null) };
    const handler = new OIDCAbortHandler(
      logger as any,
      activityService as any,
      clientDeviceInfoManager as any,
      sessionManager as any
    );
    const request = { params: { uid: 'a'.repeat(20) } };
    const response = {
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();
    const provider = {
      interactionFinished: vi.fn().mockResolvedValue(undefined),
    };

    return {
      activityService,
      clientDeviceInfoManager,
      handler,
      logger,
      next,
      provider,
      request,
      response,
    };
  };

  it('finishes a valid interaction with access_denied', async () => {
    const harness = createHarness();

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.provider.interactionFinished).toHaveBeenCalledWith(
      harness.request,
      harness.response,
      {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      },
      { mergeWithLastSubmission: false }
    );
    expect(harness.activityService.warning).toHaveBeenCalledWith(
      'oidc.abort',
      'User aborted OIDC interaction',
      null,
      expect.objectContaining({ actor: { actor_type: 'anonymous' } })
    );
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'User aborted OIDC interaction',
      { uid: 'a'.repeat(20) }
    );
  });

  it('continues aborting when activity logging fails', async () => {
    const harness = createHarness();
    harness.activityService.warning.mockImplementation(() => {
      throw new Error('audit unavailable');
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'audit unavailable' }),
      { context: 'Error logging abort activity' }
    );
    expect(harness.provider.interactionFinished).toHaveBeenCalled();
  });

  it('renders a safe 400 page for an invalid interaction ID', async () => {
    const harness = createHarness();
    harness.request.params.uid = 'short';

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'OIDC abort received invalid input',
      expect.objectContaining({ issues: expect.any(Array) })
    );
    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Invalid Request',
        error:
          'The request could not be processed. Please return to the previous page and try again.',
        redirectUrl: '/auth/login',
      }
    );
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('forwards provider completion failures to Express', async () => {
    const harness = createHarness();
    const error = new Error('interaction expired');
    harness.provider.interactionFinished.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next,
      harness.provider as any
    );

    expect(harness.logger.error).toHaveBeenCalledWith(
      'Error in abort handler',
      { error }
    );
    expect(harness.next).toHaveBeenCalledWith(error);
  });
});
