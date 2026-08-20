import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  redactSensitiveQueryParams,
  RequestLoggerMiddleware,
} from '../../../src/middlewares/request-logger.middleware.js';

function getRequestId(req: Request): string | undefined {
  return (req as Request & { requestId?: string }).requestId;
}

describe('request logger URL redaction', () => {
  it('redacts reset tokens while preserving safe query parameters', () => {
    expect(
      redactSensitiveQueryParams(
        '/auth/reset-password?token=secret-value&locale=fr'
      )
    ).toBe('/auth/reset-password?token=[REDACTED]&locale=fr');
  });

  it('redacts OAuth credentials case-insensitively', () => {
    expect(
      redactSensitiveQueryParams(
        '/callback?code=authorization-code&ACCESS_TOKEN=bearer-token&state=safe-state'
      )
    ).toBe(
      '/callback?code=[REDACTED]&ACCESS_TOKEN=[REDACTED]&state=safe-state'
    );
  });

  it('redacts sensitive parameter names even when they are percent-encoded', () => {
    expect(
      redactSensitiveQueryParams(
        '/callback?access%5Ftoken=bearer-token&%74oken=reset-token&state=safe'
      )
    ).toBe('/callback?access%5Ftoken=[REDACTED]&%74oken=[REDACTED]&state=safe');
  });

  it('preserves malformed encoded parameter names without throwing', () => {
    expect(
      redactSensitiveQueryParams('/callback?%E0%A4%A=secret&state=safe')
    ).toBe('/callback?%E0%A4%A=secret&state=safe');
  });

  it('leaves URLs without sensitive query parameters unchanged', () => {
    expect(redactSensitiveQueryParams('/auth/login')).toBe('/auth/login');
    expect(redactSensitiveQueryParams('/auth/login?locale=fr')).toBe(
      '/auth/login?locale=fr'
    );
    expect(
      redactSensitiveQueryParams('/callback?flag&=empty#client-fragment')
    ).toBe('/callback?flag&=empty#client-fragment');
  });
});

describe('RequestLoggerMiddleware', () => {
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let metrics: { recordRequestDuration: ReturnType<typeof vi.fn> };
  let middleware: RequestLoggerMiddleware;
  let req: Request;
  let res: Response;
  let next: NextFunction;
  let finish: (() => void) | undefined;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    metrics = { recordRequestDuration: vi.fn() };
    middleware = new RequestLoggerMiddleware(logger as any, metrics as any);
    req = {
      path: '/accounts',
      method: 'GET',
      originalUrl: '/accounts',
      headers: {},
      ip: '203.0.113.10',
    } as unknown as Request;
    res = {
      statusCode: 200,
      setHeader: vi.fn(),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') finish = callback;
        return res;
      }),
    } as unknown as Response;
    next = vi.fn();
    finish = undefined;
  });

  it('generates a safe request ID when a multi-value header is supplied', () => {
    req.headers['x-request-id'] = ['first', 'second'];

    middleware.handler(req, res, next);

    expect(getRequestId(req)).toEqual(expect.any(String));
    expect(getRequestId(req)).not.toBe('first,second');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      getRequestId(req)
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, '', 'contains spaces', 'line\nbreak', 'x'.repeat(129)])(
    'generates a request ID for unsafe supplied value %s',
    supplied => {
      req.headers['x-request-id'] = supplied;

      middleware.handler(req, res, next);

      expect(getRequestId(req)).toEqual(expect.any(String));
      expect(getRequestId(req)).not.toBe(supplied);
    }
  );

  it('preserves a bounded safe proxy request ID', () => {
    req.headers['x-request-id'] = 'proxy:request-123/attempt_2';

    middleware.handler(req, res, next);

    expect(getRequestId(req)).toBe('proxy:request-123/attempt_2');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      'proxy:request-123/attempt_2'
    );
  });

  it.each([
    '/css/styles.css',
    '/js/app.js',
    '/images/logo.svg',
    '/fonts/inter.woff2',
    '/favicon.ico',
    '/health/ready',
    '/metrics',
  ])('skips request lifecycle logging for %s', path => {
    Object.defineProperty(req, 'path', { value: path, configurable: true });

    middleware.handler(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
  });

  it.each(['/healthcare', '/metrics-dashboard'])(
    'logs non-probe lookalike route %s',
    path => {
      Object.defineProperty(req, 'path', { value: path, configurable: true });

      middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Request-ID',
        expect.any(String)
      );
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    }
  );

  it('records a completed routed request with redacted URL and bounded user agent', () => {
    req.headers['x-request-id'] = 'request-123';
    req.headers['user-agent'] = 'A'.repeat(140);
    req.originalUrl = '/callback?code=secret&state=safe';
    (req as any).route = { path: '/callback' };
    const clock = vi
      .spyOn(process.hrtime, 'bigint')
      .mockReturnValueOnce(1_000_000_000n)
      .mockReturnValueOnce(1_012_600_000n);

    middleware.handler(req, res, next);
    expect(finish).toBeTypeOf('function');
    finish!();

    expect(metrics.recordRequestDuration).toHaveBeenCalledWith(
      'GET',
      '/callback',
      200,
      0.0126
    );
    expect(logger.info).toHaveBeenCalledWith('Request completed', {
      requestId: 'request-123',
      method: 'GET',
      url: '/callback?code=[REDACTED]&state=safe',
      statusCode: 200,
      duration: '13ms',
      ip: '203.0.113.10',
      userAgent: 'A'.repeat(120),
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('warns for client errors and uses the raw request path for metrics', () => {
    res.statusCode = 404;

    middleware.handler(req, res, next);
    finish!();

    expect(metrics.recordRequestDuration).toHaveBeenCalledWith(
      'GET',
      '/accounts',
      404,
      expect.any(Number)
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Request client error',
      expect.objectContaining({ statusCode: 404, userAgent: undefined })
    );
  });

  it('logs server errors at error level', () => {
    res.statusCode = 500;

    middleware.handler(req, res, next);
    finish!();

    expect(logger.error).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ statusCode: 500 })
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
