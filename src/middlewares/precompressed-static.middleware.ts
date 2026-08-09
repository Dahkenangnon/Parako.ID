import { createReadStream, readdirSync, realpathSync, statSync } from 'node:fs';
import {
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve as resolvePath,
  sep,
} from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { HARDENING } from '../config/hardening-defaults.js';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const acceptsEncoding = (header: string, name: string): boolean => {
  const normalizedName = name.toLowerCase();
  let wildcardAccepted = false;
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().split(';');
    const normalizedToken = token.toLowerCase();
    if (normalizedToken !== normalizedName && normalizedToken !== '*') continue;
    const qParam = params
      .map(p => p.trim())
      .find(p => p.toLowerCase().startsWith('q='));
    const quality = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    const accepted = Number.isFinite(quality) && quality > 0 && quality <= 1;
    if (normalizedToken === normalizedName) return accepted;
    wildcardAccepted = accepted;
  }
  return wildcardAccepted;
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
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false;
  /* v8 ignore next -- path.relative is never absolute on POSIX; retained for Windows. */
  if (isAbsolute(rel)) return false;
  return true;
};

type PrecompressedEncoding = 'br' | 'gzip';

type PrecompressedAsset = {
  path: string;
  size: number;
};

type PrecompressedManifestEntry = {
  contentType: string;
  br?: PrecompressedAsset;
  gzip?: PrecompressedAsset;
};

const compressedSuffixToEncoding = (
  filePath: string
): PrecompressedEncoding | null => {
  if (filePath.endsWith('.br')) return 'br';
  if (filePath.endsWith('.gz')) return 'gzip';
  return null;
};

const stripCompressedSuffix = (filePath: string): string => {
  return filePath.slice(0, -3);
};

const toUrlPath = (root: string, assetPath: string): string => {
  const rel = relative(root, assetPath);
  return `/${rel.split(sep).join('/')}`;
};

const addPrecompressedAsset = (
  manifest: Map<string, PrecompressedManifestEntry>,
  root: string,
  compressedPath: string
): void => {
  const encoding = compressedSuffixToEncoding(compressedPath);
  if (!encoding) return;

  const assetPath = stripCompressedSuffix(compressedPath);
  const contentType = CONTENT_TYPES[extname(assetPath).toLowerCase()];
  if (!contentType) return;

  const urlPath = toUrlPath(root, assetPath);
  const entry = manifest.get(urlPath) ?? { contentType };
  entry[encoding] = {
    path: compressedPath,
    size: statSync(compressedPath).size,
  };
  manifest.set(urlPath, entry);
};

const buildPrecompressedManifest = (
  root: string
): Map<string, PrecompressedManifestEntry> => {
  const manifest = new Map<string, PrecompressedManifestEntry>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isFile()) {
        addPrecompressedAsset(manifest, root, entryPath);
      }
    }
  };

  walk(root);
  return manifest;
};

const sendPrecompressed = (
  res: Response,
  asset: PrecompressedAsset,
  encoding: PrecompressedEncoding,
  contentType: string,
  headOnly: boolean
): void => {
  res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', asset.size);
  res.setHeader('Vary', 'Accept-Encoding');
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(asset.path).pipe(res);
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
  const root = realpathSync(resolvePath(publicRoot));
  const manifest = buildPrecompressedManifest(root);
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

    const relativeRequestPath = normalize(req.path.replace(/^[/\\]+/, ''));
    const candidate = resolvePath(root, relativeRequestPath);
    if (!isWithin(root, candidate)) return next();
    const asset = manifest.get(req.path);
    if (!asset) return next();

    const acceptEncoding = req.headers['accept-encoding'];
    const acceptsBr =
      typeof acceptEncoding === 'string' &&
      acceptsEncoding(acceptEncoding, 'br');
    const acceptsGzip =
      typeof acceptEncoding === 'string' &&
      acceptsEncoding(acceptEncoding, 'gzip');

    const tryEncoding = (encoding: PrecompressedEncoding): boolean => {
      const compressedAsset = asset[encoding];
      if (!compressedAsset) return false;
      sendPrecompressed(
        res,
        compressedAsset,
        encoding,
        asset.contentType,
        req.method === 'HEAD'
      );
      return true;
    };

    if (preferBrotli && acceptsBr && tryEncoding('br')) return;
    if (acceptsGzip && tryEncoding('gzip')) return;
    if (!preferBrotli && acceptsBr && tryEncoding('br')) return;

    next();
  };
};
