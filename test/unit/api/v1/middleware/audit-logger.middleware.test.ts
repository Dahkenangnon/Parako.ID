import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createApiAuditLogger,
  type AuditLoggerDependencies,
} from '../../../../../src/api/v1/middleware/audit-logger.middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReqRes() {
  let finishCallback: (() => void) | null = null;

  const req: any = {
    method: 'GET',
    path: '/api/v1/users',
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-agent'),
    apiAuth: {
      client_id: 'test-client',
      scope: 'parako:users:read',
      iss: '',
      aud: '',
      exp: 0,
      iat: 0,
    },
  };

  const res: any = {
    statusCode: 200,
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') finishCallback = cb;
    }),
  };

  return { req, res, triggerFinish: () => finishCallback?.() };
}

function createDeps(
  overrides: Partial<AuditLoggerDependencies> = {}
): AuditLoggerDependencies {
  return {
    activityService: {
      info: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/middleware/audit-logger', () => {
  let deps: AuditLoggerDependencies;

  beforeEach(() => {
    deps = createDeps();
  });

  // -----------------------------------------------------------------------
  // 1. Calls next() immediately
  // -----------------------------------------------------------------------
  it('should call next() immediately without waiting for finish', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    // Activity service should NOT have been called yet (response not finished)
    expect(deps.activityService.info).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. Logs activity on response finish
  // -----------------------------------------------------------------------
  it('should log activity to activityService on response finish', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    expect(deps.activityService.info).toHaveBeenCalledOnce();
    expect(deps.activityService.info).toHaveBeenCalledWith(
      'api_request',
      'GET /api/v1/users 200',
      null,
      expect.objectContaining({
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        client_id: 'test-client',
      })
    );
  });

  // -----------------------------------------------------------------------
  // 3. Activity includes method, path, status_code, duration_ms, client_id
  // -----------------------------------------------------------------------
  it('should include method, path, status_code, duration_ms, and scope in metadata', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    const call = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const options = call[3] as Record<string, unknown>;
    const metadata = options.metadata as Record<string, unknown>;

    expect(metadata).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/users',
        status_code: 200,
        scope: 'parako:users:read',
      })
    );
    expect(typeof metadata.duration_ms).toBe('number');
    expect(metadata.duration_ms).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // 4. Handles missing req.apiAuth
  // -----------------------------------------------------------------------
  it('should handle missing req.apiAuth — actor should be undefined', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    req.apiAuth = undefined;
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    expect(deps.activityService.info).toHaveBeenCalledOnce();

    const call = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const options = call[3] as Record<string, unknown>;

    expect(options.client_id).toBeUndefined();
    expect(options.actor).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 5. Actor set correctly when auth is present
  // -----------------------------------------------------------------------
  it('should set actor to { actor_type: "service", actor_id: clientId } when auth present', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    const call = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const options = call[3] as Record<string, unknown>;

    expect(options.actor).toEqual({
      actor_type: 'service',
      actor_id: 'test-client',
    });
  });

  // -----------------------------------------------------------------------
  // 6. Logs debug message on finish
  // -----------------------------------------------------------------------
  it('should log a debug message with request details on finish', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    expect(deps.logger.debug).toHaveBeenCalledOnce();
    expect(deps.logger.debug).toHaveBeenCalledWith(
      'API request completed',
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/users',
        status: 200,
        client_id: 'test-client',
      })
    );
  });
});
