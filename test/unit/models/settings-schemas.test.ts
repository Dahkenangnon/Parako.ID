import mongoose, { Schema } from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { PersistedConfigSchema } from '../../../src/config/types.js';
import {
  applicationSchema,
  brandingSchema,
  deploymentSchema,
  featuresSchema,
  integrationsSchema,
  notificationsSchema,
  oidcSchema,
  securitySchema,
} from '../../../src/models/settings/schemas.js';

const modelName = 'SettingsSchemasUnitTest';
const SettingsSchemasModel = mongoose.model(
  modelName,
  new Schema({
    application: applicationSchema,
    branding: brandingSchema,
    deployment: deploymentSchema,
    security: securitySchema,
    features: featuresSchema,
    oidc: oidcSchema,
    integrations: integrationsSchema,
    notifications: notificationsSchema,
  })
);

afterAll(() => {
  mongoose.deleteModel(modelName);
});

describe('settings persistence schemas', () => {
  const configSections = [
    'application',
    'branding',
    'deployment',
    'security',
    'features',
    'oidc',
    'integrations',
    'notifications',
  ] as const;
  const invalidSettings = [
    {
      name: 'cookie same-site policy',
      path: 'deployment.cookies.defaults.sameSite',
      mutate: (config: Record<string, any>) => {
        config.deployment.cookies.defaults.sameSite = 'unsafe';
      },
    },
    {
      name: 'proxy hop count',
      path: 'deployment.server.trust_proxy_hops',
      mutate: (config: Record<string, any>) => {
        config.deployment.server.trust_proxy_hops = 11;
      },
    },
    {
      name: 'device confidence score',
      path: 'security.protection.device_matching.min_confidence_score',
      mutate: (config: Record<string, any>) => {
        config.security.protection.device_matching.min_confidence_score = -1;
      },
    },
    {
      name: 'WebAuthn attestation preference',
      path: 'security.authentication.multi_factor.webauthn.attestation',
      mutate: (config: Record<string, any>) => {
        config.security.authentication.multi_factor.webauthn.attestation =
          'unknown';
      },
    },
    {
      name: 'custom identifier slot',
      path: 'security.authentication.custom_identifiers.fields.0.slot',
      mutate: (config: Record<string, any>) => {
        config.security.authentication.custom_identifiers.fields = [
          { slot: 4, key: 'employee_id', name: 'Employee ID' },
        ];
      },
    },
    {
      name: 'key-store type',
      path: 'security.key_store.type',
      mutate: (config: Record<string, any>) => {
        config.security.key_store.type = 'memory';
      },
    },
    {
      name: 'device-flow character set',
      path: 'features.oidc.device_flow.charset',
      mutate: (config: Record<string, any>) => {
        config.features.oidc.device_flow.charset = 'hex';
      },
    },
    {
      name: 'social-account linking behavior',
      path: 'features.social_providers.behavior.existing_user_no_integration',
      mutate: (config: Record<string, any>) => {
        config.features.social_providers.behavior.existing_user_no_integration =
          'trust_email';
      },
    },
    {
      name: 'IP reputation threshold',
      path: 'integrations.ipqualityscore.fraud_score_threshold',
      mutate: (config: Record<string, any>) => {
        config.integrations.ipqualityscore.fraud_score_threshold = 101;
      },
    },
    {
      name: 'signed URL expiry',
      path: 'integrations.file_storage.signed_url_expiry_seconds',
      mutate: (config: Record<string, any>) => {
        config.integrations.file_storage.signed_url_expiry_seconds = 0;
      },
    },
    {
      name: 'SMS provider',
      path: 'notifications.channels.sms.provider',
      mutate: (config: Record<string, any>) => {
        config.notifications.channels.sms.provider = 'unknown';
      },
    },
  ];
  const requiredSettings = [
    {
      name: 'application title',
      path: 'application.title',
      remove: (config: Record<string, any>) => {
        delete config.application.title;
      },
    },
    {
      name: 'branding company name',
      path: 'branding.companyName',
      remove: (config: Record<string, any>) => {
        delete config.branding.companyName;
      },
    },
    {
      name: 'deployment URL',
      path: 'deployment.url',
      remove: (config: Record<string, any>) => {
        delete config.deployment.url;
      },
    },
    {
      name: 'account settings route',
      path: 'deployment.routes.account_routes.settings_profile',
      remove: (config: Record<string, any>) => {
        delete config.deployment.routes.account_routes.settings_profile;
      },
    },
    {
      name: 'JWT secret',
      path: 'security.secrets.jwt_secret',
      remove: (config: Record<string, any>) => {
        delete config.security.secrets.jwt_secret;
      },
    },
    {
      name: 'OIDC feature toggle',
      path: 'features.oidc.dev_interactions.enabled',
      remove: (config: Record<string, any>) => {
        delete config.features.oidc.dev_interactions.enabled;
      },
    },
    {
      name: 'OIDC issuer',
      path: 'oidc.issuer',
      remove: (config: Record<string, any>) => {
        delete config.oidc.issuer;
      },
    },
    {
      name: 'SMTP host',
      path: 'integrations.email.smtp_host',
      remove: (config: Record<string, any>) => {
        delete config.integrations.email.smtp_host;
      },
    },
  ];

  it('preserves the canonical custom email template path', () => {
    const document = new SettingsSchemasModel({
      branding: {
        companyName: 'Example',
        logo: '/logo.svg',
        ui: {
          customization: {
            enabled: true,
            rootPath: 'runtime/views',
            views: {
              email: { mail: 'email/custom-mail.njk' },
            },
          },
        },
      },
    });

    expect(
      document.toObject().branding?.ui?.customization?.views?.email
    ).toEqual({ mail: 'email/custom-mail.njk' });
  });

  it('preserves every canonical customizable view path', () => {
    const canonicalViews =
      getDefaultFullConfig().branding.ui.customization.views;
    const document = new SettingsSchemasModel({
      branding: {
        companyName: 'Example',
        logo: '/logo.svg',
        ui: {
          customization: {
            enabled: true,
            rootPath: 'runtime/views',
            views: canonicalViews,
          },
        },
      },
    });

    expect(document.toObject().branding?.ui?.customization?.views).toEqual(
      canonicalViews
    );
  });

  it('retains a legacy account settings override for runtime migration', () => {
    const document = new SettingsSchemasModel({
      branding: {
        companyName: 'Example',
        logo: '/logo.svg',
        ui: {
          customization: {
            enabled: true,
            rootPath: 'runtime/views',
            views: {
              accounts: { settings: 'custom/legacy-settings.njk' },
            },
          },
        },
      },
    });

    expect(
      document.toObject().branding?.ui?.customization?.views?.accounts?.settings
    ).toBe('custom/legacy-settings.njk');
  });

  it('round-trips the canonical persisted configuration exactly', () => {
    const canonicalConfig = PersistedConfigSchema.parse(getDefaultFullConfig());
    const document = new SettingsSchemasModel(canonicalConfig);
    const stored = document.toObject();
    const storedConfig = Object.fromEntries(
      configSections.map(section => [section, stored[section]])
    );

    expect(storedConfig).toEqual(canonicalConfig);
  });

  it('backfills safe defaults for sparse legacy settings', () => {
    const document = new SettingsSchemasModel({
      branding: { companyName: 'Example', logo: '/logo.svg' },
      security: {
        protection: {},
        authentication: { signup: {} },
      },
      features: {},
      integrations: {},
      notifications: {},
    }).toObject();
    const explicitContactChannels = new SettingsSchemasModel({
      security: {
        authentication: { signup: { contact_channels: {} } },
      },
    }).toObject();

    expect(document).toMatchObject({
      security: {
        protection: {
          device_matching: {
            min_confidence_score: 70,
            ip_similarity_threshold: 0.8,
            enable_impossible_travel: true,
            impossible_travel_max_speed_kmh: 900,
            trust_duration_days: 30,
          },
        },
        key_store: {
          type: 'database',
          rotation_interval_days: 90,
          overlap_window_seconds: 7200,
          algorithms: ['RS256', 'ES256', 'EdDSA'],
          promotion_delay_ms: 0,
        },
        authentication: {
          session: {
            cookie_name: 'application_session',
            same_site: 'lax',
            idle_timeout_minutes: 30,
            absolute_timeout_hours: 24,
          },
          signup: {
            contact_channels: {
              require_at_least_one: true,
              email: { enabled: true, required: false },
              phone: { enabled: true, required: false },
              full_name: { enabled: true, required: true },
            },
          },
        },
      },
      features: {
        metrics: {
          enabled: false,
          path: '/metrics',
          include_default_metrics: true,
          prefix: 'parako_',
        },
        multi_tenancy: { enabled: false },
      },
      integrations: {
        ipinfo: { enabled: false, cache_ttl_hours: 24 },
        ipqualityscore: {
          enabled: false,
          fraud_score_threshold: 75,
          cache_ttl_hours: 6,
        },
        fingerprintjs: { enabled: false },
        file_storage: {
          upload_dir: './runtime/uploads',
          signed_url_expiry_seconds: 3600,
          s3: {
            region: 'us-east-1',
            bucket: '',
            access_key_id: '',
            secret_access_key: '',
            endpoint: '',
            force_path_style: false,
          },
        },
      },
      notifications: {
        channels: {
          email: { enabled: true },
          sms: {
            enabled: false,
          },
        },
        defaults: {
          security_alerts: true,
          new_session_alerts: true,
          allow_user_preferences: true,
        },
      },
    });
    expect(
      explicitContactChannels.security?.authentication?.signup?.contact_channels
    ).toEqual({
      require_at_least_one: true,
      email: { enabled: true, required: false },
      phone: { enabled: true, required: false },
      full_name: { enabled: true, required: true },
    });
  });

  it('accepts the complete canonical persisted configuration', async () => {
    const document = new SettingsSchemasModel(getDefaultFullConfig());

    await expect(document.validate()).resolves.toBeUndefined();
  });

  it('accepts an explicitly removed primary branding logo', async () => {
    const config = getDefaultFullConfig();
    config.branding.logo = '';
    const document = new SettingsSchemasModel(config);

    await expect(document.validate()).resolves.toBeUndefined();
  });

  it('does not persist a legacy deployment environment', async () => {
    const config = getDefaultFullConfig() as unknown as Record<string, any>;
    config.deployment.environment = 'qa';
    const document = new SettingsSchemasModel(config);

    await expect(document.validate()).resolves.toBeUndefined();
    expect(document.toObject().deployment).not.toHaveProperty('environment');
  });

  it.each(invalidSettings)('rejects an invalid $name', async testCase => {
    const config = getDefaultFullConfig() as unknown as Record<string, any>;
    testCase.mutate(config);
    const document = new SettingsSchemasModel(config);

    await expect(document.validate()).rejects.toMatchObject({
      errors: {
        [testCase.path]: expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it.each(requiredSettings)('requires the $name', async testCase => {
    const config = getDefaultFullConfig() as unknown as Record<string, any>;
    testCase.remove(config);
    const document = new SettingsSchemasModel(config);

    await expect(document.validate()).rejects.toMatchObject({
      errors: {
        [testCase.path]: expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it('does not persist bootstrap-owned or computed settings', () => {
    const config = getDefaultFullConfig();
    const document = new SettingsSchemasModel(config).toObject();

    expect(document).not.toHaveProperty('oidc_storage');
    expect(document.deployment).not.toHaveProperty('environment');
    expect(document.integrations?.file_storage).not.toHaveProperty('provider');
    expect(document.features?.multi_tenancy).toEqual({ enabled: false });
  });
});
