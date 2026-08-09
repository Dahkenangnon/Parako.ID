import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { IStorageProvider } from '../storage/storage-provider.interface.js';
import { TYPES } from '../di/types.js';
import {
  SYSTEM_TENANTS,
  tenantContext,
} from '../multi-tenancy/tenant-context.js';
import { isValidHttpUrl } from '../utils/views.js';
import { ImageProcessorService } from '../services/image-processor.service.js';

/** Validate a canonical tenant ID before using it in a filesystem path. */
function validateTenantId(tid: string): string {
  if (!SYSTEM_TENANTS.has(tid) && !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(tid)) {
    throw new Error('Invalid tenant ID for upload path');
  }
  return tid;
}

/**
 * Require a non-empty filesystem path segment without separators.
 * Multer generates filenames internally, but this validation keeps the
 * storage-backed API safe when it is called directly or by a future adapter.
 */
function assertSafePathSegment(value: string, label: string): void {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`Invalid upload ${label}`);
  }
}

const UPLOAD_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

function getSafeUploadExtension(
  originalname: string,
  mimetype: string
): string {
  assertSafePathSegment(originalname, 'original filename');
  const extension = UPLOAD_EXTENSION_BY_MIME[mimetype];
  if (!extension) {
    throw new Error('Invalid upload MIME type');
  }
  return extension;
}

/**
 * Get a tenant-scoped temp upload directory path.
 * Format: {rootDir}/runtime/.tmp-uploads/{tenantId}/{category}
 */
export function getTenantTempDir(rootDir: string, category: string): string {
  const tid = validateTenantId(tenantContext.getTenantId());
  assertSafePathSegment(category, 'path category');
  const base = path.resolve(rootDir, 'runtime', '.tmp-uploads');
  return path.resolve(base, tid, category);
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
    private readonly storageProvider: IStorageProvider,
    @inject(TYPES.ImageProcessorService)
    private readonly imageProcessor: ImageProcessorService
  ) {
    this.tmpDir = path.join(
      this.fileSystemUtils.rootDir,
      'runtime',
      '.tmp-uploads'
    );
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }

    this.avatarUpload = this.createAvatarUpload();
    this.csvUpload = this.createCsvUpload();
    this.logoUpload = this.createLogoUpload();
    this.faviconUpload = this.createFaviconUpload();
  }

  // Multer instances — write to runtime/.tmp-uploads, not the final storage location

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
        try {
          const ext = getSafeUploadExtension(file.originalname, file.mimetype);
          const filename = `avatar-${userId}-${timestamp}${ext}`;
          assertSafePathSegment(filename, 'filename');
          cb(null, filename);
        } catch (error) {
          cb(error as Error, '');
        }
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
        try {
          const ext = getSafeUploadExtension(file.originalname, file.mimetype);
          const filename = `logo-${timestamp}${ext}`;
          assertSafePathSegment(filename, 'filename');
          cb(null, filename);
        } catch (error) {
          cb(error as Error, '');
        }
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
        try {
          const ext = getSafeUploadExtension(file.originalname, file.mimetype);
          const filename = `favicon-${timestamp}${ext}`;
          assertSafePathSegment(filename, 'filename');
          cb(null, filename);
        } catch (error) {
          cb(error as Error, '');
        }
      },
    });

    const allowedTypes = [
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/png',
      'image/svg+xml',
    ];

    return multer({
      storage: faviconStorage,
      fileFilter: (_req, file, cb) => {
        if (allowedTypes.includes(file.mimetype)) {
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
    const tid = validateTenantId(tenantContext.getTenantId());
    assertSafePathSegment(category, 'category');
    assertSafePathSegment(file.filename, 'filename');
    const key = `${tid}/${category}/${file.filename}`;

    // Read the temp file multer wrote (async to avoid blocking the event loop)
    const buffer = await fs.promises.readFile(file.path);

    try {
      await this.storageProvider.store(buffer, key, file.mimetype);

      // Raster image inputs get scaled WebP, AVIF, and JPEG variants written
      // alongside the source. Variant generation failures are not fatal: the
      // source is already stored and the view layer falls back to it when a
      // variant is missing.
      if (this.imageProcessor.isRasterImage(file.mimetype)) {
        try {
          await this.imageProcessor.generateVariants(
            buffer,
            key,
            file.mimetype
          );
        } catch (err) {
          this.logger.warn('Image variant generation failed', {
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.logger.debug('File stored via provider', {
        key,
        provider: this.storageProvider.providerName,
      });

      return key;
    } finally {
      try {
        await fs.promises.unlink(file.path);
      } catch {
        // Best effort: the file may already be absent. Storage errors still
        // propagate, but must not leave unbounded temporary files behind.
      }
    }
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
