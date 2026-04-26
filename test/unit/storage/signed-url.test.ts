import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signLocalUrl,
  validateSignature,
} from '../../../src/storage/signed-url.js';

const SECRET = 'test-secret-key-for-signing';

describe('signLocalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a path starting with /media/file/', () => {
    const url = signLocalUrl('default/avatars/test.png', SECRET);
    expect(url).toMatch(/^\/media\/file\//);
  });

  it('should include expires and sig query params', () => {
    const url = signLocalUrl('default/avatars/test.png', SECRET);
    expect(url).toContain('?expires=');
    expect(url).toContain('&sig=');
  });

  it('should encode path segments', () => {
    const url = signLocalUrl('tenant id/avatars/file name.png', SECRET);
    expect(url).toContain('tenant%20id');
    expect(url).toContain('file%20name.png');
  });

  it('should use the provided expiry duration', () => {
    const now = Math.floor(Date.now() / 1000);
    const url = signLocalUrl('test.png', SECRET, 7200);
    const expiresMatch = url.match(/expires=(\d+)/);
    expect(expiresMatch).not.toBeNull();
    const expires = parseInt(expiresMatch![1], 10);
    // Should be approximately now + 7200 (within a 2-second tolerance)
    expect(expires).toBeGreaterThanOrEqual(now + 7198);
    expect(expires).toBeLessThanOrEqual(now + 7202);
  });
});

describe('validateSignature', () => {
  it('should accept a valid signature', () => {
    const path = 'default/avatars/test.png';
    const url = signLocalUrl(path, SECRET, 3600);

    const expiresMatch = url.match(/expires=(\d+)/)!;
    const sigMatch = url.match(/sig=([a-f0-9]+)/)!;

    const result = validateSignature(
      path,
      parseInt(expiresMatch[1], 10),
      sigMatch[1],
      SECRET
    );
    expect(result).toBe(true);
  });

  it('should reject an expired signature', () => {
    const path = 'default/avatars/test.png';
    // Create a URL that expired 10 seconds ago
    const expiredTime = Math.floor(Date.now() / 1000) - 10;

    // Generate a valid sig for the expired time
    const data = `${path}:${expiredTime}`;
    const sig = createHmac('sha256', SECRET).update(data).digest('hex');

    const result = validateSignature(path, expiredTime, sig, SECRET);
    expect(result).toBe(false);
  });

  it('should reject a tampered signature', () => {
    const path = 'default/avatars/test.png';
    const url = signLocalUrl(path, SECRET, 3600);

    const expiresMatch = url.match(/expires=(\d+)/)!;

    // Tamper with the signature
    const result = validateSignature(
      path,
      parseInt(expiresMatch[1], 10),
      'deadbeef'.repeat(8), // 64-char fake signature
      SECRET
    );
    expect(result).toBe(false);
  });

  it('should reject signatures of different lengths', () => {
    const path = 'default/avatars/test.png';
    const url = signLocalUrl(path, SECRET, 3600);

    const expiresMatch = url.match(/expires=(\d+)/)!;

    // Use a shorter signature
    const result = validateSignature(
      path,
      parseInt(expiresMatch[1], 10),
      'short',
      SECRET
    );
    expect(result).toBe(false);
  });

  it('should reject when path is tampered', () => {
    const path = 'default/avatars/test.png';
    const url = signLocalUrl(path, SECRET, 3600);

    const expiresMatch = url.match(/expires=(\d+)/)!;
    const sigMatch = url.match(/sig=([a-f0-9]+)/)!;

    // Use a different path
    const result = validateSignature(
      'other/path/malicious.png',
      parseInt(expiresMatch[1], 10),
      sigMatch[1],
      SECRET
    );
    expect(result).toBe(false);
  });

  it('should reject when wrong secret is used', () => {
    const path = 'default/avatars/test.png';
    const url = signLocalUrl(path, SECRET, 3600);

    const expiresMatch = url.match(/expires=(\d+)/)!;
    const sigMatch = url.match(/sig=([a-f0-9]+)/)!;

    const result = validateSignature(
      path,
      parseInt(expiresMatch[1], 10),
      sigMatch[1],
      'wrong-secret'
    );
    expect(result).toBe(false);
  });
});
