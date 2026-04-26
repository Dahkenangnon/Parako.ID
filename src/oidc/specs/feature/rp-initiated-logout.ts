import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import { KoaContextWithOIDC } from 'oidc-provider';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
/**
 * Factory function to create RP-initiated logout configuration
 * @param configManager - Configuration manager instance
 * @param oidcUtils - OIDC utilities instance
 * @param viewResolver - View resolver instance
 * @returns RP-initiated logout configuration object
 */
export default function RpInitiatedLogout(
  configManager: IConfigManager,
  oidcUtils: IOIDCUtils,
  viewResolver: IViewResolver
) {
  const config = configManager.getConfig();

  return {
    enabled: config.features.oidc.rp_initiated_logout.enabled,

    // HTML source rendered when RP-Initiated Logout renders a confirmation prompt for the User-Agent.
    logoutSource: async (ctx: KoaContextWithOIDC, form: string) => {
      // @param ctx - koa request context
      // @param form - form source (id="op.logoutForm") to be embedded in the page and submitted by
      //   the End-User

      const { clientName, logoUri, policyUri, tosUri } = ctx.oidc.client || {}; // client is defined if the user chose to stay logged in with the OP

      const currentYear = new Date().getFullYear();

      const locale = oidcUtils.getLocale(ctx);

      await ctx.render(viewResolver.views.auth.oidc.logout, {
        form,
        clientName,
        logoUri,
        policyUri,
        tosUri,
        locale,
        currentYear,
        title: ctx.t ? ctx.t('oidc.logout.confirm_title') : 'Confirm Logout',
      });
    },

    // HTML source rendered when RP-Initiated Logout concludes a logout but there was no post_logout_redirect_uri provided by the client.
    postLogoutSuccessSource: async (ctx: KoaContextWithOIDC) => {
      const {
        clientName,
        clientUri,
        initiateLoginUri,
        logoUri,
        policyUri,
        tosUri,
      } = ctx.oidc.client || {}; // client is defined if the user chose to stay logged in with the OP

      const currentYear = new Date().getFullYear();

      const locale = oidcUtils.getLocale(ctx);

      await ctx.render(viewResolver.views.auth.oidc.logout_success, {
        clientName,
        logoUri,
        policyUri,
        tosUri,
        clientUri,
        initiateLoginUri,
        locale,
        currentYear,
        title: ctx.t ? ctx.t('oidc.logout.title') : 'Logged Out',
      });
    },
  };
}
