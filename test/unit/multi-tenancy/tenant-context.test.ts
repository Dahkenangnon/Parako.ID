import { describe, it, expect } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT,
} from '../../../src/multi-tenancy/tenant-context.js';

describe('TenantContext', () => {
  describe('getTenantId()', () => {
    it('returns DEFAULT_TENANT_ID when no context is active', () => {
      expect(tenantContext.getTenantId()).toBe(DEFAULT_TENANT_ID);
      expect(tenantContext.getTenantId()).toBe('default');
    });

    it('returns the tenant ID set by run()', () => {
      tenantContext.run('acme', () => {
        expect(tenantContext.getTenantId()).toBe('acme');
      });
    });

    it('reverts to DEFAULT_TENANT_ID after run() completes', () => {
      tenantContext.run('temp-tenant', () => {
        expect(tenantContext.getTenantId()).toBe('temp-tenant');
      });
      expect(tenantContext.getTenantId()).toBe(DEFAULT_TENANT_ID);
    });
  });

  describe('async propagation', () => {
    it('propagates tenant across setTimeout boundaries', async () => {
      await tenantContext.run('tenant-a', async () => {
        const result = await new Promise<string>(resolve => {
          setTimeout(() => resolve(tenantContext.getTenantId()), 10);
        });
        expect(result).toBe('tenant-a');
      });
    });

    it('propagates tenant across Promise chains', async () => {
      await tenantContext.run('tenant-b', async () => {
        const result = await Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => tenantContext.getTenantId());
        expect(result).toBe('tenant-b');
      });
    });

    it('propagates through async/await nesting', async () => {
      await tenantContext.run('deep-tenant', async () => {
        const inner = async () => {
          const deepInner = async () => tenantContext.getTenantId();
          return deepInner();
        };
        expect(await inner()).toBe('deep-tenant');
      });
    });
  });

  describe('nesting isolation', () => {
    it('inner run() overrides outer context', () => {
      tenantContext.run('outer', () => {
        expect(tenantContext.getTenantId()).toBe('outer');
        tenantContext.run('inner', () => {
          expect(tenantContext.getTenantId()).toBe('inner');
        });
        expect(tenantContext.getTenantId()).toBe('outer');
      });
    });

    it('concurrent async runs maintain separate contexts', async () => {
      const results: string[] = [];

      await Promise.all([
        tenantContext.run('concurrent-a', async () => {
          await new Promise(r => setTimeout(r, 20));
          results.push(tenantContext.getTenantId());
        }),
        tenantContext.run('concurrent-b', async () => {
          await new Promise(r => setTimeout(r, 10));
          results.push(tenantContext.getTenantId());
        }),
      ]);

      expect(results).toContain('concurrent-a');
      expect(results).toContain('concurrent-b');
      expect(results).toHaveLength(2);
    });
  });

  describe('getTenantIdSafe()', () => {
    it('returns tenantId inside ALS context', () => {
      tenantContext.run('acme', () => {
        expect(tenantContext.getTenantIdSafe()).toBe('acme');
      });
    });

    it('returns undefined outside ALS context', () => {
      expect(tenantContext.getTenantIdSafe()).toBeUndefined();
    });

    it('returns undefined in strict mode outside ALS (no throw)', () => {
      tenantContext.enableStrictMode();
      try {
        expect(tenantContext.getTenantIdSafe()).toBeUndefined();
      } finally {
        tenantContext.disableStrictMode();
      }
    });

    it('never returns DEFAULT_TENANT_ID', () => {
      // Outside context: returns undefined (not DEFAULT_TENANT_ID)
      expect(tenantContext.getTenantIdSafe()).not.toBe('default');
      expect(tenantContext.getTenantIdSafe()).toBeUndefined();
    });
  });

  describe('getStore()', () => {
    it('returns undefined outside run() context', () => {
      expect(tenantContext.getStore()).toBeUndefined();
    });

    it('returns a store with tenantId inside run()', () => {
      tenantContext.run('store-test', () => {
        const store = tenantContext.getStore();
        expect(store).toEqual({ tenantId: 'store-test' });
      });
    });
  });

  describe('DEFAULT_TENANT', () => {
    it('has the expected shape and values', () => {
      expect(DEFAULT_TENANT).toMatchObject({
        id: 'default',
        slug: 'default',
        display_name: 'Default',
        status: 'active',
      });
    });

    it('is deeply frozen (immutable)', () => {
      expect(Object.isFrozen(DEFAULT_TENANT)).toBe(true);
      expect(() => {
        (DEFAULT_TENANT as any).id = 'mutated';
      }).toThrow();
      expect(() => {
        (DEFAULT_TENANT as any).newProp = 'injected';
      }).toThrow();
    });
  });
});
