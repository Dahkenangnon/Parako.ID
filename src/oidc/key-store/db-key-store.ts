import { injectable, inject } from 'inversify';
import * as jose from 'jose';
import { TYPES } from '../../di/types.js';
import type {
  IKeyStore,
  StoredKey,
  KeyStatus,
} from '../../di/interfaces/key-store.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import {
  deriveKeyFromSecret,
  encryptJWK,
  decryptJWK,
} from '../../utils/key-encryption.js';
import type { JwksKeyModel, IJwksKey } from '../../models/jwks-key.model.js';

const DEFAULT_TENANT = 'default';

/** Minimum milliseconds between two rotations (prevents accidental rapid-fire). */
const MIN_ROTATION_INTERVAL_MS = 60_000; // 1 minute

/**
 * Database-backed IKeyStore implementation.
 *
 * Stores JWKS keys in MongoDB (via Mongoose model) with private key
 * material encrypted at rest using AES-256-GCM derived from jwt_secret.
 *
 * Supports two-phase rotation per node-oidc-provider recommendations:
 * Phase 1 (rotate): New keys added as unpromoted (verification only)
 * Phase 2 (promote): Unpromoted keys moved to signing priority
 */
@injectable()
export class DBKeyStore implements IKeyStore {
  private derivedKey: Buffer | null = null;
  private lastRotationAt: Date | null = null;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.JwksKeyModel) private readonly jwksKeyModel: JwksKeyModel
  ) {}

  async initialize(tenantId?: string): Promise<void> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    this.ensureDerivedKey();

    const count = await this.jwksKeyModel.countDocuments({
      tenant_id: tenant,
      status: { $in: ['active', 'expiring'] },
    });

    if (count === 0) {
      this.logger.info('No keys found in database, generating initial keyset', {
        tenantId: tenant,
      });
      await this.generateAndStoreKeys(tenant);
    } else {
      this.logger.info(`Loaded ${count} keys from database`, {
        tenantId: tenant,
      });
    }
  }

  async getJWKS(tenantId?: string): Promise<{ keys: JsonWebKey[] }> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    const key = this.getDerivedKey();

    const docs = await this.jwksKeyModel
      .find({ tenant_id: tenant, status: { $in: ['active', 'expiring'] } })
      .lean();

    this.sortByPromotionGroup(docs);

    const keys = docs.map((doc: IJwksKey) =>
      decryptJWK(doc.encrypted_private_key, key)
    );
    return { keys };
  }

  async getPublicJWKS(tenantId?: string): Promise<{ keys: JsonWebKey[] }> {
    const tenant = tenantId ?? DEFAULT_TENANT;

    const docs = await this.jwksKeyModel
      .find({ tenant_id: tenant, status: { $in: ['active', 'expiring'] } })
      .lean();

    this.sortByPromotionGroup(docs);

    const keys = docs.map((doc: IJwksKey) => {
      const pub =
        typeof doc.public_key === 'string'
          ? JSON.parse(doc.public_key)
          : doc.public_key;
      return pub as JsonWebKey;
    });
    return { keys };
  }

  async rotate(tenantId?: string): Promise<void> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    this.guardRapidRotation();
    this.ensureDerivedKey();

    // IMPORTANT: Generate new keys FIRST, then demote old ones.
    // and new keys remain active — safe. The reverse order would leave
    // zero active keys on crash.

    // Phase 1: Generate new keys as unpromoted (verification only)
    await this.generateAndStoreKeys(tenant, false);

    // Move old active → expiring
    await this.jwksKeyModel.updateMany(
      { tenant_id: tenant, status: 'active', promoted: { $ne: false } },
      { $set: { status: 'expiring' as KeyStatus, rotated_at: new Date() } }
    );

    this.lastRotationAt = new Date();
    this.logger.info('Key rotation phase 1 completed (keys unpromoted)', {
      tenantId: tenant,
    });
  }

  async promoteKeys(tenantId?: string): Promise<number> {
    const tenant = tenantId ?? DEFAULT_TENANT;

    const result = await this.jwksKeyModel.updateMany(
      { tenant_id: tenant, status: 'active', promoted: false },
      { $set: { promoted: true } }
    );

    const count =
      typeof result === 'object' && result !== null && 'modifiedCount' in result
        ? (result as { modifiedCount: number }).modifiedCount
        : 0;

    if (count > 0) {
      this.logger.info(`Promoted ${count} keys to signing priority`, {
        tenantId: tenant,
      });
    }

    return count;
  }

  async retireExpiredKeys(tenantId?: string): Promise<number> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    const config = this.configManager.getConfig();
    const overlapSeconds =
      config.security?.key_store?.overlap_window_seconds ?? 7200;

    const cutoff = new Date(Date.now() - overlapSeconds * 1000);

    const result = await this.jwksKeyModel.updateMany(
      {
        tenant_id: tenant,
        status: 'expiring',
        rotated_at: { $exists: true, $lt: cutoff },
      },
      { $set: { status: 'retired' as KeyStatus } }
    );

    const modifiedCount =
      typeof result === 'object' && result !== null && 'modifiedCount' in result
        ? (result as { modifiedCount: number }).modifiedCount
        : 0;

    if (modifiedCount > 0) {
      this.logger.info(`Retired ${modifiedCount} expired keys`, {
        tenantId: tenant,
      });
    }

    return modifiedCount;
  }

  async listKeys(tenantId?: string): Promise<StoredKey[]> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    const key = this.getDerivedKey();

    const docs = await this.jwksKeyModel
      .find({ tenant_id: tenant })
      .sort({ created_at: -1 })
      .lean();

    return docs.map((doc: IJwksKey) => ({
      kid: doc.kid,
      alg: doc.alg,
      use: doc.use,
      status: doc.status as KeyStatus,
      promoted: doc.promoted !== false,
      privateKey: decryptJWK(doc.encrypted_private_key, key),
      publicKey:
        typeof doc.public_key === 'string'
          ? JSON.parse(doc.public_key)
          : doc.public_key,
      createdAt: doc.created_at,
      rotatedAt: doc.rotated_at ?? undefined,
      tenantId: doc.tenant_id,
    }));
  }

  async needsRotation(tenantId?: string): Promise<boolean> {
    const tenant = tenantId ?? DEFAULT_TENANT;
    const config = this.configManager.getConfig();
    const intervalDays =
      config.security?.key_store?.rotation_interval_days ?? 90;

    const newest = await this.jwksKeyModel
      .findOne({ tenant_id: tenant, status: 'active' })
      .sort({ created_at: -1 })
      .lean();

    if (!newest) return true; // No active keys → definitely needs rotation

    const ageMs = Date.now() - new Date(newest.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    return ageDays >= intervalDays;
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  /**
   * Sort key documents by promotion group, then by creation date (newest first).
   * node-oidc-provider picks the FIRST matching key for signing, so
   * promoted active keys must come first.
   *   Group 0: active + promoted   (signing priority)
   *   Group 1: active + unpromoted (verification only)
   *   Group 2: expiring            (verification only)
   */
  private sortByPromotionGroup(docs: IJwksKey[]): void {
    docs.sort((a: IJwksKey, b: IJwksKey) => {
      const aPromoted = a.promoted !== false;
      const bPromoted = b.promoted !== false;
      const groupA =
        a.status === 'active' && aPromoted ? 0 : a.status === 'active' ? 1 : 2;
      const groupB =
        b.status === 'active' && bPromoted ? 0 : b.status === 'active' ? 1 : 2;
      if (groupA !== groupB) return groupA - groupB;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }

  private ensureDerivedKey(): void {
    if (!this.derivedKey) {
      const config = this.configManager.getConfig();
      const jwtSecret = config.security.secrets.jwt_secret;
      this.derivedKey = deriveKeyFromSecret(jwtSecret);
    }
  }

  /**
   * Returns the cached derived key, lazily deriving it from jwt_secret if
   * needed. This avoids the "not initialized" crash when admin pages call
   * keyStore methods before the first OIDC request triggers initialize().
   */
  private getDerivedKey(): Buffer {
    this.ensureDerivedKey();
    return this.derivedKey!;
  }

  /**
   * Prevents accidental rapid-fire rotations (e.g. misconfigured cron or
   * concurrent worker restarts). Throws if the last rotation was less than
   * `MIN_ROTATION_INTERVAL_MS` ago.
   */
  private guardRapidRotation(): void {
    if (
      this.lastRotationAt &&
      Date.now() - this.lastRotationAt.getTime() < MIN_ROTATION_INTERVAL_MS
    ) {
      throw new Error(
        'Key rotation rate-limited — wait at least 1 minute between rotations'
      );
    }
  }

  private async generateAndStoreKeys(
    tenantId: string,
    promoted: boolean = true
  ): Promise<void> {
    const config = this.configManager.getConfig();
    const algorithms: string[] = config.security?.key_store?.algorithms ?? [
      'RS256',
      'ES256',
      'EdDSA',
    ];
    const key = this.getDerivedKey();

    const newDocs: Array<{
      kid: string;
      alg: string;
      use: string;
      status: KeyStatus;
      promoted: boolean;
      encrypted_private_key: string;
      public_key: Record<string, unknown>;
      tenant_id: string;
      created_at: Date;
    }> = [];

    for (const alg of algorithms) {
      const keyPair = await jose.generateKeyPair(alg, { extractable: true });
      const privateJwk = await jose.exportJWK(keyPair.privateKey);
      const publicJwk = await jose.exportJWK(keyPair.publicKey);

      privateJwk.use = 'sig';
      privateJwk.alg = alg;
      publicJwk.use = 'sig';
      publicJwk.alg = alg;

      const kid = await jose.calculateJwkThumbprint(
        privateJwk as jose.JWK,
        'sha256'
      );
      privateJwk.kid = kid;
      publicJwk.kid = kid;

      newDocs.push({
        kid,
        alg,
        use: 'sig',
        status: 'active',
        promoted,
        encrypted_private_key: encryptJWK(privateJwk as JsonWebKey, key),
        public_key: publicJwk as Record<string, unknown>,
        tenant_id: tenantId,
        created_at: new Date(),
      });
    }

    await this.jwksKeyModel.insertMany(newDocs);
    this.logger.info(`Generated ${newDocs.length} keys`, {
      algorithms,
      tenantId,
      promoted,
    });
  }
}
