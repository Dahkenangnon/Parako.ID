import multer from 'multer';

/**
 * Interface for UploadMiddleware - handles file upload functionality
 */
export interface IUploadMiddleware {
  /**
   * Multer instance for avatar uploads
   */
  avatarUpload: multer.Multer;

  /**
   * Multer instance for CSV uploads
   */
  csvUpload: multer.Multer;

  /**
   * Multer instance for logo uploads
   */
  logoUpload: multer.Multer;

  /**
   * Multer instance for favicon uploads
   */
  faviconUpload: multer.Multer;

  /**
   * Store a multer-uploaded file via the active storage provider.
   * Reads the temp file, stores via provider, deletes temp file.
   * @param file - Multer file object
   * @param category - Upload category (avatars, logos, favicons)
   * @returns Storage key (e.g. "default/avatars/avatar-uid-ts.png")
   */
  storeFile(file: Express.Multer.File, category: string): Promise<string>;

  /**
   * Get a serving URL for a storage key.
   * Handles both new storage keys and legacy /uploads/ paths.
   * Passes through external HTTP(S) URLs unchanged.
   * @param key - Storage key or legacy path
   * @returns Serving URL (signed for local, presigned for S3)
   */
  getFileUrl(key: string): string | Promise<string>;

  /**
   * Delete a file from storage. Handles both new keys and legacy paths.
   * @param key - Storage key or legacy path
   */
  deleteFile(key: string): Promise<void>;
}
