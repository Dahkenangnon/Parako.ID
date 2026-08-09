import { describe, expect, it } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import {
  BOOTSTRAP_ONLY_FIELDS,
  isBootstrapConfig,
  isBootstrapField,
  isPersistedConfig,
  isRuntimeConfig,
} from '../../../src/config/types.js';

const createRuntimeConfig = () => {
  const defaults = structuredClone(getDefaultFullConfig());

  return {
    ...defaults,
    deployment: {
      ...defaults.deployment,
      environment: 'production',
      server: { ...defaults.deployment.server, port: 9007 },
    },
    storage: {
      adapter: 'sqlite',
      sqlite: { path: './runtime/data/parako.db' },
    },
    _metadata: {
      configProvider: 'database',
      isBootstrapMerged: true,
      loadedAt: new Date('2026-08-01T00:00:00.000Z'),
      schema_version: '1',
      version: 1,
    },
  };
};

describe('configuration type guards', () => {
  describe('isRuntimeConfig', () => {
    it('accepts a complete runtime configuration', () => {
      expect(isRuntimeConfig(createRuntimeConfig())).toBe(true);

      const withoutOptionalMetadata = createRuntimeConfig();
      withoutOptionalMetadata._metadata = {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date('2026-08-01T00:00:00.000Z'),
      } as typeof withoutOptionalMetadata._metadata;
      expect(isRuntimeConfig(withoutOptionalMetadata)).toBe(true);
    });

    it.each([undefined, null, false, 0, '', [], {}])(
      'rejects non-runtime input: %j',
      config => {
        expect(isRuntimeConfig(config)).toBe(false);
      }
    );

    it('rejects inherited and null metadata', () => {
      const inherited = Object.create({
        _metadata: createRuntimeConfig()._metadata,
      });
      Object.assign(inherited, getDefaultFullConfig());

      expect(isRuntimeConfig(inherited)).toBe(false);
      expect(
        isRuntimeConfig({ ...createRuntimeConfig(), _metadata: null })
      ).toBe(false);
    });

    it.each([
      {},
      { configProvider: 'database' },
      { configProvider: 'database', isBootstrapMerged: true },
      {
        configProvider: 'unknown',
        isBootstrapMerged: true,
        loadedAt: new Date(),
      },
      {
        configProvider: 'file',
        isBootstrapMerged: 'yes',
        loadedAt: new Date(),
      },
      {
        configProvider: 'bootstrap',
        isBootstrapMerged: true,
        loadedAt: 'today',
      },
      {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date('invalid'),
      },
      {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date(),
        schema_version: 1,
      },
      {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date(),
        version: '1',
      },
      {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date(),
        version: -1,
      },
      {
        configProvider: 'database',
        isBootstrapMerged: true,
        loadedAt: new Date(),
        version: 1.5,
      },
    ])('rejects invalid metadata: %j', _metadata => {
      expect(isRuntimeConfig({ ...createRuntimeConfig(), _metadata })).toBe(
        false
      );
    });

    it('rejects invalid persisted configuration', () => {
      const config = createRuntimeConfig();
      config.deployment.url = 'invalid URL';

      expect(isRuntimeConfig(config)).toBe(false);
    });

    it('rejects invalid bootstrap runtime fields', () => {
      const invalidEnvironment = createRuntimeConfig();
      invalidEnvironment.deployment.environment = 'preview';

      const invalidPort = createRuntimeConfig();
      invalidPort.deployment.server.port = 0;

      const incompleteMongoStorage = createRuntimeConfig();
      incompleteMongoStorage.storage = { adapter: 'mongodb' } as never;

      expect(isRuntimeConfig(invalidEnvironment)).toBe(false);
      expect(isRuntimeConfig(invalidPort)).toBe(false);
      expect(isRuntimeConfig(incompleteMongoStorage)).toBe(false);
    });

    it.each([null, 'sqlite', {}, Object.create({ adapter: 'sqlite' })])(
      'rejects invalid runtime storage: %j',
      storage => {
        expect(isRuntimeConfig({ ...createRuntimeConfig(), storage })).toBe(
          false
        );
      }
    );
  });

  describe('schema-backed guards', () => {
    it('recognizes valid and invalid bootstrap configuration', () => {
      expect(
        isBootstrapConfig({
          deployment: {
            environment: 'development',
            server: { port: 9007 },
          },
          storage: { adapter: 'sqlite' },
        })
      ).toBe(true);
      expect(isBootstrapConfig({ storage: { adapter: 'sqlite' } })).toBe(false);
    });

    it('recognizes valid and invalid persisted configuration', () => {
      expect(isPersistedConfig(getDefaultFullConfig())).toBe(true);
      expect(isPersistedConfig({ deployment: { url: 'invalid' } })).toBe(false);
    });
  });

  describe('bootstrap field classification', () => {
    it('contains unique canonical field paths', () => {
      expect(new Set(BOOTSTRAP_ONLY_FIELDS).size).toBe(
        BOOTSTRAP_ONLY_FIELDS.length
      );
      expect(BOOTSTRAP_ONLY_FIELDS).toEqual([
        'deployment.environment',
        'deployment.server.port',
        'storage.adapter',
        'storage.mongodb.uri',
        'storage.sqlite.path',
        'storage.postgresql.url',
        'integrations.file_storage.provider',
        'features.multi_tenancy.extraction_priority',
        'features.multi_tenancy.tenant_header',
        'features.multi_tenancy.provider_pool.max_size',
        'features.multi_tenancy.provider_pool.idle_ttl_ms',
        'features.multi_tenancy.provider_pool.cleanup_interval_ms',
      ]);
    });

    it.each(BOOTSTRAP_ONLY_FIELDS)('recognizes %s', fieldPath => {
      expect(isBootstrapField(fieldPath)).toBe(true);
    });

    it.each(['', 'deployment', 'application.title', 'storage.redis.url'])(
      'rejects %j',
      fieldPath => {
        expect(isBootstrapField(fieldPath)).toBe(false);
      }
    );
  });
});
