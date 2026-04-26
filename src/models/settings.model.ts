import mongoose, { Schema } from 'mongoose';
import { type TypedModel } from './base.model.js';
import toJSON from '../db/plugins/to-json.plugin.js';
import paginate from '../db/plugins/paginate.plugin.js';
import { type ISettings, type ISettingsMethods } from './settings/types.js';
import {
  applicationSchema,
  brandingSchema,
  deploymentSchema,
  securitySchema,
  featuresSchema,
  oidcSchema,
  integrationsSchema,
  notificationsSchema,
} from './settings/schemas.js';

export type SettingsModel = TypedModel<ISettings, ISettingsMethods>;

/**
 * Factory function to create Settings model with DI dependencies
 */
export const createSettingsModel = (): SettingsModel => {
  const settingsSchema = new Schema<ISettings, SettingsModel, ISettingsMethods>(
    {
      // Note: key is NOT unique by itself to support versioning
      // Uniqueness is enforced via compound index (key + is_active)
      key: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },
      version: {
        type: String,
        required: true,
        default: '1.0.0',
      },
      schema_version: {
        type: String,
        required: true,
        default: '1.0.0',
      },
      _version: {
        type: Number,
        required: true,
        default: 0,
      },
      description: {
        type: String,
        required: false,
        trim: true,
      },
      is_active: {
        type: Boolean,
        default: true,
        index: true,
      },
      metadata: {
        last_modified_by: { type: String, required: false },
        change_reason: { type: String, required: false },
        tags: { type: [String], default: [] },
        environment: {
          type: String,
          required: false,
          enum: ['development', 'staging', 'production'],
        },
      },

      // Configuration data using subschemas
      application: applicationSchema,
      branding: brandingSchema,
      deployment: deploymentSchema,
      security: securitySchema,
      features: featuresSchema,
      oidc: oidcSchema,
      integrations: integrationsSchema,
      notifications: notificationsSchema,
    },
    {
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
  );

  settingsSchema.method('activate', async function activate() {
    this.is_active = true;
    return this.save();
  });

  settingsSchema.method('deactivate', async function deactivate() {
    this.is_active = false;
    return this.save();
  });

  settingsSchema.method(
    'updateValue',
    async function updateValue(
      this: any,
      newValue: Partial<ISettings>,
      modifiedBy?: string,
      reason?: string
    ) {
      const configFields = [
        'application',
        'branding',
        'deployment',
        'security',
        'features',
        'oidc',
        'integrations',
        'notifications',
      ];

      for (const field of configFields) {
        if (newValue[field as keyof ISettings] !== undefined) {
          this[field] = newValue[field as keyof ISettings];
        }
      }

      this.version = this.incrementVersion();

      if (this.metadata) {
        this.metadata.last_modified_by = modifiedBy;
        this.metadata.change_reason = reason;
      } else {
        this.metadata = {
          last_modified_by: modifiedBy,
          change_reason: reason,
          tags: [],
        };
      }

      return this.save();
    }
  );

  settingsSchema.method(
    'getValue',
    function getValue(this: ISettings): ISettings {
      return this;
    }
  );

  settingsSchema.method(
    'isNewerThan',
    function isNewerThan(this: any, timestamp: Date): boolean {
      return this.updated_at && new Date(this.updated_at) > timestamp;
    }
  );

  // Helper method to increment version
  settingsSchema.method(
    'incrementVersion',
    function incrementVersion(this: any): string {
      const versionParts = this.version.split('.').map(Number);
      versionParts[2] = (versionParts[2] || 0) + 1;
      return versionParts.join('.');
    }
  );

  settingsSchema.static('findActiveByKey', function (key: string) {
    return this.findOne({ key, is_active: true });
  });

  settingsSchema.static('findByEnvironment', function (environment: string) {
    return this.find({ 'metadata.environment': environment, is_active: true });
  });

  settingsSchema.static('getLatestVersion', function (key: string) {
    return this.findOne({ key }).sort({ version: -1 });
  });

  // Settings is global (NOT tenant-scoped) — opt out of tenant plugin
  (settingsSchema as any).tenantScoped = false;

  // Indexes for better query performance
  // Compound unique index: only one active configuration per key allowed
  // Partial filter ensures uniqueness only for active documents
  settingsSchema.index(
    { key: 1, is_active: 1 },
    {
      unique: true,
      partialFilterExpression: { is_active: true },
      name: 'key_is_active_unique',
    }
  );
  settingsSchema.index({ 'metadata.environment': 1, is_active: 1 });
  settingsSchema.index({ schema_version: 1 });
  settingsSchema.index({ updated_at: -1 });

  settingsSchema.plugin(toJSON);
  settingsSchema.plugin(paginate);

  const Settings =
    mongoose.models.Settings ||
    mongoose.model<ISettings, SettingsModel>('Settings', settingsSchema);

  return Settings;
};

export { type ISettings, type ISettingsMethods } from './settings/types.js';
