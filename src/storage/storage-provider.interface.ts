/**
 * Storage provider abstraction for file uploads.
 *
 * Implementations handle persistent storage (local filesystem or S3).
 * Multer still parses multipart requests into temp files; this interface
 * handles the "store it permanently" and "get a serving URL" parts.
 */
export interface IStorageProvider {
  readonly providerName: 'local' | 's3';

  /**
   * Persist a file buffer to storage under the given key.
   * @param buffer - File contents
   * @param key    - Storage key, e.g. "default/avatars/avatar-uid-ts.png"
   * @param mimeType - MIME type for content-type headers
   * @returns The storage key (same as input key)
   */
  store(buffer: Buffer, key: string, mimeType: string): Promise<string>;

  /**
   * Delete a file from storage. Idempotent — no error if missing.
   */
  delete(key: string): Promise<void>;

  /**
   * Get a serving URL for a stored file.
   * - Local: returns an HMAC-signed `/media/file/{key}?expires=...&sig=...` URL
   * - S3: returns a presigned GET URL
   */
  getUrl(key: string): string | Promise<string>;
}
