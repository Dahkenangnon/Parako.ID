import type { KoaContextWithOIDC } from 'oidc-provider';
import type { IViewResolver } from '../../di/interfaces/view-resolver.interface.js';
import type { IOIDCUtils } from '../../di/interfaces/oidc-utils.interface.js';

/**
 * Factory function to create error renderer
 * @param viewResolver - View resolver instance
 * @returns Error rendering function
 */
export default function RenderError(
  viewResolver: IViewResolver,
  oidcUtils: IOIDCUtils
) {
  /**
   * Error Rendering Function for OpenID Provider
   *
   * This function is called by the OpenID Provider to present errors to the User-Agent.
   * It handles the rendering of error pages when something goes wrong during the
   * OpenID Connect/OAuth 2.0 flows.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#rendererror}
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context
   * @param {object} out - The error output object containing:
   *   - error {string} - The error code
   *   - error_description {string} - Human-readable error description
   *   - scope {string} - The scope of the error
   *   - client_id {string} - The client identifier
   *   - state {string} - The state parameter from the request
   * @param {Error} error - The error object that was thrown
   * @returns {Promise<void>} A promise that resolves when the error is rendered
   *
   * @example
   * // Example error output object
   * {
   *   error: 'invalid_request',
   *   error_description: 'The request is missing a required parameter',
   *   scope: 'openid profile',
   *   client_id: 'client123',
   *   state: 'xyz123'
   * }
   */
  return async function renderError(
    ctx: KoaContextWithOIDC,
    out: any,
    error: any
  ) {
    const currentYear = new Date().getFullYear();

    const locale = oidcUtils.getLocale(ctx);

    await ctx.render(viewResolver.views.auth.oidc.error, {
      out,
      error,
      locale,
      currentYear,
      title: ctx.t ? ctx.t('oidc.errors.page_title') : 'Error Occurred',
    });
  };
}
