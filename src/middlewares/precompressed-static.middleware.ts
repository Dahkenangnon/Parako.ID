import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, normalize, resolve as resolvePath, sep } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { HARDENING } from '../config/hardening-defaults.js';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const acceptsEncoding = (header: string | undefined, name: string): boolean => {
  if (!header) return false;
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().split(';');
    if (token !== name && token !== '*') continue;
    const qParam = params.map(p => p.trim()).find(p => p.startsWith('q='));
    if (!qParam) return true;
    const q = Number.parseFloat(qParam.slice(2));
    if (Number.isFinite(q) && q > 0) return true;
    return false;
  }
  return false;
};

const isWithin = (basePath: string, candidate: string): boolean => {
  const baseWithSep = basePath.endsWith(sep) ? basePath : basePath + sep;
  return candidate === basePath || candidate.startsWith(baseWithSep);
};

const sendPrecompressed = (
  res: Response,
  filePath: string,
  encoding: 'br' | 'gzip',
  contentType: string
): void => {
  const size = statSync(filePath).size;
  res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', size);
  res.setHeader('Vary', 'Accept-Encoding');
  createReadStream(filePath).pipe(res);
};

/**
 * Serve build-time `.br` and `.gz` siblings of static assets when the client
 * accepts them. Falls through to express.static for everything else and for
 * encodings the build did not pre-compress.
 *
 * The middleware streams the precompressed file directly: no buffer is read
 * into memory, so concurrent requests for large bundles do not allocate
 * proportionally large heap regions on the request path.
 */
export const createPrecompressedStaticMiddleware = (publicRoot: string) => {
  const root = resolvePath(publicRoot);
  const preferBrotli = HARDENING.static.precompressed.preferBrotli;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !HARDENING.static.precompressed.enabled ||
      (req.method !== 'GET' && req.method !== 'HEAD')
    ) {
      return next();
    }

    const ext = extname(req.path).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return next();

    const candidate = resolvePath(root, `.${normalize(req.path)}`);
    if (!isWithin(root, candidate)) return next();

    const acceptEncoding = req.headers['accept-encoding'];
    const acceptsBr =
      typeof acceptEncoding === 'string' &&
      acceptsEncoding(acceptEncoding, 'br');
    const acceptsGzip =
      typeof acceptEncoding === 'string' &&
      acceptsEncoding(acceptEncoding, 'gzip');

    const tryEncoding = (encoding: 'br' | 'gzip'): boolean => {
      const filePath = `${candidate}.${encoding === 'br' ? 'br' : 'gz'}`;
      if (!existsSync(filePath)) return false;
      sendPrecompressed(res, filePath, encoding, contentType);
      return true;
    };

    if (preferBrotli && acceptsBr && tryEncoding('br')) return;
    if (acceptsGzip && tryEncoding('gzip')) return;
    if (!preferBrotli && acceptsBr && tryEncoding('br')) return;

    next();
  };
};
