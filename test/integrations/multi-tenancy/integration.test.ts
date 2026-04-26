import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tenantPlugin } from '../../../src/db/plugins/tenant.plugin.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT,
} from '../../../src/multi-tenancy/tenant-context.js';

/**
 * Multi-tenancy integration tests — full lifecycle verification.
 *
 * Uses mongodb-memory-server for real MongoDB integration.
 * Validates that tenant isolation works end-to-end across:
 * - Document creation and querying
 * - Concurrent tenant operations
 * - Default tenant behavior
 * - Cross-tenant count isolation
 * - Tenant model opt-out
 * - Parallel async operations
 */

let mongoServer: MongoMemoryServer;

// Create a realistic model simulating User-like documents
function createScopedModel(name: string) {
  const schema = new mongoose.Schema(
    {
      username: { type: String, required: true },
      email: { type: String },
      status: { type: String, default: 'active' },
    },
    { collection: `int_${name.toLowerCase()}` }
  );
  tenantPlugin(schema);
  delete (mongoose.models as any)[name];
  return mongoose.model(name, schema);
}

// Create a model that opts out of tenant scoping (like the Tenant model)
function createUnscopedModel(name: string) {
  const schema = new mongoose.Schema(
    {
      slug: { type: String, required: true, unique: true },
      display_name: { type: String, required: true },
      status: { type: String, default: 'active' },
    },
    { collection: `int_${name.toLowerCase()}` }
  );
  (schema as any).tenantScoped = false;
  tenantPlugin(schema);
  delete (mongoose.models as any)[name];
  return mongoose.model(name, schema);
}

// Create a model with existing tenant_id (like JwksKey)
function createModelWithExistingTenantId(name: string) {
  const schema = new mongoose.Schema(
    {
      kid: { type: String, required: true },
      algorithm: { type: String, required: true },
      tenant_id: { type: String, required: true, default: 'default' },
    },
    { collection: `int_${name.toLowerCase()}` }
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

describe('Multi-Tenancy Integration', () => {
  // ─── Full Lifecycle ──────────────────────────────────────────────────────────

  describe('Full lifecycle: create, read, update, delete across tenants', () => {
    let UserModel: mongoose.Model<any>;

    beforeAll(() => {
      UserModel = createScopedModel('IntUser');
    });

    beforeEach(async () => {
      await UserModel.deleteMany({});
    });

    it('documents created by tenant-a are invisible to tenant-b', async () => {
      // Tenant A creates users
      await tenantContext.run('acme', async () => {
        await UserModel.create({ username: 'alice', email: 'alice@acme.com' });
        await UserModel.create({ username: 'bob', email: 'bob@acme.com' });
      });

      // Tenant B creates users
      await tenantContext.run('globex', async () => {
        await UserModel.create({
          username: 'charlie',
          email: 'charlie@globex.com',
        });
      });

      // Tenant A only sees its own users
      const acmeUsers = await tenantContext.run('acme', () =>
        UserModel.find({}).lean().exec()
      );
      expect(acmeUsers).toHaveLength(2);
      expect(acmeUsers.map((u: any) => u.username).sort()).toEqual([
        'alice',
        'bob',
      ]);

      // Tenant B only sees its own user
      const globexUsers = await tenantContext.run('globex', () =>
        UserModel.find({}).lean().exec()
      );
      expect(globexUsers).toHaveLength(1);
      expect(globexUsers[0].username).toBe('charlie');
    });

    it('same username can exist in different tenants', async () => {
      await tenantContext.run('acme', () =>
        UserModel.create({ username: 'admin', email: 'admin@acme.com' })
      );
      await tenantContext.run('globex', () =>
        UserModel.create({ username: 'admin', email: 'admin@globex.com' })
      );

      // Both tenants have 'admin' user — no conflict
      const acmeAdmin = await tenantContext.run('acme', () =>
        UserModel.findOne({ username: 'admin' }).lean().exec()
      );
      const globexAdmin = await tenantContext.run('globex', () =>
        UserModel.findOne({ username: 'admin' }).lean().exec()
      );

      expect(acmeAdmin).not.toBeNull();
      expect(globexAdmin).not.toBeNull();
      expect(acmeAdmin!.email).toBe('admin@acme.com');
      expect(globexAdmin!.email).toBe('admin@globex.com');
    });

    it('update in one tenant does not affect another', async () => {
      await tenantContext.run('acme', () =>
        UserModel.create({ username: 'shared-name', status: 'active' })
      );
      await tenantContext.run('globex', () =>
        UserModel.create({ username: 'shared-name', status: 'active' })
      );

      // Update status in acme
      await tenantContext.run('acme', () =>
        UserModel.updateOne(
          { username: 'shared-name' },
          { $set: { status: 'suspended' } }
        ).exec()
      );

      // globex user is untouched
      const globexUser = await tenantContext.run('globex', () =>
        UserModel.findOne({ username: 'shared-name' }).lean().exec()
      );
      expect(globexUser!.status).toBe('active');

      // acme user is updated
      const acmeUser = await tenantContext.run('acme', () =>
        UserModel.findOne({ username: 'shared-name' }).lean().exec()
      );
      expect(acmeUser!.status).toBe('suspended');
    });

    it('delete in one tenant does not affect another', async () => {
      await tenantContext.run('acme', () =>
        UserModel.create({ username: 'deleteme' })
      );
      await tenantContext.run('globex', () =>
        UserModel.create({ username: 'deleteme' })
      );

      await tenantContext.run('acme', () =>
        UserModel.deleteOne({ username: 'deleteme' }).exec()
      );

      // acme user is gone
      const acmeCount = await tenantContext.run('acme', () =>
        UserModel.countDocuments({ username: 'deleteme' }).exec()
      );
      expect(acmeCount).toBe(0);

      // globex user is still there
      const globexCount = await tenantContext.run('globex', () =>
        UserModel.countDocuments({ username: 'deleteme' }).exec()
      );
      expect(globexCount).toBe(1);
    });
  });

  // ─── Concurrent Tenants ──────────────────────────────────────────────────────

  describe('Concurrent tenant operations', () => {
    let ConcModel: mongoose.Model<any>;

    beforeAll(() => {
      ConcModel = createScopedModel('IntConcurrent');
    });

    beforeEach(async () => {
      await ConcModel.deleteMany({});
    });

    it('parallel writes from different tenants maintain isolation', async () => {
      // Simulate concurrent writes from 5 tenants
      const tenants = ['t1', 't2', 't3', 't4', 't5'];
      const docsPerTenant = 3;

      await Promise.all(
        tenants.map(tid =>
          tenantContext.run(tid, async () => {
            const docs = Array.from({ length: docsPerTenant }, (_, i) => ({
              username: `user-${i}`,
              email: `user-${i}@${tid}.com`,
            }));
            await ConcModel.insertMany(docs);
          })
        )
      );

      // Verify each tenant has exactly docsPerTenant documents
      for (const tid of tenants) {
        const count = await tenantContext.run(tid, () =>
          ConcModel.countDocuments({}).exec()
        );
        expect(count, `tenant ${tid} should have ${docsPerTenant} docs`).toBe(
          docsPerTenant
        );
      }

      // Verify total count (bypassing plugin by using raw collection)
      const total = await ConcModel.collection.countDocuments({});
      expect(total).toBe(tenants.length * docsPerTenant);
    });

    it('parallel reads and writes do not leak across tenants', async () => {
      // Seed initial data
      await tenantContext.run('reader', () =>
        ConcModel.create({ username: 'original', status: 'active' })
      );

      // Parallel: writer creates in different tenant, reader reads own
      const [writerResult, readerResult] = await Promise.all([
        tenantContext.run('writer', async () => {
          await ConcModel.create({ username: 'new-doc', status: 'active' });
          return ConcModel.find({}).lean().exec();
        }),
        tenantContext.run('reader', async () => {
          return ConcModel.find({}).lean().exec();
        }),
      ]);

      // Writer sees only its own document
      expect(writerResult).toHaveLength(1);
      expect(writerResult[0].username).toBe('new-doc');

      // Reader sees only its own document
      expect(readerResult).toHaveLength(1);
      expect(readerResult[0].username).toBe('original');
    });
  });

  // ─── Default Tenant ──────────────────────────────────────────────────────────

  describe('Default tenant behavior', () => {
    let DefModel: mongoose.Model<any>;

    beforeAll(() => {
      DefModel = createScopedModel('IntDefault');
    });

    beforeEach(async () => {
      await DefModel.deleteMany({});
    });

    it('documents without context go to DEFAULT_TENANT_ID', async () => {
      // Create outside any tenantContext.run()
      const doc = await DefModel.create({
        username: 'no-context',
        email: 'test@default.com',
      });
      expect(doc.tenant_id).toBe(DEFAULT_TENANT_ID);
    });

    it('DEFAULT_TENANT documents are isolated from named tenants', async () => {
      // Create in default tenant
      await DefModel.create({ username: 'default-user' });

      // Create in named tenant
      await tenantContext.run('named', () =>
        DefModel.create({ username: 'named-user' })
      );

      // Default tenant sees only its doc
      const defaultDocs = await DefModel.find({}).lean().exec();
      expect(defaultDocs).toHaveLength(1);
      expect(defaultDocs[0].username).toBe('default-user');

      // Named tenant sees only its doc
      const namedDocs = await tenantContext.run('named', () =>
        DefModel.find({}).lean().exec()
      );
      expect(namedDocs).toHaveLength(1);
      expect(namedDocs[0].username).toBe('named-user');
    });

    it('DEFAULT_TENANT frozen object has correct shape', () => {
      expect(DEFAULT_TENANT).toBeDefined();
      expect(DEFAULT_TENANT.id).toBe('default');
      expect(DEFAULT_TENANT.slug).toBe('default');
      expect(DEFAULT_TENANT.display_name).toBe('Default');
      expect(DEFAULT_TENANT.status).toBe('active');
      expect(Object.isFrozen(DEFAULT_TENANT)).toBe(true);
    });
  });

  // ─── Cross-Tenant Count ──────────────────────────────────────────────────────

  describe('Cross-tenant count isolation', () => {
    let CountModel: mongoose.Model<any>;

    beforeAll(async () => {
      CountModel = createScopedModel('IntCount');
      await CountModel.deleteMany({});

      // Seed: 5 docs in alpha, 3 in beta, 1 in gamma
      await tenantContext.run('alpha', () =>
        CountModel.insertMany(
          Array.from({ length: 5 }, (_, i) => ({ username: `a-${i}` }))
        )
      );
      await tenantContext.run('beta', () =>
        CountModel.insertMany(
          Array.from({ length: 3 }, (_, i) => ({ username: `b-${i}` }))
        )
      );
      await tenantContext.run('gamma', () =>
        CountModel.create({ username: 'g-0' })
      );
    });

    it('countDocuments respects tenant boundary', async () => {
      const alphaCount = await tenantContext.run('alpha', () =>
        CountModel.countDocuments({}).exec()
      );
      const betaCount = await tenantContext.run('beta', () =>
        CountModel.countDocuments({}).exec()
      );
      const gammaCount = await tenantContext.run('gamma', () =>
        CountModel.countDocuments({}).exec()
      );

      expect(alphaCount).toBe(5);
      expect(betaCount).toBe(3);
      expect(gammaCount).toBe(1);
    });

    it('aggregate count respects tenant boundary', async () => {
      const result = await tenantContext.run('beta', () =>
        CountModel.aggregate([
          { $group: { _id: null, total: { $sum: 1 } } },
        ]).exec()
      );
      expect(result[0].total).toBe(3);
    });
  });

  // ─── Tenant Model Opt-Out ────────────────────────────────────────────────────

  describe('Tenant model opt-out', () => {
    it('unscoped model does NOT get tenant_id field', () => {
      const TenantModel = createUnscopedModel('IntTenantRegistry');
      expect(TenantModel.schema.paths.tenant_id).toBeUndefined();
    });

    it('unscoped model stores and retrieves without tenant filtering', async () => {
      const TenantModel = createUnscopedModel('IntTenantReg2');
      await TenantModel.deleteMany({});

      // Create from different tenant contexts — all should be visible globally
      await tenantContext.run('acme', () =>
        TenantModel.create({ slug: 'acme', display_name: 'Acme Corp' })
      );
      await tenantContext.run('globex', () =>
        TenantModel.create({ slug: 'globex', display_name: 'Globex Inc' })
      );

      // Query from any context — sees all records
      const allTenants = await tenantContext.run('random', () =>
        TenantModel.find({}).lean().exec()
      );
      expect(allTenants).toHaveLength(2);
      expect(allTenants.map((t: any) => t.slug).sort()).toEqual([
        'acme',
        'globex',
      ]);
    });
  });

  // ─── Existing tenant_id Field (JwksKey pattern) ──────────────────────────────

  describe('Models with existing tenant_id (JwksKey pattern)', () => {
    let KeyModel: mongoose.Model<any>;

    beforeAll(async () => {
      KeyModel = createModelWithExistingTenantId('IntJwksKey');
      await KeyModel.deleteMany({});
    });

    it('respects tenant_id from context even on models with existing field', async () => {
      await tenantContext.run('acme', () =>
        KeyModel.create({ kid: 'key-1', algorithm: 'RS256' })
      );
      await tenantContext.run('globex', () =>
        KeyModel.create({ kid: 'key-2', algorithm: 'ES256' })
      );

      const acmeKeys = await tenantContext.run('acme', () =>
        KeyModel.find({}).lean().exec()
      );
      expect(acmeKeys).toHaveLength(1);
      expect(acmeKeys[0].kid).toBe('key-1');
      expect(acmeKeys[0].tenant_id).toBe('acme');

      const globexKeys = await tenantContext.run('globex', () =>
        KeyModel.find({}).lean().exec()
      );
      expect(globexKeys).toHaveLength(1);
      expect(globexKeys[0].kid).toBe('key-2');
      expect(globexKeys[0].tenant_id).toBe('globex');
    });
  });

  // ─── AsyncLocalStorage Propagation ───────────────────────────────────────────

  describe('AsyncLocalStorage propagation across async boundaries', () => {
    let AsyncModel: mongoose.Model<any>;

    beforeAll(async () => {
      AsyncModel = createScopedModel('IntAsync');
      await AsyncModel.deleteMany({});
    });

    it('tenant context propagates through Promise chains', async () => {
      await tenantContext.run('promise-tenant', async () => {
        // Chain multiple async operations
        await AsyncModel.create({ username: 'step-1' });
        await new Promise(resolve => setTimeout(resolve, 10));
        await AsyncModel.create({ username: 'step-2' });

        const docs = await AsyncModel.find({}).lean().exec();
        expect(docs).toHaveLength(2);
        expect(docs.every((d: any) => d.tenant_id === 'promise-tenant')).toBe(
          true
        );
      });
    });

    it('nested tenantContext.run() overrides parent context', async () => {
      await tenantContext.run('outer', async () => {
        await AsyncModel.create({ username: 'outer-doc' });

        await tenantContext.run('inner', async () => {
          await AsyncModel.create({ username: 'inner-doc' });

          // Inner context should only see inner docs
          const innerDocs = await AsyncModel.find({}).lean().exec();
          expect(innerDocs.every((d: any) => d.tenant_id === 'inner')).toBe(
            true
          );
        });

        // Back to outer context — should see outer docs
        const outerDocs = await AsyncModel.find({}).lean().exec();
        expect(outerDocs.every((d: any) => d.tenant_id === 'outer')).toBe(true);
      });
    });
  });
});
