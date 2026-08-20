import { MongoClient, Db, Collection, Document } from 'mongodb';
import mongoose from 'mongoose';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IOIDCMongoAdapter } from '../../../di/interfaces/oidc-mongo-adapter.interface.js';
import BaseOIDCAdapter, { grantable } from '../base.js';
import {
  OIDCPayload,
  OIDCDocument,
  AdapterConnectionOptions,
  DocumentMappingOptions,
  MappedDocument,
} from '../../interfaces/interface.js';
import { ensureDecrypted } from '../../../utils/encryption.js';
import { sanitizeClientPayload } from '../client-crud-utils.js';
import { tenantContext } from '../../../multi-tenancy/tenant-context.js';

export function tenantScopedDocumentId(
  tenantId: string,
  logicalId: string
): string {
  return tenantId === 'default'
    ? logicalId
    : `${tenantId.length}:${tenantId}:${logicalId}`;
}

export function tenantScopedIdentityFilter(
  tenantId: string,
  logicalId: string
) {
  const scopedId = tenantScopedDocumentId(tenantId, logicalId);
  return {
    _id: scopedId === logicalId ? logicalId : { $in: [scopedId, logicalId] },
    tenant_id: tenantId,
  };
}

/**
 * Custom Set implementation for managing MongoDB collections with automatic index creation.
 * Extends the native Set class to add MongoDB-specific functionality.
 */
class CollectionSet extends Set<string> {
  constructor(
    private readonly db: Db,
    private readonly logger: ILogger
  ) {
    super();
  }

  /**
   * Adds a collection name to the set and creates necessary indexes.
   * Creates different indexes based on the collection type:
   * - Grantable collections get a grantId index
   * - DeviceCode gets a unique userCode index
   * - Session gets a unique uid index
   * - All collections get an expiresAt TTL index
   *
   * Failures are logged at warn level and swallowed so a missing or
   * conflicting index never blocks application bootstrap. Queries on the
   * affected collection will fall back to a collection scan until the
   * operator fixes the index manually.
   */
  add(name: string): this {
    const isNew = !this.has(name);
    super.add(name);
    if (isNew) {
      try {
        const collection = this.db.collection(name);
        const legacyUniqueIndex =
          name === 'DeviceCode'
            ? 'payload.userCode_1'
            : name === 'Session'
              ? 'payload.uid_1'
              : undefined;

        collection
          .createIndexes([
            ...(grantable.has(name)
              ? [{ key: { tenant_id: 1, 'payload.grantId': 1 } }]
              : []),
            ...(name === 'DeviceCode'
              ? [
                  {
                    key: { tenant_id: 1, 'payload.userCode': 1 },
                    unique: true,
                  },
                ]
              : []),
            ...(name === 'Session'
              ? [
                  {
                    key: { tenant_id: 1, 'payload.uid': 1 },
                    unique: true,
                  },
                ]
              : []),
            { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
          ])
          .then(async () => {
            if (!legacyUniqueIndex) return;
            try {
              await collection.dropIndex(legacyUniqueIndex);
            } catch (err) {
              const code = (err as { code?: number }).code;
              if (code !== 27) {
                this.logger.warn('Legacy OIDC unique index cleanup failed', {
                  collection: name,
                  index: legacyUniqueIndex,
                  step: 'oidc-mongo-index-cleanup',
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            }
          })
          .catch((err: unknown) => {
            this.logger.warn(
              'Background OIDC index creation failed; queries will use collection scan',
              {
                collection: name,
                step: 'oidc-mongo-index-create',
                err: err instanceof Error ? err.message : String(err),
              }
            );
          });
      } catch (err) {
        this.logger.warn(
          'OIDC index creation threw synchronously; continuing without indexes',
          {
            collection: name,
            step: 'oidc-mongo-index-create',
            err: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }
    return this;
  }
}

/**
 * MongoDB Adapter for OIDC Provider
 *
 * This adapter implements the required interface for oidc-provider to store and retrieve
 * OAuth 2.0 and OpenID Connect related data in MongoDB. Dependencies (Db, logger) are
 * injected via the constructor — no global state.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#adapter}
 */
export default class OIDCMongoAdapter
  extends BaseOIDCAdapter
  implements IOIDCMongoAdapter
{
  private readonly db: Db;

  constructor(name: string, db: Db, logger: ILogger) {
    super(name, logger);
    this.db = db;
  }

  async upsert(
    _id: string,
    payload: OIDCPayload,
    expiresIn?: number
  ): Promise<void> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const documentId = tenantScopedDocumentId(tenant_id, _id);
      let expiresAt: Date | undefined;
      if (expiresIn) {
        expiresAt = new Date(Date.now() + expiresIn * 1000);
      }

      await this.coll().updateOne(
        tenantScopedIdentityFilter(tenant_id, _id) as any,
        {
          $set: {
            payload,
            tenant_id,
            ...(expiresAt ? { expiresAt } : undefined),
          },
          $setOnInsert: {
            _id: documentId,
            logical_id: _id,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.upsert for id ${_id}`,
      });
      throw error;
    }
  }

  async find(_id: string): Promise<OIDCPayload | undefined> {
    try {
      if (!_id) return undefined;

      const tenant_id = tenantContext.getTenantId();
      const result = await this.coll().findOne<OIDCDocument>(
        tenantScopedIdentityFilter(tenant_id, _id) as any,
        { projection: { payload: 1 } }
      );

      if (!result) return undefined;

      // Decrypt client_secret for Client model (transparent migration)
      if (this.name === 'Client' && result.payload?.client_secret) {
        result.payload.client_secret = ensureDecrypted(
          result.payload.client_secret as string
        );
      }

      // Strip empty strings / nulls so node-oidc-provider doesn't reject them
      if (this.name === 'Client') {
        return sanitizeClientPayload(result.payload);
      }

      return result.payload;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.find for id ${_id}`,
      });
      throw error;
    }
  }

  /** Return active records for this model in the current tenant. */
  async findAll(): Promise<OIDCPayload[]> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const now = new Date();
      const documents = await this.coll()
        .find<OIDCDocument>(
          {
            tenant_id,
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: null },
              { expiresAt: { $gt: now } },
            ],
          },
          { projection: { _id: 1, logical_id: 1, payload: 1 } }
        )
        .toArray();

      return documents.map(document => ({
        ...document.payload,
        _id: document.logical_id ?? String(document._id),
      }));
    } catch (error) {
      this.logError(error as Error, 'findAll');
      throw error;
    }
  }

  async findByUserCode(userCode: string): Promise<OIDCPayload | undefined> {
    try {
      if (!userCode || this.name !== 'DeviceCode') return undefined;

      const tenant_id = tenantContext.getTenantId();
      const result = await this.coll().findOne<OIDCDocument>(
        { 'payload.userCode': userCode, tenant_id },
        { projection: { payload: 1 } }
      );

      if (!result) return undefined;
      return result.payload;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in DeviceCode.findByUserCode for code ${userCode}`,
      });
      throw error;
    }
  }

  async findByUid(uid: string): Promise<OIDCPayload | undefined> {
    try {
      if (!uid || this.name !== 'Session') return undefined;

      const tenant_id = tenantContext.getTenantId();
      const result = await this.coll().findOne<OIDCDocument>(
        { 'payload.uid': uid, tenant_id },
        { projection: { payload: 1 } }
      );

      if (!result) return undefined;
      return result.payload;
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

      const tenant_id = tenantContext.getTenantId();
      await this.coll().deleteOne(
        tenantScopedIdentityFilter(tenant_id, _id) as any
      );
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

      const tenant_id = tenantContext.getTenantId();
      await this.coll().deleteMany({ 'payload.grantId': grantId, tenant_id });
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

      const tenant_id = tenantContext.getTenantId();
      await this.coll().findOneAndUpdate(
        tenantScopedIdentityFilter(tenant_id, _id) as any,
        {
          $set: { 'payload.consumed': Math.floor(Date.now() / 1000) },
        }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error in ${this.name}.consume for id ${_id}`,
      });
      throw error;
    }
  }

  /**
   * Get the MongoDB collection for this adapter.
   */
  coll(name?: string): Collection {
    return this.db.collection(name || this.name);
  }

  /**
   * Count all documents in the collection.
   */
  async countAll(): Promise<number> {
    try {
      const tenant_id = tenantContext.getTenantId();
      return await this.coll().countDocuments({ tenant_id });
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error counting documents in ${this.name}`,
      });
      return 0;
    }
  }

  /**
   * Map a MongoDB document to a UI-friendly format
   */
  mapDocumentToUI(
    doc: OIDCDocument | null,
    options: DocumentMappingOptions = {}
  ): MappedDocument | null {
    if (!doc) return null;

    try {
      const { includePayload = false, excludeFields = [] } = options;

      const result: MappedDocument = {
        id: doc.logical_id || doc._id,
        expiresAt: doc.expiresAt,
        customData: doc.data || {},
      };

      if (includePayload && doc.payload) {
        result.payload = { ...doc.payload };
      } else if (doc.payload) {
        if (doc.payload.accountId) result.accountId = doc.payload.accountId;
        if (doc.payload.uid) result.uid = doc.payload.uid;
        if (doc.payload.loginTs !== undefined && doc.payload.loginTs !== null)
          result.loginTs = new Date(doc.payload.loginTs * 1000);
        if (doc.payload.exp !== undefined && doc.payload.exp !== null)
          result.expiration = new Date(doc.payload.exp * 1000);
        if (doc.payload.iat !== undefined && doc.payload.iat !== null) {
          result.issuedAt = new Date(doc.payload.iat * 1000);
        }
        if (doc.payload.authorizations)
          result.authorizations = doc.payload.authorizations;
      }

      excludeFields.forEach(field => {
        delete result[field];
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error mapping document to UI`,
      });
      return { id: doc.logical_id || doc._id, customData: {} };
    }
  }

  /**
   * Extends a model with custom data methods
   */
  async extendModel(
    id: string,
    customData: Record<string, unknown>
  ): Promise<Document | null> {
    try {
      const tenant_id = tenantContext.getTenantId();
      return await this.coll().findOneAndUpdate(
        tenantScopedIdentityFilter(tenant_id, id) as any,
        { $set: { data: customData } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error extending ${this.name} with custom data`,
      });
      throw err;
    }
  }

  async findByCustomField(
    field: string,
    value: unknown
  ): Promise<OIDCDocument[]> {
    try {
      if (!field || typeof field !== 'string' || field.trim().length === 0) {
        return [];
      }

      const tenant_id = tenantContext.getTenantId();
      const results = await this.coll()
        .find<OIDCDocument>({
          [`data.${field}`]: value,
          tenant_id,
        })
        .toArray();

      return results;
    } catch (err) {
      this.logger.error(err as Error, {
        context: `Error finding ${this.name} by custom field`,
      });
      return [];
    }
  }
}

/**
 * Establish a MongoDB connection and return the Db instance.
 * This replaces the old static `OIDCMongoAdapter.connect()`.
 */
export async function connectMongoDB(
  options: AdapterConnectionOptions = {}
): Promise<Db> {
  const { uri, dbName, connection } = options;

  if (connection) {
    return connection;
  }

  if (uri) {
    const client = await MongoClient.connect(uri);
    return client.db(dbName);
  }

  if (mongoose.connection.readyState === 1) {
    // Cast through unknown to resolve type incompatibility between mongoose's
    // bundled MongoDB types and standalone mongodb package
    return mongoose.connection.db as unknown as Db;
  }

  throw new Error('No valid MongoDB connection provided');
}

/**
 * Factory for node-oidc-provider's `adapter` option.
 * Creates adapters with the injected Db connection — no global state.
 *
 * @example
 *   const db = await connectMongoDB({ uri, dbName });
 *   const adapter = createMongoAdapterFactory(db, logger);
 *   new Provider(issuer, { adapter });
 */
export function createMongoAdapterFactory(db: Db, logger: ILogger) {
  const collections = new CollectionSet(db, logger);

  return (modelName: string) => {
    collections.add(modelName);
    return new OIDCMongoAdapter(modelName, db, logger);
  };
}
