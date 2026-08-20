/**
 * TDD — RedisOidcAdminService
 * Validates the consolidated Redis OIDC admin service that replaces
 * the 14 per-model per-file adapter classes.
 *
 * Uses `scanKeys` spy to avoid needing a real Redis connection.
 */
import { randomBytes } from 'node:crypto';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { RedisOidcAdminService } from '../../../../../src/oidc/adapter/redis/admin-service.js';
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import type { Redis } from 'ioredis';

// Set up ENCRYPTION_KEY for client secret encryption tests
const _origEncKey = process.env.ENCRYPTION_KEY;
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
});
afterAll(() => {
  if (_origEncKey) process.env.ENCRYPTION_KEY = _origEncKey;
  else delete process.env.ENCRYPTION_KEY;
});

const logger: ILogger = {
  getLogger: () => null as any,
  child: () => null as any,
  flush: async () => {},
  shutdown: async () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

const mockClient = {} as Redis;
const testPrefix = 'parako';

describe('RedisOidcAdminService — Session model', () => {
  let service: RedisOidcAdminService;

  beforeEach(() => {
    service = new RedisOidcAdminService(
      'Session',
      mockClient,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  it('findByAccountId returns empty array when no keys exist', async () => {
    const results = await service.findByAccountId('user-1');
    expect(results).toEqual([]);
  });

  it('deleteSessionsByAccountId returns zero count when no keys exist', async () => {
    const result = await service.deleteSessionsByAccountId('user-1');
    expect(result.deletedCount).toBe(0);
  });

  it('deleteSessionsByIds returns zero count for empty list', async () => {
    const result = await service.deleteSessionsByIds([]);
    expect(result.deletedCount).toBe(0);
  });

  it('getSessionStatistics returns zeros when no keys exist', async () => {
    const stats = await service.getSessionStatistics();
    expect(stats).toEqual({ total: 0, active: 0, expired: 0 });
  });

  it('matches the controller portable username and active-session filters', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            kind: 'Session',
            accountId: 'Alice+Admin',
            exp: 200,
          }),
        ],
        [null, JSON.stringify({ kind: 'Session', accountId: 'Bob', exp: 50 })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:s1',
      'parako:default:oidc:Session:s2',
    ]);

    const count = await service.countSessions({
      'payload.kind': 'Session',
      'payload.accountId': { $regex: '^alice\\+admin', $options: 'i' },
      'payload.exp': { $gt: 100 },
    });

    expect(count).toBe(1);
  });

  it('sorts full usernames rather than only their first character', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ kind: 'Session', accountId: 'anna' })],
        [null, JSON.stringify({ kind: 'Session', accountId: 'alice' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:s1',
      'parako:default:oidc:Session:s2',
    ]);

    const sessions = await service.findSessionsWithPagination(
      {},
      'username',
      1
    );

    expect(sessions.map(session => session.payload.accountId)).toEqual([
      'alice',
      'anna',
    ]);
  });

  it('uses stable zero and empty-string fallbacks for sparse sort fields', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ jti: 'login', loginTs: 2 })],
        [null, JSON.stringify({ jti: 'issued', iat: 1 })],
        [null, JSON.stringify({ jti: 'sparse' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['s1', 's2', 's3']);

    await expect(
      service.findSessionsWithPagination({}, 'loginTime', 1)
    ).resolves.toMatchObject([
      { payload: { jti: 'sparse' } },
      { payload: { jti: 'issued' } },
      { payload: { jti: 'login' } },
    ]);
    for (const sortBy of [
      'username',
      'payload.clientId',
      'expiresAt',
      'unknown-field',
    ]) {
      await expect(
        service.findSessionsWithPagination({}, sortBy, 1)
      ).resolves.toHaveLength(3);
    }
  });

  it('returns only active Session records for an account', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            exp: 200,
            kind: 'Session',
            jti: 's1',
          }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            exp: 50,
            kind: 'Session',
            jti: 'expired',
          }),
        ],
        [null, JSON.stringify({ accountId: 'user-2', exp: 200 })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['s1', 's2', 's3']);

    await expect(service.findByAccountId('user-1')).resolves.toEqual([
      {
        _id: 's1',
        expiresAt: new Date(200_000),
        payload: {
          accountId: 'user-1',
          exp: 200,
          kind: 'Session',
          jti: 's1',
        },
      },
    ]);
    await expect(service.findByAccountId('')).resolves.toEqual([]);
  });

  it('revokes a matching session by its public JTI', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue([[null, JSON.stringify({ jti: 'session-jti' })]]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:physical-id',
    ]);
    const destroy = vi.spyOn(service, 'destroy').mockResolvedValue(undefined);

    await expect(service.revokeSession('session-jti')).resolves.toBe(true);
    expect(destroy).toHaveBeenCalledWith('physical-id');
  });

  it('bulk-revokes account sessions except the current session', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({ accountId: 'user-1', kind: 'Session', jti: 'keep' }),
        ],
        [
          null,
          JSON.stringify({ accountId: 'user-1', kind: 'Session', jti: 'drop' }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-2',
            kind: 'Session',
            jti: 'other',
          }),
        ],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    service = new RedisOidcAdminService(
      'Session',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:keep-id',
      'parako:default:oidc:Session:drop-id',
      'parako:default:oidc:Session:other-id',
    ]);

    await expect(
      service.revokeAllSessionsExcept('user-1', 'keep')
    ).resolves.toBe(1);
    expect(deletePipeline.del).toHaveBeenCalledWith(
      'parako:default:oidc:Session:drop-id'
    );
  });

  it('reports only sessions Redis actually deleted', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            kind: 'Session',
            jti: 'drop',
          }),
        ],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 0]]),
    };
    service = new RedisOidcAdminService(
      'Session',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:drop-id',
    ]);

    await expect(
      service.revokeAllSessionsExcept('user-1', 'keep')
    ).resolves.toBe(0);

    service = new RedisOidcAdminService(
      'Session',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:drop-id',
    ]);
    await expect(service.deleteSessionsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it('treats an aborted multi-session delete pipeline as deleting nothing', async () => {
    const pipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(null),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );

    await expect(service.deleteSessionsByIds(['s1'])).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it('computes session statistics and returns a public-ID lookup', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const results = [
      [null, JSON.stringify({ kind: 'Session', exp: 200, jti: 'active' })],
      [null, JSON.stringify({ kind: 'Session', exp: 50, jti: 'expired' })],
      [null, JSON.stringify({ kind: 'Grant', exp: 200, jti: 'grant' })],
    ];
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(results),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:active-id',
      'parako:default:oidc:Session:expired-id',
      'parako:default:oidc:Session:grant-id',
    ]);

    await expect(service.getSessionStatistics()).resolves.toEqual({
      total: 2,
      active: 1,
      expired: 1,
    });
    await expect(service.findSessionById('expired')).resolves.toEqual({
      _id: 'expired-id',
      payload: { kind: 'Session', exp: 50, jti: 'expired' },
      expiresAt: new Date(50_000),
    });
  });

  it('preserves epoch-zero session expiry and login timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            kind: 'Session',
            exp: 0,
            loginTs: 0,
            iat: 100,
            jti: 'epoch',
          }),
        ],
        [
          null,
          JSON.stringify({
            kind: 'Session',
            exp: 200,
            loginTs: 1,
            iat: 0,
            jti: 'later',
          }),
        ],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:epoch-id',
      'parako:default:oidc:Session:later-id',
    ]);

    await expect(service.getSessionStatistics()).resolves.toEqual({
      total: 2,
      active: 1,
      expired: 1,
    });
    await expect(service.findSessionById('epoch')).resolves.toMatchObject({
      expiresAt: new Date(0),
    });
    await expect(
      service.findSessionsWithPagination({}, 'loginTime', 1)
    ).resolves.toMatchObject([
      { payload: { jti: 'epoch' } },
      { payload: { jti: 'later' } },
    ]);
  });

  it('normalizes sparse session records without inventing expiry or timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(200_000);
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            kind: 'Session',
            jti: 'without-expiry',
          }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            exp: 100,
            kind: 'Session',
            jti: 'with-expiry',
          }),
        ],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:without-expiry-id',
      'parako:default:oidc:Session:with-expiry-id',
    ]);

    await expect(service.getSessionStatistics()).resolves.toEqual({
      total: 2,
      active: 0,
      expired: 1,
    });
    await expect(
      service.findSessionsWithPagination({ accountId: 'user-1' })
    ).resolves.toMatchObject([
      { payload: { jti: 'without-expiry' }, expiresAt: null },
      { payload: { jti: 'with-expiry' }, expiresAt: new Date(100_000) },
    ]);
    await expect(
      service.findSessionById('without-expiry')
    ).resolves.toMatchObject({ expiresAt: null });
    await expect(service.exportAllSessions()).resolves.toMatchObject([
      { payload: { jti: 'without-expiry' }, expiresAt: null },
      { payload: { jti: 'with-expiry' }, expiresAt: new Date(100_000) },
    ]);
  });

  it('exports sessions in newest-first order and deletes requested IDs', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ kind: 'Session', iat: 10, jti: 'older' })],
        [null, JSON.stringify({ kind: 'Session', iat: 20, jti: 'newer' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => readPipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Session:older-id',
      'parako:default:oidc:Session:newer-id',
    ]);

    const exported = await service.exportAllSessions();
    expect(exported.map(item => item._id)).toEqual(['newer-id', 'older-id']);

    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 1],
        [null, 0],
      ]),
    };
    service = new RedisOidcAdminService(
      'Session',
      { pipeline: () => deletePipeline } as any,
      logger,
      testPrefix
    );
    await expect(
      service.deleteSessionsByIds(['older-id', 'missing-id'])
    ).resolves.toEqual({ deletedCount: 1 });
  });

  it('deletes every session belonging to an account', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ accountId: 'user-1' })],
        [null, JSON.stringify({ accountId: 'user-2' })],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    service = new RedisOidcAdminService(
      'Session',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['s1', 's2']);

    await expect(service.deleteSessionsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 1,
    });
    expect(deletePipeline.del).toHaveBeenCalledWith('s1');
  });
});

describe('RedisOidcAdminService — Grant model', () => {
  let service: RedisOidcAdminService;

  beforeEach(() => {
    service = new RedisOidcAdminService(
      'Grant',
      mockClient,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  it('findGrantsByAccountId returns empty array when no keys exist', async () => {
    const results = await service.findGrantsByAccountId('user-1');
    expect(results).toEqual([]);
  });

  it('deleteGrantsByAccountId returns zero count when no keys exist', async () => {
    const result = await service.deleteGrantsByAccountId('user-1');
    expect(result.deletedCount).toBe(0);
  });

  it('reads each grant once when deleting by account', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ accountId: 'user-1' })],
        [null, JSON.stringify({ accountId: 'user-2' })],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1',
      'parako:default:oidc:Grant:g2',
    ]);

    await expect(service.deleteGrantsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 1,
    });
    expect(readPipeline.get).toHaveBeenCalledTimes(2);
    expect(deletePipeline.del).toHaveBeenCalledWith(
      'parako:default:oidc:Grant:g1'
    );
  });

  it('reports only grants Redis actually deleted', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue([[null, JSON.stringify({ accountId: 'user-1' })]]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[new Error('delete failed'), null]]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1',
    ]);

    await expect(service.deleteGrantsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it('matches portable payload-prefixed exact and literal-search filters', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'Alice A+B',
            clientId: 'client-1',
          }),
        ],
        [null, JSON.stringify({ accountId: 'Bob', clientId: 'client-2' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1',
      'parako:default:oidc:Grant:g2',
    ]);

    const count = await service.countGrants({
      'payload.clientId': 'client-1',
      $or: [
        { 'payload.accountId': { $regex: 'a\\+b', $options: 'i' } },
        { 'payload.clientId': { $regex: 'a\\+b', $options: 'i' } },
      ],
    });

    expect(count).toBe(1);
  });

  it.each([
    ['created_at', 1, ['g1', 'g2']],
    ['payload.iat', -1, ['g2', 'g1']],
    ['payload.accountId', 1, ['g2', 'g1']],
    ['payload.clientId', 1, ['g1', 'g2']],
    ['payload.exp', 1, ['g2', 'g1']],
  ])(
    'sorts public field %s consistently',
    async (sortBy, order, expectedIds) => {
      const pipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [
            null,
            JSON.stringify({
              accountId: 'zeta',
              clientId: 'client-a',
              iat: 100,
              exp: 300,
            }),
          ],
          [
            null,
            JSON.stringify({
              accountId: 'alpha',
              clientId: 'client-z',
              iat: 200,
              exp: 100,
            }),
          ],
        ]),
      };
      service = new RedisOidcAdminService(
        'Grant',
        { pipeline: () => pipeline } as any,
        logger,
        testPrefix
      );
      vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
        'parako:default:oidc:Grant:g1',
        'parako:default:oidc:Grant:g2',
      ]);

      const results = await service.findGrantsWithPagination(
        {},
        sortBy,
        order,
        0,
        20
      );

      expect(results.map(grant => grant._id)).toEqual(expectedIds);
    }
  );

  it('finds grants by account and client with normalized records', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            clientId: 'client-1',
            exp: 100,
            jti: 'g1',
          }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-2',
            clientId: 'client-2',
            jti: 'g2',
          }),
        ],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1-id',
      'parako:default:oidc:Grant:g2-id',
    ]);

    await expect(service.findGrantsByAccountId('user-1')).resolves.toEqual([
      {
        _id: 'g1-id',
        payload: {
          accountId: 'user-1',
          clientId: 'client-1',
          exp: 100,
          jti: 'g1',
        },
        expiresAt: new Date(100_000),
      },
    ]);
    await expect(service.findGrantsByClientId('client-2')).resolves.toEqual([
      {
        _id: 'g2-id',
        payload: {
          accountId: 'user-2',
          clientId: 'client-2',
          jti: 'g2',
        },
        expiresAt: undefined,
      },
    ]);
  });

  it('finds and revokes grants by account/client identity', async () => {
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1-id',
      'parako:default:oidc:Grant:g2-id',
    ]);
    const find = vi
      .spyOn(service, 'find')
      .mockImplementation(async id =>
        id === 'g1-id'
          ? { accountId: 'user-1', clientId: 'client-1', jti: 'grant-jti' }
          : { accountId: 'user-2', clientId: 'client-2', jti: 'other-jti' }
      );

    await expect(
      service.findGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toEqual({
      _id: 'g1-id',
      payload: {
        accountId: 'user-1',
        clientId: 'client-1',
        jti: 'grant-jti',
      },
      expiresAt: undefined,
    });
    expect(find).toHaveBeenCalledWith('g1-id');

    const revoke = vi
      .spyOn(service, 'revokeByGrantId')
      .mockResolvedValue(undefined);
    await expect(
      service.revokeGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toBe(true);
    expect(revoke).toHaveBeenCalledWith('grant-jti');
  });

  it('revokes every valid grant returned for an account or client', async () => {
    const grants = [
      { payload: { jti: 'grant-1' } },
      { payload: {} },
      { payload: { jti: 'grant-2' } },
    ];
    vi.spyOn(service, 'findGrantsByAccountId').mockResolvedValue(grants);
    vi.spyOn(service, 'findGrantsByClientId').mockResolvedValue(grants);
    const revoke = vi
      .spyOn(service, 'revokeByGrantId')
      .mockResolvedValue(undefined);

    await expect(service.revokeAllGrantsForAccount('user-1')).resolves.toBe(2);
    await expect(service.revokeAllGrantsForClient('client-1')).resolves.toBe(2);
    expect(revoke).toHaveBeenCalledTimes(4);
    await expect(service.revokeAllGrantsForAccount('')).resolves.toBe(0);
    await expect(service.revokeAllGrantsForClient('')).resolves.toBe(0);
  });

  it('revokes a direct grant ID through the model destroy operation', async () => {
    const destroy = vi.spyOn(service, 'destroy').mockResolvedValue(undefined);

    await service.revokeGrantById('grant-1');
    expect(destroy).toHaveBeenCalledWith('grant-1');
    await service.revokeGrantById('');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('computes grant statistics grouped by client and user', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(40 * 24 * 60 * 60 * 1000);
    const now = Math.floor(Date.now() / 1000);
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            clientId: 'client-1',
            iat: now,
            exp: now + 10,
          }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            clientId: 'client-1',
            iat: 1,
            exp: now - 10,
          }),
        ],
        [
          null,
          JSON.stringify({
            accountId: 'user-2',
            clientId: 'client-2',
            iat: now,
          }),
        ],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['g1', 'g2', 'g3']);

    await expect(service.getGrantStatistics()).resolves.toEqual({
      total: 3,
      recent: 2,
      expired: 1,
      byClient: [
        { _id: 'client-1', count: 2 },
        { _id: 'client-2', count: 1 },
      ],
      byUser: [
        { _id: 'user-1', count: 2 },
        { _id: 'user-2', count: 1 },
      ],
    });
  });

  it('preserves epoch-zero grant expiry in records and statistics', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const get = vi.fn().mockResolvedValue(
      JSON.stringify({
        accountId: 'user-1',
        clientId: 'client-1',
        exp: 0,
        jti: 'epoch-grant',
      })
    );
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [
          null,
          JSON.stringify({
            accountId: 'user-1',
            clientId: 'client-1',
            exp: 0,
            jti: 'epoch-grant',
          }),
        ],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      { get, pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:epoch-grant',
    ]);

    await expect(service.findGrantById('epoch-grant')).resolves.toMatchObject({
      expiresAt: new Date(0),
    });
    await expect(
      service.findGrantsByAccountId('user-1')
    ).resolves.toMatchObject([{ expiresAt: new Date(0) }]);
    await expect(service.getGrantStatistics()).resolves.toMatchObject({
      total: 1,
      expired: 1,
    });
  });

  it('normalizes sparse grant records without inventing identity or expiry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(200_000);
    const withoutExpiry = {
      accountId: 'user-1',
      clientId: 'client-1',
      jti: 'without-expiry',
    };
    const withExpiry = {
      accountId: 'user-1',
      clientId: 'client-1',
      exp: 100,
      jti: 'with-expiry',
    };
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify(withoutExpiry)],
        [null, JSON.stringify(withExpiry)],
        [null, JSON.stringify({ jti: 'without-identity' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      {
        get: vi.fn().mockResolvedValue(JSON.stringify(withoutExpiry)),
        pipeline: () => pipeline,
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:without-expiry-id',
      'parako:default:oidc:Grant:with-expiry-id',
      'parako:default:oidc:Grant:without-identity-id',
    ]);

    await expect(
      service.findGrantsByAccountId('user-1')
    ).resolves.toMatchObject([
      { payload: { jti: 'without-expiry' }, expiresAt: undefined },
      { payload: { jti: 'with-expiry' }, expiresAt: new Date(100_000) },
    ]);
    await expect(
      service.findGrantsByClientId('client-1')
    ).resolves.toMatchObject([
      { payload: { jti: 'without-expiry' }, expiresAt: undefined },
      { payload: { jti: 'with-expiry' }, expiresAt: new Date(100_000) },
    ]);
    await expect(
      service.findGrantsWithPagination({ accountId: 'user-1' })
    ).resolves.toMatchObject([
      { payload: { jti: 'without-expiry' }, expiresAt: null },
      { payload: { jti: 'with-expiry' }, expiresAt: new Date(100_000) },
    ]);
    await expect(
      service.findGrantById('without-expiry')
    ).resolves.toMatchObject({
      expiresAt: null,
    });
    await expect(service.getGrantStatistics()).resolves.toEqual({
      total: 3,
      recent: 0,
      expired: 1,
      byClient: [{ _id: 'client-1', count: 2 }],
      byUser: [{ _id: 'user-1', count: 2 }],
    });

    vi.spyOn(service, 'find').mockResolvedValue(withExpiry);
    await expect(
      service.findGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toMatchObject({ expiresAt: new Date(100_000) });
  });

  it('finds a grant directly and exports all valid grant rows', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ jti: 'g1', exp: 100 }));
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ jti: 'g1', exp: 100 })],
        [null, JSON.stringify({ jti: 'g2' })],
      ]),
    };
    service = new RedisOidcAdminService(
      'Grant',
      { get, pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:g1',
      'parako:default:oidc:Grant:g2',
    ]);

    await expect(service.findGrantById('g1')).resolves.toEqual({
      _id: 'g1',
      payload: { jti: 'g1', exp: 100 },
      expiresAt: new Date(100_000),
    });
    const exported = await service.exportAllGrants();
    expect(exported.map(item => item._id)).toEqual(['g1', 'g2']);
  });
});

describe.each(['AccessToken', 'RefreshToken', 'Interaction'] as const)(
  'RedisOidcAdminService — %s model deleteByAccountId',
  model => {
    let service: RedisOidcAdminService;

    beforeEach(() => {
      service = new RedisOidcAdminService(
        model,
        mockClient,
        logger,
        testPrefix
      );
      vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
    });

    it('returns zero count when no keys exist', async () => {
      const result = await service.deleteByAccountId('user-1');
      expect(result.deletedCount).toBe(0);
    });
  }
);

describe('RedisOidcAdminService — Client CRUD', () => {
  let service: RedisOidcAdminService;
  let mockSet: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSet = vi.fn().mockResolvedValue('OK');
    mockGet = vi.fn().mockResolvedValue(null);
    mockDel = vi.fn().mockResolvedValue(1);
    const client = { set: mockSet, get: mockGet, del: mockDel } as any;
    service = new RedisOidcAdminService('Client', client, logger, testPrefix);
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  describe('createClient', () => {
    it('stores client data as JSON in Redis', async () => {
      const result = await service.createClient({
        client_name: 'Test App',
        redirect_uris: ['https://app.example.com/cb'],
      });
      expect(result.client_id).toBeTruthy();
      expect(result.client_name).toBe('Test App');
      expect(result.client_secret).toBeTruthy();
      expect(mockSet).toHaveBeenCalledWith(
        `${testPrefix}:default:oidc:Client:${result.client_id}`,
        expect.any(String),
        'NX'
      );
    });

    it('rejects invalid client data', async () => {
      await expect(
        service.createClient({ application_type: 'invalid' as any })
      ).rejects.toThrow('Client validation failed');
    });

    it('atomically rejects a duplicate client ID instead of overwriting it', async () => {
      mockSet.mockResolvedValueOnce(null);

      await expect(
        service.createClient({
          client_id: 'duplicate-client',
          client_name: 'Duplicate',
          redirect_uris: ['https://app.example.com/cb'],
        })
      ).rejects.toThrow('Client with ID duplicate-client already exists');
      expect(mockSet).toHaveBeenCalledWith(
        `${testPrefix}:default:oidc:Client:duplicate-client`,
        expect.any(String),
        'NX'
      );
    });
  });

  describe('findClientById', () => {
    it('returns client when found', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        })
      );
      const result = await service.findClientById('c1');
      expect(result).not.toBeNull();
      expect(result!.client_id).toBe('c1');
    });

    it('recovers a missing stored client ID from the Redis key', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_name: 'Legacy App',
          application_type: 'web',
        })
      );

      await expect(
        service.findClientById('legacy-client')
      ).resolves.toMatchObject({
        client_id: 'legacy-client',
        client_name: 'Legacy App',
      });
    });

    it('returns null when not found', async () => {
      mockGet.mockResolvedValue(null);
      expect(await service.findClientById('nonexistent')).toBeNull();
    });
  });

  describe('findAllClients', () => {
    it('returns empty array when no keys exist', async () => {
      const results = await service.findAllClients();
      expect(results).toEqual([]);
    });

    it('lists valid clients, skips corrupt rows, and applies filters', async () => {
      const pipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [
            null,
            JSON.stringify({
              client_name: 'Active web app',
              application_type: 'web',
              active: true,
            }),
          ],
          [null, '{invalid-json'],
          [null, '["private-marker"]'],
          [
            null,
            JSON.stringify({
              client_id: 'inactive',
              client_name: 'Inactive app',
              application_type: 'web',
              active: false,
            }),
          ],
        ]),
      };
      service = new RedisOidcAdminService(
        'Client',
        { pipeline: () => pipeline } as any,
        logger,
        testPrefix
      );
      vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
        'parako:default:oidc:Client:active',
        'parako:default:oidc:Client:corrupt',
        'parako:default:oidc:Client:wrong-shape',
        'parako:default:oidc:Client:inactive',
      ]);

      const clients = await service.findAllClients({ active: true });
      expect(clients).toHaveLength(1);
      expect(clients[0].client_id).toBe('active');
    });
  });

  describe('deleteClient', () => {
    it('deletes and returns true', async () => {
      expect(await service.deleteClient('c1')).toBe(true);
      expect(mockDel).toHaveBeenCalledWith(
        `${testPrefix}:default:oidc:Client:c1`
      );
    });

    it('returns false when nothing deleted', async () => {
      mockDel.mockResolvedValue(0);
      expect(await service.deleteClient('nonexistent')).toBe(false);
    });
  });

  describe('updateClient', () => {
    it('returns null when client not found', async () => {
      mockGet.mockResolvedValue(null);
      expect(
        await service.updateClient('nonexistent', { client_name: 'X' })
      ).toBeNull();
    });

    it('merges updates and stores back', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'Old',
          application_type: 'web',
        })
      );
      const result = await service.updateClient('c1', {
        client_name: 'New Name',
      });
      expect(result).not.toBeNull();
      expect(result!.client_name).toBe('New Name');
      expect(mockSet).toHaveBeenCalled();
    });

    it('normalizes a legacy SPA update before persisting provider metadata', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        })
      );

      const result = await service.updateClient('c1', {
        application_type: 'spa',
      });

      expect(result).toMatchObject({ application_type: 'web', preset: 'spa' });
      const payload = JSON.parse(mockSet.mock.calls[0][1]);
      expect(payload).toMatchObject({ application_type: 'web', preset: 'spa' });
    });

    it('rejects an update whose merged client metadata is invalid', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        })
      );

      await expect(
        service.updateClient('c1', {
          token_endpoint_auth_method: 'private_key_jwt',
        })
      ).rejects.toThrow('Client validation failed');
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('generateClientId returns a UUID', () => {
      expect(service.generateClientId()).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generateClientSecret returns a 64-char hex string', () => {
      expect(service.generateClientSecret()).toHaveLength(64);
    });

    it('delegates search, activation, deactivation, and secret regeneration', async () => {
      const clients = [
        {
          client_id: 'c1',
          client_name: 'Searchable App',
          application_type: 'web' as const,
        },
      ];
      vi.spyOn(service, 'findAllClients').mockResolvedValue(clients);
      await expect(service.searchClients('searchable')).resolves.toEqual(
        clients
      );

      const update = vi
        .spyOn(service, 'updateClient')
        .mockImplementation(async (clientId, changes) => ({
          ...clients[0],
          ...changes,
          client_id: clientId,
        }));
      await expect(service.activateClient('c1')).resolves.toMatchObject({
        active: true,
      });
      await expect(service.deactivateClient('c1')).resolves.toMatchObject({
        active: false,
      });

      vi.spyOn(service, 'findClientById').mockResolvedValue(clients[0]);
      const regenerated = await service.regenerateClientSecret('c1');
      expect(regenerated?.newSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(update).toHaveBeenLastCalledWith('c1', {
        client_secret: regenerated?.newSecret,
      });
    });

    it('returns null when a regenerated secret cannot be persisted', async () => {
      const client = {
        client_id: 'c1',
        client_name: 'App',
        application_type: 'web' as const,
      };
      vi.spyOn(service, 'findClientById').mockResolvedValue(client);
      vi.spyOn(service, 'updateClient').mockResolvedValue(null);

      await expect(service.regenerateClientSecret('c1')).resolves.toBeNull();
    });

    it.each(['none', 'private_key_jwt'] as const)(
      'refuses secret regeneration for %s clients',
      async tokenEndpointAuthMethod => {
        vi.spyOn(service, 'findClientById').mockResolvedValue({
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
          token_endpoint_auth_method: tokenEndpointAuthMethod,
        });
        const update = vi.spyOn(service, 'updateClient');

        await expect(service.regenerateClientSecret('c1')).rejects.toThrow(
          'does not use secret-based authentication'
        );
        expect(update).not.toHaveBeenCalled();
      }
    );

    it('computes statistics, counts keys, and validates client data', async () => {
      vi.spyOn(service, 'findAllClients').mockResolvedValue([
        {
          client_id: 'active-web',
          client_name: 'Active',
          application_type: 'web',
          active: true,
        },
        {
          client_id: 'inactive-native',
          client_name: 'Inactive',
          application_type: 'native',
          active: false,
        },
      ]);
      await expect(service.getClientStatistics()).resolves.toEqual({
        total: 2,
        active: 1,
        inactive: 1,
        byType: { web: 1, native: 1, spa: 0 },
      });

      vi.mocked((service as any).scanKeys).mockResolvedValue(['c1', 'c2']);
      await expect(service.countClients()).resolves.toBe(2);
      expect(
        service.validateClientDataSync({
          client_name: 'Valid',
          redirect_uris: ['https://app.example.com/cb'],
        }).isValid
      ).toBe(true);
    });
  });
});

describe('RedisOidcAdminService — generic admin helpers', () => {
  it('returns unique nested values from filtered records', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ accountId: 'user-1', clientId: 'client-1' })],
        [null, JSON.stringify({ accountId: 'user-2', clientId: 'client-1' })],
        [null, JSON.stringify({ accountId: 'user-3', clientId: 'client-2' })],
      ]),
    };
    const service = new RedisOidcAdminService(
      'Grant',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['g1', 'g2', 'g3']);

    await expect(
      service.getDistinctValues('payload.clientId', {
        'payload.clientId': 'client-1',
      })
    ).resolves.toEqual(['client-1']);
  });

  it('skips missing fields when collecting distinct values', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue([
          [null, JSON.stringify({ accountId: 'user-1', score: 10 })],
        ]),
    };
    const service = new RedisOidcAdminService(
      'Grant',
      { pipeline: () => pipeline } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['g1']);

    await expect(
      service.getDistinctValues('missing', { score: {} })
    ).resolves.toEqual([]);
  });

  it('deletes Interaction records using their nested session account', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ session: { accountId: 'user-1' } })],
        [null, JSON.stringify({ session: { accountId: 'user-2' } })],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    const service = new RedisOidcAdminService(
      'Interaction',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['i1', 'i2']);

    await expect(service.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 1,
    });
    expect(deletePipeline.del).toHaveBeenCalledWith('i1');
  });

  it('deletes non-Interaction records using their direct account identity', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify({ accountId: 'user-1' })],
        [null, JSON.stringify({ accountId: 'user-2' })],
      ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    const service = new RedisOidcAdminService(
      'AccessToken',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['t1', 't2']);

    await expect(service.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 1,
    });
    expect(deletePipeline.del).toHaveBeenCalledWith('t1');
  });

  it('reports only generic account records Redis actually deleted', async () => {
    const readPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue([
          [null, JSON.stringify({ session: { accountId: 'user-1' } })],
        ]),
    };
    const deletePipeline = {
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 0]]),
    };
    const service = new RedisOidcAdminService(
      'Interaction',
      {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(deletePipeline),
      } as any,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(['i1']);

    await expect(service.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
  });
});

describe('RedisOidcAdminService — Redis degradation', () => {
  function createService(
    model: string,
    client: Record<string, unknown>,
    keys: string[] = [`parako:default:oidc:${model}:record-1`]
  ): RedisOidcAdminService {
    const service = new RedisOidcAdminService(
      model,
      client as unknown as Redis,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue(keys);
    return service;
  }

  describe.each([
    {
      label: 'an unavailable pipeline',
      client: { pipeline: () => undefined },
    },
    {
      label: 'an aborted pipeline',
      client: {
        pipeline: () => ({
          get: vi.fn().mockReturnThis(),
          del: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue(null),
        }),
      },
    },
  ])('$label', ({ client }) => {
    it('returns the documented empty results for session operations', async () => {
      const service = createService('Session', client as any);

      await expect(service.findByAccountId('user-1')).resolves.toEqual([]);
      await expect(service.revokeSession('session-1')).resolves.toBe(false);
      await expect(
        service.revokeAllSessionsExcept('user-1', 'session-1')
      ).resolves.toBe(0);
      await expect(service.getSessionStatistics()).resolves.toEqual({
        total: 0,
        active: 0,
        expired: 0,
      });
      await expect(
        service.countSessions({ accountId: 'user-1' })
      ).resolves.toBe(0);
      await expect(service.findSessionsWithPagination()).resolves.toEqual([]);
      await expect(service.findSessionById('session-1')).resolves.toBeNull();
      await expect(service.exportAllSessions()).resolves.toEqual([]);
      await expect(
        service.deleteSessionsByAccountId('user-1')
      ).resolves.toEqual({ deletedCount: 0 });
      await expect(service.deleteSessionsByIds(['session-1'])).resolves.toEqual(
        {
          deletedCount: 0,
        }
      );
    });

    it('returns the documented empty results for grant and generic operations', async () => {
      const service = createService('Grant', client as any);

      await expect(service.findGrantsByAccountId('user-1')).resolves.toEqual(
        []
      );
      await expect(service.findGrantsByClientId('client-1')).resolves.toEqual(
        []
      );
      await expect(service.countGrants({ accountId: 'user-1' })).resolves.toBe(
        0
      );
      await expect(service.findGrantsWithPagination()).resolves.toEqual([]);
      await expect(service.getGrantStatistics()).resolves.toEqual({
        total: 0,
        recent: 0,
        expired: 0,
        byClient: [],
        byUser: [],
      });
      await expect(service.exportAllGrants()).resolves.toEqual([]);
      await expect(service.deleteGrantsByAccountId('user-1')).resolves.toEqual({
        deletedCount: 0,
      });
      await expect(service.deleteByAccountId('user-1')).resolves.toEqual({
        deletedCount: 0,
      });
      await expect(service.getDistinctValues('accountId')).resolves.toEqual([]);

      const clientService = createService('Client', client as any);
      await expect(clientService.findAllClients()).resolves.toEqual([]);
    });
  });

  it('short-circuits empty identifiers and empty key scans', async () => {
    const session = createService('Session', {}, []);
    await expect(session.findByAccountId('')).resolves.toEqual([]);
    await expect(session.revokeSession('session-1')).resolves.toBe(false);
    await expect(
      session.revokeAllSessionsExcept('user-1', 'session-1')
    ).resolves.toBe(0);
    await expect(session.countSessions()).resolves.toBe(0);
    await expect(session.findSessionsWithPagination()).resolves.toEqual([]);
    await expect(session.findSessionById('session-1')).resolves.toBeNull();
    await expect(session.exportAllSessions()).resolves.toEqual([]);

    const grant = createService(
      'Grant',
      { get: vi.fn().mockResolvedValue(null) },
      []
    );
    await expect(grant.findGrantsByAccountId('')).resolves.toEqual([]);
    await expect(grant.findGrantsByClientId('')).resolves.toEqual([]);
    await expect(grant.findGrantsByAccountId('user-1')).resolves.toEqual([]);
    await expect(grant.findGrantsByClientId('client-1')).resolves.toEqual([]);
    await expect(
      grant.findGrantByAccountAndClient('', 'client-1')
    ).resolves.toBeNull();
    await expect(
      grant.findGrantByAccountAndClient('user-1', '')
    ).resolves.toBeNull();
    await expect(grant.revokeAllGrantsForAccount('user-1')).resolves.toBe(0);
    await expect(grant.revokeAllGrantsForClient('client-1')).resolves.toBe(0);
    await expect(
      grant.revokeGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toBe(false);
    await expect(
      grant.revokeGrantByAccountAndClient('', 'client-1')
    ).resolves.toBe(false);
    await expect(grant.countGrants()).resolves.toBe(0);
    await expect(grant.findGrantsWithPagination()).resolves.toEqual([]);
    await expect(grant.findGrantById('missing')).resolves.toBeNull();
    await expect(grant.getGrantStatistics()).resolves.toEqual({
      total: 0,
      recent: 0,
      expired: 0,
      byClient: [],
      byUser: [],
    });
    await expect(grant.exportAllGrants()).resolves.toEqual([]);
    await expect(grant.getDistinctValues('accountId')).resolves.toEqual([]);

    const client = createService('Client', {
      get: vi.fn().mockResolvedValue(null),
    });
    await expect(client.regenerateClientSecret('missing')).resolves.toBeNull();
  });

  it('continues grant processing after individual read and revoke failures', async () => {
    const failure = new Error('individual grant failed');
    const service = createService('Grant', {});
    vi.spyOn(service, 'find')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    vi.mocked((service as any).scanKeys).mockResolvedValue([
      'parako:default:oidc:Grant:broken',
      'parako:default:oidc:Grant:missing',
    ]);
    await expect(
      service.findGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toBeNull();

    const grants = [
      { payload: { jti: 'broken' } },
      { payload: { jti: 'working' } },
    ];
    vi.spyOn(service, 'findGrantsByAccountId').mockResolvedValue(grants);
    vi.spyOn(service, 'findGrantsByClientId').mockResolvedValue(grants);
    vi.spyOn(service, 'revokeByGrantId')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    await expect(service.revokeAllGrantsForAccount('user-1')).resolves.toBe(1);
    await expect(service.revokeAllGrantsForClient('client-1')).resolves.toBe(1);

    vi.mocked((service as any).scanKeys).mockResolvedValue([
      'parako:default:oidc:Grant:unreadable',
      'parako:default:oidc:Grant:matched-without-jti',
      'parako:default:oidc:Grant:matched-broken',
      'parako:default:oidc:Grant:matched-working',
    ]);
    vi.mocked(service.find).mockReset();
    vi.mocked(service.find)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ accountId: 'user-1', clientId: 'client-1' })
      .mockResolvedValueOnce({
        accountId: 'user-1',
        clientId: 'client-1',
        jti: 'broken',
      })
      .mockResolvedValueOnce({
        accountId: 'user-1',
        clientId: 'client-1',
        jti: 'working',
      });
    vi.mocked(service.revokeByGrantId)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    await expect(
      service.revokeGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toBe(true);
  });

  it('normalizes non-Error row failures in warning logs', async () => {
    const warn = vi.fn();
    const service = new RedisOidcAdminService(
      'Grant',
      mockClient,
      { ...logger, warn },
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([
      'parako:default:oidc:Grant:unreadable',
    ]);
    vi.spyOn(service, 'find').mockRejectedValue('non-error failure');

    await expect(
      service.findGrantByAccountAndClient('user-1', 'client-1')
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Failed to process grant key parako:default:oidc:Grant:unreadable',
      { error: 'non-error failure' }
    );
  });

  it('ignores failed and empty pipeline rows across admin read APIs', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [new Error('row failed'), JSON.stringify({ accountId: 'user-1' })],
        [null, null],
      ]),
    };
    const keys = [
      'parako:default:oidc:Session:failed',
      'parako:default:oidc:Session:empty',
    ];
    const session = createService(
      'Session',
      { pipeline: () => pipeline },
      keys
    );

    await expect(session.findByAccountId('user-1')).resolves.toEqual([]);
    await expect(session.revokeSession('session-1')).resolves.toBe(false);
    await expect(
      session.revokeAllSessionsExcept('user-1', 'session-1')
    ).resolves.toBe(0);
    await expect(session.getSessionStatistics()).resolves.toEqual({
      total: 0,
      active: 0,
      expired: 0,
    });
    await expect(session.countSessions({ accountId: 'user-1' })).resolves.toBe(
      0
    );
    await expect(
      session.findSessionsWithPagination({ accountId: 'user-1' })
    ).resolves.toEqual([]);
    await expect(session.findSessionById('session-1')).resolves.toBeNull();
    await expect(session.exportAllSessions()).resolves.toEqual([]);
    await expect(session.deleteSessionsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });

    const grantKeys = keys.map(key => key.replace('Session', 'Grant'));
    const grant = createService(
      'Grant',
      { pipeline: () => pipeline },
      grantKeys
    );
    await expect(grant.findGrantsByAccountId('user-1')).resolves.toEqual([]);
    await expect(grant.findGrantsByClientId('client-1')).resolves.toEqual([]);
    await expect(grant.countGrants({ accountId: 'user-1' })).resolves.toBe(0);
    await expect(
      grant.findGrantsWithPagination({ accountId: 'user-1' })
    ).resolves.toEqual([]);
    await expect(grant.getGrantStatistics()).resolves.toEqual({
      total: 0,
      recent: 0,
      expired: 0,
      byClient: [],
      byUser: [],
    });
    await expect(grant.exportAllGrants()).resolves.toEqual([]);
    await expect(grant.deleteGrantsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(grant.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(grant.getDistinctValues('accountId')).resolves.toEqual([]);

    const client = createService(
      'Client',
      { pipeline: () => pipeline },
      keys.map(key => key.replace('Session', 'Client'))
    );
    await expect(client.findAllClients()).resolves.toEqual([]);
  });

  it('reports no deletions when Redis becomes unavailable after matching rows', async () => {
    const createPartiallyAvailableClient = (
      payload: Record<string, unknown>
    ) => {
      const readPipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, JSON.stringify(payload)]]),
      };
      return {
        pipeline: vi
          .fn()
          .mockReturnValueOnce(readPipeline)
          .mockReturnValueOnce(undefined),
      };
    };

    const session = createService(
      'Session',
      createPartiallyAvailableClient({
        accountId: 'user-1',
        jti: 'session-2',
        kind: 'Session',
      }) as any
    );
    await expect(
      session.revokeAllSessionsExcept('user-1', 'session-1')
    ).resolves.toBe(0);

    const sessionDelete = createService(
      'Session',
      createPartiallyAvailableClient({ accountId: 'user-1' }) as any
    );
    await expect(
      sessionDelete.deleteSessionsByAccountId('user-1')
    ).resolves.toEqual({ deletedCount: 0 });

    const grant = createService(
      'Grant',
      createPartiallyAvailableClient({ accountId: 'user-1' }) as any
    );
    await expect(grant.deleteGrantsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });

    const accessToken = createService(
      'AccessToken',
      createPartiallyAvailableClient({ accountId: 'user-1' }) as any
    );
    await expect(accessToken.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it.each([
    [{ $or: [{ accountId: 'other' }] }, 0],
    [{ $or: [{ accountId: 'user-1' }] }, 1],
    [{ $or: [{ name: { $regex: '^alice$' } }] }, 0],
    [{ name: { $regex: '^alice$', $options: 'i' } }, 1],
    [{ name: { $regex: 'missing' } }, 0],
    [{ score: { $gt: 10 } }, 0],
    [{ score: { $gt: 9 } }, 1],
    [{ score: { $lt: 10 } }, 0],
    [{ score: { $lt: 11 } }, 1],
    [{ score: { $lte: 9 } }, 0],
    [{ score: { $lte: 10 } }, 1],
    [{ score: { $gte: 11 } }, 0],
    [{ score: { $gte: 10 } }, 1],
    [{ accountId: 'other' }, 0],
  ] as const)(
    'evaluates the complete portable filter operator set for %j',
    async (filters, expected) => {
      const pipeline = {
        get: vi.fn().mockReturnThis(),
        exec: vi
          .fn()
          .mockResolvedValue([
            [
              null,
              JSON.stringify({ accountId: 'user-1', name: 'Alice', score: 10 }),
            ],
          ]),
      };
      const service = createService('Grant', { pipeline: () => pipeline });

      await expect(service.countGrants(filters)).resolves.toBe(expected);
    }
  );

  it('skips corrupt Redis rows consistently across admin read operations', async () => {
    const pipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, '{invalid-json']]),
    };
    const session = createService('Session', { pipeline: () => pipeline });

    await expect(session.findByAccountId('user-1')).resolves.toEqual([]);
    await expect(session.revokeSession('session-1')).resolves.toBe(false);
    await expect(
      session.revokeAllSessionsExcept('user-1', 'session-1')
    ).resolves.toBe(0);
    await expect(session.getSessionStatistics()).resolves.toEqual({
      total: 0,
      active: 0,
      expired: 0,
    });
    await expect(session.countSessions({ accountId: 'user-1' })).resolves.toBe(
      0
    );
    await expect(session.findSessionsWithPagination()).resolves.toEqual([]);
    await expect(session.findSessionById('session-1')).resolves.toBeNull();
    await expect(session.exportAllSessions()).resolves.toEqual([]);
    await expect(session.deleteSessionsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });

    const grant = createService('Grant', { pipeline: () => pipeline });
    await expect(grant.findGrantsByAccountId('user-1')).resolves.toEqual([]);
    await expect(grant.findGrantsByClientId('client-1')).resolves.toEqual([]);
    await expect(grant.countGrants({ accountId: 'user-1' })).resolves.toBe(0);
    await expect(grant.findGrantsWithPagination()).resolves.toEqual([]);
    await expect(grant.getGrantStatistics()).resolves.toEqual({
      total: 0,
      recent: 0,
      expired: 0,
      byClient: [],
      byUser: [],
    });
    await expect(grant.exportAllGrants()).resolves.toEqual([]);
    await expect(grant.deleteGrantsByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(grant.deleteByAccountId('user-1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(grant.getDistinctValues('accountId')).resolves.toEqual([]);
  });

  it('preserves each public scan-failure contract', async () => {
    const failure = new Error('scan failed');
    const session = createService('Session', { pipeline: vi.fn() });
    vi.mocked((session as any).scanKeys).mockRejectedValue(failure);

    await expect(session.findByAccountId('user-1')).resolves.toEqual([]);
    await expect(session.revokeSession('session-1')).resolves.toBe(false);
    await expect(
      session.revokeAllSessionsExcept('user-1', 'session-1')
    ).resolves.toBe(0);
    await expect(session.getSessionStatistics()).rejects.toBe(failure);
    await expect(session.countSessions()).rejects.toBe(failure);
    await expect(session.findSessionsWithPagination()).rejects.toBe(failure);
    await expect(session.findSessionById('session-1')).rejects.toBe(failure);
    await expect(session.exportAllSessions()).rejects.toBe(failure);
    await expect(session.deleteSessionsByAccountId('user-1')).rejects.toBe(
      failure
    );

    const grant = createService('Grant', { pipeline: vi.fn() });
    vi.mocked((grant as any).scanKeys).mockRejectedValue(failure);
    await expect(grant.findGrantsByAccountId('user-1')).rejects.toBe(failure);
    await expect(grant.findGrantsByClientId('client-1')).rejects.toBe(failure);
    await expect(
      grant.findGrantByAccountAndClient('user-1', 'client-1')
    ).rejects.toBe(failure);
    await expect(grant.revokeAllGrantsForAccount('user-1')).rejects.toBe(
      failure
    );
    await expect(grant.revokeAllGrantsForClient('client-1')).rejects.toBe(
      failure
    );
    await expect(
      grant.revokeGrantByAccountAndClient('user-1', 'client-1')
    ).rejects.toBe(failure);
    await expect(grant.countGrants()).rejects.toBe(failure);
    await expect(grant.findGrantsWithPagination()).rejects.toBe(failure);
    await expect(grant.getGrantStatistics()).rejects.toBe(failure);
    await expect(grant.exportAllGrants()).rejects.toBe(failure);
    await expect(grant.deleteGrantsByAccountId('user-1')).rejects.toBe(failure);
    await expect(grant.deleteByAccountId('user-1')).rejects.toBe(failure);
    await expect(grant.getDistinctValues('accountId')).rejects.toBe(failure);

    const client = createService('Client', { pipeline: vi.fn() });
    vi.mocked((client as any).scanKeys).mockRejectedValue(failure);
    await expect(client.findAllClients()).resolves.toEqual([]);
    await expect(client.countClients()).resolves.toBe(0);
  });

  it('contains direct Redis command failures according to each API contract', async () => {
    const failure = new Error('Redis command failed');
    const session = createService('Session', {
      pipeline: () => ({
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(failure),
      }),
    });
    await expect(session.deleteSessionsByIds(['session-1'])).rejects.toBe(
      failure
    );

    const grant = createService('Grant', {
      get: vi.fn().mockRejectedValue(failure),
    });
    await expect(grant.findGrantById('grant-1')).rejects.toBe(failure);
    vi.spyOn(grant, 'destroy').mockRejectedValue(failure);
    await expect(grant.revokeGrantById('grant-1')).rejects.toBe(failure);

    const client = createService('Client', {
      get: vi.fn().mockRejectedValue(failure),
      set: vi.fn().mockRejectedValue(failure),
      del: vi.fn().mockRejectedValue(failure),
    });
    await expect(client.findClientById('client-1')).resolves.toBeNull();
    await expect(client.updateClient('client-1', {})).resolves.toBeNull();
    await expect(client.deleteClient('client-1')).resolves.toBe(false);
    await expect(
      client.createClient({
        client_id: 'client-1',
        client_name: 'Client one',
        redirect_uris: ['https://client.example/callback'],
      })
    ).rejects.toBe(failure);

    const updateClient = createService('Client', {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          client_id: 'client-1',
          client_name: 'Client one',
          application_type: 'web',
        })
      ),
      set: vi.fn().mockRejectedValue(failure),
    });
    await expect(
      updateClient.updateClient('client-1', { client_name: 'Updated' })
    ).resolves.toBeNull();
  });
});
