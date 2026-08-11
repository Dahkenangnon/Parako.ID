import type { ErrorRequestHandler } from 'express';

import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import { GuardError } from '../utils/guard-error.js';
import { flashAndRedirect } from '../utils/flash-redirect.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { isShuttingDown } from '../utils/shutdown.js';

/**
 * Express error-handling middleware (4-arg) for non-API routes.
 *
 * Behaviour by error class:
 *   - `GuardError` with `redirectTo`: issues `flashAndRedirect`.
 *   - `GuardError` without `redirectTo`: renders the matching
 *     `error/4xx.njk` view at the carried HTTP status.
 *   - Any other error: renders `error/500.njk` and logs at error level.
 *
 * During graceful shutdown (`isShuttingDown()`), unhandled errors map
 * to a 503 response rather than 500 so upstream proxies and orchestrators
 * see the readiness signal even when a request error fires mid-drain.
 */
export interface HtmlErrorHandlerDeps {
  logger: ILogger;
  viewResolver: IViewResolver;
  sessionManager: Pick<ISessionManager, 'flash'>;
}

export function createHtmlErrorHandler(
  deps: HtmlErrorHandlerDeps
): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof GuardError) {
      if (err.redirectTo && err.flashMessage) {
        try {
          flashAndRedirect(
            deps,
            req,
            res,
            err.flashLevel,
            err.flashMessage,
            err.redirectTo
          );
          return;
        } catch (redirectErr) {
          deps.logger.error(redirectErr as Error, {
            url: req.originalUrl,
            context: 'guard_error_redirect_failed',
          });
          // Falls through to the generic render path below.
        }
      }

      const viewKey = guardViewKeyFor(err.status, deps.viewResolver);
      res.status(err.status).render(viewKey, {
        title: titleFor(err.status),
        message: err.message,
        url: req.path,
      });
      return;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    deps.logger.error(error, {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      errorName: error.name,
      errorMessage: error.message,
      context: 'html_unhandled_error',
    });

    if (isShuttingDown()) {
      res
        .status(503)
        .setHeader('Retry-After', '5')
        .render(deps.viewResolver.views.errors.server_error, {
          title: res.locals.app?.title || 'Service Unavailable',
          t: res.locals.t || ((key: string) => key),
        });
      return;
    }

    res.status(500).render(deps.viewResolver.views.errors.server_error, {
      title: res.locals.app?.title || 'Error',
      t: res.locals.t || ((key: string) => key),
    });
  };
}

function guardViewKeyFor(
  status: 401 | 403 | 404,
  viewResolver: IViewResolver
): string {
  switch (status) {
    case 401:
      return viewResolver.views.errors.unauthorized;
    case 403:
      return viewResolver.views.errors.forbidden;
    case 404:
      return viewResolver.views.errors.notfound;
  }
}

function titleFor(status: 401 | 403 | 404): string {
  switch (status) {
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
  }
}
