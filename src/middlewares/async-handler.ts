import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async Express route handler so any rejection is forwarded to
 * the global error middleware via `next(err)`. `operationName` is
 * attached to the error so the downstream Pino log line carries an
 * `(operation, requestId)` tuple alongside whatever context the error
 * itself already provides.
 *
 * Intended for application controllers, not for `node-oidc-provider`
 * flow handlers — those are mounted by the provider and have their own
 * error chain that emits the spec-mandated OAuth/OIDC error response.
 */
export type AsyncRouteHandler<
  Req extends Request = Request,
  Res extends Response = Response,
> = (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown;

export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(operationName: string, fn: AsyncRouteHandler<Req, Res>): RequestHandler {
  return (req, res, next): void => {
    Promise.resolve()
      .then(() => fn(req as Req, res as Res, next))
      .catch((err: unknown) => {
        if (err instanceof Error) {
          const enriched = err as Error & {
            operation?: string;
            requestId?: string;
          };
          if (enriched.operation === undefined) {
            enriched.operation = operationName;
          }
          if (
            enriched.requestId === undefined &&
            (req as Request & { requestId?: string }).requestId
          ) {
            enriched.requestId = (
              req as Request & { requestId?: string }
            ).requestId;
          }
        }

        next(err);
      });
  };
}
