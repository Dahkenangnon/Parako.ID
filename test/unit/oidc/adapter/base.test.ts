import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import BaseOIDCAdapter from '../../../../src/oidc/adapter/base.js';
import type { OIDCPayload } from '../../../../src/oidc/interfaces/interface.js';

class TestOIDCAdapter extends BaseOIDCAdapter {
  readonly stored = new Map<string, OIDCPayload>();

  async upsert(id: string, payload: OIDCPayload): Promise<void> {
    this.validateId(id, 'upsert');
    this.validatePayload(payload, 'upsert');
    this.stored.set(id, payload);
  }

  async find(id: string): Promise<OIDCPayload | undefined> {
    return this.stored.get(id);
  }

  async findAll(): Promise<OIDCPayload[]> {
    return [...this.stored.entries()].map(([id, payload]) => ({
      ...payload,
      _id: id,
    }));
  }

  async findByUserCode(): Promise<OIDCPayload | undefined> {
    return undefined;
  }

  async findByUid(): Promise<OIDCPayload | undefined> {
    return undefined;
  }

  async consume(): Promise<void> {}

  async destroy(): Promise<void> {}

  async revokeByGrantId(): Promise<void> {}
}

function createLogger(): ILogger {
  return {
    error: vi.fn(),
  } as unknown as ILogger;
}

describe('BaseOIDCAdapter', () => {
  let adapter: TestOIDCAdapter;
  let logger: ILogger;

  beforeEach(() => {
    logger = createLogger();
    adapter = new TestOIDCAdapter('AccessToken', logger);
  });

  it('rejects array payloads instead of storing them as OIDC records', async () => {
    await expect(
      adapter.upsert('token-1', [] as unknown as OIDCPayload)
    ).rejects.toThrow('Invalid payload provided for AccessToken.upsert');
    expect(adapter.stored).toEqual(new Map());
  });

  it('rejects array custom data instead of treating it as a model extension', async () => {
    await expect(
      adapter.extendModel('token-1', [] as unknown as Record<string, unknown>)
    ).rejects.toThrow('Invalid custom data provided');
  });

  it('maps valid epoch timestamps instead of dropping zero values', () => {
    expect(
      adapter.mapDocumentToUI({
        jti: 'token-1',
        exp: 0,
        iat: 0,
        payload: { loginTs: 0 },
      })
    ).toEqual({
      id: 'token-1',
      customData: {},
      expiration: new Date(0),
      issuedAt: new Date(0),
      loginTs: new Date(0),
    });
  });

  it('rejects whitespace-only custom field names as invalid input', async () => {
    await expect(adapter.findByCustomField('   ', 'value')).resolves.toEqual(
      []
    );
    expect(logger.error).toHaveBeenCalledWith(
      new Error('Invalid field provided'),
      { context: 'Error in AccessToken.findByCustomField' }
    );
  });

  it('uses zero as the storage-independent default item count', async () => {
    await expect(adapter.countAll()).resolves.toBe(0);
  });

  it.each([
    ['AccessToken', true, false],
    ['AuthorizationCode', true, true],
    ['RefreshToken', true, true],
    ['DeviceCode', true, true],
    ['BackchannelAuthenticationRequest', true, true],
    ['PushedAuthorizationRequest', false, true],
    ['Session', false, false],
  ])(
    'reports the %s model capabilities',
    (modelName, isGrantable, isConsumable) => {
      const modelAdapter = new TestOIDCAdapter(modelName, logger);

      expect(modelAdapter.getModelName()).toBe(modelName);
      expect(modelAdapter.isGrantable()).toBe(isGrantable);
      expect(modelAdapter.isConsumable()).toBe(isConsumable);
    }
  );

  it('stores and finds a valid OIDC payload', async () => {
    const payload = { accountId: 'account-1' };

    await adapter.upsert('token-1', payload);

    await expect(adapter.find('token-1')).resolves.toBe(payload);
  });

  it.each([undefined, 42, '   '])(
    'rejects invalid model identifiers (%j)',
    async id => {
      await expect(
        adapter.upsert(id as unknown as string, { accountId: 'account-1' })
      ).rejects.toThrow('Invalid ID provided for AccessToken.upsert');
      expect(adapter.stored).toEqual(new Map());
    }
  );

  it.each([undefined, 'not-an-object'])(
    'rejects invalid OIDC payloads (%j)',
    async payload => {
      await expect(
        adapter.upsert('token-1', payload as unknown as OIDCPayload)
      ).rejects.toThrow('Invalid payload provided for AccessToken.upsert');
      expect(adapter.stored).toEqual(new Map());
    }
  );

  it('returns null when no stored document is available', () => {
    expect(adapter.mapDocumentToUI(null)).toBeNull();
  });

  it('maps storage metadata and the UI-safe payload fields', () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    expect(
      adapter.mapDocumentToUI({
        jti: 'token-1',
        data: { source: 'test' },
        exp: 10,
        iat: 5,
        expiresAt,
        payload: {
          accountId: 'account-1',
          uid: 'session-1',
          loginTs: 2,
          authorizations: { client: ['openid'] },
        },
      })
    ).toEqual({
      id: 'token-1',
      customData: { source: 'test' },
      expiration: new Date(10_000),
      issuedAt: new Date(5_000),
      expiresAt,
      accountId: 'account-1',
      uid: 'session-1',
      loginTs: new Date(2_000),
      authorizations: { client: ['openid'] },
    });
  });

  it('can include the raw payload and exclude selected mapped fields', () => {
    const document = {
      _id: 'mongo-token-1',
      exp: 10,
      payload: { accountId: 'account-1' },
    };

    expect(
      adapter.mapDocumentToUI(document, {
        includePayload: true,
        excludeFields: ['expiration', 'customData'],
      })
    ).toEqual({
      id: 'mongo-token-1',
      payload: document,
    });
  });

  it.each([
    [{ id: 'record-1' }, 'record-1'],
    [{ accountId: 'account-1' }, 'unknown'],
  ])('uses supported fallback identifiers for %j', (document, expectedId) => {
    expect(adapter.mapDocumentToUI(document)).toEqual({
      id: expectedId,
      customData: {},
      ...('accountId' in document && document.accountId
        ? { accountId: document.accountId }
        : {}),
    });
  });

  it.each([
    [{ jti: 'jti-1' }, 'jti-1'],
    [{ _id: 'mongo-1' }, 'mongo-1'],
    [{ id: 'record-1' }, 'record-1'],
    [{}, 'unknown'],
  ])(
    'returns a safe %s mapping when optional mapping fails',
    (identity, expectedId) => {
      const mappingError = new Error('mapping failed');
      const excludeFields = {
        forEach: () => {
          throw mappingError;
        },
      } as unknown as string[];

      expect(adapter.mapDocumentToUI(identity, { excludeFields })).toEqual({
        id: expectedId,
        customData: {},
      });
      expect(logger.error).toHaveBeenCalledWith(mappingError, {
        context: 'Error in AccessToken.mapDocumentToUI',
      });
    }
  );

  it('logs and rethrows when the default model extension is unsupported', async () => {
    const expectedError = new Error(
      'extendModel not implemented for AccessToken adapter'
    );

    await expect(
      adapter.extendModel('token-1', { risk: 'low' })
    ).rejects.toThrow(expectedError);
    expect(logger.error).toHaveBeenCalledWith(expectedError, {
      context: 'Error in AccessToken.extendModel for id token-1',
    });
  });

  it('logs extension failures without an identifier when none is valid', async () => {
    const expectedError = new Error(
      'Invalid ID provided for AccessToken.extendModel'
    );

    await expect(
      adapter.extendModel(undefined as unknown as string, { risk: 'low' })
    ).rejects.toThrow(expectedError);
    expect(logger.error).toHaveBeenCalledWith(expectedError, {
      context: 'Error in AccessToken.extendModel',
    });
  });

  it.each([undefined, 'not-an-object'])(
    'rejects invalid extension data (%j)',
    async customData => {
      await expect(
        adapter.extendModel(
          'token-1',
          customData as unknown as Record<string, unknown>
        )
      ).rejects.toThrow('Invalid custom data provided');
    }
  );

  it.each([undefined, 42])(
    'rejects invalid custom field identifiers (%j)',
    async field => {
      await expect(
        adapter.findByCustomField(field as unknown as string, 'value')
      ).resolves.toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        new Error('Invalid field provided'),
        { context: 'Error in AccessToken.findByCustomField' }
      );
    }
  );

  it('logs and returns an empty result for unsupported custom searches', async () => {
    await expect(adapter.findByCustomField('risk', 'low')).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      new Error('findByCustomField not implemented for AccessToken adapter'),
      { context: 'Error in AccessToken.findByCustomField' }
    );
  });
});
