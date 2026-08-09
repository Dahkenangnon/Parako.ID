import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { ApiError } from '../../../../../src/api/v1/errors.js';
import { validateQuery } from '../../../../../src/api/v1/middleware/validate-query.middleware.js';

function createRequest(query: unknown): Request {
  const requestPrototype = {
    get query() {
      return query;
    },
  };
  const req = Object.create(requestPrototype) as Request;
  Object.defineProperty(req, 'originalUrl', {
    configurable: true,
    enumerable: true,
    value: '/api/v1/users?limit=10',
  });
  return req;
}

describe('api/v1/middleware/validateQuery', () => {
  it('replaces the Express query getter with parsed and transformed data', () => {
    const req = createRequest({ limit: '10', ignored: 'value' });
    const next = vi.fn<(error?: unknown) => void>();
    const middleware = validateQuery(
      z.object({ limit: z.coerce.number().int().min(1) })
    );

    middleware(req, {} as Response, next as NextFunction);

    expect(req.query).toEqual({ limit: 10 });
    expect(Object.getOwnPropertyDescriptor(req, 'query')).toMatchObject({
      configurable: true,
      enumerable: true,
      value: { limit: 10 },
      writable: true,
    });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards all nested validation issues as an RFC 9457 ApiError', () => {
    const req = createRequest({ filter: { email: 'invalid', active: 'yes' } });
    const next = vi.fn<(error?: unknown) => void>();
    const middleware = validateQuery(
      z.object({
        filter: z.object({
          active: z.boolean(),
          email: z.email(),
        }),
      })
    );

    middleware(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0]?.[0] as unknown as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.toJSON()).toMatchObject({
      detail: 'Request query failed validation',
      instance: '/api/v1/users?limit=10',
      status: 422,
      title: 'Validation Error',
      type: 'urn:parako:error:validation',
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'filter.active' }),
        expect.objectContaining({ field: 'filter.email' }),
      ]),
    });
    expect(Object.hasOwn(req, 'query')).toBe(false);
  });

  it('labels schema-level validation failures as root issues', () => {
    const req = createRequest({});
    const next = vi.fn<(error?: unknown) => void>();
    const middleware = validateQuery(
      z.object({}).refine(() => false, { message: 'Query is not allowed' })
    );

    middleware(req, {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as unknown as ApiError;
    expect(error.extensions.errors).toEqual([
      { field: '(root)', message: 'Query is not allowed' },
    ]);
  });
});
