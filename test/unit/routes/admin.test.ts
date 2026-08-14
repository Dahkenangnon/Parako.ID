import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimiterMocks = vi.hoisted(() => {
  const trace =
    (label: string) =>
    (_req: Request, res: Response, next: NextFunction): void => {
      const entries = (res.locals.trace ??= []) as string[];
      entries.push(label);
      next();
    };

  return {
    configUpdateLimiter: trace('rate:config-update'),
    revealSecretLimiter: trace('rate:reveal-secret'),
    testEmailLimiter: trace('rate:test-email'),
  };
});

vi.mock('../../../src/utils/rate-limiter.js', () => rateLimiterMocks);

import { adminRoutes } from '../../../src/routes/admin.js';

type HttpMethod = 'delete' | 'get' | 'post';

interface AdminRouteCase {
  body?: Record<string, unknown>;
  controller: string;
  method: HttpMethod;
  path: string;
}

const USER_CREATE_BODY = {
  email: 'new-user@example.com',
  family_name: 'User',
  given_name: 'New',
  password: 'not-validated-at-route-layer',
};
const USER_UPDATE_BODY = {
  email: 'existing-user@example.com',
  family_name: 'User',
  given_name: 'Existing',
};
const OIDC_CLIENT_BODY = {
  application_type: 'web',
  client_name: 'Test client',
};

const ADMIN_ROUTE_CASES: AdminRouteCase[] = [
  { method: 'get', path: '/', controller: 'home.dashboard' },
  { method: 'get', path: '/dashboard', controller: 'home.dashboard' },
  { method: 'post', path: '/update-theme', controller: 'home.updateTheme' },
  { method: 'get', path: '/users', controller: 'users.list' },
  { method: 'get', path: '/users/new', controller: 'users.create' },
  {
    method: 'post',
    path: '/users/new',
    controller: 'users.store',
    body: USER_CREATE_BODY,
  },
  { method: 'get', path: '/users/user-1', controller: 'users.show' },
  { method: 'get', path: '/users/user-1/edit', controller: 'users.edit' },
  {
    method: 'post',
    path: '/users/user-1/edit',
    controller: 'users.update',
    body: USER_UPDATE_BODY,
  },
  { method: 'post', path: '/users/user-1/enable', controller: 'users.enable' },
  {
    method: 'post',
    path: '/users/user-1/disable',
    controller: 'users.disable',
  },
  { method: 'delete', path: '/users/user-1', controller: 'users.destroy' },
  {
    method: 'get',
    path: '/users/user-1/activities',
    controller: 'users.activities',
  },
  { method: 'get', path: '/oidc-clients', controller: 'oidcClients.list' },
  {
    method: 'get',
    path: '/oidc-clients/create',
    controller: 'oidcClients.create',
  },
  {
    method: 'post',
    path: '/oidc-clients',
    controller: 'oidcClients.store',
    body: OIDC_CLIENT_BODY,
  },
  {
    method: 'get',
    path: '/oidc-clients/view/client-1?source=database',
    controller: 'oidcClients.show',
  },
  {
    method: 'get',
    path: '/oidc-clients/edit/client-1?source=database',
    controller: 'oidcClients.edit',
  },
  {
    method: 'post',
    path: '/oidc-clients/edit/client-1',
    controller: 'oidcClients.update',
    body: OIDC_CLIENT_BODY,
  },
  {
    method: 'post',
    path: '/oidc-clients/activate/client-1',
    controller: 'oidcClients.activate',
  },
  {
    method: 'post',
    path: '/oidc-clients/deactivate/client-1',
    controller: 'oidcClients.deactivate',
  },
  {
    method: 'post',
    path: '/oidc-clients/regenerate-secret/client-1',
    controller: 'oidcClients.regenerateSecret',
  },
  {
    method: 'post',
    path: '/oidc-clients/delete/client-1',
    controller: 'oidcClients.destroy',
  },
  {
    method: 'get',
    path: '/oidc-clients/statistics',
    controller: 'oidcClients.statistics',
  },
  {
    method: 'get',
    path: '/oidc-clients/search',
    controller: 'oidcClients.search',
  },
  {
    method: 'post',
    path: '/oidc-clients/client-1/reveal-secret',
    controller: 'oidcClients.revealSecret',
  },
  { method: 'get', path: '/jwks', controller: 'jwks.list' },
  { method: 'get', path: '/jwks/key-1', controller: 'jwks.show' },
  { method: 'post', path: '/jwks/rotate', controller: 'jwks.rotate' },
  {
    method: 'post',
    path: '/jwks/retire-expired',
    controller: 'jwks.retireExpired',
  },
  { method: 'get', path: '/activities', controller: 'activities.list' },
  {
    method: 'post',
    path: '/activities/clear-old',
    controller: 'activities.clearOldActivities',
  },
  {
    method: 'get',
    path: '/activities/activity-1',
    controller: 'activities.show',
  },
  { method: 'get', path: '/sessions', controller: 'sessions.list' },
  { method: 'get', path: '/sessions/stats', controller: 'sessions.getStats' },
  { method: 'get', path: '/sessions/session-1', controller: 'sessions.show' },
  {
    method: 'post',
    path: '/sessions/revoke-user/user-1',
    controller: 'sessions.revokeUserSessions',
  },
  {
    method: 'post',
    path: '/sessions/session-1/revoke',
    controller: 'sessions.revokeSession',
  },
  { method: 'get', path: '/user-grants', controller: 'grants.list' },
  { method: 'get', path: '/user-grants/stats', controller: 'grants.getStats' },
  { method: 'get', path: '/user-grants/grant-1', controller: 'grants.show' },
  {
    method: 'post',
    path: '/user-grants/grant-1/revoke',
    controller: 'grants.revokeGrant',
  },
  {
    method: 'post',
    path: '/user-grants/revoke-user/user-1',
    controller: 'grants.revokeUserGrants',
  },
  {
    method: 'post',
    path: '/user-grants/revoke-client/client-1',
    controller: 'grants.revokeClientGrants',
  },
  {
    method: 'get',
    path: '/data-transfer',
    controller: 'dataTransfer.overview',
  },
  {
    method: 'get',
    path: '/data-transfer/users',
    controller: 'dataTransfer.entityPage',
  },
  {
    method: 'post',
    path: '/data-transfer/users/import',
    controller: 'dataTransfer.startImport',
  },
  {
    method: 'get',
    path: '/data-transfer/users/import/template',
    controller: 'dataTransfer.downloadTemplate',
  },
  {
    method: 'get',
    path: '/data-transfer/users/import/job-1/progress',
    controller: 'dataTransfer.importProgress',
  },
  {
    method: 'get',
    path: '/data-transfer/users/import/job-1/status',
    controller: 'dataTransfer.importStatus',
  },
  {
    method: 'get',
    path: '/data-transfer/users/export',
    controller: 'dataTransfer.exportData',
  },
  { method: 'get', path: '/tenants', controller: 'platform.listTenantsPage' },
  {
    method: 'get',
    path: '/tenants/new',
    controller: 'platform.createTenantPage',
  },
  { method: 'post', path: '/tenants/new', controller: 'platform.storeTenant' },
  {
    method: 'get',
    path: '/tenants/tenant-a',
    controller: 'platform.showTenantPage',
  },
  {
    method: 'get',
    path: '/tenants/tenant-a/edit',
    controller: 'platform.editTenantPage',
  },
  {
    method: 'post',
    path: '/tenants/tenant-a/edit',
    controller: 'platform.updateTenant',
  },
  {
    method: 'post',
    path: '/tenants/tenant-a/status',
    controller: 'platform.updateTenantStatus',
  },
  { method: 'get', path: '/settings', controller: 'settings.overview' },
  { method: 'get', path: '/settings/stats', controller: 'settings.stats' },
  {
    method: 'get',
    path: '/settings/health',
    controller: 'settings.healthCheck',
  },
  {
    method: 'get',
    path: '/settings/export',
    controller: 'settings.exportConfig',
  },
  {
    method: 'get',
    path: '/settings/import',
    controller: 'settings.importPage',
  },
  { method: 'post', path: '/settings/reload', controller: 'settings.reload' },
  {
    method: 'get',
    path: '/settings/application',
    controller: 'settings.application',
  },
  {
    method: 'post',
    path: '/settings/application',
    controller: 'settings.application',
  },
  {
    method: 'get',
    path: '/settings/branding',
    controller: 'settings.branding',
  },
  {
    method: 'post',
    path: '/settings/branding',
    controller: 'settings.branding',
  },
  {
    method: 'delete',
    path: '/settings/branding/remove-logo',
    controller: 'settings.removeLogo',
  },
  {
    method: 'post',
    path: '/settings/branding/reset-colors',
    controller: 'settings.resetColors',
  },
  {
    method: 'post',
    path: '/settings/branding/reset-fonts',
    controller: 'settings.resetFonts',
  },
  {
    method: 'post',
    path: '/settings/branding/logo-dark',
    controller: 'settings.uploadLogoDark',
  },
  {
    method: 'delete',
    path: '/settings/branding/remove-logo-dark',
    controller: 'settings.removeLogoDark',
  },
  {
    method: 'post',
    path: '/settings/branding/logo-icon',
    controller: 'settings.uploadLogoIcon',
  },
  {
    method: 'delete',
    path: '/settings/branding/remove-logo-icon',
    controller: 'settings.removeLogoIcon',
  },
  {
    method: 'post',
    path: '/settings/branding/logo-icon-dark',
    controller: 'settings.uploadLogoIconDark',
  },
  {
    method: 'delete',
    path: '/settings/branding/remove-logo-icon-dark',
    controller: 'settings.removeLogoIconDark',
  },
  {
    method: 'post',
    path: '/settings/branding/favicon',
    controller: 'settings.uploadFavicon',
  },
  {
    method: 'delete',
    path: '/settings/branding/remove-favicon',
    controller: 'settings.removeFavicon',
  },
  {
    method: 'get',
    path: '/settings/deployment',
    controller: 'settings.deployment',
  },
  {
    method: 'post',
    path: '/settings/deployment',
    controller: 'settings.deployment',
  },
  {
    method: 'get',
    path: '/settings/security',
    controller: 'settings.securityAuthentication',
  },
  {
    method: 'post',
    path: '/settings/security',
    controller: 'settings.securityAuthentication',
  },
  {
    method: 'get',
    path: '/settings/security/mfa',
    controller: 'settings.securityMfa',
  },
  {
    method: 'post',
    path: '/settings/security/mfa',
    controller: 'settings.securityMfa',
  },
  {
    method: 'get',
    path: '/settings/security/sessions',
    controller: 'settings.securitySessions',
  },
  {
    method: 'post',
    path: '/settings/security/sessions',
    controller: 'settings.securitySessions',
  },
  {
    method: 'get',
    path: '/settings/security/protection',
    controller: 'settings.securityProtection',
  },
  {
    method: 'post',
    path: '/settings/security/protection',
    controller: 'settings.securityProtection',
  },
  {
    method: 'get',
    path: '/settings/security/secrets',
    controller: 'settings.securitySecrets',
  },
  {
    method: 'post',
    path: '/settings/security/secrets',
    controller: 'settings.securitySecrets',
  },
  {
    method: 'get',
    path: '/settings/features',
    controller: 'settings.features',
  },
  {
    method: 'post',
    path: '/settings/features',
    controller: 'settings.features',
  },
  { method: 'get', path: '/settings/oidc', controller: 'settings.oidc' },
  { method: 'post', path: '/settings/oidc', controller: 'settings.oidc' },
  {
    method: 'get',
    path: '/settings/integrations',
    controller: 'settings.integrations',
  },
  {
    method: 'post',
    path: '/settings/integrations',
    controller: 'settings.integrations',
  },
  {
    method: 'post',
    path: '/settings/integrations/test-email',
    controller: 'settings.testEmail',
  },
  {
    method: 'post',
    path: '/settings/reveal-secret',
    controller: 'settings.revealSecret',
  },
  {
    method: 'post',
    path: '/settings/rollback',
    controller: 'settings.rollback',
  },
  {
    method: 'post',
    path: '/settings/import/preview',
    controller: 'settings.importConfigPreview',
  },
  {
    method: 'post',
    path: '/settings/import/apply',
    controller: 'settings.applyImport',
  },
  {
    method: 'get',
    path: '/configuration',
    controller: 'configuration.overview',
  },
  {
    method: 'post',
    path: '/configuration/branding',
    controller: 'configuration.updateSection',
  },
  {
    method: 'delete',
    path: '/configuration/branding/remove-logo',
    controller: 'configuration.removeLogo',
  },
  {
    method: 'post',
    path: '/configuration/branding/logo-dark',
    controller: 'configuration.uploadLogoDark',
  },
  {
    method: 'delete',
    path: '/configuration/branding/remove-logo-dark',
    controller: 'configuration.removeLogoDark',
  },
  {
    method: 'post',
    path: '/configuration/branding/logo-icon',
    controller: 'configuration.uploadLogoIcon',
  },
  {
    method: 'delete',
    path: '/configuration/branding/remove-logo-icon',
    controller: 'configuration.removeLogoIcon',
  },
  {
    method: 'post',
    path: '/configuration/branding/logo-icon-dark',
    controller: 'configuration.uploadLogoIconDark',
  },
  {
    method: 'delete',
    path: '/configuration/branding/remove-logo-icon-dark',
    controller: 'configuration.removeLogoIconDark',
  },
  {
    method: 'post',
    path: '/configuration/branding/favicon',
    controller: 'configuration.uploadFavicon',
  },
  {
    method: 'delete',
    path: '/configuration/branding/remove-favicon',
    controller: 'configuration.removeFavicon',
  },
  {
    method: 'post',
    path: '/configuration/branding/reset-colors',
    controller: 'configuration.resetColors',
  },
  {
    method: 'post',
    path: '/configuration/branding/reset-fonts',
    controller: 'configuration.resetFonts',
  },
  {
    method: 'post',
    path: '/configuration/integrations/test-email',
    controller: 'configuration.testEmail',
  },
  {
    method: 'post',
    path: '/configuration/reveal-secret',
    controller: 'configuration.revealSecret',
  },
  {
    method: 'post',
    path: '/configuration/security/reset',
    controller: 'configuration.resetSection',
  },
  {
    method: 'get',
    path: '/configuration/security',
    controller: 'configuration.section',
  },
  {
    method: 'post',
    path: '/configuration/security',
    controller: 'configuration.updateSection',
  },
];

function traceMiddleware(label: string): RequestHandler {
  return (_req, res, next) => {
    const trace = (res.locals.trace ??= []) as string[];
    trace.push(label);
    next();
  };
}

function makeController(group: string): Record<string, RequestHandler> {
  return new Proxy<Record<string, RequestHandler>>(
    {},
    {
      get:
        (_target, property) =>
        (req: Request, res: Response): void => {
          res.status(200).json({
            controller: `${group}.${String(property)}`,
            fileField: (req.file as Express.Multer.File | undefined)?.fieldname,
            section: req.params.section,
            trace: res.locals.trace ?? [],
          });
        },
    }
  );
}

interface HarnessOptions {
  logoAnyError?: Error & { code?: string };
  logoFiles?: Array<{ fieldname: string }>;
  logoNoneError?: Error;
  platform?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const securityMiddleware = {
    generateCsrfToken: traceMiddleware('csrf:generate'),
    requireAdmin: traceMiddleware('auth:admin'),
    requireAuth: traceMiddleware('auth:authenticated'),
    requirePlatformTenant: traceMiddleware('auth:platform'),
    validateCsrfToken: traceMiddleware('csrf:validate'),
  };
  const localsMiddleware = {
    setAccountLocals: traceMiddleware('locals:account'),
    setActivePage: vi.fn((page: string) => traceMiddleware(`page:${page}`)),
  };
  const callbackUpload = (
    label: string,
    error?: Error,
    files?: Array<{ fieldname: string }>
  ) =>
    vi.fn(
      (req: Request, res: Response, callback: (error?: unknown) => void) => {
        const trace = (res.locals.trace ??= []) as string[];
        trace.push(label);
        if (files) {
          (req as unknown as { files?: Array<{ fieldname: string }> }).files =
            files;
        }
        callback(error);
      }
    );
  const uploadMiddleware = {
    logoUpload: {
      any: vi.fn(() =>
        callbackUpload(
          'upload:logo:any',
          options.logoAnyError,
          options.logoFiles
        )
      ),
      none: vi.fn(() =>
        callbackUpload('upload:logo:none', options.logoNoneError)
      ),
      single: vi.fn((field: string) => traceMiddleware(`upload:${field}`)),
    },
    faviconUpload: {
      single: vi.fn((field: string) => traceMiddleware(`upload:${field}`)),
    },
  };
  const configValidationMiddleware = {
    validateConfigUpdate: vi.fn((section: string) =>
      traceMiddleware(`config:${section}`)
    ),
  };
  const sessionManager = {
    flash: vi.fn(() => ({ error: vi.fn() })),
  };
  const logger = {
    info: vi.fn(),
  };
  const platformTenantMiddleware = {
    handler: traceMiddleware('auth:platform-role'),
  };
  const controllers = {
    home: makeController('home'),
    users: makeController('users'),
    activities: makeController('activities'),
    oidcClients: makeController('oidcClients'),
    sessions: makeController('sessions'),
    grants: makeController('grants'),
    settings: makeController('settings'),
    jwks: makeController('jwks'),
    configuration: makeController('configuration'),
    dataTransfer: makeController('dataTransfer'),
    platform: makeController('platform'),
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    '/admin',
    adminRoutes(
      controllers.home as never,
      controllers.users as never,
      controllers.activities as never,
      controllers.oidcClients as never,
      controllers.sessions as never,
      controllers.grants as never,
      controllers.settings as never,
      controllers.jwks as never,
      controllers.configuration as never,
      controllers.dataTransfer as never,
      uploadMiddleware as never,
      securityMiddleware as never,
      localsMiddleware as never,
      configValidationMiddleware as never,
      sessionManager as never,
      logger as never,
      options.platform ? (controllers.platform as never) : undefined,
      options.platform ? (platformTenantMiddleware as never) : undefined
    )
  );
  app.use(
    (error: Error, _req: Request, res: Response, _next: NextFunction): void => {
      res.status(500).json({ error: error.message });
    }
  );

  return {
    app,
    configValidationMiddleware,
    controllers,
    localsMiddleware,
    securityMiddleware,
    uploadMiddleware,
  };
}

describe('adminRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps every admin endpoint to its intended controller behind the global guards', async () => {
    const { app } = makeHarness({ platform: true });

    for (const route of ADMIN_ROUTE_CASES) {
      const response = await request(app)
        [route.method](`/admin${route.path}`)
        .set('Content-Type', 'application/json')
        .send(route.body ?? {});

      expect(
        response.status,
        `${route.method.toUpperCase()} ${route.path}`
      ).toBe(200);
      expect(response.body.controller).toBe(route.controller);
      const expectedGuardPrefix = route.controller.startsWith('platform.')
        ? [
            'auth:authenticated',
            'auth:platform',
            'auth:platform-role',
            'csrf:generate',
            'locals:account',
          ]
        : ['auth:admin', 'csrf:generate', 'locals:account'];
      expect(response.body.trace.slice(0, expectedGuardPrefix.length)).toEqual(
        expectedGuardPrefix
      );
    }
  });

  it.each([
    ['/users/new', {}, '/admin/users/new'],
    ['/users/user-1/edit', {}, '/admin/users/user-1/edit'],
    ['/oidc-clients', {}, '/admin/oidc-clients/create'],
    ['/oidc-clients/edit/client-1', {}, '/admin/oidc-clients/edit/client-1'],
  ] as const)(
    'rejects an invalid POST body for %s before its controller',
    async (path, body, redirect) => {
      const { app } = makeHarness();

      const response = await request(app)
        .post(`/admin${path}`)
        .type('form')
        .send(body);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(redirect);
      expect(response.body).toEqual({});
    }
  );

  it.each([
    [
      'post',
      '/update-theme',
      ['auth:admin', 'csrf:generate', 'locals:account', 'csrf:validate'],
    ],
    [
      'post',
      '/oidc-clients/client-1/reveal-secret',
      [
        'auth:admin',
        'csrf:generate',
        'locals:account',
        'csrf:validate',
        'rate:reveal-secret',
      ],
    ],
    [
      'post',
      '/settings/oidc',
      [
        'auth:admin',
        'csrf:generate',
        'locals:account',
        'auth:platform',
        'csrf:validate',
        'rate:config-update',
        'config:oidc',
      ],
    ],
    [
      'post',
      '/settings/integrations/test-email',
      [
        'auth:admin',
        'csrf:generate',
        'locals:account',
        'auth:platform',
        'csrf:validate',
        'rate:test-email',
      ],
    ],
    [
      'post',
      '/configuration/security',
      [
        'auth:admin',
        'csrf:generate',
        'locals:account',
        'csrf:validate',
        'rate:config-update',
      ],
    ],
  ] as const)(
    'orders security middleware for %s %s before its controller',
    async (method, path, expectedTrace) => {
      const { app } = makeHarness();

      const response = await request(app)
        [method](`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.trace).toEqual(expectedTrace);
    }
  );

  it.each(['/settings/branding', '/configuration/branding'])(
    'selects only the logo field from multipart uploads at %s',
    async path => {
      const { app } = makeHarness({
        logoFiles: [{ fieldname: 'ignored' }, { fieldname: 'logo' }],
      });

      const response = await request(app)
        .post(`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.fileField).toBe('logo');
      expect(response.body.trace).toContain('upload:logo:any');
      if (path === '/configuration/branding') {
        expect(response.body.section).toBe('branding');
      }
    }
  );

  it.each(['/settings/branding', '/configuration/branding'])(
    'continues with text fields when the optional logo file-count limit is reached at %s',
    async path => {
      const fileCountError = Object.assign(new Error('too many files'), {
        code: 'LIMIT_FILE_COUNT',
      });
      const { app } = makeHarness({ logoAnyError: fileCountError });

      const response = await request(app)
        .post(`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.trace).toEqual(
        expect.arrayContaining([
          'upload:logo:any',
          'upload:logo:none',
          'csrf:validate',
        ])
      );
    }
  );

  it.each(['/settings/branding', '/configuration/branding'])(
    'forwards fallback form-parse errors at %s',
    async path => {
      const fileCountError = Object.assign(new Error('too many files'), {
        code: 'LIMIT_FILE_COUNT',
      });
      const { app } = makeHarness({
        logoAnyError: fileCountError,
        logoNoneError: new Error('form parse failed'),
      });

      const response = await request(app)
        .post(`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'form parse failed' });
    }
  );

  it.each(['/settings/branding', '/configuration/branding'])(
    'forwards non-file-count upload errors at %s',
    async path => {
      const { app } = makeHarness({
        logoAnyError: new Error('upload failed'),
      });

      const response = await request(app)
        .post(`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'upload failed' });
    }
  );

  it.each([
    ['/settings/branding', [] as Array<{ fieldname: string }>],
    ['/settings/branding', [{ fieldname: 'not-logo' }]],
    ['/configuration/branding', [{ fieldname: 'not-logo' }]],
  ] as const)(
    'ignores an upload collection without a logo field at %s',
    async (path, logoFiles) => {
      const { app } = makeHarness({ logoFiles: [...logoFiles] });

      const response = await request(app)
        .post(`/admin${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.trace).toContain('upload:logo:any');
      expect(response.body).not.toHaveProperty('fileField');
    }
  );

  it('applies the global admin, CSRF-generation, and account-local guards', async () => {
    const { app } = makeHarness();

    const response = await request(app).get('/admin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      controller: 'home.dashboard',
      trace: [
        'auth:admin',
        'csrf:generate',
        'locals:account',
        'page:dashboard',
      ],
    });
  });

  it('keeps platform settings behind the platform guard while allowing tenant-scoped configuration', async () => {
    const { app } = makeHarness();

    const [settings, configuration] = await Promise.all([
      request(app).get('/admin/settings'),
      request(app).get('/admin/configuration'),
    ]);

    expect(settings.body.trace).toEqual([
      'auth:admin',
      'csrf:generate',
      'locals:account',
      'auth:platform',
      'page:settings',
    ]);
    expect(configuration.body.trace).toEqual([
      'auth:admin',
      'csrf:generate',
      'locals:account',
      'page:configuration',
    ]);
  });

  it('only exposes platform tenant management when its controller and role guard are installed', async () => {
    const withoutPlatform = makeHarness();
    const withPlatform = makeHarness({ platform: true });

    await expect(
      request(withoutPlatform.app).get('/admin/tenants')
    ).resolves.toMatchObject({
      status: 404,
    });

    const response = await request(withPlatform.app).get('/admin/tenants');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      controller: 'platform.listTenantsPage',
      trace: [
        'auth:authenticated',
        'auth:platform',
        'auth:platform-role',
        'csrf:generate',
        'locals:account',
        'page:tenants',
      ],
    });
  });

  it('checks the platform tenant and platform role before CSRF on tenant writes', async () => {
    const { app } = makeHarness({ platform: true });

    const response = await request(app)
      .post('/admin/tenants/tenant-a/status')
      .send({ status: 'suspended' });

    expect(response.status).toBe(200);
    expect(response.body.trace).toEqual([
      'auth:authenticated',
      'auth:platform',
      'auth:platform-role',
      'csrf:generate',
      'locals:account',
      'csrf:validate',
    ]);
  });
});
