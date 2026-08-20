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
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import {
  createPrismaAdapterFactory,
  PrismaOidcStoreAdapter,
} from '../../../../../src/oidc/adapter/prisma/index.js';
import { ensureEncrypted } from '../../../../../src/utils/encryption.js';
import { PersistenceDecodingError } from '../../../../../src/db/persistence/json-decoder.js';

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
});

afterAll(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }
});

function createLogger(): ILogger {
  return {
    error: vi.fn(),
  } as unknown as ILogger;
}

function createPrismaBoundary() {
  return {
    oidcStore: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('PrismaOidcStoreAdapter', () => {
  let logger: ILogger;
  let prisma: ReturnType<typeof createPrismaBoundary>;

  beforeEach(() => {
    logger = createLogger();
    prisma = createPrismaBoundary();
  });

  it('decrypts and sanitizes stored Client metadata before returning it', async () => {
    prisma.oidcStore.findFirst.mockResolvedValue({
      payload: JSON.stringify({
        client_id: 'client-1',
        client_name: 'Client one',
        client_secret: ensureEncrypted('secret-value'),
        logo_uri: '',
        policy_uri: null,
      }),
      consumed: null,
    });
    const adapter = new PrismaOidcStoreAdapter(
      'Client',
      prisma as never,
      logger
    );

    await expect(adapter.find('client-1')).resolves.toEqual({
      client_id: 'client-1',
      client_name: 'Client one',
      client_secret: 'secret-value',
    });
  });

  it('sanitizes public Client metadata when no secret is stored', async () => {
    prisma.oidcStore.findFirst.mockResolvedValue({
      payload: JSON.stringify({
        client_id: 'public-client',
        client_name: 'Public client',
        client_secret: undefined,
        logo_uri: '',
      }),
      consumed: null,
    });
    const adapter = new PrismaOidcStoreAdapter(
      'Client',
      prisma as never,
      logger
    );

    await expect(adapter.find('public-client')).resolves.toEqual({
      client_id: 'public-client',
      client_name: 'Public client',
    });
  });

  it('rejects a non-object persisted payload without exposing its value', async () => {
    prisma.oidcStore.findFirst.mockResolvedValue({
      payload: '["private-marker"]',
      consumed: null,
    });
    const adapter = new PrismaOidcStoreAdapter(
      'Session',
      prisma as never,
      logger
    );

    try {
      await adapter.find('session-1');
      throw new Error('Expected persisted OIDC payload decoding to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceDecodingError);
      expect(error).toMatchObject({ context: 'prisma_oidc.Session.payload' });
      expect(String(error)).not.toContain('private-marker');
    }
  });

  it('does not query storage when no grant identifier is provided', async () => {
    const adapter = new PrismaOidcStoreAdapter(
      'AccessToken',
      prisma as never,
      logger
    );

    await expect(adapter.revokeByGrantId('')).resolves.toBeUndefined();
    expect(prisma.oidcStore.deleteMany).not.toHaveBeenCalled();
  });

  it('lists active model records with their stable identifiers', async () => {
    prisma.oidcStore.findMany.mockResolvedValueOnce([
      { id: 'token-1', payload: JSON.stringify({ iat: 100 }) },
    ]);
    const adapter = new PrismaOidcStoreAdapter(
      'InitialAccessToken',
      prisma as never,
      logger
    );

    await expect(adapter.findAll()).resolves.toEqual([
      { iat: 100, _id: 'token-1' },
    ]);
    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: {
        model: 'InitialAccessToken',
        tenant_id: 'default',
        OR: [{ expires_at: null }, { expires_at: { gt: expect.any(Date) } }],
      },
      orderBy: { created_at: 'desc' },
    });
  });

  it('creates model-specific adapters through the public factory', () => {
    const factory = createPrismaAdapterFactory(prisma as never, logger);

    expect(factory('Session')).toBeInstanceOf(PrismaOidcStoreAdapter);
  });

  it.each([
    {
      model: 'AccessToken',
      operation: 'upsert',
      boundary: 'findFirst',
      args: ['token-1', { accountId: 'account-1' }],
      context: 'Error in AccessToken.upsert for id token-1',
    },
    {
      model: 'AccessToken',
      operation: 'find',
      boundary: 'findFirst',
      args: ['token-1'],
      context: 'Error in AccessToken.find for id token-1',
    },
    {
      model: 'InitialAccessToken',
      operation: 'findAll',
      boundary: 'findMany',
      args: [],
      context: 'Error in InitialAccessToken.findAll',
    },
    {
      model: 'DeviceCode',
      operation: 'findByUserCode',
      boundary: 'findFirst',
      args: ['USER-CODE'],
      context: 'Error in DeviceCode.findByUserCode',
    },
    {
      model: 'Session',
      operation: 'findByUid',
      boundary: 'findFirst',
      args: ['session-uid'],
      context: 'Error in Session.findByUid',
    },
    {
      model: 'AuthorizationCode',
      operation: 'consume',
      boundary: 'updateMany',
      args: ['code-1'],
      context: 'Error in AuthorizationCode.consume for id code-1',
    },
    {
      model: 'AccessToken',
      operation: 'destroy',
      boundary: 'deleteMany',
      args: ['token-1'],
      context: 'Error in AccessToken.destroy for id token-1',
    },
    {
      model: 'AccessToken',
      operation: 'revokeByGrantId',
      boundary: 'deleteMany',
      args: ['grant-1'],
      context: 'Error in AccessToken.revokeByGrantId',
    },
  ])(
    'logs and rethrows $operation storage failures',
    async ({ model, operation, boundary, args, context }) => {
      const storageError = new Error(`${operation} failed`);
      const boundaryMethod = prisma.oidcStore[
        boundary as keyof typeof prisma.oidcStore
      ] as ReturnType<typeof vi.fn>;
      boundaryMethod.mockRejectedValueOnce(storageError);
      const adapter = new PrismaOidcStoreAdapter(
        model,
        prisma as never,
        logger
      );
      const operationMethod = adapter[
        operation as keyof PrismaOidcStoreAdapter
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      await expect(operationMethod.apply(adapter, args)).rejects.toBe(
        storageError
      );
      expect(logger.error).toHaveBeenCalledWith(storageError, { context });
    }
  );
});
