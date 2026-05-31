import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { asyncHandler } from '../../../src/middlewares/async-handler.js';

function makeReq(extra: Partial<Request> = {}): Request {
  return extra as Request;
}

describe('asyncHandler', () => {
  it('invokes the wrapped handler with (req, res, next)', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const handler = asyncHandler('op.test', fn);

    const req = makeReq();
    const res = {} as Response;
    const next: NextFunction = vi.fn();

    handler(req, res, next);
    await new Promise(r => setImmediate(r));

    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards rejections via next(err) and attaches operation + requestId', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);
    const handler = asyncHandler('op.test', fn);
    const req = makeReq({ requestId: 'req-xyz' } as Partial<Request>);
    const next: NextFunction = vi.fn();

    handler(req, {} as Response, next);
    await new Promise(r => setImmediate(r));

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as Error & {
      operation?: string;
      requestId?: string;
    };
    expect(forwarded).toBe(err);
    expect(forwarded.operation).toBe('op.test');
    expect(forwarded.requestId).toBe('req-xyz');
  });

  it('does not overwrite a pre-existing operation label', async () => {
    const err = new Error('boom') as Error & { operation?: string };
    err.operation = 'inner.op';
    const handler = asyncHandler('outer.op', () => Promise.reject(err));
    const next: NextFunction = vi.fn();

    handler(makeReq(), {} as Response, next);
    await new Promise(r => setImmediate(r));

    const forwarded = (next as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as Error & { operation?: string };
    expect(forwarded.operation).toBe('inner.op');
  });

  it('does not attach requestId when none is present on req', async () => {
    const err = new Error('boom');
    const handler = asyncHandler('op.x', () => Promise.reject(err));
    const next: NextFunction = vi.fn();

    handler(makeReq(), {} as Response, next);
    await new Promise(r => setImmediate(r));

    const forwarded = (next as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as Error & { requestId?: string };
    expect(forwarded.requestId).toBeUndefined();
  });

  it('forwards non-Error rejections unchanged', async () => {
    const handler = asyncHandler('op.weird', () => Promise.reject('plain'));
    const next: NextFunction = vi.fn();

    handler(makeReq(), {} as Response, next);
    await new Promise(r => setImmediate(r));

    expect(next).toHaveBeenCalledWith('plain');
  });

  it('supports synchronous handlers that return a value', async () => {
    const fn = vi.fn().mockReturnValue(42);
    const handler = asyncHandler('op.sync', fn);
    const next: NextFunction = vi.fn();

    handler(makeReq(), {} as Response, next);
    await new Promise(r => setImmediate(r));

    expect(fn).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('catches synchronous throws inside the handler', async () => {
    const handler = asyncHandler('op.sync.throw', () => {
      throw new Error('sync-boom');
    });
    const next: NextFunction = vi.fn();

    handler(makeReq(), {} as Response, next);
    await new Promise(r => setImmediate(r));

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as Error;
    expect(forwarded.message).toBe('sync-boom');
  });
});
