import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IMetricsService } from '../di/interfaces/metrics-service.interface.js';

/** Paths to skip for request logging (static assets, health checks) */
const STATIC_SKIP_PREFIXES = [
  '/css/',
  '/js/',
  '/images/',
  '/fonts/',
  '/favicon',
];
const PROBE_PATHS = ['/health', '/metrics'];

function shouldSkip(path: string): boolean {
  return (
    STATIC_SKIP_PREFIXES.some(prefix => path.startsWith(prefix)) ||
    PROBE_PATHS.some(
      probePath => path === probePath || path.startsWith(`${probePath}/`)
    )
  );
}

const SENSITIVE_QUERY_PARAMETERS = new Set([
  'token',
  'code',
  'id_token',
  'access_token',
  'refresh_token',
  'client_secret',
  'password',
]);
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:@/-]{1,128}$/;

/** Redact bearer credentials before request URLs are written to logs. */
export function redactSensitiveQueryParams(originalUrl: string): string {
  const queryStart = originalUrl.indexOf('?');
  if (queryStart === -1) return originalUrl;

  const fragmentStart = originalUrl.indexOf('#', queryStart + 1);
  const queryEnd = fragmentStart === -1 ? originalUrl.length : fragmentStart;
  const parameters = originalUrl.slice(queryStart + 1, queryEnd).split('&');
  const redactedParameters = parameters.map(segment => {
    const equals = segment.indexOf('=');
    if (equals < 1) return segment;

    const rawParameter = segment.slice(0, equals);
    let parameter: string;
    try {
      parameter = decodeURIComponent(rawParameter.replaceAll('+', ' '));
    } catch {
      return segment;
    }

    return SENSITIVE_QUERY_PARAMETERS.has(parameter.toLowerCase())
      ? `${rawParameter}=[REDACTED]`
      : segment;
  });

  return `${originalUrl.slice(0, queryStart + 1)}${redactedParameters.join('&')}${originalUrl.slice(queryEnd)}`;
}

/**
 * Request logging middleware
 *
 * Lightweight HTTP request logger that hooks into `res.finish` to log
 * completed requests with duration. Does NOT wrap or replace req/res
 * objects (unlike pino-http), ensuring compatibility with OIDC provider
 * sessions and Express middleware chain.
 *
 * Must be mounted early in the middleware stack (before session/OIDC).
 */
@injectable()
export class RequestLoggerMiddleware {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.MetricsService)
    private readonly metricsService: IMetricsService
  ) {}

  /**
   * Express middleware that logs each request on completion.
   * Generates a request ID from the X-Request-ID header or a random value,
   * attaches it to `req.id` and the response header for tracing.
   */
  public handler = (req: Request, res: Response, next: NextFunction): void => {
    if (shouldSkip(req.path)) {
      return next();
    }

    // Use existing request ID from reverse proxy or generate one
    const suppliedRequestId = req.headers['x-request-id'];
    const requestId =
      typeof suppliedRequestId === 'string' &&
      SAFE_REQUEST_ID.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    const startTime = process.hrtime.bigint();

    // Log on response completion — does not interfere with response body
    res.on('finish', () => {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationMs = Math.round(durationNs / 1e6);

      this.metricsService.recordRequestDuration(
        req.method,
        req.route?.path || req.path,
        res.statusCode,
        durationNs / 1e9
      );

      const logData = {
        requestId,
        method: req.method,
        url: redactSensitiveQueryParams(req.originalUrl),
        statusCode: res.statusCode,
        duration: `${durationMs}ms`,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.substring(0, 120),
      };

      if (res.statusCode >= 500) {
        this.logger.error('Request failed', logData);
      } else if (res.statusCode >= 400) {
        this.logger.warn('Request client error', logData);
      } else {
        this.logger.info('Request completed', logData);
      }
    });

    next();
  };
}
