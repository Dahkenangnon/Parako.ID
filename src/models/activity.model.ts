import mongoose from 'mongoose';
import paginate from '../db/plugins/paginate.plugin.js';
import toJSON from '../db/plugins/to-json.plugin.js';
import { TypedModel } from './base.model.js';

export type { IActivity, IActivityMethods } from '../types/activity.js';
export type {
  IActivityActor,
  IActivityTarget,
  IDeviceInfos,
  IDeviceTrust,
  IGeoLocation,
} from '../types/activity.js';

import type { IActivity, IActivityMethods } from '../types/activity.js';

export type ActivityModel = TypedModel<IActivity, IActivityMethods>;

/**
 * Factory function to create Activity model with DI dependencies
 */
export const createActivityModel = (): ActivityModel => {
  const activitySchema = new mongoose.Schema(
    {
      id: {
        type: String,
        required: false,
        default: () => new mongoose.Types.ObjectId().toString(),
      },
      type: {
        type: String,
        required: true,
      },
      description: {
        type: String,
        required: true,
      },

      // Actor: who performed the action
      actor: {
        user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        username: {
          type: String,
          required: false,
          trim: true,
        },
        email: {
          type: String,
          required: false,
          trim: true,
          lowercase: true,
        },
        full_name: {
          type: String,
          required: false,
        },
        given_name: {
          type: String,
          required: false,
        },
        family_name: {
          type: String,
          required: false,
        },
        actor_type: {
          type: String,
          required: false,
          enum: ['user', 'admin', 'system', 'service', 'anonymous'],
          default: 'user',
        },
      },

      // Target: what was acted upon
      target: {
        target_type: {
          type: String,
          required: false,
          enum: [
            'user',
            'session',
            'client',
            'grant',
            'config',
            'system',
            'none',
          ],
          default: 'none',
        },
        user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        username: {
          type: String,
          required: false,
          trim: true,
        },
        email: {
          type: String,
          required: false,
          trim: true,
          lowercase: true,
        },
        full_name: {
          type: String,
          required: false,
        },
        given_name: {
          type: String,
          required: false,
        },
        family_name: {
          type: String,
          required: false,
        },
        entity_id: {
          type: String,
          required: false,
        },
        entity_name: {
          type: String,
          required: false,
        },
        entity_data: {
          type: mongoose.Schema.Types.Mixed,
          required: false,
        },
      },

      timestamp: {
        type: Date,
        required: true,
        default: Date.now,
      },
      ip_address: {
        type: String,
        required: true,
      },
      user_agent: {
        type: String,
        required: false,
      },
      status: {
        type: String,
        required: true,
        enum: ['success', 'failed', 'warning', 'info'],
        default: 'info',
      },
      client_id: {
        type: String,
        required: false,
      },
      is_private: {
        type: Boolean,
        required: false,
        default: false,
      },
      related_activity_id: {
        type: String,
        required: false,
      },

      // All device information nested under device_infos
      device_infos: {
        fingerprint: {
          type: String,
          required: false,
        },
        fingerprint_js_id: {
          type: String,
          required: false,
        },
        browser: {
          name: {
            type: String,
            required: false,
          },
          version: {
            type: String,
            required: false,
          },
        },
        os: {
          name: {
            type: String,
            required: false,
          },
          version: {
            type: String,
            required: false,
          },
        },
        device: {
          type: {
            type: String,
            required: false,
          },
          vendor: {
            type: String,
            required: false,
          },
          model: {
            type: String,
            required: false,
          },
        },
        language: {
          type: String,
          required: false,
        },
        timezone_guess: {
          type: String,
          required: false,
        },
        platform: {
          type: String,
          required: false,
        },
        screen: {
          width: {
            type: Number,
            required: false,
          },
          height: {
            type: Number,
            required: false,
          },
          pixel_ratio: {
            type: Number,
            required: false,
          },
        },
        hardware_concurrency: {
          type: Number,
          required: false,
        },
        memory: {
          type: Number,
          required: false,
        },

        is_new_device: {
          type: Boolean,
          required: false,
          default: false,
        },
        requires_2fa: {
          type: Boolean,
          required: false,
          default: false,
        },
        is_suspicious: {
          type: Boolean,
          required: false,
          default: false,
        },
        confidence_score: {
          type: Number,
          required: false,
          min: 0,
          max: 100,
        },
        risk_level: {
          type: String,
          required: false,
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'low',
        },
        matched_device_id: {
          type: String,
          required: false,
        },
        reason: {
          type: String,
          required: false,
        },

        geo_location: {
          country: {
            type: String,
            required: false,
          },
          region: {
            type: String,
            required: false,
          },
          city: {
            type: String,
            required: false,
          },
          latitude: {
            type: Number,
            required: false,
          },
          longitude: {
            type: Number,
            required: false,
          },
          timezone: {
            type: String,
            required: false,
          },
        },
        device_trust: {
          trusted: {
            type: Boolean,
            required: false,
            default: false,
          },
          trusted_at: {
            type: Date,
            required: false,
          },
          trusted_until: {
            type: Date,
            required: false,
          },
          fingerprint: {
            type: String,
            required: false,
          },
        },
      },
    },
    {
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
  );

  activitySchema.index({ 'device_infos.fingerprint': 1 });
  activitySchema.index({ 'device_infos.fingerprint_js_id': 1 });
  activitySchema.index({ 'device_infos.risk_level': 1 });
  activitySchema.index({ 'device_infos.is_new_device': 1 });
  activitySchema.index({ 'device_infos.is_suspicious': 1 });
  activitySchema.index({ 'device_infos.geo_location.country': 1 });
  // Device trust indexes for efficient trusted device queries
  activitySchema.index({
    'device_infos.device_trust.fingerprint': 1,
    'device_infos.device_trust.trusted_until': 1,
  });

  // Tenant-scoped indexes for multi-tenant queries
  activitySchema.index({ tenant_id: 1, timestamp: -1 });

  activitySchema.index({ type: 1, timestamp: -1 });

  // Actor and Target indexes for efficient querying — tenant-scoped
  activitySchema.index({ tenant_id: 1, 'actor.user_id': 1, timestamp: -1 });
  activitySchema.index({ 'actor.actor_type': 1, timestamp: -1 });
  activitySchema.index({
    'target.user_id': 1,
    'target.target_type': 1,
    timestamp: -1,
  });
  activitySchema.index({ 'target.target_type': 1, timestamp: -1 });

  activitySchema.plugin(toJSON);
  activitySchema.plugin(paginate);

  /**
   * @typedef Activity
   */
  const Activity = mongoose.model<IActivity, ActivityModel>(
    'Activity',
    activitySchema
  );

  return Activity;
};
