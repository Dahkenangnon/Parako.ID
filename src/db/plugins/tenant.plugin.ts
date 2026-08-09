import type { Schema } from 'mongoose';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../multi-tenancy/tenant-context.js';

const MANDATORY_FIRST_AGGREGATION_STAGES = new Set([
  '$changeStream',
  '$documents',
  '$geoNear',
  '$search',
  '$searchMeta',
  '$vectorSearch',
]);

const UPDATE_QUERY_HOOKS = new Set([
  'findOneAndUpdate',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
]);

const REPLACEMENT_QUERY_HOOKS = new Set(['findOneAndReplace', 'replaceOne']);

function scopeUpdateToTenant(
  update: any,
  tenantId: string,
  replacement: boolean
): any {
  if (Array.isArray(update)) {
    return [...update, { $set: { tenant_id: tenantId } }];
  }

  if (!update || typeof update !== 'object') {
    return update;
  }

  const hasOperators = Object.keys(update).some(key => key.startsWith('$'));
  if (replacement || !hasOperators) {
    return { ...update, tenant_id: tenantId };
  }

  const scopedUpdate: Record<string, any> = { ...update };
  for (const [operator, value] of Object.entries(scopedUpdate)) {
    if (!operator.startsWith('$') || !value || typeof value !== 'object') {
      continue;
    }

    const operands = { ...(value as Record<string, unknown>) };
    delete operands.tenant_id;
    if (operator === '$rename') {
      for (const [source, target] of Object.entries(operands)) {
        if (target === 'tenant_id') delete operands[source];
      }
    }
    scopedUpdate[operator] = operands;
  }

  scopedUpdate.$set = {
    ...(scopedUpdate.$set ?? {}),
    tenant_id: tenantId,
  };
  return scopedUpdate;
}

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
      const tenantId = tenantContext.getTenantId();
      this.where({ tenant_id: tenantId });

      if (UPDATE_QUERY_HOOKS.has(hook)) {
        const update = this.getUpdate();
        if (update != null) {
          this.setUpdate(
            scopeUpdateToTenant(
              update,
              tenantId,
              REPLACEMENT_QUERY_HOOKS.has(hook)
            )
          );
        }
      }
    });
  }

  // Pre-aggregate: inject $match stage at the beginning of the pipeline.
  // Aggregation pipelines bypass Mongoose query hooks entirely, so without
  // this, Model.aggregate([...]) would leak data across tenants.
  schema.pre('aggregate', function () {
    const tid = tenantContext.getTenantId();
    const pipeline = this.pipeline();
    const firstStageName = Object.keys(pipeline[0] ?? {})[0];
    const insertAt =
      firstStageName && MANDATORY_FIRST_AGGREGATION_STAGES.has(firstStageName)
        ? 1
        : 0;
    pipeline.splice(insertAt, 0, { $match: { tenant_id: tid } });
  });
}

/**
 * Convenience constant for the default tenant ID value.
 * Re-exported here so connection.ts can stay self-contained.
 */
export { DEFAULT_TENANT_ID };
