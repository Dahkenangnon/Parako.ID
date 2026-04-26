import { describe, it, expect } from 'vitest';
import { BootstrapConfigSchema } from '../../../src/config/schemas/bootstrap-schema.js';

const base = {
  deployment: { environment: 'development', server: { port: 9007 } },
};

describe('BootstrapConfigSchema', () => {
  describe('storage.mongodb', () => {
    it('requires STORAGE_MONGODB_URI when adapter=mongodb', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'mongodb' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('storage.mongodb.uri');
      }
    });

    it('passes when adapter=mongodb and mongodb.uri is provided', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/test' },
        },
      });
      expect(result.success).toBe(true);
    });

    it('does NOT require mongodb.uri when adapter=sqlite', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'sqlite' },
      });
      expect(result.success).toBe(true);
    });

    it('does NOT require mongodb.uri when adapter=postgresql', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {
          adapter: 'postgresql',
          postgresql: { url: 'postgresql://user:pass@localhost/db' },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('storage.postgresql', () => {
    it('requires postgresql.url when adapter=postgresql', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'postgresql' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('storage.postgresql.url');
      }
    });
  });

  describe('oidcStorage', () => {
    it('is optional — omitting it is valid', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'sqlite' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid oidcStorage.adapter value', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'sqlite' },
        oidcStorage: { adapter: 'redis' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.oidcStorage?.adapter).toBe('redis');
      }
    });

    it('rejects unknown oidcStorage.adapter values', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'sqlite' },
        oidcStorage: { adapter: 'cassandra' },
      });
      expect(result.success).toBe(false);
    });
  });
});
