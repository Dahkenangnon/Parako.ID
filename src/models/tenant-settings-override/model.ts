import mongoose, { Schema } from 'mongoose';
import { type TypedModel } from '../base.model.js';
import toJSON from '../../db/plugins/to-json.plugin.js';
import paginate from '../../db/plugins/paginate.plugin.js';
import { tenantPlugin } from '../../db/plugins/tenant.plugin.js';
import type {
  ITenantSettingsOverride,
  ITenantSettingsOverrideMethods,
} from '../../types/tenant-settings-override.js';

export type TenantSettingsOverrideModel = TypedModel<
  ITenantSettingsOverride,
  ITenantSettingsOverrideMethods
>;

/**
 * Factory function to create TenantSettingsOverride model.
 * This model is tenant-scoped (tenantPlugin applied) — each tenant gets
 * its own override document for customizable configuration sections.
 */
export const createTenantSettingsOverrideModel =
  (): TenantSettingsOverrideModel => {
    const schema = new Schema<
      ITenantSettingsOverride,
      TenantSettingsOverrideModel,
      ITenantSettingsOverrideMethods
    >(
      {
        key: {
          type: String,
          required: true,
          default: 'parako_config',
          trim: true,
          index: true,
        },
        version: {
          type: String,
          required: true,
          default: '1.0.0',
        },
        _version: {
          type: Number,
          required: true,
          default: 0,
        },
        is_active: {
          type: Boolean,
          default: true,
          index: true,
        },
        metadata: {
          last_modified_by: { type: String, required: false },
          change_reason: { type: String, required: false },
        },
        // Whitelisted override sections — all optional, mixed type
        application: { type: Schema.Types.Mixed },
        branding: { type: Schema.Types.Mixed },
        security: { type: Schema.Types.Mixed },
        features: { type: Schema.Types.Mixed },
        oidc: { type: Schema.Types.Mixed },
        integrations: { type: Schema.Types.Mixed },
        notifications: { type: Schema.Types.Mixed },
      },
      {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
      }
    );

    // Compound unique index: one active config per key per tenant
    schema.index(
      { tenant_id: 1, key: 1, is_active: 1 },
      {
        unique: true,
        partialFilterExpression: { is_active: true },
        name: 'tso_tenant_key_active_unique',
      }
    );

    schema.plugin(toJSON);
    schema.plugin(paginate);
    schema.plugin(tenantPlugin);

    const TenantSettingsOverride =
      mongoose.models.TenantSettingsOverride ||
      mongoose.model<ITenantSettingsOverride, TenantSettingsOverrideModel>(
        'TenantSettingsOverride',
        schema
      );

    return TenantSettingsOverride;
  };
