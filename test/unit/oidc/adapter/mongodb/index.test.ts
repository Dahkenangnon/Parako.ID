import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import OIDCMongoAdapter, {
  connectMongoDB,
  createMongoAdapterFactory,
} from '../../../../../src/oidc/adapter/mongodb/index.js';

function createLogger(): ILogger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as ILogger;
}

describe('OIDCMongoAdapter', () => {
  let adapter: OIDCMongoAdapter;
  let logger: ILogger;
  let collection: ReturnType<typeof createCollectionBoundary>;
  let database: { collection: ReturnType<typeof vi.fn> };

  function createCollectionBoundary() {
    const cursor = {
      toArray: vi.fn().mockResolvedValue([]),
    };
    return {
      cursor,
      createIndexes: vi.fn().mockResolvedValue([]),
      dropIndex: vi.fn().mockResolvedValue(undefined),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      findOne: vi.fn().mockResolvedValue(null),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
      countDocuments: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockReturnValue(cursor),
    };
  }

  beforeEach(() => {
    logger = createLogger();
    collection = createCollectionBoundary();
    database = { collection: vi.fn().mockReturnValue(collection) };
    adapter = new OIDCMongoAdapter('Session', database as never, logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps valid epoch timestamps instead of dropping zero values', () => {
    expect(
      adapter.mapDocumentToUI({
        _id: 'physical-session-id',
        logical_id: 'session-id',
        payload: { loginTs: 0, exp: 0, iat: 0 },
      })
    ).toEqual({
      id: 'session-id',
      expiresAt: undefined,
      customData: {},
      loginTs: new Date(0),
      expiration: new Date(0),
      issuedAt: new Date(0),
    });
  });

  it('rejects whitespace-only custom field names without querying MongoDB', async () => {
    await expect(adapter.findByCustomField('   ', 'value')).resolves.toEqual(
      []
    );
    expect(collection.find).not.toHaveBeenCalled();
  });

  it('replaces the legacy global DeviceCode user-code index', async () => {
    const indexCollection = {
      createIndexes: vi.fn().mockResolvedValue([]),
      dropIndex: vi.fn().mockResolvedValue(undefined),
    };
    const database = {
      collection: vi.fn().mockReturnValue(indexCollection),
    };
    const factory = createMongoAdapterFactory(
      database as never,
      createLogger()
    );

    factory('DeviceCode');
    await vi.waitFor(() => {
      expect(indexCollection.dropIndex).toHaveBeenCalledWith(
        'payload.userCode_1'
      );
    });
  });

  it('creates tenant-aware indexes once per model', async () => {
    const factory = createMongoAdapterFactory(database as never, logger);

    const first = factory('DeviceCode');
    const second = factory('DeviceCode');
    factory('Session');
    factory('AccessToken');
    factory('Interaction');

    expect(first).toBeInstanceOf(OIDCMongoAdapter);
    expect(second).toBeInstanceOf(OIDCMongoAdapter);
    expect(collection.createIndexes).toHaveBeenCalledTimes(4);
    expect(collection.createIndexes).toHaveBeenCalledWith([
      { key: { tenant_id: 1, 'payload.grantId': 1 } },
      {
        key: { tenant_id: 1, 'payload.userCode': 1 },
        unique: true,
      },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
    expect(collection.createIndexes).toHaveBeenCalledWith([
      { key: { tenant_id: 1, 'payload.uid': 1 }, unique: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
    expect(collection.createIndexes).toHaveBeenCalledWith([
      { key: { tenant_id: 1, 'payload.grantId': 1 } },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
    await vi.waitFor(() => {
      expect(collection.dropIndex).toHaveBeenCalledWith('payload.uid_1');
    });
  });

  it.each([
    [new Error('index creation failed'), 'index creation failed'],
    ['index creation failed', 'index creation failed'],
  ])(
    'warns when background index creation rejects with %j',
    async (error, _message) => {
      collection.createIndexes.mockRejectedValueOnce(error);
      const factory = createMongoAdapterFactory(database as never, logger);

      factory('AccessToken');

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          'Background OIDC index creation failed; queries will use collection scan',
          expect.objectContaining({
            collection: 'AccessToken',
            step: 'oidc-mongo-index-create',
            err: 'index creation failed',
          })
        );
      });
    }
  );

  it.each([
    [new Error('synchronous index failure'), 'synchronous index failure'],
    ['synchronous index failure', 'synchronous index failure'],
  ])(
    'warns when index creation throws synchronously with %j',
    (error, _message) => {
      collection.createIndexes.mockImplementationOnce(() => {
        throw error;
      });
      const factory = createMongoAdapterFactory(database as never, logger);

      factory('Session');

      expect(logger.warn).toHaveBeenCalledWith(
        'OIDC index creation threw synchronously; continuing without indexes',
        expect.objectContaining({
          collection: 'Session',
          step: 'oidc-mongo-index-create',
          err: 'synchronous index failure',
        })
      );
    }
  );

  it('ignores a missing legacy index during cleanup', async () => {
    collection.dropIndex.mockRejectedValueOnce({ code: 27 });
    const factory = createMongoAdapterFactory(database as never, logger);

    factory('Session');

    await vi.waitFor(() => expect(collection.dropIndex).toHaveBeenCalled());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('cleanup failed'), 'cleanup failed'],
    ['cleanup failed', 'cleanup failed'],
  ])(
    'warns when legacy index cleanup fails with %j',
    async (error, _message) => {
      collection.dropIndex.mockRejectedValueOnce(error);
      const factory = createMongoAdapterFactory(database as never, logger);

      factory('Session');

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          'Legacy OIDC unique index cleanup failed',
          expect.objectContaining({
            collection: 'Session',
            index: 'payload.uid_1',
            step: 'oidc-mongo-index-cleanup',
            err: 'cleanup failed',
          })
        );
      });
    }
  );

  it('decrypts and sanitizes Client metadata returned from MongoDB', async () => {
    collection.findOne.mockResolvedValueOnce({
      payload: {
        client_id: 'client-1',
        client_name: 'Client one',
        client_secret: 'plain-secret',
        logo_uri: '',
        policy_uri: null,
      },
    });
    const clientAdapter = new OIDCMongoAdapter(
      'Client',
      database as never,
      logger
    );

    await expect(clientAdapter.find('client-1')).resolves.toEqual({
      client_id: 'client-1',
      client_name: 'Client one',
      client_secret: 'plain-secret',
    });
  });

  it('sanitizes public Client metadata without a secret', async () => {
    collection.findOne.mockResolvedValueOnce({
      payload: {
        client_id: 'public-client',
        client_name: 'Public client',
        logo_uri: '',
      },
    });
    const clientAdapter = new OIDCMongoAdapter(
      'Client',
      database as never,
      logger
    );

    await expect(clientAdapter.find('public-client')).resolves.toEqual({
      client_id: 'public-client',
      client_name: 'Public client',
    });
  });

  it('lists active tenant records with logical and physical identifiers', async () => {
    collection.cursor.toArray.mockResolvedValueOnce([
      { _id: 'physical-1', logical_id: 'logical-1', payload: { iat: 1 } },
      { _id: 'physical-2', payload: { iat: 2 } },
    ]);

    await expect(adapter.findAll()).resolves.toEqual([
      { iat: 1, _id: 'logical-1' },
      { iat: 2, _id: 'physical-2' },
    ]);
    expect(collection.find).toHaveBeenCalledWith(
      {
        tenant_id: 'default',
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: expect.any(Date) } },
        ],
      },
      { projection: { _id: 1, logical_id: 1, payload: 1 } }
    );
  });

  it('logs and rethrows registration-token listing failures', async () => {
    const storageError = new Error('findAll failed');
    collection.cursor.toArray.mockRejectedValueOnce(storageError);

    await expect(adapter.findAll()).rejects.toBe(storageError);
    expect(logger.error).toHaveBeenCalledWith(storageError, {
      context: 'Error in Session.findAll',
    });
  });

  it('finds a DeviceCode by user code within the current tenant', async () => {
    const payload = { userCode: 'USER-CODE', clientId: 'client-1' };
    collection.findOne.mockResolvedValueOnce({ payload });
    const deviceAdapter = new OIDCMongoAdapter(
      'DeviceCode',
      database as never,
      logger
    );

    await expect(deviceAdapter.findByUserCode('USER-CODE')).resolves.toBe(
      payload
    );
    expect(collection.findOne).toHaveBeenCalledWith(
      { 'payload.userCode': 'USER-CODE', tenant_id: 'default' },
      { projection: { payload: 1 } }
    );
  });

  it('finds a Session by UID within the current tenant', async () => {
    const payload = { uid: 'uid-1', accountId: 'account-1' };
    collection.findOne.mockResolvedValueOnce({ payload });

    await expect(adapter.findByUid('uid-1')).resolves.toBe(payload);
    expect(collection.findOne).toHaveBeenCalledWith(
      { 'payload.uid': 'uid-1', tenant_id: 'default' },
      { projection: { payload: 1 } }
    );
  });

  it('returns undefined when tenant-scoped secondary lookups find nothing', async () => {
    const deviceAdapter = new OIDCMongoAdapter(
      'DeviceCode',
      database as never,
      logger
    );

    await expect(
      deviceAdapter.findByUserCode('MISSING-CODE')
    ).resolves.toBeUndefined();
    await expect(adapter.findByUid('missing-uid')).resolves.toBeUndefined();
  });

  it('returns successful custom data operations', async () => {
    const updated = { _id: 'session-1', data: { risk: 'low' } };
    const matches = [{ _id: 'session-1', data: { risk: 'low' } }];
    collection.findOneAndUpdate.mockResolvedValueOnce(updated);
    collection.cursor.toArray.mockResolvedValueOnce(matches);

    await expect(
      adapter.extendModel('session-1', { risk: 'low' })
    ).resolves.toBe(updated);
    await expect(adapter.findByCustomField('risk', 'low')).resolves.toBe(
      matches
    );
    expect(collection.find).toHaveBeenCalledWith({
      'data.risk': 'low',
      tenant_id: 'default',
    });
  });

  it('maps complete MongoDB documents and selected raw payloads', () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const document = {
      _id: 'physical-id',
      logical_id: 'session-id',
      expiresAt,
      data: { risk: 'low' },
      payload: {
        accountId: 'account-1',
        uid: 'uid-1',
        loginTs: 2,
        exp: 10,
        iat: 5,
        authorizations: { client: ['openid'] },
      },
    };

    expect(adapter.mapDocumentToUI(document)).toEqual({
      id: 'session-id',
      expiresAt,
      customData: { risk: 'low' },
      accountId: 'account-1',
      uid: 'uid-1',
      loginTs: new Date(2_000),
      expiration: new Date(10_000),
      issuedAt: new Date(5_000),
      authorizations: { client: ['openid'] },
    });
    expect(
      adapter.mapDocumentToUI(document, {
        includePayload: true,
        excludeFields: ['customData'],
      })
    ).toEqual({
      id: 'session-id',
      expiresAt,
      payload: document.payload,
    });
  });

  it('handles absent documents and absent payloads', () => {
    expect(adapter.mapDocumentToUI(null)).toBeNull();
    expect(
      adapter.mapDocumentToUI({
        _id: 'physical-id',
        payload: undefined,
      } as never)
    ).toEqual({
      id: 'physical-id',
      expiresAt: undefined,
      customData: {},
    });
  });

  it('returns a safe physical-ID mapping when optional mapping fails', () => {
    const mappingError = new Error('mapping failed');
    const excludeFields = {
      forEach: () => {
        throw mappingError;
      },
    } as unknown as string[];

    expect(
      adapter.mapDocumentToUI(
        { _id: 'physical-id', payload: {} },
        { excludeFields }
      )
    ).toEqual({ id: 'physical-id', customData: {} });
    expect(logger.error).toHaveBeenCalledWith(mappingError, {
      context: 'Error mapping document to UI',
    });
  });

  it('supports explicit collection names and successful counts', async () => {
    collection.countDocuments.mockResolvedValueOnce(4);

    expect(adapter.coll('OtherModel')).toBe(collection);
    await expect(adapter.countAll()).resolves.toBe(4);
    expect(database.collection).toHaveBeenCalledWith('OtherModel');
    expect(collection.countDocuments).toHaveBeenCalledWith({
      tenant_id: 'default',
    });
  });

  it('short-circuits empty and wrong-model lookup identifiers', async () => {
    const deviceAdapter = new OIDCMongoAdapter(
      'DeviceCode',
      database as never,
      logger
    );
    const accessAdapter = new OIDCMongoAdapter(
      'AccessToken',
      database as never,
      logger
    );

    await expect(accessAdapter.find('')).resolves.toBeUndefined();
    await expect(deviceAdapter.findByUserCode('')).resolves.toBeUndefined();
    await expect(
      accessAdapter.findByUserCode('USER-CODE')
    ).resolves.toBeUndefined();
    await expect(adapter.findByUid('')).resolves.toBeUndefined();
    await expect(accessAdapter.findByUid('uid-1')).resolves.toBeUndefined();
    await expect(accessAdapter.destroy('')).resolves.toBeUndefined();
    await expect(accessAdapter.consume('')).resolves.toBeUndefined();
    await expect(accessAdapter.revokeByGrantId('')).resolves.toBeUndefined();
    expect(collection.findOne).not.toHaveBeenCalled();
    expect(collection.deleteOne).not.toHaveBeenCalled();
    expect(collection.deleteMany).not.toHaveBeenCalled();
    expect(collection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('logs and returns safe defaults for count and custom-search failures', async () => {
    const countError = new Error('count failed');
    const searchError = new Error('search failed');
    collection.countDocuments.mockRejectedValueOnce(countError);
    collection.find.mockImplementationOnce(() => {
      throw searchError;
    });

    await expect(adapter.countAll()).resolves.toBe(0);
    await expect(adapter.findByCustomField('risk', 'low')).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(countError, {
      context: 'Error counting documents in Session',
    });
    expect(logger.error).toHaveBeenCalledWith(searchError, {
      context: 'Error finding Session by custom field',
    });
  });

  it.each([
    {
      model: 'AccessToken',
      operation: 'upsert',
      boundary: 'updateOne',
      args: ['token-1', { accountId: 'account-1' }],
      context: 'Error in AccessToken.upsert for id token-1',
    },
    {
      model: 'AccessToken',
      operation: 'find',
      boundary: 'findOne',
      args: ['token-1'],
      context: 'Error in AccessToken.find for id token-1',
    },
    {
      model: 'DeviceCode',
      operation: 'findByUserCode',
      boundary: 'findOne',
      args: ['USER-CODE'],
      context: 'Error in DeviceCode.findByUserCode for code USER-CODE',
    },
    {
      model: 'Session',
      operation: 'findByUid',
      boundary: 'findOne',
      args: ['uid-1'],
      context: 'Error in Session.findByUid for uid uid-1',
    },
    {
      model: 'AccessToken',
      operation: 'destroy',
      boundary: 'deleteOne',
      args: ['token-1'],
      context: 'Error in AccessToken.destroy for id token-1',
    },
    {
      model: 'AccessToken',
      operation: 'revokeByGrantId',
      boundary: 'deleteMany',
      args: ['grant-1'],
      context: 'Error in AccessToken.revokeByGrantId for grantId grant-1',
    },
    {
      model: 'AuthorizationCode',
      operation: 'consume',
      boundary: 'findOneAndUpdate',
      args: ['code-1'],
      context: 'Error in AuthorizationCode.consume for id code-1',
    },
    {
      model: 'Session',
      operation: 'extendModel',
      boundary: 'findOneAndUpdate',
      args: ['session-1', { risk: 'low' }],
      context: 'Error extending Session with custom data',
    },
  ])(
    'logs and rethrows $operation MongoDB failures',
    async ({ model, operation, boundary, args, context }) => {
      const storageError = new Error(`${operation} failed`);
      const boundaryMethod = collection[
        boundary as keyof typeof collection
      ] as ReturnType<typeof vi.fn>;
      boundaryMethod.mockRejectedValueOnce(storageError);
      const operationAdapter = new OIDCMongoAdapter(
        model,
        database as never,
        logger
      );
      const operationMethod = operationAdapter[
        operation as keyof OIDCMongoAdapter
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      await expect(operationMethod.apply(operationAdapter, args)).rejects.toBe(
        storageError
      );
      expect(logger.error).toHaveBeenCalledWith(storageError, { context });
    }
  );
});

describe('connectMongoDB', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses an injected database connection without opening a client', async () => {
    const database = { collection: vi.fn() };
    const connect = vi.spyOn(MongoClient, 'connect');

    await expect(
      connectMongoDB({ connection: database as never })
    ).resolves.toBe(database);
    expect(connect).not.toHaveBeenCalled();
  });

  it('opens the requested URI and database name', async () => {
    const database = { collection: vi.fn() };
    const db = vi.fn().mockReturnValue(database);
    vi.spyOn(MongoClient, 'connect').mockResolvedValue({ db } as never);

    await expect(
      connectMongoDB({ uri: 'mongodb://example.test:27017', dbName: 'parako' })
    ).resolves.toBe(database);
    expect(MongoClient.connect).toHaveBeenCalledWith(
      'mongodb://example.test:27017'
    );
    expect(db).toHaveBeenCalledWith('parako');
  });

  it('uses the connected Mongoose database as a fallback', async () => {
    const database = { collection: vi.fn() };
    const originalDb = Object.getOwnPropertyDescriptor(
      mongoose.connection,
      'db'
    );
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      value: database,
    });

    try {
      await expect(connectMongoDB()).resolves.toBe(database);
    } finally {
      if (originalDb) {
        Object.defineProperty(mongoose.connection, 'db', originalDb);
      } else {
        delete (mongoose.connection as { db?: unknown }).db;
      }
    }
  });

  it('rejects when no MongoDB connection is available', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);

    await expect(connectMongoDB()).rejects.toThrow(
      'No valid MongoDB connection provided'
    );
  });
});
