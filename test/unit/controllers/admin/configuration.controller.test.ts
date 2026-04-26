/**
 * TDD — AdminConfigurationController
 *
 * Verifies:
 * - overview() renders with section info and override indicators
 * - overview() includes notifications section
 * - section() renders the correct template with tenant overrides only (not global config)
 * - section() redirects on invalid section
 * - section() passes token_ttl for oidc section
 * - updateSection() saves overrides and invalidates cache
 * - updateSection() redirects on invalid section
 * - updateSection() sanitizes error messages (no internal detail leakage)
 * - resetSection() deletes section and invalidates cache
 * - testEmail() validates email and sends test
 * - revealSecret() validates field whitelist and decrypts (corrected SMS paths)
 * - Strict tenant context enforcement (no fallback to 'default')
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminConfigurationController } from '../../../../src/controllers/admin/configuration.controller.js';
import type { IConfigManager } from '../../../../src/di/interfaces/config-manager.interface.js';
import type { ITenantSettingsOverrideService } from '../../../../src/di/interfaces/tenant-settings-override-service.interface.js';
import type { ISessionManager } from '../../../../src/di/interfaces/session-manager.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { IEmailService } from '../../../../src/di/interfaces/email-service.interface.js';
import type { IUploadMiddleware } from '../../../../src/di/interfaces/upload-middleware.interface.js';
import type { IPlatformAdminService } from '../../../../src/services/platform-admin.service.js';

// Mock tenantContext to control resolveTenantId() behavior
vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('test-tenant'),
    getTenantIdSafe: vi.fn().mockReturnValue('test-tenant'),
  },
}));

// Mock encryption utils
vi.mock('../../../../src/utils/encryption.js', () => ({
  ensureEncrypted: vi.fn((v: string) => `encrypted:${v}`),
  ensureDecrypted: vi.fn((v: string) => v.replace('encrypted:', '')),
}));

// ── Stubs ────────────────────────────────────────────────────────────────────

function makeMocks() {
  const configManager: IConfigManager = {
    getConfig: vi.fn().mockReturnValue({
      oidc: {
        issuer: 'https://id.example.com',
        path: '/oidc',
        token_ttl: {
          access_token: 3600,
          id_token: 3600,
          refresh_token: 86400,
        },
      },
      deployment: { url: 'https://example.com' },
      security: {
        authentication: {
          multi_factor: {
            enabled: true,
            totp: { enabled: true, issuer_name: 'Platform Corp' },
            email: { enabled: true, code_ttl_seconds: 600 },
            webauthn: {
              enabled: true,
              timeout: 60000,
              user_verification: 'preferred',
              max_credentials_per_user: 10,
            },
          },
          session: {
            idle_timeout_minutes: 30,
            absolute_timeout_hours: 24,
            max_concurrent_sessions: 5,
            max_accounts_per_session: 3,
            bind_ip: false,
            bind_user_agent: false,
            bind_device: false,
            encrypt_session_data: false,
          },
          login: {
            login_methods: ['email', 'username'],
            password_policy: {
              min_length: 8,
              require_uppercase: true,
              require_lowercase: true,
              require_numbers: true,
              require_symbols: false,
              max_age_days: 90,
            },
          },
          signup: {
            signup_methods: ['email'],
            require_email_verification: true,
          },
          roles: {
            default: 'user',
            available: ['user', 'admin', 'superadmin'],
          },
          custom_identifiers: { enabled: false, fields: [] },
          recovery: {
            enabled: true,
            backup_codes: { enabled: true, count: 10, expiry_days: 365 },
          },
        },
        protection: {
          rate_limiting: {
            enabled: true,
            requests_per_minute: 60,
            window_minutes: 1,
          },
          device_matching: {
            min_confidence_score: 70,
            ip_similarity_threshold: 0.8,
            impossible_travel_max_speed_kmh: 1000,
            trust_duration_days: 30,
          },
        },
      },
      branding: {
        companyName: 'Platform Default',
        colors: {
          light: { primary: '#c6785c', background: '#f7f5f0' },
          dark: { primary: '#d4967e', background: '#1a1a1a' },
        },
        fonts: { sans: 'Inter', heading: 'Inter' },
      },
    }),
    getPlatformConfig: vi.fn().mockReturnValue({
      oidc: {
        issuer: 'https://id.example.com',
        path: '/oidc',
        token_ttl: {
          access_token: 3600,
          id_token: 3600,
          refresh_token: 86400,
        },
      },
      deployment: { url: 'https://example.com' },
      security: {
        authentication: {
          multi_factor: {
            enabled: true,
            totp: { enabled: true, issuer_name: 'Platform Corp' },
            email: { enabled: true, code_ttl_seconds: 600 },
            webauthn: {
              enabled: true,
              timeout: 60000,
              user_verification: 'preferred',
              max_credentials_per_user: 10,
            },
          },
          session: {
            idle_timeout_minutes: 30,
            absolute_timeout_hours: 24,
            max_concurrent_sessions: 5,
            max_accounts_per_session: 3,
            bind_ip: false,
            bind_user_agent: false,
            bind_device: false,
            encrypt_session_data: false,
          },
          login: {
            login_methods: ['email', 'username'],
            password_policy: {
              min_length: 8,
              require_uppercase: true,
              require_lowercase: true,
              require_numbers: true,
              require_symbols: false,
              max_age_days: 90,
            },
          },
          signup: {
            signup_methods: ['email'],
            require_email_verification: true,
          },
          roles: {
            default: 'user',
            available: ['user', 'admin', 'superadmin'],
          },
          custom_identifiers: { enabled: false, fields: [] },
          recovery: {
            enabled: true,
            backup_codes: { enabled: true, count: 10, expiry_days: 365 },
          },
        },
        protection: {
          rate_limiting: {
            enabled: true,
            requests_per_minute: 60,
            window_minutes: 1,
          },
          device_matching: {
            min_confidence_score: 70,
            ip_similarity_threshold: 0.8,
            impossible_travel_max_speed_kmh: 1000,
            trust_duration_days: 30,
          },
        },
      },
      branding: {
        companyName: 'Platform Default',
        colors: {
          light: { primary: '#c6785c', background: '#f7f5f0' },
          dark: { primary: '#d4967e', background: '#1a1a1a' },
        },
        fonts: { sans: 'Inter', heading: 'Inter' },
      },
    }),
    invalidateTenantConfig: vi.fn(),
    ensureTenantConfig: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(true),
    load: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as IConfigManager;

  const overrideService: ITenantSettingsOverrideService = {
    loadOverrides: vi.fn().mockResolvedValue(null),
    saveOverrides: vi.fn().mockResolvedValue({ id: 'tso-1' }),
    deleteSection: vi.fn().mockResolvedValue({ reset: true, section: 'test' }),
  } as unknown as ITenantSettingsOverrideService;

  const flashManager = {
    add: vi.fn().mockReturnThis(),
    success: vi.fn().mockReturnThis(),
    error: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warning: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue({}),
    peek: vi.fn().mockReturnValue({}),
    clear: vi.fn().mockReturnThis(),
  };

  const sessionManager: ISessionManager = {
    flash: vi.fn().mockReturnValue(flashManager),
    getActiveUser: vi
      .fn()
      .mockReturnValue({ email: 'admin@test.com', username: 'admin' }),
  } as unknown as ISessionManager;

  const logger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;

  const activityService: IActivityService = {
    success: vi.fn(),
    failed: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  } as unknown as IActivityService;

  const emailService: IEmailService = {
    initialize: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as IEmailService;

  const uploadMiddleware: IUploadMiddleware = {
    storeFile: vi.fn(
      async (file: any, category: string) =>
        `default/${category}/${file.filename}`
    ),
    getFileUrl: vi.fn(
      (key: string) => `/media/file/${key}?expires=9999&sig=abc`
    ),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as IUploadMiddleware;

  const platformAdminService: IPlatformAdminService = {
    getTenantBySlug: vi.fn().mockResolvedValue({
      slug: 'test-tenant',
      display_name: 'Test Tenant',
      domain: undefined,
      issuer_url: undefined,
      status: 'active',
    }),
    listTenants: vi.fn(),
    createTenant: vi.fn(),
    listTenantUsers: vi.fn(),
    updateTenantStatus: vi.fn(),
  } as unknown as IPlatformAdminService;

  return {
    configManager,
    overrideService,
    sessionManager,
    logger,
    activityService,
    emailService,
    uploadMiddleware,
    platformAdminService,
    flashManager,
  };
}

function makeController(mocks?: ReturnType<typeof makeMocks>) {
  const m = mocks ?? makeMocks();
  const controller = new AdminConfigurationController(
    m.configManager,
    m.overrideService,
    m.sessionManager,
    m.logger,
    m.activityService,
    m.emailService,
    m.uploadMiddleware,
    m.platformAdminService
  );
  return { controller, ...m };
}

function makeReq(overrides: Record<string, any> = {}): any {
  return {
    params: {},
    body: {},
    user: { email: 'admin@test.com' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: vi.fn().mockReturnValue('test-user-agent'),
    ...overrides,
  };
}

function makeRes(): any {
  const res: any = {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AdminConfigurationController', () => {
  let tenantContextModule: any;

  beforeEach(async () => {
    tenantContextModule =
      await import('../../../../src/multi-tenancy/tenant-context.js');
    vi.mocked(tenantContextModule.tenantContext.getTenantId).mockReturnValue(
      'test-tenant'
    );
  });

  describe('overview()', () => {
    it('renders overview with section list including notifications', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/overview',
        expect.objectContaining({
          title: 'Configuration',
          activePage: 'configuration',
          sections: expect.arrayContaining([
            expect.objectContaining({
              key: 'application',
              label: 'Application',
            }),
            expect.objectContaining({ key: 'branding', label: 'Branding' }),
            expect.objectContaining({ key: 'security', label: 'Security' }),
            expect.objectContaining({ key: 'features', label: 'Features' }),
            expect.objectContaining({ key: 'oidc', label: 'OIDC' }),
            expect.objectContaining({
              key: 'integrations',
              label: 'Integrations',
            }),
            expect.objectContaining({
              key: 'notifications',
              label: 'Notifications',
            }),
          ]),
        })
      );
    });

    it('notifications section has correct description', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      const sections = (res.render as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .sections;
      const notif = sections.find((s: any) => s.key === 'notifications');
      expect(notif).toBeDefined();
      expect(notif.description).toContain('Notification channels');
    });

    it('shows override indicators when overrides exist', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        application: { title: 'Custom' },
      });
      const { controller } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      const sections = (res.render as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .sections;
      const appSection = sections.find((s: any) => s.key === 'application');
      const brandingSection = sections.find((s: any) => s.key === 'branding');
      expect(appSection.hasOverride).toBe(true);
      expect(brandingSection.hasOverride).toBe(false);
    });

    it('shows hasOverride for notifications when overrides exist', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        notifications: { defaults: { security_alerts: true } },
      });
      const { controller } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      const sections = (res.render as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .sections;
      const notif = sections.find((s: any) => s.key === 'notifications');
      expect(notif.hasOverride).toBe(true);
    });

    it('redirects to /admin when tenant context is missing', async () => {
      vi.mocked(
        tenantContextModule.tenantContext.getTenantId
      ).mockImplementation(() => {
        throw new Error('No ALS context');
      });
      const { controller, flashManager } = makeController();
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Tenant context not available'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin');
    });
  });

  describe('section()', () => {
    it('renders the section template with tenant overrides only (not global config)', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        application: { title: 'Tenant Custom Title' },
      });
      const { controller } = makeController(mocks);
      const req = makeReq({ params: { section: 'application' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/application',
        expect.objectContaining({
          section: 'application',
          sectionLabel: 'Application',
          config: { title: 'Tenant Custom Title' },
          hasOverride: true,
          activePage: 'configuration-application',
        })
      );
    });

    it('shows empty config when no overrides exist (not global config)', async () => {
      const { controller } = makeController();
      const req = makeReq({ params: { section: 'application' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/application',
        expect.objectContaining({
          config: {},
          hasOverride: false,
        })
      );
    });

    it('passes tenant-derived OIDC issuer and token_ttl from platform config for oidc section', async () => {
      const { controller, configManager, platformAdminService } =
        makeController();
      const req = makeReq({ params: { section: 'oidc' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(configManager.getPlatformConfig).toHaveBeenCalled();
      expect(platformAdminService.getTenantBySlug).toHaveBeenCalledWith(
        'test-tenant'
      );
      // Tenant has no issuer_url/domain → subdomain derivation:
      // https://{tenantId}.{baseDomain}{oidcPath}
      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/oidc',
        expect.objectContaining({
          issuer: 'https://test-tenant.example.com/oidc',
          oidcPath: '/oidc',
          deploymentUrl: 'https://example.com',
          platformTokenTtl: {
            access_token: 3600,
            id_token: 3600,
            refresh_token: 86400,
          },
        })
      );
    });

    it('redirects on invalid section', async () => {
      const { controller, flashManager } = makeController();
      const req = makeReq({ params: { section: 'deployment' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Invalid configuration section'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
    });

    it('renders notifications section', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        notifications: { channels: { sms: { enabled: true } } },
      });
      const { controller } = makeController(mocks);
      const req = makeReq({ params: { section: 'notifications' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/notifications',
        expect.objectContaining({
          section: 'notifications',
          sectionLabel: 'Notifications',
          config: { channels: { sms: { enabled: true } } },
          hasOverride: true,
        })
      );
    });

    it('passes platformBranding from global config for branding section', async () => {
      const { controller } = makeController();
      const req = makeReq({ params: { section: 'branding' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/branding',
        expect.objectContaining({
          platformBranding: {
            companyName: 'Platform Default',
            colors: {
              light: { primary: '#c6785c', background: '#f7f5f0' },
              dark: { primary: '#d4967e', background: '#1a1a1a' },
            },
            fonts: { sans: 'Inter', heading: 'Inter' },
          },
        })
      );
    });
  });

  describe('updateSection()', () => {
    it('saves overrides and invalidates tenant config cache', async () => {
      const { controller, overrideService, configManager, flashManager } =
        makeController();
      const req = makeReq({
        params: { section: 'application' },
        body: { _csrf: 'token', title: 'New Title' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(overrideService.saveOverrides).toHaveBeenCalledWith(
        'test-tenant',
        { application: { title: 'New Title' } },
        'admin@test.com',
        'Updated application configuration',
        expect.any(Object)
      );
      expect(configManager.invalidateTenantConfig).toHaveBeenCalledWith(
        'test-tenant'
      );
      expect(flashManager.success).toHaveBeenCalledWith(
        expect.stringContaining('Application')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/configuration/application'
      );
    });

    it('redirects on invalid section', async () => {
      const { controller, flashManager } = makeController();
      const req = makeReq({
        params: { section: 'deployment' },
        body: { _csrf: 'token' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Invalid configuration section'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
    });

    it('logs audit trail on successful update', async () => {
      const { controller, activityService } = makeController();
      const req = makeReq({
        params: { section: 'application' },
        body: { _csrf: 'token', title: 'New Title' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(activityService.success).toHaveBeenCalledWith(
        'update_config',
        'Updated application configuration',
        expect.any(Object),
        expect.objectContaining({
          ip_address: expect.any(String),
          user_agent: expect.any(String),
          target: expect.objectContaining({
            target_type: 'config',
            entity_data: expect.objectContaining({
              action: 'update_section',
              section: 'application',
              tenantId: 'test-tenant',
            }),
          }),
        })
      );
    });

    it('saves notifications section with nested SMS data', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'notifications' },
        body: {
          _csrf: 'token',
          channels: {
            email: { enabled: ['', 'on'] },
            sms: {
              enabled: 'on',
              provider: 'twilio',
              api_key: 'test-key',
              from_number: '+15551234567',
            },
          },
          defaults: { security_alerts: ['', 'on'] },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      // convertNotificationsFormData converts booleans and trims strings
      expect(overrideService.saveOverrides).toHaveBeenCalledWith(
        'test-tenant',
        {
          notifications: {
            channels: {
              email: { enabled: true },
              sms: {
                enabled: true,
                provider: 'twilio',
                api_key: 'test-key',
                from_number: '+15551234567',
              },
            },
            defaults: {
              security_alerts: true,
              new_session_alerts: false,
              allow_user_preferences: false,
            },
          },
        },
        'admin@test.com',
        'Updated notifications configuration',
        expect.any(Object)
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/configuration/notifications'
      );
    });

    it('merges branding form data with existing overrides to preserve logos', async () => {
      const mocks = makeMocks();
      // Existing overrides include a logo uploaded previously
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: {
          logo: '/uploads/acme/logos/logo.png',
          logoDark: '/uploads/acme/logos/logo-dark.png',
          companyName: 'Old Name',
        },
      });
      const { controller, overrideService } = makeController(mocks);
      // Form only sends colors/fonts/companyName — NOT logo fields
      const req = makeReq({
        params: { section: 'branding' },
        body: { _csrf: 'token', companyName: 'New Name' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      // saveOverrides should receive the merged data (logos preserved)
      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.branding.logo).toBe('/uploads/acme/logos/logo.png');
      expect(savedData.branding.logoDark).toBe(
        '/uploads/acme/logos/logo-dark.png'
      );
      expect(savedData.branding.companyName).toBe('New Name');
    });

    it('sanitizes branding form data (colors/fonts) via convertBrandingFormData', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq({
        params: { section: 'branding' },
        body: {
          _csrf: 'token',
          companyName: 'Test Co',
          colors: {
            light: { primary: '#ff0000', background: 'not-a-color' },
            dark: { primary: '#00ff00' },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      // convertBrandingFormData strips invalid colors
      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.branding.colors.light.primary).toBe('#ff0000');
      expect(savedData.branding.colors.light.background).toBeUndefined();
      expect(savedData.branding.colors.dark.primary).toBe('#00ff00');
    });

    it('does not merge existing overrides for non-branding sections', async () => {
      const mocks = makeMocks();
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq({
        params: { section: 'application' },
        body: { _csrf: 'token', title: 'New Title' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      // Should NOT call loadOverrides for non-branding section
      expect(overrideService.loadOverrides).not.toHaveBeenCalled();
    });

    it('sanitizes error messages - does not leak internal detail', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('MongoServerError: duplicate key'));
      const { controller, flashManager } = makeController(mocks);
      const req = makeReq({
        params: { section: 'branding' },
        body: { _csrf: 'token', companyName: 'Fail' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Failed to update configuration. Please try again.'
      );
      expect(flashManager.error).not.toHaveBeenCalledWith(
        expect.stringContaining('MongoServerError')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/configuration/branding'
      );
    });
  });

  describe('resetSection()', () => {
    it('deletes section and invalidates tenant config cache', async () => {
      const { controller, overrideService, configManager, flashManager } =
        makeController();
      const req = makeReq({ params: { section: 'security' } });
      const res = makeRes();

      await controller.resetSection(req, res);

      expect(overrideService.deleteSection).toHaveBeenCalledWith(
        'test-tenant',
        'security'
      );
      expect(configManager.invalidateTenantConfig).toHaveBeenCalledWith(
        'test-tenant'
      );
      expect(flashManager.success).toHaveBeenCalledWith(
        expect.stringContaining('Security')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/configuration/security'
      );
    });

    it('redirects on invalid section', async () => {
      const { controller, flashManager } = makeController();
      const req = makeReq({ params: { section: 'deployment' } });
      const res = makeRes();

      await controller.resetSection(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Invalid configuration section'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
    });

    it('logs audit trail for reset', async () => {
      const { controller, activityService } = makeController();
      const req = makeReq({ params: { section: 'branding' } });
      const res = makeRes();

      await controller.resetSection(req, res);

      expect(activityService.success).toHaveBeenCalledWith(
        'update_config',
        expect.stringContaining('Reset branding'),
        expect.any(Object),
        expect.objectContaining({
          ip_address: expect.any(String),
          user_agent: expect.any(String),
        })
      );
    });
  });

  describe('testEmail()', () => {
    it('returns 400 when email is missing', async () => {
      const { controller } = makeController();
      const req = makeReq({ body: {} });
      const res = makeRes();

      await controller.testEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Email address is required',
        })
      );
    });

    it('returns 400 for invalid email format', async () => {
      const { controller } = makeController();
      const req = makeReq({ body: { email: 'not-an-email' } });
      const res = makeRes();

      await controller.testEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it('returns 400 for email exceeding 254 characters', async () => {
      const { controller } = makeController();
      const longEmail = `${'a'.repeat(250)}@b.com`;
      const req = makeReq({ body: { email: longEmail } });
      const res = makeRes();

      await controller.testEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Email address is too long',
        })
      );
    });

    it('sends test email and returns success', async () => {
      const { controller, emailService, activityService } = makeController();
      const req = makeReq({ body: { email: 'test@example.com' } });
      const res = makeRes();

      await controller.testEmail(req, res);

      expect(emailService.initialize).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('Test Email'),
        expect.any(String),
        expect.any(String)
      );
      expect(activityService.success).toHaveBeenCalledWith(
        'test_email',
        expect.any(String),
        expect.any(Object),
        expect.any(Object)
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('returns 500 when email sending fails', async () => {
      const mocks = makeMocks();
      (
        mocks.emailService.sendEmail as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('SMTP connection refused'));
      const { controller, activityService } = makeController(mocks);
      const req = makeReq({ body: { email: 'test@example.com' } });
      const res = makeRes();

      await controller.testEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to send test email',
        })
      );
      expect(activityService.failed).toHaveBeenCalledWith(
        'test_email',
        expect.any(String),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('revealSecret()', () => {
    it('returns 401 when not authenticated', async () => {
      const mocks = makeMocks();
      (
        mocks.sessionManager.getActiveUser as ReturnType<typeof vi.fn>
      ).mockReturnValue(null);
      const { controller } = makeController(mocks);
      const req = makeReq({
        body: { fieldPath: 'integrations.email.smtp_password' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 400 when fieldPath is missing', async () => {
      const { controller } = makeController();
      const req = makeReq({ body: {} });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Field path is required' })
      );
    });

    it('returns 400 for non-whitelisted field path', async () => {
      const { controller } = makeController();
      const req = makeReq({
        body: { fieldPath: 'application.title' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid field path' })
      );
    });

    it('accepts corrected SMS paths (notifications.channels.sms.*)', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        notifications: {
          channels: { sms: { api_key: 'encrypted:twilio-key' } },
        },
      });
      const { controller } = makeController(mocks);
      const req = makeReq({
        body: { fieldPath: 'notifications.channels.sms.api_key' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          value: 'twilio-key',
        })
      );
    });

    it('rejects old SMS paths (integrations.sms.*)', async () => {
      const { controller } = makeController();
      const req = makeReq({
        body: { fieldPath: 'integrations.sms.api_key' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid field path' })
      );
    });

    it('reveals decrypted value for whitelisted field and logs audit', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        integrations: {
          email: { smtp_password: 'encrypted:my-secret' },
        },
      });
      const { controller, activityService } = makeController(mocks);
      const req = makeReq({
        body: { fieldPath: 'integrations.email.smtp_password' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          value: 'my-secret',
        })
      );
      expect(activityService.warning).toHaveBeenCalledWith(
        'reveal_secret',
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          target: expect.objectContaining({
            entity_data: expect.objectContaining({
              fieldPath: 'integrations.email.smtp_password',
            }),
          }),
        })
      );
    });

    it('returns empty string when override has no value for the field', async () => {
      const { controller } = makeController();
      const req = makeReq({
        body: { fieldPath: 'integrations.email.smtp_password' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, value: '' })
      );
    });

    it('accepts social provider client_secret paths', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        features: {
          social_providers: {
            google: { client_secret: 'encrypted:google-secret-123' },
          },
        },
      });
      const { controller } = makeController(mocks);
      const req = makeReq({
        body: { fieldPath: 'features.social_providers.google.client_secret' },
      });
      const res = makeRes();

      await controller.revealSecret(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          value: 'google-secret-123',
        })
      );
    });
  });

  describe('logo upload/remove (Bug B: tenant path prefix)', () => {
    it('deletes old file when path uses tenant prefix /uploads/{tid}/logos/', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { logo: '/uploads/acme/logos/old-logo.png' },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        file: { filename: 'new-logo.png' },
      });
      const res = makeRes();

      await controller.uploadLogo(req, res);

      expect(uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        '/uploads/acme/logos/old-logo.png'
      );
    });

    it('deletes old file on remove when path uses tenant prefix', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { logo: '/uploads/acme/logos/my-logo.png' },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.removeLogo(req, res);

      expect(uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        '/uploads/acme/logos/my-logo.png'
      );
    });

    it('does not call deleteFile when no existing logo', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ branding: {} });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        file: { filename: 'new-logo.png' },
      });
      const res = makeRes();

      await controller.uploadLogo(req, res);

      expect(uploadMiddleware.deleteFile).not.toHaveBeenCalled();
    });
  });

  // ── Bug 1: Light logo upload in updateSection ────────────────────────────
  describe('updateSection() branding with file upload', () => {
    it('saves storage key when file is uploaded with branding form', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { companyName: 'Acme' },
      });
      const { controller, overrideService, uploadMiddleware } =
        makeController(mocks);
      const req = makeReq({
        params: { section: 'branding' },
        body: { _csrf: 'token', companyName: 'Acme Updated' },
        file: { filename: 'logo-123.png' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.branding.logo).toBe('default/logos/logo-123.png');
      expect(uploadMiddleware.storeFile).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'logo-123.png' }),
        'logos'
      );
    });

    it('deletes old logo when uploading new one via branding form', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: {
          logo: '/uploads/acme/logos/old-logo.png',
          companyName: 'Acme',
        },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        params: { section: 'branding' },
        body: { _csrf: 'token', companyName: 'Acme' },
        file: { filename: 'new-logo.png' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        '/uploads/acme/logos/old-logo.png'
      );
    });

    it('does not delete old logo if there is no existing logo', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { logo: '' },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        params: { section: 'branding' },
        body: { _csrf: 'token', companyName: 'Test' },
        file: { filename: 'new-logo.png' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      // storeFile is called for the new file, but deleteFile is not called since existing logo is empty
      expect(uploadMiddleware.storeFile).toHaveBeenCalled();
      expect(uploadMiddleware.deleteFile).not.toHaveBeenCalled();
    });
  });

  // ── Bug 2: Favicon uses wrong URL/delete methods ────────────────────────
  describe('favicon upload/remove uses correct methods', () => {
    it('uploadFavicon uses storeFile with favicons category', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ branding: {} });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        file: { filename: 'favicon-abc.png' },
      });
      const res = makeRes();

      await controller.uploadFavicon(req, res);

      expect(uploadMiddleware.storeFile).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'favicon-abc.png' }),
        'favicons'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          url: '/media/file/default/favicons/favicon-abc.png?expires=9999&sig=abc',
        })
      );
    });

    it('removeFavicon uses deleteFile for old favicon', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { favicon: '/uploads/acme/favicons/old-favicon.png' },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.removeFavicon(req, res);

      expect(uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        '/uploads/acme/favicons/old-favicon.png'
      );
    });

    it('uploadFavicon deletes old favicon before storing new one', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { favicon: '/uploads/acme/favicons/old-fav.ico' },
      });
      const { controller, uploadMiddleware } = makeController(mocks);
      const req = makeReq({
        file: { filename: 'new-fav.png' },
      });
      const res = makeRes();

      await controller.uploadFavicon(req, res);

      expect(uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        '/uploads/acme/favicons/old-fav.ico'
      );
      expect(uploadMiddleware.storeFile).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'new-fav.png' }),
        'favicons'
      );
    });
  });

  // ── Bug 3: Reset colors/fonts with empty branding ──────────────────────
  describe('resetColors/resetFonts handles empty branding', () => {
    it('resetColors uses deleteSection when branding has only colors', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { colors: { light: { primary: '#ff0000' } } },
      });
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.resetColors(req, res);

      // Should use deleteSection, NOT saveOverrides with empty branding
      expect(overrideService.deleteSection).toHaveBeenCalledWith(
        'test-tenant',
        'branding'
      );
      expect(overrideService.saveOverrides).not.toHaveBeenCalled();
    });

    it('resetFonts uses deleteSection when branding has only fonts', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: { fonts: { heading: 'Roboto' } },
      });
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.resetFonts(req, res);

      expect(overrideService.deleteSection).toHaveBeenCalledWith(
        'test-tenant',
        'branding'
      );
      expect(overrideService.saveOverrides).not.toHaveBeenCalled();
    });

    it('resetColors preserves other branding fields when they exist', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: {
          colors: { light: { primary: '#ff0000' } },
          companyName: 'Acme',
          logo: '/uploads/acme/logos/logo.png',
        },
      });
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.resetColors(req, res);

      // Should save remaining fields, NOT delete entire section
      expect(overrideService.saveOverrides).toHaveBeenCalledWith(
        'test-tenant',
        {
          branding: {
            companyName: 'Acme',
            logo: '/uploads/acme/logos/logo.png',
          },
        },
        'admin@test.com',
        'Reset theme colors to defaults',
        expect.any(Object)
      );
      expect(overrideService.deleteSection).not.toHaveBeenCalled();
    });

    it('resetFonts preserves other branding fields when they exist', async () => {
      const mocks = makeMocks();
      (
        mocks.overrideService.loadOverrides as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        branding: {
          fonts: { heading: 'Roboto' },
          companyName: 'Acme',
        },
      });
      const { controller, overrideService } = makeController(mocks);
      const req = makeReq();
      const res = makeRes();

      await controller.resetFonts(req, res);

      expect(overrideService.saveOverrides).toHaveBeenCalledWith(
        'test-tenant',
        { branding: { companyName: 'Acme' } },
        'admin@test.com',
        'Reset fonts to defaults',
        expect.any(Object)
      );
      expect(overrideService.deleteSection).not.toHaveBeenCalled();
    });
  });

  describe('updateSection() security form data conversion', () => {
    it('passes platformSecurity from global config for security section', async () => {
      const { controller } = makeController();
      const req = makeReq({ params: { section: 'security' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/security',
        expect.objectContaining({
          platformSecurity: expect.objectContaining({
            authentication: expect.objectContaining({
              multi_factor: expect.objectContaining({ enabled: true }),
              session: expect.objectContaining({ idle_timeout_minutes: 30 }),
            }),
            protection: expect.objectContaining({
              device_matching: expect.objectContaining({
                min_confidence_score: 70,
              }),
            }),
          }),
        })
      );
    });

    it('converts security numeric fields before saving', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            login: {
              password_policy: { min_length: '12', max_age_days: '60' },
            },
            session: {
              idle_timeout_minutes: '30',
              absolute_timeout_hours: '12',
            },
            recovery: { backup_codes: { count: '8', expiry_days: '180' } },
          },
          protection: {
            rate_limiting: { requests_per_minute: '30', window_minutes: '5' },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(
        savedData.security.authentication.login.password_policy.min_length
      ).toBe(12);
      expect(
        savedData.security.authentication.login.password_policy.max_age_days
      ).toBe(60);
      expect(
        savedData.security.authentication.session.idle_timeout_minutes
      ).toBe(30);
      expect(
        savedData.security.authentication.session.absolute_timeout_hours
      ).toBe(12);
      expect(
        savedData.security.authentication.recovery.backup_codes.count
      ).toBe(8);
      expect(
        savedData.security.authentication.recovery.backup_codes.expiry_days
      ).toBe(180);
      expect(
        savedData.security.protection.rate_limiting.requests_per_minute
      ).toBe(30);
      expect(savedData.security.protection.rate_limiting.window_minutes).toBe(
        5
      );
    });

    it('splits textarea arrays (high_risk_countries, domains_whitelist)', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          protection: { high_risk_countries: 'KP\nIR\nSY' },
          authentication: {
            signup: {
              auto_approval: { domains_whitelist: 'acme.com\nexample.org' },
            },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.security.protection.high_risk_countries).toEqual([
        'KP',
        'IR',
        'SY',
      ]);
      expect(
        savedData.security.authentication.signup.auto_approval.domains_whitelist
      ).toEqual(['acme.com', 'example.org']);
    });

    it('converts login_methods/signup_methods single value to array', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            login: { login_methods: 'email+password' },
            signup: { signup_methods: 'phone+password' },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.security.authentication.login.login_methods).toEqual([
        'email+password',
      ]);
      expect(savedData.security.authentication.signup.signup_methods).toEqual([
        'phone+password',
      ]);
    });

    it('normalizes invalid method values and falls back to email+password', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            login: { login_methods: ['username', ''] },
            signup: { signup_methods: 'invalid_value' },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(savedData.security.authentication.login.login_methods).toEqual([
        'email+password',
      ]);
      expect(savedData.security.authentication.signup.signup_methods).toEqual([
        'email+password',
      ]);
    });

    it('saves session security fields with numeric conversion', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            session: {
              new_device_2fa_method: 'totp',
              new_device_confidence_threshold: '75',
              max_concurrent_sessions: '3',
              max_accounts_per_session: '2',
            },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(
        savedData.security.authentication.session.new_device_2fa_method
      ).toBe('totp');
      expect(
        savedData.security.authentication.session
          .new_device_confidence_threshold
      ).toBe(75);
      expect(
        savedData.security.authentication.session.max_concurrent_sessions
      ).toBe(3);
      expect(
        savedData.security.authentication.session.max_accounts_per_session
      ).toBe(2);
    });

    it('saves custom_identifiers object', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            custom_identifiers: {
              enabled: 'on',
              fields: [
                {
                  slot: '1',
                  key: 'employee_id',
                  name: 'Employee ID',
                  hint_for_user: 'Enter your employee ID',
                  validation_type: 'regex',
                  pattern: '^EMP\\d{4}$',
                },
              ],
            },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(
        savedData.security.authentication.custom_identifiers.fields[0].name
      ).toBe('Employee ID');
      expect(
        savedData.security.authentication.custom_identifiers.fields[0]
          .hint_for_user
      ).toBe('Enter your employee ID');
      expect(
        savedData.security.authentication.custom_identifiers.fields[0].pattern
      ).toBe('^EMP\\d{4}$');
    });

    it('saves signup contact_channels and recovery methods', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            signup: {
              contact_channels: {
                require_at_least_one: 'on',
                email: { enabled: 'on', required: 'on' },
                phone: { enabled: 'on' },
              },
            },
            recovery: {
              enabled: 'on',
              secondary_email: { enabled: 'on' },
              sms: { enabled: 'on' },
            },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      // convertSecurityFormData converts 'on' → true via convertBooleanFields
      expect(
        savedData.security.authentication.signup.contact_channels.email.enabled
      ).toBe(true);
      expect(
        savedData.security.authentication.signup.contact_channels.phone.enabled
      ).toBe(true);
      expect(
        savedData.security.authentication.recovery.secondary_email.enabled
      ).toBe(true);
      expect(savedData.security.authentication.recovery.sms.enabled).toBe(true);
    });

    it('converts floor-constraint boolean fields to proper booleans', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: {
            session: {
              require_2fa_for_new_device: 'on',
              bind_ip: 'on',
              encrypt_session_data: 'on',
            },
          },
          protection: {
            encrypt_device_data: 'on',
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(
        savedData.security.authentication.session.require_2fa_for_new_device
      ).toBe(true);
      expect(savedData.security.authentication.session.bind_ip).toBe(true);
      expect(
        savedData.security.authentication.session.encrypt_session_data
      ).toBe(true);
      expect(savedData.security.protection.encrypt_device_data).toBe(true);
    });

    it('converts device_matching numeric fields', async () => {
      const { controller, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          protection: {
            device_matching: {
              min_confidence_score: '80',
              ip_similarity_threshold: '0.7',
              impossible_travel_max_speed_kmh: '900',
              trust_duration_days: '14',
            },
          },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      const savedData = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      const dm = savedData.security.protection.device_matching;
      expect(dm.min_confidence_score).toBe(80);
      expect(dm.ip_similarity_threshold).toBe(0.7); // parseFloat, not parseInt
      expect(dm.impossible_travel_max_speed_kmh).toBe(900);
      expect(dm.trust_duration_days).toBe(14);
    });
  });

  describe('getPlatformConfig usage', () => {
    it('uses getPlatformConfig (not getConfig) for platformSecurity in section()', async () => {
      const { controller, configManager } = makeController();
      const req = makeReq({ params: { section: 'security' } });
      const res = makeRes();

      await controller.section(req, res);

      expect(configManager.getPlatformConfig).toHaveBeenCalled();
      // Verify platformSecurity comes from getPlatformConfig
      expect(res.render).toHaveBeenCalledWith(
        'admin/configuration/security',
        expect.objectContaining({
          platformSecurity: expect.objectContaining({
            authentication: expect.objectContaining({
              session: expect.objectContaining({ bind_ip: false }),
            }),
          }),
        })
      );
    });

    it('uses getPlatformConfig for platformConfig in updateSection()', async () => {
      const { controller, configManager, overrideService } = makeController();
      const req = makeReq({
        params: { section: 'security' },
        body: {
          _csrf: 'token',
          authentication: { session: { bind_ip: 'on' } },
        },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(configManager.getPlatformConfig).toHaveBeenCalled();
      // Verify saveOverrides receives the platform config (from getPlatformConfig)
      const platformConfigArg = (
        overrideService.saveOverrides as ReturnType<typeof vi.fn>
      ).mock.calls[0][4];
      expect(platformConfigArg.security.authentication.session.bind_ip).toBe(
        false
      );
    });
  });

  describe('strict tenant context enforcement', () => {
    it('updateSection redirects when tenant context is missing', async () => {
      vi.mocked(
        tenantContextModule.tenantContext.getTenantId
      ).mockImplementation(() => {
        throw new Error('No ALS context');
      });
      const { controller, flashManager } = makeController();
      const req = makeReq({
        params: { section: 'application' },
        body: { _csrf: 'token', title: 'Test' },
      });
      const res = makeRes();

      await controller.updateSection(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Tenant context not available'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
    });

    it('resetSection redirects when tenant context is missing', async () => {
      vi.mocked(
        tenantContextModule.tenantContext.getTenantId
      ).mockImplementation(() => {
        throw new Error('No ALS context');
      });
      const { controller, flashManager } = makeController();
      const req = makeReq({ params: { section: 'security' } });
      const res = makeRes();

      await controller.resetSection(req, res);

      expect(flashManager.error).toHaveBeenCalledWith(
        'Tenant context not available'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
    });
  });
});
