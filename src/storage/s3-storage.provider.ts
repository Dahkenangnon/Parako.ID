import { injectable, inject } from 'inversify';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IStorageProvider } from './storage-provider.interface.js';

/**
 * Trim and return the value when it is a non-empty string. Returns an empty
 * string for nullish, non-string, or whitespace-only inputs so the
 * misconfiguration check below can fail with a single uniform message.
 */
const sanitizeNonEmpty = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

/**
 * Validate the optional endpoint URL. Returns the trimmed URL when it parses
 * as an absolute http(s) URL, an empty string otherwise. Configuration
 * validation upstream already restricts the type, but the provider checks
 * again so a stray whitespace value or a config edited outside the schema
 * cannot reach the SDK.
 */
const sanitizeOptionalUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return trimmed;
  } catch {
    return '';
  }
};

/**
 * S3-compatible storage provider.
 *
 * Stores files through the AWS SDK v3 S3 client and serves them via presigned
 * GET URLs. Only instantiated when `file_storage.provider = 's3'` in config.
 *
 * The provider supports AWS S3 and any S3-compatible backend reachable through
 * the same SDK: Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, and
 * Wasabi have all been verified against the configuration surface exposed here
 * (`endpoint`, `force_path_style`, `region`).
 */
@injectable()
export class S3StorageProvider implements IStorageProvider {
  public readonly providerName = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager
  ) {
    const config = this.configManager.getConfig();
    const s3Config = config.integrations.file_storage.s3;

    const region = sanitizeNonEmpty(s3Config.region);
    const bucket = sanitizeNonEmpty(s3Config.bucket);
    const accessKeyId = sanitizeNonEmpty(s3Config.access_key_id);
    const secretAccessKey = sanitizeNonEmpty(s3Config.secret_access_key);
    const endpoint = sanitizeOptionalUrl(s3Config.endpoint);
    const forcePathStyle = s3Config.force_path_style === true;

    const missing: string[] = [];
    if (!region) missing.push('region');
    if (!bucket) missing.push('bucket');
    if (!accessKeyId) missing.push('access_key_id');
    if (!secretAccessKey) missing.push('secret_access_key');
    if (missing.length > 0) {
      throw new Error(
        `S3 storage provider misconfigured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when integrations.file_storage.provider = 's3'.`
      );
    }

    this.bucket = bucket;

    const clientConfig: Record<string, unknown> = {
      region,
      credentials: { accessKeyId, secretAccessKey },
    };
    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }
    if (forcePathStyle) {
      clientConfig.forcePathStyle = true;
    }

    // The @aws-sdk/client-s3 S3ClientConfigType is generated from @smithy/core
    // with broken type definitions in the installed SDK version (smithy submodules
    // export members that don't exist). skipLibCheck masks the library errors,
    // but the constructor signature still surfaces an incompatible shape.
    // Cast via unknown to the NonNullable arg — the runtime shape is correct.
    this.client = new S3Client(
      clientConfig as unknown as NonNullable<
        ConstructorParameters<typeof S3Client>[0]
      >
    );
  }

  async store(buffer: Buffer, key: string, mimeType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    this.logger.debug('File stored in S3', { key, bucket: this.bucket });
    return key;
  }

  async delete(key: string): Promise<void> {
    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      this.logger.debug('File deleted from S3', { key, bucket: this.bucket });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 's3_storage_delete',
        key,
        bucket: this.bucket,
      });
    }
  }

  async getUrl(key: string): Promise<string> {
    if (!key) return '';

    const config = this.configManager.getConfig();
    const expiry =
      config.integrations?.file_storage?.signed_url_expiry_seconds ?? 3600;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiry });
  }
}
