import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMediaFileRoutes } from '../../../src/routes/media.js';
import { signLocalUrl } from '../../../src/storage/signed-url.js';

// gitleaks:allow -- deterministic unit-test signing fixture.
const SECRET = 'unit-test-media-signing-secret';

function makeApp(uploadsBasePath: string) {
  const app = express();
  app.use('/media/file', createMediaFileRoutes(uploadsBasePath, SECRET));
  return app;
}

function signedQuery(relativePath: string): string {
  const signedUrl = signLocalUrl(relativePath, SECRET, 60);
  return signedUrl.slice(signedUrl.indexOf('?'));
}

describe('createMediaFileRoutes', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serves from an absolute uploads base path with a trailing separator', async () => {
    const uploadsBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'parako-media-route-')
    );
    temporaryDirectories.push(uploadsBasePath);
    const avatarDirectory = path.join(uploadsBasePath, 'default', 'avatars');
    fs.mkdirSync(avatarDirectory, { recursive: true });
    fs.writeFileSync(path.join(avatarDirectory, 'avatar.png'), 'avatar');
    const app = makeApp(`${uploadsBasePath}${path.sep}`);
    const signedUrl = signLocalUrl('default/avatars/avatar.png', SECRET, 60);

    const response = await request(app).get(signedUrl);

    expect(response.status).toBe(200);
    const body = response.text || response.body?.toString?.() || '';
    expect(body).toBe('avatar');
    expect(response.headers['x-accel-redirect']).toBeUndefined();
  });

  it('rejects an expiry value containing non-decimal suffix characters', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));
    const signedUrl = signLocalUrl('default/avatar.png', SECRET, 60);
    const nonCanonicalUrl = signedUrl.replace(
      /expires=(\d+)/,
      'expires=$1junk'
    );

    const response = await request(app).get(nonCanonicalUrl);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid expires parameter' });
  });

  it('rejects an expiry value outside the safe integer range', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/default/avatar.png?expires=${'9'.repeat(32)}&sig=fake`
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid expires parameter' });
  });

  it('rejects duplicate expiry query values instead of accepting the first value', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));
    const signedUrl = signLocalUrl('default/avatar.png', SECRET, 60);

    const response = await request(app).get(`${signedUrl}&expires=1`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid expires parameter' });
  });

  it('requires the signature even when an expiry is present', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      '/media/file/default/avatar.png?expires=9999999999'
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Missing signature parameters' });
  });

  it('returns a stable error for malformed percent encoding after Express decoding', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      '/media/file/%25E0%25A4%25A?expires=9999999999&sig=fake'
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid path encoding' });
  });

  it.each([
    ['double-dot segments', '%252E%252E'],
    ['characters outside the storage-key allow-list', '%2520'],
    ['a path that becomes empty after normalization', '%252F'],
  ])('rejects %s', async (_description, encodedPath) => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/${encodedPath}?expires=9999999999&sig=fake`
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid file path' });
  });

  it('denies a signed path that resolves to the uploads directory itself', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/%252E${signedQuery('.')}`
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Access denied' });
  });

  it('denies a signed absolute path after sanitization', async () => {
    const app = makeApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/%252F%252Fetc${signedQuery('/etc')}`
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Access denied' });
  });

  it('does not attempt a second response when file streaming fails after headers were sent', async () => {
    vi.spyOn(express.response, 'sendFile').mockImplementation(function (
      this: Response,
      _filePath: string,
      callback?: (error: Error) => void
    ) {
      this.status(206).end('partial response');
      callback?.(new Error('stream interrupted'));
      return this;
    } as typeof express.response.sendFile);
    const app = express();
    app.use(
      '/media/file',
      createMediaFileRoutes(path.resolve(process.cwd(), 'runtime'), SECRET)
    );
    const signedUrl = signLocalUrl('default/avatar.png', SECRET, 60);

    const response = await request(app).get(signedUrl);

    expect(response.status).toBe(206);
    expect(response.text).toBe('partial response');
  });
});
