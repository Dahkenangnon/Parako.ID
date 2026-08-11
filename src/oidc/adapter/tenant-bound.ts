import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { AdapterFactory } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import { tenantContext } from '../../multi-tenancy/tenant-context.js';
import type { OIDCPayload } from '../interfaces/interface.js';
import BaseOIDCAdapter from './base.js';

/**
 * Delegate an oidc-provider adapter while re-entering its Provider tenant.
 *
 * oidc-provider is allowed to execute adapter work from its own asynchronous
 * chains, which do not necessarily retain the surrounding Express request
 * AsyncLocalStorage store. A Provider is tenant-specific, so binding its
 * adapter at construction is both deterministic and safer than ambient lookup.
 */
class TenantBoundOIDCAdapter extends BaseOIDCAdapter {
  constructor(
    modelName: string,
    private readonly delegate: BaseOIDCAdapter,
    private readonly tenantId: string,
    logger: ILogger
  ) {
    super(modelName, logger);
  }

  private withinTenant<T>(operation: () => Promise<T>): Promise<T> {
    // Await inside run(): returning a lazy database promise would defer its
    // execution until after AsyncLocalStorage.run() has already completed.
    return tenantContext.run(this.tenantId, async () => await operation());
  }

  upsert(id: string, payload: OIDCPayload, expiresIn?: number): Promise<void> {
    return this.withinTenant(() =>
      this.delegate.upsert(id, payload, expiresIn)
    );
  }

  find(id: string): Promise<OIDCPayload | undefined> {
    return this.withinTenant(() => this.delegate.find(id));
  }

  findAll(): Promise<OIDCPayload[]> {
    return this.withinTenant(() => this.delegate.findAll());
  }

  findByUserCode(userCode: string): Promise<OIDCPayload | undefined> {
    return this.withinTenant(() => this.delegate.findByUserCode(userCode));
  }

  findByUid(uid: string): Promise<OIDCPayload | undefined> {
    return this.withinTenant(() => this.delegate.findByUid(uid));
  }

  consume(id: string): Promise<void> {
    return this.withinTenant(() => this.delegate.consume(id));
  }

  destroy(id: string): Promise<void> {
    return this.withinTenant(() => this.delegate.destroy(id));
  }

  revokeByGrantId(grantId: string): Promise<void> {
    return this.withinTenant(() => this.delegate.revokeByGrantId(grantId));
  }
}

export function createTenantBoundAdapterFactory(
  delegateFactory: AdapterFactory,
  tenantId: string,
  logger: ILogger
): AdapterFactory {
  return modelName =>
    new TenantBoundOIDCAdapter(
      modelName,
      delegateFactory(modelName),
      tenantId,
      logger
    );
}
