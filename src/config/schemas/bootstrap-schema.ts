import { z } from 'zod';

/**
 * Bootstrap configuration schema with only the required fields
 */
export const BootstrapConfigSchema = z
  .object({
    deployment: z.object({
      environment: z.enum(['development', 'staging', 'production']),
      url: z.string().optional(),
      server: z.object({
        port: z
          .number()
          .int()
          .positive('Port must be a positive integer')
          .max(65535, 'Port must be less than 65536'),
      }),
    }),
    storage: z.object({
      adapter: z.enum(['mongodb', 'sqlite', 'postgresql']).default('sqlite'),
      mongodb: z.object({ uri: z.string().min(1) }).optional(),
      sqlite: z
        .object({
          path: z.string().default('./data/parako.db'),
        })
        .optional(),
      postgresql: z
        .object({
          url: z.string().url(),
        })
        .optional(),
    }),
    oidcStorage: z
      .object({
        adapter: z
          .enum(['mongodb', 'redis', 'sqlite', 'postgresql'])
          .optional(),
      })
      .optional(),
    redis: z
      .object({
        host: z.string().default('localhost'),
        port: z.number().int().positive().max(65535).default(6379),
        password: z.string().optional(),
        database: z.number().int().min(0).max(15).default(0),
      })
      .optional(),
    multiTenancy: z
      .object({
        enabled: z.boolean().default(false),
        extraction_priority: z
          .array(z.enum(['header', 'subdomain']))
          .default(['header', 'subdomain']),
        tenant_header: z.string().default('x-tenant-id'),
        provider_pool: z
          .object({
            max_size: z.number().int().positive().default(50),
            idle_ttl_ms: z.number().int().positive().default(1_800_000),
            cleanup_interval_ms: z.number().int().positive().default(60_000),
          })
          .optional()
          .default({
            max_size: 50,
            idle_ttl_ms: 1_800_000,
            cleanup_interval_ms: 60_000,
          }),
        bootstrap_admin_email: z.string().email().optional(),
        bootstrap_admin_password: z.string().min(12).optional(),
      })
      .optional()
      .default({
        enabled: false,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .superRefine((val: any, ctx: z.core.$RefinementCtx) => {
    if (val.storage.adapter === 'mongodb' && !val.storage.mongodb?.uri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'STORAGE_MONGODB_URI is required when STORAGE_ADAPTER=mongodb',
        path: ['storage', 'mongodb', 'uri'],
      });
    }
    if (val.storage.adapter === 'postgresql' && !val.storage.postgresql?.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'STORAGE_POSTGRESQL_URL is required when STORAGE_ADAPTER=postgresql',
        path: ['storage', 'postgresql', 'url'],
      });
    }
  });

export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>;
