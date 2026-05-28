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
 * AWS S3 storage provider.
 *
 * Stores files in an S3 bucket and serves them via presigned GET URLs.
 * Only instantiated when `file_storage.provider = 's3'` in config.
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

    this.bucket = s3Config.bucket;
    // The @aws-sdk/client-s3 S3ClientConfigType is generated from @smithy/core
    // with broken type definitions in the installed SDK version (smithy submodules
    // export members that don't exist). skipLibCheck masks the library errors,
    // but the constructor signature still surfaces an incompatible shape.
    // Cast via unknown — the runtime shape is correct.
    this.client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.access_key_id,
        secretAccessKey: s3Config.secret_access_key,
      },
    } as unknown as ConstructorParameters<typeof S3Client>[0]);
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
