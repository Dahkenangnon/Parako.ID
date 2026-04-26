/**
 * API audit logging middleware for the Parako.ID Management API v1.
 *
 * Logs every API request to the ActivityService after the response has been
 * sent, capturing method, path, status code, response time, and the
 * authenticated client identity (when present).
 */

import type { RequestHandler } from 'express';

/** Subset of application services required by the audit logger middleware. */
export interface AuditLoggerDependencies {
  activityService: {
    info(
      type: string,
      description: string,
      user: { username: string } | null,
      options?: {
        ip_address?: string;
        user_agent?: string;
        client_id?: string;
        metadata?: Record<string, unknown>;
        actor?: { actor_type: string; actor_id: string };
      }
    ): void;
  };
  logger: {
    debug(message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Create an Express middleware that logs API requests to the ActivityService.
 *
 * The log entry is emitted asynchronously on the response `finish` event so
 * it never blocks the request pipeline. The middleware calls `next()`
 * immediately and records timing from the moment the request enters the
 * middleware until the response finishes.
 */
export function createApiAuditLogger(
  deps: AuditLoggerDependencies
): RequestHandler {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const apiAuth = req.apiAuth;

      deps.activityService.info(
        'api_request',
        `${req.method} ${req.path} ${res.statusCode}`,
        null, // no user — client_credentials call
        {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
          client_id: apiAuth?.client_id,
          metadata: {
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
            duration_ms: duration,
            scope: apiAuth?.scope,
          },
          actor: apiAuth
            ? {
                actor_type: 'service',
                actor_id: apiAuth.client_id,
              }
            : undefined,
        }
      );

      deps.logger.debug('API request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        client_id: apiAuth?.client_id,
      });
    });

    next();
  };
}
