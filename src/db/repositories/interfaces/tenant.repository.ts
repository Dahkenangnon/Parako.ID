import type { ITenant } from '../../../types/tenant.js';

export interface CreateTenantDto {
  slug: string;
  display_name: string;
  domain?: string;
  issuer_url?: string;
}

export interface ITenantRepository {
  findBySlug(slug: string): Promise<ITenant | null>;
  findByDomain(domain: string): Promise<ITenant | null>;
  findById(id: string): Promise<ITenant | null>;
  findAll(filter?: { status?: string }): Promise<ITenant[]>;
  create(data: CreateTenantDto): Promise<ITenant>;
  update(id: string, data: Partial<ITenant>): Promise<ITenant>;
  exists(slug: string): Promise<boolean>;
}
