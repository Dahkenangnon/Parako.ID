import { Prisma, type PrismaClient } from '@prisma/client';
import {
  tenantContext,
  SYSTEM_TENANTS,
} from '../../multi-tenancy/tenant-context.js';

/**
 * Strict slug format for tenant IDs.
 * Only lowercase alphanumeric, hyphens, underscores. 1-63 chars.
 * Must start with a letter or digit.
 * This guards the SET LOCAL query and all tenant-scoped operations.
 */
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * Models excluded from tenant scoping.
 * - Tenant: IS the tenant registry, not tenant-scoped.
 * - Settings: Global platform config, shared by all tenants.
 */
export const TENANT_EXCLUDED_MODELS = new Set(['Tenant', 'Settings']);

/**
 * Operations that receive a `data` payload where tenant_id should be injected.
 */
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'upsert',
]);

/**
 * Operations that receive a `where` clause where tenant_id filter should be injected.
 */
const FILTER_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Creates a Prisma client extension that enforces tenant isolation.
 *
 * - Injects `tenant_id` into all write operations (create, upsert, etc.)
 * - Injects `tenant_id` filter into all read/update/delete operations
 * - For PostgreSQL: executes `SET LOCAL app.tenant_id` before each query
 *   (belt-and-suspenders with RLS policies)
 * - Skips only the Tenant model (it IS the tenant registry)
 *
 * Usage: `const extendedClient = prisma.$extends(createTenantExtension('sqlite'))`
 *
 * @param adapter - The storage adapter in use ('sqlite' | 'postgresql')
 * @param rawClient - The raw PrismaClient for executing SET LOCAL (PostgreSQL only)
 */
export function createTenantExtension(
  adapter: 'sqlite' | 'postgresql',
  rawClient?: PrismaClient
) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) {
          // Skip excluded models (only Tenant)
          if (model && TENANT_EXCLUDED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = tenantContext.getTenantId();

          // Validate tenant slug format to prevent injection in SET LOCAL
          // and ensure only well-formed identifiers reach DB operations.
          // System tenants (e.g. _platforms) bypass regex — hardcoded allowlist.
          if (
            !SYSTEM_TENANTS.has(tenantId) &&
            !TENANT_SLUG_PATTERN.test(tenantId)
          ) {
            throw new Error(
              `[tenant-extension] Invalid tenant ID format: ${tenantId.slice(0, 64)}`
            );
          }

          // For PostgreSQL: SET LOCAL for RLS (belt-and-suspenders).
          // Uses $executeRaw with tagged template for parameterized safety.
          if (adapter === 'postgresql' && rawClient) {
            await rawClient.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          }

          if (WRITE_OPERATIONS.has(operation)) {
            if (operation === 'upsert') {
              const a = args as any;
              if (a.create) {
                a.create = { ...a.create, tenant_id: tenantId };
              }
              if (a.update) {
                a.update = { ...a.update, tenant_id: tenantId };
              }
              if (a.where) {
                a.where = { ...a.where, tenant_id: tenantId };
              }
            } else if (
              operation === 'createMany' ||
              operation === 'createManyAndReturn'
            ) {
              const a = args as any;
              if (Array.isArray(a.data)) {
                a.data = a.data.map((d: any) => ({
                  ...d,
                  tenant_id: tenantId,
                }));
              } else if (a.data) {
                a.data = { ...a.data, tenant_id: tenantId };
              }
            } else {
              // create
              const a = args as any;
              if (a.data) {
                a.data = { ...a.data, tenant_id: tenantId };
              }
            }
          }

          if (FILTER_OPERATIONS.has(operation)) {
            const a = args as any;
            a.where = { ...a.where, tenant_id: tenantId };
          }

          return query(args);
        },
      },
    },
  });
}
