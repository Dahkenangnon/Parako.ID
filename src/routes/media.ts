import { Router } from 'express';
import path from 'node:path';
import { validateSignature } from '../storage/signed-url.js';

/**
 * Sanitize a URL path segment to prevent path traversal and injection.
 * Rejects null bytes, `..` sequences, and non-safe characters.
 *
 * @returns sanitized path or null if invalid
 */
function sanitizePath(rawPath: string): string | null {
  if (rawPath.includes('\0')) return null;

  if (rawPath.includes('..')) return null;

  const cleaned = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;

  // Only allow alphanumeric, dash, dot, underscore, slash
  if (!/^[a-zA-Z0-9\-._/]+$/.test(cleaned)) return null;

  return cleaned;
}

/**
 * Create Express router for serving files via HMAC-signed URLs.
 *
 * GET /media/file/{path}?expires={ts}&sig={hmac}
 *
 * No auth middleware needed — the signed URL IS the authorization.
 *
 * @param uploadsBasePath - Absolute path to the uploads directory
 * @param signingSecret - HMAC signing secret
 * @param isProduction - Whether running in production (uses X-Accel-Redirect)
 */
export function createMediaFileRoutes(
  uploadsBasePath: string,
  signingSecret: string,
  isProduction: boolean
): Router {
  const router = Router();
  const normalizedUploadsBasePath = path.resolve(uploadsBasePath);

  // Catch-all: /media/file/* — the path parameter contains the storage key
  router.get('/*path', (req, res) => {
    // Express 5 returns wildcard params as arrays
    const pathSegments = (req.params as { path: string[] }).path;
    const rawPath = pathSegments.join('/');

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      res.status(400).json({ error: 'Invalid path encoding' });
      return;
    }

    const filePath = sanitizePath(decodedPath);
    if (!filePath) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    const { expires, sig } = req.query;
    if (!expires || !sig) {
      res.status(403).json({ error: 'Missing signature parameters' });
      return;
    }

    if (typeof expires !== 'string' || !/^\d+$/.test(expires)) {
      res.status(403).json({ error: 'Invalid expires parameter' });
      return;
    }
    const expiresNum = Number(expires);
    if (!Number.isSafeInteger(expiresNum)) {
      res.status(403).json({ error: 'Invalid expires parameter' });
      return;
    }

    if (
      !validateSignature(filePath, expiresNum, sig as string, signingSecret)
    ) {
      res.status(403).json({ error: 'Invalid or expired signature' });
      return;
    }

    // Resolve absolute path and verify it stays within uploads directory
    const absolutePath = path.resolve(normalizedUploadsBasePath, filePath);
    const relativePath = path.relative(normalizedUploadsBasePath, absolutePath);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (isProduction) {
      // In production with nginx, use X-Accel-Redirect for efficient serving
      // nginx must have an internal location /_internal_uploads/ aliased to the
      // configured upload_dir (default runtime/uploads/)
      res.setHeader('X-Accel-Redirect', `/_internal_uploads/${filePath}`);
      res.end();
    } else {
      // Development: serve directly
      res.sendFile(absolutePath, err => {
        if (err) {
          // File not found or other error
          if (!res.headersSent) {
            res.status(404).json({ error: 'File not found' });
          }
        }
      });
    }
  });

  return router;
}
