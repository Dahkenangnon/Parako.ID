import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tenantPlugin } from '../../../../src/db/plugins/tenant.plugin.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../../src/multi-tenancy/tenant-context.js';

let mongoServer: MongoMemoryServer;

// Helper: create a test schema with the tenant plugin applied
function createTestModel(name: string, opts?: { tenantScoped?: boolean }) {
  const schema = new mongoose.Schema(
    {
      title: { type: String, required: true },
    },
    { collection: `test_${name.toLowerCase()}` }
  );

  if (opts?.tenantScoped === false) {
    (schema as any).tenantScoped = false;
  }

  tenantPlugin(schema);

  // Clear model cache to avoid OverwriteModelError
  delete (mongoose.models as any)[name];
  return mongoose.model(name, schema);
}

// Helper: create schema that already has tenant_id (like JwksKey)
function createModelWithExistingTenantId(name: string) {
  const schema = new mongoose.Schema(
    {
      title: { type: String, required: true },
      tenant_id: { type: String, required: true, default: 'default' },
    },
    { collection: `test_${name.toLowerCase()}` }
  );

  tenantPlugin(schema);

  delete (mongoose.models as any)[name];
  return mongoose.model(name, schema);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('tenantPlugin', () => {
  describe('opt-out mechanism', () => {
    it('skips schemas marked with tenantScoped = false', () => {
      const Model = createTestModel('OptedOut', { tenantScoped: false });
      expect(Model.schema.paths.tenant_id).toBeUndefined();
    });

    it('adds tenant_id to schemas without opt-out', () => {
      const Model = createTestModel('OptedIn');
      expect(Model.schema.paths.tenant_id).toBeDefined();
    });
  });

  describe('existing field detection', () => {
    it('does not duplicate tenant_id on schemas that already have it', () => {
      const Model = createModelWithExistingTenantId('WithExisting');
      // Should still have tenant_id but not duplicated
      expect(Model.schema.paths.tenant_id).toBeDefined();
      // Verify the original default is preserved
      const tenantPath = Model.schema.path('tenant_id') as any;
      expect(tenantPath.defaultValue).toBe('default');
    });
  });

  describe('save hook', () => {
    let ScopedModel: mongoose.Model<any>;

    beforeAll(() => {
      ScopedModel = createTestModel('SaveTest');
    });

    beforeEach(async () => {
      await ScopedModel.deleteMany({});
    });

    it('injects tenant_id from AsyncLocalStorage on create', async () => {
      const doc = await tenantContext.run('tenant-save', () =>
        ScopedModel.create({ title: 'scoped doc' })
      );
      expect(doc.tenant_id).toBe('tenant-save');
    });

    it('uses DEFAULT_TENANT_ID when no context is active', async () => {
      const doc = await ScopedModel.create({ title: 'unscoped doc' });
      expect(doc.tenant_id).toBe(DEFAULT_TENANT_ID);
    });
  });

  describe('query hooks — tenant isolation', () => {
    let IsoModel: mongoose.Model<any>;

    beforeAll(async () => {
      IsoModel = createTestModel('IsolationTest');
      await IsoModel.deleteMany({});

      // Seed data for two tenants
      await tenantContext.run('alpha', () =>
        IsoModel.create([
          { title: 'alpha-1' },
          { title: 'alpha-2' },
          { title: 'alpha-3' },
        ])
      );
      await tenantContext.run('beta', () =>
        IsoModel.create([{ title: 'beta-1' }, { title: 'beta-2' }])
      );
    });

    it('find() only returns documents for the active tenant', async () => {
      const alphaDocs = await tenantContext.run('alpha', () =>
        IsoModel.find({}).lean().exec()
      );
      expect(alphaDocs).toHaveLength(3);
      expect(alphaDocs.every((d: any) => d.tenant_id === 'alpha')).toBe(true);
    });

    it('findOne() only matches documents for the active tenant', async () => {
      const doc = await tenantContext.run('beta', () =>
        IsoModel.findOne({ title: 'alpha-1' }).lean().exec()
      );
      // beta cannot see alpha's documents
      expect(doc).toBeNull();
    });

    it('countDocuments() respects tenant boundary', async () => {
      const alphaCount = await tenantContext.run('alpha', () =>
        IsoModel.countDocuments({}).exec()
      );
      const betaCount = await tenantContext.run('beta', () =>
        IsoModel.countDocuments({}).exec()
      );
      expect(alphaCount).toBe(3);
      expect(betaCount).toBe(2);
    });

    it('updateOne() only affects the active tenant', async () => {
      await tenantContext.run('beta', () =>
        IsoModel.updateOne(
          { title: 'alpha-1' },
          { $set: { title: 'hacked' } }
        ).exec()
      );
      // alpha-1 should be untouched
      const doc = await tenantContext.run('alpha', () =>
        IsoModel.findOne({ title: 'alpha-1' }).lean().exec()
      );
      expect(doc).not.toBeNull();
    });

    it('deleteOne() only removes from the active tenant', async () => {
      // Create a doc in beta to delete
      await tenantContext.run('beta', () =>
        IsoModel.create({ title: 'beta-delete-me' })
      );
      // Try to delete it as alpha — should not find it
      const result = await tenantContext.run('alpha', () =>
        IsoModel.deleteOne({ title: 'beta-delete-me' }).exec()
      );
      expect(result.deletedCount).toBe(0);
      // Clean up from beta
      await tenantContext.run('beta', () =>
        IsoModel.deleteOne({ title: 'beta-delete-me' }).exec()
      );
    });
  });

  describe('insertMany hook', () => {
    let BulkModel: mongoose.Model<any>;

    beforeAll(() => {
      BulkModel = createTestModel('BulkTest');
    });

    beforeEach(async () => {
      await BulkModel.deleteMany({});
    });

    it('sets tenant_id on all docs during insertMany', async () => {
      const docs = await tenantContext.run('bulk-tenant', () =>
        BulkModel.insertMany([{ title: 'bulk-1' }, { title: 'bulk-2' }])
      );
      expect(docs).toHaveLength(2);
      expect(docs.every((d: any) => d.tenant_id === 'bulk-tenant')).toBe(true);
    });
  });

  describe('aggregate hook', () => {
    let AggModel: mongoose.Model<any>;

    beforeAll(async () => {
      AggModel = createTestModel('AggregateTest');
      await AggModel.deleteMany({});

      // Seed data for two tenants
      await tenantContext.run('agg-alpha', () =>
        AggModel.create([
          { title: 'agg-a1' },
          { title: 'agg-a2' },
          { title: 'agg-a3' },
        ])
      );
      await tenantContext.run('agg-beta', () =>
        AggModel.create([{ title: 'agg-b1' }])
      );
    });

    it('aggregate() is scoped to the active tenant', async () => {
      // .exec() must be called inside run() so the pre-aggregate hook
      // fires within the ALS context (matches production: all DB ops
      // execute inside the middleware's tenantContext.run() scope).
      const result = await tenantContext.run('agg-alpha', () =>
        AggModel.aggregate([
          { $group: { _id: null, count: { $sum: 1 } } },
        ]).exec()
      );
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(3);
    });

    it('aggregate() from a different tenant does not see other tenant data', async () => {
      const result = await tenantContext.run('agg-beta', () =>
        AggModel.aggregate([
          { $group: { _id: null, count: { $sum: 1 } } },
        ]).exec()
      );
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(1);
    });
  });

  describe('cross-tenant isolation (end-to-end)', () => {
    let E2EModel: mongoose.Model<any>;

    beforeAll(async () => {
      E2EModel = createTestModel('E2EIsolation');
      await E2EModel.deleteMany({});
    });

    it('tenant A cannot read, update, or delete tenant B documents', async () => {
      // Create as tenant-x
      await tenantContext.run('tenant-x', () =>
        E2EModel.create({ title: 'secret-x' })
      );

      // tenant-y cannot find it
      const found = await tenantContext.run('tenant-y', () =>
        E2EModel.findOne({ title: 'secret-x' }).lean().exec()
      );
      expect(found).toBeNull();

      // tenant-y cannot count it
      const count = await tenantContext.run('tenant-y', () =>
        E2EModel.countDocuments({ title: 'secret-x' }).exec()
      );
      expect(count).toBe(0);

      // tenant-y cannot update it
      const updateResult = await tenantContext.run('tenant-y', () =>
        E2EModel.updateOne(
          { title: 'secret-x' },
          { $set: { title: 'pwned' } }
        ).exec()
      );
      expect(updateResult.matchedCount).toBe(0);

      // tenant-y cannot delete it
      const deleteResult = await tenantContext.run('tenant-y', () =>
        E2EModel.deleteOne({ title: 'secret-x' }).exec()
      );
      expect(deleteResult.deletedCount).toBe(0);

      // tenant-x can still find it (untouched)
      const verified = await tenantContext.run('tenant-x', () =>
        E2EModel.findOne({ title: 'secret-x' }).lean().exec()
      );
      expect(verified).not.toBeNull();
    });
  });
});
