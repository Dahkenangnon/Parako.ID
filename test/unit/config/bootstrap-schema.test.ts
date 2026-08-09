import { describe, it, expect } from 'vitest';
import { BootstrapConfigSchema } from '../../../src/config/schemas/bootstrap-schema.js';

const base = {
  deployment: { environment: 'development', server: { port: 9007 } },
};

describe('BootstrapConfigSchema', () => {
  describe('deployment', () => {
    it.each(['development', 'staging', 'production'] as const)(
      'accepts the %s environment',
      environment => {
        const result = BootstrapConfigSchema.safeParse({
          deployment: { environment, server: { port: 65535 } },
          storage: {},
        });

        expect(result.success).toBe(true);
      }
    );

    it.each([
      [
        'unknown environment',
        { environment: 'preview', server: { port: 9007 } },
      ],
      ['zero port', { environment: 'development', server: { port: 0 } }],
      ['negative port', { environment: 'development', server: { port: -1 } }],
      [
        'port above 65535',
        { environment: 'development', server: { port: 65536 } },
      ],
      [
        'fractional port',
        { environment: 'development', server: { port: 9007.5 } },
      ],
      ['string port', { environment: 'development', server: { port: '9007' } }],
    ])('rejects an %s', (_caseName, deployment) => {
      expect(
        BootstrapConfigSchema.safeParse({ deployment, storage: {} }).success
      ).toBe(false);
    });

    it('accepts a valid optional public URL', () => {
      const result = BootstrapConfigSchema.safeParse({
        deployment: {
          ...base.deployment,
          url: 'https://id.example.test/oidc',
        },
        storage: {},
      });

      expect(result.success).toBe(true);
    });

    it('rejects an invalid public URL before consumers call new URL()', () => {
      const result = BootstrapConfigSchema.safeParse({
        deployment: { ...base.deployment, url: 'not a public URL' },
        storage: {},
      });

      expect(result.success).toBe(false);
    });
  });

  describe('defaults', () => {
    it('applies safe SQLite and multi-tenancy defaults', () => {
      const result = BootstrapConfigSchema.parse({
        ...base,
        storage: { sqlite: {} },
      });

      expect(result.storage).toEqual({
        adapter: 'sqlite',
        sqlite: { path: './runtime/data/parako.db' },
      });
      expect(result.multiTenancy).toEqual({
        enabled: false,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      });
    });
  });

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

    it.each([
      'https://database.example.test/parako',
      'postgresql://database.example.test/parako',
    ])('rejects the non-MongoDB URI scheme in %s', uri => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'mongodb', mongodb: { uri } },
      });

      expect(result.success).toBe(false);
    });

    it('accepts the MongoDB SRV URI scheme', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb+srv://cluster.example.test/parako' },
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

    it('rejects an invalid postgresql URL', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {
          adapter: 'postgresql',
          postgresql: { url: 'not a URL' },
        },
      });

      expect(result.success).toBe(false);
    });

    it.each([
      'https://database.example.test/parako',
      'mongodb://database.example.test/parako',
    ])('rejects the non-PostgreSQL URL scheme in %s', url => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: { adapter: 'postgresql', postgresql: { url } },
      });

      expect(result.success).toBe(false);
    });

    it('accepts the postgres URL scheme alias', () => {
      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {
          adapter: 'postgresql',
          postgresql: {
            // gitleaks:allow -- reserved example.test URL used only for validation.
            url: 'postgres://user:secret@database.example.test/db',
          },
        },
      });

      expect(result.success).toBe(true);
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

    it.each(['mongodb', 'redis', 'sqlite', 'postgresql'] as const)(
      'accepts the %s adapter',
      adapter => {
        const result = BootstrapConfigSchema.safeParse({
          ...base,
          storage: { adapter: 'sqlite' },
          oidcStorage: { adapter },
        });

        expect(result.success).toBe(true);
      }
    );
  });

  describe('redis', () => {
    it('applies defaults and accepts supported boundary values', () => {
      expect(
        BootstrapConfigSchema.parse({ ...base, storage: {}, redis: {} }).redis
      ).toEqual({ host: 'localhost', port: 6379, database: 0 });

      const boundary = BootstrapConfigSchema.parse({
        ...base,
        storage: {},
        redis: {
          host: 'redis.internal',
          port: 65535,
          password: 'secret',
          database: 15,
        },
      });
      expect(boundary.redis).toEqual({
        host: 'redis.internal',
        port: 65535,
        password: 'secret',
        database: 15,
      });
    });

    it.each([
      { port: 0 },
      { port: 65536 },
      { port: 6379.5 },
      { database: -1 },
      { database: 16 },
      { database: 1.5 },
    ])('rejects invalid Redis limits: %j', redis => {
      expect(
        BootstrapConfigSchema.safeParse({ ...base, storage: {}, redis }).success
      ).toBe(false);
    });
  });

  describe('multiTenancy', () => {
    it('accepts explicit supported settings', () => {
      const multiTenancy = {
        enabled: true,
        extraction_priority: ['subdomain', 'header'] as const,
        tenant_header: 'x-company-id',
        provider_pool: {
          max_size: 1,
          idle_ttl_ms: 1,
          cleanup_interval_ms: 1,
        },
        bootstrap_admin_email: 'admin@example.test',
        bootstrap_admin_password: 'correct horse battery staple',
      };

      const result = BootstrapConfigSchema.safeParse({
        ...base,
        storage: {},
        multiTenancy,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.multiTenancy).toEqual(multiTenancy);
      }
    });

    it.each([
      { extraction_priority: ['cookie'] },
      { provider_pool: { max_size: 0 } },
      { provider_pool: { idle_ttl_ms: 0 } },
      { provider_pool: { cleanup_interval_ms: 0 } },
      { bootstrap_admin_email: 'invalid' },
      { bootstrap_admin_password: 'too-short' },
    ])('rejects unsafe settings: %j', multiTenancy => {
      expect(
        BootstrapConfigSchema.safeParse({
          ...base,
          storage: {},
          multiTenancy,
        }).success
      ).toBe(false);
    });
  });
});
