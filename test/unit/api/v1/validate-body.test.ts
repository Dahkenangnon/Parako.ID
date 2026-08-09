/**
 * Tests for the API v1 validateBody middleware.
 *
 * Verifies that:
 *  - On success, req.body is replaced by the parsed (typed) value and
 *    next() is called with no argument.
 *  - On failure, next(err) is invoked with an ApiError(422) carrying an
 *    `errors[]` array shaped as the RFC 9457 Problem Detail extension
 *    used elsewhere by the API.
 *
 * Reference: https://datatracker.ietf.org/doc/rfc9457/
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateBody } from '../../../../src/api/v1/middleware/validate-body.middleware.js';
import { ApiError } from '../../../../src/api/v1/errors.js';

function makeReq(body: unknown): Request {
  return { body, originalUrl: '/test' } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  });

  it('replaces req.body with the parsed value and calls next()', () => {
    const middleware = validateBody(schema);
    const req = makeReq({ name: 'Ada', age: 36 });
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, makeRes(), next);

    expect(req.body).toEqual({ name: 'Ada', age: 36 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes an ApiError(422) to next when validation fails', () => {
    const middleware = validateBody(schema);
    const req = makeReq({ name: '', age: -1 });
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    const body = (err as ApiError).toJSON();
    expect(body.title).toBe('Validation Error');
    expect(Array.isArray((body as { errors?: unknown }).errors)).toBe(true);
    const errors = (body as unknown as { errors: Array<{ field: string }> })
      .errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(errors.some(e => e.field === 'age')).toBe(true);
  });

  it('handles missing body as a top-level error', () => {
    const middleware = validateBody(schema);
    const req = makeReq(undefined);
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).toJSON()).toMatchObject({
      instance: '/test',
      errors: [{ field: '(root)' }],
    });
  });

  it('uses transformed output and removes properties outside the schema', () => {
    const middleware = validateBody(
      z.object({
        name: z.string().trim(),
        age: z.coerce.number().int(),
      })
    );
    const req = makeReq({ name: '  Ada  ', age: '36', isAdmin: true });
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, makeRes(), next);

    expect(req.body).toEqual({ name: 'Ada', age: 36 });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('reports every nested issue without exposing rejected input values', () => {
    const middleware = validateBody(
      z.object({
        users: z.array(
          z.object({
            email: z.email(),
            displayName: z.string().min(2),
          })
        ),
      })
    );
    const rejectedEmail = 'private-invalid-email';
    const req = makeReq({
      users: [{ email: rejectedEmail, displayName: '' }],
    });
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, makeRes(), next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as ApiError;
    const body = err.toJSON() as unknown as {
      errors: Array<{ field: string; message: string }>;
    };
    expect(body.errors.map(error => error.field)).toEqual([
      'users.0.email',
      'users.0.displayName',
    ]);
    expect(JSON.stringify(body)).not.toContain(rejectedEmail);
  });

  it('forwards unexpected schema failures and leaves the body untouched', () => {
    const schemaFailure = new Error('schema implementation failed');
    const failingSchema = {
      safeParse: vi.fn(() => {
        throw schemaFailure;
      }),
    } as unknown as z.ZodType<unknown>;
    const middleware = validateBody(failingSchema);
    const originalBody = { name: 'Ada' };
    const req = makeReq(originalBody);
    const next = vi.fn() as unknown as NextFunction;

    expect(() => middleware(req, makeRes(), next)).not.toThrow();
    expect(req.body).toBe(originalBody);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(schemaFailure);
  });
});
