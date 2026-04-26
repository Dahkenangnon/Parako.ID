import mongoose, { Schema } from 'mongoose';
import { type TypedModel } from './base.model.js';
import type {
  ISocialIntegration,
  ISocialIntegrationMethods,
  DecryptedTokenData,
} from '../types/social-integration.js';
import toJSON from '../db/plugins/to-json.plugin.js';
import paginate from '../db/plugins/paginate.plugin.js';
import { ensureEncrypted, ensureDecrypted } from '../utils/encryption.js';

// Re-export all types for backward compatibility
export type {
  SocialProvider,
  IntegrationMethod,
  TokenData,
  ProviderUserData,
  ISocialIntegration,
  DecryptedTokenData,
  ISocialIntegrationMethods,
} from '../types/social-integration.js';

export type SocialIntegrationModel = TypedModel<
  ISocialIntegration,
  ISocialIntegrationMethods
>;

/**
 * Factory function to create SocialIntegration model with DI dependencies
 */
export const createSocialIntegrationModel = (): SocialIntegrationModel => {
  const SocialIntegrationSchema = new Schema<
    ISocialIntegration,
    SocialIntegrationModel,
    ISocialIntegrationMethods
  >(
    {
      user_id: {
        type: String,
        required: true,
        ref: 'User',
        index: true,
      },
      method: {
        type: String,
        required: true,
        enum: [
          'local',
          'oauth',
          'ldap',
          'google',
          'github',
          'facebook',
          'linkedin',
          'twitter',
          'microsoft',
          'apple',
        ],
        index: true,
      },
      provider_sub: {
        type: String,
        required: true,
        trim: true,
      },
      provider_username: {
        type: String,
        required: false,
        trim: true,
      },
      provider_data: {
        sub: { type: String, required: true },
        email: { type: String, required: false },
        email_verified: { type: Boolean, required: false },
        name: { type: String, required: false },
        given_name: { type: String, required: false },
        family_name: { type: String, required: false },
        picture: { type: String, required: false },
        locale: { type: String, required: false },
        provider_username: { type: String, required: false },
        raw_data: { type: Schema.Types.Mixed, required: false },
      },
      tokens: {
        access_token: { type: String, required: false },
        refresh_token: { type: String, required: false },
        id_token: { type: String, required: false },
        token_type: { type: String, required: false, default: 'Bearer' },
        expires_at: { type: Date, required: false },
        scope: { type: String, required: false },
      },
      is_active: {
        type: Boolean,
        default: true,
        index: true,
      },
      last_used: {
        type: Date,
        required: false,
        index: true,
      },
      metadata: {
        created_by: {
          type: String,
          enum: ['user', 'admin', 'system'],
          default: 'user',
        },
        linked_at: {
          type: Date,
          default: Date.now,
        },
        last_sync: {
          type: Date,
          required: false,
        },
        sync_errors: {
          type: [String],
          default: [],
        },
      },
    },
    {
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
  );

  // Pre-save middleware to encrypt tokens at rest
  SocialIntegrationSchema.pre('save', function () {
    if (this.tokens) {
      if (this.tokens.access_token) {
        this.tokens.access_token = ensureEncrypted(this.tokens.access_token);
      }
      if (this.tokens.refresh_token) {
        this.tokens.refresh_token = ensureEncrypted(this.tokens.refresh_token);
      }
      if (this.tokens.id_token) {
        this.tokens.id_token = ensureEncrypted(this.tokens.id_token);
      }
    }
  });

  // Instance method to get decrypted tokens
  SocialIntegrationSchema.methods.getDecryptedTokens = function ():
    | DecryptedTokenData
    | undefined {
    if (!this.tokens) {
      return undefined;
    }

    return {
      access_token: this.tokens.access_token
        ? ensureDecrypted(this.tokens.access_token)
        : '',
      refresh_token: this.tokens.refresh_token
        ? ensureDecrypted(this.tokens.refresh_token)
        : undefined,
      id_token: this.tokens.id_token
        ? ensureDecrypted(this.tokens.id_token)
        : undefined,
      token_type: this.tokens.token_type,
      expires_at: this.tokens.expires_at,
      scope: this.tokens.scope,
    };
  };

  // Instance method to check if token is expired
  SocialIntegrationSchema.methods.isTokenExpired = function (): boolean {
    if (!this.tokens?.expires_at) {
      // No expiration set, assume not expired
      return false;
    }
    const bufferMs = 60 * 1000;
    return new Date().getTime() > this.tokens.expires_at.getTime() - bufferMs;
  };

  SocialIntegrationSchema.plugin(toJSON);
  SocialIntegrationSchema.plugin(paginate);

  // Compound unique indexes with tenant_id for multi-tenant isolation.
  SocialIntegrationSchema.index(
    { tenant_id: 1, user_id: 1, method: 1 },
    { unique: true }
  );
  SocialIntegrationSchema.index(
    { tenant_id: 1, provider_sub: 1, method: 1 },
    { unique: true }
  );
  SocialIntegrationSchema.index({ method: 1, is_active: 1 });
  SocialIntegrationSchema.index({ last_used: -1 });

  const SocialIntegration =
    mongoose.models.SocialIntegration ||
    mongoose.model<ISocialIntegration, SocialIntegrationModel>(
      'SocialIntegration',
      SocialIntegrationSchema
    );

  return SocialIntegration;
};
