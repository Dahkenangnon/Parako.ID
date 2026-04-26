import type { Schema } from 'mongoose';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../multi-tenancy/tenant-context.js';

/**
 * Mongoose global plugin that enforces tenant isolation.
 *
 * - Adds `tenant_id` field to every schema (unless already present or opted out).
 * - Pre-save hook: injects tenant_id from AsyncLocalStorage context.
 * - Pre-query hooks: auto-filters all reads/writes by tenant_id.
 *
 * Opt-out: set `schema.tenantScoped = false` before applying (only the Tenant model).
 * Existing field: schemas that already have `tenant_id` (e.g., JwksKey) get query
 * hooks applied without re-adding the field.
 */
export function tenantPlugin(schema: Schema): void {
  // Skip schemas that explicitly opt out (only Tenant model)
  if ((schema as any).tenantScoped === false) return;

  // Idempotency guard: prevent double-application when a schema uses explicit
  // schema.plugin(tenantPlugin) AND later the global mongoose.plugin(tenantPlugin)
  // runs.  Without this, hooks would fire twice per operation.
  if ((schema as any)._tenantPluginApplied) return;
  (schema as any)._tenantPluginApplied = true;

  const hasTenantId = schema.path('tenant_id') != null;
  if (!hasTenantId) {
    schema.add({
      tenant_id: {
        type: String,
        required: true,
        default: () => tenantContext.getTenantId(),
        index: true,
      },
    });
  }

  // Pre-save: ALWAYS set tenant_id from context.
  // AsyncLocalStorage is the sole source of tenant identity — this ensures
  // models with an existing tenant_id field (e.g., JwksKey with a static
  // default) get the correct context-based value, not the schema default.
  schema.pre('save', function () {
    this.tenant_id = tenantContext.getTenantId();
  });

  // Pre-insertMany: ALWAYS set tenant_id from context on all docs.
  // Consistent with pre-save — AsyncLocalStorage is the sole source of truth.
  schema.pre('insertMany', function (docs) {
    const tid = tenantContext.getTenantId();
    for (const doc of docs as any[]) {
      doc.tenant_id = tid;
    }
  });

  // Pre-query hooks: auto-filter by tenant_id
  const queryHooks: string[] = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'distinct',
    'replaceOne',
  ];

  for (const hook of queryHooks) {
    schema.pre(hook as any, function (this: any) {
      const filter = this.getFilter();
      if (!filter.tenant_id) {
        this.where({ tenant_id: tenantContext.getTenantId() });
      }
    });
  }

  // Pre-aggregate: inject $match stage at the beginning of the pipeline.
  // Aggregation pipelines bypass Mongoose query hooks entirely, so without
  // this, Model.aggregate([...]) would leak data across tenants.
  schema.pre('aggregate', function () {
    const tid = tenantContext.getTenantId();
    this.pipeline().unshift({ $match: { tenant_id: tid } });
  });
}

/**
 * Convenience constant for the default tenant ID value.
 * Re-exported here so connection.ts can stay self-contained.
 */
export { DEFAULT_TENANT_ID };
