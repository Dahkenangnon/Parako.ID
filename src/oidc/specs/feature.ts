import deviceFlow from './feature/device-flow.js';
import rpInitiatedLogoutFactory from './feature/rp-initiated-logout.js';
import registrationManagement from './feature/registration-management.js';
import registrationFactory from './feature/registration.js';
import jwtIntrospection from './feature/jwt-introspection.js';
import introspection from './feature/introspection.js';
import userinfoFactory from './feature/user-info.js';
import clientCredentials from './feature/client-credential.js';
import revocationFactory from './feature/revocation.js';
import backchannelLogoutFactory from './feature/backchannel-logout.js';
import devInteractions from './feature/dev-interaction.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IViewResolver } from '../../di/interfaces/view-resolver.interface.js';
import type { IOIDCUtils } from '../../di/interfaces/oidc-utils.interface.js';

/**
 * OIDC Provider Features Configuration
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#features}
 *
 * Enable/disable features. Some features are still either based on draft or experimental RFCs.
 * Enabling those will produce a warning in your console and you must be aware that breaking
 * changes may occur between draft implementations and that those will be published as minor
 * versions of oidc-provider.
 *
 * Available Features:
 * - devInteractions: Development interaction views for testing and development purposes
 * - deviceFlow: Device Authorization Grant for devices with limited input capabilities
 * - revocation: Token Revocation for revoking access and refresh tokens
 * - clientCredentials: Client Credentials Grant for machine-to-machine authentication
 * - userinfo: UserInfo Endpoint for retrieving user information
 * - encryption: JWT Response Encryption for securing sensitive data
 * - introspection: Token Introspection for validating tokens
 * - resourceIndicators: Resource Indicators for specifying target resources
 * - jwtIntrospection: JWT Response for Introspection
 * - registration: Dynamic Client Registration for registering clients at runtime
 * - registrationManagement: Client Registration Management for updating client configurations
 * - rpInitiatedLogout: RP-Initiated Logout for ending user sessions
 *
 * @type {Object} Features configuration object
 */

/**
 * Factory function to create OIDC Provider Features Configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @param viewResolver - View resolver instance
 * @param oidcUtils - OIDC utilities instance
 * @param resourceIndicators - Pre-built resource indicators configuration
 * @returns OIDC Provider Features configuration object
 */
export default function createFeatures(
  configManager: IConfigManager,
  logger: ILogger,
  viewResolver: IViewResolver,
  oidcUtils: IOIDCUtils,
  resourceIndicators: any
) {
  const config = configManager.getConfig();

  const rpInitiatedLogout = rpInitiatedLogoutFactory(
    configManager,
    oidcUtils,
    viewResolver
  );
  const registration = registrationFactory(configManager);
  const userinfo = userinfoFactory(configManager);
  const revocation = revocationFactory(configManager);
  const backchannelLogout = backchannelLogoutFactory(configManager);
  const devInteractionsInstance = devInteractions(configManager);
  const deviceFlowInstance = deviceFlow(configManager, viewResolver, oidcUtils);
  const clientCredentialsInstance = clientCredentials(configManager);
  const introspectionInstance = introspection(configManager);
  const jwtIntrospectionInstance = jwtIntrospection(configManager);
  const registrationManagementInstance = registrationManagement(configManager);

  return {
    /**
     * Development interaction views
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresdevinteractions}
     *
     * Enables development interaction views for testing and development purposes.
     * These views provide a simple interface for testing authentication flows and
     * debugging OIDC interactions. Not recommended for production use.
     */
    devInteractions: devInteractionsInstance,

    /**
     * Device Flow
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresdeviceflow}
     *
     * Enables the Device Flow as defined in RFC 8628. This feature allows devices with limited input capabilities to authenticate and authorize themselves.
     */
    deviceFlow: deviceFlowInstance,

    backchannelLogout,

    /**
     * Token Revocation
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresrevocation}
     *
     * Enables the Token Revocation endpoint as defined in RFC 7009. This feature allows
     * clients to indicate to the authorization server that an access token is no longer
     * needed. This is used to enable a "log out" feature in clients, allowing the
     * authorization server to clean up any security credentials associated with the
     * authorization.
     */
    revocation,

    /**
     * Client Credentials Grant
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresclientcredentials}
     *
     * Enables the Client Credentials grant type as defined in RFC 6749. This grant type
     * is used for machine-to-machine authentication where the client is acting on its
     * own behalf rather than on behalf of a user.
     */
    clientCredentials: clientCredentialsInstance,

    /**
     * UserInfo Endpoint
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresuserinfo}
     *
     * Enables the UserInfo endpoint as defined in OpenID Connect Core 1.0. This endpoint
     * returns claims about the authenticated end-user. The endpoint is protected by the
     * access token and returns claims in a JWT or JSON format.
     */
    userinfo,

    /**
     * Token Introspection
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresintrospection}
     *
     * Enables the Token Introspection endpoint as defined in RFC 7662. This endpoint
     * allows resource servers to validate tokens and get information about them.
     * The endpoint is protected and requires client authentication.
     */
    introspection: introspectionInstance,

    /**
     * Resource Indicators
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresresourceindicators}
     *
     * Enables the Resource Indicators for OAuth 2.0 draft specification (RFC8707). This feature
     * allows clients to specify the target resource server when requesting tokens.
     * The authorization server can then issue tokens specific to that resource server.
     *
     * Key Features:
     * - Clients can request tokens for specific resource servers
     * - Resource servers can be configured with specific scopes and audiences
     * - Access tokens can be restricted to specific resources
     * - Supports both single and multiple resource requests
     *
     * Configuration Options:
     * - enabled: Boolean to enable/disable the feature
     * - defaultResource: Function to select default resource when multiple are requested
     * - useGrantedResource: Function to determine if a resource should be granted
     * - getResourceServerInfo: Function to get resource server configuration
     *
     * Resource Server Configuration:
     * - scope: Space-separated list of scopes available for this resource
     * - audience: The resource server's identifier
     * - accessTokenFormat: Token format for this resource (jwt/opaque)
     *
     * Client Requirements:
     * - allowedResources: Array of resource servers the client can access
     * - resourcesScopes: Space-separated list of scopes for resource access
     *
     * RFC8707 Specifications:
     * 1. Multiple Resource Parameters:
     *    - Allowed in Authorization Code Flow
     *    - Allowed in Device Authorization Grant
     *    - Allowed in Backchannel Authentication Requests
     *    - Only single audience permitted in Access Token
     *
     * 2. Authorization and Authentication Requests:
     *    - Must contain single resource when issuing Access Token
     *    - Or resolved using defaultResource helper
     *
     * 3. Client Credentials Grant:
     *    - Must contain single resource parameter only
     *
     * 4. Token Exchange Rules (without 'openid' scope):
     *    - Single resource: resource parameter may be omitted
     *    - Multiple resources: resource parameter must be provided
     *    - Or resolved using defaultResource helper
     *
     * 5. Token Exchange Rules (with 'openid' scope):
     *    a. UserInfo Endpoint Enabled:
     *       - useGrantedResource returns false: Access Token for UserInfo Endpoint
     *       - useGrantedResource returns true: Access Token for single resource
     *    b. UserInfo Endpoint Disabled:
     *       - Single resource: resource parameter may be omitted
     *       - Access Token for single resource returned
     *
     * 6. Scope Restrictions:
     *    - Access Tokens only contain scopes defined on Resource Server
     *    - Scopes returned from getResourceServerInfo
     *
     * Policies:
     * 1. Resource Server Validation:
     *    - Resource indicators must be valid URIs
     *    - Resource servers must be pre-configured
     *    - Resource servers must have defined scopes and audiences
     *
     * 2. Client Authorization:
     *    - Clients must be explicitly authorized to access resources
     *    - Clients must have appropriate scopes for requested resources
     *    - Clients must have valid resource indicators in their configuration
     *
     * 3. Token Issuance:
     *    - Tokens are issued only for authorized resources
     *    - Tokens contain only authorized scopes for the resource
     *    - Tokens include the resource server's audience
     *
     * 4. Multiple Resource Handling:
     *    - Clients can request multiple resources
     *    - Authorization server can select one or more resources
     *    - Each resource gets its own token with specific scopes
     *
     * 5. Scope Validation:
     *    - Scopes must be valid for the requested resource
     *    - Scopes must be authorized for the client
     *    - Scopes must be within the resource server's allowed scopes
     */
    resourceIndicators,

    /**
     * JWT Response for Introspection
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresjwtintrospection}
     *
     * Enables JWT Response for OAuth 2.0 Token Introspection draft specification.
     * This feature allows the introspection response to be returned as a JWT instead
     * of a JSON object.
     */
    jwtIntrospection: jwtIntrospectionInstance,

    /**
     * Dynamic Client Registration
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresregistration}
     *
     * Enables Dynamic Client Registration as defined in OpenID Connect Dynamic Client
     * Registration 1.0. This feature allows clients to register themselves with the
     * authorization server at runtime. The registration can be protected by an initial
     * access token and can issue registration access tokens for subsequent updates.
     */
    registration,

    /**
     * Client Registration Management
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresregistrationmanagement}
     *
     * Enables the Update and Delete features described in RFC 7592. This feature allows
     * clients to update their registration information and delete their registration
     * using the registration access token.
     */
    registrationManagement: registrationManagementInstance,

    /**
     * RP-Initiated Logout
     *
     * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#featuresrpinitiatedlogout}
     *
     * Enables RP-Initiated Logout as defined in OpenID Connect Session Management 1.0.
     * This feature allows Relying Parties to initiate logout at the OpenID Provider,
     * which can then log the user out of all sessions at all RPs.
     */
    rpInitiatedLogout,

    // Dynamic configuration for encryption and JWT features
    /**
     * Specifies whether encryption capabilities
     * shall be enabled. When enabled, the authorization
     * server shall support accepting and
     * issuing encrypted tokens involved in
     * its other enabled capabilities.
     */
    encryption: {
      enabled: config.features.oidc.encryption.enabled,
    },
    jwtResponseModes: {
      enabled: config.features.oidc.jwt_response_modes.enabled,
    },
    jwtUserinfo: {
      enabled: config.features.oidc.jwt_userinfo.enabled,
    },

    // Request Objects configuration
    requestObjects: {
      enabled: config.features.oidc.request_objects.enabled,
    },
  };
}
