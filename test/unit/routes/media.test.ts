import path from 'node:path';

import express, { type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMediaFileRoutes } from '../../../src/routes/media.js';
import { signLocalUrl } from '../../../src/storage/signed-url.js';

// gitleaks:allow -- deterministic unit-test signing fixture.
const SECRET = 'unit-test-media-signing-secret';

function makeProductionApp(uploadsBasePath: string) {
  const app = express();
  app.use('/media/file', createMediaFileRoutes(uploadsBasePath, SECRET, true));
  return app;
}

function signedQuery(relativePath: string): string {
  const signedUrl = signLocalUrl(relativePath, SECRET, 60);
  return signedUrl.slice(signedUrl.indexOf('?'));
}

describe('createMediaFileRoutes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts an absolute uploads base path with a trailing separator', async () => {
    const uploadsBasePath =
      path.resolve(process.cwd(), 'runtime', 'uploads') + path.sep;
    const app = makeProductionApp(uploadsBasePath);
    const signedUrl = signLocalUrl('default/avatars/avatar.png', SECRET, 60);

    const response = await request(app).get(signedUrl);

    expect(response.status).toBe(200);
    expect(response.headers['x-accel-redirect']).toBe(
      '/_internal_uploads/default/avatars/avatar.png'
    );
  });

  it('rejects an expiry value containing non-decimal suffix characters', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));
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
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/default/avatar.png?expires=${'9'.repeat(32)}&sig=fake`
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid expires parameter' });
  });

  it('rejects duplicate expiry query values instead of accepting the first value', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));
    const signedUrl = signLocalUrl('default/avatar.png', SECRET, 60);

    const response = await request(app).get(`${signedUrl}&expires=1`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invalid expires parameter' });
  });

  it('requires the signature even when an expiry is present', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      '/media/file/default/avatar.png?expires=9999999999'
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Missing signature parameters' });
  });

  it('returns a stable error for malformed percent encoding after Express decoding', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

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
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/${encodedPath}?expires=9999999999&sig=fake`
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid file path' });
  });

  it('denies a signed path that resolves to the uploads directory itself', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

    const response = await request(app).get(
      `/media/file/%252E${signedQuery('.')}`
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Access denied' });
  });

  it('denies a signed absolute path after sanitization', async () => {
    const app = makeProductionApp(path.resolve(process.cwd(), 'runtime'));

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
      createMediaFileRoutes(
        path.resolve(process.cwd(), 'runtime'),
        SECRET,
        false
      )
    );
    const signedUrl = signLocalUrl('default/avatar.png', SECRET, 60);

    const response = await request(app).get(signedUrl);

    expect(response.status).toBe(206);
    expect(response.text).toBe('partial response');
  });
});
