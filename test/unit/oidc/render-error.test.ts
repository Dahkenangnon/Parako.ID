import { afterEach, describe, expect, it, vi } from 'vitest';

import RenderError from '../../../src/oidc/specs/render-error.js';

function createRenderer() {
  const viewResolver = {
    views: { auth: { oidc: { error: 'auth/oidc/error' } } },
  };
  const oidcUtils = {
    getLocale: vi.fn().mockReturnValue('fr'),
  };

  return {
    oidcUtils,
    renderError: RenderError(viewResolver as never, oidcUtils as never),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OIDC renderError', () => {
  it('renders the configured error view with localized protocol details', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-04-05T12:00:00.000Z'));
    const { oidcUtils, renderError } = createRenderer();
    const out = {
      error: 'invalid_request',
      error_description: 'A required parameter is missing',
      state: 'request-state',
    };
    const error = new Error('invalid request');
    const context = {
      render: vi.fn().mockResolvedValue(undefined),
      t: vi.fn().mockReturnValue('Authorization failed'),
    };

    await renderError(context as never, out, error);

    expect(oidcUtils.getLocale).toHaveBeenCalledWith(context);
    expect(context.t).toHaveBeenCalledWith('oidc.errors.page_title');
    expect(context.render).toHaveBeenCalledWith('auth/oidc/error', {
      out,
      error,
      errorType: 'invalid_request',
      errorMessage: 'A required parameter is missing',
      locale: 'fr',
      currentYear: 2031,
      title: 'Authorization failed',
    });
  });

  it('uses the English fallback title when translation is unavailable', async () => {
    const { renderError } = createRenderer();
    const context = {
      render: vi.fn().mockResolvedValue(undefined),
    };

    await renderError(context as never, {}, new Error('failure'));

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/error',
      expect.objectContaining({ title: 'Error Occurred' })
    );
  });

  it('does not resolve before asynchronous view rendering completes', async () => {
    const { renderError } = createRenderer();
    let finishRendering!: () => void;
    const pendingRender = new Promise<void>(resolve => {
      finishRendering = resolve;
    });
    const context = {
      render: vi.fn().mockReturnValue(pendingRender),
    };
    let completed = false;

    const result = renderError(context as never, {}, new Error('failure')).then(
      () => {
        completed = true;
      }
    );
    await Promise.resolve();

    expect(completed).toBe(false);
    finishRendering();
    await result;
    expect(completed).toBe(true);
  });
});
