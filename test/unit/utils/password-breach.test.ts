import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeSha1PrefixSuffix,
  checkPasswordBreach,
  checkBreachBySha1,
} from '../../../src/utils/password-breach.js';

describe('password-breach utility', () => {
  describe('computeSha1PrefixSuffix', () => {
    it('returns 5-char prefix and remaining suffix in uppercase hex', () => {
      // SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      const result = computeSha1PrefixSuffix('password');
      expect(result.prefix).toBe('5BAA6');
      expect(result.suffix).toBe('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
      expect(result.prefix).toHaveLength(5);
      expect(result.prefix + result.suffix).toHaveLength(40);
    });

    it('returns uppercase hex for all inputs', () => {
      const result = computeSha1PrefixSuffix('test123');
      expect(result.prefix).toMatch(/^[0-9A-F]{5}$/);
      expect(result.suffix).toMatch(/^[0-9A-F]+$/);
    });

    it('handles empty string', () => {
      const result = computeSha1PrefixSuffix('');
      expect(result.prefix).toHaveLength(5);
      expect(result.prefix + result.suffix).toHaveLength(40);
    });
  });

  describe('checkPasswordBreach', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns breached with count when password found in response', async () => {
      const { suffix } = computeSha1PrefixSuffix('password');
      const responseBody = [
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0',
        `${suffix}:3861493`,
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:42',
      ].join('\n');

      fetchSpy.mockResolvedValueOnce(
        new Response(responseBody, { status: 200 })
      );

      const result = await checkPasswordBreach('password');
      expect(result.breached).toBe(true);
      expect(result.count).toBe(3861493);
    });

    it('returns not breached when password not found', async () => {
      const responseBody = [
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:5',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:42',
      ].join('\n');

      fetchSpy.mockResolvedValueOnce(
        new Response(responseBody, { status: 200 })
      );

      const result = await checkPasswordBreach('some-unique-password-xyz');
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });

    it('returns not breached on timeout', async () => {
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('AbortError')), 50);
          })
      );

      const result = await checkPasswordBreach('password', 10);
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });

    it('returns not breached on HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503 })
      );

      const result = await checkPasswordBreach('password');
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });

    it('returns not breached on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkPasswordBreach('password');
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });

    it('sends Add-Padding header for response-size privacy', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));

      await checkPasswordBreach('password');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://api.pwnedpasswords.com/range/'),
        expect.objectContaining({
          headers: { 'Add-Padding': 'true' },
        })
      );
    });
  });

  describe('checkBreachBySha1', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('parses multi-line HIBP response correctly', async () => {
      const targetSuffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
      const responseBody = [
        '0000000000000000000000000000000000000:0',
        `${targetSuffix}:999`,
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:100',
      ].join('\n');

      fetchSpy.mockResolvedValueOnce(
        new Response(responseBody, { status: 200 })
      );

      const result = await checkBreachBySha1('5BAA6', targetSuffix);
      expect(result.breached).toBe(true);
      expect(result.count).toBe(999);
    });

    it('handles padded responses (count=0 lines)', async () => {
      const responseBody = [
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:0',
        'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:0',
      ].join('\n');

      fetchSpy.mockResolvedValueOnce(
        new Response(responseBody, { status: 200 })
      );

      const result = await checkBreachBySha1(
        'AAAAA',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      );
      // count=0 means breached=false
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });

    it('is case-insensitive for suffix matching', async () => {
      const responseBody = 'ABCDEF1234567890ABCDEF1234567890ABCDE:15\n';

      fetchSpy.mockResolvedValueOnce(
        new Response(responseBody, { status: 200 })
      );

      // Lowercase suffix should match uppercase response
      const result = await checkBreachBySha1(
        '12345',
        'abcdef1234567890abcdef1234567890abcde'
      );
      expect(result.breached).toBe(true);
      expect(result.count).toBe(15);
    });

    it('handles fetch failure gracefully', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('DNS resolution failed'));

      const result = await checkBreachBySha1('5BAA6', 'SUFFIX');
      expect(result.breached).toBe(false);
      expect(result.count).toBe(0);
    });
  });
});
