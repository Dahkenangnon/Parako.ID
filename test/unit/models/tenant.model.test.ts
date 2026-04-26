import { describe, it, expect } from 'vitest';
import {
  createTenantModel,
  TenantStatusValues,
} from '../../../src/models/tenant.model.js';

describe('Tenant Mongoose Model', () => {
  const TenantModel = createTenantModel();

  describe('schema structure', () => {
    it('uses the "tenants" collection', () => {
      expect(TenantModel.collection.collectionName).toBe('tenants');
    });

    it('has all required domain fields', () => {
      const paths = TenantModel.schema.paths;
      const expected = [
        'slug',
        'display_name',
        'domain',
        'status',
        'issuer_url',
        'created_at',
        'updated_at',
      ];
      for (const field of expected) {
        expect(paths[field], `missing field: ${field}`).toBeDefined();
      }
    });

    it('does NOT have a tenant_id field (it IS the tenant registry)', () => {
      expect(TenantModel.schema.paths.tenant_id).toBeUndefined();
    });

    it('marks tenantScoped = false to opt out of the global tenant plugin', () => {
      expect((TenantModel.schema as any).tenantScoped).toBe(false);
    });
  });

  describe('constraints', () => {
    it('enforces slug uniqueness', () => {
      const slugPath = TenantModel.schema.path('slug') as any;
      expect(slugPath.options.unique).toBe(true);
    });

    it('lowercases and trims slug', () => {
      const slugPath = TenantModel.schema.path('slug') as any;
      expect(slugPath.options.lowercase).toBe(true);
      expect(slugPath.options.trim).toBe(true);
    });

    it('enforces domain uniqueness with sparse index (nullable)', () => {
      const domainPath = TenantModel.schema.path('domain') as any;
      expect(domainPath.options.unique).toBe(true);
      expect(domainPath.options.sparse).toBe(true);
    });

    it('restricts status to valid enum values', () => {
      const statusPath = TenantModel.schema.path('status') as any;
      expect(statusPath.enumValues).toEqual(TenantStatusValues);
      expect(statusPath.enumValues).toEqual([
        'active',
        'suspended',
        'archived',
      ]);
    });
  });

  describe('defaults', () => {
    it('defaults status to "active"', () => {
      const statusPath = TenantModel.schema.path('status') as any;
      expect(statusPath.defaultValue).toBe('active');
    });
  });

  describe('validation', () => {
    it('requires slug', () => {
      const slugPath = TenantModel.schema.path('slug') as any;
      expect(slugPath.isRequired).toBe(true);
    });

    it('requires display_name', () => {
      const displayNamePath = TenantModel.schema.path('display_name') as any;
      expect(displayNamePath.isRequired).toBe(true);
    });

    it('rejects invalid status values via schema validation', () => {
      const doc = new TenantModel({
        slug: 'test',
        display_name: 'Test',
        status: 'invalid_status',
      });
      const error = doc.validateSync();
      expect(error).toBeDefined();
      expect(error!.errors.status).toBeDefined();
    });

    it('accepts all valid status values', () => {
      for (const status of TenantStatusValues) {
        const doc = new TenantModel({
          slug: `test-${status}`,
          display_name: 'Test',
          status,
        });
        const error = doc.validateSync();
        expect(
          error?.errors.status,
          `status "${status}" should be valid`
        ).toBeUndefined();
      }
    });
  });
});
