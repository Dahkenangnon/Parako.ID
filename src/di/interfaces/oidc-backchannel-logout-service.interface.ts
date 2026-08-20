import type { OidcAdminDocument } from '../../oidc/adapter/admin.contract.js';

/**
 * Sends best-effort OpenID Connect back-channel logout notifications for a
 * persisted OP session before that session is removed administratively.
 */
export interface IOIDCBackchannelLogoutService {
  notifySessionRevocation(
    session: OidcAdminDocument,
    tenantId: string
  ): Promise<void>;
}
