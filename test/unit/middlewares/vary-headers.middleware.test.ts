import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { onHeadersMock } = vi.hoisted(() => ({
  onHeadersMock: vi.fn(),
}));

vi.mock('on-headers', () => ({ default: onHeadersMock }));

import { HARDENING } from '../../../src/config/hardening-defaults.js';
import { varyHeadersMiddleware } from '../../../src/middlewares/vary-headers.middleware.js';

describe('varyHeadersMiddleware', () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;
  let contentType: unknown;

  beforeEach(() => {
    contentType = 'text/html; charset=utf-8';
    req = { path: '/auth/login' } as Request;
    res = {
      vary: vi.fn(),
      getHeader: vi.fn(() => contentType),
    } as unknown as Response;
    next = vi.fn();
    onHeadersMock.mockReset();
    (HARDENING.cache as any).varyIncludeAcceptLanguage = true;
  });

  afterEach(() => {
    (HARDENING.cache as any).varyIncludeAcceptLanguage = true;
  });

  const invokeHeaders = () => {
    varyHeadersMiddleware(req, res, next);
    expect(onHeadersMock).toHaveBeenCalledWith(res, expect.any(Function));
    const callback = onHeadersMock.mock.calls[0][1];
    callback.call(res);
  };

  it('registers response-header handling and always varies by content encoding', () => {
    invokeHeaders();

    expect(res.vary).toHaveBeenNthCalledWith(1, 'Accept-Encoding');
    expect(res.vary).toHaveBeenNthCalledWith(2, 'Accept-Language');
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    '/css/',
    '/css/styles.css',
    '/js/app.js',
    '/images/logo.svg',
    '/manifest.json',
    '/service-worker.js',
    '/manifest.webmanifest',
  ])('does not vary static response %s by language', path => {
    Object.defineProperty(req, 'path', { value: path, configurable: true });

    invokeHeaders();

    expect(res.vary).toHaveBeenCalledOnce();
    expect(res.vary).toHaveBeenCalledWith('Accept-Encoding');
  });

  it('varies localized HTML routes that only start with a static filename by language', () => {
    Object.defineProperty(req, 'path', {
      value: '/manifest.json-preview',
      configurable: true,
    });

    invokeHeaders();

    expect(res.vary).toHaveBeenNthCalledWith(1, 'Accept-Encoding');
    expect(res.vary).toHaveBeenNthCalledWith(2, 'Accept-Language');
  });

  it.each([
    undefined,
    42,
    'application/json; charset=utf-8',
    'text/plain; charset=utf-8',
  ])('does not vary non-HTML content type %s by language', value => {
    contentType = value;

    invokeHeaders();

    expect(res.vary).toHaveBeenCalledOnce();
    expect(res.vary).not.toHaveBeenCalledWith('Accept-Language');
  });

  it('recognizes HTML media types case-insensitively', () => {
    contentType = 'Text/HTML; charset=UTF-8';

    invokeHeaders();

    expect(res.vary).toHaveBeenNthCalledWith(1, 'Accept-Encoding');
    expect(res.vary).toHaveBeenNthCalledWith(2, 'Accept-Language');
  });

  it('respects the disabled Accept-Language hardening switch', () => {
    (HARDENING.cache as any).varyIncludeAcceptLanguage = false;

    invokeHeaders();

    expect(res.getHeader).not.toHaveBeenCalled();
    expect(res.vary).toHaveBeenCalledOnce();
  });
});
