import { Redis } from 'ioredis';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IOIDCRedisAdapter } from '../../../di/interfaces/oidc-redis-adapter.interface.js';
import { isEmpty } from '../../../utils/misc.js';
import BaseOIDCAdapter, { grantable, consumable } from '../base.js';
import {
  OIDCPayload,
  AdapterConnectionOptions,
  DocumentMappingOptions,
  MappedDocument,
} from '../../interfaces/interface.js';
import { ensureDecrypted } from '../../../utils/encryption.js';
import { sanitizeClientPayload } from '../client-crud-utils.js';
import { buildRedisKey } from '../../../multi-tenancy/redis-key.js';

/**
 * Redis Adapter for OIDC Provider
 *
 * This adapter implements the required interface for oidc-provider to store and retrieve
 * OAuth 2.0 and OpenID Connect related data in Redis. Dependencies (Redis client, logger,
 * keyPrefix) are injected via the constructor — no global state.
 *
 * Unified key format: {keyPrefix}:{tenantId}:oidc:{Model}:{id}
 * Helper keys: {keyPrefix}:{tenantId}:oidc:grant:{grantId}, etc.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#adapter}
 */
export default class OIDCRedisAdapter
  extends BaseOIDCAdapter
  implements IOIDCRedisAdapter
{
  protected readonly client: Redis;
  protected readonly keyPrefix: string;

  constructor(name: string, client: Redis, logger: ILogger, keyPrefix: string) {
    super(name, logger);
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  // ── Key helpers ─────────────────────────────────────────────────────────────

  /**
   * Generate Redis key for this adapter instance.
   * Unified format: {keyPrefix}:{tenantId}:oidc:{Model}:{id}
   */
  key(id: string): string {
    return buildRedisKey(this.keyPrefix, 'oidc', this.name, id);
  }

  protected grantKeyFor(id: string): string {
    return buildRedisKey(this.keyPrefix, 'oidc', 'grant', id);
  }

  protected userCodeKeyFor(userCode: string): string {
    return buildRedisKey(this.keyPrefix, 'oidc', 'userCode', userCode);
  }

  protected uidKeyFor(uid: string): string {
    return buildRedisKey(this.keyPrefix, 'oidc', 'uid', uid);
  }

  // ── OIDC adapter methods ────────────────────────────────────────────────────

  /**
   * Update or Create an instance of an oidc-provider model.
   */
  async upsert(
    _id: string,
    payload: OIDCPayload,
    expiresIn?: number
  ): Promise<void> {
    try {
      const k = this.key(_id);
      const store = consumable.has(this.name)
        ? { payload: JSON.stringify(payload) }
        : JSON.stringify(payload);

      const multi = this.client.multi();
      (multi as any)[consumable.has(this.name) ? 'hmset' : 'set'](k, store);

      if (expiresIn) {
        multi.expire(k, expiresIn);
      }

      if (grantable.has(this.name) && payload.grantId) {
        const grantKey = this.grantKeyFor(payload.grantId);
        multi.rpush(grantKey, k);
        const ttl = await this.client.ttl(grantKey);
        if (expiresIn && expiresIn > ttl) {
          multi.expire(grantKey, expiresIn);
        }
      }

      if (payload.userCode) {
        const userCodeKey = this.userCodeKeyFor(payload.userCode);
        multi.set(userCodeKey, _id);
        if (expiresIn) {
          multi.expire(userCodeKey, expiresIn);
        }
      }

      if (payload.uid) {
        const uidKey = this.uidKeyFor(payload.uid);
        multi.set(uidKey, _id);
        if (expiresIn) {
          multi.expire(uidKey, expiresIn);
        }
      }

      await multi.exec();
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.upsert for id ${_id}`,
      });
      throw error;
    }
  }

  /**
   * Return previously stored instance of an oidc-provider model.
   */
  async find(_id: string): Promise<OIDCPayload | undefined> {
    try {
      if (!_id) return undefined;

      const data = consumable.has(this.name)
        ? await this.client.hgetall(this.key(_id))
        : await this.client.get(this.key(_id));

      if (isEmpty(data)) {
        return undefined;
      }

      let result: OIDCPayload;
      if (typeof data === 'string') {
        result = JSON.parse(data);
      } else {
        const { payload, ...rest } = data as {
          payload: string;
          [key: string]: any;
        };
        result = {
          ...rest,
          ...JSON.parse(payload),
        };
      }

      // Decrypt client_secret for Client model (transparent migration)
      if (this.name === 'Client' && result.client_secret) {
        result.client_secret = ensureDecrypted(result.client_secret as string);
      }

      // Strip empty strings / nulls so node-oidc-provider doesn't reject them
      if (this.name === 'Client') {
        return sanitizeClientPayload(result);
      }

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.find for id ${_id}`,
      });
      throw error;
    }
  }

  /**
   * Return previously stored instance of DeviceCode by the end-user entered user code.
   */
  async findByUserCode(userCode: string): Promise<OIDCPayload | undefined> {
    try {
      if (!userCode || this.name !== 'DeviceCode') return undefined;

      const id = await this.client.get(this.userCodeKeyFor(userCode));
      if (!id) return undefined;

      return this.find(id);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in DeviceCode.findByUserCode for code ${userCode}`,
      });
      throw error;
    }
  }

  /**
   * Return previously stored instance of Session by its uid reference property.
   */
  async findByUid(uid: string): Promise<OIDCPayload | undefined> {
    try {
      if (!uid || this.name !== 'Session') return undefined;

      const id = await this.client.get(this.uidKeyFor(uid));
      if (!id) return undefined;

      return this.find(id);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in Session.findByUid for uid ${uid}`,
      });
      throw error;
    }
  }

  /**
   * Destroy/Drop/Remove a stored oidc-provider model.
   */
  async destroy(_id: string): Promise<void> {
    try {
      if (!_id) return;

      await this.client.del(this.key(_id));
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.destroy for id ${_id}`,
      });
      throw error;
    }
  }

  /**
   * Destroy/Drop/Remove a stored oidc-provider model by its grantId property reference.
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    try {
      if (!grantId) return;

      const multi = this.client.multi();
      const tokens = await this.client.lrange(this.grantKeyFor(grantId), 0, -1);
      tokens.forEach((token: string) => multi.del(token));
      multi.del(this.grantKeyFor(grantId));
      await multi.exec();
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.revokeByGrantId for grantId ${grantId}`,
      });
      throw error;
    }
  }

  /**
   * Mark a stored oidc-provider model as consumed.
   */
  async consume(_id: string): Promise<void> {
    try {
      if (!_id) return;

      await this.client.hset(
        this.key(_id),
        'consumed',
        Math.floor(Date.now() / 1000)
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.consume for id ${_id}`,
      });
      throw error;
    }
  }

  // ── Monitoring methods ──────────────────────────────────────────────────────

  /**
   * Count all keys matching the pattern for this collection.
   */
  async countAll(): Promise<number> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      return keys.length;
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error counting keys in ${this.name}`,
      });
      return 0;
    }
  }

  /**
   * Map a Redis document to a UI-friendly format
   */
  mapDocumentToUI(
    doc: any | null,
    options: DocumentMappingOptions = {}
  ): MappedDocument | null {
    if (!doc) return null;

    try {
      const { includePayload = false, excludeFields = [] } = options;

      const result: MappedDocument = {
        id: doc.jti || doc.id || 'unknown',
        customData: doc.data || {},
      };

      if (doc.exp) {
        result.expiration = new Date(doc.exp * 1000);
      }
      if (doc.iat) {
        result.issuedAt = new Date(doc.iat * 1000);
      }

      if (includePayload) {
        result.payload = { ...doc };
      } else {
        if (doc.accountId) result.accountId = doc.accountId;
        if (doc.uid) result.uid = doc.uid;
        if (doc.loginTs) result.loginTs = new Date(doc.loginTs * 1000);
        if (doc.authorizations) result.authorizations = doc.authorizations;
      }

      excludeFields.forEach(field => {
        delete result[field];
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error mapping document to UI`,
      });
      return { id: doc.jti || doc.id || 'unknown', customData: {} };
    }
  }

  /**
   * Extends a model with custom data methods
   */
  async extendModel(
    id: string,
    customData: Record<string, unknown>
  ): Promise<any> {
    try {
      const k = this.key(id);
      const customKey = `${k}:custom`;
      await this.client.hmset(customKey, customData);
      return { success: true, customData };
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error extending ${this.name} with custom data`,
      });
      throw err;
    }
  }

  /**
   * Find documents by a custom data field
   */
  async findByCustomField(field: string, value: unknown): Promise<any[]> {
    try {
      if (!field) return [];

      const pattern = buildRedisKey(
        this.keyPrefix,
        'oidc',
        this.name,
        '*',
        'custom'
      );
      const keys = await this.scanKeys(pattern);
      const results: any[] = [];

      const pipeline = this.client.pipeline();
      keys.forEach(key => pipeline.hgetall(key));
      const customDataResults = await pipeline.exec();

      for (let i = 0; i < keys.length; i++) {
        const customData = customDataResults?.[i]?.[1] as Record<
          string,
          string
        >;
        if (customData && customData[field] === String(value)) {
          const baseKey = keys[i].replace(':custom', '');
          const doc = await this.client.get(baseKey);
          if (doc) {
            results.push(JSON.parse(doc));
          }
        }
      }

      return results;
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error finding ${this.name} by custom field`,
      });
      return [];
    }
  }

  /**
   * Efficient key scanning using Redis SCAN.
   * Production-safe alternative to KEYS command.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const result = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        1000
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    return keys;
  }
}

// ── Connection helper ─────────────────────────────────────────────────────────

/**
 * Establish a Redis connection and return the client.
 * This replaces the old static `OIDCRedisAdapter.connect()`.
 *
 * Unlike the old implementation, this does NOT set ioredis `keyPrefix` —
 * key prefixing is handled by the adapter's key() method for full control.
 */
export async function connectRedis(
  options: AdapterConnectionOptions = {}
): Promise<Redis> {
  const { uri, connection } = options;

  let redisClient: Redis;

  if (connection) {
    redisClient = connection as unknown as Redis;
  } else if (uri) {
    redisClient = new Redis(uri, { lazyConnect: true });
    await redisClient.connect();
  } else {
    redisClient = new Redis();
  }

  await redisClient.ping();
  return redisClient;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Factory for node-oidc-provider's `adapter` option.
 * Creates adapters with injected Redis client and key prefix — no global state.
 *
 * @example
 *   const client = await connectRedis({ uri });
 *   const adapter = createRedisAdapterFactory(client, logger, 'parako:oidc');
 *   new Provider(issuer, { adapter });
 */
export function createRedisAdapterFactory(
  client: Redis,
  logger: ILogger,
  keyPrefix: string
) {
  return (modelName: string) =>
    new OIDCRedisAdapter(modelName, client, logger, keyPrefix);
}
