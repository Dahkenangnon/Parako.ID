import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { HARDENING } from '../../../src/config/hardening-defaults.js';
import { createPrecompressedStaticMiddleware } from '../../../src/middlewares/precompressed-static.middleware.js';

const tempDirs: string[] = [];

function makeTempPublicRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'parako-precompressed-'));
  tempDirs.push(dir);
  return dir;
}

function makeReq(
  path: string,
  acceptEncoding: string | string[] | undefined = 'br,gzip',
  method = 'GET'
): Request {
  return {
    method,
    path,
    headers: { 'accept-encoding': acceptEncoding },
  } as unknown as Request;
}

function makeRes(): Response & {
  headers: Record<string, unknown>;
  chunks: Buffer[];
  setHeader: ReturnType<typeof vi.fn>;
} {
  const headers: Record<string, unknown> = {};
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return Object.assign(writable, {
    headers,
    chunks,
    setHeader: vi.fn((name: string, value: unknown) => {
      headers[name] = value;
    }),
  }) as unknown as Response & {
    headers: Record<string, unknown>;
    chunks: Buffer[];
    setHeader: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  (HARDENING.static.precompressed as any).enabled = true;
  (HARDENING.static.precompressed as any).preferBrotli = true;
});

describe('createPrecompressedStaticMiddleware', () => {
  it('serves a manifest-backed precompressed asset', async () => {
    const root = makeTempPublicRoot();
    mkdirSync(join(root, 'css'), { recursive: true });
    writeFileSync(join(root, 'css', 'styles.css.br'), 'compressed');

    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next: NextFunction = vi.fn();
    const finished = new Promise<void>(resolve => {
      res.once('finish', () => resolve());
    });

    middleware(makeReq('/css/styles.css', 'br'), res, next);
    await finished;

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/css; charset=utf-8'
    );
  });

  it('prevents stale precompressed service workers from being cached', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'service-worker.js.br'), 'compressed');

    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => {
      res.once('finish', () => resolve());
    });

    middleware(makeReq('/service-worker.js', 'br'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, no-cache'
    );
  });

  it('does not resolve traversal-like request paths into filesystem paths', () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'compressed');

    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next: NextFunction = vi.fn();

    middleware(makeReq('/../app.js', 'br'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('prefers Brotli when both precompressed variants are available', async () => {
    const root = makeTempPublicRoot();
    mkdirSync(join(root, 'js'), { recursive: true });
    writeFileSync(join(root, 'js', 'app.js.br'), 'brotli');
    writeFileSync(join(root, 'js', 'app.js.gz'), 'gzip');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/js/app.js'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/javascript; charset=utf-8'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 6);
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Accept-Encoding');
  });

  it('serves gzip when Brotli is rejected by quality', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'manifest.json.br'), 'brotli');
    writeFileSync(join(root, 'manifest.json.gz'), 'gzip');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/manifest.json', 'br;q=0, gzip;q=0.5'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/json; charset=utf-8'
    );
  });

  it('uses a wildcard encoding without an explicit quality parameter', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'icon.svg.br'), 'brotli');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/icon.svg', '*'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
  });

  it('honors explicit encoding rejection over an earlier wildcard', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    writeFileSync(join(root, 'app.js.gz'), 'gzip');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next = vi.fn();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js', '*;q=1, br;q=0, gzip;q=0'), res, next);
    if (next.mock.calls.length === 0) await finished;

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('matches encoding tokens and quality parameters case-insensitively', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next = vi.fn();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js', 'BR;Q=0.5'), res, next);
    if (next.mock.calls.length === 0) await finished;

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
  });

  it('rejects out-of-range encoding quality values', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    writeFileSync(join(root, 'app.js.gz'), 'gzip');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next = vi.fn();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js', 'br;q=1.1, gzip;q=-0.1'), res, next);
    if (next.mock.calls.length === 0) await finished;

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('falls through when accepted encodings have zero or invalid quality', () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    writeFileSync(join(root, 'app.js.gz'), 'gzip');
    const middleware = createPrecompressedStaticMiddleware(root);

    for (const header of ['deflate, br;q=0, gzip;q=nope', undefined]) {
      const res = makeRes();
      const next = vi.fn();
      const request = makeReq('/app.js', header);
      if (header === undefined) {
        delete request.headers['accept-encoding'];
      }

      middleware(request, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).not.toHaveBeenCalled();
    }
  });

  it('falls through for a multi-value Accept-Encoding header', () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const next = vi.fn();

    middleware(makeReq('/app.js', ['br', 'gzip']), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'PUT'])(
    'falls through for unsupported %s requests',
    method => {
      const root = makeTempPublicRoot();
      writeFileSync(join(root, 'app.js.br'), 'brotli');
      const middleware = createPrecompressedStaticMiddleware(root);
      const next = vi.fn();

      middleware(makeReq('/app.js', 'br', method), makeRes(), next);

      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('serves precompressed assets for HEAD requests', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js', 'br', 'HEAD'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
    expect(Buffer.concat(res.chunks)).toHaveLength(0);
  });

  it('falls through when precompressed serving is disabled', () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    const middleware = createPrecompressedStaticMiddleware(root);
    (HARDENING.static.precompressed as any).enabled = false;
    const next = vi.fn();

    middleware(makeReq('/app.js'), makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['/readme.txt', '/missing.js'])(
    'falls through for unsupported or missing asset %s',
    path => {
      const root = makeTempPublicRoot();
      writeFileSync(join(root, 'ignored.txt.br'), 'ignored');
      writeFileSync(join(root, 'plain.js'), 'plain');
      const middleware = createPrecompressedStaticMiddleware(root);
      const next = vi.fn();

      middleware(makeReq(path), makeRes(), next);

      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('ignores symbolic links while building the precompressed manifest', () => {
    const root = makeTempPublicRoot();
    const outside = makeTempPublicRoot();
    writeFileSync(join(outside, 'app.js.br'), 'brotli');
    symlinkSync(join(outside, 'app.js.br'), join(root, 'linked.js.br'));
    const middleware = createPrecompressedStaticMiddleware(root);
    const next = vi.fn();

    middleware(makeReq('/linked.js'), makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('uses gzip first when Brotli preference is disabled', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    writeFileSync(join(root, 'app.js.gz'), 'gzip');
    (HARDENING.static.precompressed as any).preferBrotli = false;
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
  });

  it('falls back to Brotli when gzip is unavailable and preference is disabled', async () => {
    const root = makeTempPublicRoot();
    writeFileSync(join(root, 'app.js.br'), 'brotli');
    (HARDENING.static.precompressed as any).preferBrotli = false;
    const middleware = createPrecompressedStaticMiddleware(root);
    const res = makeRes();
    const finished = new Promise<void>(resolve => res.once('finish', resolve));

    middleware(makeReq('/app.js'), res, vi.fn());
    await finished;

    expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'br');
  });
});
