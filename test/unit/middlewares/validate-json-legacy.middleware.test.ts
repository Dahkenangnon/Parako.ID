import type { Request, Response } from 'express';
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import {
  GENERIC_LEGACY_JSON_ERROR,
  validateLegacyJsonBody,
  validateLegacyJsonParams,
} from '../../../src/middlewares/validate-json-legacy.middleware.js';

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    originalUrl: '/webauthn/register',
    method: 'POST',
    ...overrides,
  } as unknown as Request;
}

function buildRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  return Object.assign(res, { _status: status, _json: json });
}

const deps = { logger: { info: vi.fn() } };

describe('validateLegacyJsonBody', () => {
  it('on success: replaces req.body with the parsed value and calls next()', () => {
    const schema = z.object({ friendly_name: z.string().min(1) });
    const req = buildReq({ body: { friendly_name: 'iPhone', dropped: 1 } });
    const res = buildRes();
    const next = vi.fn();

    validateLegacyJsonBody(schema, deps)(req, res, next);

    expect(req.body).toEqual({ friendly_name: 'iPhone' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('on failure: responds 400 with { success:false, error, details } legacy shape', () => {
    const schema = z.object({
      friendly_name: z.string().min(1, 'Friendly name is required'),
    });
    const req = buildReq({ body: { friendly_name: '' } });
    const res = buildRes();
    const next = vi.fn();

    validateLegacyJsonBody(schema, deps)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toBe(GENERIC_LEGACY_JSON_ERROR);
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details[0].field).toBe('friendly_name');
    expect(typeof body.details[0].message).toBe('string');
    expect(next).not.toHaveBeenCalled();
  });

  it('error string never embeds the field path or the raw Zod message', () => {
    const schema = z.object({ secret_value: z.string().min(20) });
    const req = buildReq({ body: { secret_value: 'too short' } });
    const res = buildRes();

    validateLegacyJsonBody(schema, deps)(req, res, vi.fn());

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error).toBe(GENERIC_LEGACY_JSON_ERROR);
    expect(body.error).not.toContain('secret_value');
  });

  it('logs the issues server-side at info level', () => {
    const localLogger = { info: vi.fn() };
    const schema = z.object({ x: z.string() });
    const req = buildReq({ body: { x: 42 } });

    validateLegacyJsonBody(schema, { logger: localLogger })(
      req,
      buildRes(),
      vi.fn()
    );

    expect(localLogger.info).toHaveBeenCalledOnce();
    const meta = (localLogger.info.mock.calls[0] as [string, unknown])[1] as {
      issues: { field: string }[];
    };
    expect(meta.issues[0].field).toBe('x');
  });
});

describe('validateLegacyJsonParams', () => {
  it('on success: replaces req.params with the parsed value', () => {
    const schema = z.object({ credentialId: z.string().min(1) });
    const req = buildReq({ params: { credentialId: 'cred-1' } });
    const next = vi.fn();
    const res = buildRes();

    validateLegacyJsonParams(schema, deps)(req, res, next);

    expect(req.params).toEqual({ credentialId: 'cred-1' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('shadows an inherited Express 5 params getter with stripped parsed data', () => {
    const prototype = {};
    Object.defineProperty(prototype, 'params', {
      configurable: true,
      get: () => ({ credentialId: 'cred-1', dropped: 'not-allowed' }),
    });
    const req = Object.assign(Object.create(prototype), {
      body: {},
      originalUrl: '/webauthn/credentials/cred-1',
      method: 'DELETE',
    }) as Request;
    const next = vi.fn();

    validateLegacyJsonParams(
      z.object({ credentialId: z.string().min(1) }),
      deps
    )(req, buildRes(), next);

    expect(Object.hasOwn(req, 'params')).toBe(true);
    expect(req.params).toEqual({ credentialId: 'cred-1' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('on failure: responds with the legacy JSON shape', () => {
    const schema = z.object({ credentialId: z.string().min(1) });
    const req = buildReq({ params: { credentialId: '' } });
    const res = buildRes();

    validateLegacyJsonParams(schema, deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toBe(GENERIC_LEGACY_JSON_ERROR);
    expect(body.details[0].field).toBe('credentialId');
  });
});
