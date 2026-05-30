import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';
import {
  createTenantAwareKeyGenerator,
  getRateLimiterStorePrefix,
} from '../../../src/utils/rate-limiter.js';
import { getTenantTempDir } from '../../../src/middlewares/upload.middleware.js';
import { getTenantChannel } from '../../../src/services/redis-pubsub.service.js';

describe('Tenant Isolation — Infrastructure', () => {
  // ─── Rate Limiter ──────────────────────────────────────────────────────────

  describe('Rate limiter Redis key includes tenant_id', () => {
    it('keyGenerator includes tenant_id in the key', () => {
      const keyGen = createTenantAwareKeyGenerator('login');

      const key = tenantContext.run('tenant-a', () => {
        return keyGen('192.168.1.1');
      });

      expect(key).toContain('tenant-a');
      expect(key).toContain('login');
      expect(key).toContain('192.168.1.1');
    });

    it('different tenants get different rate limit keys for same IP', () => {
      const keyGen = createTenantAwareKeyGenerator('login');

      const keyA = tenantContext.run('acme', () => keyGen('10.0.0.1'));
      const keyB = tenantContext.run('globex', () => keyGen('10.0.0.1'));

      expect(keyA).not.toBe(keyB);
      expect(keyA).toContain('acme');
      expect(keyB).toContain('globex');
    });

    it('uses DEFAULT_TENANT_ID when no context is active', () => {
      const keyGen = createTenantAwareKeyGenerator('global');
      const key = keyGen('127.0.0.1');

      expect(key).toContain(DEFAULT_TENANT_ID);
    });

    it('Redis store prefix includes tenant-aware pattern', () => {
      const prefix = tenantContext.run('acme', () => {
        return getRateLimiterStorePrefix('login', 'parako');
      });

      expect(prefix).toBe('parako:acme:rl:login:');
    });
  });

  // ─── Upload Middleware ─────────────────────────────────────────────────────

  describe('Upload middleware tenant-scoped paths', () => {
    it('avatar destination includes tenant_id from context', () => {
      const dir = tenantContext.run('acme', () =>
        getTenantTempDir('/base', 'avatars')
      );

      // path.resolve produces absolute path
      expect(dir).toBe(path.resolve('/base/runtime/.tmp-uploads/acme/avatars'));
    });

    it('uses DEFAULT_TENANT_ID for default tenant uploads', () => {
      const dir = getTenantTempDir('/base', 'logos');
      expect(dir).toBe(
        path.resolve(`/base/runtime/.tmp-uploads/${DEFAULT_TENANT_ID}/logos`)
      );
    });

    it('different tenants get different upload directories', () => {
      const dirA = tenantContext.run('acme', () =>
        getTenantTempDir('/base', 'avatars')
      );
      const dirB = tenantContext.run('globex', () =>
        getTenantTempDir('/base', 'avatars')
      );

      expect(dirA).not.toBe(dirB);
      expect(dirA).toContain('acme');
      expect(dirB).toContain('globex');
    });

    it('sanitizes tenant IDs with path traversal characters', () => {
      // Dots, slashes, and other dangerous chars are stripped
      const dir = tenantContext.run('../../../etc', () =>
        getTenantTempDir('/base', 'avatars')
      );

      // After sanitization, '../../../etc' → 'etc'
      expect(dir).not.toContain('..');
      expect(dir).toContain('etc');
      expect(dir).toBe(path.resolve('/base/runtime/.tmp-uploads/etc/avatars'));
    });

    it('sanitizes tenant IDs with special characters', () => {
      const dir = tenantContext.run('acme@corp!#$', () =>
        getTenantTempDir('/base', 'avatars')
      );

      // Only alphanumeric, hyphens, and underscores survive
      expect(dir).toContain('acmecorp');
      expect(dir).not.toContain('@');
      expect(dir).not.toContain('!');
    });
  });

  // ─── PubSub ────────────────────────────────────────────────────────────────

  describe('PubSub tenant-scoped channels', () => {
    it('getTenantChannel() builds channel with prefix and tenant_id', () => {
      const channel = tenantContext.run('acme', () =>
        getTenantChannel('parako', 'config', 'updated')
      );

      expect(channel).toBe('parako:acme:config:updated');
    });

    it('uses DEFAULT_TENANT_ID for default tenant channel', () => {
      const channel = getTenantChannel('parako', 'config', 'updated');
      expect(channel).toBe(`parako:${DEFAULT_TENANT_ID}:config:updated`);
    });
  });
});
