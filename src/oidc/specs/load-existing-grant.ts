import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { Client } from 'oidc-provider';
import type { Grant } from 'oidc-provider';
import type { KoaContextWithOIDC } from 'oidc-provider';

/**
 * Factory function to create grant loading configuration
 * @param logger - Logger instance
 * @returns Grant loading function
 */
export default function LoadExistingGrant(logger: ILogger) {
  /**
   * Grant Loading Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#loadexistinggrant}
   *
   * Helper function used to load existing but also just in time pre-established Grants to attempt
   * to resolve an Authorization Request with. This function is called during the authorization
   * request to determine if there's an existing grant that can be used to skip the consent prompt.
   *
   * The function follows this logic:
   * 1. First checks for a grant ID from the interaction result consent
   * 2. Falls back to the existing grant ID for the client in the current session
   * 3. For internal clients, creates a new grant with requested scopes
   * 4. For other clients, loads and validates the existing grant
   *
   * Note: This is not the default behavior. The default implementation will get you as far as not
   * asking for any consent unless the application is a native application (e.g. iOS, Android, CLI,
   * Device Flow). It is recommended to still show a consent screen to those with the application
   * details since they are public clients and their redirect_uri ownership can rarely be validated.
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context containing the current session, client, and authorization request details
   * @returns {Promise<Grant|undefined>} The loaded or created grant object containing the authorized scopes and claims, or undefined if no grant can be created
   * @throws {Error} If there's an error loading or creating the grant
   */
  return async function loadExistingGrant(ctx: KoaContextWithOIDC) {
    try {
      if (!ctx.oidc.client) {
        return undefined;
      }

      const grantId =
        (ctx.oidc.result &&
          ctx.oidc.result.consent &&
          ctx.oidc.result.consent.grantId) ||
        (ctx.oidc.session &&
          ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId));

      // has isInternalClient property and is true
      if (
        'isInternalClient' in ctx.oidc.client &&
        ctx.oidc.client.isInternalClient
      ) {
        if (!ctx.oidc.session?.accountId) {
          // No account ID in session, can't create a grant
          return undefined;
        }

        const grant = new ctx.oidc.provider.Grant({
          clientId: ctx.oidc.client.clientId,
          accountId: ctx.oidc.session.accountId,
        });

        if (
          ctx.oidc.params?.scope &&
          typeof ctx.oidc.params.scope === 'string'
        ) {
          grant.addOIDCScope(ctx.oidc.params.scope);
        }

        const client = ctx.oidc.client as Client;

        if (ctx.oidc.params?.resource && client.resourcesScopes) {
          const requestedScope =
            typeof ctx.oidc.params.scope === 'string'
              ? ctx.oidc.params.scope
              : '';
          const clientAllowedResourceScope =
            typeof client.resourcesScopes === 'string'
              ? client.resourcesScopes.split(' ')
              : [];

          const scopesList = requestedScope.split(' ').filter(Boolean);
          const resourceServerScope2Add = scopesList.filter(
            (scopeItem: string) => {
              return clientAllowedResourceScope.includes(scopeItem);
            }
          );

          if (resourceServerScope2Add.length > 0) {
            const resource =
              typeof ctx.oidc.params.resource === 'string'
                ? ctx.oidc.params.resource
                : '';

            if (resource) {
              grant.addResourceScope(
                resource,
                resourceServerScope2Add.join(' ')
              );
            }
          }
        }

        await grant.save();
        return grant;
      } else if (grantId) {
        const grant = (await ctx.oidc.provider.Grant.find(grantId)) as
          | Grant
          | undefined;

        // If grant doesn't exist, return undefined
        if (!grant) {
          return undefined;
        }

        // Align grant expiration with session expiration to prevent consent prompts
        // when grant expires before session
        if (
          ctx.oidc.account &&
          ctx.oidc.session &&
          grant.exp !== undefined &&
          ctx.oidc.session.exp !== undefined &&
          grant.exp < ctx.oidc.session.exp
        ) {
          grant.exp = ctx.oidc.session.exp;
          await grant.save();
        }

        return grant;
      }

      // No grant could be created or found
      return undefined;
    } catch (error) {
      // Log the error but don't throw it to prevent authorization flow from breaking
      logger.error('Error in loadExistingGrant:', { error });
      return undefined;
    }
  };
}
