import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { createPrecompressedStaticMiddleware } from '../../../src/middlewares/precompressed-static.middleware.js';

const tempDirs: string[] = [];

function makeTempPublicRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'parako-precompressed-'));
  tempDirs.push(dir);
  return dir;
}

function makeReq(path: string, acceptEncoding = 'br,gzip'): Request {
  return {
    method: 'GET',
    path,
    headers: { 'accept-encoding': acceptEncoding },
  } as unknown as Request;
}

function makeRes(): Response & {
  headers: Record<string, unknown>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const headers: Record<string, unknown> = {};
  const writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  return Object.assign(writable, {
    headers,
    setHeader: vi.fn((name: string, value: unknown) => {
      headers[name] = value;
    }),
  }) as unknown as Response & {
    headers: Record<string, unknown>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
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
});
