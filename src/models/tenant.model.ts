import mongoose from 'mongoose';
import { type TypedModel } from './base.model.js';
import {
  type ITenant,
  type ITenantMethods,
  TenantStatusValues,
} from '../types/tenant.js';

export type { ITenant, ITenantMethods, TenantStatus } from '../types/tenant.js';
export { TenantStatusValues } from '../types/tenant.js';

export type TenantModel = TypedModel<ITenant, ITenantMethods>;

export const createTenantModel = (): TenantModel => {
  const tenantSchema = new mongoose.Schema(
    {
      slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
      },
      display_name: { type: String, required: true },
      domain: { type: String, unique: true, sparse: true },
      status: {
        type: String,
        required: true,
        enum: TenantStatusValues,
        default: 'active',
      },
      issuer_url: { type: String },
      created_at: { type: Date, default: Date.now },
      updated_at: { type: Date, default: Date.now },
    },
    {
      collection: 'tenants',
      timestamps: false,
    }
  );

  // Explicitly mark as NOT tenant-scoped.
  // This is the ONLY model excluded from the global tenant plugin —
  // it IS the tenant registry and must be accessible across all tenants.
  (tenantSchema as any).tenantScoped = false;

  // Avoid OverwriteModelError in tests / hot-reload
  return (
    (mongoose.models.Tenant as TenantModel) ||
    (mongoose.model<ITenant>('Tenant', tenantSchema) as unknown as TenantModel)
  );
};
