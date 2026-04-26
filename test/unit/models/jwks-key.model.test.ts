import { describe, it, expect } from 'vitest';

describe('JwksKey Mongoose Model', () => {
  it('should create a valid model', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    expect(JwksKeyModel.modelName).toBe('JwksKey');
    expect(JwksKeyModel.collection.collectionName).toBe('jwks_keys');
  });

  it('should have required fields in schema', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    const paths = JwksKeyModel.schema.paths;

    expect(paths.kid).toBeDefined();
    expect(paths.alg).toBeDefined();
    expect(paths.use).toBeDefined();
    expect(paths.status).toBeDefined();
    expect(paths.promoted).toBeDefined();
    expect(paths.encrypted_private_key).toBeDefined();
    expect(paths.public_key).toBeDefined();
    expect(paths.tenant_id).toBeDefined();
    expect(paths.created_at).toBeDefined();
    expect(paths.rotated_at).toBeDefined();
  });

  it('should default promoted to true', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    const promotedPath = JwksKeyModel.schema.path('promoted') as any;
    expect(promotedPath.defaultValue).toBe(true);
  });

  it('should have compound indexes', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    const indexes = JwksKeyModel.schema.indexes();

    // Check for { tenant_id: 1, status: 1 } index
    const tenantStatusIdx = indexes.find(
      ([fields]) => fields.tenant_id === 1 && fields.status === 1
    );
    expect(tenantStatusIdx).toBeDefined();

    // Check for { tenant_id: 1, kid: 1 } unique index
    const tenantKidIdx = indexes.find(
      ([fields]) => fields.tenant_id === 1 && fields.kid === 1
    );
    expect(tenantKidIdx).toBeDefined();
    expect(tenantKidIdx![1]).toHaveProperty('unique', true);
  });

  it('should enforce status enum values', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    const statusPath = JwksKeyModel.schema.path('status') as any;
    expect(statusPath.enumValues).toEqual(['active', 'expiring', 'retired']);
  });

  it('should default tenant_id to "default"', async () => {
    const mod = await import('../../../src/models/jwks-key.model');
    const JwksKeyModel = mod.createJwksKeyModel();
    const tenantPath = JwksKeyModel.schema.path('tenant_id') as any;
    expect(tenantPath.defaultValue).toBe('default');
  });
});
