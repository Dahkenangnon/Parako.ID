import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const rateLimiterMocks = vi.hoisted(() => {
  const trace =
    (label: string) =>
    (_req: Request, res: Response, next: NextFunction): void => {
      const entries = (res.locals.trace ??= []) as string[];
      entries.push(label);
      next();
    };

  return {
    forgotPasswordLimiter: trace('rate:forgot-password'),
    loginBruteForceByIdentifierAndIp: trace('rate:login:identifier-ip'),
    loginBruteForceByIp: trace('rate:login:ip'),
    loginLimiter: trace('rate:login'),
    mfaVerifyLimiter: trace('rate:mfa'),
    recoveryLimiter: trace('rate:recovery'),
    registerLimiter: trace('rate:register'),
    socialLoginLimiter: trace('rate:social'),
  };
});

vi.mock('../../../src/utils/rate-limiter.js', () => rateLimiterMocks);

const observabilityMocks = vi.hoisted(() => ({
  rootLogger: { error: vi.fn() },
}));

vi.mock('../../../src/observability/logs/logger.js', () => observabilityMocks);

import { authRoutes } from '../../../src/routes/auth.js';

type HttpMethod = 'get' | 'post';

interface AuthRouteCase {
  configKey?: keyof typeof DEFAULT_AUTH_ROUTES;
  controller: string;
  method: HttpMethod;
  path: string;
}

const DEFAULT_AUTH_ROUTES = {
  login: '/login',
  register: '/register',
  forgot_password: '/forgot-password',
  reset_password: '/reset-password',
  email_verification: '/email-verification',
  verify_email: '/verify-email',
  email_verification_success: '/email-verification-success',
  account_select: '/account-select',
  continue: '/continue',
  multi_factor: '/multi-factor',
  mfa_verify: '/mfa-verify',
  mfa_resend: '/mfa-resend',
  mfa_select: '/mfa-select',
  mfa_webauthn: '/mfa-webauthn',
  logout: '/logout',
  social_password_setup: '/social-password-setup',
  social_contact_info: '/social-contact-info',
  account_recovery: '/account-recovery',
  recovery_method_select: '/recovery-method-select',
  recovery_backup_codes: '/recovery-backup-codes',
  recovery_secondary_email: '/recovery-secondary-email',
  recovery_security_questions: '/recovery-security-questions',
  recovery_sms: '/recovery-sms',
  recovery_verify_code: '/recovery-verify-code',
  update_theme: '/update-theme',
  update_locale: '/update-locale',
  update_sidebar: '/update-sidebar',
  update_timezone: '/update-timezone',
};

const AUTH_ROUTE_CASES: AuthRouteCase[] = [
  { configKey: 'login', method: 'get', path: '/login', controller: 'login' },
  {
    configKey: 'login',
    method: 'post',
    path: '/login',
    controller: 'processLogin',
  },
  {
    configKey: 'register',
    method: 'get',
    path: '/register',
    controller: 'register',
  },
  {
    configKey: 'register',
    method: 'post',
    path: '/register',
    controller: 'processRegister',
  },
  {
    configKey: 'forgot_password',
    method: 'get',
    path: '/forgot-password',
    controller: 'forgotPassword',
  },
  {
    configKey: 'forgot_password',
    method: 'post',
    path: '/forgot-password',
    controller: 'processForgotPassword',
  },
  {
    configKey: 'reset_password',
    method: 'get',
    path: '/reset-password',
    controller: 'resetPassword',
  },
  {
    configKey: 'reset_password',
    method: 'post',
    path: '/reset-password',
    controller: 'processResetPassword',
  },
  {
    configKey: 'email_verification',
    method: 'get',
    path: '/email-verification',
    controller: 'emailVerification',
  },
  {
    method: 'post',
    path: '/email-verification/request',
    controller: 'requestEmailVerification',
  },
  {
    method: 'post',
    path: '/email-verification/resend',
    controller: 'resendEmailVerification',
  },
  {
    configKey: 'verify_email',
    method: 'get',
    path: '/verify-email',
    controller: 'verifyEmail',
  },
  {
    configKey: 'email_verification_success',
    method: 'get',
    path: '/email-verification-success',
    controller: 'emailVerificationSuccess',
  },
  {
    configKey: 'account_select',
    method: 'get',
    path: '/account-select',
    controller: 'accountSelect',
  },
  {
    configKey: 'continue',
    method: 'get',
    path: '/continue',
    controller: 'continueWithAccount',
  },
  {
    configKey: 'multi_factor',
    method: 'get',
    path: '/multi-factor',
    controller: 'multiFactor',
  },
  {
    configKey: 'mfa_verify',
    method: 'get',
    path: '/mfa-verify',
    controller: 'mfaVerify',
  },
  {
    configKey: 'mfa_verify',
    method: 'post',
    path: '/mfa-verify',
    controller: 'processMfaVerify',
  },
  {
    configKey: 'mfa_resend',
    method: 'post',
    path: '/mfa-resend',
    controller: 'resendMfaCode',
  },
  {
    configKey: 'mfa_select',
    method: 'get',
    path: '/mfa-select',
    controller: 'mfaSelect',
  },
  {
    configKey: 'mfa_select',
    method: 'post',
    path: '/mfa-select',
    controller: 'processMfaSelect',
  },
  {
    configKey: 'mfa_webauthn',
    method: 'get',
    path: '/mfa-webauthn',
    controller: 'mfaWebAuthn',
  },
  {
    method: 'post',
    path: '/mfa-webauthn/options',
    controller: 'mfaWebAuthnOptions',
  },
  {
    method: 'post',
    path: '/mfa-webauthn/verify',
    controller: 'processMfaWebAuthn',
  },
  {
    configKey: 'logout',
    method: 'get',
    path: '/logout',
    controller: 'logout',
  },
  {
    configKey: 'logout',
    method: 'post',
    path: '/logout',
    controller: 'logout',
  },
  {
    method: 'get',
    path: '/social/google/login',
    controller: 'socialLogin',
  },
  {
    method: 'get',
    path: '/social/google/register',
    controller: 'socialRegister',
  },
  {
    method: 'get',
    path: '/social/google/callback',
    controller: 'socialCallback',
  },
  {
    configKey: 'social_password_setup',
    method: 'get',
    path: '/social-password-setup',
    controller: 'socialPasswordSetup',
  },
  {
    configKey: 'social_password_setup',
    method: 'post',
    path: '/social-password-setup',
    controller: 'processSocialPasswordSetup',
  },
  {
    configKey: 'social_contact_info',
    method: 'get',
    path: '/social-contact-info',
    controller: 'socialContactInfo',
  },
  {
    configKey: 'social_contact_info',
    method: 'post',
    path: '/social-contact-info',
    controller: 'processSocialContactInfo',
  },
  {
    configKey: 'account_recovery',
    method: 'get',
    path: '/account-recovery',
    controller: 'accountRecovery',
  },
  {
    configKey: 'account_recovery',
    method: 'post',
    path: '/account-recovery',
    controller: 'processAccountRecovery',
  },
  {
    configKey: 'recovery_method_select',
    method: 'get',
    path: '/recovery-method-select',
    controller: 'recoveryMethodSelect',
  },
  {
    configKey: 'recovery_method_select',
    method: 'post',
    path: '/recovery-method-select',
    controller: 'processRecoveryMethodSelect',
  },
  {
    configKey: 'recovery_backup_codes',
    method: 'get',
    path: '/recovery-backup-codes',
    controller: 'recoveryBackupCodes',
  },
  {
    configKey: 'recovery_backup_codes',
    method: 'post',
    path: '/recovery-backup-codes',
    controller: 'processRecoveryBackupCodes',
  },
  {
    configKey: 'recovery_secondary_email',
    method: 'get',
    path: '/recovery-secondary-email',
    controller: 'recoverySecondaryEmail',
  },
  {
    configKey: 'recovery_secondary_email',
    method: 'post',
    path: '/recovery-secondary-email',
    controller: 'processRecoverySecondaryEmail',
  },
  {
    configKey: 'recovery_security_questions',
    method: 'get',
    path: '/recovery-security-questions',
    controller: 'recoverySecurityQuestions',
  },
  {
    configKey: 'recovery_security_questions',
    method: 'post',
    path: '/recovery-security-questions',
    controller: 'processRecoverySecurityQuestions',
  },
  {
    configKey: 'recovery_sms',
    method: 'get',
    path: '/recovery-sms',
    controller: 'recoverySms',
  },
  {
    configKey: 'recovery_sms',
    method: 'post',
    path: '/recovery-sms',
    controller: 'processRecoverySms',
  },
  {
    configKey: 'recovery_verify_code',
    method: 'get',
    path: '/recovery-verify-code',
    controller: 'recoveryVerifyCode',
  },
  {
    configKey: 'recovery_verify_code',
    method: 'post',
    path: '/recovery-verify-code',
    controller: 'processRecoveryVerifyCode',
  },
  {
    configKey: 'update_theme',
    method: 'post',
    path: '/update-theme',
    controller: 'updateTheme',
  },
  {
    configKey: 'update_locale',
    method: 'post',
    path: '/update-locale',
    controller: 'updateLocale',
  },
  {
    configKey: 'update_sidebar',
    method: 'post',
    path: '/update-sidebar',
    controller: 'updateSidebar',
  },
  {
    configKey: 'update_timezone',
    method: 'post',
    path: '/update-timezone',
    controller: 'updateTimezone',
  },
];

function traceMiddleware(label: string): RequestHandler {
  return (_req, res, next) => {
    const entries = (res.locals.trace ??= []) as string[];
    entries.push(label);
    next();
  };
}

function installJsonViewRenderer(app: express.Express): void {
  app.use((_req, res, next) => {
    res.render = ((view: string, locals: Record<string, unknown>) =>
      res.json({ view, locals })) as unknown as Response['render'];
    next();
  });
}

interface RouterOverrides {
  logger?: Record<string, ReturnType<typeof vi.fn>>;
  sessionManager?: Record<string, ReturnType<typeof vi.fn>>;
  tier1CompletionService?: { complete: ReturnType<typeof vi.fn> };
}

function makeRouter(
  login: string,
  marker: string,
  overrides: RouterOverrides = {}
) {
  const configManager = {
    getConfig: vi.fn(() => ({
      deployment: {
        routes: {
          auth_routes: { ...DEFAULT_AUTH_ROUTES, login },
        },
      },
      oidc: { path: '/oidc/v1' },
    })),
  };
  const securityMiddleware = {
    requireAuth: traceMiddleware('auth'),
    validateCsrfToken: traceMiddleware('csrf'),
  };
  const uiController =
    (controller: string): RequestHandler =>
    (_req, res) => {
      res.status(200).json({
        marker,
        controller,
        trace: res.locals.trace ?? [],
      });
    };
  const authController = new Proxy<Record<string, RequestHandler>>(
    {},
    {
      get:
        (_target, property) =>
        (_req: Request, res: Response): void => {
          res.status(200).json({
            marker,
            controller: String(property),
            trace: res.locals.trace ?? [],
          });
        },
    }
  );
  const sessionManager = overrides.sessionManager ?? {
    flash: vi.fn(() => ({
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    })),
    get: vi.fn(),
    regenerate: vi.fn(),
    setAuthenticated: vi.fn(),
  };
  const logger = overrides.logger ?? { info: vi.fn() };
  const tier1CompletionService = overrides.tier1CompletionService ?? {
    complete: vi.fn(),
  };

  return authRoutes(
    {} as never,
    configManager as never,
    securityMiddleware as never,
    {
      updateTheme: uiController('updateTheme'),
      updateLocale: uiController('updateLocale'),
      updateSidebar: uiController('updateSidebar'),
      updateTimezone: uiController('updateTimezone'),
    } as never,
    authController as never,
    tier1CompletionService as never,
    sessionManager as never,
    logger as never
  );
}

describe('authRoutes', () => {
  it('creates an isolated router for each configuration', async () => {
    makeRouter('/first-login', 'first');
    const secondRouter = makeRouter('/second-login', 'second');
    const app = express();
    app.use('/auth', secondRouter);

    const configuredRoute = await request(app).get('/auth/second-login');
    const leakedRoute = await request(app).get('/auth/first-login');

    expect(configuredRoute.status).toBe(200);
    expect(configuredRoute.body).toMatchObject({
      marker: 'second',
      controller: 'login',
    });
    expect(leakedRoute.status).toBe(404);
  });

  it('maps every configured authentication endpoint to its public handler', async () => {
    const app = express();
    app.use('/auth', makeRouter('/login', 'current'));

    for (const route of AUTH_ROUTE_CASES) {
      const response = await request(app)
        [route.method](`/auth${route.path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(
        response.status,
        `${route.method.toUpperCase()} ${route.path}`
      ).toBe(200);
      expect(response.body).toMatchObject({
        marker: 'current',
        controller: route.controller,
      });
    }
  });

  it.each([
    [
      'post',
      '/login',
      ['rate:login', 'rate:login:ip', 'rate:login:identifier-ip', 'csrf'],
    ],
    ['post', '/register', ['rate:register', 'csrf']],
    ['post', '/forgot-password', ['rate:forgot-password', 'csrf']],
    ['post', '/mfa-verify', ['rate:mfa', 'csrf']],
    ['post', '/mfa-webauthn/verify', ['rate:mfa', 'csrf']],
    ['post', '/account-recovery', ['rate:recovery', 'csrf']],
    ['get', '/social/google/login', ['rate:social']],
    ['post', '/email-verification/resend', ['auth', 'csrf']],
    ['post', '/update-theme', ['csrf']],
    ['get', '/login', []],
  ] as const)(
    'orders security middleware for %s %s',
    async (method, path, expectedTrace) => {
      const app = express();
      app.use('/auth', makeRouter('/login', 'current'));

      const response = await request(app)
        [method](`/auth${path}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.trace).toEqual(expectedTrace);
    }
  );

  it.each(['login', 'register', 'callback'])(
    'rejects unsupported social providers before %s processing',
    async endpoint => {
      const app = express();
      app.use('/auth', makeRouter('/login', 'current'));

      const response = await request(app).get(
        `/auth/social/unsupported/${endpoint}`
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/auth/login');
    }
  );

  it('renders a stable client error when Tier-1 social completion fails', async () => {
    const tier1CompletionService = {
      complete: vi.fn().mockResolvedValue({ success: false }),
    };
    const app = express();
    installJsonViewRenderer(app);
    app.use(
      '/auth',
      makeRouter('/login', 'current', { tier1CompletionService })
    );

    const response = await request(app).get(
      '/auth/social/google/complete?ref=00000000-0000-4000-8000-000000000000'
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      view: 'auth/oidc/error.njk',
      locals: {
        title: 'Authentication Failed',
        error: 'Social login could not be completed. Please try again.',
        redirectUrl: '/auth/login',
      },
    });
  });

  it('regenerates and authenticates a successful non-OIDC Tier-1 session', async () => {
    const user = { id: 'user-1', email: 'user@example.test' };
    const tier1CompletionService = {
      complete: vi.fn().mockResolvedValue({ success: true, user }),
    };
    const sessionManager = {
      flash: vi.fn(),
      get: vi.fn(),
      regenerate: vi.fn().mockResolvedValue(undefined),
      setAuthenticated: vi.fn(),
    };
    const app = express();
    app.use(
      '/auth',
      makeRouter('/login', 'current', {
        sessionManager,
        tier1CompletionService,
      })
    );

    const response = await request(app).get(
      '/auth/social/github/complete?ref=00000000-0000-4000-8000-000000000000'
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(sessionManager.regenerate).toHaveBeenCalledOnce();
    expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
      expect.anything(),
      { currentActiveLoggedUser: user }
    );
  });

  it('resumes the stored OIDC interaction after Tier-1 completion', async () => {
    const tier1CompletionService = {
      complete: vi.fn().mockResolvedValue({ success: true }),
    };
    const sessionManager = {
      flash: vi.fn(),
      get: vi.fn().mockReturnValue({ uid: 'interaction-123' }),
      regenerate: vi.fn().mockResolvedValue(undefined),
      setAuthenticated: vi.fn(),
    };
    const app = express();
    app.use(
      '/auth',
      makeRouter('/login', 'current', {
        sessionManager,
        tier1CompletionService,
      })
    );

    const response = await request(app).get(
      '/auth/social/microsoft/complete?ref=00000000-0000-4000-8000-000000000000'
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      '/oidc/v1/interaction/interaction-123'
    );
    expect(sessionManager.regenerate).toHaveBeenCalledOnce();
    expect(sessionManager.setAuthenticated).not.toHaveBeenCalled();
  });

  it('contains unexpected Tier-1 completion failures without leaking details', async () => {
    const tier1CompletionService = {
      complete: vi.fn().mockRejectedValue(new Error('sensitive provider data')),
    };
    const app = express();
    installJsonViewRenderer(app);
    app.use(
      '/auth',
      makeRouter('/login', 'current', { tier1CompletionService })
    );

    const response = await request(app).get(
      '/auth/social/apple/complete?ref=00000000-0000-4000-8000-000000000000'
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      view: 'auth/oidc/error.njk',
      locals: {
        title: 'Server Error',
        error: 'An unexpected error occurred. Please try again.',
        redirectUrl: '/auth/login',
      },
    });
    expect(response.text).not.toContain('sensitive provider data');
  });
});
