import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generate an HMAC-signed URL for serving local files.
 *
 * @param relativePath - Storage key (e.g. "default/avatars/avatar-uid-ts.png")
 * @param secret - HMAC signing secret
 * @param expiresInSeconds - URL validity duration (default: 3600 = 1 hour)
 * @returns Signed URL path like `/media/file/{path}?expires={ts}&sig={hmac}`
 */
export function signLocalUrl(
  relativePath: string,
  secret: string,
  expiresInSeconds = 3600
): string {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const data = `${relativePath}:${expires}`;
  const sig = createHmac('sha256', secret).update(data).digest('hex');

  const encodedPath = relativePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `/media/file/${encodedPath}?expires=${expires}&sig=${sig}`;
}

/**
 * Validate an HMAC signature for a signed URL.
 *
 * @param relativePath - Storage key extracted from the URL path
 * @param expires - Expiry timestamp (seconds since epoch)
 * @param signature - HMAC signature from the URL query string
 * @param secret - HMAC signing secret
 * @returns true if the signature is valid and not expired
 */
export function validateSignature(
  relativePath: string,
  expires: number,
  signature: string,
  secret: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (now > expires) {
    return false;
  }

  const data = `${relativePath}:${expires}`;
  const expected = createHmac('sha256', secret).update(data).digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
