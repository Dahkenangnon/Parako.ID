import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMediaFileRoutes } from '../../../src/routes/media.js';
import { signLocalUrl } from '../../../src/storage/signed-url.js';

const SECRET = 'test-media-route-secret';

describe('Media file routes', () => {
  let app: express.Express;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-route-test-'));

    // Create a test file
    const testDir = path.join(tmpDir, 'default', 'avatars');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.png'), 'fake png data');

    app = express();
    const router = createMediaFileRoutes(tmpDir, SECRET, false);
    app.use('/media/file', router);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should serve a file with valid signature', async () => {
    const signedUrl = signLocalUrl('default/avatars/test.png', SECRET, 3600);
    // signedUrl is like /media/file/default/avatars/test.png?expires=...&sig=...
    const res = await request(app).get(signedUrl);

    expect(res.status).toBe(200);
    // supertest may return body as buffer for binary-ish content types
    const body = res.text || res.body?.toString?.() || '';
    expect(body).toContain('fake png data');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('should return 403 when signature params are missing', async () => {
    const res = await request(app).get('/media/file/default/avatars/test.png');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Missing signature parameters');
  });

  it('should return 403 for expired signature', async () => {
    // Sign with -10 seconds expiry (already expired)
    const signedUrl = signLocalUrl('default/avatars/test.png', SECRET, -10);
    const res = await request(app).get(signedUrl);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Invalid or expired signature');
  });

  it('should return 403 for tampered signature', async () => {
    const signedUrl = signLocalUrl('default/avatars/test.png', SECRET, 3600);
    // Replace sig with a fake one
    const tamperedUrl = signedUrl.replace(
      /sig=[a-f0-9]+/,
      `sig=${'a'.repeat(64)}`
    );
    const res = await request(app).get(tamperedUrl);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Invalid or expired signature');
  });

  it('should reject path traversal attempts', async () => {
    // Express normalizes `..` before routing, so the route handler never sees
    // the traversal. The request either resolves to a different route (404)
    // or our sanitizer catches it if somehow passed through.
    const signedUrl = signLocalUrl('../../../etc/passwd', SECRET, 3600);
    const res = await request(app).get(signedUrl);

    // Either 400 (sanitizer blocked it) or 404 (Express normalized it away)
    expect([400, 404]).toContain(res.status);
  });

  it('should return 400 for null bytes in path', async () => {
    const res = await request(app).get(
      '/media/file/test%00.png?expires=9999999999&sig=fake'
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid file path');
  });

  it('should return 404 for non-existent file with valid signature', async () => {
    const signedUrl = signLocalUrl('default/avatars/missing.png', SECRET, 3600);
    const res = await request(app).get(signedUrl);

    expect(res.status).toBe(404);
  });

  it('should use X-Accel-Redirect in production mode', async () => {
    const prodApp = express();
    const router = createMediaFileRoutes(tmpDir, SECRET, true);
    prodApp.use('/media/file', router);

    const signedUrl = signLocalUrl('default/avatars/test.png', SECRET, 3600);
    const res = await request(prodApp).get(signedUrl);

    expect(res.status).toBe(200);
    expect(res.headers['x-accel-redirect']).toBe(
      '/_internal_uploads/default/avatars/test.png'
    );
  });
});
