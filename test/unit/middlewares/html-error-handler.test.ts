import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { createHtmlErrorHandler } from '../../../src/middlewares/html-error-handler.middleware.js';
import { GuardError } from '../../../src/utils/guard-error.js';
import * as shutdown from '../../../src/utils/shutdown.js';

const viewResolver = {
  views: {
    errors: {
      unauthorized: 'error/401',
      forbidden: 'error/403',
      notfound: 'error/404',
      server_error: 'error/500',
      rate_limit: 'error/rate-limit-inline',
    },
  },
} as unknown as Parameters<typeof createHtmlErrorHandler>[0]['viewResolver'];

function makeRes(locals: Record<string, unknown> = {}) {
  const setHeader = vi.fn().mockReturnThis();
  const render = vi.fn();
  const res = {
    headersSent: false,
    locals,
    status: vi.fn().mockReturnThis(),
    setHeader,
    render,
    redirect: vi.fn(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
  };
  return res;
}

function makeDeps() {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  } as unknown as Parameters<typeof createHtmlErrorHandler>[0]['logger'];
  const flashApi = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const sessionManager = {
    flash: vi.fn().mockReturnValue(flashApi),
  };
  return { logger, viewResolver, sessionManager, flashApi };
}

const req = {
  originalUrl: '/admin/x',
  method: 'GET',
  ip: '127.0.0.1',
  path: '/admin/x',
} as unknown as Request;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createHtmlErrorHandler', () => {
  it('renders error/403 for a GuardError without redirectTo', () => {
    const handler = createHtmlErrorHandler(makeDeps());
    const res = makeRes();
    const next: NextFunction = vi.fn();

    handler(new GuardError('forbidden page', { status: 403 }), req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith(
      'error/403',
      expect.objectContaining({
        title: 'Forbidden',
        message: 'forbidden page',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('renders error/401 for a 401 GuardError', () => {
    const handler = createHtmlErrorHandler(makeDeps());
    const res = makeRes();
    handler(
      new GuardError('not logged in', { status: 401 }),
      req,
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.render).toHaveBeenCalledWith('error/401', expect.any(Object));
  });

  it('renders error/404 with the request path for a not-found GuardError', () => {
    const handler = createHtmlErrorHandler(makeDeps());
    const res = makeRes();

    handler(new GuardError('missing page', { status: 404 }), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('error/404', {
      title: 'Not Found',
      message: 'missing page',
      url: '/admin/x',
    });
  });

  it.each([
    { redirectTo: '/admin', flashMessage: undefined },
    { redirectTo: undefined, flashMessage: 'Try again' },
  ])('renders a GuardError when redirect metadata is incomplete', metadata => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();

    handler(
      new GuardError('no perms', { status: 403, ...metadata }),
      req,
      res,
      vi.fn()
    );

    expect(deps.sessionManager.flash).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith('error/403', expect.any(Object));
  });

  it('issues flashAndRedirect for a GuardError with redirectTo + flashMessage', () => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();

    handler(
      new GuardError('no perms', {
        status: 403,
        redirectTo: '/admin',
        flashMessage: 'You may not perform this action.',
        flashLevel: 'warning',
      }),
      req,
      res,
      vi.fn()
    );

    expect(deps.flashApi.warning).toHaveBeenCalledWith(
      'You may not perform this action.'
    );
    expect(res.redirect).toHaveBeenCalledWith('/admin');
    expect(res.render).not.toHaveBeenCalled();
  });

  it('falls back to the error view if the redirect path is open-redirect', () => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();

    handler(
      new GuardError('no perms', {
        status: 403,
        redirectTo: '//attacker.example.com',
        flashMessage: 'msg',
      }),
      req,
      res,
      vi.fn()
    );

    expect(deps.logger.error).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('error/403', expect.any(Object));
  });

  it('renders error/500 for an unknown error and logs at error level', () => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();
    const err = new Error('boom');

    handler(err, req, res, vi.fn());

    expect(deps.logger.error).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        url: '/admin/x',
        errorName: 'Error',
        errorMessage: 'boom',
      })
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.render).toHaveBeenCalledWith('error/500', expect.any(Object));

    const renderData = res.render.mock.calls[0][1];
    expect(renderData.title).toBe('Error');
    expect(renderData.t('errors.unexpected')).toBe('errors.unexpected');
  });

  it('wraps non-Error rejections into an Error before logging', () => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();

    handler('string-error', req, res, vi.fn());

    expect(deps.logger.error).toHaveBeenCalled();
    const loggedErr = (
      deps.logger.error as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as Error;
    expect(loggedErr).toBeInstanceOf(Error);
    expect(loggedErr.message).toBe('string-error');
  });

  it('returns 503 with Retry-After during shutdown for unknown errors', () => {
    vi.spyOn(shutdown, 'isShuttingDown').mockReturnValue(true);
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();

    handler(new Error('boom'), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(res.render).toHaveBeenCalledWith('error/500', expect.any(Object));

    const renderData = res.render.mock.calls[0][1];
    expect(renderData.title).toBe('Service Unavailable');
    expect(renderData.t('errors.unavailable')).toBe('errors.unavailable');
  });

  it('preserves tenant title and translation helper during shutdown', () => {
    vi.spyOn(shutdown, 'isShuttingDown').mockReturnValue(true);
    const t = vi.fn((key: string) => `translated:${key}`);
    const handler = createHtmlErrorHandler(makeDeps());
    const res = makeRes({ app: { title: 'Tenant ID' }, t });

    handler(new Error('boom'), req, res, vi.fn());

    expect(res.render).toHaveBeenCalledWith('error/500', {
      title: 'Tenant ID',
      t,
    });
  });

  it('delegates to next when headers have already been sent', () => {
    const deps = makeDeps();
    const handler = createHtmlErrorHandler(deps);
    const res = makeRes();
    (res as { headersSent: boolean }).headersSent = true;
    const next: NextFunction = vi.fn();
    const err = new Error('late');

    handler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(deps.logger.error).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('uses res.locals.t when present for the 500 template', () => {
    const t = (k: string) => k.toUpperCase();
    const handler = createHtmlErrorHandler(makeDeps());
    const res = makeRes({ t, app: { title: 'My App' } });

    handler(new Error('boom'), req, res, vi.fn());

    expect(res.render).toHaveBeenCalledWith(
      'error/500',
      expect.objectContaining({ title: 'My App', t })
    );
  });
});
