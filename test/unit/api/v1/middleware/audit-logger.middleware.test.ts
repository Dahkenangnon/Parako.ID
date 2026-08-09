import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createApiAuditLogger,
  type AuditLoggerDependencies,
} from '../../../../../src/api/v1/middleware/audit-logger.middleware.js';

// Helpers

function createMockReqRes() {
  const responseCallbacks = new Map<string, () => void>();

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
      responseCallbacks.set(event, cb);
    }),
  };

  return {
    req,
    res,
    triggerFinish: () => responseCallbacks.get('finish')?.(),
    triggerClose: () => responseCallbacks.get('close')?.(),
  };
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
      warn: vi.fn(),
    },
    ...overrides,
  };
}

// Tests

describe('api/v1/middleware/audit-logger', () => {
  let deps: AuditLoggerDependencies;

  beforeEach(() => {
    deps = createDeps();
  });

  // 1. Calls next() immediately
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

  // 2. Logs activity on response finish
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

  // 3. Activity includes request details in the persisted target payload
  it('stores method, path, status, duration, and scope in target.entity_data', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();

    const call = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const options = call[3] as Record<string, unknown>;
    const target = options.target as {
      target_type: string;
      entity_name: string;
      entity_data: Record<string, unknown>;
    };

    expect(target).toMatchObject({
      target_type: 'system',
      entity_name: 'management_api_request',
    });
    expect(target.entity_data).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/users',
        status_code: 200,
        scope: 'parako:users:read',
      })
    );
    expect(typeof target.entity_data.duration_ms).toBe('number');
    expect(target.entity_data.duration_ms).toBeGreaterThanOrEqual(0);
    expect(options).not.toHaveProperty('metadata');
  });

  // 4. Handles missing req.apiAuth
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

  // 5. Actor set correctly when auth is present
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

  // 6. Logs debug message on finish
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

  it('does not throw when the audit sink fails after the response finishes', () => {
    const auditFailure = new Error('audit sink unavailable');
    deps.activityService.info = vi.fn(() => {
      throw auditFailure;
    });
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(triggerFinish).not.toThrow();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Failed to record API audit activity',
      {
        method: 'GET',
        path: '/api/v1/users',
        status: 200,
        client_id: 'test-client',
      }
    );
    expect(deps.logger.debug).toHaveBeenCalledWith(
      'API request completed',
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/users',
        status: 200,
      })
    );
  });

  it('records an aborted request when the response closes before finishing', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerClose } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerClose();

    expect(deps.activityService.info).toHaveBeenCalledOnce();
    const options = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0][3] as {
      target: { entity_data: Record<string, unknown> };
    };
    expect(options.target.entity_data.completion).toBe('aborted');
  });

  it('records only once when close follows a normal finish event', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish, triggerClose } = createMockReqRes();
    const next = vi.fn();

    middleware(req, res, next);
    triggerFinish();
    triggerClose();

    expect(deps.activityService.info).toHaveBeenCalledOnce();
    const options = (deps.activityService.info as ReturnType<typeof vi.fn>).mock
      .calls[0][3] as {
      target: { entity_data: Record<string, unknown> };
    };
    expect(options.target.entity_data.completion).toBe('finished');
  });

  it('uses the authenticated identity captured before downstream handlers run', () => {
    const middleware = createApiAuditLogger(deps);
    const { req, res, triggerFinish } = createMockReqRes();
    const next = vi.fn(() => {
      req.apiAuth.client_id = 'tampered-client';
      req.apiAuth.scope = 'parako:platform:write';
      req.method = 'DELETE';
      req.path = '/api/v1/tampered';
    });

    middleware(req, res, next);
    triggerFinish();

    expect(deps.activityService.info).toHaveBeenCalledWith(
      'api_request',
      'GET /api/v1/users 200',
      null,
      expect.objectContaining({
        client_id: 'test-client',
        actor: {
          actor_type: 'service',
          actor_id: 'test-client',
        },
        target: expect.objectContaining({
          entity_data: expect.objectContaining({
            method: 'GET',
            path: '/api/v1/users',
            scope: 'parako:users:read',
          }),
        }),
      })
    );
  });
});
