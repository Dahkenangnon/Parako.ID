/**
 * API audit logging middleware for the Parako.ID Management API v1.
 *
 * Logs every API request to the ActivityService after the response has been
 * sent, capturing method, path, status code, response time, and the
 * authenticated client identity (when present).
 */

import type { RequestHandler } from 'express';

import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';

/** Subset of application services required by the audit logger middleware. */
export interface AuditLoggerDependencies {
  activityService: Pick<IActivityService, 'info'>;
  logger: Pick<ILogger, 'debug' | 'warn'>;
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
    const method = req.method;
    const path = req.path;
    const ipAddress = req.ip;
    const userAgent = req.get('user-agent');
    const clientId = req.apiAuth?.client_id;
    const scope = req.apiAuth?.scope;
    let recorded = false;

    const recordActivity = (completion: 'finished' | 'aborted'): void => {
      if (recorded) return;
      recorded = true;

      const duration = Math.max(0, Date.now() - startTime);
      const logContext = {
        method,
        path,
        status: res.statusCode,
        client_id: clientId,
      };

      try {
        deps.activityService.info(
          'api_request',
          `${method} ${path} ${res.statusCode}`,
          null, // no user — client_credentials call
          {
            ip_address: ipAddress,
            user_agent: userAgent,
            client_id: clientId,
            actor:
              clientId !== undefined
                ? {
                    actor_type: 'service',
                    id: clientId,
                  }
                : undefined,
            target: {
              target_type: 'system',
              entity_name: 'management_api_request',
              entity_data: {
                method,
                path,
                status_code: res.statusCode,
                duration_ms: duration,
                scope,
                completion,
              },
            },
          }
        );
      } catch {
        deps.logger.warn('Failed to record API audit activity', logContext);
      }

      deps.logger.debug('API request completed', {
        ...logContext,
        duration,
      });
    };

    res.on('finish', () => recordActivity('finished'));
    res.on('close', () => recordActivity('aborted'));

    next();
  };
}
