import { z } from 'zod';

import { AppConfigSchema } from './schema.js';

const PersistedMultiTenancySchema =
  AppConfigSchema.shape.features.shape.multi_tenancy
    .removeDefault()
    .omit({
      extraction_priority: true,
      tenant_header: true,
      provider_pool: true,
    })
    .prefault({});

const PersistedFileStorageSchema =
  AppConfigSchema.shape.integrations.shape.file_storage
    .removeDefault()
    .omit({ provider: true })
    .prefault({});

export const PersistedConfigSchema = AppConfigSchema.omit({
  oidc_storage: true,
}).extend({
  features: AppConfigSchema.shape.features.extend({
    multi_tenancy: PersistedMultiTenancySchema,
  }),
  integrations: AppConfigSchema.shape.integrations.extend({
    file_storage: PersistedFileStorageSchema,
  }),
});

export type PersistedConfig = z.infer<typeof PersistedConfigSchema>;
