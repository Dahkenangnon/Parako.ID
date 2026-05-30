import path from 'node:path';
import fs from 'node:fs';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IStorageProvider } from './storage-provider.interface.js';
import { signLocalUrl } from './signed-url.js';

/**
 * Local filesystem storage provider.
 *
 * Stores files at the configured `integrations.file_storage.upload_dir`
 * (default `{rootDir}/runtime/uploads`). Serves them via HMAC-signed URLs
 * through the `/media/file/` endpoint.
 */
@injectable()
export class LocalStorageProvider implements IStorageProvider {
  public readonly providerName = 'local' as const;
  private readonly basePath: string;

  constructor(
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager
  ) {
    const configured =
      this.configManager.getConfig().integrations.file_storage.upload_dir;
    this.basePath = path.isAbsolute(configured)
      ? configured
      : path.resolve(this.fileSystemUtils.rootDir, configured);
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async store(buffer: Buffer, key: string, _mimeType: string): Promise<string> {
    this.assertNoTraversal(key);

    const fullPath = path.resolve(this.basePath, key);

    // Defense-in-depth: verify resolved path stays within base
    if (!fullPath.startsWith(this.basePath + path.sep)) {
      throw new Error(
        `Path traversal blocked: key "${key}" resolves outside uploads directory`
      );
    }

    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });

    await fs.promises.writeFile(fullPath, buffer);
    this.logger.debug('File stored locally', { key });

    return key;
  }

  async delete(key: string): Promise<void> {
    if (!key) return;

    try {
      this.assertNoTraversal(key);

      const fullPath = path.resolve(this.basePath, key);

      // Defense-in-depth: verify resolved path stays within base
      if (!fullPath.startsWith(this.basePath + path.sep)) {
        this.logger.warn('Path traversal blocked in delete', { key });
        return;
      }

      await fs.promises.rm(fullPath, { force: true });
      this.logger.debug('File deleted', { key });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'local_storage_delete',
        key,
      });
    }
  }

  getUrl(key: string): string {
    if (!key) return '';

    const config = this.configManager.getConfig();
    const secret = config.security.secrets.cookie_secrets[0];
    const expiry =
      config.integrations?.file_storage?.signed_url_expiry_seconds ?? 3600;

    return signLocalUrl(key, secret, expiry);
  }

  /**
   * Reject keys containing path traversal sequences.
   */
  private assertNoTraversal(key: string): void {
    if (key.includes('..') || key.includes('\0')) {
      throw new Error(`Invalid storage key: "${key}" contains path traversal`);
    }
  }
}
