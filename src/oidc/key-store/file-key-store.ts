import { injectable, inject } from 'inversify';
import * as jose from 'jose';
import { TYPES } from '../../di/types.js';
import type {
  IKeyStore,
  StoredKey,
} from '../../di/interfaces/key-store.interface.js';
import type { IFileSystemUtils } from '../../di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import { PRIVATE_KEY_FIELDS, type JWKWithMetadata } from './constants.js';

/**
 * File-based IKeyStore implementation.
 *
 * Reads JWKS from runtime/jwks/jwks.json. No encryption — filesystem ACLs
 * handle access control. Rotation writes new keys to the same file.
 */
@injectable()
export class FileKeyStore implements IKeyStore {
  private keys: JWKWithMetadata[] = [];
  private loadedAt: Date | null = null;

  constructor(
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager
  ) {}

  async initialize(_tenantId?: string): Promise<void> {
    const jwksPath = `${this.fileSystemUtils.getProjectDir()}/runtime/jwks/jwks.json`;

    let raw: string;
    try {
      raw = this.fileSystemUtils.readFileSync(jwksPath);
    } catch (err) {
      throw new Error(
        `Failed to read JWKS file at ${jwksPath}: ${(err as Error).message}. Generate keys with: yarn keys generate --file`
      );
    }

    let parsed: { keys?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`JWKS file at ${jwksPath} is not valid JSON`);
    }

    if (
      !parsed.keys ||
      !Array.isArray(parsed.keys) ||
      parsed.keys.length === 0
    ) {
      throw new Error(
        'JWKS file contains no keys. Generate keys with: yarn keys generate --file'
      );
    }

    this.keys = parsed.keys as JWKWithMetadata[];
    this.loadedAt = new Date();
    this.logger.info(`Loaded ${this.keys.length} keys from file`, {
      path: jwksPath,
    });
  }

  async getJWKS(_tenantId?: string): Promise<{ keys: JsonWebKey[] }> {
    return { keys: [...this.keys] };
  }

  async getPublicJWKS(_tenantId?: string): Promise<{ keys: JsonWebKey[] }> {
    const publicKeys = this.keys.map(key => {
      const pub: Record<string, unknown> = { ...key };
      for (const field of PRIVATE_KEY_FIELDS) {
        delete pub[field];
      }
      return pub as JsonWebKey;
    });
    return { keys: publicKeys };
  }

  async rotate(_tenantId?: string): Promise<void> {
    const config = this.configManager.getConfig();
    const algorithms = config.security?.key_store?.algorithms ?? [
      'RS256',
      'ES256',
      'EdDSA',
    ];

    const newKeys: JWKWithMetadata[] = [];

    for (const alg of algorithms) {
      const keyPair = await jose.generateKeyPair(alg, { extractable: true });
      const jwk = (await jose.exportJWK(keyPair.privateKey)) as JWKWithMetadata;
      jwk.use = 'sig';
      jwk.alg = alg;
      jwk.kid = await jose.calculateJwkThumbprint(jwk as jose.JWK, 'sha256');
      newKeys.push(jwk);
    }

    // Back up existing file
    const projectDir = this.fileSystemUtils.getProjectDir();
    const jwksPath = `${projectDir}/runtime/jwks/jwks.json`;
    const backupPath = `${jwksPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    try {
      const existing = this.fileSystemUtils.readFileSync(jwksPath);
      await this.fileSystemUtils.saveFile(backupPath, existing);
      this.logger.info('Backup created before rotation', { backupPath });
    } catch {
      // No existing file to back up — that's fine
    }

    this.fileSystemUtils.ensureDir(`${projectDir}/runtime/jwks`);
    await this.fileSystemUtils.saveFile(
      jwksPath,
      JSON.stringify({ keys: newKeys }, null, 2)
    );

    this.keys = newKeys;
    this.loadedAt = new Date();
    this.logger.info(
      `Rotated keys: ${newKeys.length} new keys written to file`
    );
  }

  async promoteKeys(_tenantId?: string): Promise<number> {
    // File store has no two-phase rotation — all keys are immediately active
    this.logger.debug('promoteKeys is a no-op for FileKeyStore');
    return 0;
  }

  async retireExpiredKeys(_tenantId?: string): Promise<number> {
    // File store has no key lifecycle — all keys in file are active
    this.logger.debug('retireExpiredKeys is a no-op for FileKeyStore');
    return 0;
  }

  async listKeys(_tenantId?: string): Promise<StoredKey[]> {
    return this.keys.map(key => {
      const pub: Record<string, unknown> = { ...key };
      for (const field of PRIVATE_KEY_FIELDS) {
        delete pub[field];
      }
      return {
        kid: key.kid ?? 'unknown',
        alg: key.alg ?? key.kty ?? 'unknown',
        use: key.use ?? 'sig',
        status: 'active' as const,
        promoted: true,
        privateKey: key,
        publicKey: pub as JsonWebKey,
        createdAt: this.loadedAt ?? new Date(),
        tenantId: 'default',
      };
    });
  }

  async needsRotation(_tenantId?: string): Promise<boolean> {
    // File store does not auto-rotate — manual rotation via CLI
    return false;
  }
}
