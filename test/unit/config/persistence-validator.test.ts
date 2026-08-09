import { describe, expect, it } from 'vitest';

import { BOOTSTRAP_ONLY_FIELDS } from '../../../src/config/types.js';
import {
  isBootstrapField,
  stripBootstrapFields,
  validateNonBootstrapConfig,
} from '../../../src/config/validation/persistence-validator.js';

describe('persistence validator', () => {
  describe('validateNonBootstrapConfig', () => {
    it.each([undefined, null, false, 0, '', 'config'])(
      'accepts non-object input without finding bootstrap fields: %j',
      config => {
        expect(validateNonBootstrapConfig(config)).toEqual({
          isValid: true,
          bootstrapFieldsFound: [],
        });
      }
    );

    it('reports every own bootstrap-only field in canonical order', () => {
      const config = {
        deployment: {
          environment: 'production',
          server: { port: 0 },
        },
        storage: {
          adapter: 'sqlite',
          mongodb: { uri: null },
          sqlite: { path: './runtime/parako.db' },
          postgresql: { url: 'postgresql://localhost/parako' },
        },
        integrations: {
          file_storage: { provider: 'local' },
        },
        features: {
          multi_tenancy: {
            extraction_priority: [],
            tenant_header: '',
            provider_pool: {
              max_size: 0,
              idle_ttl_ms: 0,
              cleanup_interval_ms: 0,
            },
          },
        },
      };

      expect(validateNonBootstrapConfig(config)).toEqual({
        isValid: false,
        bootstrapFieldsFound: [...BOOTSTRAP_ONLY_FIELDS],
      });
    });

    it('accepts persisted configuration containing no bootstrap-only fields', () => {
      const config = {
        deployment: { base_url: 'https://id.example.test' },
        storage: { redis: { prefix: 'parako:' } },
        application: { title: 'Parako.ID' },
      };

      expect(validateNonBootstrapConfig(config)).toEqual({
        isValid: true,
        bootstrapFieldsFound: [],
      });
    });

    it('does not treat inherited properties as persisted configuration', () => {
      const config = Object.create({
        deployment: { environment: 'production' },
      });
      config.application = { title: 'Own property' };

      expect(validateNonBootstrapConfig(config)).toEqual({
        isValid: true,
        bootstrapFieldsFound: [],
      });
    });

    it('stops safely when an intermediate value is not an object', () => {
      expect(
        validateNonBootstrapConfig({
          deployment: 'production',
          storage: null,
          features: { multi_tenancy: false },
        })
      ).toEqual({ isValid: true, bootstrapFieldsFound: [] });
    });
  });

  describe('stripBootstrapFields', () => {
    it.each([undefined, null, false, 0, '', 'config'])(
      'returns non-object input unchanged: %j',
      config => {
        expect(stripBootstrapFields(config)).toBe(config);
      }
    );

    it('returns a deep copy without bootstrap fields and preserves siblings', () => {
      const config = {
        deployment: {
          environment: 'production',
          base_url: 'https://id.example.test',
          server: { port: 9007, host: '127.0.0.1' },
        },
        storage: {
          adapter: 'sqlite',
          sqlite: { path: './runtime/parako.db', busy_timeout_ms: 5_000 },
          redis: { prefix: 'parako:' },
        },
        application: { title: 'Parako.ID' },
      };

      const sanitized = stripBootstrapFields(config);

      expect(sanitized).toEqual({
        deployment: {
          base_url: 'https://id.example.test',
          server: { host: '127.0.0.1' },
        },
        storage: {
          sqlite: { busy_timeout_ms: 5_000 },
          redis: { prefix: 'parako:' },
        },
        application: { title: 'Parako.ID' },
      });
      expect(sanitized).not.toBe(config);
      expect(sanitized.application).not.toBe(config.application);
      expect(config.deployment.environment).toBe('production');
      expect(config.storage.sqlite.path).toBe('./runtime/parako.db');
    });

    it('removes parent objects that become empty', () => {
      const config = {
        deployment: { environment: 'production', server: { port: 9007 } },
        storage: {
          adapter: 'postgresql',
          mongodb: { uri: 'mongodb://localhost/parako' },
          sqlite: { path: './runtime/parako.db' },
          postgresql: { url: 'postgresql://localhost/parako' },
        },
        features: {
          multi_tenancy: {
            extraction_priority: ['header'],
            tenant_header: 'x-tenant-id',
            provider_pool: {
              max_size: 10,
              idle_ttl_ms: 60_000,
              cleanup_interval_ms: 30_000,
            },
          },
        },
        application: { title: 'Parako.ID' },
      };

      expect(stripBootstrapFields(config)).toEqual({
        application: { title: 'Parako.ID' },
      });
    });

    it('does not traverse inherited branches while stripping', () => {
      const config = Object.create({
        deployment: { environment: 'production' },
      });
      config.application = { title: 'Own property' };

      expect(stripBootstrapFields(config)).toEqual({
        application: { title: 'Own property' },
      });
    });

    it('preserves valid branches when the bootstrap leaf is absent', () => {
      const config = {
        deployment: { server: { host: '127.0.0.1' } },
        storage: { sqlite: { busy_timeout_ms: 5_000 } },
      };

      const sanitized = stripBootstrapFields(config);

      expect(sanitized).toEqual(config);
      expect(sanitized).not.toBe(config);
    });

    it('removes the bootstrap file-storage provider while preserving its persisted settings', () => {
      const config = {
        integrations: {
          file_storage: {
            provider: 's3',
            upload_dir: './runtime/uploads',
            s3: {
              bucket: 'parako-uploads',
              region: 'eu-west-1',
            },
          },
        },
      };

      expect(stripBootstrapFields(config)).toEqual({
        integrations: {
          file_storage: {
            upload_dir: './runtime/uploads',
            s3: {
              bucket: 'parako-uploads',
              region: 'eu-west-1',
            },
          },
        },
      });
    });
  });

  describe('isBootstrapField', () => {
    it.each(BOOTSTRAP_ONLY_FIELDS)('recognizes %s', fieldPath => {
      expect(isBootstrapField(fieldPath)).toBe(true);
    });

    it.each([
      '',
      'deployment',
      'deployment.environment.name',
      'Deployment.environment',
      'application.title',
    ])('rejects non-bootstrap path %j', fieldPath => {
      expect(isBootstrapField(fieldPath)).toBe(false);
    });
  });
});
