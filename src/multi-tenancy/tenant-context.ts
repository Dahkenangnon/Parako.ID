import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantStore, ITenant } from './types.js';

export const DEFAULT_TENANT_ID = 'default';

/**
 * Hardcoded system tenant allowlist. These slugs bypass regex validation
 * because they use underscore prefixes reserved for system use.
 * Only exact matches pass — not a regex relaxation.
 */
export const SYSTEM_TENANTS = new Set(['_platforms']);

export const DEFAULT_TENANT: ITenant = Object.freeze({
  id: 'default',
  slug: 'default',
  display_name: 'Default',
  status: 'active' as const,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /**
   * When true, getTenantId() throws if no ALS store is active instead
   * of silently returning DEFAULT_TENANT_ID. This prevents accidental
   * cross-tenant data leaks in multi-tenant mode.
   *
   * Enabled at app startup when `features.multi_tenancy.enabled = true`.
   * Must NOT be enabled in single-tenant mode (no ALS context is ever set).
   */
  private strict = false;

  /**
   * Executes a callback within a tenant context.
   * All async operations inside inherit the tenant ID.
   */
  run<T>(tenantId: string, fn: () => T): T {
    return this.als.run({ tenantId }, fn);
  }

  /**
   * Returns the current tenant ID.
   *
   * - **Strict mode (multi-tenant):** Throws if no ALS store is active.
   *   This catches middleware ordering bugs and missing `tenantContext.run()`
   *   wrappers that would otherwise silently operate as DEFAULT_TENANT_ID.
   *
   * - **Non-strict mode (single-tenant):** Falls back to DEFAULT_TENANT_ID.
   */
  getTenantId(): string {
    const store = this.als.getStore();
    if (store) return store.tenantId;

    if (this.strict) {
      throw new Error(
        '[TenantContext] No active tenant context in strict mode. ' +
          'Ensure tenantContext.run() wraps the current execution path. ' +
          'This usually means TenantContextMiddleware is not mounted or ' +
          'the code is executing outside of a request context (e.g., ' +
          'background job without tenantId, startup code, Redis callback).'
      );
    }

    return DEFAULT_TENANT_ID;
  }

  /**
   * Returns the current tenant ID if an ALS store is active, undefined otherwise.
   * Unlike getTenantId(), NEVER throws in strict mode and NEVER returns DEFAULT_TENANT_ID.
   * Intended for hot-path sync methods (e.g., getConfig()) where falling back to the
   * default cache is acceptable when no ALS context is available.
   */
  getTenantIdSafe(): string | undefined {
    const store = this.als.getStore();
    return store?.tenantId;
  }

  /**
   * Returns the raw store object (for debugging).
   * Returns undefined when called outside any run() context.
   */
  getStore(): TenantStore | undefined {
    return this.als.getStore();
  }

  /**
   * Enable strict mode. In this mode, getTenantId() throws if no ALS
   * store is active instead of silently returning DEFAULT_TENANT_ID.
   *
   * Call during app bootstrap when multi-tenancy is enabled.
   */
  enableStrictMode(): void {
    this.strict = true;
  }

  /**
   * Disable strict mode. Used primarily in tests.
   */
  disableStrictMode(): void {
    this.strict = false;
  }

  /**
   * Whether strict mode is currently enabled.
   */
  isStrictMode(): boolean {
    return this.strict;
  }
}

/** Singleton tenant context — the SOLE source of tenant identity. */
export const tenantContext = new TenantContext();
