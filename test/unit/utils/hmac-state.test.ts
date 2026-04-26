import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHmacState,
  verifyHmacState,
} from '../../../src/utils/hmac-state.js';

const TEST_SECRET = 'test-hmac-secret-key-for-unit-tests';

describe('HMAC State Utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createHmacState()', () => {
    it('produces deterministic output for same inputs', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'abc123',
        timestamp: Date.now(),
      };
      const state1 = createHmacState(payload, TEST_SECRET);
      const state2 = createHmacState(payload, TEST_SECRET);
      expect(state1).toBe(state2);
    });

    it('produces different output for different payloads', () => {
      const base = {
        tenant_id: 'acme',
        nonce: 'abc123',
        timestamp: Date.now(),
      };
      const state1 = createHmacState(base, TEST_SECRET);
      const state2 = createHmacState(
        { ...base, tenant_id: 'beta' },
        TEST_SECRET
      );
      expect(state1).not.toBe(state2);
    });

    it('produces different output for different secrets', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'abc123',
        timestamp: Date.now(),
      };
      const state1 = createHmacState(payload, TEST_SECRET);
      const state2 = createHmacState(payload, 'other-secret');
      expect(state1).not.toBe(state2);
    });

    it('returns a URL-safe base64 string', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'xyz',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);
      // URL-safe base64: no +, /, or = padding (may have - and _)
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('verifyHmacState()', () => {
    it('returns valid=true for freshly created state', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);
      const result = verifyHmacState(state, TEST_SECRET);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.tenant_id).toBe('acme');
        expect(result.nonce).toBe('nonce-1');
        expect(result.timestamp).toBe(payload.timestamp);
      }
    });

    it('returns valid=false for tampered payload', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);

      // Decode, tamper, re-encode
      const decoded = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8')
      );
      decoded.tenant_id = 'evil';
      const tampered = Buffer.from(JSON.stringify(decoded)).toString(
        'base64url'
      );

      const result = verifyHmacState(tampered, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/signature/i);
      }
    });

    it('returns valid=false for tampered signature', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);

      // Decode, tamper sig, re-encode
      const decoded = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8')
      );
      decoded.sig = 'deadbeef'.repeat(8);
      const tampered = Buffer.from(JSON.stringify(decoded)).toString(
        'base64url'
      );

      const result = verifyHmacState(tampered, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/signature/i);
      }
    });

    it('returns valid=false for expired state (>10 minutes)', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);

      // Advance time by 11 minutes
      vi.advanceTimersByTime(11 * 60 * 1000);

      const result = verifyHmacState(state, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/expired/i);
      }
    });

    it('returns valid=true for state within 10-minute window', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);

      // Advance time by 9 minutes (still within window)
      vi.advanceTimersByTime(9 * 60 * 1000);

      const result = verifyHmacState(state, TEST_SECRET);
      expect(result.valid).toBe(true);
    });

    it('returns valid=false for malformed input (not base64url)', () => {
      const result = verifyHmacState('not-valid-state!!!', TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/malformed/i);
      }
    });

    it('returns valid=false for valid base64 but invalid JSON', () => {
      const state = Buffer.from('not-json-content').toString('base64url');
      const result = verifyHmacState(state, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/malformed/i);
      }
    });

    it('returns valid=false for missing required fields', () => {
      const incomplete = Buffer.from(
        JSON.stringify({ sig: 'abc', tenant_id: 'acme' })
      ).toString('base64url');
      const result = verifyHmacState(incomplete, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/malformed/i);
      }
    });

    it('returns valid=false for future timestamp (clock skew)', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now() + 60 * 1000, // 1 minute in the future
      };
      const state = createHmacState(payload, TEST_SECRET);
      const result = verifyHmacState(state, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/future/i);
      }
    });

    it('returns valid=false with wrong secret', () => {
      const payload = {
        tenant_id: 'acme',
        nonce: 'nonce-1',
        timestamp: Date.now(),
      };
      const state = createHmacState(payload, TEST_SECRET);
      const result = verifyHmacState(state, 'wrong-secret');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/signature/i);
      }
    });
  });
});
