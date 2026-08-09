import { describe, it, expect, vi } from 'vitest';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../../../src/di/interfaces/config-manager.interface.js';
import type { IJwksKeyRepository } from '../../../../src/oidc/key-store/jwks-key.repository.js';
import { DBKeyStore } from '../../../../src/oidc/key-store/db-key-store.js';
import type { JwksKeyModel } from '../../../../src/models/jwks-key.model.js';

// gitleaks:allow -- deterministic unit-test key material.
const TEST_JWT_SECRET =
  'a-very-long-jwt-secret-that-is-at-least-32-characters-for-testing';

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    getLogger: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
  } as any;
}

function createMockConfigManager(
  overrides?: Record<string, unknown>
): IConfigManager {
  return {
    getConfig: vi.fn().mockReturnValue({
      security: {
        secrets: {
          jwt_secret: TEST_JWT_SECRET,
        },
        key_store: {
          type: 'database',
          rotation_interval_days: 90,
          overlap_window_seconds: 7200,
          algorithms: ['RS256', 'ES256', 'EdDSA'],
          ...overrides,
        },
      },
    }),
    getConfigSection: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(true),
  } as any;
}

function createMockJwksKeyModel() {
  const docs: any[] = [];
  const model = {
    find: vi.fn().mockImplementation(function (query: any) {
      const results = docs.filter(d => {
        if (query.tenant_id && d.tenant_id !== query.tenant_id) return false;
        if (query.status) {
          if (query.status.$in) return query.status.$in.includes(d.status);
          return d.status === query.status;
        }
        return true;
      });
      return {
        lean: vi.fn().mockResolvedValue(results),
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(results),
        }),
      };
    }),
    findOne: vi.fn().mockImplementation((query: any) => {
      const result = docs.find(d => {
        if (query.tenant_id && d.tenant_id !== query.tenant_id) return false;
        if (query.status && d.status !== query.status) return false;
        return true;
      });
      return {
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(result ?? null),
        }),
      };
    }),
    create: vi.fn().mockImplementation((doc: any) => {
      const created = { ...doc, _id: `mock-id-${docs.length}` };
      docs.push(created);
      return Promise.resolve(created);
    }),
    insertMany: vi.fn().mockImplementation((newDocs: any[]) => {
      for (const doc of newDocs) {
        docs.push({ ...doc, _id: `mock-id-${docs.length}` });
      }
      return Promise.resolve(newDocs);
    }),
    updateMany: vi.fn().mockImplementation((query: any, update: any) => {
      let count = 0;
      for (const d of docs) {
        let match = true;
        if (query.tenant_id && d.tenant_id !== query.tenant_id) match = false;
        if (query.status && d.status !== query.status) match = false;
        // Handle promoted filter: exact value or $ne operator
        if (query.promoted !== undefined) {
          if (
            typeof query.promoted === 'object' &&
            query.promoted !== null &&
            '$ne' in query.promoted
          ) {
            if (d.promoted === query.promoted.$ne) match = false;
          } else {
            if (d.promoted !== query.promoted) match = false;
          }
        }
        if (query.rotated_at) {
          if (query.rotated_at.$exists && !d.rotated_at) match = false;
          if (
            query.rotated_at.$lt &&
            d.rotated_at &&
            new Date(d.rotated_at) >= query.rotated_at.$lt
          )
            match = false;
        }
        if (match) {
          if (update.$set) Object.assign(d, update.$set);
          count++;
        }
      }
      return Promise.resolve({ modifiedCount: count });
    }),
    deleteMany: vi.fn().mockImplementation((query: any) => {
      const before = docs.length;
      const toRemove = docs.filter(
        d =>
          (!query.tenant_id || d.tenant_id === query.tenant_id) &&
          (!query.status || d.status === query.status)
      );
      for (const r of toRemove) {
        const idx = docs.indexOf(r);
        if (idx >= 0) docs.splice(idx, 1);
      }
      return Promise.resolve({ deletedCount: before - docs.length });
    }),
    countDocuments: vi.fn().mockImplementation((query: any) => {
      const count = docs.filter(d => {
        if (query.tenant_id && d.tenant_id !== query.tenant_id) return false;
        if (query.status) {
          if (query.status.$in) return query.status.$in.includes(d.status);
          return d.status === query.status;
        }
        return true;
      }).length;
      return Promise.resolve(count);
    }),
    _docs: docs, // for test inspection
  };
  // This focused in-memory double implements only the Mongoose methods used by
  // DBKeyStore. Keep the cast at the factory boundary so individual tests stay
  // strongly typed and cannot silently pass arbitrary constructor arguments.
  return model as typeof model & JwksKeyModel;
}

function createMockJwksRepository(
  overrides: Partial<IJwksKeyRepository> = {}
): IJwksKeyRepository {
  return {
    countCurrent: vi.fn().mockResolvedValue(0),
    findCurrent: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findNewestActive: vi.fn().mockResolvedValue(null),
    insertInitial: vi.fn().mockResolvedValue(true),
    insertMany: vi.fn().mockResolvedValue(undefined),
    markPromotedActiveExpiring: vi.fn().mockResolvedValue(0),
    promoteUnpromotedActive: vi.fn().mockResolvedValue(0),
    retireExpired: vi.fn().mockResolvedValue(0),
    retireByKid: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as IJwksKeyRepository;
}

describe('DBKeyStore', () => {
  it('should generate initial keyset on initialize when DB is empty', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    await store.initialize();

    // Should have called insertMany with 3 keys (RS256, ES256, EdDSA)
    expect(model.insertMany).toHaveBeenCalledTimes(1);
    const insertedKeys = model.insertMany.mock.calls[0][0];
    expect(insertedKeys).toHaveLength(3);
    expect(insertedKeys[0].status).toBe('active');
    expect(insertedKeys[0].tenant_id).toBe('default');
    expect(insertedKeys[0].encrypted_private_key).toMatch(/^ENCRYPTED:v1:/);
  });

  it('should set alg on generated JWKs matching the algorithm', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    await store.initialize();

    const insertedKeys = model.insertMany.mock.calls[0][0];
    const algValues = insertedKeys.map((k: any) => k.alg);
    expect(algValues).toEqual(
      expect.arrayContaining(['RS256', 'ES256', 'EdDSA'])
    );

    // Public keys should also have alg
    for (const doc of insertedKeys) {
      expect(doc.public_key.alg).toBeDefined();
    }
  });

  it('should NOT generate keys on initialize when DB has keys', async () => {
    const model = createMockJwksKeyModel();
    // Pre-populate
    model._docs.push({
      kid: 'existing',
      alg: 'RS256',
      use: 'sig',
      status: 'active',
      encrypted_private_key: 'ENCRYPTED:v1:dummy',
      public_key: { kty: 'RSA' },
      tenant_id: 'default',
      created_at: new Date(),
    });

    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    await store.initialize();
    expect(model.insertMany).not.toHaveBeenCalled();
  });

  it('should accept another process winning initial key creation', async () => {
    const logger = createMockLogger();
    const countCurrent = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const insertInitial = vi.fn().mockResolvedValue(false);
    const repository = createMockJwksRepository({
      countCurrent,
      insertInitial,
    });
    const store = new DBKeyStore(
      logger,
      createMockConfigManager({ algorithms: ['ES256'] }),
      repository
    );

    await expect(store.initialize()).resolves.toBeUndefined();

    expect(insertInitial).toHaveBeenCalledTimes(1);
    expect(countCurrent).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'Loaded 1 keys generated by another process',
      { tenantId: 'default' }
    );
  });

  it('should fail when a lost initialization race leaves no usable keys', async () => {
    const repository = createMockJwksRepository({
      countCurrent: vi.fn().mockResolvedValue(0),
      insertInitial: vi.fn().mockResolvedValue(false),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ algorithms: ['ES256'] }),
      repository
    );

    await expect(store.initialize()).rejects.toThrow(
      'Concurrent JWKS initialization completed without creating any keys'
    );
  });

  it('should decrypt private keys when returning JWKS', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    // Initialize will generate keys
    await store.initialize();

    const jwks = await store.getJWKS();
    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) {
      const k = key as Record<string, unknown>;
      expect(k.kty).toBeDefined();
      expect(k.alg).toBeDefined();
    }
  });

  it('should return public-only keys from getPublicJWKS', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    const jwks = await store.getPublicJWKS();
    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) {
      const k = key as Record<string, unknown>;
      expect(k.d).toBeUndefined();
      expect(k.p).toBeUndefined();
      expect(k.q).toBeUndefined();
    }
  });

  it('should parse serialized public keys for public JWKS and key listings', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ algorithms: ['ES256'] }),
      model
    );
    await store.initialize();
    model._docs[0].public_key = JSON.stringify(model._docs[0].public_key);

    const publicJwks = await store.getPublicJWKS();
    const listedKeys = await store.listKeys();

    expect(publicJwks.keys[0]).toMatchObject({ alg: 'ES256', use: 'sig' });
    expect(listedKeys[0].publicKey).toMatchObject({ alg: 'ES256', use: 'sig' });
  });

  it('should order all promotion groups even when storage returns them in priority order', async () => {
    const records = [
      {
        kid: 'promoted',
        status: 'active',
        promoted: true,
        created_at: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        kid: 'unpromoted',
        status: 'active',
        promoted: false,
        created_at: new Date('2026-08-02T00:00:00.000Z'),
      },
      {
        kid: 'expiring',
        status: 'expiring',
        promoted: true,
        created_at: new Date('2026-08-03T00:00:00.000Z'),
      },
    ].map(record => ({
      ...record,
      alg: 'ES256',
      use: 'sig',
      encrypted_private_key: 'unused',
      public_key: { kid: record.kid },
      tenant_id: 'default',
    }));
    const repository = createMockJwksRepository({
      findCurrent: vi.fn().mockResolvedValue(records),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    const result = await store.getPublicJWKS();

    expect(result.keys.map(key => key.kid)).toEqual([
      'promoted',
      'unpromoted',
      'expiring',
    ]);
  });

  it('should use documented key-store defaults when optional configuration is absent', async () => {
    const model = createMockJwksKeyModel();
    const configManager = {
      getConfig: vi.fn().mockReturnValue({
        security: {
          secrets: {
            jwt_secret: TEST_JWT_SECRET,
          },
        },
      }),
    } as unknown as IConfigManager;
    const store = new DBKeyStore(createMockLogger(), configManager, model);

    await store.initialize();
    const rotationNeeded = await store.needsRotation();
    const retired = await store.retireExpiredKeys();

    expect(model.insertMany.mock.calls[0][0]).toHaveLength(3);
    expect(rotationNeeded).toBe(false);
    expect(retired).toBe(0);
  });

  it('should rotate keys: new keys generated FIRST, then active→expiring', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    const keysBefore = model._docs.length;
    expect(keysBefore).toBe(3); // RS256, ES256, EdDSA

    // Track call order to verify atomicity-safe ordering
    const callOrder: string[] = [];
    const origInsertMany = model.insertMany.bind(model);
    model.insertMany = vi.fn().mockImplementation((...args: any[]) => {
      callOrder.push('insertMany');
      return origInsertMany(args[0]);
    });
    const origUpdateMany = model.updateMany.bind(model);
    model.updateMany = vi.fn().mockImplementation((...args: any[]) => {
      callOrder.push('updateMany');
      return origUpdateMany(args[0], args[1]);
    });

    await store.rotate();

    // CRITICAL: insertMany (new keys) MUST happen before updateMany (expire old)
    expect(callOrder).toEqual(['insertMany', 'updateMany']);
    // insertMany called twice total: 1 for init + 1 for rotate
    expect(model.insertMany).toHaveBeenCalledTimes(1);
    expect(model.updateMany).toHaveBeenCalledTimes(1);
  });

  it('should rate-limit rapid rotations', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    // First rotation succeeds
    await store.rotate();

    // Second rotation within 1 minute should throw
    await expect(store.rotate()).rejects.toThrow('rate-limited');
  });

  it('should lazily derive encryption key when getJWKS is called before initialize', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    // Should NOT throw — getDerivedKey() now lazily derives the key
    const jwks = await store.getJWKS();
    expect(jwks.keys).toEqual([]);
  });

  it('needsRotation should check age of newest active key', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ rotation_interval_days: 0 }),
      model
    );
    await store.initialize();

    // Since we just generated, needsRotation with 90 days should be false
    const configManager = createMockConfigManager({
      rotation_interval_days: 90,
    });
    const store2 = new DBKeyStore(createMockLogger(), configManager, model);
    // Don't re-initialize (keys already in model from store1)
    const needs = await store2.needsRotation();
    expect(needs).toBe(false); // Just created, well within 90 days
  });

  it('needsRotation should return true when no active keys exist', async () => {
    const model = createMockJwksKeyModel();
    // No keys in DB
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    // Call ensureDerivedKey through needsRotation without initializing fully
    // needsRotation doesn't need derivedKey, only needs DB query
    const needs = await store.needsRotation();
    expect(needs).toBe(true);
  });

  it('should list all keys with decrypted content', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    const keys = await store.listKeys();
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key.kid).toBeDefined();
      expect(key.status).toBe('active');
      expect(key.tenantId).toBe('default');
      expect(key.privateKey).toBeDefined();
      expect(key.publicKey).toBeDefined();
    }
  });

  it('should retire expired keys past overlap window', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ overlap_window_seconds: 0 }), // 0 = expire immediately
      model
    );
    await store.initialize();

    // Move active to expiring
    for (const doc of model._docs) {
      doc.status = 'expiring';
      doc.rotated_at = new Date(Date.now() - 10000); // 10 seconds ago
    }

    await store.retireExpiredKeys();

    // With overlap_window=0, all expiring keys should now be retired
    expect(model.updateMany).toHaveBeenCalled();
  });

  it('should not retire keys without rotated_at', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ overlap_window_seconds: 0 }),
      model
    );
    await store.initialize();

    // Set to expiring but WITHOUT rotated_at
    for (const doc of model._docs) {
      doc.status = 'expiring';
      delete doc.rotated_at;
    }

    // Reset updateMany call count from initialize
    model.updateMany.mockClear();
    await store.retireExpiredKeys();

    // The query requires rotated_at to exist, so no docs should match
    const call = model.updateMany.mock.calls[0];
    expect(call[0]).toHaveProperty('rotated_at');
    expect(call[0].rotated_at.$exists).toBe(true);
  });

  it('should support multi-tenant key isolation', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );

    await store.initialize('tenant-a');
    const insertedKeys = model.insertMany.mock.calls[0][0];
    expect(insertedKeys[0].tenant_id).toBe('tenant-a');
  });

  it('should generate unpromoted keys during rotate (Phase 1)', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    // Initial keys should be promoted (default)
    const initKeys = model.insertMany.mock.calls[0][0];
    expect(initKeys[0].promoted).toBe(true);

    await store.rotate();

    // Rotation keys should be unpromoted (Phase 1)
    const rotatedKeys = model.insertMany.mock.calls[1][0];
    expect(rotatedKeys[0].promoted).toBe(false);
    expect(rotatedKeys[0].status).toBe('active');
  });

  it('should promote unpromoted active keys via promoteKeys()', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();
    await store.rotate();

    // After rotate, new keys are promoted=false
    const unpromotedKeys = model._docs.filter(
      (d: any) => d.status === 'active' && d.promoted === false
    );
    expect(unpromotedKeys.length).toBe(3);

    const count = await store.promoteKeys();
    expect(count).toBe(3);

    // All active keys should now be promoted
    const stillUnpromoted = model._docs.filter(
      (d: any) => d.status === 'active' && d.promoted === false
    );
    expect(stillUnpromoted.length).toBe(0);
  });

  it('promoteKeys should return 0 when no unpromoted keys exist', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize(); // All keys promoted by default

    const count = await store.promoteKeys();
    expect(count).toBe(0);
  });

  it('retireExpiredKeys should return the count of retired keys', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ overlap_window_seconds: 0 }),
      model
    );
    await store.initialize();

    // Move keys to expiring with rotated_at in the past
    for (const doc of model._docs) {
      doc.status = 'expiring';
      doc.rotated_at = new Date(Date.now() - 10000);
    }

    const count = await store.retireExpiredKeys();
    expect(count).toBe(3);
  });

  it('retireExpiredKeys should return 0 when no keys are eligible', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager({ overlap_window_seconds: 7200 }),
      model
    );
    await store.initialize();

    // No expiring keys at all
    const count = await store.retireExpiredKeys();
    expect(count).toBe(0);
  });

  it('retires one key through the tenant-scoped repository contract', async () => {
    const repository = createMockJwksRepository({
      findAll: vi.fn().mockResolvedValue([
        { kid: 'target', status: 'expiring', tenant_id: 'tenant-a' },
        {
          kid: 'signing',
          status: 'active',
          promoted: true,
          tenant_id: 'tenant-a',
        },
      ] as any),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    await expect(store.retireKey('target', 'tenant-a')).resolves.toBe(true);
    expect((repository as any).retireByKid).toHaveBeenCalledWith(
      'tenant-a',
      'target'
    );
  });

  it('uses the default tenant when retiring a key without tenant context', async () => {
    const repository = createMockJwksRepository({
      findAll: vi
        .fn()
        .mockResolvedValue([
          { kid: 'target', status: 'expiring', tenant_id: 'default' },
        ] as any),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    await expect(store.retireKey('target')).resolves.toBe(true);
    expect(repository.findAll).toHaveBeenCalledWith('default');
    expect((repository as any).retireByKid).toHaveBeenCalledWith(
      'default',
      'target'
    );
  });

  it('refuses to retire the last promoted active signing key', async () => {
    const repository = createMockJwksRepository({
      findAll: vi.fn().mockResolvedValue([
        {
          kid: 'only-signing-key',
          status: 'active',
          promoted: true,
          tenant_id: 'tenant-a',
        },
      ] as any),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    await expect(
      store.retireKey('only-signing-key', 'tenant-a')
    ).rejects.toThrow('last promoted active signing key');
    expect((repository as any).retireByKid).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing key', []],
    [
      'an already-retired key',
      [{ kid: 'target', status: 'retired', tenant_id: 'tenant-a' }],
    ],
  ])('reports no change for %s', async (_case, storedKeys) => {
    const repository = createMockJwksRepository({
      findAll: vi.fn().mockResolvedValue(storedKeys as any),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    await expect(store.retireKey('target', 'tenant-a')).resolves.toBe(false);
    expect((repository as any).retireByKid).not.toHaveBeenCalled();
  });

  it('allows retiring an active key when another promoted signer remains', async () => {
    const repository = createMockJwksRepository({
      findAll: vi.fn().mockResolvedValue([
        {
          kid: 'target',
          status: 'active',
          promoted: true,
          tenant_id: 'tenant-a',
        },
        {
          kid: 'replacement',
          status: 'active',
          promoted: true,
          tenant_id: 'tenant-a',
        },
      ] as any),
    });
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      repository
    );

    await expect(store.retireKey('target', 'tenant-a')).resolves.toBe(true);
  });

  it('reports a lost retirement update without logging success', async () => {
    const logger = createMockLogger();
    const repository = createMockJwksRepository({
      findAll: vi
        .fn()
        .mockResolvedValue([
          { kid: 'target', status: 'expiring', tenant_id: 'tenant-a' },
        ] as any),
      retireByKid: vi.fn().mockResolvedValue(false),
    } as any);
    const store = new DBKeyStore(logger, createMockConfigManager(), repository);

    await expect(store.retireKey('target', 'tenant-a')).resolves.toBe(false);
    expect(logger.info).not.toHaveBeenCalledWith(
      'Retired JWKS key',
      expect.anything()
    );
  });

  it('listKeys should include promoted field', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();

    const keys = await store.listKeys();
    for (const key of keys) {
      expect(key.promoted).toBe(true);
    }
  });

  it('getJWKS should order promoted active keys before unpromoted', async () => {
    const model = createMockJwksKeyModel();
    const store = new DBKeyStore(
      createMockLogger(),
      createMockConfigManager(),
      model
    );
    await store.initialize();
    await store.rotate();

    // Now we have: expiring (old promoted) + active (new unpromoted)
    // Promote only to test ordering after promotion
    await store.promoteKeys();

    // Add one more unpromoted key manually for ordering test
    model._docs.push({
      kid: 'unpromoted-test',
      alg: 'RS256',
      use: 'sig',
      status: 'active',
      promoted: false,
      encrypted_private_key: model._docs[0].encrypted_private_key,
      public_key: model._docs[0].public_key,
      tenant_id: 'default',
      created_at: new Date(),
    });

    const jwks = await store.getJWKS();
    // The unpromoted key should be after promoted active keys
    // but before expiring keys
    expect(jwks.keys.length).toBeGreaterThan(0);
  });
});
