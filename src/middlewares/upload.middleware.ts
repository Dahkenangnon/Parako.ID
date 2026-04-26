import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { IStorageProvider } from '../storage/storage-provider.interface.js';
import { TYPES } from '../di/types.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';
import { isValidHttpUrl } from '../utils/views.js';

/**
 * Sanitize a tenant ID for use in filesystem paths.
 * Strips any characters that could enable path traversal.
 */
function sanitizeTenantId(tid: string): string {
  return tid.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Get a tenant-scoped temp upload directory path.
 * Format: {rootDir}/.tmp-uploads/{tenantId}/{category}
 */
function getTenantTempDir(rootDir: string, category: string): string {
  const tid = sanitizeTenantId(tenantContext.getTenantId());
  const base = path.resolve(rootDir, '.tmp-uploads');
  const resolved = path.resolve(base, tid, category);

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `Invalid tenant upload path: tenant ID "${tid}" resolves outside temp directory`
    );
  }

  return resolved;
}

/**
 * Get a tenant-scoped upload directory path (legacy, for public/uploads/).
 * Format: {rootDir}/public/uploads/{tenantId}/{category}
 */
export function getTenantUploadDir(rootDir: string, category: string): string {
  const tid = sanitizeTenantId(tenantContext.getTenantId());
  const base = path.resolve(rootDir, 'public', 'uploads');
  const resolved = path.resolve(base, tid, category);

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `Invalid tenant upload path: tenant ID "${tid}" resolves outside uploads directory`
    );
  }

  return resolved;
}

/**
 * Strip the legacy `/uploads/` prefix from a stored path to get a storage key.
 * E.g. "/uploads/default/avatars/file.png" → "default/avatars/file.png"
 */
function stripLegacyPrefix(keyOrPath: string): string {
  if (keyOrPath.startsWith('/uploads/')) {
    return keyOrPath.slice('/uploads/'.length);
  }
  return keyOrPath;
}

@injectable()
export class UploadMiddleware implements IUploadMiddleware {
  private readonly tmpDir: string;
  public readonly avatarUpload: multer.Multer;
  public readonly csvUpload: multer.Multer;
  public readonly logoUpload: multer.Multer;
  public readonly faviconUpload: multer.Multer;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.StorageProvider)
    private readonly storageProvider: IStorageProvider
  ) {
    this.tmpDir = path.join(this.fileSystemUtils.rootDir, '.tmp-uploads');
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }

    this.avatarUpload = this.createAvatarUpload();
    this.csvUpload = this.createCsvUpload();
    this.logoUpload = this.createLogoUpload();
    this.faviconUpload = this.createFaviconUpload();
  }

  // Multer instances — write to temp dir, NOT public/uploads

  private createAvatarUpload(): multer.Multer {
    const rootDir = this.fileSystemUtils.rootDir;
    const avatarStorage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = getTenantTempDir(rootDir, 'avatars');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const userId =
          (req as any).session?.authenticatedUsers?.active?.id || 'unknown';
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `avatar-${userId}-${timestamp}${ext}`);
      },
    });

    return multer({
      storage: avatarStorage,
      fileFilter: (_req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
        }
      },
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    });
  }

  private createCsvUpload(): multer.Multer {
    return multer({
      storage: multer.memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype === 'text/csv' ||
          file.originalname.endsWith('.csv')
        ) {
          cb(null, true);
        } else {
          cb(new Error('Only CSV files are allowed'));
        }
      },
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    });
  }

  private createLogoUpload(): multer.Multer {
    const rootDir = this.fileSystemUtils.rootDir;
    const logoStorage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = getTenantTempDir(rootDir, 'logos');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `logo-${timestamp}${ext}`);
      },
    });

    return multer({
      storage: logoStorage,
      fileFilter: (_req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error('Only JPEG, PNG, GIF, WebP, and SVG images are allowed')
          );
        }
      },
      limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    });
  }

  private createFaviconUpload(): multer.Multer {
    const rootDir = this.fileSystemUtils.rootDir;
    const faviconStorage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = getTenantTempDir(rootDir, 'favicons');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `favicon-${timestamp}${ext}`);
      },
    });

    const allowedTypes = [
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/png',
      'image/svg+xml',
    ];
    const allowedExtensions = ['.ico', '.png', '.svg'];

    return multer({
      storage: faviconStorage,
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (
          allowedTypes.includes(file.mimetype) ||
          allowedExtensions.includes(ext)
        ) {
          cb(null, true);
        } else {
          cb(
            new Error('Only ICO, PNG, and SVG files are allowed for favicons')
          );
        }
      },
      limits: { fileSize: 1 * 1024 * 1024, files: 1 },
    });
  }

  // New storage-backed methods

  async storeFile(
    file: Express.Multer.File,
    category: string
  ): Promise<string> {
    const tid = sanitizeTenantId(tenantContext.getTenantId());
    const key = `${tid}/${category}/${file.filename}`;

    // Read the temp file multer wrote (async to avoid blocking the event loop)
    const buffer = await fs.promises.readFile(file.path);

    await this.storageProvider.store(buffer, key, file.mimetype);

    try {
      await fs.promises.unlink(file.path);
    } catch {}

    this.logger.debug('File stored via provider', {
      key,
      provider: this.storageProvider.providerName,
    });

    return key;
  }

  getFileUrl(key: string): string | Promise<string> {
    if (!key) return '';

    // Pass through external URLs unchanged
    if (isValidHttpUrl(key)) return key;

    // Strip legacy /uploads/ prefix if present
    const storageKey = stripLegacyPrefix(key);

    return this.storageProvider.getUrl(storageKey);
  }

  async deleteFile(key: string): Promise<void> {
    if (!key) return;

    // Don't try to delete external URLs
    if (isValidHttpUrl(key)) return;

    // Strip legacy /uploads/ prefix if present
    const storageKey = stripLegacyPrefix(key);

    await this.storageProvider.delete(storageKey);
  }
}
