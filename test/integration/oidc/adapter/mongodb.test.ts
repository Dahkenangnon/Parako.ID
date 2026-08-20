import { randomBytes } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { defineOidcClientAdminContract } from '../../../contract/support/oidc-client-admin-contract.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';
import OIDCMongoAdapter, {
  createMongoAdapterFactory,
} from '../../../../src/oidc/adapter/mongodb/index.js';
import { MongodbOidcAdminService } from '../../../../src/oidc/adapter/mongodb/admin-service.js';

const logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
} as unknown as ILogger;

let mongoServer: MongoMemoryServer | undefined;
let mongoClient: MongoClient | undefined;
let database: Db;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
  mongoServer = await MongoMemoryServer.create();
  mongoClient = await MongoClient.connect(mongoServer.getUri());
  database = mongoClient.db('parako-oidc-adapter-test');
}, 60_000);

afterAll(async () => {
  await mongoClient?.close();
  await mongoServer?.stop();
  if (originalEncryptionKey) {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  } else {
    delete process.env.ENCRYPTION_KEY;
  }
});

beforeEach(async () => {
  await database.dropDatabase();
});

describe('OIDCMongoAdapter', () => {
  it('lists only active model records owned by the current tenant', async () => {
    const adapter = new OIDCMongoAdapter(
      'InitialAccessToken',
      database,
      logger
    );

    await tenantContext.run('tenant-a', async () => {
      await adapter.upsert(
        'active-a',
        { jti: 'active-a', iat: 100, exp: 200 },
        60
      );
      await adapter.upsert(
        'expired-a',
        { jti: 'expired-a', iat: 100, exp: 101 },
        -60
      );
    });
    await tenantContext.run('tenant-b', () =>
      adapter.upsert('active-b', { jti: 'active-b', iat: 100, exp: 200 }, 60)
    );
    await tenantContext.run('tenant-a', () =>
      new OIDCMongoAdapter('Session', database, logger).upsert(
        'session-a',
        { jti: 'session-a' },
        60
      )
    );

    await expect(
      tenantContext.run('tenant-a', () =>
        (adapter as unknown as { findAll(): Promise<unknown[]> }).findAll()
      )
    ).resolves.toEqual([
      { jti: 'active-a', iat: 100, exp: 200, _id: 'active-a' },
    ]);
  });

  it('stores the same model ID independently for different tenants', async () => {
    const adapter = new OIDCMongoAdapter('AccessToken', database, logger);

    await tenantContext.run('tenant-a', () =>
      adapter.upsert('shared-id', { accountId: 'account-a' }, 60)
    );
    await tenantContext.run('tenant-b', () =>
      adapter.upsert('shared-id', { accountId: 'account-b' }, 60)
    );

    await expect(
      tenantContext.run('tenant-a', () => adapter.find('shared-id'))
    ).resolves.toMatchObject({ accountId: 'account-a' });
    await expect(
      tenantContext.run('tenant-b', () => adapter.find('shared-id'))
    ).resolves.toMatchObject({ accountId: 'account-b' });
  });

  it('allows the same DeviceCode user code in different tenants', async () => {
    const factory = createMongoAdapterFactory(database, logger);
    const adapter = factory('DeviceCode');

    await vi.waitFor(async () => {
      await expect(
        database
          .collection('DeviceCode')
          .indexExists('tenant_id_1_payload.userCode_1')
      ).resolves.toBe(true);
    });

    await tenantContext.run('tenant-a', () =>
      adapter.upsert('device-a', { userCode: 'SHARED-CODE' }, 60)
    );
    await tenantContext.run('tenant-b', () =>
      adapter.upsert('device-b', { userCode: 'SHARED-CODE' }, 60)
    );

    await expect(
      tenantContext.run('tenant-a', () => adapter.findByUserCode('SHARED-CODE'))
    ).resolves.toMatchObject({ userCode: 'SHARED-CODE' });
    await expect(
      tenantContext.run('tenant-b', () => adapter.findByUserCode('SHARED-CODE'))
    ).resolves.toMatchObject({ userCode: 'SHARED-CODE' });
  });

  it('allows the same Session UID in different tenants', async () => {
    const factory = createMongoAdapterFactory(database, logger);
    const adapter = factory('Session');

    await vi.waitFor(async () => {
      await expect(
        database.collection('Session').indexExists('tenant_id_1_payload.uid_1')
      ).resolves.toBe(true);
    });

    await tenantContext.run('tenant-a', () =>
      adapter.upsert('session-a', { uid: 'shared-uid' }, 60)
    );
    await tenantContext.run('tenant-b', () =>
      adapter.upsert('session-b', { uid: 'shared-uid' }, 60)
    );

    await expect(
      tenantContext.run('tenant-a', () => adapter.findByUid('shared-uid'))
    ).resolves.toMatchObject({ uid: 'shared-uid' });
    await expect(
      tenantContext.run('tenant-b', () => adapter.findByUid('shared-uid'))
    ).resolves.toMatchObject({ uid: 'shared-uid' });
  });

  it('rejects duplicate DeviceCode user codes within one tenant', async () => {
    const factory = createMongoAdapterFactory(database, logger);
    const adapter = factory('DeviceCode');

    await vi.waitFor(async () => {
      await expect(
        database
          .collection('DeviceCode')
          .indexExists('tenant_id_1_payload.userCode_1')
      ).resolves.toBe(true);
    });

    await tenantContext.run('tenant-a', () =>
      adapter.upsert('device-a', { userCode: 'DUPLICATE-CODE' }, 60)
    );

    await expect(
      tenantContext.run('tenant-a', () =>
        adapter.upsert('device-b', { userCode: 'DUPLICATE-CODE' }, 60)
      )
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('replaces a legacy global DeviceCode index without losing data', async () => {
    const collection = database.collection<{
      _id: string;
      tenant_id: string;
      payload: { userCode: string };
    }>('DeviceCode');
    await collection.insertOne({
      _id: 'legacy-device',
      tenant_id: 'default',
      payload: { userCode: 'LEGACY-CODE' },
    });
    await collection.createIndex({ 'payload.userCode': 1 }, { unique: true });

    const factory = createMongoAdapterFactory(database, logger);
    const adapter = factory('DeviceCode');

    await vi.waitFor(async () => {
      await expect(
        collection.indexExists('tenant_id_1_payload.userCode_1')
      ).resolves.toBe(true);
      await expect(collection.indexExists('payload.userCode_1')).resolves.toBe(
        false
      );
    });

    await expect(adapter.findByUserCode('LEGACY-CODE')).resolves.toMatchObject({
      userCode: 'LEGACY-CODE',
    });
    await tenantContext.run('tenant-b', () =>
      adapter.upsert('new-device', { userCode: 'LEGACY-CODE' }, 60)
    );
    await expect(collection.countDocuments()).resolves.toBe(2);
  });

  it('creates and finds the same client ID independently across tenants', async () => {
    const service = new MongodbOidcAdminService('Client', database, logger);
    const clientData = {
      client_id: 'shared-client',
      client_name: 'Shared client',
      redirect_uris: ['https://client.example/callback'],
    };

    await tenantContext.run('tenant-a', () => service.createClient(clientData));
    await tenantContext.run('tenant-b', () => service.createClient(clientData));

    await expect(
      tenantContext.run('tenant-a', () =>
        service.findClientById('shared-client')
      )
    ).resolves.toMatchObject({ client_id: 'shared-client' });
    await expect(
      tenantContext.run('tenant-b', () =>
        service.findClientById('shared-client')
      )
    ).resolves.toMatchObject({ client_id: 'shared-client' });
    await expect(database.collection('Client').countDocuments()).resolves.toBe(
      2
    );
  });

  it('bulk-deletes sessions only from the current tenant', async () => {
    const adapter = new OIDCMongoAdapter('Session', database, logger);
    const service = new MongodbOidcAdminService('Session', database, logger);

    await tenantContext.run('tenant-a', () =>
      adapter.upsert(
        'session-a',
        { accountId: 'shared-account', kind: 'Session' },
        60
      )
    );
    await tenantContext.run('tenant-b', () =>
      adapter.upsert(
        'session-b',
        { accountId: 'shared-account', kind: 'Session' },
        60
      )
    );

    await expect(
      tenantContext.run('tenant-a', () =>
        service.deleteSessionsByAccountId('shared-account')
      )
    ).resolves.toEqual({ deletedCount: 1 });
    await expect(
      tenantContext.run('tenant-a', () => adapter.find('session-a'))
    ).resolves.toBeUndefined();
    await expect(
      tenantContext.run('tenant-b', () => adapter.find('session-b'))
    ).resolves.toMatchObject({ accountId: 'shared-account' });
  });
});

defineOidcClientAdminContract({
  backend: 'MongoDB',
  async createHarness() {
    return {
      client: new MongodbOidcAdminService('Client', database, logger),
      supportsTenantIsolation: true,
      reset: async () => {
        await database.dropDatabase();
      },
      runAsTenant: (tenantId, operation) =>
        tenantContext.run(tenantId, operation),
    };
  },
});
