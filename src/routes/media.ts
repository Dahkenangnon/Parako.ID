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
  if (!rawPath) return null;

  if (rawPath.includes('\0')) return null;

  if (rawPath.includes('..')) return null;

  const cleaned = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;

  // Only allow alphanumeric, dash, dot, underscore, slash
  if (!/^[a-zA-Z0-9\-._/]+$/.test(cleaned)) return null;

  if (!cleaned) return null;

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

  // Catch-all: /media/file/* — the path parameter contains the storage key
  router.get('/*path', (req, res) => {
    // Express 5 returns wildcard params as arrays
    const pathParam = (req.params as any).path;
    const rawPath = Array.isArray(pathParam)
      ? pathParam.join('/')
      : pathParam || '';

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

    const expiresNum = parseInt(expires as string, 10);
    if (isNaN(expiresNum)) {
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
    const absolutePath = path.resolve(uploadsBasePath, filePath);
    if (!absolutePath.startsWith(uploadsBasePath + path.sep)) {
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
