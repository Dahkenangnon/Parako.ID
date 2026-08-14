import type { SessionDocument } from '../../oidc/interfaces/interface.js';

/**
 * Sends best-effort OpenID Connect back-channel logout notifications for a
 * persisted OP session before that session is removed administratively.
 */
export interface IOIDCBackchannelLogoutService {
  notifySessionRevocation(
    session: SessionDocument,
    tenantId: string
  ): Promise<void>;
}
