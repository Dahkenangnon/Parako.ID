import { expect, test } from '@playwright/test';

import { signLocalUrl } from '../../src/storage/signed-url.js';
import {
  startParakoInstance,
  TEST_COOKIE_SECRET,
} from './support/parako-instance.mjs';

const IDP_PORT = 19409;
const MEDIA_KEY = 'default/avatars/e2e-avatar.png';

test('serves only valid signed uploads and preserves public static cache contracts', async ({
  request,
}) => {
  const instance = await startParakoInstance({
    port: IDP_PORT,
    uploads: [
      {
        path: MEDIA_KEY,
        contents: Buffer.from('89504e470d0a1a0a', 'hex'),
      },
    ],
  });

  try {
    const manifest = await request.get(
      `${instance.origin}/manifest.webmanifest`
    );
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()['content-type']).toContain(
      'application/manifest+json'
    );

    const serviceWorker = await request.get(
      `${instance.origin}/service-worker.js`
    );
    expect(serviceWorker.status()).toBe(200);
    expect(serviceWorker.headers()['content-type']).toContain('javascript');
    expect(serviceWorker.headers()['cache-control']).toContain('no-cache');

    const signedPath = signLocalUrl(MEDIA_KEY, TEST_COOKIE_SECRET);
    const uploaded = await request.get(`${instance.origin}${signedPath}`);
    expect(uploaded.status()).toBe(200);
    expect(uploaded.headers()['content-type']).toContain('image/png');
    expect(uploaded.headers()['x-content-type-options']).toBe('nosniff');
    expect(uploaded.headers()['cache-control']).toBe('private, max-age=3600');
    expect(await uploaded.body()).toEqual(
      Buffer.from('89504e470d0a1a0a', 'hex')
    );

    const missingSignature = await request.get(
      `${instance.origin}/media/file/${MEDIA_KEY}`
    );
    expect(missingSignature.status()).toBe(403);
    await expect(missingSignature.json()).resolves.toEqual({
      error: 'Missing signature parameters',
    });

    const tampered = await request.get(
      `${instance.origin}${signedPath.replace(/sig=[a-f0-9]+/, `sig=${'a'.repeat(64)}`)}`
    );
    expect(tampered.status()).toBe(403);

    const expired = await request.get(
      `${instance.origin}${signLocalUrl(MEDIA_KEY, TEST_COOKIE_SECRET, -10)}`
    );
    expect(expired.status()).toBe(403);

    const missing = await request.get(
      `${instance.origin}${signLocalUrl('default/avatars/missing.png', TEST_COOKIE_SECRET)}`
    );
    expect(missing.status()).toBe(404);

    const traversal = await request.get(
      `${instance.origin}${signLocalUrl('../../../etc/passwd', TEST_COOKIE_SECRET)}`
    );
    expect([400, 404]).toContain(traversal.status());

    const nullByte = await request.get(
      `${instance.origin}/media/file/test%00.png?expires=9999999999&sig=fake`
    );
    expect(nullByte.status()).toBe(400);
    await expect(nullByte.json()).resolves.toEqual({
      error: 'Invalid file path',
    });

    const malformed = await request.get(
      `${instance.origin}/media/file/%25E0%25A4%25A?expires=9999999999&sig=fake`
    );
    expect(malformed.status()).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: 'Invalid path encoding',
    });
  } finally {
    await instance.stop();
  }
});
