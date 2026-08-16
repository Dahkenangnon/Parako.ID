import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/** Maps Parako's configured endpoint paths to `oidc-provider` routes. */
export default function Routes(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    authorization: config.oidc.routes.authorization,
    userinfo: config.oidc.routes.userinfo,
    registration: config.oidc.routes.registration,
    backchannel_authentication: config.oidc.routes.backchannel_authentication,
    challenge: config.oidc.routes.challenge,
    code_verification: config.oidc.routes.code_verification,
    device_authorization: config.oidc.routes.device_authorization,
    end_session: config.oidc.routes.end_session,
    introspection: config.oidc.routes.introspection,
    jwks: config.oidc.routes.jwks,
    pushed_authorization_request:
      config.oidc.routes.pushed_authorization_request,
    revocation: config.oidc.routes.revocation,
    token: config.oidc.routes.token,
  };
}
