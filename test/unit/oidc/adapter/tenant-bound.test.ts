import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';
import { createTenantBoundAdapterFactory } from '../../../../src/oidc/adapter/tenant-bound.js';

describe('createTenantBoundAdapterFactory', () => {
  afterEach(() => {
    tenantContext.disableStrictMode();
  });

  it('keeps deferred adapter work inside the provider tenant context', async () => {
    tenantContext.enableStrictMode();
    const find = vi.fn(async () => {
      await Promise.resolve();
      return { tenantId: tenantContext.getTenantId() };
    });
    const delegateFactory = vi.fn(() => ({ find }));
    const logger = { error: vi.fn() } as unknown as ILogger;

    const adapter = createTenantBoundAdapterFactory(
      delegateFactory as never,
      'acme',
      logger
    )('Session');

    await expect(adapter.find('session-id')).resolves.toEqual({
      tenantId: 'acme',
    });
    expect(delegateFactory).toHaveBeenCalledWith('Session');
    expect(find).toHaveBeenCalledWith('session-id');
  });
});
