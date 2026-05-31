import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  GENERIC_VALIDATION_FLASH,
  validateHtmlBody,
  validateHtmlParams,
  validateHtmlQuery,
} from '../../../src/middlewares/validate-html.middleware.js';

type FlashErrorSpy = ReturnType<typeof vi.fn>;

function buildDeps(): {
  sessionManager: { flash: (req: Request) => { error: FlashErrorSpy } };
  logger: { info: FlashErrorSpy; warn: FlashErrorSpy };
  flashError: FlashErrorSpy;
} {
  const flashError = vi.fn();
  return {
    sessionManager: { flash: () => ({ error: flashError }) },
    logger: { info: vi.fn(), warn: vi.fn() },
    flashError,
  };
}

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    body: {},
    params: {},
    originalUrl: '/somewhere?foo=bar',
    method: 'GET',
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response & { redirectSpy: FlashErrorSpy } {
  const redirectSpy = vi.fn();
  const res = { redirect: redirectSpy } as unknown as Response & {
    redirectSpy: FlashErrorSpy;
  };
  Object.defineProperty(res, 'redirectSpy', { value: redirectSpy });
  return res;
}

describe('validateHtmlQuery', () => {
  let deps: ReturnType<typeof buildDeps>;
  beforeEach(() => {
    deps = buildDeps();
  });

  it('on success: replaces req.query with the parsed value and calls next()', () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) });
    const req = buildReq({ query: { page: '5' } });
    const res = buildRes();
    const next = vi.fn();

    validateHtmlQuery(schema, deps)(req, res, next);

    expect(req.query).toEqual({ page: 5 });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('on failure: flashes a GENERIC message (never leaks field paths)', () => {
    const schema = z.object({
      sortBy: z.enum(['created_at', 'email']),
      page: z.coerce.number().min(1),
    });
    const req = buildReq({
      query: { sortBy: '__proto__', page: '-1' },
      originalUrl: '/admin/users?sortBy=__proto__&page=-1',
    });
    const res = buildRes();
    const next = vi.fn();

    validateHtmlQuery(schema, deps)(req, res, next);

    expect(deps.flashError).toHaveBeenCalledOnce();
    const flashMessage = deps.flashError.mock.calls[0][0] as string;
    expect(flashMessage).toBe(GENERIC_VALIDATION_FLASH);
    expect(flashMessage).not.toContain('sortBy');
    expect(flashMessage).not.toContain('page');
    expect(flashMessage).not.toContain('__proto__');
  });

  it('on failure: redirects to the same path with the query string stripped', () => {
    const schema = z.object({ page: z.coerce.number().min(1) });
    const req = buildReq({
      query: { page: '-1' },
      originalUrl: '/admin/users?page=-1',
    });
    const res = buildRes();

    validateHtmlQuery(schema, deps)(req, res, vi.fn());

    expect(res.redirectSpy).toHaveBeenCalledWith('/admin/users');
  });

  it('on failure: logs the issues server-side at info level', () => {
    const schema = z.object({ page: z.coerce.number().min(1) });
    const req = buildReq({
      query: { page: '-1' },
      originalUrl: '/admin/users?page=-1',
    });

    validateHtmlQuery(schema, deps)(req, buildRes(), vi.fn());

    expect(deps.logger.info).toHaveBeenCalledOnce();
    const logCall = deps.logger.info.mock.calls[0];
    const meta = logCall[1] as { issues: { field: string }[] };
    expect(meta.issues[0].field).toBe('page');
  });

  it('does not call next() on parse failure', () => {
    const schema = z.object({ page: z.coerce.number().min(1) });
    const next = vi.fn();
    validateHtmlQuery(schema, deps)(
      buildReq({ query: { page: '-1' }, originalUrl: '/x' }),
      buildRes(),
      next
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('validateHtmlBody', () => {
  let deps: ReturnType<typeof buildDeps>;
  beforeEach(() => {
    deps = buildDeps();
  });

  it('on success: replaces req.body with the parsed value and calls next()', () => {
    const schema = z.object({ email: z.email() });
    const req = buildReq({
      body: { email: 'a@b.io', extraField: 'dropped' },
    });
    const next = vi.fn();

    validateHtmlBody(schema, deps, '/back')(req, buildRes(), next);

    expect(req.body).toEqual({ email: 'a@b.io' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('on failure: redirects to the supplied static path', () => {
    const schema = z.object({ email: z.email() });
    const req = buildReq({ body: { email: 'nope' } });
    const res = buildRes();

    validateHtmlBody(schema, deps, '/admin/users/new')(req, res, vi.fn());

    expect(res.redirectSpy).toHaveBeenCalledWith('/admin/users/new');
  });

  it('on failure: redirects to the path returned by the function form', () => {
    const schema = z.object({ email: z.email() });
    const req = buildReq({
      body: { email: 'nope' },
      params: { id: 'abc-123' },
    });
    const res = buildRes();

    validateHtmlBody(schema, deps, r => `/admin/users/${r.params.id}/edit`)(
      req,
      res,
      vi.fn()
    );

    expect(res.redirectSpy).toHaveBeenCalledWith('/admin/users/abc-123/edit');
  });
});

describe('validateHtmlParams', () => {
  it('on success: replaces req.params with the parsed value and calls next()', () => {
    const schema = z.object({ provider: z.enum(['google', 'github']) });
    const req = buildReq({ params: { provider: 'google' } });
    const next = vi.fn();
    const deps = buildDeps();

    validateHtmlParams(schema, deps, '/')(req, buildRes(), next);

    expect(req.params).toEqual({ provider: 'google' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('on failure: redirects to the supplied fallback path', () => {
    const schema = z.object({ provider: z.enum(['google', 'github']) });
    const req = buildReq({ params: { provider: 'bogus' } });
    const res = buildRes();
    const deps = buildDeps();

    validateHtmlParams(schema, deps, '/auth/login')(req, res, vi.fn());

    expect(res.redirectSpy).toHaveBeenCalledWith('/auth/login');
  });
});
