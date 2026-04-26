/**
 * TDD — TenantSettingsOverrideService
 *
 * Verifies:
 * - loadOverrides() returns null when no active doc exists
 * - loadOverrides() returns only whitelisted section fields (incl. notifications)
 * - saveOverrides() rejects non-whitelisted sections
 * - saveOverrides() throws when no valid fields are provided
 * - saveOverrides() passes valid sections to repository
 * - saveOverrides() merges incoming sections with existing sections
 * - saveOverrides() overwrites existing section on re-save
 * - saveOverrides() encrypts sensitive fields before saving
 * - stripDisallowedFields() strips platform-only fields
 * - stripDisallowedFields() preserves valid fields
 * - enforceConstraints() enforces floor/ceiling/enum constraints
 * - deleteSection() removes section from override doc
 * - deleteSection() deactivates doc when no sections remain
 * - deleteSection() rejects invalid section names
 * - deleteSection() accepts notifications as valid section
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantSettingsOverrideService } from '../../../src/services/tenant-settings-override.service.js';
import type { ITenantSettingsOverrideRepository } from '../../../src/db/repositories/interfaces/tenant-settings-override.repository.js';
import type { ITenantSettingsOverride } from '../../../src/types/tenant-settings-override.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';

// Mock tenantContext.run to execute callback directly
vi.mock('../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    run: vi.fn((_tenantId: string, fn: () => any) => fn()),
  },
}));

// Mock encryption
vi.mock('../../../src/utils/encryption.js', () => ({
  ensureEncrypted: vi.fn((v: string) => `encrypted:${v}`),
  ensureDecrypted: vi.fn((v: string) => v.replace('encrypted:', '')),
}));

// ── Stubs ────────────────────────────────────────────────────────────────────

function makeMockRepo(): ITenantSettingsOverrideRepository {
  return {
    findActive: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation(async (value: any) => ({
      id: 'tso-1',
      tenant_id: 'acme',
      key: 'parako_config',
      version: '1.0.0',
      _version: 1,
      is_active: true,
      ...value,
      created_at: new Date(),
      updated_at: new Date(),
    })),
  };
}

function makeMockLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockConfigManager(
  overrides: Record<string, any> = {}
): IConfigManager {
  const defaultConfig = {
    security: {
      authentication: {
        multi_factor: {
          enabled: false,
          totp: { enabled: false },
          email: { enabled: false, code_ttl_seconds: 300 },
          sms: { enabled: false },
          webauthn: {
            enabled: false,
            user_verification: 'preferred',
            max_credentials_per_user: 10,
          },
        },
        login: {
          password_policy: {
            min_length: 8,
            require_uppercase: false,
            require_lowercase: false,
            require_numbers: false,
            require_symbols: false,
            max_age_days: 90,
          },
        },
        signup: {
          require_email_verification: false,
          require_phone_verification: false,
        },
        session: {
          bind_ip: false,
          bind_user_agent: false,
          bind_device: false,
          idle_timeout_minutes: 60,
          absolute_timeout_hours: 24,
          max_concurrent_sessions: 0, // unlimited
          max_accounts_per_session: 5,
          encrypt_session_data: false,
          require_reauth_on_switch: false,
          require_2fa_for_new_device: false,
          new_device_confidence_threshold: 0.5,
        },
      },
      protection: {
        rate_limiting: {
          enabled: true,
          requests_per_minute: 60,
          window_minutes: 1,
        },
        encrypt_device_data: false,
        device_matching: {
          min_confidence_score: 0.5,
          ip_similarity_threshold: 0.7,
          impossible_travel_max_speed_kmh: 1000,
          trust_duration_days: 30,
        },
      },
    },
    oidc: {
      token_ttl: {
        access_token: 3600,
        authorization_code: 600,
        id_token: 3600,
        refresh_token: 86400,
        session: 86400,
      },
    },
    notifications: {
      channels: {
        sms: {
          rate_limits: {
            per_phone_per_hour: 5,
            per_ip_per_day: 20,
            cooldown_seconds: 60,
          },
        },
      },
    },
    ...overrides,
  };
  return {
    getConfig: vi.fn().mockReturnValue(defaultConfig),
    invalidateTenantConfig: vi.fn(),
    ensureTenantConfig: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(true),
    load: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as IConfigManager;
}

function makeService(repo?: ITenantSettingsOverrideRepository) {
  const r = repo ?? makeMockRepo();
  return {
    service: new TenantSettingsOverrideService(
      r as any,
      makeMockLogger() as any
    ),
    repo: r,
  };
}

function makeOverrideDoc(
  fields: Partial<ITenantSettingsOverride> = {}
): ITenantSettingsOverride {
  return {
    id: 'tso-1',
    tenant_id: 'acme',
    key: 'parako_config',
    version: '1.0.0',
    _version: 1,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...fields,
  } as ITenantSettingsOverride;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TenantSettingsOverrideService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loadOverrides ───────────────────────────────────────────────────────

  describe('loadOverrides()', () => {
    it('returns null when no active doc exists', async () => {
      const { service } = makeService();
      const result = await service.loadOverrides('acme');
      expect(result).toBeNull();
    });

    it('returns only whitelisted section fields from doc', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          application: { title: 'Acme App' } as any,
          branding: { companyName: 'Acme' } as any,
        })
      );
      const { service } = makeService(repo);

      const result = await service.loadOverrides('acme');

      expect(result).toEqual({
        application: { title: 'Acme App' },
        branding: { companyName: 'Acme' },
      });
    });

    it('returns null when doc has no whitelisted fields', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({})
      );
      const { service } = makeService(repo);

      const result = await service.loadOverrides('acme');
      expect(result).toBeNull();
    });

    it('returns notifications section when present', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          notifications: {
            channels: { sms: { enabled: true } },
          } as any,
        })
      );
      const { service } = makeService(repo);

      const result = await service.loadOverrides('acme');

      expect(result).toEqual({
        notifications: { channels: { sms: { enabled: true } } },
      });
    });
  });

  // ── saveOverrides ─────────────────────────────────────────────────────────

  describe('saveOverrides()', () => {
    it('passes valid whitelisted fields to repository', async () => {
      const { service, repo } = makeService();

      await service.saveOverrides(
        'acme',
        { application: { title: 'New Title' } as any },
        'admin@acme.com',
        'Changed title'
      );

      expect(repo.save).toHaveBeenCalledWith(
        { application: { title: 'New Title' } },
        { modifiedBy: 'admin@acme.com', reason: 'Changed title' }
      );
    });

    it('filters out non-whitelisted sections and saves valid ones', async () => {
      const { service, repo } = makeService();

      await service.saveOverrides('acme', {
        application: { title: 'Valid' } as any,
        deployment: { env: 'test' },
      } as any);

      expect(repo.save).toHaveBeenCalledWith(
        { application: { title: 'Valid' } },
        expect.any(Object)
      );
    });

    it('throws when no valid override fields are provided', async () => {
      const { service } = makeService();

      await expect(
        service.saveOverrides('acme', {
          deployment: { env: 'test' },
          storage: { adapter: 'redis' },
        } as any)
      ).rejects.toThrow('No valid override fields provided');
    });

    it('saves all 7 whitelisted sections including notifications', async () => {
      const { service, repo } = makeService();

      const overrides = {
        application: { title: 'X' },
        branding: { companyName: 'X' },
        security: {
          authentication: {
            multi_factor: { enabled: true },
          },
        },
        features: { social_providers: { enabled: ['google'] } },
        oidc: { discovery: { op_policy_uri: 'https://example.com/policy' } },
        integrations: { email: { smtp_host: 'smtp.example.com' } },
        notifications: { defaults: { security_alerts: true } },
      } as any;

      await service.saveOverrides('acme', overrides);

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData.application).toBeDefined();
      expect(savedData.branding).toBeDefined();
      expect(savedData.security).toBeDefined();
      expect(savedData.features).toBeDefined();
      expect(savedData.oidc).toBeDefined();
      expect(savedData.integrations).toBeDefined();
      expect(savedData.notifications).toBeDefined();
    });

    it('encrypts sensitive fields before saving', async () => {
      const { service, repo } = makeService();
      const { ensureEncrypted } =
        await import('../../../src/utils/encryption.js');

      const overrides = {
        integrations: {
          email: {
            smtp_host: 'smtp.example.com',
            smtp_password: 'my-secret-password',
          },
        },
        notifications: {
          channels: {
            sms: {
              api_key: 'twilio-key-123',
              api_secret: 'twilio-secret-456',
            },
          },
        },
      } as any;

      await service.saveOverrides('acme', overrides);

      // Verify ensureEncrypted was called for each sensitive field
      expect(ensureEncrypted).toHaveBeenCalledWith('my-secret-password');
      expect(ensureEncrypted).toHaveBeenCalledWith('twilio-key-123');
      expect(ensureEncrypted).toHaveBeenCalledWith('twilio-secret-456');

      // Verify the saved data has encrypted values
      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData.integrations.email.smtp_password).toBe(
        'encrypted:my-secret-password'
      );
      expect(savedData.notifications.channels.sms.api_key).toBe(
        'encrypted:twilio-key-123'
      );
      expect(savedData.notifications.channels.sms.api_secret).toBe(
        'encrypted:twilio-secret-456'
      );

      // Non-sensitive fields should NOT be encrypted
      expect(savedData.integrations.email.smtp_host).toBe('smtp.example.com');
    });

    it('encrypts social provider client_secret fields', async () => {
      const { service, repo } = makeService();
      const { ensureEncrypted } =
        await import('../../../src/utils/encryption.js');

      const overrides = {
        features: {
          social_providers: {
            google: { client_id: 'google-id', client_secret: 'google-secret' },
            github: { client_id: 'gh-id', client_secret: 'gh-secret' },
          },
        },
      } as any;

      await service.saveOverrides('acme', overrides);

      expect(ensureEncrypted).toHaveBeenCalledWith('google-secret');
      expect(ensureEncrypted).toHaveBeenCalledWith('gh-secret');

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData.features.social_providers.google.client_secret).toBe(
        'encrypted:google-secret'
      );
      // client_id should NOT be encrypted
      expect(savedData.features.social_providers.google.client_id).toBe(
        'google-id'
      );
    });

    it('merges incoming sections with existing sections (preserves other sections)', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          branding: { companyName: 'Acme Corp' } as any,
          security: {
            authentication: {
              multi_factor: { enabled: true },
            },
          } as any,
        })
      );
      const { service } = makeService(repo);

      await service.saveOverrides(
        'acme',
        { application: { title: 'New Title' } as any },
        'admin@acme.com'
      );

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData).toEqual({
        branding: { companyName: 'Acme Corp' },
        security: { authentication: { multi_factor: { enabled: true } } },
        application: { title: 'New Title' },
      });
    });

    it('overwrites existing section when same section is saved again', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          application: { title: 'Old Title' } as any,
          branding: { companyName: 'Acme' } as any,
        })
      );
      const { service } = makeService(repo);

      await service.saveOverrides('acme', {
        application: { title: 'Updated Title' } as any,
      });

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData.application).toEqual({ title: 'Updated Title' });
      expect(savedData.branding).toEqual({ companyName: 'Acme' });
    });

    it('does not encrypt empty sensitive fields', async () => {
      const { service } = makeService();

      const overrides = {
        integrations: {
          email: {
            smtp_password: '',
          },
        },
      } as any;

      // Empty strings are stripped as "use default" — nothing left to save
      await expect(service.saveOverrides('acme', overrides)).rejects.toThrow(
        'No valid override fields provided after empty-value filtering'
      );
    });

    it('full pipeline: strip → enforce → encrypt → save', async () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: { enabled: true },
            login: { password_policy: { min_length: 10 } },
            session: { idle_timeout_minutes: 60 },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service, repo } = makeService();

      const overrides = {
        security: {
          authentication: {
            multi_factor: { enabled: false }, // floor violation
            login: { password_policy: { min_length: 12 } }, // ok (> platform)
          },
          secrets: { jwt_secret: 'HACKED' }, // disallowed field
        },
        integrations: {
          email: { smtp_password: 'secret123' },
        },
      } as any;

      await service.saveOverrides(
        'acme',
        overrides,
        undefined,
        undefined,
        platformConfig
      );

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      // Disallowed field stripped
      expect(savedData.security?.secrets).toBeUndefined();
      // Floor enforced: MFA stays true
      expect(savedData.security.authentication.multi_factor.enabled).toBe(true);
      // Valid field preserved
      expect(
        savedData.security.authentication.login.password_policy.min_length
      ).toBe(12);
      // Encrypted
      expect(savedData.integrations.email.smtp_password).toBe(
        'encrypted:secret123'
      );
    });

    it('accepts oidc.token_ttl fields in whitelist', async () => {
      const { service, repo } = makeService();

      await service.saveOverrides('acme', {
        oidc: {
          token_ttl: { access_token: 1800, id_token: 1800 },
        },
      } as any);

      const savedData = (repo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(savedData.oidc.token_ttl.access_token).toBe(1800);
      expect(savedData.oidc.token_ttl.id_token).toBe(1800);
    });
  });

  // ── stripDisallowedFields ─────────────────────────────────────────────────

  describe('stripDisallowedFields()', () => {
    it('strips security.secrets.jwt_secret from incoming overrides', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          security: {
            secrets: { jwt_secret: 'HACKED' },
            authentication: { multi_factor: { enabled: true } },
          },
        },
        'acme'
      );

      expect(result.security?.secrets).toBeUndefined();
      expect(result.security?.authentication?.multi_factor?.enabled).toBe(true);
    });

    it('strips branding.ui.customization.rootPath (Defect 2)', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          branding: {
            companyName: 'Acme',
            ui: { customization: { rootPath: '../../etc', enabled: true } },
          },
        },
        'acme'
      );

      expect(result.branding?.companyName).toBe('Acme');
      expect(result.branding?.ui).toBeUndefined();
    });

    it('strips deeply nested unknown fields', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          security: {
            authentication: {
              multi_factor: { enabled: true },
              unknown_field: 'should be stripped',
            },
          },
        },
        'acme'
      );

      expect(result.security?.authentication?.multi_factor?.enabled).toBe(true);
      expect(result.security?.authentication?.unknown_field).toBeUndefined();
    });

    it('preserves valid fields across all sections', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          application: { title: 'My App' },
          branding: { companyName: 'Acme' },
          notifications: {
            channels: { sms: { enabled: true } },
            defaults: { security_alerts: true },
          },
        },
        'acme'
      );

      expect(result.application?.title).toBe('My App');
      expect(result.branding?.companyName).toBe('Acme');
      expect(result.notifications?.channels?.sms?.enabled).toBe(true);
      expect(result.notifications?.defaults?.security_alerts).toBe(true);
    });

    it('preserves valid nested paths', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          security: {
            authentication: {
              multi_factor: {
                enabled: true,
                totp: { enabled: true, issuer_name: 'Acme' },
                webauthn: {
                  enabled: true,
                  rp_name: 'Acme Auth',
                  user_verification: 'required',
                },
              },
            },
          },
        },
        'acme'
      );

      expect(result.security?.authentication?.multi_factor?.enabled).toBe(true);
      expect(result.security?.authentication?.multi_factor?.totp?.enabled).toBe(
        true
      );
      expect(
        result.security?.authentication?.multi_factor?.totp?.issuer_name
      ).toBe('Acme');
      expect(
        result.security?.authentication?.multi_factor?.webauthn?.rp_name
      ).toBe('Acme Auth');
    });

    it('returns empty object when all fields are disallowed', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          deployment: { url: 'https://evil.com' },
          security: {
            secrets: { jwt_secret: 'HACKED' },
            key_store: { rotation: 'daily' },
          },
        },
        'acme'
      );

      expect(result).toEqual({});
    });

    it('preserves array-valued fields', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          application: { locales: { available: ['en', 'fr'] } },
          features: { social_providers: { enabled: ['google', 'github'] } },
        },
        'acme'
      );

      expect(result.application?.locales?.available).toEqual(['en', 'fr']);
      expect(result.features?.social_providers?.enabled).toEqual([
        'google',
        'github',
      ]);
    });

    it('preserves object-valued whitelist fields (custom_identifiers, recovery, behavior)', () => {
      const { service } = makeService();
      const result = service.stripDisallowedFields(
        {
          security: {
            authentication: {
              custom_identifiers: { enabled: true, fields: [] },
              recovery: { methods: ['email', 'sms'] },
            },
          },
          features: {
            social_providers: {
              behavior: { auto_link: true },
            },
          },
        },
        'acme'
      );

      expect(result.security?.authentication?.custom_identifiers).toEqual({
        enabled: true,
        fields: [],
      });
      expect(result.security?.authentication?.recovery).toEqual({
        methods: ['email', 'sms'],
      });
      expect(result.features?.social_providers?.behavior).toEqual({
        auto_link: true,
      });
    });
  });

  // ── enforceConstraints ────────────────────────────────────────────────────

  describe('enforceConstraints()', () => {
    it('clamps session.idle_timeout_minutes to ceiling', () => {
      const platformConfig =
        makeMockConfigManager().getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Tenant tries 90 (above platform 60) → clamped to 60
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: { session: { idle_timeout_minutes: 90 } },
          },
        },
        platformConfig
      );

      expect(result.security.authentication.session.idle_timeout_minutes).toBe(
        60
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].field).toBe(
        'security.authentication.session.idle_timeout_minutes'
      );

      // Tenant tries 30 (below platform 60) → allowed (stricter)
      const { result: r2, violations: v2 } = service.enforceConstraints(
        {
          security: {
            authentication: { session: { idle_timeout_minutes: 30 } },
          },
        },
        platformConfig
      );

      expect(r2.security.authentication.session.idle_timeout_minutes).toBe(30);
      expect(v2).toHaveLength(0);
    });

    it('enforces password_policy.min_length >= platform floor', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            login: { password_policy: { min_length: 10 } },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Tenant tries 6 → enforced to 10 (platform floor)
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: {
              login: { password_policy: { min_length: 6 } },
            },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.login.password_policy.min_length
      ).toBe(10);
      expect(violations.length).toBeGreaterThanOrEqual(1);
    });

    it('enforces absolute min 8 for password_policy.min_length even if platform is lower', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            login: { password_policy: { min_length: 6 } },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Tenant tries 5, platform is 6 → floor enforces 6, then NIST enforces 8
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: {
              login: { password_policy: { min_length: 5 } },
            },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.login.password_policy.min_length
      ).toBe(8);
      expect(
        violations.some(
          v => v.field.includes('min_length') && v.reason.includes('NIST')
        )
      ).toBe(true);
    });

    it('prevents disabling MFA when platform requires it (boolean floor)', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: { enabled: true },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: { multi_factor: { enabled: false } },
          },
        },
        platformConfig
      );

      expect(result.security.authentication.multi_factor.enabled).toBe(true);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toContain('Boolean floor');
    });

    it('allows enabling MFA when platform does not require it', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: { enabled: false },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: { multi_factor: { enabled: true } },
          },
        },
        platformConfig
      );

      expect(result.security.authentication.multi_factor.enabled).toBe(true);
      expect(violations).toHaveLength(0);
    });

    it('handles max_concurrent_sessions where 0=unlimited is exempt', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            session: { max_concurrent_sessions: 0 }, // unlimited
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Platform 0 (unlimited) → any tenant value is valid
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: { session: { max_concurrent_sessions: 5 } },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.session.max_concurrent_sessions
      ).toBe(5);
      expect(violations).toHaveLength(0);
    });

    it('enforces ceiling when platform has limit and tenant sets 0 (unlimited)', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            session: { max_concurrent_sessions: 5 },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Tenant tries 0 (unlimited) when platform limits to 5 → clamped
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: { session: { max_concurrent_sessions: 0 } },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.session.max_concurrent_sessions
      ).toBe(5);
      expect(violations).toHaveLength(1);
    });

    it('handles webauthn.user_verification ordered enum (cannot weaken)', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: {
              webauthn: { user_verification: 'required' },
            },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Cannot weaken from 'required' to 'discouraged'
      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: {
              multi_factor: {
                webauthn: { user_verification: 'discouraged' },
              },
            },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.multi_factor.webauthn.user_verification
      ).toBe('required');
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toContain('Floor');
    });

    it('allows strengthening webauthn.user_verification', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: {
              webauthn: { user_verification: 'discouraged' },
            },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      const { result, violations } = service.enforceConstraints(
        {
          security: {
            authentication: {
              multi_factor: {
                webauthn: { user_verification: 'required' },
              },
            },
          },
        },
        platformConfig
      );

      expect(
        result.security.authentication.multi_factor.webauthn.user_verification
      ).toBe('required');
      expect(violations).toHaveLength(0);
    });

    it('returns violations list with field path and original/adjusted values', () => {
      const platformConfig = makeMockConfigManager({
        security: {
          authentication: {
            multi_factor: { enabled: true },
            session: { idle_timeout_minutes: 60 },
          },
        },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      const { violations } = service.enforceConstraints(
        {
          security: {
            authentication: {
              multi_factor: { enabled: false },
              session: { idle_timeout_minutes: 120 },
            },
          },
        },
        platformConfig
      );

      expect(violations).toHaveLength(2);
      const mfaViolation = violations.find(v =>
        v.field.includes('multi_factor.enabled')
      );
      expect(mfaViolation).toBeDefined();
      expect(mfaViolation!.original).toBe(false);
      expect(mfaViolation!.adjusted).toBe(true);

      const sessionViolation = violations.find(v =>
        v.field.includes('idle_timeout')
      );
      expect(sessionViolation).toBeDefined();
      expect(sessionViolation!.original).toBe(120);
      expect(sessionViolation!.adjusted).toBe(60);
    });

    it('is no-op when platformConfig not provided (graceful degradation)', () => {
      const { service } = makeService();

      const { result, violations } = service.enforceConstraints({
        security: {
          authentication: { multi_factor: { enabled: false } },
        },
      });

      // No enforcement — value unchanged
      expect(result.security.authentication.multi_factor.enabled).toBe(false);
      expect(violations).toHaveLength(0);
    });

    it('enforces oidc.token_ttl ceiling constraints', () => {
      const platformConfig = makeMockConfigManager({
        oidc: { token_ttl: { access_token: 3600 } },
      }).getConfig() as unknown as Record<string, any>;
      const { service } = makeService();

      // Tenant tries 7200 (above platform 3600) → clamped
      const { result, violations } = service.enforceConstraints(
        { oidc: { token_ttl: { access_token: 7200 } } },
        platformConfig
      );

      expect(result.oidc.token_ttl.access_token).toBe(3600);
      expect(violations).toHaveLength(1);
    });

    it('enforces SMS rate_limits ceiling constraints', () => {
      const platformConfig =
        makeMockConfigManager().getConfig() as unknown as Record<string, any>;
      // Platform default: per_phone_per_hour = 5
      const { service } = makeService();

      // Tenant tries 10 (more permissive) → clamped to 5
      const { result, violations } = service.enforceConstraints(
        {
          notifications: {
            channels: { sms: { rate_limits: { per_phone_per_hour: 10 } } },
          },
        },
        platformConfig
      );

      expect(
        result.notifications.channels.sms.rate_limits.per_phone_per_hour
      ).toBe(5);
      expect(violations).toHaveLength(1);
    });
  });

  // ── deleteSection ─────────────────────────────────────────────────────────

  describe('deleteSection()', () => {
    it('returns success when no active override doc exists', async () => {
      const { service } = makeService();

      const result = await service.deleteSection('acme', 'security');

      expect(result).toEqual({ reset: true, section: 'security' });
    });

    it('throws for non-whitelisted section names', async () => {
      const { service } = makeService();

      await expect(service.deleteSection('acme', 'deployment')).rejects.toThrow(
        "Section 'deployment' is not a valid override section"
      );
    });

    it('removes section from override doc and keeps remaining sections', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          application: { title: 'Custom' } as any,
          branding: { companyName: 'Acme' } as any,
        })
      );
      const { service } = makeService(repo);

      await service.deleteSection('acme', 'application', 'admin@acme.com');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          branding: { companyName: 'Acme' },
          application: null, // signals removal
        }),
        expect.objectContaining({
          modifiedBy: 'admin@acme.com',
        })
      );
    });

    it('deactivates override doc when no sections remain after deletion', async () => {
      const repo = makeMockRepo();
      (repo.findActive as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeOverrideDoc({
          security: {
            authentication: {
              multi_factor: { enabled: true },
            },
          } as any,
        })
      );
      const { service } = makeService(repo);

      await service.deleteSection('acme', 'security');

      // Empty object passed = deactivation
      expect(repo.save).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          reason: expect.stringContaining('doc deactivated'),
        })
      );
    });

    it('accepts integrations as a valid section', async () => {
      const { service } = makeService();

      const result = await service.deleteSection('acme', 'integrations');

      expect(result).toEqual({ reset: true, section: 'integrations' });
    });

    it('accepts notifications as a valid section', async () => {
      const { service } = makeService();

      const result = await service.deleteSection('acme', 'notifications');

      expect(result).toEqual({ reset: true, section: 'notifications' });
    });
  });
});
