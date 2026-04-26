import type { IBaseModel } from './base.js';

export type TenantStatus = 'active' | 'suspended' | 'archived';

export const TenantStatusValues: TenantStatus[] = [
  'active',
  'suspended',
  'archived',
];

export interface ITenant extends IBaseModel {
  slug: string;
  display_name: string;
  domain?: string;
  status: TenantStatus;
  issuer_url?: string;
}

export type ITenantMethods = object;
