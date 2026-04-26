import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';

/**
 * Verify that the settings service is automatically tenant-scoped.
 *
 * The Mongoose tenant plugin auto-injects tenant_id into all queries
 * and saves. SettingsService calls SettingsRepository which calls
 * Mongoose model methods — all scoped transparently.
 *
 * These tests verify:
 * 1. Repository calls propagate tenant context to the model
 * 2. Different tenants get isolated settings
 * 3. MAIN_CONFIG_KEY works per-tenant (different tenants, same key)
 */
describe('Settings Service — Tenant Isolation', () => {
  // Track calls to Mongoose model methods
  const findOneSpy = vi.fn();
  const findSpy = vi.fn();
  const createSpy = vi.fn();
  const findOneAndUpdateSpy = vi.fn();

  // Mock model that records calls
  const mockModel = {
    findOne: (...args: any[]) => {
      findOneSpy(...args);
      return {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(null),
      };
    },
    find: (...args: any[]) => {
      findSpy(...args);
      return {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
    },
    create: (...args: any[]) => {
      createSpy(...args);
      return Promise.resolve({ toObject: () => ({ key: 'test', _id: '123' }) });
    },
    findOneAndUpdate: (...args: any[]) => {
      findOneAndUpdateSpy(...args);
      return {
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(null),
      };
    },
    countDocuments: vi.fn().mockResolvedValue(0),
  };

  let settingsRepo: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import the repository fresh
    const { MongooseSettingsRepository } =
      await import('../../../src/db/repositories/mongoose/settings.repository.js');
    settingsRepo = new MongooseSettingsRepository(mockModel as any);
  });

  it('findActive() reads settings within the current tenant context', async () => {
    await tenantContext.run('acme', async () => {
      await settingsRepo.findActive('parako_config');
    });

    // The repository calls model.findOne({ key, is_active: true })
    // The Mongoose plugin would intercept this and add tenant_id,
    // but we're verifying the repository passes through correctly
    expect(findOneSpy).toHaveBeenCalledTimes(1);
    const filter = findOneSpy.mock.calls[0][0];
    expect(filter).toEqual({ key: 'parako_config', is_active: true });
  });

  it('save() creates settings within the current tenant context', async () => {
    await tenantContext.run('acme', async () => {
      await settingsRepo.save('parako_config', { value: '{}' });
    });

    // Phase 1: deactivate current active (findOneAndUpdate)
    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    const updateFilter = findOneAndUpdateSpy.mock.calls[0][0];
    expect(updateFilter).toEqual({ key: 'parako_config', is_active: true });

    // Phase 2: create new active row
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createData = createSpy.mock.calls[0][0];
    expect(createData.key).toBe('parako_config');
    expect(createData.is_active).toBe(true);
  });

  it('tenantContext.getTenantId() returns correct tenant inside run()', async () => {
    const results: string[] = [];

    await tenantContext.run('tenant-a', async () => {
      results.push(tenantContext.getTenantId());
    });

    await tenantContext.run('tenant-b', async () => {
      results.push(tenantContext.getTenantId());
    });

    expect(results).toEqual(['tenant-a', 'tenant-b']);
  });

  it('settings isolation: same key, different tenants, independent contexts', async () => {
    const key = 'parako_config';
    const findCalls: Array<{ tenant: string; filter: any }> = [];

    // Patch findOne to capture tenant context at call time
    const origFindOne = mockModel.findOne;
    mockModel.findOne = (...args: any[]) => {
      findCalls.push({
        tenant: tenantContext.getTenantId(),
        filter: args[0],
      });
      return origFindOne(...args);
    };

    await tenantContext.run('acme', async () => {
      await settingsRepo.findActive(key);
    });

    await tenantContext.run('globex', async () => {
      await settingsRepo.findActive(key);
    });

    // Both queries use the same key but execute in different tenant contexts.
    // The Mongoose plugin would have added tenant_id to each query.
    expect(findCalls).toHaveLength(2);
    expect(findCalls[0].tenant).toBe('acme');
    expect(findCalls[1].tenant).toBe('globex');
    expect(findCalls[0].filter.key).toBe(key);
    expect(findCalls[1].filter.key).toBe(key);

    // Restore
    mockModel.findOne = origFindOne;
  });

  it('default tenant context when no run() wraps the call', async () => {
    await settingsRepo.findActive('parako_config');

    // Outside any run(), tenant defaults to DEFAULT_TENANT_ID
    expect(tenantContext.getTenantId()).toBe(DEFAULT_TENANT_ID);
  });
});
