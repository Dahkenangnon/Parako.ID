import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const redisMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  ping: vi.fn().mockResolvedValue('PONG'),
  quit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
  unmanaged: () => () => undefined,
}));

vi.mock('ioredis', () => ({
  Redis: function MockRedis(...args: unknown[]) {
    redisMocks.constructor(...args);
    return {
      connect: redisMocks.connect,
      ping: redisMocks.ping,
      quit: redisMocks.quit,
    };
  },
}));

import { AdminSettingsController } from '../../../../src/controllers/admin/settings.controller.js';
import { maskSensitiveValue } from '../../../../src/utils/settings.helper.js';

function uploadedFile(filename: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: 0,
    destination: '',
    filename,
    path: '',
    buffer: Buffer.alloc(0),
    stream: null as never,
  };
}

function createMockDeps() {
  const flash = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  const config = {
    application: { name: 'Parako.ID' },
    branding: {},
    deployment: { url: 'https://id.example.com' },
    security: {},
    features: {},
    oidc: { issuer: 'https://id.example.com/oidc/v1' },
    integrations: {},
    notifications: {},
  };

  return {
    config,
    configManager: {
      getPlatformConfig: vi.fn().mockReturnValue(config),
      update: vi.fn().mockResolvedValue(config),
      reload: vi.fn().mockResolvedValue(config),
      isLoaded: vi.fn().mockReturnValue(true),
      isUsingFileConfig: vi.fn().mockReturnValue(false),
    },
    sessionManager: {
      flash: vi.fn().mockReturnValue(flash),
      getActiveUser: vi.fn().mockReturnValue({
        id: 'admin-1',
        username: 'admin',
        email: 'admin@example.com',
      }),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    emailService: {
      initialize: vi.fn(),
      sendEmail: vi.fn().mockResolvedValue(undefined),
      connectToEmailServer: vi.fn().mockResolvedValue(true),
    },
    activityService: {
      success: vi.fn(),
      failed: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
    settingsService: {
      findMany: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      saveMainConfiguration: vi.fn(),
      generateConfigDiff: vi.fn().mockReturnValue([]),
      analyzeConfigImpact: vi.fn().mockReturnValue({}),
      loadAndDecryptConfiguration: vi.fn(),
    },
    uploadMiddleware: {
      storeFile: vi.fn(),
      deleteFile: vi.fn(),
    },
    clientDeviceInfoManager: {
      getClientInfoFromRequest: vi.fn().mockReturnValue({
        ip: '127.0.0.1',
        user_agent: 'vitest',
      }),
    },
    flash,
  };
}

function createController(deps: ReturnType<typeof createMockDeps>) {
  return new (AdminSettingsController as any)(
    deps.configManager,
    deps.sessionManager,
    deps.logger,
    deps.emailService,
    deps.activityService,
    deps.settingsService,
    deps.uploadMiddleware,
    deps.clientDeviceInfoManager
  ) as AdminSettingsController;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    body: {},
    query: {},
    params: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: vi.fn().mockReturnValue('vitest'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe('AdminSettingsController', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminSettingsController;

  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.ping.mockResolvedValue('PONG');
    redisMocks.quit.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );
    deps = createMockDeps();
    controller = createController(deps);
  });

  it.each([
    'application',
    'branding',
    'deployment',
    'features',
    'oidc',
    'integrations',
  ] as const)('%s rejects unsupported HTTP methods', async methodName => {
    const res = makeRes();

    await controller[methodName](makeReq({ method: 'PUT' }), res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(deps.configManager.update).not.toHaveBeenCalled();
  });

  describe('overview()', () => {
    it('renders section status and the active configuration version', async () => {
      const versions = [
        { version: '1.1.0', _version: 2, is_active: false },
        { version: '1.0.0', _version: 1, is_active: true },
      ];
      deps.settingsService.findMany.mockResolvedValue(versions);
      const res = makeRes();

      await controller.overview(makeReq(), res);

      expect(deps.settingsService.findMany).toHaveBeenCalledWith(
        { key: 'parako_config' },
        { sort: { created_at: -1 }, limit: 10 }
      );
      expect(res.render).toHaveBeenCalledWith(
        'admin/settings/overview',
        expect.objectContaining({
          config: deps.config,
          currentVersion: '1.0.0',
          currentVersionNum: 1,
          versionHistory: versions,
          isUsingFileConfig: false,
          sections: expect.arrayContaining([
            expect.objectContaining({ key: 'application' }),
            expect.objectContaining({ key: 'integrations' }),
          ]),
        })
      );
    });

    it('falls back to the newest version and then defaults when history is empty', async () => {
      const res = makeRes();
      deps.settingsService.findMany.mockResolvedValueOnce([
        { version: '2.0.0', _version: 8, is_active: false },
      ]);

      await controller.overview(makeReq(), res);
      expect(res.render).toHaveBeenLastCalledWith(
        'admin/settings/overview',
        expect.objectContaining({
          currentVersion: '2.0.0',
          currentVersionNum: 8,
        })
      );

      deps.settingsService.findMany.mockResolvedValueOnce([]);
      await controller.overview(makeReq(), res);
      expect(res.render).toHaveBeenLastCalledWith(
        'admin/settings/overview',
        expect.objectContaining({
          currentVersion: '1.0.0',
          currentVersionNum: 0,
        })
      );
    });

    it('flashes and redirects when version history cannot be loaded', async () => {
      deps.settingsService.findMany.mockRejectedValue(new Error('offline'));
      const req = makeReq();
      const res = makeRes();

      await controller.overview(req, res);

      expect(deps.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'settings_overview_loading_failed',
      });
      expect(deps.flash.error).toHaveBeenCalledWith(
        'Failed to load settings overview'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin');
    });
  });

  describe('application()', () => {
    it('renders the application section', async () => {
      const res = makeRes();

      await controller.application(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/application', {
        title: 'Application Settings',
        section: 'application',
        config: deps.config.application,
      });
    });

    it('merges and persists submitted application settings', async () => {
      const req = makeReq({ method: 'POST', body: { name: 'Updated ID' } });
      const res = makeRes();

      await controller.application(req, res);

      expect(deps.configManager.update).toHaveBeenCalledWith({
        application: { name: 'Updated ID' },
      });
      expect(deps.activityService.success).toHaveBeenCalled();
      expect(deps.flash.success).toHaveBeenCalledWith(
        'Application settings updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings/application');
    });

    it('creates application settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        application: undefined,
      });

      await controller.application(
        makeReq({ method: 'POST', body: { name: 'First name' } }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        application: { name: 'First name' },
      });
    });

    it.each([new Error('write failed'), 'write failed'])(
      'handles application update failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const req = makeReq({ method: 'POST', body: { name: 'Updated ID' } });
        const res = makeRes();

        await controller.application(req, res);

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update application settings'
        );
        expect(res.redirect).toHaveBeenCalledWith(
          '/admin/settings/application'
        );
      }
    );
  });

  describe('branding()', () => {
    it('renders the branding section', async () => {
      const res = makeRes();

      await controller.branding(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/branding', {
        title: 'Branding Settings',
        section: 'branding',
        config: deps.config.branding,
      });
    });

    it('preserves the current logo when no replacement file is submitted', async () => {
      (deps.config.branding as Record<string, unknown>).logo =
        'logos/current.png';
      const req = makeReq({
        method: 'POST',
        body: { companyName: 'Updated Company' },
      });
      const res = makeRes();

      await controller.branding(req, res);

      expect(deps.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(deps.configManager.update).toHaveBeenCalledWith({
        branding: expect.objectContaining({
          companyName: 'Updated Company',
          logo: 'logos/current.png',
        }),
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings/branding');
    });

    it('creates branding settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        branding: undefined,
      });

      await controller.branding(
        makeReq({ method: 'POST', body: { companyName: 'First brand' } }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        branding: expect.objectContaining({ companyName: 'First brand' }),
      });
    });

    it.each([true, false])(
      'stores an uploaded logo and handles existing-logo=%s',
      async hasExistingLogo => {
        (deps.config.branding as Record<string, unknown>).logo = hasExistingLogo
          ? 'logos/old.png'
          : undefined;
        deps.uploadMiddleware.storeFile.mockResolvedValue('logos/new.png');
        const req = makeReq({
          method: 'POST',
          body: { companyName: 'Updated Company' },
        });
        req.file = uploadedFile('new.png');
        const res = makeRes();

        await controller.branding(req, res);

        expect(deps.uploadMiddleware.storeFile).toHaveBeenCalledWith(
          req.file,
          'logos'
        );
        expect(deps.uploadMiddleware.deleteFile).toHaveBeenCalledTimes(
          hasExistingLogo ? 1 : 0
        );
        expect(deps.configManager.update).toHaveBeenCalledWith({
          branding: expect.objectContaining({ logo: 'logos/new.png' }),
        });
      }
    );

    it.each([new Error('upload failed'), 'upload failed'])(
      'handles branding update failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.branding(
          makeReq({ method: 'POST', body: { companyName: 'Updated' } }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update branding settings'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings/branding');
      }
    );
  });

  describe('branding asset actions', () => {
    const uploads = [
      ['uploadLogoDark', 'logoDark', 'logos', 'dark.png'],
      ['uploadLogoIcon', 'logoIcon', 'logos', 'icon.png'],
      ['uploadLogoIconDark', 'logoIconDark', 'logos', 'icon-dark.png'],
      ['uploadFavicon', 'favicon', 'favicons', 'favicon.ico'],
    ] as const;

    it.each(uploads)('%s rejects a request without a file', async method => {
      const res = makeRes();

      await (controller[method] as any)(makeReq({ method: 'POST' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'No file uploaded' });
      expect(deps.configManager.update).not.toHaveBeenCalled();
    });

    it.each(uploads)(
      '%s stores the new asset and removes an existing one',
      async (method, field, folder, filename) => {
        (deps.config.branding as Record<string, unknown>)[field] =
          `${folder}/old`;
        deps.uploadMiddleware.storeFile.mockResolvedValue(
          `${folder}/${filename}`
        );
        const req = makeReq({ method: 'POST' });
        req.file = uploadedFile(filename);
        const res = makeRes();

        await (controller[method] as any)(req, res);

        expect(deps.uploadMiddleware.storeFile).toHaveBeenCalledWith(
          req.file,
          folder
        );
        expect(deps.uploadMiddleware.deleteFile).toHaveBeenCalledWith(
          `${folder}/old`
        );
        expect(deps.configManager.update).toHaveBeenCalledWith({
          branding: expect.objectContaining({
            [field]: `${folder}/${filename}`,
          }),
        });
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            url: `${folder}/${filename}`,
          })
        );
      }
    );

    it.each(uploads)(
      '%s stores the first asset without deleting a predecessor',
      async (method, field, folder, filename) => {
        delete (deps.config.branding as Record<string, unknown>)[field];
        deps.uploadMiddleware.storeFile.mockResolvedValue(
          `${folder}/${filename}`
        );
        const req = makeReq({ method: 'POST' });
        req.file = uploadedFile(filename);

        await (controller[method] as any)(req, makeRes());

        expect(deps.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      }
    );

    it.each(uploads)(
      '%s returns a server error when storage fails',
      async (method, _field, _folder, filename) => {
        deps.uploadMiddleware.storeFile.mockRejectedValue(
          new Error('storage failed')
        );
        const req = makeReq({ method: 'POST' });
        req.file = uploadedFile(filename);
        const res = makeRes();

        await (controller[method] as any)(req, res);

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
      }
    );

    const removals = [
      ['removeLogo', 'logo', ''],
      ['removeLogoDark', 'logoDark', null],
      ['removeLogoIcon', 'logoIcon', null],
      ['removeLogoIconDark', 'logoIconDark', null],
      ['removeFavicon', 'favicon', null],
    ] as const;

    it.each(removals)(
      '%s removes an existing asset and clears its setting',
      async (method, field, clearedValue) => {
        (deps.config.branding as Record<string, unknown>)[field] =
          `assets/${field}`;
        const res = makeRes();

        await (controller[method] as any)(makeReq({ method: 'POST' }), res);

        expect(deps.uploadMiddleware.deleteFile).toHaveBeenCalledWith(
          `assets/${field}`
        );
        expect(deps.configManager.update).toHaveBeenCalledWith({
          branding: expect.objectContaining({ [field]: clearedValue }),
        });
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      }
    );

    it.each(removals)(
      '%s clears a missing asset without calling storage deletion',
      async (method, field) => {
        delete (deps.config.branding as Record<string, unknown>)[field];

        await (controller[method] as any)(
          makeReq({ method: 'POST' }),
          makeRes()
        );

        expect(deps.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      }
    );

    it.each(removals)(
      '%s returns a server error when configuration persistence fails',
      async method => {
        deps.configManager.update.mockRejectedValue(new Error('write failed'));
        const res = makeRes();

        await (controller[method] as any)(makeReq({ method: 'POST' }), res);

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
      }
    );

    it.each([
      ['resetColors', 'colors'],
      ['resetFonts', 'fonts'],
    ] as const)(
      '%s restores the default branding %s',
      async (method, field) => {
        const res = makeRes();

        await (controller[method] as any)(makeReq({ method: 'POST' }), res);

        expect(deps.configManager.update).toHaveBeenCalledWith({
          branding: expect.objectContaining({ [field]: expect.any(Object) }),
        });
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      }
    );

    it.each(['resetColors', 'resetFonts'] as const)(
      '%s returns a server error when reset persistence fails',
      async method => {
        deps.configManager.update.mockRejectedValue(new Error('write failed'));
        const res = makeRes();

        await controller[method](makeReq({ method: 'POST' }), res);

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
      }
    );
  });

  describe('deployment()', () => {
    it('renders deployment settings', async () => {
      const res = makeRes();

      await controller.deployment(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/deployment', {
        title: 'Deployment Settings',
        section: 'deployment',
        config: deps.config.deployment,
      });
    });

    it('strips bootstrap-only fields and warns the admin', async () => {
      const req = makeReq({
        method: 'POST',
        body: {
          environment: 'development',
          url: 'https://new.example.com',
          server: { port: '9999' },
        },
      });
      const res = makeRes();

      await controller.deployment(req, res);

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Bootstrap fields detected in deployment update',
        expect.objectContaining({
          removedFields: expect.arrayContaining([
            'deployment.environment',
            'deployment.server.port',
          ]),
        })
      );
      expect(deps.flash.warning).toHaveBeenCalled();
      expect(deps.configManager.update).toHaveBeenCalledWith({
        deployment: expect.not.objectContaining({ environment: 'development' }),
      });
      expect(
        (deps.configManager.update.mock.calls[0][0] as any).deployment.server
      ).not.toHaveProperty('port');
    });

    it('persists ordinary deployment fields without a bootstrap warning', async () => {
      const res = makeRes();

      await controller.deployment(
        makeReq({ method: 'POST', body: { url: 'https://new.example.com' } }),
        res
      );

      expect(deps.flash.warning).not.toHaveBeenCalled();
      expect(deps.configManager.update).toHaveBeenCalledWith({
        deployment: { url: 'https://new.example.com' },
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings/deployment');
    });

    it('creates deployment settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        deployment: undefined,
      });

      await controller.deployment(
        makeReq({ method: 'POST', body: { url: 'https://first.example.com' } }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        deployment: { url: 'https://first.example.com' },
      });
    });

    it.each([new Error('write failed'), 'write failed'])(
      'handles deployment update failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.deployment(
          makeReq({ method: 'POST', body: { url: 'https://new.example.com' } }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update deployment settings'
        );
      }
    );
  });

  describe('security section pages', () => {
    const pages = [
      [
        'securityAuthentication',
        'admin/settings/security',
        'Authentication & Access',
        'authentication',
        '/admin/settings/security',
      ],
      [
        'securityMfa',
        'admin/settings/security-mfa',
        'Multi-Factor Authentication',
        'mfa',
        '/admin/settings/security/mfa',
      ],
      [
        'securitySessions',
        'admin/settings/security-sessions',
        'Session Management',
        'sessions',
        '/admin/settings/security/sessions',
      ],
      [
        'securityProtection',
        'admin/settings/security-protection',
        'Protection & Detection',
        'protection',
        '/admin/settings/security/protection',
      ],
      [
        'securitySecrets',
        'admin/settings/security-secrets',
        'Security Secrets',
        'secrets',
        '/admin/settings/security/secrets',
      ],
    ] as const;

    it.each(pages)(
      '%s renders masked security configuration',
      async (method, view, title, tab) => {
        (deps.config.security as any).secrets = {
          jwt_secret: 'super-secret-value-that-is-at-least-32-characters',
        };
        const res = makeRes();

        await controller[method](makeReq(), res);

        expect(res.render).toHaveBeenCalledWith(view, {
          title,
          section: 'security',
          securityTab: tab,
          config: expect.objectContaining({
            secrets: expect.objectContaining({
              jwt_secret: expect.stringContaining('*'),
            }),
          }),
        });
      }
    );

    it('renders an empty security section when it is not configured', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        security: undefined,
      });
      const res = makeRes();

      await controller.securityAuthentication(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/settings/security',
        expect.objectContaining({ config: {} })
      );
    });

    it.each(pages)(
      '%s persists a valid security update',
      async (method, _view, _title, _tab, redirect) => {
        const res = makeRes();

        await controller[method](
          makeReq({
            method: 'POST',
            body: { protection: { trusted_domains: 'example.com' } },
          }),
          res
        );

        expect(deps.configManager.update).toHaveBeenCalledWith({
          security: expect.objectContaining({
            protection: { trusted_domains: ['example.com'] },
          }),
        });
        expect(deps.activityService.success).toHaveBeenCalled();
        expect(deps.flash.success).toHaveBeenCalledWith(
          'Security settings updated successfully'
        );
        expect(res.redirect).toHaveBeenCalledWith(redirect);
      }
    );

    it('restores masked secrets before persisting a security update', async () => {
      const actualSecret = 'super-secret-value-that-is-at-least-32-characters';
      (deps.config.security as any).secrets = { jwt_secret: actualSecret };
      const res = makeRes();

      await controller.securitySecrets(
        makeReq({
          method: 'POST',
          body: {
            secrets: { jwt_secret: maskSensitiveValue(actualSecret) },
          },
        }),
        res
      );

      expect(deps.flash.error.mock.calls).toEqual([]);
      expect(deps.configManager.update).toHaveBeenCalledWith({
        security: expect.objectContaining({
          secrets: { jwt_secret: actualSecret },
        }),
      });
    });

    it.each([
      [
        { secrets: { jwt_secret: 'too-short' } },
        ['JWT secret must be at least 32 characters long for security'],
      ],
      [
        { secrets: { cookie_secrets: { invalid: true } } },
        [
          'Cookie secrets must be an array or newline-separated string',
          'At least one cookie secret is required',
        ],
      ],
      [
        { secrets: { cookie_secrets: 'short' } },
        ['All cookie secrets must be at least 32 characters long'],
      ],
      [
        {
          authentication: {
            multi_factor: {
              totp: { enabled: true },
              webauthn: { enabled: true },
            },
          },
        },
        [
          'TOTP issuer name is required when TOTP is enabled',
          'WebAuthn Relying Party ID is required when WebAuthn is enabled',
          'WebAuthn Relying Party name is required when WebAuthn is enabled',
        ],
      ],
    ])('rejects invalid security payload %#', async (body, errors) => {
      const res = makeRes();

      await controller.securitySecrets(makeReq({ method: 'POST', body }), res);

      for (const error of errors) {
        expect(deps.flash.error).toHaveBeenCalledWith(error);
      }
      expect(deps.configManager.update).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/settings/security/secrets'
      );
    });

    it('accepts complete MFA settings without validation errors', async () => {
      await controller.securityMfa(
        makeReq({
          method: 'POST',
          body: {
            authentication: {
              multi_factor: {
                totp: { enabled: true, issuer_name: 'Parako.ID' },
                webauthn: {
                  enabled: true,
                  rp_id: 'id.example.com',
                  rp_name: 'Parako.ID',
                },
              },
            },
          },
        }),
        makeRes()
      );

      expect(deps.flash.error).not.toHaveBeenCalled();
      expect(deps.configManager.update).toHaveBeenCalledOnce();
    });

    it('creates security settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        security: undefined,
      });

      await controller.securityProtection(
        makeReq({
          method: 'POST',
          body: { protection: { trusted_domains: 'example.com' } },
        }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        security: expect.objectContaining({
          protection: { trusted_domains: ['example.com'] },
        }),
      });
    });

    it.each(pages)(
      '%s handles persistence failure',
      async (method, _view, _title, _tab, redirect) => {
        deps.configManager.update.mockRejectedValue(new Error('write failed'));
        const res = makeRes();

        await controller[method](
          makeReq({ method: 'POST', body: { protection: {} } }),
          res
        );

        expect(deps.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'security_settings_update_failed',
        });
        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update security settings'
        );
        expect(res.redirect).toHaveBeenCalledWith(redirect);
      }
    );

    it('records a non-Error security persistence failure without leaking it', async () => {
      deps.configManager.update.mockRejectedValue('write failed');

      await controller.securityAuthentication(
        makeReq({ method: 'POST', body: { protection: {} } }),
        makeRes()
      );

      expect(deps.activityService.failed).toHaveBeenCalledWith(
        'update_config',
        'Failed to update security configuration',
        expect.anything(),
        expect.objectContaining({
          target: expect.objectContaining({
            entity_data: { error: 'Unknown error' },
          }),
        })
      );
    });
  });

  describe('features()', () => {
    it('renders masked feature settings', async () => {
      (deps.config.features as any).social_providers = {
        google: { client_secret: 'google-secret-value' },
      };
      const res = makeRes();

      await controller.features(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/features', {
        title: 'Features Settings',
        section: 'features',
        config: expect.objectContaining({
          social_providers: expect.objectContaining({
            google: { client_secret: expect.stringContaining('*') },
          }),
        }),
      });
    });

    it.each([false, true])(
      'persists feature settings with restored-sensitive-fields=%s',
      async restoreSecret => {
        const actualSecret = 'google-secret-value';
        (deps.config.features as any).social_providers = {
          google: { client_secret: actualSecret },
        };
        const body = restoreSecret
          ? {
              social_providers: {
                google: { client_secret: 'goog*************' },
              },
            }
          : { oidc: { scopes: 'openid\nemail' } };
        const res = makeRes();

        await controller.features(makeReq({ method: 'POST', body }), res);

        expect(deps.configManager.update).toHaveBeenCalledWith({
          features: expect.any(Object),
        });
        expect(deps.logger.info).toHaveBeenCalledTimes(restoreSecret ? 1 : 0);
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings/features');
      }
    );

    it('creates feature settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        features: undefined,
      });

      await controller.features(
        makeReq({ method: 'POST', body: { oidc: { scopes: 'openid' } } }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        features: expect.any(Object),
      });
    });

    it.each([new Error('write failed'), 'write failed'])(
      'handles feature update failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.features(
          makeReq({ method: 'POST', body: { oidc: {} } }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update features settings'
        );
      }
    );
  });

  describe('oidc()', () => {
    it('renders masked OIDC settings with the deployment URL', async () => {
      const res = makeRes();

      await controller.oidc(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/oidc', {
        title: 'OIDC Settings',
        section: 'oidc',
        config: deps.config.oidc,
        deploymentUrl: 'https://id.example.com',
      });
    });

    it('renders an empty deployment URL when deployment is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        deployment: {},
      });
      const res = makeRes();

      await controller.oidc(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/settings/oidc',
        expect.objectContaining({ deploymentUrl: '' })
      );
    });

    it.each([false, true])(
      'persists OIDC settings with restored-sensitive-fields=%s',
      async restoreSecret => {
        (deps.config.oidc as any).secrets = { pairwise_salt: 'actual-salt' };
        const body = restoreSecret
          ? { oidc: { secrets: { pairwise_salt: 'actu********' } } }
          : { oidc: { token_ttl: { access_token: '3600' } } };
        const res = makeRes();

        await controller.oidc(makeReq({ method: 'POST', body }), res);

        expect(deps.configManager.update).toHaveBeenCalledWith({
          oidc: expect.any(Object),
        });
        expect(deps.flash.success).toHaveBeenCalledWith(
          'OIDC settings updated successfully'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings/oidc');
      }
    );

    it('creates OIDC settings when the section is absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: undefined,
      });

      await controller.oidc(
        makeReq({
          method: 'POST',
          body: { oidc: { token_ttl: { access_token: '3600' } } },
        }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith({
        oidc: expect.any(Object),
      });
    });

    it.each([new Error('write failed'), 'write failed'])(
      'handles an OIDC persistence failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.oidc(
          makeReq({ method: 'POST', body: { oidc: {} } }),
          res
        );

        expect(deps.flash.error).toHaveBeenCalledWith(
          `Failed to update OIDC settings: ${
            failure instanceof Error ? failure.message : 'Unknown error'
          }`
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings/oidc');
      }
    );

    it.each([new Error('load failed'), 'load failed'])(
      'handles an outer OIDC request failure %#',
      async failure => {
        deps.configManager.getPlatformConfig.mockImplementation(() => {
          throw failure;
        });
        const res = makeRes();

        await controller.oidc(makeReq(), res);

        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update OIDC settings'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings/oidc');
      }
    );
  });

  describe('integrations()', () => {
    it('renders integration and notification defaults safely', async () => {
      const res = makeRes();

      await controller.integrations(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/settings/integrations',
        expect.objectContaining({
          config: expect.objectContaining({
            notifications: {
              channels: {
                email: { enabled: true },
                sms: {
                  enabled: false,
                  provider: undefined,
                  api_key: undefined,
                  api_secret: undefined,
                },
              },
              defaults: {
                security_alerts: true,
                new_session_alerts: true,
                allow_user_preferences: true,
              },
            },
          }),
        })
      );
    });

    it.each([false, true])(
      'persists integration settings with notifications=%s',
      async withNotifications => {
        const body: any = {
          integrations: {
            email: { smtp_host: 'smtp.example.com', smtp_port: '587' },
            urls: { support: 'https://example.com/support' },
          },
        };
        if (withNotifications) {
          body.notifications = {
            channels: { email: { enabled: 'on' }, sms: {} },
            defaults: { security_alerts: 'on' },
          };
        }
        const res = makeRes();

        await controller.integrations(makeReq({ method: 'POST', body }), res);

        expect(deps.configManager.update).toHaveBeenCalledWith(
          expect.objectContaining({
            integrations: expect.objectContaining({
              email: expect.objectContaining({ smtp_port: 587 }),
              urls: { support: 'https://example.com/support' },
            }),
            ...(withNotifications ? { notifications: expect.any(Object) } : {}),
          })
        );
        expect(res.redirect).toHaveBeenCalledWith(
          '/admin/settings/integrations'
        );
      }
    );

    it('creates integrations and notifications when both sections are absent', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        integrations: undefined,
        notifications: undefined,
      });

      await controller.integrations(
        makeReq({
          method: 'POST',
          body: {
            integrations: { email: { smtp_host: 'smtp.example.com' } },
            notifications: {
              channels: { email: { enabled: 'on' }, sms: {} },
              defaults: {},
            },
          },
        }),
        makeRes()
      );

      expect(deps.configManager.update).toHaveBeenCalledWith(
        expect.objectContaining({
          integrations: expect.any(Object),
          notifications: expect.any(Object),
        })
      );
    });

    it('restores masked integration and notification secrets', async () => {
      (deps.config.integrations as any).email = {
        smtp_password: 'actual-password',
      };
      (deps.config.notifications as any).channels = {
        sms: { api_key: 'actual-api-key', api_secret: 'actual-api-secret' },
      };
      const res = makeRes();

      await controller.integrations(
        makeReq({
          method: 'POST',
          body: {
            integrations: {
              email: { smtp_password: 'actu***********' },
            },
            notifications: {
              channels: {
                sms: {
                  api_key: 'actu**********',
                  api_secret: 'actu*************',
                },
              },
            },
          },
        }),
        res
      );

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/^Restored [1-9]/),
        expect.objectContaining({ fields: expect.any(Array) })
      );
      expect(deps.configManager.update).toHaveBeenCalledWith(
        expect.objectContaining({
          integrations: expect.objectContaining({
            email: expect.objectContaining({
              smtp_password: 'actual-password',
            }),
          }),
        })
      );
    });

    it.each([new Error('write failed'), 'write failed'])(
      'handles integration update failure %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.integrations(
          makeReq({ method: 'POST', body: { integrations: {} } }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Failed to update integrations settings'
        );
      }
    );
  });

  describe('reload()', () => {
    it('reloads configuration and redirects with success', async () => {
      const res = makeRes();

      await controller.reload(makeReq({ method: 'POST' }), res);

      expect(deps.configManager.reload).toHaveBeenCalledOnce();
      expect(deps.flash.success).toHaveBeenCalledWith(
        'Configuration reloaded successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
    });

    it('flashes an error when reload fails', async () => {
      deps.configManager.reload.mockRejectedValue(new Error('reload failed'));
      const res = makeRes();

      await controller.reload(makeReq({ method: 'POST' }), res);

      expect(deps.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'configuration_reload_failed',
      });
      expect(deps.flash.error).toHaveBeenCalledWith(
        'Failed to reload configuration'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
    });
  });

  describe('testEmail()', () => {
    it.each([[['admin@example.com']], [{ email: 'admin@example.com' }]])(
      'rejects a non-string email value %# as a client error',
      async email => {
        const res = makeRes();

        await controller.testEmail(
          makeReq({ method: 'POST', body: { email } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid email address format',
        });
        expect(deps.emailService.initialize).not.toHaveBeenCalled();
        expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
      }
    );

    it.each([undefined, '', null])(
      'requires a recipient email (%s)',
      async email => {
        const res = makeRes();

        await controller.testEmail(
          makeReq({ method: 'POST', body: { email } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Email address is required',
        });
      }
    );

    it('rejects an address longer than the SMTP maximum', async () => {
      const email = `${'a'.repeat(245)}@example.com`;
      const res = makeRes();

      await controller.testEmail(
        makeReq({ method: 'POST', body: { email } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Email address is too long',
      });
    });

    it.each(['not-an-email', 'user@-example.com', 'user@example-.com'])(
      'rejects invalid email syntax: %s',
      async email => {
        const res = makeRes();

        await controller.testEmail(
          makeReq({ method: 'POST', body: { email } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid email address format',
        });
      }
    );

    it.each([
      ['admin@id.example.com', false],
      ['admin@sub.id.example.com', false],
      ['admin@gmail.com', true],
      ['admin@evil-id.example.com', true],
    ] as const)(
      'sends to %s and records external-domain=%s',
      async (email, isExternal) => {
        const res = makeRes();

        await controller.testEmail(
          makeReq({ method: 'POST', body: { email } }),
          res
        );

        expect(deps.emailService.initialize).toHaveBeenCalledOnce();
        expect(deps.emailService.sendEmail).toHaveBeenCalledWith(
          email,
          'Test Email from Parako.ID',
          expect.stringContaining('Requested by: admin@example.com'),
          expect.stringContaining('Requested by:</strong> admin@example.com')
        );
        expect(deps.logger.warn).toHaveBeenCalledTimes(isExternal ? 1 : 0);
        expect(deps.logger.info).toHaveBeenCalledWith(
          'Test email sent successfully',
          expect.objectContaining({
            recipientEmail: email,
            isExternalDomain: isExternal,
            isFreeProvider: email.endsWith('@gmail.com'),
          })
        );
        expect(res.json).toHaveBeenCalledWith({
          success: true,
          message: 'Test email sent successfully',
        });
      }
    );

    it('uses anonymous request metadata fallbacks', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue(null);
      (deps.config.deployment as any).url = undefined;
      const req = makeReq({
        ip: undefined,
        socket: { remoteAddress: undefined } as any,
        get: vi.fn().mockReturnValue(undefined),
        body: { email: 'admin@localhost' },
      });

      await controller.testEmail(req, makeRes());

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Test email requested',
        expect.objectContaining({
          requestedBy: 'unknown',
          ip: 'unknown',
          userAgent: 'unknown',
        })
      );
    });

    it.each([new Error('SMTP unavailable'), 'SMTP unavailable'])(
      'returns a server error when email delivery fails %#',
      async failure => {
        deps.emailService.sendEmail.mockRejectedValue(failure);
        const res = makeRes();

        await controller.testEmail(
          makeReq({
            method: 'POST',
            body: { email: 'admin@id.example.com' },
          }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error:
            failure instanceof Error
              ? failure.message
              : 'Failed to send test email',
        });
      }
    );
  });

  describe('rollback()', () => {
    it.each([
      ['10.0.0.8', '10.0.0.8'],
      [undefined, 'unknown'],
    ] as const)(
      'uses the request IP fallback %s',
      async (remoteAddress, expectedIp) => {
        deps.sessionManager.getActiveUser.mockReturnValue(null);
        const get = vi.fn().mockReturnValue(undefined);
        const req = makeReq({
          body: { versionId: '' },
          ip: '',
          socket: { remoteAddress } as Request['socket'],
          get,
        });

        await controller.rollback(req, makeRes());

        expect(deps.logger.info).toHaveBeenCalledWith(
          'Configuration rollback requested',
          expect.objectContaining({
            requestedBy: 'unknown',
            ip: expectedIp,
          })
        );
      }
    );

    it.each([undefined, '', '   ', { id: 'version-1' }])(
      'rejects a missing or malformed version identifier %#',
      async versionId => {
        const res = makeRes();

        await controller.rollback(
          makeReq({ method: 'POST', body: { versionId } }),
          res
        );

        expect(deps.settingsService.findOne).not.toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          'Version ID is required for rollback'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
      }
    );

    it('reports a missing rollback target', async () => {
      deps.settingsService.findOne.mockResolvedValue(null);
      const res = makeRes();

      await controller.rollback(
        makeReq({ method: 'POST', body: { versionId: 'version-1' } }),
        res
      );

      expect(deps.settingsService.findOne).toHaveBeenCalledWith('version-1');
      expect(deps.flash.error).toHaveBeenCalledWith(
        'Configuration version not found'
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Rollback failed: Version not found',
        expect.objectContaining({ versionId: 'version-1' })
      );
    });

    it('refuses to roll back to the active version', async () => {
      deps.settingsService.findOne.mockResolvedValue({
        version: '2.0.0',
        is_active: true,
      });

      await controller.rollback(
        makeReq({ method: 'POST', body: { versionId: 'version-2' } }),
        makeRes()
      );

      expect(deps.flash.error).toHaveBeenCalledWith(
        'Cannot rollback to the currently active version'
      );
      expect(deps.settingsService.saveMainConfiguration).not.toHaveBeenCalled();
    });

    it.each(['3.0.0', undefined])(
      'creates a clean new version from an inactive target (current=%s)',
      async currentVersion => {
        const target = {
          _id: 'db-id',
          __v: 4,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-02T00:00:00Z'),
          key: 'parako_config',
          version: '2.0.0',
          _version: 2,
          is_active: false,
          configuration: { application: { name: 'Old' } },
        };
        deps.settingsService.findOne.mockResolvedValue(target);
        deps.configManager.getPlatformConfig.mockReturnValue({
          ...deps.config,
          ...(currentVersion ? { version: currentVersion } : {}),
        });
        const res = makeRes();

        await controller.rollback(
          makeReq({ method: 'POST', body: { versionId: ' version-2 ' } }),
          res
        );

        expect(deps.settingsService.findOne).toHaveBeenCalledWith('version-2');
        expect(deps.settingsService.saveMainConfiguration).toHaveBeenCalledWith(
          {
            key: 'parako_config',
            version: '2.0.0',
            _version: 2,
            is_active: false,
            configuration: { application: { name: 'Old' } },
          },
          'admin@example.com',
          `Rollback to version 2.0.0 (from ${currentVersion || 'unknown'})`
        );
        expect(deps.configManager.reload).toHaveBeenCalledOnce();
        expect(deps.activityService.success).toHaveBeenCalled();
        expect(deps.flash.success).toHaveBeenCalledWith(
          'Configuration successfully rolled back to version 2.0.0'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
      }
    );

    it.each([new Error('rollback failed'), 'rollback failed'])(
      'handles rollback failure %#',
      async failure => {
        deps.settingsService.findOne.mockRejectedValue(failure);
        const res = makeRes();

        await controller.rollback(
          makeReq({ method: 'POST', body: { versionId: 'version-1' } }),
          res
        );

        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(deps.flash.error).toHaveBeenCalledWith(
          `Failed to rollback configuration: ${
            failure instanceof Error ? failure.message : 'Unknown error'
          }`
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
      }
    );
  });

  describe('stats()', () => {
    it('returns load and section-presence statistics', async () => {
      const res = makeRes();

      await controller.stats(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        isLoaded: true,
        lastUpdated: expect.any(String),
        sections: {
          application: true,
          branding: true,
          deployment: true,
          security: true,
          features: true,
          oidc: true,
          integrations: true,
        },
      });
    });

    it('reports absent sections and unloaded configuration', async () => {
      deps.configManager.isLoaded.mockReturnValue(false);
      deps.configManager.getPlatformConfig.mockReturnValue({});
      const res = makeRes();

      await controller.stats(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          isLoaded: false,
          sections: expect.objectContaining({
            application: false,
            oidc: false,
          }),
        })
      );
    });

    it('returns 500 when statistics cannot be read', async () => {
      deps.configManager.getPlatformConfig.mockImplementation(() => {
        throw new Error('unavailable');
      });
      const res = makeRes();

      await controller.stats(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to get configuration statistics',
      });
    });
  });

  describe('exportConfig()', () => {
    it.each([true, false])(
      'exports masked JSON with authenticated-user=%s',
      async authenticated => {
        (deps.config.security as any).secrets = {
          jwt_secret: 'super-secret-value',
        };
        (deps.config as any).version = undefined;
        if (!authenticated) {
          deps.sessionManager.getActiveUser.mockReturnValue(null);
        }
        const res = makeRes();

        await controller.exportConfig(makeReq(), res);

        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Type',
          'application/json'
        );
        expect(res.setHeader).toHaveBeenCalledWith(
          'Content-Disposition',
          expect.stringMatching(
            /^attachment; filename="parako-config-export-\d{4}-\d{2}-\d{2}\.json"$/
          )
        );
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            _export_metadata: expect.objectContaining({
              exportedBy: authenticated ? 'admin@example.com' : 'unknown',
              version: '1.0.0',
            }),
            security: expect.objectContaining({
              secrets: {
                jwt_secret: expect.not.stringContaining('super-secret-value'),
              },
            }),
          })
        );
        expect(deps.activityService.info).toHaveBeenCalled();
      }
    );

    it.each([new Error('export failed'), 'export failed'])(
      'returns JSON on export failure %#',
      async failure => {
        deps.configManager.getPlatformConfig.mockImplementation(() => {
          throw failure;
        });
        const res = makeRes();

        await controller.exportConfig(makeReq(), res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Failed to export configuration',
          message: failure instanceof Error ? failure.message : 'Unknown error',
        });
      }
    );
  });

  describe('importPage()', () => {
    it('renders the import page', async () => {
      const res = makeRes();

      await controller.importPage(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/settings/import', {
        title: 'Import Configuration',
      });
    });

    it('redirects when the import page cannot render', async () => {
      const res = makeRes();
      (res.render as any).mockImplementation(() => {
        throw new Error('template missing');
      });

      await controller.importPage(makeReq(), res);

      expect(deps.flash.error).toHaveBeenCalledWith(
        'Failed to load import page'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
    });
  });

  describe('importConfigPreview()', () => {
    it.each([undefined, '', null])(
      'requires import data (%s)',
      async config => {
        const res = makeRes();

        await controller.importConfigPreview(
          makeReq({ method: 'POST', body: { config } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'No configuration data provided',
        });
      }
    );

    it('rejects invalid JSON', async () => {
      const res = makeRes();

      await controller.importConfigPreview(
        makeReq({ method: 'POST', body: { config: '{broken' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid JSON format',
      });
    });

    it.each(['42', 'null', '[]', 42, []])(
      'rejects a non-object configuration %#',
      async config => {
        const res = makeRes();

        await controller.importConfigPreview(
          makeReq({ method: 'POST', body: { config } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Configuration must be a JSON object',
        });
        expect(deps.settingsService.generateConfigDiff).not.toHaveBeenCalled();
      }
    );

    it.each([
      JSON.stringify({
        _export_metadata: { exportedAt: 'ignored' },
        application: { name: 'Imported' },
      }),
      {
        _export_metadata: { exportedAt: 'ignored' },
        application: { name: 'Imported' },
      },
    ])('returns a diff and impact for valid import data %#', async config => {
      const diff = [
        { path: 'application.name', oldValue: 'Old', newValue: 'Imported' },
      ];
      const impact = { restartRequired: false };
      deps.settingsService.generateConfigDiff.mockReturnValue(diff);
      deps.settingsService.analyzeConfigImpact.mockReturnValue(impact);
      const res = makeRes();

      await controller.importConfigPreview(
        makeReq({ method: 'POST', body: { config } }),
        res
      );

      expect(deps.settingsService.generateConfigDiff).toHaveBeenCalledWith(
        deps.config,
        { application: { name: 'Imported' } }
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        valid: true,
        diff,
        impact,
        changeCount: 1,
      });
    });

    it.each([new Error('diff failed'), 'diff failed'])(
      'returns 500 when preview generation fails %#',
      async failure => {
        deps.settingsService.generateConfigDiff.mockImplementation(() => {
          throw failure;
        });
        const res = makeRes();

        await controller.importConfigPreview(
          makeReq({ method: 'POST', body: { config: { application: {} } } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Failed to preview configuration import',
          message: failure instanceof Error ? failure.message : 'Unknown error',
        });
      }
    );
  });

  describe('applyImport()', () => {
    it.each([undefined, '', null])(
      'requires import data (%s)',
      async config => {
        const res = makeRes();

        await controller.applyImport(
          makeReq({ method: 'POST', body: { config } }),
          res
        );

        expect(deps.flash.error).toHaveBeenCalledWith(
          'No configuration data provided for import'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
      }
    );

    it('rejects invalid JSON', async () => {
      const res = makeRes();

      await controller.applyImport(
        makeReq({ method: 'POST', body: { config: '{broken' } }),
        res
      );

      expect(deps.flash.error).toHaveBeenCalledWith('Invalid JSON format');
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
    });

    it.each(['42', 'null', '[]', 42, []])(
      'rejects a non-object configuration %#',
      async config => {
        const res = makeRes();

        await controller.applyImport(
          makeReq({ method: 'POST', body: { config } }),
          res
        );

        expect(deps.flash.error).toHaveBeenCalledWith(
          'Configuration must be a JSON object'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/settings');
        expect(deps.configManager.update).not.toHaveBeenCalled();
      }
    );

    it.each([false, true])(
      'applies a valid import with restored-sensitive-fields=%s',
      async restoreSecret => {
        (deps.config.security as any).secrets = {
          jwt_secret: 'actual-secret-value',
        };
        const config = {
          _export_metadata: { ignored: true },
          application: { name: 'Imported' },
          ...(restoreSecret
            ? {
                security: {
                  secrets: { jwt_secret: 'actu***************' },
                },
              }
            : {}),
        };
        const res = makeRes();

        await controller.applyImport(
          makeReq({ method: 'POST', body: { config } }),
          res
        );

        expect(deps.configManager.update).toHaveBeenCalledWith(
          expect.objectContaining({ application: { name: 'Imported' } })
        );
        expect(deps.configManager.reload).toHaveBeenCalledOnce();
        expect(deps.activityService.success).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      }
    );

    it.each([new Error('apply failed'), 'apply failed'])(
      'returns 500 when applying an import fails %#',
      async failure => {
        deps.configManager.update.mockRejectedValue(failure);
        const res = makeRes();

        await controller.applyImport(
          makeReq({ method: 'POST', body: { config: { application: {} } } }),
          res
        );

        const message =
          failure instanceof Error ? failure.message : 'Unknown error';
        expect(deps.activityService.failed).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: message,
          message: `Failed to import configuration: ${message}`,
        });
      }
    );
  });

  describe('revealSecret()', () => {
    it('requires an authenticated administrator', async () => {
      deps.sessionManager.getActiveUser.mockReturnValue(null);
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ body: { fieldPath: 'security.secrets.jwt_secret' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Not authenticated',
      });
    });

    it.each([undefined, '', 42, [], {}])(
      'rejects a missing or malformed field path %#',
      async fieldPath => {
        const res = makeRes();

        await controller.revealSecret(makeReq({ body: { fieldPath } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Field path is required',
        });
      }
    );

    it('rejects a non-sensitive field path', async () => {
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ body: { fieldPath: 'application.name' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid field path',
      });
    });

    it('returns 404 when decrypted configuration is unavailable', async () => {
      deps.settingsService.loadAndDecryptConfiguration.mockResolvedValue(null);
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ body: { fieldPath: 'security.secrets.jwt_secret' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Configuration not found',
      });
    });

    it.each([
      ['security.secrets.jwt_secret', 'actual-jwt-secret'],
      ['integrations.email.smtp_password', ''],
    ] as const)(
      'reveals the whitelisted field %s',
      async (fieldPath, expectedValue) => {
        deps.settingsService.loadAndDecryptConfiguration.mockResolvedValue({
          security: { secrets: { jwt_secret: 'actual-jwt-secret' } },
          integrations: { email: {} },
        });
        const res = makeRes();

        await controller.revealSecret(makeReq({ body: { fieldPath } }), res);

        expect(deps.activityService.warning).toHaveBeenCalled();
        expect(deps.logger.warn).toHaveBeenCalledWith(
          'Secret field revealed',
          expect.objectContaining({ fieldPath, username: 'admin' })
        );
        expect(res.json).toHaveBeenCalledWith({
          success: true,
          value: expectedValue,
        });
      }
    );

    it('returns a generic error when decryption fails', async () => {
      deps.settingsService.loadAndDecryptConfiguration.mockRejectedValue(
        new Error('KMS unavailable')
      );
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ body: { fieldPath: 'security.secrets.jwt_secret' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to reveal secret',
      });
    });
  });

  describe('healthCheck()', () => {
    it.each(['sqlite', 'postgresql'] as const)(
      'uses the persistence service as the database probe for %s',
      async adapter => {
        deps.configManager.getPlatformConfig.mockReturnValue({
          ...deps.config,
          storage: { adapter },
          oidc: {},
          oidc_storage: { oidc_adapter: { type: adapter } },
        });
        deps.settingsService.findMany.mockResolvedValue([]);
        const res = makeRes();

        await controller.healthCheck(makeReq(), res);

        expect(deps.settingsService.findMany).toHaveBeenCalledWith(
          {},
          { limit: 1 }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'healthy',
            checks: expect.objectContaining({
              databaseConnectivity: true,
              oidcStorageConnectivity: true,
            }),
          })
        );
      }
    );

    it('reports an incomplete Redis adapter configuration as unhealthy', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: { type: 'redis', redis: { host: '', port: 6379 } },
        },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(redisMocks.constructor).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Redis config incomplete for health check'
      );
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: expect.objectContaining({ oidcStorageConnectivity: false }),
        })
      );
    });

    it('reports a failed Redis PING response as unhealthy', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: { host: 'redis.internal', port: 6379 },
          },
        },
      });
      redisMocks.ping.mockResolvedValue('NOT_PONG');
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(redisMocks.quit).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: expect.objectContaining({ oidcStorageConnectivity: false }),
        })
      );
    });

    it('closes the temporary Redis client when the health probe throws', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: { host: 'redis.internal', port: 6379 },
          },
        },
      });
      redisMocks.ping.mockRejectedValue(new Error('connection lost'));
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(redisMocks.quit).toHaveBeenCalledOnce();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Redis connectivity check failed',
        { error: expect.any(Error) }
      );
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('encodes Redis credentials and uses the configured database', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: {
              host: 'redis.internal',
              port: 6380,
              password: 'p@ss:/word',
              database: 4,
            },
          },
        },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(redisMocks.constructor).toHaveBeenCalledWith(
        'redis://:p%40ss%3A%2Fword@redis.internal:6380/4',
        {
          lazyConnect: true,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
        }
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('reports unloaded configuration without attempting to read it', async () => {
      deps.configManager.isLoaded.mockReturnValue(false);
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.configManager.getPlatformConfig).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          provider: 'database',
          checks: {
            configLoaded: false,
            databaseConnectivity: true,
            smtpConnectivity: null,
            oidcStorageConnectivity: false,
            oidcIssuerReachable: null,
          },
        })
      );
    });

    it('reports a failed database probe and mirrors it for MongoDB storage', async () => {
      const databaseError = new Error('database unavailable');
      deps.settingsService.findMany.mockRejectedValue(databaseError);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'mongodb' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Database connectivity check failed',
        { error: databaseError }
      );
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: expect.objectContaining({
            databaseConnectivity: false,
            oidcStorageConnectivity: false,
          }),
        })
      );
    });

    it.each([
      [true, true],
      [false, false],
    ] as const)(
      'reports the optional SMTP probe result %s without changing readiness',
      async (smtpResult, expectedCheck) => {
        deps.emailService.connectToEmailServer.mockResolvedValue(smtpResult);
        deps.configManager.getPlatformConfig.mockReturnValue({
          ...deps.config,
          integrations: { email: { smtp_host: 'smtp.example.com' } },
          oidc: {},
          oidc_storage: { oidc_adapter: { type: 'sqlite' } },
        });
        const res = makeRes();

        await controller.healthCheck(makeReq(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'healthy',
            checks: expect.objectContaining({
              smtpConnectivity: expectedCheck,
            }),
          })
        );
      }
    );

    it('clears the SMTP timeout after a fast probe completes', async () => {
      vi.useFakeTimers();
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        integrations: { email: { smtp_host: 'smtp.example.com' } },
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });

      try {
        await controller.healthCheck(makeReq(), makeRes());

        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports an optional SMTP probe timeout without delaying readiness', async () => {
      vi.useFakeTimers();
      deps.emailService.connectToEmailServer.mockReturnValue(
        new Promise<boolean>(() => undefined)
      );
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        integrations: { email: { smtp_host: 'smtp.example.com' } },
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });
      const res = makeRes();

      try {
        const healthCheck = controller.healthCheck(makeReq(), res);
        await vi.advanceTimersByTimeAsync(5000);
        await healthCheck;

        expect(deps.logger.warn).toHaveBeenCalledWith(
          'SMTP connectivity check failed',
          { error: expect.objectContaining({ message: 'SMTP test timeout' }) }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'healthy',
            checks: expect.objectContaining({ smtpConnectivity: false }),
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps readiness healthy when the optional SMTP probe rejects', async () => {
      const smtpError = new Error('SMTP unavailable');
      deps.emailService.connectToEmailServer.mockRejectedValue(smtpError);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        integrations: { email: { smtp_host: 'smtp.example.com' } },
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'SMTP connectivity check failed',
        { error: smtpError }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          checks: expect.objectContaining({ smtpConnectivity: false }),
        })
      );
    });

    it('uses Redis defaults when authentication and database are omitted', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: { host: 'redis.internal', port: 6379 },
          },
        },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(redisMocks.constructor).toHaveBeenCalledWith(
        'redis://redis.internal:6379/0',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('logs Redis cleanup failure without replacing a successful probe', async () => {
      const cleanupError = new Error('QUIT failed');
      redisMocks.quit.mockRejectedValue(cleanupError);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: { host: 'redis.internal', port: 6379 },
          },
        },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Redis health client cleanup failed',
        { error: cleanupError }
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('reports an unsupported OIDC storage adapter as unhealthy', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'memory' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: expect.objectContaining({ oidcStorageConnectivity: false }),
        })
      );
    });

    it('reports issuer HTTP failure as an optional failed check', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
      } as unknown as globalThis.Response);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(fetch).toHaveBeenCalledWith(
        'https://id.example.com/oidc/v1/.well-known/openid-configuration',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(AbortSignal),
        })
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'OIDC issuer not reachable',
        expect.objectContaining({ status: 503 })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({ oidcIssuerReachable: false }),
        })
      );
    });

    it('reports a reachable issuer without warning', async () => {
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        'OIDC issuer not reachable',
        expect.anything()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({ oidcIssuerReachable: true }),
        })
      );
    });

    it('reports an issuer request exception as an optional failed check', async () => {
      const issuerError = new Error('issuer unavailable');
      vi.mocked(fetch).mockRejectedValue(issuerError);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'OIDC issuer reachability check failed',
        { error: issuerError }
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns file-provider metadata and the authenticated requester', async () => {
      deps.configManager.isUsingFileConfig.mockReturnValue(true);
      deps.configManager.getPlatformConfig.mockReturnValue({
        ...deps.config,
        oidc: {},
        oidc_storage: { oidc_adapter: { type: 'sqlite' } },
        _metadata: { loadedAt: '2026-08-02T08:30:00.000Z' },
      });
      const req = makeReq();
      const res = makeRes();

      await controller.healthCheck(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'file',
          lastLoaded: '2026-08-02T08:30:00.000Z',
        })
      );
      expect(deps.logger.debug).toHaveBeenCalledWith(
        'Configuration health check completed',
        expect.objectContaining({ requestedBy: 'admin@example.com' })
      );
    });

    it('returns a stable 503 response when health-check assembly throws', async () => {
      const configError = new Error('configuration corrupted');
      deps.configManager.getPlatformConfig.mockImplementation(() => {
        throw configError;
      });
      const res = makeRes();

      await controller.healthCheck(makeReq(), res);

      expect(deps.logger.error).toHaveBeenCalledWith(configError, {
        context: 'health_check_failed',
      });
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          error: 'Health check failed',
          checks: { configLoaded: true },
          responseTime: expect.any(Number),
        })
      );
    });
  });
});
