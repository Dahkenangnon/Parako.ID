import { existsSync, statSync, createReadStream } from 'node:fs';
import {
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve as resolvePath,
} from 'node:path';
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

/**
 * Verify `candidate` is the same directory as `basePath` or strictly
 * underneath it. Uses `path.relative` + `path.isAbsolute` per the
 * CodeQL `js/path-injection` documentation
 * (https://codeql.github.com/codeql-query-help/javascript/js-path-injection/)
 * — the dataflow analysis recognises this idiom as a sanitizer.
 */
const isWithin = (basePath: string, candidate: string): boolean => {
  const rel = relative(basePath, candidate);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
};

const sendPrecompressed = (
  res: Response,
  root: string,
  filePath: string,
  encoding: 'br' | 'gzip',
  contentType: string
): void => {
  // Defense-in-depth: re-validate the suffixed path right before the
  // FS calls. The suffix (`.br` / `.gz`) is a hardcoded literal, but
  // re-checking gives CodeQL an unambiguous sanitizer at every sink.
  if (!isWithin(root, filePath)) {
    throw new Error('Precompressed file path escaped the public root');
  }
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
      if (!isWithin(root, filePath)) return false;
      if (!existsSync(filePath)) return false;
      sendPrecompressed(res, root, filePath, encoding, contentType);
      return true;
    };

    if (preferBrotli && acceptsBr && tryEncoding('br')) return;
    if (acceptsGzip && tryEncoding('gzip')) return;
    if (!preferBrotli && acceptsBr && tryEncoding('br')) return;

    next();
  };
};
