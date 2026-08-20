import { describe, expect, expectTypeOf, it } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import {
  PersistedConfigSchema,
  type PersistedConfig,
} from '../../../src/config/types.js';

describe('persisted configuration contract', () => {
  it('excludes every computed or bootstrap-owned field from its type', () => {
    expectTypeOf<
      'oidc_storage' extends keyof PersistedConfig ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'extraction_priority' extends keyof PersistedConfig['features']['multi_tenancy']
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'tenant_header' extends keyof PersistedConfig['features']['multi_tenancy']
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'provider_pool' extends keyof PersistedConfig['features']['multi_tenancy']
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'provider' extends keyof PersistedConfig['integrations']['file_storage']
        ? true
        : false
    >().toEqualTypeOf<false>();
  });

  it('strips computed and bootstrap-owned values at the schema boundary', () => {
    const full = getDefaultFullConfig();
    const parsed = PersistedConfigSchema.parse({
      ...full,
      features: {
        ...full.features,
        multi_tenancy: {
          ...full.features.multi_tenancy,
          enabled: true,
        },
      },
      integrations: {
        ...full.integrations,
        file_storage: {
          ...full.integrations.file_storage,
          provider: 's3',
        },
      },
    });

    expect(parsed).not.toHaveProperty('oidc_storage');
    expect(parsed.features.multi_tenancy).toEqual({ enabled: true });
    expect(parsed.integrations.file_storage).not.toHaveProperty('provider');
    expect(parsed.integrations.file_storage.upload_dir).toBe(
      full.integrations.file_storage.upload_dir
    );
  });
});
