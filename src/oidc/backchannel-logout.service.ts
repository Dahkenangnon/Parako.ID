import { inject, injectable } from 'inversify';
import type { Client } from 'oidc-provider';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IOIDCBackchannelLogoutService } from '../di/interfaces/oidc-backchannel-logout-service.interface.js';
import type { IProviderService } from '../di/interfaces/provider-service.interface.js';
import { TYPES } from '../di/types.js';
import type { OidcAdminDocument } from './adapter/admin.contract.js';

type BackchannelLogoutClient = Client & {
  backchannelLogout?: (accountId: string, sid: string) => Promise<void>;
};

interface LogoutTarget {
  clientId: string;
  sid: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logoutTargets(authorizations: unknown): LogoutTarget[] {
  if (!isRecord(authorizations)) return [];

  return Object.entries(authorizations).flatMap(([clientId, authorization]) => {
    if (!nonEmptyString(clientId) || !isRecord(authorization)) return [];
    const sid = authorization.sid;
    return nonEmptyString(sid) ? [{ clientId, sid }] : [];
  });
}

/**
 * Mirrors oidc-provider's best-effort back-channel notification behavior for
 * administrative session revocation. The provider owns logout-token creation
 * and signing; Parako only selects the tenant, account, client, and stored sid.
 */
@injectable()
export class OIDCBackchannelLogoutService implements IOIDCBackchannelLogoutService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.ProviderService)
    private readonly providerService: IProviderService
  ) {}

  public async notifySessionRevocation(
    session: OidcAdminDocument,
    tenantId: string
  ): Promise<void> {
    if (
      !this.configManager.getConfig().features.oidc.backchannel_logout.enabled
    ) {
      return;
    }

    const accountId = session?.payload?.accountId;
    const targets = logoutTargets(session?.payload?.authorizations);
    if (!nonEmptyString(accountId) || targets.length === 0) return;

    let provider;
    try {
      provider = await this.providerService.getProviderForTenant(tenantId);
    } catch (error) {
      this.logger.warn('OIDC back-channel logout provider unavailable', {
        tenantId,
        accountId,
        error: errorMessage(error),
      });
      return;
    }

    await Promise.all(
      targets.map(async ({ clientId, sid }) => {
        try {
          const client = (await provider.Client.find(clientId)) as
            BackchannelLogoutClient | undefined;
          if (
            !client?.backchannelLogoutUri ||
            typeof client.backchannelLogout !== 'function'
          ) {
            return;
          }

          await client.backchannelLogout(accountId, sid);
          this.logger.info('OIDC back-channel logout notification sent', {
            tenantId,
            clientId,
            accountId,
            sid,
          });
        } catch (error) {
          this.logger.warn('OIDC back-channel logout notification failed', {
            tenantId,
            clientId,
            accountId,
            sid,
            error: errorMessage(error),
          });
        }
      })
    );
  }
}
