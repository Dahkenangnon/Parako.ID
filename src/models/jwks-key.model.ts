import mongoose from 'mongoose';
import { TypedModel } from './base.model.js';

export interface IJwksKey {
  kid: string;
  alg: string;
  use: string;
  status: 'active' | 'expiring' | 'retired';
  promoted: boolean;
  encrypted_private_key: string; // ENCRYPTED:v1:... format
  public_key: Record<string, unknown>; // plain JWK
  tenant_id: string;
  created_at: Date;
  rotated_at?: Date;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IJwksKeyMethods {}

export type JwksKeyModel = TypedModel<IJwksKey, IJwksKeyMethods>;

export const createJwksKeyModel = (): JwksKeyModel => {
  const jwksKeySchema = new mongoose.Schema(
    {
      kid: { type: String, required: true },
      alg: { type: String, required: true },
      use: { type: String, required: true, default: 'sig' },
      status: {
        type: String,
        required: true,
        enum: ['active', 'expiring', 'retired'],
        default: 'active',
      },
      promoted: { type: Boolean, default: true },
      encrypted_private_key: { type: String, required: true },
      public_key: { type: mongoose.Schema.Types.Mixed, required: true },
      tenant_id: { type: String, required: true, default: 'default' },
      created_at: { type: Date, default: Date.now },
      rotated_at: { type: Date },
    },
    {
      collection: 'jwks_keys',
      timestamps: false,
    }
  );

  jwksKeySchema.index({ tenant_id: 1, status: 1 });
  jwksKeySchema.index({ tenant_id: 1, kid: 1 }, { unique: true });

  // Avoid OverwriteModelError in tests / hot-reload
  return (
    (mongoose.models.JwksKey as JwksKeyModel) ||
    (mongoose.model<IJwksKey>(
      'JwksKey',
      jwksKeySchema
    ) as unknown as JwksKeyModel)
  );
};
