/**
 * Access-control / guard error for HTML routes.
 *
 * Thrown when a controller or middleware detects that the current user
 * may not proceed. Caught by `createHtmlErrorHandler`, which either
 * renders the matching `error/4xx.njk` view or, when `redirectTo` is
 * set, issues a flash + redirect.
 *
 * Scope is intentionally narrow: only authentication / authorisation
 * guard failures throw `GuardError`. Errors that need to keep the user
 * inside a multi-step flow with controller-owned view context use
 * inline `flashAndRedirect` instead.
 */
export type GuardErrorLevel = 'error' | 'warning' | 'info' | 'success';

export interface GuardErrorOptions {
  /** HTTP status — drives which error view is rendered (401/403/404). */
  status: 401 | 403 | 404;
  /**
   * When set, the handler issues `flashAndRedirect(req, res, level,
   * flashMessage, redirectTo)` instead of rendering an error view.
   */
  redirectTo?: string;
  /** Required when `redirectTo` is set; passed verbatim to the flash. */
  flashMessage?: string;
  /** Flash severity; defaults to `'error'`. */
  flashLevel?: GuardErrorLevel;
}

export class GuardError extends Error {
  public readonly status: 401 | 403 | 404;
  public readonly redirectTo: string | undefined;
  public readonly flashMessage: string | undefined;
  public readonly flashLevel: GuardErrorLevel;

  constructor(message: string, options: GuardErrorOptions) {
    super(message);
    this.name = 'GuardError';
    this.status = options.status;
    this.redirectTo = options.redirectTo;
    this.flashMessage = options.flashMessage;
    this.flashLevel = options.flashLevel ?? 'error';
  }
}
