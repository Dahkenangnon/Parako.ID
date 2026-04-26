import { injectable } from 'inversify';
import type { PrismaClient } from '@prisma/client';
import type { ITenant } from '../../../types/tenant.js';
import type {
  ITenantRepository,
  CreateTenantDto,
} from '../interfaces/tenant.repository.js';

@injectable()
export class PrismaTenantRepository implements ITenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySlug(slug: string): Promise<ITenant | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    return row ? this.toDoc(row) : null;
  }

  async findByDomain(domain: string): Promise<ITenant | null> {
    const row = await this.prisma.tenant.findFirst({
      where: { domain },
    });
    return row ? this.toDoc(row) : null;
  }

  async findById(id: string): Promise<ITenant | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { id },
    });
    return row ? this.toDoc(row) : null;
  }

  async findAll(filter?: { status?: string }): Promise<ITenant[]> {
    const where = filter?.status ? { status: filter.status } : {};
    const rows = await this.prisma.tenant.findMany({ where });
    return rows.map(r => this.toDoc(r));
  }

  async create(data: CreateTenantDto): Promise<ITenant> {
    const row = await this.prisma.tenant.create({ data });
    return this.toDoc(row);
  }

  async update(id: string, data: Partial<ITenant>): Promise<ITenant> {
    const row = await this.prisma.tenant.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });
    return this.toDoc(row);
  }

  async exists(slug: string): Promise<boolean> {
    const count = await this.prisma.tenant.count({
      where: { slug },
    });
    return count > 0;
  }

  private toDoc(row: {
    id: string;
    slug: string;
    display_name: string;
    domain: string | null;
    status: string;
    issuer_url: string | null;
    created_at: Date;
    updated_at: Date;
  }): ITenant {
    return {
      id: row.id,
      slug: row.slug,
      display_name: row.display_name,
      domain: row.domain ?? undefined,
      status: row.status as ITenant['status'],
      issuer_url: row.issuer_url ?? undefined,
      created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
      updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
    };
  }
}
