import type { IBaseModel } from './base.js';

/**
 * Actor: who performed the action
 */
export interface IActivityActor {
  user_id?: string;
  username?: string;
  email?: string;
  full_name?: string;
  given_name?: string;
  family_name?: string;
  actor_type: 'user' | 'admin' | 'system' | 'service' | 'anonymous';
}

/**
 * Target: what was acted upon
 */
export interface IActivityTarget {
  target_type:
    | 'user'
    | 'session'
    | 'client'
    | 'grant'
    | 'config'
    | 'system'
    | 'none';
  user_id?: string;
  username?: string;
  email?: string;
  full_name?: string;
  given_name?: string;
  family_name?: string;
  entity_id?: string;
  entity_name?: string;
  entity_data?: Record<string, any>;
}

/**
 * Device trust information
 */
export interface IDeviceTrust {
  trusted: boolean;
  trusted_at: Date;
  trusted_until: Date;
  fingerprint: string;
}

/**
 * Geographic information
 */
export interface IGeoLocation {
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

/**
 * All device information nested under device_infos
 */
export interface IDeviceInfos {
  fingerprint?: string;
  fingerprint_js_id?: string;
  browser?: {
    name?: string;
    version?: string;
  };
  os?: {
    name?: string;
    version?: string;
  };
  device?: {
    type?: string;
    vendor?: string;
    model?: string;
  };
  language?: string;
  timezone_guess?: string;
  platform?: string;
  screen?: {
    width?: number;
    height?: number;
    pixel_ratio?: number;
  };
  hardware_concurrency?: number;
  memory?: number | null;

  is_new_device?: boolean;
  requires_2fa?: boolean;
  is_suspicious?: boolean;
  confidence_score?: number;
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  matched_device_id?: string;
  reason?: string;

  geo_location?: IGeoLocation;

  device_trust?: IDeviceTrust;
}

export interface IActivity extends IBaseModel {
  type: string;
  description: string;

  // Actor: who performed the action
  actor?: IActivityActor;

  // Target: what was acted upon
  target?: IActivityTarget;

  timestamp: Date;
  ip_address: string;
  user_agent?: string;
  status: 'success' | 'failed' | 'warning' | 'info';
  client_id?: string;
  is_private?: boolean;
  related_activity_id?: string;

  // All device information nested under device_infos
  device_infos?: IDeviceInfos;
}

export type IActivityMethods = object;
