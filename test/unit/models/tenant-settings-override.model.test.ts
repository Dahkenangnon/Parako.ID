import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTenantSettingsOverrideModel,
  type TenantSettingsOverrideModel,
} from '../../../src/models/tenant-settings-override/model.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

describe('TenantSettingsOverride Mongoose model', () => {
  let Overrides: TenantSettingsOverrideModel;

  beforeAll(() => {
    if (mongoose.models.TenantSettingsOverride) {
      mongoose.deleteModel('TenantSettingsOverride');
    }
    Overrides = createTenantSettingsOverrideModel();
  });

  afterAll(() => {
    mongoose.deleteModel('TenantSettingsOverride');
  });

  it('pins the deployed collection name and applies tenant-aware defaults', () => {
    const defaultOverride = new Overrides();
    const tenantOverride = tenantContext.run(
      'tenant-a',
      () => new Overrides({ key: '  custom_config  ' })
    );

    expect(Overrides.collection.collectionName).toBe('tenantsettingsoverrides');
    expect(Overrides.schema.options.collection).toBe('tenantsettingsoverrides');
    expect(defaultOverride).toMatchObject({
      tenant_id: 'default',
      key: 'parako_config',
      version: '1.0.0',
      _version: 0,
      is_active: true,
    });
    expect(tenantOverride).toMatchObject({
      tenant_id: 'tenant-a',
      key: 'custom_config',
    });
  });

  it('reuses the registered tenant-scoped model with shared plugins', () => {
    expect(createTenantSettingsOverrideModel()).toBe(Overrides);
    expect((Overrides.schema as any)._tenantPluginApplied).toBe(true);
    expect(Overrides.schema.path('tenant_id')?.options).toMatchObject({
      required: true,
      index: true,
    });
    expect(Overrides.schema.options.timestamps).toEqual({
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
    expect(typeof Overrides.paginate).toBe('function');
  });

  it('can compile an isolated model registry for concurrent database harnesses', () => {
    const isolatedMongoose = new mongoose.Mongoose();

    expect(createTenantSettingsOverrideModel(isolatedMongoose)).not.toBe(
      Overrides
    );
    expect(isolatedMongoose.models.TenantSettingsOverride).toBeDefined();
  });

  it('persists only whitelisted override sections and serializes public ids', () => {
    const override = new Overrides({
      application: { title: 'Tenant application' },
      branding: { colors: { primary: '#123456' } },
      security: { sessions: { maxConcurrent: 3 } },
      features: { registration: false },
      oidc: { ttl: { access_token: 900 } },
      integrations: { smtp: { host: 'smtp.example.test' } },
      notifications: { defaults: { security_alerts: true } },
      metadata: {
        last_modified_by: 'admin@example.test',
        change_reason: 'Demo branding',
        ignored: 'not a managed metadata field',
      },
      unknown_section: { should_not_persist: true },
    } as any);

    const serialized = override.toJSON() as Record<string, any>;

    expect(serialized).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      tenant_id: 'default',
      application: { title: 'Tenant application' },
      branding: { colors: { primary: '#123456' } },
      security: { sessions: { maxConcurrent: 3 } },
      features: { registration: false },
      oidc: { ttl: { access_token: 900 } },
      integrations: { smtp: { host: 'smtp.example.test' } },
      notifications: { defaults: { security_alerts: true } },
      metadata: {
        last_modified_by: 'admin@example.test',
        change_reason: 'Demo branding',
      },
    });
    expect(serialized).not.toHaveProperty('_id');
    expect(serialized).not.toHaveProperty('__v');
    expect(serialized).not.toHaveProperty('unknown_section');
    expect(serialized.metadata).not.toHaveProperty('ignored');
  });

  it('rejects empty or missing managed version fields', async () => {
    const override = new Overrides({
      key: '   ',
      version: null,
      _version: null,
    });

    await expect(override.validate()).rejects.toMatchObject({
      errors: {
        key: expect.any(mongoose.Error.ValidatorError),
        version: expect.any(mongoose.Error.ValidatorError),
        _version: expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it('enforces one active override for each tenant and key', () => {
    expect(Overrides.schema.indexes()).toContainEqual([
      { tenant_id: 1, key: 1, is_active: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { is_active: true },
        name: 'tso_tenant_key_active_unique',
      }),
    ]);
  });
});
