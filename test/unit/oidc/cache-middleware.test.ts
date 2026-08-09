import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { setNoCache } from '../../../src/oidc/flows/middleware/cache.middleware.js';

describe('setNoCache', () => {
  it('disables response storage before delegating to the next middleware', () => {
    const order: string[] = [];
    const response = {
      set: vi.fn(() => {
        order.push('set');
      }),
    } as unknown as Response;
    const next = vi.fn(() => {
      order.push('next');
    }) as NextFunction;

    setNoCache({} as Request, response, next);

    expect(response.set).toHaveBeenCalledOnce();
    expect(response.set).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(next).toHaveBeenCalledOnce();
    expect(order).toEqual(['set', 'next']);
  });

  it('propagates response-header failures without advancing the chain', () => {
    const headerError = new Error('response already sent');
    const response = {
      set: vi.fn(() => {
        throw headerError;
      }),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    expect(() => setNoCache({} as Request, response, next)).toThrow(
      headerError
    );
    expect(next).not.toHaveBeenCalled();
  });
});
