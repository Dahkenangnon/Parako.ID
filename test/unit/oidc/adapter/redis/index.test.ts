import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import OIDCRedisAdapter, {
  connectRedis,
  createRedisAdapterFactory,
} from '../../../../../src/oidc/adapter/redis/index.js';

function createLogger(): ILogger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as ILogger;
}

function createRedisBoundary() {
  const pipeline = {
    get: vi.fn().mockReturnThis(),
    hgetall: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  const multi = {
    set: vi.fn().mockReturnThis(),
    hmset: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    rpush: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    multi,
    pipeline,
    get: vi.fn().mockResolvedValue(null),
    hgetall: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(0),
    hset: vi.fn().mockResolvedValue(0),
    hmset: vi.fn().mockResolvedValue('OK'),
    lrange: vi.fn().mockResolvedValue([]),
    multiFactory: vi.fn(() => multi),
    pipelineFactory: vi.fn(() => pipeline),
    scan: vi.fn().mockResolvedValue(['0', []]),
    ttl: vi.fn().mockResolvedValue(-1),
    ping: vi.fn().mockResolvedValue('PONG'),
  };
}

describe('OIDCRedisAdapter', () => {
  let adapter: OIDCRedisAdapter;
  let client: ReturnType<typeof createRedisBoundary>;
  let logger: ILogger;

  function redisClient() {
    return {
      ...client,
      multi: client.multiFactory,
      pipeline: client.pipelineFactory,
    } as never;
  }

  function model(name: string): OIDCRedisAdapter {
    return new OIDCRedisAdapter(name, redisClient(), logger, 'parako');
  }

  beforeEach(() => {
    client = createRedisBoundary();
    logger = createLogger();
    adapter = model('Session');
  });

  it('maps valid epoch-zero timestamps instead of dropping them', () => {
    expect(
      adapter.mapDocumentToUI({
        id: 'session-1',
        exp: 0,
        iat: 0,
        loginTs: 0,
      })
    ).toEqual({
      id: 'session-1',
      customData: {},
      expiration: new Date(0),
      issuedAt: new Date(0),
      loginTs: new Date(0),
    });
  });

  it('rejects whitespace-only custom field names without scanning Redis', async () => {
    await expect(adapter.findByCustomField('   ', 'value')).resolves.toEqual(
      []
    );
    expect(client.scan).not.toHaveBeenCalled();
  });

  it('upserts JSON models with expiry and tenant-scoped helper indexes', async () => {
    client.ttl.mockResolvedValueOnce(30);
    const accessToken = model('AccessToken');
    const payload = {
      accountId: 'account-1',
      grantId: 'grant-1',
      userCode: 'USER-CODE',
      uid: 'uid-1',
    };

    await accessToken.upsert('token-1', payload, 60);

    expect(client.multi.set).toHaveBeenCalledWith(
      'parako:default:oidc:AccessToken:token-1',
      JSON.stringify(payload)
    );
    expect(client.multi.rpush).toHaveBeenCalledWith(
      'parako:default:oidc:grant:grant-1',
      'parako:default:oidc:AccessToken:token-1'
    );
    expect(client.multi.set).toHaveBeenCalledWith(
      'parako:default:oidc:userCode:USER-CODE',
      'token-1'
    );
    expect(client.multi.set).toHaveBeenCalledWith(
      'parako:default:oidc:uid:uid-1',
      'token-1'
    );
    expect(client.multi.expire).toHaveBeenCalledTimes(4);
    expect(client.multi.exec).toHaveBeenCalledOnce();
  });

  it('upserts consumable models as hashes without unnecessary expiries', async () => {
    const code = model('AuthorizationCode');
    const payload = { grantId: 'grant-1', accountId: 'account-1' };

    await code.upsert('code-1', payload);

    expect(client.multi.hmset).toHaveBeenCalledWith(
      'parako:default:oidc:AuthorizationCode:code-1',
      { payload: JSON.stringify(payload) }
    );
    expect(client.ttl).toHaveBeenCalledWith(
      'parako:default:oidc:grant:grant-1'
    );
    expect(client.multi.expire).not.toHaveBeenCalled();
  });

  it('stores optional helper indexes without TTLs for non-expiring models', async () => {
    await adapter.upsert('session-1', {
      userCode: 'USER-CODE',
      uid: 'uid-1',
    });

    expect(client.ttl).not.toHaveBeenCalled();
    expect(client.multi.expire).not.toHaveBeenCalled();
    expect(client.multi.set).toHaveBeenCalledTimes(3);
  });

  it('does not shorten an existing grant helper TTL', async () => {
    client.ttl.mockResolvedValueOnce(120);

    await model('AccessToken').upsert('token-1', { grantId: 'grant-1' }, 60);

    expect(client.multi.expire).toHaveBeenCalledTimes(1);
    expect(client.multi.expire).toHaveBeenCalledWith(
      'parako:default:oidc:AccessToken:token-1',
      60
    );
  });

  it('finds JSON and hash-backed payloads and returns undefined when absent', async () => {
    client.get.mockResolvedValueOnce(JSON.stringify({ accountId: 'a1' }));
    await expect(model('Session').find('session-1')).resolves.toEqual({
      accountId: 'a1',
    });

    client.hgetall.mockResolvedValueOnce({
      payload: JSON.stringify({ accountId: 'a1' }),
      consumed: '10',
    });
    await expect(model('AuthorizationCode').find('code-1')).resolves.toEqual({
      accountId: 'a1',
      consumed: '10',
    });

    await expect(model('Session').find('')).resolves.toBeUndefined();
    await expect(model('Session').find('missing')).resolves.toBeUndefined();
  });

  it('sanitizes Client metadata after transparently reading its secret', async () => {
    client.get.mockResolvedValueOnce(
      JSON.stringify({
        client_id: 'client-1',
        client_secret: 'plain-secret',
        client_name: 'Client one',
        logo_uri: '',
        policy_uri: null,
      })
    );

    await expect(model('Client').find('client-1')).resolves.toEqual({
      client_id: 'client-1',
      client_secret: 'plain-secret',
      client_name: 'Client one',
    });
  });

  it('resolves DeviceCode user codes and Session UIDs through helper keys', async () => {
    const deviceCode = model('DeviceCode');
    client.get.mockResolvedValueOnce('device-1');
    client.hgetall.mockResolvedValueOnce({
      payload: JSON.stringify({ userCode: 'USER-CODE' }),
    });
    await expect(deviceCode.findByUserCode('USER-CODE')).resolves.toEqual({
      userCode: 'USER-CODE',
    });

    client.get
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce(JSON.stringify({ uid: 'uid-1' }));
    await expect(adapter.findByUid('uid-1')).resolves.toEqual({ uid: 'uid-1' });
  });

  it('returns undefined for missing or model-incompatible secondary lookups', async () => {
    await expect(
      model('DeviceCode').findByUserCode('MISSING')
    ).resolves.toBeUndefined();
    await expect(adapter.findByUid('MISSING')).resolves.toBeUndefined();
    await expect(adapter.findByUserCode('USER-CODE')).resolves.toBeUndefined();
    await expect(
      model('AccessToken').findByUid('uid-1')
    ).resolves.toBeUndefined();
    await expect(
      model('DeviceCode').findByUserCode('')
    ).resolves.toBeUndefined();
    await expect(adapter.findByUid('')).resolves.toBeUndefined();
  });

  it('destroys, revokes, and consumes tenant-scoped records', async () => {
    await adapter.destroy('session-1');
    expect(client.del).toHaveBeenCalledWith(
      'parako:default:oidc:Session:session-1'
    );

    client.lrange.mockResolvedValueOnce(['token-1', 'token-2']);
    await model('AccessToken').revokeByGrantId('grant-1');
    expect(client.multi.del).toHaveBeenNthCalledWith(1, 'token-1');
    expect(client.multi.del).toHaveBeenNthCalledWith(2, 'token-2');
    expect(client.multi.del).toHaveBeenNthCalledWith(
      3,
      'parako:default:oidc:grant:grant-1'
    );

    vi.spyOn(Date, 'now').mockReturnValue(12_345);
    await model('AuthorizationCode').consume('code-1');
    expect(client.hset).toHaveBeenCalledWith(
      'parako:default:oidc:AuthorizationCode:code-1',
      'consumed',
      12
    );
  });

  it('short-circuits empty destructive identifiers', async () => {
    await adapter.destroy('');
    await adapter.revokeByGrantId('');
    await model('AuthorizationCode').consume('');

    expect(client.del).not.toHaveBeenCalled();
    expect(client.lrange).not.toHaveBeenCalled();
    expect(client.hset).not.toHaveBeenCalled();
  });

  it('scans every cursor page and counts matching model keys', async () => {
    client.scan
      .mockResolvedValueOnce(['7', ['key-1']])
      .mockResolvedValueOnce(['0', ['key-2', 'key-3']]);

    await expect(adapter.countAll()).resolves.toBe(3);
    expect(client.scan).toHaveBeenNthCalledWith(
      2,
      '7',
      'MATCH',
      'parako:default:oidc:Session:*',
      'COUNT',
      1000
    );
  });

  it('lists the current tenant model records with their stable IDs', async () => {
    client.scan.mockResolvedValueOnce([
      '0',
      [
        'parako:default:oidc:InitialAccessToken:token-1',
        'parako:default:oidc:InitialAccessToken:token-1:custom',
        'parako:default:oidc:InitialAccessToken:token-2',
      ],
    ]);
    client.pipeline.exec.mockResolvedValueOnce([
      [null, JSON.stringify({ jti: 'token-1', iat: 100, exp: 200 })],
      [null, JSON.stringify({ iat: 101, exp: 201 })],
    ]);

    await expect(
      (
        model('InitialAccessToken') as unknown as {
          findAll(): Promise<unknown[]>;
        }
      ).findAll()
    ).resolves.toEqual([
      { jti: 'token-1', iat: 100, exp: 200, _id: 'token-1' },
      { iat: 101, exp: 201, _id: 'token-2' },
    ]);
    expect(client.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'parako:default:oidc:InitialAccessToken:*',
      'COUNT',
      1000
    );
    expect(client.pipeline.get).toHaveBeenCalledTimes(2);
  });

  it('lists hash-backed consumable records and ignores keys that expire mid-scan', async () => {
    client.scan.mockResolvedValueOnce([
      '0',
      [
        'parako:default:oidc:AuthorizationCode:code-1',
        'parako:default:oidc:AuthorizationCode:expired-code',
      ],
    ]);
    client.pipeline.exec.mockResolvedValueOnce([
      [
        null,
        {
          payload: JSON.stringify({ accountId: 'account-1' }),
          consumed: '10',
        },
      ],
      [null, {}],
    ]);

    await expect(model('AuthorizationCode').findAll()).resolves.toEqual([
      {
        accountId: 'account-1',
        consumed: '10',
        _id: 'code-1',
      },
    ]);
    expect(client.pipeline.hgetall).toHaveBeenCalledTimes(2);
    expect(client.pipeline.get).not.toHaveBeenCalled();
  });

  it('returns an empty list without constructing a pipeline when no keys exist', async () => {
    await expect(adapter.findAll()).resolves.toEqual([]);
    expect(client.pipelineFactory).not.toHaveBeenCalled();
  });

  it('treats a missing pipeline result as records expiring during the scan', async () => {
    client.scan.mockResolvedValueOnce([
      '0',
      ['parako:default:oidc:Session:expired-session'],
    ]);
    client.pipeline.exec.mockResolvedValueOnce(undefined as never);

    await expect(adapter.findAll()).resolves.toEqual([]);
  });

  it('logs and rejects corrupt Redis pipeline entries', async () => {
    const storageError = new Error('pipeline entry failed');
    client.scan.mockResolvedValueOnce([
      '0',
      ['parako:default:oidc:Session:session-1'],
    ]);
    client.pipeline.exec.mockResolvedValueOnce([[storageError, null]]);

    await expect(adapter.findAll()).rejects.toBe(storageError);
    expect(logger.error).toHaveBeenCalledWith(storageError, {
      context: 'Error in Session.findAll',
    });
  });

  it('maps complete documents, payload views, exclusions, and safe fallbacks', () => {
    const doc = {
      jti: 'session-1',
      accountId: 'account-1',
      uid: 'uid-1',
      exp: 10,
      iat: 5,
      loginTs: 2,
      authorizations: { client: ['openid'] },
      data: { risk: 'low' },
    };

    expect(adapter.mapDocumentToUI(doc)).toEqual({
      id: 'session-1',
      customData: { risk: 'low' },
      accountId: 'account-1',
      uid: 'uid-1',
      expiration: new Date(10_000),
      issuedAt: new Date(5_000),
      loginTs: new Date(2_000),
      authorizations: { client: ['openid'] },
    });
    expect(
      adapter.mapDocumentToUI(doc, {
        includePayload: true,
        excludeFields: ['customData'],
      })
    ).toEqual({
      id: 'session-1',
      expiration: new Date(10_000),
      issuedAt: new Date(5_000),
      payload: doc,
    });
    expect(adapter.mapDocumentToUI(null)).toBeNull();
    expect(adapter.mapDocumentToUI({})).toEqual({
      id: 'unknown',
      customData: {},
    });

    const mappingError = new Error('mapping failed');
    const excludeFields = {
      forEach: () => {
        throw mappingError;
      },
    } as unknown as string[];
    expect(
      adapter.mapDocumentToUI({ id: 'session-1' }, { excludeFields })
    ).toEqual({ id: 'session-1', customData: {} });
    expect(logger.error).toHaveBeenCalledWith(mappingError, {
      context: 'Error mapping document to UI',
    });

    expect(
      adapter.mapDocumentToUI({ jti: 'jti-1' }, { excludeFields })
    ).toEqual({ id: 'jti-1', customData: {} });
    expect(adapter.mapDocumentToUI({}, { excludeFields })).toEqual({
      id: 'unknown',
      customData: {},
    });
  });

  it('extends models and finds matching custom data records', async () => {
    await expect(
      adapter.extendModel('session-1', { risk: 'low' })
    ).resolves.toEqual({ success: true, customData: { risk: 'low' } });
    expect(client.hmset).toHaveBeenCalledWith(
      'parako:default:oidc:Session:session-1:custom',
      { risk: 'low' }
    );

    client.scan.mockResolvedValueOnce([
      '0',
      [
        'parako:default:oidc:Session:session-1:custom',
        'parako:default:oidc:Session:session-2:custom',
      ],
    ]);
    client.pipeline.exec.mockResolvedValueOnce([
      [null, { risk: 'low' }],
      [null, { risk: 'high' }],
    ]);
    client.get.mockResolvedValueOnce(JSON.stringify({ id: 'session-1' }));

    await expect(adapter.findByCustomField('risk', 'low')).resolves.toEqual([
      { id: 'session-1' },
    ]);
  });

  it('ignores custom-index matches whose base records have expired', async () => {
    client.scan.mockResolvedValueOnce([
      '0',
      ['parako:default:oidc:Session:expired:custom'],
    ]);
    client.pipeline.exec.mockResolvedValueOnce([[null, { risk: 'low' }]]);

    await expect(adapter.findByCustomField('risk', 'low')).resolves.toEqual([]);
  });

  it('returns safe defaults when counting or custom search fails', async () => {
    const scanError = new Error('scan failed');
    client.scan.mockRejectedValue(scanError);

    await expect(adapter.countAll()).resolves.toBe(0);
    await expect(adapter.findByCustomField('risk', 'low')).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(scanError, {
      context: 'Error counting keys in Session',
    });
    expect(logger.error).toHaveBeenCalledWith(scanError, {
      context: 'Error finding Session by custom field',
    });
  });

  it.each([
    [
      'upsert',
      'multiFactory',
      ['id-1', {}],
      'Error in Session.upsert for id id-1',
    ],
    ['find', 'get', ['id-1'], 'Error in Session.find for id id-1'],
    ['findAll', 'scan', [], 'Error in Session.findAll'],
    [
      'findByUserCode',
      'get',
      ['USER-CODE'],
      'Error in DeviceCode.findByUserCode for code USER-CODE',
      'DeviceCode',
    ],
    ['findByUid', 'get', ['uid-1'], 'Error in Session.findByUid for uid uid-1'],
    ['destroy', 'del', ['id-1'], 'Error in Session.destroy for id id-1'],
    [
      'revokeByGrantId',
      'lrange',
      ['grant-1'],
      'Error in Session.revokeByGrantId for grantId grant-1',
    ],
    ['consume', 'hset', ['id-1'], 'Error in Session.consume for id id-1'],
    [
      'extendModel',
      'hmset',
      ['id-1', {}],
      'Error extending Session with custom data',
    ],
  ] as const)(
    'logs and rethrows %s boundary failures',
    async (
      operation,
      boundary,
      args,
      context,
      modelName: string = 'Session'
    ) => {
      const storageError = new Error(`${operation} failed`);
      if (boundary === 'multiFactory') {
        client.multiFactory.mockImplementationOnce(() => {
          throw storageError;
        });
      } else {
        client[boundary].mockRejectedValueOnce(storageError);
      }
      const operationAdapter = model(modelName);
      const method = operationAdapter[
        operation as keyof OIDCRedisAdapter
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      await expect(method.apply(operationAdapter, [...args])).rejects.toBe(
        storageError
      );
      expect(logger.error).toHaveBeenCalledWith(storageError, { context });
    }
  );

  it('creates factory adapters and accepts injected Redis connections', async () => {
    const factory = createRedisAdapterFactory(redisClient(), logger, 'parako');
    expect(factory('Grant')).toBeInstanceOf(OIDCRedisAdapter);

    const connection = redisClient();
    await expect(connectRedis({ connection })).resolves.toBe(connection);
    expect(client.ping).toHaveBeenCalledOnce();
  });
});
