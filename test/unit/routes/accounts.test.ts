import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimiterMocks = vi.hoisted(() => ({
  changePasswordLimiter: vi.fn(
    (_req: Request, res: Response, next: NextFunction) => {
      const trace = (res.locals.trace ??= []) as string[];
      trace.push('rate-limit');
      next();
    }
  ),
}));

vi.mock('../../../src/utils/rate-limiter.js', () => rateLimiterMocks);

import { accountRoutes } from '../../../src/routes/accounts.js';

type HttpMethod = 'delete' | 'get' | 'post';

interface AccountRouteCase {
  configKey?: string;
  controller: string;
  method: HttpMethod;
  path: string;
}

const ACCOUNT_ROUTE_CASES: AccountRouteCase[] = [
  { configKey: 'dashboard', method: 'get', path: '/', controller: 'myAccount' },
  {
    configKey: 'settings',
    method: 'get',
    path: '/settings',
    controller: 'settings',
  },
  {
    configKey: 'settings_profile',
    method: 'get',
    path: '/settings/profile',
    controller: 'settingsProfile',
  },
  {
    configKey: 'settings_preferences',
    method: 'get',
    path: '/settings/preferences',
    controller: 'settingsPreferences',
  },
  {
    configKey: 'settings_notifications',
    method: 'get',
    path: '/settings/notifications',
    controller: 'settingsNotifications',
  },
  {
    configKey: 'settings_security',
    method: 'get',
    path: '/settings/security',
    controller: 'settingsSecurity',
  },
  {
    configKey: 'settings_recovery',
    method: 'get',
    path: '/settings/recovery',
    controller: 'settingsRecovery',
  },
  {
    configKey: 'settings_social',
    method: 'get',
    path: '/settings/social',
    controller: 'settingsSocial',
  },
  { configKey: 'apps', method: 'get', path: '/apps', controller: 'apps' },
  {
    configKey: 'sessions',
    method: 'get',
    path: '/sessions',
    controller: 'sessions',
  },
  {
    configKey: 'update_profile',
    method: 'post',
    path: '/update-profile',
    controller: 'updateProfile',
  },
  {
    configKey: 'change_password',
    method: 'post',
    path: '/change-password',
    controller: 'changePassword',
  },
  {
    configKey: 'remove_avatar',
    method: 'delete',
    path: '/remove-avatar',
    controller: 'removeAvatar',
  },
  {
    configKey: 'enable_mfa',
    method: 'post',
    path: '/enable-mfa',
    controller: 'enableMfa',
  },
  {
    configKey: 'disable_mfa',
    method: 'post',
    path: '/disable-mfa',
    controller: 'disableMfa',
  },
  {
    configKey: 'setup_mfa',
    method: 'get',
    path: '/setup-mfa',
    controller: 'setupMfaPage',
  },
  {
    configKey: 'setup_mfa',
    method: 'post',
    path: '/setup-mfa',
    controller: 'verifySetupMfa',
  },
  {
    configKey: 'passkeys',
    method: 'get',
    path: '/passkeys',
    controller: 'passkeysPage',
  },
  {
    configKey: 'setup_webauthn',
    method: 'get',
    path: '/setup-webauthn',
    controller: 'setupWebAuthnPage',
  },
  {
    configKey: 'switch_account',
    method: 'post',
    path: '/switch-account',
    controller: 'switchAccount',
  },
  {
    configKey: 'add_account',
    method: 'post',
    path: '/add-account',
    controller: 'addAccount',
  },
  {
    configKey: 'remove_account',
    method: 'delete',
    path: '/remove-account',
    controller: 'removeAccount',
  },
  {
    configKey: 'account_switcher_data',
    method: 'get',
    path: '/account-switcher-data',
    controller: 'getAccountSwitcherData',
  },
  {
    configKey: 'revoke_app',
    method: 'post',
    path: '/revoke-app',
    controller: 'revokeApp',
  },
  {
    configKey: 'revoke_all_apps',
    method: 'post',
    path: '/revoke-all-apps',
    controller: 'revokeAllApps',
  },
  {
    configKey: 'logout_session',
    method: 'post',
    path: '/logout-session',
    controller: 'logoutSession',
  },
  {
    configKey: 'logout_all_other_sessions',
    method: 'post',
    path: '/logout-all-other-sessions',
    controller: 'logoutAllOtherSessions',
  },
  {
    method: 'get',
    path: '/social/google/link',
    controller: 'linkSocialAccount',
  },
  {
    method: 'post',
    path: '/social/google/unlink',
    controller: 'unlinkSocialAccount',
  },
  {
    configKey: 'resend_email_verification',
    method: 'post',
    path: '/resend-email-verification',
    controller: 'resendEmailVerification',
  },
  {
    configKey: 'enable_recovery',
    method: 'post',
    path: '/enable-recovery',
    controller: 'enableRecovery',
  },
  {
    configKey: 'disable_recovery',
    method: 'post',
    path: '/disable-recovery',
    controller: 'disableRecovery',
  },
  {
    configKey: 'recovery_codes',
    method: 'get',
    path: '/recovery-codes',
    controller: 'showRecoveryCodes',
  },
  {
    configKey: 'verify_recovery_email',
    method: 'get',
    path: '/verify-recovery-email',
    controller: 'verifyRecoveryEmail',
  },
  {
    configKey: 'regenerate_backup_codes',
    method: 'post',
    path: '/regenerate-backup-codes',
    controller: 'regenerateBackupCodes',
  },
  {
    configKey: 'recovery_setup',
    method: 'get',
    path: '/recovery-setup',
    controller: 'showRecoverySetup',
  },
  {
    configKey: 'security_questions_setup',
    method: 'get',
    path: '/security-questions/setup',
    controller: 'showSecurityQuestionsSetup',
  },
  {
    configKey: 'security_questions_setup',
    method: 'post',
    path: '/security-questions/setup',
    controller: 'saveSecurityQuestions',
  },
  {
    configKey: 'update_notification_preferences',
    method: 'post',
    path: '/update-notification-preferences',
    controller: 'updateNotificationPreferences',
  },
];

function traceMiddleware(label: string): RequestHandler {
  return (_req, res, next) => {
    const trace = (res.locals.trace ??= []) as string[];
    trace.push(label);
    next();
  };
}

function makeHarness() {
  const configuredRoutes = Object.fromEntries(
    ACCOUNT_ROUTE_CASES.flatMap(({ configKey, path }) =>
      configKey ? [[configKey, path]] : []
    )
  );
  const configManager = {
    getConfig: vi.fn(() => ({
      deployment: { routes: { account_routes: configuredRoutes } },
    })),
  };
  const securityMiddleware = {
    requireAuth: traceMiddleware('auth'),
    validateCsrfToken: traceMiddleware('csrf'),
  };
  const localsMiddleware = {
    setAccountLocals: traceMiddleware('account-locals'),
    setActivePage: vi.fn((page: string) => traceMiddleware(`page:${page}`)),
  };
  const avatarUpload = {
    avatarUpload: {
      single: vi.fn((field: string) => traceMiddleware(`upload:${field}`)),
    },
  };
  const accountController = new Proxy<Record<string, RequestHandler>>(
    {},
    {
      get:
        (_target, property) =>
        (_req: Request, res: Response): void => {
          res.status(200).json({
            controller: String(property),
            trace: res.locals.trace ?? [],
          });
        },
    }
  );
  const app = express();
  app.use(
    '/accounts',
    accountRoutes(
      avatarUpload as never,
      configManager as never,
      securityMiddleware as never,
      localsMiddleware as never,
      {} as never,
      accountController as never
    )
  );

  return {
    app,
    avatarUpload,
    configManager,
    localsMiddleware,
  };
}

describe('accountRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps every configured account endpoint to its controller behind account authentication', async () => {
    const { app, configManager } = makeHarness();

    for (const route of ACCOUNT_ROUTE_CASES) {
      const response = await request(app)
        [route.method](`/accounts${route.path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(
        response.status,
        `${route.method.toUpperCase()} ${route.path}`
      ).toBe(200);
      expect(response.body.controller).toBe(route.controller);
      expect(response.body.trace.slice(0, 2)).toEqual([
        'auth',
        'account-locals',
      ]);
    }
    expect(configManager.getConfig).toHaveBeenCalledOnce();
  });

  it.each([
    ['get', '/', ['auth', 'account-locals', 'page:my-account']],
    [
      'get',
      '/settings/profile',
      ['auth', 'account-locals', 'page:settings-profile', 'csrf'],
    ],
    [
      'post',
      '/update-profile',
      ['auth', 'account-locals', 'upload:avatar', 'csrf'],
    ],
    [
      'post',
      '/change-password',
      ['auth', 'account-locals', 'rate-limit', 'csrf'],
    ],
    ['delete', '/remove-avatar', ['auth', 'account-locals', 'csrf']],
    ['get', '/account-switcher-data', ['auth', 'account-locals']],
    ['get', '/social/google/link', ['auth', 'account-locals', 'csrf']],
  ] as const)(
    'orders security middleware for %s %s before its controller',
    async (method, path, expectedTrace) => {
      const { app } = makeHarness();

      const response = await request(app)
        [method](`/accounts${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.trace).toEqual(expectedTrace);
    }
  );
});
