import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const activityMocks = vi.hoisted(() => ({
  failed: vi.fn(),
  factory: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
const identifierMocks = vi.hoisted(() => ({
  validate: vi.fn(),
}));

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

vi.mock('../../../src/utils/activity-logger.factory.js', () => ({
  activityLoggerFor: activityMocks.factory,
}));
vi.mock('../../../src/utils/custom-identifier-validation.js', () => ({
  validateIdentifier: identifierMocks.validate,
}));

import { AuthController } from '../../../src/controllers/auth.controller.js';
import type { IUser } from '../../../src/types/user.js';

const user = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-1' },
  username: 'alice',
  email: 'alice@example.test',
  email_verified: true,
  phone_number: '+22900000000',
  phone_number_verified: true,
  given_name: 'Alice',
  family_name: 'Doe',
  picture: '/alice.png',
  recovery: undefined as IUser['recovery'],
  roles: ['user'],
  ...overrides,
});

const pendingMfaUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  email_verified: true,
  given_name: 'Alice',
  family_name: 'Doe',
  full_name: 'Alice Doe',
  picture: '/alice.png',
  roles: ['user'],
  is_admin: false,
  mfa_method: 'totp',
  ...overrides,
});

const recoveryAttempt = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  username: 'alice',
  maskedIdentifier: 'al***@example.test',
  availableMethods: [
    { method: 'backup_codes', available: true, details: { remaining: 4 } },
    { method: 'sms', available: true, details: { phone: '+229***' } },
  ],
  timestamp: Date.now(),
  ...overrides,
});

const securityQuestionsUser = (overrides: Record<string, unknown> = {}) =>
  user({
    name: 'Alice Doe',
    recovery: {
      security_questions: {
        questions: [
          {
            id: 'question-1',
            question_key: 'first_pet',
            answer_hash: 'must-not-be-rendered',
          },
          {
            id: 'question-2',
            question_key: 'birth_city',
            answer_hash: 'must-not-be-rendered',
          },
        ],
      },
    },
    ...overrides,
  });

const backupCodesUser = (overrides: Record<string, unknown> = {}) =>
  user({
    _id: 'user-1',
    name: 'Alice Doe',
    recovery: {
      enabled: true,
      methods: ['backup_codes'],
      backup_codes: {
        codes: ['hash-one', 'hash-two', 'hash-three', 'hash-four'],
        generated_at: new Date('2026-08-01T00:00:00.000Z'),
      },
      lockout: { failed_attempts: 0 },
    },
    ...overrides,
  });

const secondaryEmailUser = (overrides: Record<string, unknown> = {}) =>
  user({
    _id: 'user-1',
    name: 'Alice Doe',
    recovery: {
      enabled: true,
      methods: ['secondary_email'],
      secondary_email: {
        email: 'secondary@example.test',
        verified: true,
      },
    },
    ...overrides,
  });

function makeHarness() {
  const session = new Map<string, unknown>();
  const flash = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  };
  const config = {
    application: { title: 'Parako' },
    branding: {
      companyName: 'Parako Inc.',
      logo: '/parako.svg',
    },
    deployment: {
      url: 'https://id.example.test',
      routes: {
        auth: '/auth',
        auth_routes: {
          login: '/login',
          register: '/register',
          account_select: '/account-select',
          mfa_select: '/mfa/select',
          mfa_verify: '/mfa/verify',
          mfa_webauthn: '/mfa/webauthn',
          account_recovery: '/account-recovery',
          email_verification: '/email-verification',
          email_verification_success: '/email-verification/success',
          forgot_password: '/forgot-password',
          verify_email: '/verify-email',
          reset_password: '/reset-password',
          recovery_backup_codes: '/recovery/backup-codes',
          recovery_method_select: '/recovery/method-select',
          recovery_secondary_email: '/recovery/secondary-email',
          recovery_security_questions: '/recovery/security-questions',
          recovery_sms: '/recovery/sms',
          recovery_verify_code: '/recovery/verify-code',
          social_contact_info: '/social/contact-info',
          social_password_setup: '/social/password-setup',
        },
        accounts: '/accounts',
        account_routes: { dashboard: '/dashboard', settings: '/settings' },
      },
    },
    oidc: { path: '/oidc/v1' },
    features: {
      social_providers: {
        behavior: {
          existing_user_no_integration: 'link',
          no_user_account: 'register',
          missing_contact_info: 'redirect_to_form',
          require_password_on_registration: true,
          options: {
            allow_multiple_providers: true,
            auto_verify_email: false,
            show_helpful_errors: true,
            max_providers_per_user: 3,
          },
        },
      },
    },
    security: {
      authentication: {
        login: {
          login_methods: ['email', 'phone', 'custom_identifier'],
        },
        signup: {
          signup_methods: ['email', 'phone', 'custom_identifier'],
          require_email_verification: true,
          require_phone_verification: false,
          auto_approval: {
            enabled: false,
            domains_whitelist: [] as string[],
          },
          contact_channels: {
            require_at_least_one: true,
            email: { enabled: true, required: false },
            phone: { enabled: true, required: false },
            full_name: { enabled: true, required: true },
          },
        },
        custom_identifiers: { enabled: false },
        session: { notify_new_session: false },
      },
    },
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const authService = {
    generateEmailVerificationToken: vi
      .fn()
      .mockResolvedValue({ verificationToken: 'verification-token' }),
    generatePasswordResetToken: vi.fn(),
    isValidEmailAddress: vi.fn().mockReturnValue(true),
    loginWithCustomIdentifier: vi.fn(),
    loginWithEmail: vi.fn(),
    loginWithPhoneNumber: vi.fn(),
    registerUser: vi.fn(),
    resetPassword: vi.fn(),
    verifyEmail: vi.fn(),
    verifyTotp: vi.fn(),
  };
  const userService = {
    findByUsername: vi.fn(),
    findByPhoneNumber: vi.fn(),
    findByPhoneNumberIncludingDisabled: vi.fn(),
    findByCustomIdentifier: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByEmailIncludingDisabled: vi.fn(),
    findOne: vi.fn(),
    getCustomIdentifierFields: vi.fn().mockReturnValue([]),
    getPasswordPolicy: vi.fn().mockReturnValue({ min_length: 12 }),
    isCustomIdentifierAvailable: vi.fn().mockResolvedValue(true),
    createUserWithGeneratedUsername: vi.fn(),
    setEmailOtp: vi.fn().mockResolvedValue(undefined),
    validatePassword: vi.fn().mockReturnValue({ isValid: true, messages: [] }),
    verifyEmailOtp: vi.fn(),
    updateById: vi.fn(),
  };
  const notificationService = {
    sendBackupCodeWarning: vi.fn().mockResolvedValue(undefined),
    sendNewSessionAlert: vi.fn().mockResolvedValue(undefined),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    sendSecurityAlert: vi.fn().mockResolvedValue(undefined),
    sendTemplatedEmail: vi.fn().mockResolvedValue(undefined),
    sendVerification: vi.fn().mockResolvedValue(undefined),
  };
  const viewResolver = {
    views: {
      auth: {
        account_select: 'auth/account-select',
        account_recovery: 'auth/account-recovery',
        email_verification: 'auth/email-verification',
        email_verification_success: 'auth/email-verification-success',
        forgot_password: 'auth/forgot-password',
        mfa_verify: 'auth/mfa-verify',
        mfa_no_fallback: 'auth/mfa-no-fallback',
        mfa_select: 'auth/mfa-select',
        mfa_webauthn: 'auth/mfa-webauthn',
        multi_factor: 'auth/multi-factor',
        logout: 'auth/logout',
        register: 'auth/register',
        reset_password: 'auth/reset-password',
        recovery_backup_codes: 'auth/recovery-backup-codes',
        recovery_method_select: 'auth/recovery-method-select',
        recovery_secondary_email: 'auth/recovery-secondary-email',
        recovery_security_questions: 'auth/recovery-security-questions',
        recovery_sms: 'auth/recovery-sms',
        recovery_verify_code: 'auth/recovery-verify-code',
        social_callback: 'auth/social-callback',
        social_contact_info: 'auth/social-contact-info',
        social_password_setup: 'auth/social-password-setup',
      },
      home: { index: 'home/index' },
    },
  };
  const sessionManager = {
    addAuthenticatedUser: vi.fn().mockReturnValue({ success: true }),
    clearAuthenticationData: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
    flash: vi.fn().mockReturnValue(flash),
    getActiveUser: vi.fn(),
    getAuthenticatedUsers: vi.fn(),
    isAuthenticated: vi.fn().mockResolvedValue(false),
    get: vi.fn((_req, key: string) => session.get(key)),
    regenerate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn((_req, key: string) => session.delete(key)),
    removeAuthenticatedUser: vi.fn(),
    set: vi.fn((_req, key: string, value: unknown) => session.set(key, value)),
    setAuthenticated: vi.fn(),
    switchUser: vi.fn(),
  };
  const redirectChain = {
    or: vi.fn(),
    to: vi.fn(),
    withOptions: vi.fn(),
  };
  redirectChain.to.mockReturnValue(redirectChain);
  redirectChain.withOptions.mockReturnValue(redirectChain);
  const redirectAuthority = {
    buildRedirectUrl: vi.fn((url: string) => url),
    getIntent: vi.fn(),
    redirect: vi.fn().mockReturnValue(redirectChain),
    storeIntent: vi.fn().mockResolvedValue(true),
  };
  const socialLoginManager = {
    getAvailableProviders: vi.fn().mockReturnValue(['github']),
    getAuthorizationUrl: vi.fn().mockResolvedValue('https://github.test/auth'),
    handleCallback: vi.fn(),
    isProviderAvailable: vi.fn().mockReturnValue(true),
    linkToUser: vi.fn(),
  };
  const passwordUtils = {
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  };
  const mfaUtils = {
    generateEmailOtp: vi.fn().mockReturnValue({ code: '123456' }),
    getEnabledMethodsObject: vi.fn().mockReturnValue({ email: true }),
    getPreferredMethod: vi.fn().mockReturnValue('totp'),
    isMfaEnabled: vi.fn().mockReturnValue(false),
    maskEmail: vi.fn().mockReturnValue('a***@example.test'),
    needsMethodSelection: vi.fn().mockReturnValue(false),
  };
  const configManager = { getConfig: vi.fn().mockReturnValue(config) };
  const oidcAdapter = {
    accessToken: {
      deleteByAccountId: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    },
    grant: {
      deleteGrantsByAccountId: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    },
    interaction: {
      deleteByAccountId: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    },
    refreshToken: {
      deleteByAccountId: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    },
    session: {
      deleteSessionsByIds: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      findByAccountId: vi.fn().mockResolvedValue([]),
      revokeAllSessionsExcept: vi.fn().mockResolvedValue(0),
    },
  };
  const recoveryService = {
    getAvailableMethods: vi.fn(),
    verifySecurityQuestions: vi.fn(),
  };
  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn().mockReturnValue({
      ip: '127.0.0.1',
      user_agent: 'vitest',
    }),
  };
  const recoveryUtils = {
    checkRecoveryLockout: vi.fn().mockReturnValue({ locked: false }),
    checkSecurityQuestionsLockout: vi.fn().mockReturnValue({
      locked: false,
      minutesRemaining: 0,
      remainingAttempts: 3,
    }),
    clearRecoveryLockout: vi.fn(),
    generateSmsVerificationCode: vi.fn(),
    getLockoutConfig: vi.fn().mockReturnValue({ maxAttempts: 5 }),
    recordFailedRecoveryAttempt: vi.fn(),
    setLastRecoveredAt: vi.fn(),
    verifyUserBackupCode: vi.fn(),
  };
  const smsService = {
    sendRecoveryCode: vi.fn(),
  };
  const oidcUtils = {
    detectIdentifierType: vi.fn().mockReturnValue('email'),
  };
  const webauthnService = {
    generateAuthenticationOptions: vi.fn(),
    getCredentials: vi.fn(),
    verifyAuthentication: vi.fn(),
  };
  const controller = new AuthController(
    logger as never,
    authService as never,
    userService as never,
    {} as never,
    notificationService as never,
    viewResolver as never,
    sessionManager as never,
    redirectAuthority as never,
    clientDeviceInfoManager as never,
    socialLoginManager as never,
    passwordUtils as never,
    mfaUtils as never,
    recoveryUtils as never,
    configManager as never,
    oidcAdapter as never,
    recoveryService as never,
    smsService as never,
    webauthnService as never,
    oidcUtils as never
  );

  return {
    authService,
    clientDeviceInfoManager,
    config,
    controller,
    flash,
    logger,
    mfaUtils,
    notificationService,
    oidcAdapter,
    oidcUtils,
    passwordUtils,
    redirectAuthority,
    redirectChain,
    recoveryService,
    recoveryUtils,
    session,
    sessionManager,
    smsService,
    socialLoginManager,
    userService,
    webauthnService,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const req = {
    body: {},
    headers: {},
    ip: '127.0.0.1',
    originalUrl: '/auth/login',
    query: {},
    session: { id: 'session-1' },
    t: vi.fn((key: string) => key),
    ...overrides,
  };
  return req as typeof req & Request;
}

function response() {
  const res = {
    json: vi.fn(),
    locals: {} as Record<string, unknown>,
    redirect: vi.fn(),
    render: vi.fn(),
    set: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as typeof res & Response;
}

describe('AuthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.factory.mockReturnValue({
      failed: activityMocks.failed,
      info: activityMocks.info,
      success: activityMocks.success,
      warning: activityMocks.warning,
    });
    identifierMocks.validate.mockReturnValue(true);
  });

  describe('login', () => {
    it('renders login with stored intent, one-time step state, and social providers', async () => {
      const {
        controller,
        redirectAuthority,
        session,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      session.set('stepMessage', ' Previous step ');
      const req = request({
        query: {
          continue: 'https://rp.example.test/callback',
          intent: 'add-account',
          prompt: 'login',
        },
      });
      const res = response();

      await controller.login(req, res);

      expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
        req,
        'https://rp.example.test/callback',
        'login'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(req, 'stepMessage');
      expect(session.get('stepMessage')).toBe(
        'Select a method to add an account'
      );
      expect(socialLoginManager.getAvailableProviders).toHaveBeenCalledOnce();
      expect(res.render).toHaveBeenCalledWith('home/index', {
        title: 'Sign In - Parako',
        message: 'Welcome to Parako!',
        stepMessage: 'Select a method to add an account',
        continueUrl: 'https://rp.example.test/callback',
        prompt: 'login',
        socialProviders: { enabled: ['github'] },
      });
    });

    it('uses query fallbacks without storing an absent continue URL', async () => {
      const { controller, logger, redirectAuthority, sessionManager } =
        makeHarness();
      const req = request({
        query: { redirectTo: '', step_message: '  Continue here  ' },
        session: undefined,
      });
      const res = response();

      await controller.login(req, res);

      expect(redirectAuthority.storeIntent).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'LOGIN: No continue URL provided',
        expect.objectContaining({ sessionId: 'no-session' })
      );
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'stepMessage',
        '  Continue here  '
      );
      expect(res.render).toHaveBeenCalledWith(
        'home/index',
        expect.objectContaining({ stepMessage: 'Continue here' })
      );
    });

    it('stores a redirect intent without optional session or step state', async () => {
      const { controller, redirectAuthority, sessionManager } = makeHarness();
      const req = request({
        query: { redirectTo: 'https://rp.example.test/callback' },
        session: undefined,
      });
      const res = response();

      await controller.login(req, res);

      expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
        req,
        'https://rp.example.test/callback',
        'login'
      );
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'home/index',
        expect.objectContaining({ stepMessage: '' })
      );
    });

    it('exposes the configured social-login behavior', () => {
      const { controller } = makeHarness();

      expect(controller.getSocialBehaviorConfig()).toEqual({
        existingUserNoIntegration: 'link',
        noUserAccount: 'register',
        missingContactInfo: 'redirect_to_form',
        requirePasswordOnRegistration: true,
        allowMultipleProviders: true,
        autoVerifyEmail: false,
        showHelpfulErrors: true,
        maxProvidersPerUser: 3,
      });
    });

    it.each([
      ['email', { email: 'alice@example.test' }],
      ['phone', { phone: '+22900000000' }],
    ])(
      'applies the configured login-method allowlist to the legacy %s field',
      async (method, body) => {
        const { authService, config, controller, flash } = makeHarness();
        config.security.authentication.login.login_methods = [
          'custom_identifier',
        ];
        authService.loginWithEmail.mockResolvedValue(user());
        authService.loginWithPhoneNumber.mockResolvedValue(user());
        const res = response();

        await controller.processLogin(request({ body }), res);

        expect(authService.loginWithEmail).not.toHaveBeenCalled();
        expect(authService.loginWithPhoneNumber).not.toHaveBeenCalled();
        expect(flash.error).toHaveBeenCalledWith(
          'This login method is not available.'
        );
        expect(res.redirect).toHaveBeenCalledWith('/auth/login');
        expect(method).toBeTypeOf('string');
      }
    );

    it.each([
      ['legacy email', { email: 'alice@example.test' }, 'email', undefined],
      ['legacy phone', { phone: '+22900000000' }, 'phone', undefined],
      ['unified email', { login: 'alice@example.test' }, 'email', 'email'],
      ['unified phone', { login: '+22900000000' }, 'phone', 'phone'],
      ['custom identifier', { login: 'member-42' }, 'custom', { slot: 2 }],
    ])(
      'authenticates an allowed %s identifier',
      async (_label, body, expectedService, detectedMethod) => {
        const { authService, controller, oidcUtils, sessionManager } =
          makeHarness();
        if (detectedMethod !== undefined) {
          oidcUtils.detectIdentifierType.mockReturnValue(detectedMethod);
        }
        authService.loginWithEmail.mockResolvedValue(user());
        authService.loginWithPhoneNumber.mockResolvedValue(user());
        authService.loginWithCustomIdentifier.mockResolvedValue(user());
        const res = response();

        await controller.processLogin(
          request({ body: { ...body, password: 'secret' } }),
          res
        );

        if (expectedService === 'email') {
          expect(authService.loginWithEmail).toHaveBeenCalledWith(
            Object.values(body)[0],
            'secret'
          );
        } else if (expectedService === 'phone') {
          expect(authService.loginWithPhoneNumber).toHaveBeenCalledWith(
            Object.values(body)[0],
            'secret'
          );
        } else {
          expect(authService.loginWithCustomIdentifier).toHaveBeenCalledWith(
            2,
            'member-42',
            'secret'
          );
        }
        expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
          expect.anything(),
          {
            currentActiveLoggedUser: expect.objectContaining({
              id: 'user-1',
              username: 'alice',
              full_name: 'Alice Doe',
              roles: ['user'],
              is_admin: false,
            }),
          }
        );
        expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('rejects a disallowed unified identifier before authentication', async () => {
      const { authService, config, controller, flash, oidcUtils } =
        makeHarness();
      config.security.authentication.login.login_methods = ['phone'];
      oidcUtils.detectIdentifierType.mockReturnValue('email');
      const res = response();

      await controller.processLogin(
        request({ body: { login: 'alice@example.test', password: 'secret' } }),
        res
      );

      expect(authService.loginWithEmail).not.toHaveBeenCalled();
      expect(flash.error).toHaveBeenCalledWith(
        'This login method is not available.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('rejects missing identifiers and invalid credentials with distinct outcomes', async () => {
      const missing = makeHarness();
      const missingRes = response();
      await missing.controller.processLogin(request(), missingRes);
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'login_failed',
        null,
        'Login failed: No identifier provided',
        expect.anything()
      );
      expect(missing.flash.error).toHaveBeenCalledWith(
        'Please provide an email, phone number, or identifier.'
      );

      vi.clearAllMocks();
      activityMocks.factory.mockReturnValue({
        failed: activityMocks.failed,
        info: activityMocks.info,
        success: activityMocks.success,
        warning: activityMocks.warning,
      });
      const invalid = makeHarness();
      invalid.authService.loginWithEmail.mockResolvedValue(null);
      const invalidRes = response();
      await invalid.controller.processLogin(
        request({ body: { email: 'nobody@example.test' } }),
        invalidRes
      );
      expect(invalidRes.locals.loginFailed).toBe(true);
      expect(invalid.flash.error).toHaveBeenCalledWith(
        'Invalid credentials. Please try again.'
      );
      expect(invalidRes.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('stores boolean account state and safe defaults for a user without roles', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(
        user({
          _id: undefined,
          email_verified: undefined,
          phone_number: undefined,
          phone_number_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: undefined,
        })
      );

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        response()
      );

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            id: '',
            email_verified: false,
            phone_number: '',
            phone_number_verified: false,
            given_name: '',
            family_name: '',
            full_name: '',
            picture: '',
            roles: ['user'],
            is_admin: false,
          }),
        }
      );
    });

    it('stores MFA-safe defaults when optional profile fields are absent', async () => {
      const {
        authService,
        controller,
        mfaUtils,
        notificationService,
        session,
      } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(
        user({
          _id: undefined,
          email: undefined,
          email_verified: undefined,
          phone_number: undefined,
          phone_number_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: undefined,
        })
      );
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.getPreferredMethod.mockReturnValue('email');
      const res = response();

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(session.get('pendingMfaUser')).toEqual(
        expect.objectContaining({
          id: '',
          email_verified: false,
          phone_number: '',
          phone_number_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
          roles: ['user'],
          is_admin: false,
        })
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        '',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({ username: '' })
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('stores an MFA-safe user and redirects to method selection when needed', async () => {
      const { authService, controller, mfaUtils, session } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(
        user({
          email_verified: false,
          phone_number: undefined,
          phone_number_verified: undefined,
          picture: undefined,
          roles: ['admin'],
        })
      );
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.needsMethodSelection.mockReturnValue(true);
      mfaUtils.getEnabledMethodsObject.mockReturnValue({
        email: true,
        totp: true,
      });
      const res = response();

      await controller.processLogin(
        request({
          body: {
            email: 'alice@example.test',
            remember_me: 'on',
            continue: 'https://rp.example.test/callback',
          },
        }),
        res
      );

      expect(session.get('pendingMfaUser')).toEqual(
        expect.objectContaining({
          id: 'user-1',
          email_verified: false,
          phone_number: '',
          phone_number_verified: false,
          picture: '',
          roles: ['admin'],
          is_admin: true,
          remember_me: 'on',
          continue_url: 'https://rp.example.test/callback',
        })
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/select');
    });

    it('sends email MFA and contains delivery failures', async () => {
      const successful = makeHarness();
      successful.authService.loginWithEmail.mockResolvedValue(user());
      successful.mfaUtils.isMfaEnabled.mockReturnValue(true);
      successful.mfaUtils.getPreferredMethod.mockReturnValue('email');
      const successRes = response();

      await successful.controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        successRes
      );

      expect(successful.userService.setEmailOtp).toHaveBeenCalledWith(
        'alice',
        '123456',
        600
      );
      expect(
        successful.notificationService.sendTemplatedEmail
      ).toHaveBeenCalledWith(
        'alice@example.test',
        'Your Parako login code',
        'email/mail.njk',
        expect.objectContaining({ username: 'Alice Doe' })
      );
      expect(successRes.redirect).toHaveBeenCalledWith('/auth/mfa/verify');

      const failed = makeHarness();
      failed.authService.loginWithEmail.mockResolvedValue(user());
      failed.mfaUtils.isMfaEnabled.mockReturnValue(true);
      failed.mfaUtils.getPreferredMethod.mockReturnValue('email');
      failed.userService.setEmailOtp.mockRejectedValue(new Error('offline'));
      const failedRes = response();

      await failed.controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        failedRes
      );

      expect(failed.flash.error).toHaveBeenCalledWith(
        'Failed to send verification code. Please try again.'
      );
      expect(failedRes.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      ['webauthn', '/auth/mfa/webauthn'],
      ['totp', '/auth/mfa/verify'],
    ])('routes %s MFA to its verification page', async (method, target) => {
      const { authService, controller, mfaUtils } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user());
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.getPreferredMethod.mockReturnValue(method);
      const res = response();

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(target);
    });

    it.each([
      ['success', { success: true }, undefined],
      [
        'session limit',
        { success: false, reason: 'max_limit_reached' },
        'Maximum number of accounts per session reached.',
      ],
      [
        'duplicate account',
        { success: false, reason: 'already_exists' },
        'This account is already signed in.',
      ],
    ])(
      'handles add-account intent %s',
      async (_label, addResult, expectedMessage) => {
        const { authService, controller, flash, session, sessionManager } =
          makeHarness();
        authService.loginWithEmail.mockResolvedValue(user());
        session.set('addAccountIntent', {
          addingAccount: true,
          returnUrl: '/return',
        });
        sessionManager.addAuthenticatedUser.mockReturnValue(addResult);
        const req = request({ body: { email: 'alice@example.test' } });
        const res = response();

        await controller.processLogin(req, res);

        expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
          req,
          expect.objectContaining({ username: 'alice' }),
          true
        );
        if (expectedMessage) {
          expect(flash.info).toHaveBeenCalledWith(expectedMessage);
          expect(activityMocks.warning).toHaveBeenCalled();
        } else {
          expect(activityMocks.success).toHaveBeenCalledWith(
            'account_added',
            expect.anything(),
            'Account added to session',
            expect.anything()
          );
        }
        expect(sessionManager.remove).toHaveBeenCalledWith(
          req,
          'addAccountIntent'
        );
        expect(res.redirect).toHaveBeenCalledWith('/return');
      }
    );

    it('uses the dashboard when add-account intent has no return URL', async () => {
      const { authService, controller, session } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user());
      session.set('addAccountIntent', { addingAccount: true });
      const res = response();

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it.each([
      ['success', { success: true }, undefined, 'Account added successfully.'],
      [
        'session limit',
        { success: false, reason: 'max_limit_reached' },
        'Maximum number of accounts per session reached.',
        undefined,
      ],
      [
        'duplicate account',
        { success: false, reason: 'already_exists' },
        'This account is already signed in.',
        undefined,
      ],
    ])(
      'handles OIDC continue account addition %s',
      async (_label, addResult, infoMessage, successMessage) => {
        const {
          authService,
          controller,
          flash,
          redirectChain,
          sessionManager,
        } = makeHarness();
        authService.loginWithEmail.mockResolvedValue(user());
        sessionManager.addAuthenticatedUser.mockReturnValue(addResult);
        sessionManager.enforceSessionLimit.mockRejectedValue(
          new Error('store offline')
        );
        const res = response();

        await controller.processLogin(
          request({
            body: {
              email: 'alice@example.test',
              continue: 'https://rp.example.test/callback',
            },
          }),
          res
        );

        if (infoMessage) {
          expect(flash.info).toHaveBeenCalledWith(infoMessage);
          expect(activityMocks.warning).toHaveBeenCalled();
        }
        if (successMessage) {
          expect(flash.success).toHaveBeenCalledWith(successMessage);
        }
        expect(redirectChain.to).toHaveBeenCalledWith(
          'https://rp.example.test/callback'
        );
        expect(redirectChain.or).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('uses a stored redirect intent after session hardening and notification', async () => {
      const {
        authService,
        config,
        controller,
        notificationService,
        redirectAuthority,
        redirectChain,
        sessionManager,
      } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user());
      config.security.authentication.session.notify_new_session = true;
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      redirectAuthority.buildRedirectUrl.mockReturnValue(
        'https://rp.example.test/callback?status=authenticated'
      );
      const req = request({
        body: { email: 'alice@example.test' },
        headers: { 'user-agent': 'test-browser' },
      });
      const res = response();

      await controller.processLogin(req, res);

      expect(redirectAuthority.getIntent).toHaveBeenCalledWith(
        req,
        'login',
        true
      );
      expect(sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(sessionManager.enforceSessionLimit).toHaveBeenCalledWith(
        'alice',
        'session-1'
      );
      expect(notificationService.sendNewSessionAlert).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'alice' },
        expect.objectContaining({
          ip: '127.0.0.1',
          userAgent: 'test-browser',
          timestamp: expect.any(Date),
        })
      );
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        { email: 'alice@example.test', status: 'authenticated' }
      );
      expect(redirectChain.to).toHaveBeenCalledWith(
        'https://rp.example.test/callback?status=authenticated'
      );
    });

    it('builds a stored redirect without optional email or notification', async () => {
      const {
        authService,
        config,
        controller,
        notificationService,
        redirectAuthority,
      } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user({ email: undefined }));
      config.security.authentication.session.notify_new_session = true;
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        response()
      );

      expect(notificationService.sendNewSessionAlert).not.toHaveBeenCalled();
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        { email: '', status: 'authenticated' }
      );
    });

    it('contains stored-intent session and notification failures', async () => {
      const {
        authService,
        config,
        controller,
        logger,
        notificationService,
        redirectAuthority,
        redirectChain,
        sessionManager,
      } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user());
      config.security.authentication.session.notify_new_session = true;
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      redirectAuthority.buildRedirectUrl.mockReturnValue(
        'https://rp.example.test/callback?status=authenticated'
      );
      sessionManager.regenerate.mockRejectedValue(new Error('regenerate'));
      sessionManager.enforceSessionLimit.mockRejectedValue(new Error('limit'));
      notificationService.sendNewSessionAlert.mockRejectedValue(
        new Error('mail')
      );
      const req = request({
        body: { email: 'alice@example.test' },
        headers: {},
        ip: undefined,
      });

      await controller.processLogin(req, response());

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session during login',
      });
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to enforce session limit during login',
      });
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to send new session notification',
      });
      expect(notificationService.sendNewSessionAlert).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'alice' },
        expect.objectContaining({ ip: 'unknown', userAgent: 'unknown' })
      );
      expect(redirectChain.to).toHaveBeenCalledWith(
        'https://rp.example.test/callback?status=authenticated'
      );
    });

    it('contains session-hardening and notification failures during normal login', async () => {
      const {
        authService,
        config,
        controller,
        logger,
        notificationService,
        sessionManager,
      } = makeHarness();
      authService.loginWithEmail.mockResolvedValue(user());
      config.security.authentication.session.notify_new_session = true;
      sessionManager.regenerate.mockRejectedValue(new Error('regenerate'));
      sessionManager.enforceSessionLimit.mockRejectedValue(new Error('limit'));
      notificationService.sendNewSessionAlert.mockRejectedValue(
        new Error('mail')
      );
      const res = response();

      await controller.processLogin(
        request({
          body: { email: 'alice@example.test' },
          ip: undefined,
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledTimes(3);
      expect(notificationService.sendNewSessionAlert).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'alice' },
        expect.objectContaining({ ip: 'unknown', userAgent: 'unknown' })
      );
      expect(sessionManager.setAuthenticated).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it.each([
      [new Error('authentication offline'), 'authentication offline'],
      ['authentication offline', 'An unexpected error occurred during login.'],
    ])('contains login failure %j', async (failure, expectedMessage) => {
      const { authService, controller, flash, logger } = makeHarness();
      authService.loginWithEmail.mockRejectedValue(failure);
      const res = response();

      await controller.processLogin(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(res.locals.loginFailed).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'login_error',
      });
      expect(flash.error).toHaveBeenCalledWith(expectedMessage);
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });

  describe('registration', () => {
    it('renders registration with policy, intent, trimmed prefills, and configured channels', async () => {
      const { config, controller, logger, redirectAuthority, userService } =
        makeHarness();
      const req = request({
        query: {
          continue: 'https://rp.example.test/callback',
          email: '  alice@example.test  ',
          step_message: '  Create an account  ',
        },
        session: undefined,
      });
      const res = response();

      await controller.register(req, res);

      expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
        req,
        'https://rp.example.test/callback',
        'register'
      );
      expect(userService.getPasswordPolicy).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(
        'REGISTRATION: Attempting to store redirect intent',
        expect.objectContaining({ sessionId: 'no-session' })
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({
          title: 'Register - Parako',
          message: 'Register',
          passwordPolicy: { min_length: 12 },
          registrationConfig: {
            signupMethods: ['email', 'phone', 'custom_identifier'],
            requireEmailVerification: true,
            requirePhoneVerification: false,
            autoApproval: { enabled: false, domainsWhitelist: [] },
          },
          contactChannels:
            config.security.authentication.signup.contact_channels,
          prefilledEmail: 'alice@example.test',
          stepMessage: 'Create an account',
        })
      );
    });

    it('uses safe registration-channel defaults and logs absent intents', async () => {
      const { config, controller, logger, redirectAuthority } = makeHarness();
      config.security.authentication.signup.contact_channels =
        undefined as never;
      const res = response();

      await controller.register(
        request({ query: {}, session: undefined }),
        res
      );

      expect(redirectAuthority.storeIntent).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'REGISTRATION: No continue URL provided',
        expect.objectContaining({ sessionId: 'no-session' })
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({
          contactChannels: {
            require_at_least_one: true,
            email: { enabled: true, required: false },
            phone: { enabled: true, required: false },
          },
        })
      );
    });

    it('rejects missing configured credentials and preserves form state', async () => {
      const { config, controller, flash } = makeHarness();
      config.security.authentication.signup.signup_methods = ['email'];
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            password: 'valid-password',
            step_message: 'Continue',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Please provide a valid email.');
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({
          prefilledEmail: '',
          stepMessage: 'Continue',
        })
      );
    });

    it('treats malformed registration contacts as missing credentials', async () => {
      const { authService, config, controller, flash } = makeHarness();
      config.security.authentication.signup.signup_methods = ['email'];
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: ['alice@example.test'],
            password: ['valid-password'],
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Please provide a valid email.');
      expect(authService.registerUser).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({ prefilledEmail: '' })
      );
    });

    it('describes all configured credential choices when registration data is missing', async () => {
      const { config, controller, flash } = makeHarness();
      config.security.authentication.signup.signup_methods = [
        'phone',
        'custom_identifier',
      ];

      await controller.processRegister(
        request({
          body: { fullname: 'Alice Doe', password: 'valid-password' },
        }),
        response()
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Please provide a valid phone number or custom_identifier.'
      );
    });

    it('uses safe channel defaults and query step state while processing registration', async () => {
      const { authService, config, controller, logger } = makeHarness();
      config.security.authentication.signup.signup_methods = ['email'];
      config.security.authentication.signup.contact_channels =
        undefined as never;
      config.security.authentication.signup.require_email_verification = false;
      authService.registerUser.mockResolvedValue(
        user({ email_verified: true })
      );

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'valid-password',
          },
          query: { step_message: 'From query' },
          session: undefined,
        }),
        response()
      );

      expect(logger.info).toHaveBeenCalledWith(
        'REGISTRATION: Processing registration with redirect check',
        expect.objectContaining({ sessionId: 'no-session' })
      );
      expect(authService.registerUser).toHaveBeenCalled();
    });

    it('registers with an allowed phone credential', async () => {
      const { authService, config, controller } = makeHarness();
      config.security.authentication.signup.signup_methods = ['phone'];
      config.security.authentication.signup.contact_channels.email.required = false;
      authService.registerUser.mockResolvedValue(
        user({ email: undefined, phone_number: '+22997000000' })
      );
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            phone: '+22997000000',
            password: 'valid-password',
          },
        }),
        res
      );

      expect(authService.registerUser).toHaveBeenCalledWith({
        email: undefined,
        phone_number: '+22997000000',
        password: 'valid-password',
        given_name: 'Alice',
        family_name: 'Doe',
        register_with: 'phone_number',
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('registers with a custom credential and ignores admin-only form data', async () => {
      const { authService, config, controller, userService } = makeHarness();
      config.security.authentication.signup.signup_methods = [
        'custom_identifier',
      ];
      config.security.authentication.signup.contact_channels = {
        require_at_least_one: false,
        email: { enabled: true, required: false },
        phone: { enabled: true, required: false },
        full_name: { enabled: true, required: true },
      };
      config.security.authentication.custom_identifiers.enabled = true;
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'user_editable',
          required_for_registration: true,
          case_sensitive: false,
        },
        {
          slot: 2,
          name: 'Internal ID',
          edit_policy: 'admin_only',
          required_for_registration: true,
          case_sensitive: true,
        },
      ]);
      identifierMocks.validate.mockReturnValue(true);
      authService.registerUser.mockResolvedValue(user({ email: undefined }));
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            password: 'valid-password',
            custom_identifier_1: ' MEMBER-42 ',
            custom_identifier_2: 'must-not-be-accepted',
          },
        }),
        res
      );

      expect(authService.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({
          custom_identifier_1: 'member-42',
          register_with: 'phone_number',
        })
      );
      expect(authService.registerUser).toHaveBeenCalledWith(
        expect.not.objectContaining({ custom_identifier_2: expect.anything() })
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('treats malformed custom credentials as missing registration data', async () => {
      const { authService, config, controller, flash, userService } =
        makeHarness();
      config.security.authentication.signup.signup_methods = [
        'custom_identifier',
      ];
      config.security.authentication.signup.contact_channels = {
        require_at_least_one: false,
        email: { enabled: true, required: false },
        phone: { enabled: true, required: false },
        full_name: { enabled: true, required: false },
      };
      config.security.authentication.custom_identifiers.enabled = true;
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'user_editable',
          required_for_registration: true,
          case_sensitive: false,
        },
      ]);
      const res = response();

      await controller.processRegister(
        request({
          body: {
            password: 'valid-password',
            custom_identifier_1: ['member-42'],
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Please provide a valid custom_identifier.'
      );
      expect(authService.registerUser).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({ prefilledEmail: '' })
      );
    });

    it('enforces email and at-least-one contact policies after a valid custom credential', async () => {
      const { authService, config, controller, flash, userService } =
        makeHarness();
      config.security.authentication.signup.signup_methods = [
        'custom_identifier',
      ];
      config.security.authentication.signup.contact_channels = {
        require_at_least_one: true,
        email: { enabled: true, required: true },
        phone: { enabled: true, required: false },
        full_name: { enabled: true, required: false },
      };
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'user_editable',
          required_for_registration: true,
          case_sensitive: false,
        },
      ]);
      const res = response();

      await controller.processRegister(
        request({
          body: {
            password: 'valid-password',
            custom_identifier_1: 'member-42',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Email is required. At least one contact method (email or phone) is required.'
      );
      expect(authService.registerUser).not.toHaveBeenCalled();
    });

    it('rejects passwords that do not meet policy', async () => {
      const { controller, flash, userService } = makeHarness();
      userService.validatePassword.mockReturnValue({
        isValid: false,
        messages: ['Use 12 characters', 'Add a number'],
      });
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'weak',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Password requirements not met: Use 12 characters, Add a number'
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({ prefilledEmail: 'alice@example.test' })
      );
    });

    it.each([
      ['phone', { phone: '+22997000000' }, '+22997000000'],
      ['custom identifier', { custom_identifier_1: 'member-42' }, 'unknown'],
    ])(
      'records the %s identity when password validation fails',
      async (_label, credential, expectedActor) => {
        const { config, controller, userService } = makeHarness();
        config.security.authentication.signup.signup_methods = [
          'phone' in credential ? 'phone' : 'custom_identifier',
        ];
        config.security.authentication.signup.contact_channels = {
          require_at_least_one: false,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        };
        if ('custom_identifier_1' in credential) {
          userService.getCustomIdentifierFields.mockReturnValue([
            {
              slot: 1,
              name: 'Member ID',
              edit_policy: 'user_editable',
              required_for_registration: false,
              case_sensitive: false,
            },
          ]);
        }
        userService.validatePassword.mockReturnValue({
          isValid: false,
          messages: ['Use 12 characters'],
        });

        await controller.processRegister(
          request({ body: { ...credential, password: 'weak' } }),
          response()
        );

        expect(activityMocks.failed).toHaveBeenCalledWith(
          'registration_failed',
          null,
          expect.stringContaining('Password requirements not met'),
          expect.objectContaining({
            actor: expect.objectContaining({ username: expectedActor }),
          })
        );
      }
    );

    it('enforces required contact channels on the server', async () => {
      const { config, controller, flash } = makeHarness();
      config.security.authentication.signup.contact_channels = {
        require_at_least_one: true,
        email: { enabled: true, required: true },
        phone: { enabled: true, required: true },
        full_name: { enabled: true, required: true },
      };
      const res = response();

      await controller.processRegister(
        request({
          body: {
            email: 'alice@example.test',
            password: 'valid-password',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Full name is required. Phone number is required.'
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({
          contactChannels:
            config.security.authentication.signup.contact_channels,
        })
      );
    });

    it.each([
      ['missing', '', true, true, 'Member ID is required.'],
      ['invalid', 'bad id', false, true, 'Invalid Member ID format.'],
      [
        'duplicate',
        'member-42',
        true,
        false,
        'This Member ID is already registered.',
      ],
    ])(
      'rejects %s custom identifiers',
      async (_label, value, formatValid, available, expectedMessage) => {
        const { config, controller, flash, userService } = makeHarness();
        config.security.authentication.custom_identifiers.enabled = true;
        userService.getCustomIdentifierFields.mockReturnValue([
          {
            slot: 1,
            name: 'Member ID',
            edit_policy: 'user_editable',
            required_for_registration: true,
            case_sensitive: false,
          },
          {
            slot: 2,
            name: 'Internal ID',
            edit_policy: 'admin_only',
            required_for_registration: true,
            case_sensitive: true,
          },
        ]);
        identifierMocks.validate.mockReturnValue(formatValid);
        userService.isCustomIdentifierAvailable.mockResolvedValue(available);
        const res = response();

        await controller.processRegister(
          request({
            body: {
              fullname: 'Alice Doe',
              email: 'alice@example.test',
              password: 'valid-password',
              custom_identifier_1: value,
            },
          }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(expectedMessage);
        expect(res.render).toHaveBeenCalledWith(
          'auth/register',
          expect.objectContaining({ prefilledEmail: 'alice@example.test' })
        );
      }
    );

    it.each([
      ['missing', '', true, true, 'Member ID is required.'],
      ['invalid', 'bad id', false, true, 'Invalid Member ID format.'],
      [
        'duplicate',
        'member-42',
        true,
        false,
        'This Member ID is already registered.',
      ],
    ])(
      'rejects %s custom identifiers for a phone registration',
      async (_label, value, formatValid, available, expectedMessage) => {
        const { config, controller, flash, userService } = makeHarness();
        config.security.authentication.signup.signup_methods = ['phone'];
        config.security.authentication.custom_identifiers.enabled = true;
        userService.getCustomIdentifierFields.mockReturnValue([
          {
            slot: 1,
            name: 'Member ID',
            edit_policy: 'user_editable',
            required_for_registration: true,
            case_sensitive: false,
          },
        ]);
        identifierMocks.validate.mockReturnValue(formatValid);
        userService.isCustomIdentifierAvailable.mockResolvedValue(available);
        const res = response();

        await controller.processRegister(
          request({
            body: {
              fullname: 'Alice Doe',
              phone: '+22997000000',
              password: 'valid-password',
              custom_identifier_1: value,
            },
          }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(expectedMessage);
        expect(res.render).toHaveBeenCalledWith(
          'auth/register',
          expect.objectContaining({ prefilledEmail: '' })
        );
      }
    );

    it('allows an optional custom identifier to remain blank', async () => {
      const { authService, config, controller, userService } = makeHarness();
      config.security.authentication.custom_identifiers.enabled = true;
      config.security.authentication.signup.require_email_verification = false;
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'user_editable',
          required_for_registration: false,
          case_sensitive: false,
        },
      ]);
      authService.registerUser.mockResolvedValue(
        user({ email_verified: true })
      );

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'valid-password',
          },
        }),
        response()
      );

      expect(identifierMocks.validate).not.toHaveBeenCalled();
      expect(userService.isCustomIdentifierAvailable).not.toHaveBeenCalled();
      expect(authService.registerUser).toHaveBeenCalled();
    });

    it('normalizes custom identifiers and names before registration', async () => {
      const { authService, config, controller, userService } = makeHarness();
      config.security.authentication.custom_identifiers.enabled = true;
      config.security.authentication.signup.require_email_verification = false;
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'user_editable',
          required_for_registration: true,
          case_sensitive: false,
        },
        {
          slot: 2,
          name: 'Case ID',
          edit_policy: 'user_editable',
          required_for_registration: false,
          case_sensitive: true,
        },
      ]);
      authService.registerUser.mockResolvedValue(
        user({ email_verified: true })
      );
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: '  Alice Marie Doe  ',
            email: 'alice@example.test',
            password: 'valid-password',
            custom_identifier_1: '  MEMBER-42  ',
            custom_identifier_2: '  Case-Sensitive  ',
          },
        }),
        res
      );

      expect(userService.isCustomIdentifierAvailable).toHaveBeenCalledWith(
        1,
        'member-42'
      );
      expect(authService.registerUser).toHaveBeenCalledWith({
        email: 'alice@example.test',
        phone_number: undefined,
        password: 'valid-password',
        given_name: 'Alice',
        family_name: 'Marie Doe',
        register_with: 'email',
        custom_identifier_1: 'member-42',
        custom_identifier_2: 'Case-Sensitive',
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('sends verification for an internal registration flow', async () => {
      const { authService, controller, notificationService, sessionManager } =
        makeHarness();
      authService.registerUser.mockResolvedValue(
        user({ email_verified: false, locale: 'fr' })
      );
      const req = request({
        body: {
          fullname: 'Alice Doe',
          email: 'alice@example.test',
          password: 'valid-password',
        },
      });
      const res = response();

      await controller.processRegister(req, res);

      expect(sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          currentActiveLoggedUser: expect.objectContaining({
            zoneinfo: 'UTC',
            locale: 'fr',
          }),
        })
      );
      expect(notificationService.sendVerification).toHaveBeenCalledWith(
        {
          email: 'alice@example.test',
          username: 'Alice',
          locale: 'fr',
        },
        'https://id.example.test/auth/verify-email?token=verification-token'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it('uses the username when an internal verification user has no given name', async () => {
      const { authService, controller, notificationService } = makeHarness();
      authService.registerUser.mockResolvedValue(
        user({ email_verified: false, given_name: undefined })
      );

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'valid-password',
          },
        }),
        response()
      );

      expect(notificationService.sendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice' }),
        expect.any(String)
      );
    });

    it('still shows pending verification when email delivery fails', async () => {
      const { authService, controller, notificationService } = makeHarness();
      authService.registerUser.mockResolvedValue(
        user({ email_verified: false })
      );
      notificationService.sendVerification.mockRejectedValue(
        new Error('mail offline')
      );
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'valid-password',
          },
        }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it.each([
      ['exact', 'alice@example.test', ['example.test']],
      ['wildcard root', 'alice@example.test', ['*.example.test']],
      ['wildcard subdomain', 'alice@team.example.test', ['*.example.test']],
    ])(
      'auto-approves an %s domain match',
      async (_label, email, domainsWhitelist) => {
        const { authService, config, controller, flash } = makeHarness();
        config.security.authentication.signup.auto_approval = {
          enabled: true,
          domains_whitelist: domainsWhitelist,
        };
        config.security.authentication.signup.require_email_verification = false;
        authService.registerUser.mockResolvedValue(
          user({ email, email_verified: false })
        );
        const res = response();

        await controller.processRegister(
          request({
            body: {
              fullname: 'Alice Doe',
              email,
              password: 'valid-password',
            },
          }),
          res
        );

        expect(flash.success).toHaveBeenCalledWith(
          'Account created and approved automatically!'
        );
        expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('does not auto-approve an unmatched domain and stores safe account defaults', async () => {
      const { authService, config, controller, flash, sessionManager } =
        makeHarness();
      config.security.authentication.signup.auto_approval = {
        enabled: true,
        domains_whitelist: ['*.example.test'],
      };
      config.security.authentication.signup.contact_channels.full_name.required = false;
      config.security.authentication.signup.require_email_verification = false;
      authService.registerUser.mockResolvedValue(
        user({
          _id: undefined,
          email: 'alice@other.test',
          email_verified: true,
          phone_number: undefined,
          phone_number_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: undefined,
          zoneinfo: undefined,
          locale: undefined,
        })
      );

      await controller.processRegister(
        request({
          body: {
            email: 'alice@other.test',
            password: 'valid-password',
          },
        }),
        response()
      );

      expect(flash.success).not.toHaveBeenCalled();
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            id: '',
            given_name: '',
            family_name: '',
            full_name: '',
            roles: ['user'],
            is_admin: false,
            zoneinfo: 'UTC',
            locale: 'en',
          }),
        }
      );
    });

    it('consumes redirect intent and returns registration status to the RP', async () => {
      const { authService, controller, redirectAuthority, redirectChain } =
        makeHarness();
      authService.registerUser.mockResolvedValue(
        user({ email_verified: true })
      );
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      redirectAuthority.buildRedirectUrl.mockReturnValue(
        'https://rp.example.test/callback?status=registered'
      );
      const req = request({
        body: {
          fullname: 'Alice Doe',
          email: 'alice@example.test',
          password: 'valid-password',
        },
      });
      const res = response();

      await controller.processRegister(req, res);

      expect(redirectAuthority.getIntent).toHaveBeenCalledWith(
        req,
        'register',
        true
      );
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        {
          email: 'alice@example.test',
          status: 'registered',
          autoApproved: 'false',
        }
      );
      expect(redirectChain.to).toHaveBeenCalledWith(
        'https://rp.example.test/callback?status=registered'
      );
    });

    it('returns a phone registration without an email to its stored intent', async () => {
      const { authService, config, controller, redirectAuthority } =
        makeHarness();
      config.security.authentication.signup.signup_methods = ['phone'];
      authService.registerUser.mockResolvedValue(
        user({ email: undefined, phone_number: '+22997000000' })
      );
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            phone: '+22997000000',
            password: 'valid-password',
          },
        }),
        response()
      );

      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        { email: '', status: 'registered', autoApproved: 'false' }
      );
    });

    it('stores boolean account state and sends redirected verification in the background', async () => {
      const {
        authService,
        controller,
        logger,
        notificationService,
        redirectAuthority,
        sessionManager,
      } = makeHarness();
      authService.registerUser.mockResolvedValue(
        user({
          _id: 'new-user',
          email_verified: false,
          phone_number: undefined,
          phone_number_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: undefined,
          zoneinfo: undefined,
          locale: undefined,
        })
      );
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      sessionManager.regenerate.mockRejectedValue(
        new Error('session unavailable')
      );
      const req = request({
        body: {
          fullname: 'Alice',
          email: 'alice@example.test',
          password: 'valid-password',
        },
      });

      await controller.processRegister(req, response());

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session after registration',
      });
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: 'new-user',
          phone_number: '',
          phone_number_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
          roles: ['user'],
          is_admin: false,
          zoneinfo: 'UTC',
          locale: 'en',
        }),
      });
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        {
          email: 'alice@example.test',
          status: 'verification_pending',
          autoApproved: 'false',
        }
      );
      await vi.waitFor(() => {
        expect(notificationService.sendVerification).toHaveBeenCalledWith(
          {
            email: 'alice@example.test',
            username: 'alice',
            locale: undefined,
          },
          'https://id.example.test/auth/verify-email?token=verification-token'
        );
      });
    });

    it('contains redirected background verification delivery failures', async () => {
      const {
        authService,
        controller,
        logger,
        notificationService,
        redirectAuthority,
      } = makeHarness();
      authService.registerUser.mockResolvedValue(
        user({ _id: 'new-user', email_verified: false })
      );
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      notificationService.sendVerification.mockRejectedValue(
        new Error('mail unavailable')
      );

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            email: 'alice@example.test',
            password: 'valid-password',
          },
        }),
        response()
      );

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
          email: 'alice@example.test',
          userId: 'new-user',
          context: 'verification_email_background_failed',
        });
      });
    });

    it.each([
      [new Error('registration failed'), 'registration failed'],
      [
        'registration failed',
        'An unexpected error occurred during registration.',
      ],
    ])(
      'preserves form state for registration failure %j',
      async (failure, expectedMessage) => {
        const { authService, controller, flash } = makeHarness();
        authService.registerUser.mockRejectedValue(failure);
        const res = response();

        await controller.processRegister(
          request({
            body: {
              fullname: 'Alice Doe',
              email: 'alice@example.test',
              password: 'valid-password',
              step_message: 'Retry',
            },
          }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(expectedMessage);
        expect(res.render).toHaveBeenCalledWith(
          'auth/register',
          expect.objectContaining({
            prefilledEmail: 'alice@example.test',
            stepMessage: 'Retry',
          })
        );
      }
    );

    it('preserves a phone registration failure with a stored redirect intent', async () => {
      const { authService, config, controller, logger, redirectAuthority } =
        makeHarness();
      config.security.authentication.signup.signup_methods = ['phone'];
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      authService.registerUser.mockRejectedValue('registration failed');
      const res = response();

      await controller.processRegister(
        request({
          body: {
            fullname: 'Alice Doe',
            phone: '+22997000000',
            password: 'valid-password',
          },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith('registration failed', {
        context: 'registration_error',
        redirectUrl: 'present',
      });
      expect(res.render).toHaveBeenCalledWith(
        'auth/register',
        expect.objectContaining({ prefilledEmail: '' })
      );
    });
  });

  describe('password recovery', () => {
    it('redirects a reset page request without a token to forgot password', () => {
      const { controller, flash } = makeHarness();
      const res = response();

      controller.resetPassword(request({ query: {} }), res);

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid or missing reset token. Please request a new password reset link.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/forgot-password');
    });

    it('renders the reset page with its token and password policy', () => {
      const { controller, userService } = makeHarness();
      const res = response();

      controller.resetPassword(
        request({ query: { token: 'reset-token' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/reset-password', {
        title: 'Reset Password - Parako',
        token: 'reset-token',
        passwordPolicy: userService.getPasswordPolicy.mock.results[0]?.value,
      });
    });

    it('rejects a reset submission without a token', async () => {
      const { authService, controller, flash } = makeHarness();
      const res = response();

      await controller.processResetPassword(
        request({
          body: {
            password: 'valid-password',
            'confirm-password': 'valid-password',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid or missing reset token.'
      );
      expect(authService.resetPassword).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/forgot-password');
    });

    it('re-renders reset when passwords do not match', async () => {
      const { authService, controller, flash } = makeHarness();
      const res = response();

      await controller.processResetPassword(
        request({
          body: {
            token: 'reset-token',
            password: 'valid-password',
            'confirm-password': 'different-password',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Passwords do not match. Please try again.'
      );
      expect(authService.resetPassword).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/reset-password',
        expect.objectContaining({ token: 'reset-token' })
      );
    });

    it('re-renders reset when the password policy rejects the password', async () => {
      const { authService, controller, flash, userService } = makeHarness();
      userService.validatePassword.mockReturnValue({
        isValid: false,
        messages: ['Use 12 characters', 'Use a number'],
      });
      const res = response();

      await controller.processResetPassword(
        request({
          body: {
            token: 'reset-token',
            password: 'weak',
            'confirm-password': 'weak',
          },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Password requirements not met: Use 12 characters, Use a number'
      );
      expect(authService.resetPassword).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/reset-password',
        expect.objectContaining({ token: 'reset-token' })
      );
    });

    it('resets the password, revokes sessions, and sends a notification', async () => {
      const {
        authService,
        controller,
        flash,
        notificationService,
        oidcAdapter,
      } = makeHarness();
      const resetUser = user({ locale: 'fr' });
      authService.resetPassword.mockResolvedValue(resetUser);
      oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(2);
      const res = response();

      await controller.processResetPassword(
        request({
          body: {
            token: 'reset-token',
            password: 'valid-password',
            'confirm-password': 'valid-password',
          },
        }),
        res
      );

      expect(authService.resetPassword).toHaveBeenCalledWith(
        'reset-token',
        'valid-password'
      );
      expect(oidcAdapter.session.revokeAllSessionsExcept).toHaveBeenCalledWith(
        'alice',
        ''
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'alice@example.test',
        'Your Parako password has been reset',
        'email/mail.njk',
        expect.objectContaining({
          title: 'Your Parako password has been reset',
          username: 'Alice Doe',
        })
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'password_reset_success',
        resetUser,
        'Password reset successfully',
        expect.any(Object)
      );
      expect(flash.success).toHaveBeenCalledWith(
        'Your password has been reset successfully. You can now log in with your new password.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('sends a reset notification with safe defaults for a sparse user profile', async () => {
      const { authService, controller, notificationService, oidcAdapter } =
        makeHarness();
      authService.resetPassword.mockResolvedValue(
        user({
          email: undefined,
          given_name: undefined,
          family_name: undefined,
        })
      );
      oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(0);

      await controller.processResetPassword(
        request({
          body: {
            token: 'reset-token',
            password: 'valid-password',
            'confirm-password': 'valid-password',
          },
        }),
        response()
      );

      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        '',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({ username: '' })
      );
    });

    it.each([
      ['session revocation', 'revokeAllSessionsExcept'],
      ['notification delivery', 'sendTemplatedEmail'],
    ])(
      'contains a %s failure after the password is changed',
      async (_label, failingDependency) => {
        const { authService, controller, notificationService, oidcAdapter } =
          makeHarness();
        authService.resetPassword.mockResolvedValue(user());
        if (failingDependency === 'revokeAllSessionsExcept') {
          oidcAdapter.session.revokeAllSessionsExcept.mockRejectedValue(
            new Error('session store offline')
          );
        } else {
          notificationService.sendTemplatedEmail.mockRejectedValue(
            new Error('mail offline')
          );
        }
        const res = response();

        await controller.processResetPassword(
          request({
            body: {
              token: 'reset-token',
              password: 'valid-password',
              'confirm-password': 'valid-password',
            },
          }),
          res
        );

        expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      }
    );

    it.each([
      [new Error('expired token'), 'expired token'],
      ['expired token', 'An unexpected error occurred.'],
    ])(
      'redirects a failed reset %j without exposing internal values',
      async (failure, expectedMessage) => {
        const { authService, controller, flash } = makeHarness();
        authService.resetPassword.mockRejectedValue(failure);
        const res = response();

        await controller.processResetPassword(
          request({
            body: {
              token: 'reset-token',
              password: 'valid-password',
              'confirm-password': 'valid-password',
            },
          }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(expectedMessage);
        expect(res.redirect).toHaveBeenCalledWith('/auth/forgot-password');
      }
    );

    it('renders the forgot-password page', () => {
      const { controller } = makeHarness();
      const res = response();

      controller.forgotPassword(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/forgot-password', {
        title: 'Forgot Password - Parako',
      });
    });

    it.each([undefined, '', 'not-an-email'])(
      'rejects invalid forgot-password email %j',
      async email => {
        const { authService, controller, flash } = makeHarness();
        authService.isValidEmailAddress.mockReturnValue(false);
        const res = response();

        await controller.processForgotPassword(
          request({ body: { email } }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(
          'Please enter a valid email address.'
        );
        expect(authService.generatePasswordResetToken).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/forgot-password', {
          title: 'Forgot Password - Parako',
        });
      }
    );

    it('creates and delivers a password-reset link', async () => {
      const { authService, controller, flash, notificationService } =
        makeHarness();
      authService.generatePasswordResetToken.mockResolvedValue({
        user: user({ given_name: '', locale: 'fr' }),
        resetToken: 'reset-token',
      });
      const res = response();

      await controller.processForgotPassword(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(notificationService.sendPasswordReset).toHaveBeenCalledWith(
        {
          email: 'alice@example.test',
          username: 'alice',
          locale: 'fr',
        },
        'https://id.example.test/auth/reset-password?token=reset-token'
      );
      expect(flash.success).toHaveBeenCalledWith(
        "If an account with that email exists, we've sent a password reset link. Please check your inbox."
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('returns the same success response when reset-token generation fails', async () => {
      const { authService, controller, flash, notificationService } =
        makeHarness();
      authService.generatePasswordResetToken.mockRejectedValue(
        new Error('account not found')
      );
      const res = response();

      await controller.processForgotPassword(
        request({ body: { email: 'unknown@example.test' } }),
        res
      );

      expect(notificationService.sendPasswordReset).not.toHaveBeenCalled();
      expect(flash.success).toHaveBeenCalledOnce();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('renders a generic error when forgot-password processing fails unexpectedly', async () => {
      const { authService, controller, flash } = makeHarness();
      authService.isValidEmailAddress.mockImplementation(() => {
        throw new Error('validator unavailable');
      });
      const res = response();

      await controller.processForgotPassword(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'An error occurred while processing your request. Please try again later.'
      );
      expect(res.render).toHaveBeenCalledWith('auth/forgot-password', {
        title: 'Forgot Password - Parako',
      });
    });
  });

  describe('account selection', () => {
    it('redirects an unauthenticated selection request to login', () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      const res = response();

      controller.accountSelect(request(), res);

      expect(flash.error).toHaveBeenCalledWith('Please log in to continue.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('returns an unauthenticated OIDC selection request to its interaction', () => {
      const { controller, redirectAuthority, redirectChain, sessionManager } =
        makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: null,
        others: [],
      });
      const res = response();

      controller.accountSelect(
        request({ query: { interaction_uid: 'interaction-1' } }),
        res
      );

      expect(redirectAuthority.redirect).toHaveBeenCalledWith(res);
      expect(redirectChain.withOptions).toHaveBeenCalledWith({
        allowLocal: true,
        requireHttps: false,
      });
      expect(redirectChain.to).toHaveBeenCalledWith(
        '/oidc/v1/interaction/interaction-1'
      );
      expect(redirectChain.or).toHaveBeenCalledWith('/auth/login');
    });

    it('renders active and alternate accounts with normalized presentation data', () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: {
          id: 'active-1',
          username: 'alice',
          full_name: 'Alice Doe',
          email: 'alice@example.test',
          picture: '/alice.png',
          given_name: 'Alice',
          family_name: 'Doe',
        },
        others: [
          {
            id: 'other-1',
            username: 'bob',
          },
          {
            id: 'other-2',
          },
          {
            id: 'other-3',
            username: 'charlie',
            given_name: 'Charlie',
            family_name: 'Delta',
          },
        ],
      });
      const res = response();

      controller.accountSelect(
        request({
          query: {
            client_name: 'Demo RP',
            client_logo: '/demo.svg',
            interaction_uid: 'interaction-1',
          },
        }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/account-select', {
        title: 'Select Account - Parako',
        message: 'Select Account',
        clientName: 'Demo RP',
        clientLogo: '/demo.svg',
        interactionUid: 'interaction-1',
        accounts: [
          {
            id: 'active-1',
            name: 'Alice Doe',
            email: 'alice@example.test',
            avatar: '/alice.png',
            initials: 'AD',
            is_active: true,
          },
          {
            id: 'other-1',
            name: 'bob',
            email: '',
            avatar: '',
            initials: 'BO',
            is_active: false,
          },
          {
            id: 'other-2',
            name: undefined,
            email: '',
            avatar: '',
            initials: 'U',
            is_active: false,
          },
          {
            id: 'other-3',
            name: 'charlie',
            email: '',
            avatar: '',
            initials: 'CD',
            is_active: false,
          },
        ],
      });
    });

    it('uses branding defaults and username initials for the active account', () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: {
          id: 'active-1',
          username: 'alice',
        },
        others: [],
      });
      const res = response();

      controller.accountSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/account-select',
        expect.objectContaining({
          clientName: 'Parako Inc.',
          clientLogo: '/parako.svg',
          accounts: [expect.objectContaining({ initials: 'AL' })],
        })
      );
    });

    it('renders alternate accounts when there is no active account', () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: null,
        others: [{ id: 'other-1', username: 'bob' }],
      });
      const res = response();

      controller.accountSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/account-select',
        expect.objectContaining({
          accounts: [
            expect.objectContaining({ id: 'other-1', is_active: false }),
          ],
        })
      );
    });

    it('uses a generic initial when the active account has no display name', () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: { id: 'active-1' },
        others: [],
      });
      const res = response();

      controller.accountSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/account-select',
        expect.objectContaining({
          accounts: [expect.objectContaining({ initials: 'U' })],
        })
      );
    });

    it.each([undefined, '', ['account-1']])(
      'rejects invalid selected account id %j',
      async accountId => {
        const { controller, flash, sessionManager } = makeHarness();
        const res = response();

        await controller.continueWithAccount(
          request({ query: { account_id: accountId } }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith('Invalid account selection.');
        expect(sessionManager.switchUser).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/account-select');
      }
    );

    it('requires reauthentication when the selected account is stale', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.switchUser.mockReturnValue({
        success: false,
        reason: 'reauth_required',
      });
      const res = response();

      await controller.continueWithAccount(
        request({ query: { account_id: 'account-1' } }),
        res
      );

      expect(flash.info).toHaveBeenCalledWith(
        'Please re-enter your password to switch accounts.'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/login?switch_to=account-1'
      );
    });

    it('rejects an account that is no longer in the session', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.switchUser.mockReturnValue({
        success: false,
        reason: 'not_found',
      });
      const res = response();

      await controller.continueWithAccount(
        request({ query: { account_id: 'account-1' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'The selected account is no longer available.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-select');
    });

    it('contains a successful switch whose active account cannot be read', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.switchUser.mockReturnValue({ success: true });
      sessionManager.getActiveUser.mockReturnValue(null);
      const res = response();

      await controller.continueWithAccount(
        request({ query: { account_id: 'account-1' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Account not found.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('returns a successful account switch to its OIDC interaction', async () => {
      const { controller, redirectChain, sessionManager } = makeHarness();
      sessionManager.switchUser.mockReturnValue({ success: true });
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      const res = response();

      await controller.continueWithAccount(
        request({
          query: {
            account_id: 'account-1',
            interaction_uid: 'interaction-1',
          },
        }),
        res
      );

      expect(redirectChain.withOptions).toHaveBeenCalledWith({
        allowLocal: true,
        requireHttps: false,
      });
      expect(redirectChain.to).toHaveBeenCalledWith(
        '/oidc/v1/interaction/interaction-1'
      );
      expect(redirectChain.or).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('redirects a regular successful account switch to the dashboard', async () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.switchUser.mockReturnValue({ success: true });
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      const res = response();

      await controller.continueWithAccount(
        request({ query: { account_id: 'account-1' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('contains unexpected account-switch failures', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.switchUser.mockImplementation(() => {
        throw new Error('session unavailable');
      });
      const res = response();

      await controller.continueWithAccount(
        request({ query: { account_id: 'account-1' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'An error occurred while switching accounts.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-select');
    });
  });

  describe('MFA rendering', () => {
    it('redirects the generic MFA page when no user is active', () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.getActiveUser.mockReturnValue(undefined);
      const res = response();

      controller.multiFactor(request(), res);

      expect(flash.error).toHaveBeenCalledWith('Please log in to continue.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      [undefined, 'app', null, null],
      ['sms', 'sms', 'Phone not available in session', null],
      ['email', 'email', null, 'a***@example.test'],
    ])(
      'renders generic MFA method %j with masked contact data',
      (requestedMethod, expectedMethod, maskedPhone, maskedEmail) => {
        const { controller, sessionManager } = makeHarness();
        sessionManager.getActiveUser.mockReturnValue({
          username: 'alice',
          full_name: 'Alice Doe',
          email: 'alice@example.test',
        });
        const now = vi.spyOn(Date, 'now').mockReturnValue(123456789);
        const res = response();

        controller.multiFactor(
          request({
            query: requestedMethod ? { method: requestedMethod } : {},
          }),
          res
        );

        expect(sessionManager.set).toHaveBeenCalledWith(
          expect.anything(),
          'mfaRequestId',
          '123456789'
        );
        expect(res.render).toHaveBeenCalledWith('auth/multi-factor', {
          title: 'Two-Factor Authentication - Parako',
          mfaMethod: expectedMethod,
          maskedPhone,
          maskedEmail,
          requestId: '123456789',
          userName: 'Alice Doe',
        });
        now.mockRestore();
      }
    );

    it('uses the username and leaves email unmasked when the session has no email', () => {
      const { controller, mfaUtils, sessionManager } = makeHarness();
      sessionManager.getActiveUser.mockReturnValue({ username: 'alice' });
      const res = response();

      controller.multiFactor(request({ query: { method: 'email' } }), res);

      expect(mfaUtils.maskEmail).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/multi-factor',
        expect.objectContaining({ maskedEmail: null, userName: 'alice' })
      );
    });

    it('redirects MFA verification when no pending user exists', () => {
      const { controller, flash } = makeHarness();
      const res = response();

      controller.mfaVerify(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'No pending MFA verification found. Please login again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('does not mark a standard pending MFA session as social login', () => {
      const { controller, session } = makeHarness();
      const pendingUser = pendingMfaUser();
      session.set('pendingMfaUser', pendingUser);
      const res = response();

      controller.mfaVerify(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/mfa-verify', {
        title: 'Two-Factor Authentication - Parako',
        user: pendingUser,
        maskedEmail: 'a***@example.test',
        isSocialLogin: false,
        provider: undefined,
      });
    });

    it('renders a social pending user without trying to mask a missing email', () => {
      const { controller, mfaUtils, session } = makeHarness();
      const pendingUser = pendingMfaUser({
        email: undefined,
        provider: 'github',
      });
      session.set('pendingSocialMfaUser', pendingUser);
      const res = response();

      controller.mfaVerify(request(), res);

      expect(mfaUtils.maskEmail).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/mfa-verify', {
        title: 'Two-Factor Authentication - Parako',
        user: pendingUser,
        maskedEmail: null,
        isSocialLogin: true,
        provider: 'github',
      });
    });
  });

  describe('MFA verification', () => {
    it('redirects when there is no pending MFA session', async () => {
      const { controller, flash } = makeHarness();
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'No pending MFA verification found. Please login again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([undefined, '', '   '])('rejects blank MFA code %j', async code => {
      const { authService, controller, flash, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      const res = response();

      await controller.processMfaVerify(request({ body: { code } }), res);

      expect(flash.error).toHaveBeenCalledWith(
        'Please enter the verification code.'
      );
      expect(authService.verifyTotp).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('delegates TOTP verification with a trimmed code', async () => {
      const { authService, controller, flash, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      authService.verifyTotp.mockResolvedValue(false);
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: ' 123456 ' } }),
        res
      );

      expect(authService.verifyTotp).toHaveBeenCalledWith('alice', '123456');
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'mfa_verification_failed',
        null,
        'MFA verification failed',
        expect.any(Object)
      );
      expect(flash.error).toHaveBeenCalledWith(
        'Invalid or expired verification code. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('delegates email OTP verification', async () => {
      const { controller, session, userService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser({ mfa_method: 'email' }));
      userService.verifyEmailOtp.mockResolvedValue(false);
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: ' 654321 ' } }),
        res
      );

      expect(userService.verifyEmailOtp).toHaveBeenCalledWith(
        'alice',
        '654321'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('sends WebAuthn verification to its dedicated flow', async () => {
      const { controller, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser({ mfa_method: 'webauthn' }));
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: 'assertion' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/webauthn');
    });

    it('rejects unsupported MFA methods', async () => {
      const { controller, logger, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser({ mfa_method: 'voice' }));
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'MFA verification attempted for unsupported method',
        { username: 'alice', method: 'voice' }
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('contains verifier failures as an invalid-code result', async () => {
      const { authService, controller, logger, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      authService.verifyTotp.mockRejectedValue(new Error('TOTP store offline'));
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        username: 'alice',
        context: 'mfa_verification_error',
      });
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('completes standard MFA without labeling it as social login', async () => {
      const { authService, controller, flash, session, sessionManager } =
        makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      authService.verifyTotp.mockResolvedValue(true);
      const req = request({ body: { code: '123456' } });
      const res = response();

      await controller.processMfaVerify(req, res);

      expect(activityMocks.success).toHaveBeenCalledWith(
        'mfa_verification_success',
        null,
        'MFA verification successful',
        expect.any(Object)
      );
      expect(sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          id: 'user-1',
          username: 'alice',
          last_used: expect.any(Number),
        }),
        true
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(req, 'pendingMfaUser');
      expect(flash.success).toHaveBeenCalledWith('Login successful!');
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('records the provider for a successful social MFA session', async () => {
      const { authService, controller, session } = makeHarness();
      session.set(
        'pendingSocialMfaUser',
        pendingMfaUser({ provider: 'github' })
      );
      authService.verifyTotp.mockResolvedValue(true);
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(activityMocks.success).toHaveBeenCalledWith(
        'mfa_verification_success',
        null,
        'MFA verification successful via github',
        expect.any(Object)
      );
    });

    it('continues login when session regeneration fails', async () => {
      const { authService, controller, logger, session, sessionManager } =
        makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      authService.verifyTotp.mockResolvedValue(true);
      sessionManager.regenerate.mockRejectedValue(
        new Error('session backend unavailable')
      );
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session after MFA verification',
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it.each([
      ['https://rp.example.test/return', 'https://rp.example.test/return'],
      [undefined, '/accounts/dashboard'],
    ])(
      'honors add-account MFA return URL %j',
      async (returnUrl, expectedUrl) => {
        const { authService, controller, session } = makeHarness();
        session.set('pendingMfaUser', pendingMfaUser());
        session.set('addAccountIntent', {
          addingAccount: true,
          returnUrl,
        });
        authService.verifyTotp.mockResolvedValue(true);
        const res = response();

        await controller.processMfaVerify(
          request({ body: { code: '123456' } }),
          res
        );

        expect(res.redirect).toHaveBeenCalledWith(expectedUrl);
      }
    );

    it.each([
      ['pending', { continue_url: '/oidc/pending' }, {}, {}, '/oidc/pending'],
      ['query', {}, { continue: '/oidc/query' }, {}, '/oidc/query'],
      ['body', {}, {}, { continue: '/oidc/body' }, '/oidc/body'],
    ])(
      'uses the %s continue URL after successful MFA',
      async (_source, pendingOverrides, query, body, expectedUrl) => {
        const { authService, controller, redirectChain, session } =
          makeHarness();
        session.set('pendingMfaUser', pendingMfaUser(pendingOverrides));
        authService.verifyTotp.mockResolvedValue(true);
        const res = response();

        await controller.processMfaVerify(
          request({ body: { code: '123456', ...body }, query }),
          res
        );

        expect(redirectChain.to).toHaveBeenCalledWith(expectedUrl);
        expect(redirectChain.or).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('consumes and decorates a stored redirect intent after MFA', async () => {
      const {
        authService,
        controller,
        redirectAuthority,
        redirectChain,
        session,
      } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      authService.verifyTotp.mockResolvedValue(true);
      redirectAuthority.getIntent.mockReturnValue(
        'https://rp.example.test/callback'
      );
      redirectAuthority.buildRedirectUrl.mockReturnValue(
        'https://rp.example.test/callback?status=authenticated'
      );
      const req = request({ body: { code: '123456' } });
      const res = response();

      await controller.processMfaVerify(req, res);

      expect(redirectAuthority.getIntent).toHaveBeenNthCalledWith(
        1,
        req,
        'login',
        false
      );
      expect(redirectAuthority.getIntent).toHaveBeenNthCalledWith(
        2,
        req,
        'login',
        true
      );
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        'https://rp.example.test/callback',
        { email: 'alice@example.test', status: 'authenticated' }
      );
      expect(redirectChain.to).toHaveBeenCalledWith(
        'https://rp.example.test/callback?status=authenticated'
      );
    });

    it('contains unexpected MFA processing failures', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.get.mockImplementation(() => {
        throw new Error('session unavailable');
      });
      const res = response();

      await controller.processMfaVerify(
        request({ body: { code: '123456' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'An error occurred during verification. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });

  describe('MFA method selection', () => {
    it('redirects resend when no pending MFA session exists', async () => {
      const { controller, flash } = makeHarness();
      const res = response();

      await controller.resendMfaCode(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'No pending MFA verification found. Please login again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('rejects resend for a non-email MFA method', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      const res = response();

      await controller.resendMfaCode(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'Code resend is only available for email verification.'
      );
      expect(userService.setEmailOtp).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('replaces and delivers an email MFA code', async () => {
      const { controller, flash, notificationService, session, userService } =
        makeHarness();
      session.set(
        'pendingSocialMfaUser',
        pendingMfaUser({ mfa_method: 'email' })
      );
      const res = response();

      await controller.resendMfaCode(request(), res);

      expect(userService.setEmailOtp).toHaveBeenCalledWith(
        'alice',
        '123456',
        600
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'alice@example.test',
        'Your Parako login code',
        'email/mail.njk',
        expect.objectContaining({ username: 'Alice Doe' })
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'mfa_code_resent',
        null,
        'User requested MFA code resend',
        expect.any(Object)
      );
      expect(flash.success).toHaveBeenCalledWith(
        'A new verification code has been sent to your email.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('resends email MFA with an empty display name for a sparse session user', async () => {
      const { controller, notificationService, session } = makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({
          mfa_method: 'email',
          given_name: undefined,
          family_name: undefined,
        })
      );

      await controller.resendMfaCode(request(), response());

      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'alice@example.test',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({ username: '' })
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'mfa_code_resent',
        null,
        expect.any(String),
        expect.objectContaining({
          actor: expect.objectContaining({ full_name: '' }),
        })
      );
    });

    it('contains email MFA resend failures', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser({ mfa_method: 'email' }));
      userService.setEmailOtp.mockRejectedValue(new Error('OTP store offline'));
      const res = response();

      await controller.resendMfaCode(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'Failed to send verification code. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('redirects selection when no pending MFA session exists', () => {
      const { controller, flash } = makeHarness();
      const res = response();

      controller.mfaSelect(request(), res);

      expect(flash.error).toHaveBeenCalledWith('Please login first.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      [undefined, 'no configured methods'],
      [{ totp: true, email: false }, 'one configured method'],
    ])('renders no fallback for %s', (enabledMethods, _label) => {
      const { controller, session } = makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({ enabled_methods: enabledMethods })
      );
      const res = response();

      controller.mfaSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/mfa-no-fallback', {
        title: 'auth.mfa_no_fallback.title - Parako',
      });
    });

    it('renders all enabled choices when fallback methods exist', () => {
      const { controller, session } = makeHarness();
      const enabledMethods = { totp: true, email: true, webauthn: false };
      session.set(
        'pendingSocialMfaUser',
        pendingMfaUser({ enabled_methods: enabledMethods })
      );
      const res = response();

      controller.mfaSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/mfa-select', {
        title: 'auth.mfa_select.title - Parako',
        enabledMethods,
      });
    });

    it('redirects processing when no pending MFA session exists', async () => {
      const { controller, flash } = makeHarness();
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'totp' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Please login first.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('rejects a disabled MFA method submitted outside the rendered form', async () => {
      const { controller, flash, session, sessionManager, userService } =
        makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({
          enabled_methods: { totp: true, email: false, webauthn: false },
        })
      );
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'email' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Selected MFA method is not available.'
      );
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(userService.findByUsername).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/select');
    });

    it.each([undefined, '', ['totp'], 'voice'])(
      'rejects malformed or unknown MFA method %j',
      async method => {
        const { controller, flash, session } = makeHarness();
        session.set(
          'pendingMfaUser',
          pendingMfaUser({
            enabled_methods: { totp: true, email: true },
          })
        );
        const res = response();

        await controller.processMfaSelect(request({ body: { method } }), res);

        expect(flash.error).toHaveBeenCalledWith(
          'Selected MFA method is not available.'
        );
        expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/select');
      }
    );

    it('selects WebAuthn without generating an email code', async () => {
      const { controller, session, sessionManager, userService } =
        makeHarness();
      const pendingUser = pendingMfaUser({
        enabled_methods: { webauthn: true, totp: true },
      });
      session.set('pendingMfaUser', pendingUser);
      const req = request({ body: { method: 'webauthn' } });
      const res = response();

      await controller.processMfaSelect(req, res);

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'pendingMfaUser',
        expect.objectContaining({ mfa_method: 'webauthn' })
      );
      expect(userService.findByUsername).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/webauthn');
    });

    it('selects TOTP and continues to standard verification', async () => {
      const { controller, session } = makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({ enabled_methods: { totp: true, email: true } })
      );
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'totp' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('selects email, creates an OTP, and sends it to the stored user', async () => {
      const { controller, notificationService, session, userService } =
        makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({ enabled_methods: { totp: true, email: true } })
      );
      userService.findByUsername.mockResolvedValue(
        user({ email: undefined, given_name: '', family_name: '' })
      );
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'email' } }),
        res
      );

      expect(userService.setEmailOtp).toHaveBeenCalledWith(
        'alice',
        '123456',
        600
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        '',
        'Your Parako login code',
        'email/mail.njk',
        expect.objectContaining({ username: '' })
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('continues email selection when the user record has disappeared', async () => {
      const { controller, notificationService, session, userService } =
        makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({ enabled_methods: { totp: true, email: true } })
      );
      userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'email' } }),
        res
      );

      expect(notificationService.sendTemplatedEmail).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('contains MFA method-selection dependency failures', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set(
        'pendingMfaUser',
        pendingMfaUser({ enabled_methods: { totp: true, email: true } })
      );
      userService.findByUsername.mockRejectedValue(
        new Error('user store offline')
      );
      const res = response();

      await controller.processMfaSelect(
        request({ body: { method: 'email' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Failed to process selection. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/select');
    });
  });

  describe('WebAuthn MFA', () => {
    it('redirects the WebAuthn page when no pending user exists', () => {
      const { controller, flash } = makeHarness();
      const res = response();

      controller.mfaWebAuthn(request(), res);

      expect(flash.error).toHaveBeenCalledWith('Please login first.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('renders the WebAuthn page with an isolated pending-user view model', () => {
      const { controller, session } = makeHarness();
      const pendingUser = pendingMfaUser({ mfa_method: 'totp' });
      session.set('pendingSocialMfaUser', pendingUser);
      const res = response();

      controller.mfaWebAuthn(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/mfa-webauthn', {
        title: 'Passkey Verification - Parako',
        user: { ...pendingUser, mfa_method: 'webauthn' },
      });
      expect(pendingUser.mfa_method).toBe('totp');
    });

    it('rejects WebAuthn options without a pending user', async () => {
      const { controller, webauthnService } = makeHarness();
      const res = response();

      await controller.mfaWebAuthnOptions(request(), res);

      expect(webauthnService.getCredentials).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    });

    it('reports an unconfigured WebAuthn authenticator', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      webauthnService.getCredentials.mockResolvedValue([]);
      webauthnService.generateAuthenticationOptions.mockResolvedValue(null);
      const res = response();

      await controller.mfaWebAuthnOptions(request(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'WebAuthn not configured',
      });
    });

    it('returns WebAuthn options and stores the challenge in session', async () => {
      const { controller, session, sessionManager, webauthnService } =
        makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      const credentials = [{ credential_id: 'credential-1' }];
      const options = {
        challenge: 'challenge-1',
        allowCredentials: [{ id: 'credential-1' }],
      };
      webauthnService.getCredentials.mockResolvedValue(credentials);
      webauthnService.generateAuthenticationOptions.mockResolvedValue(options);
      const req = request();
      const res = response();

      await controller.mfaWebAuthnOptions(req, res);

      expect(
        webauthnService.generateAuthenticationOptions
      ).toHaveBeenCalledWith('alice', credentials);
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'webauthnChallenge',
        'challenge-1'
      );
      expect(res.json).toHaveBeenCalledWith(options);
    });

    it('contains WebAuthn option-generation failures', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      webauthnService.getCredentials.mockRejectedValue(
        new Error('credential store offline')
      );
      const res = response();

      await controller.mfaWebAuthnOptions(request(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to generate options',
      });
    });

    it('rejects WebAuthn verification without a pending user', async () => {
      const { controller } = makeHarness();
      const res = response();

      await controller.processMfaWebAuthn(request(), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    });

    it('rejects WebAuthn verification without a stored challenge', async () => {
      const { controller, session } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      const res = response();

      await controller.processMfaWebAuthn(request(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'No challenge found' });
    });

    it('requires a WebAuthn credential response', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      session.set('webauthnChallenge', 'challenge-1');
      webauthnService.getCredentials.mockResolvedValue([]);
      const res = response();

      await controller.processMfaWebAuthn(request({ body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Credential is required',
      });
    });

    it('rejects a WebAuthn credential that is not registered to the user', async () => {
      const { controller, session, webauthnService } = makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      session.set('webauthnChallenge', 'challenge-1');
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
      ]);
      const res = response();

      await controller.processMfaWebAuthn(
        request({ body: { credential: { id: 'credential-2' } } }),
        res
      );

      expect(webauthnService.verifyAuthentication).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Credential not found' });
    });

    it.each([undefined, { verified: false }])(
      'rejects unsuccessful WebAuthn verification %j',
      async result => {
        const { controller, session, webauthnService } = makeHarness();
        session.set('pendingMfaUser', pendingMfaUser());
        session.set('webauthnChallenge', 'challenge-1');
        const storedCredential = { credential_id: 'credential-1' };
        const credential = { id: 'credential-1', response: {} };
        webauthnService.getCredentials.mockResolvedValue([storedCredential]);
        webauthnService.verifyAuthentication.mockResolvedValue(result);
        const res = response();

        await controller.processMfaWebAuthn(
          request({ body: { credential } }),
          res
        );

        expect(webauthnService.verifyAuthentication).toHaveBeenCalledWith(
          storedCredential,
          credential,
          'challenge-1',
          'https://id.example.test'
        );
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Verification failed' });
      }
    );

    it.each([
      ['/oidc/continue', '/oidc/continue'],
      [undefined, '/accounts/dashboard'],
    ])(
      'completes WebAuthn MFA with redirect %j',
      async (continueUrl, expectedRedirectUrl) => {
        const { controller, session, sessionManager, webauthnService } =
          makeHarness();
        session.set(
          'pendingSocialMfaUser',
          pendingMfaUser({ continue_url: continueUrl })
        );
        session.set('webauthnChallenge', 'challenge-1');
        webauthnService.getCredentials.mockResolvedValue([
          { credential_id: 'credential-1' },
        ]);
        webauthnService.verifyAuthentication.mockResolvedValue({
          verified: true,
        });
        const req = request({
          body: { credential: { id: 'credential-1' } },
        });
        const res = response();

        await controller.processMfaWebAuthn(req, res);

        expect(sessionManager.set).toHaveBeenCalledWith(
          req,
          'webauthnChallenge',
          null
        );
        expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
          req,
          expect.objectContaining({ id: 'user-1', username: 'alice' }),
          true
        );
        expect(res.json).toHaveBeenCalledWith({
          ok: true,
          redirectUrl: expectedRedirectUrl,
        });
      }
    );

    it('continues WebAuthn MFA when session regeneration fails', async () => {
      const { controller, logger, session, sessionManager, webauthnService } =
        makeHarness();
      session.set('pendingMfaUser', pendingMfaUser());
      session.set('webauthnChallenge', 'challenge-1');
      webauthnService.getCredentials.mockResolvedValue([
        { credential_id: 'credential-1' },
      ]);
      webauthnService.verifyAuthentication.mockResolvedValue({
        verified: true,
      });
      sessionManager.regenerate.mockRejectedValue(new Error('store offline'));
      const res = response();

      await controller.processMfaWebAuthn(
        request({ body: { credential: { id: 'credential-1' } } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session after WebAuthn MFA',
      });
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        redirectUrl: '/accounts/dashboard',
      });
    });

    it('contains unexpected WebAuthn verification failures', async () => {
      const { controller, sessionManager } = makeHarness();
      sessionManager.get.mockImplementation(() => {
        throw new Error('session unavailable');
      });
      const res = response();

      await controller.processMfaWebAuthn(request(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Verification failed' });
    });
  });

  describe('email verification', () => {
    it.each([
      [{}, 'request', ''],
      [{ status: 'pending' }, 'pending', 'alice@example.test'],
    ])(
      'renders email verification state %j',
      (query, expectedStatus, expectedEmail) => {
        const { controller, sessionManager } = makeHarness();
        if (expectedEmail) {
          sessionManager.getActiveUser.mockReturnValue({
            email: expectedEmail,
          });
        }
        const res = response();

        controller.emailVerification(request({ query }), res);

        expect(res.render).toHaveBeenCalledWith('auth/email-verification', {
          title: 'Verify Email - Parako',
          status: expectedStatus,
          userEmail: expectedEmail,
        });
      }
    );

    it.each([undefined, '', 'not-an-email'])(
      'rejects invalid verification email %j',
      async email => {
        const { authService, controller, flash, userService } = makeHarness();
        authService.isValidEmailAddress.mockReturnValue(false);
        const res = response();

        await controller.requestEmailVerification(
          request({ body: { email } }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(
          'Please enter a valid email address.'
        );
        expect(userService.findByEmail).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/email-verification', {
          title: 'Verify Email - Parako',
        });
      }
    );

    it('generates and sends a verification link for an unverified account', async () => {
      const { authService, controller, notificationService, userService } =
        makeHarness();
      const unverifiedUser = user({
        email_verified: false,
        given_name: '',
        locale: 'fr',
      });
      userService.findByEmail.mockResolvedValue(unverifiedUser);
      const res = response();

      await controller.requestEmailVerification(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(authService.generateEmailVerificationToken).toHaveBeenCalledWith(
        unverifiedUser._id
      );
      expect(notificationService.sendVerification).toHaveBeenCalledWith(
        {
          email: 'alice@example.test',
          username: 'alice',
          locale: 'fr',
        },
        'https://id.example.test/auth/verify-email?token=verification-token'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it('uses the same public response for verified and unknown email addresses', async () => {
      const verifiedHarness = makeHarness();
      verifiedHarness.userService.findByEmail.mockResolvedValue(
        user({ email_verified: true })
      );
      const verifiedResponse = response();

      await verifiedHarness.controller.requestEmailVerification(
        request({ body: { email: 'alice@example.test' } }),
        verifiedResponse
      );

      const unknownHarness = makeHarness();
      unknownHarness.userService.findByEmail.mockResolvedValue(null);
      const unknownResponse = response();

      await unknownHarness.controller.requestEmailVerification(
        request({ body: { email: 'unknown@example.test' } }),
        unknownResponse
      );

      expect(verifiedHarness.flash.success).toHaveBeenCalledWith(
        "If your email is registered with us, we've sent a verification link. Please check your inbox."
      );
      expect(verifiedHarness.flash.info).not.toHaveBeenCalled();
      expect(verifiedResponse.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
      expect(unknownHarness.flash.success).toHaveBeenCalledWith(
        "If your email is registered with us, we've sent a verification link. Please check your inbox."
      );
      expect(unknownResponse.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it('returns the generic public response when verification delivery fails', async () => {
      const { controller, flash, userService } = makeHarness();
      userService.findByEmail.mockRejectedValue(
        new Error('user store offline')
      );
      const res = response();

      await controller.requestEmailVerification(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(flash.success).toHaveBeenCalledWith(
        "If your email is registered with us, we've sent a verification link. Please check your inbox."
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it('renders a generic error when public verification handling fails unexpectedly', async () => {
      const { authService, controller, flash } = makeHarness();
      authService.isValidEmailAddress.mockImplementation(() => {
        throw new Error('validator offline');
      });
      const res = response();

      await controller.requestEmailVerification(
        request({ body: { email: 'alice@example.test' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'An error occurred while processing your request. Please try again later.'
      );
      expect(res.render).toHaveBeenCalledWith('auth/email-verification', {
        title: 'Verify Email - Parako',
      });
    });

    it('requires authentication to resend verification for a session user', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.isAuthenticated.mockResolvedValue(false);
      const res = response();

      await controller.resendEmailVerification(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'You must be logged in to resend verification email.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([undefined, { username: 'alice' }])(
      'rejects resend with incomplete active-user state %j',
      async activeUser => {
        const { controller, flash, sessionManager, userService } =
          makeHarness();
        sessionManager.isAuthenticated.mockResolvedValue(true);
        sessionManager.getActiveUser.mockReturnValue(activeUser);
        const res = response();

        await controller.resendEmailVerification(request(), res);

        expect(flash.error).toHaveBeenCalledWith(
          'User information not found in session.'
        );
        expect(userService.findOne).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      }
    );

    it('handles a session user that no longer exists', async () => {
      const { controller, flash, sessionManager, userService } = makeHarness();
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
      userService.findOne.mockResolvedValue(null);
      const res = response();

      await controller.resendEmailVerification(request(), res);

      expect(userService.findOne).toHaveBeenCalledWith({ _id: 'user-1' });
      expect(flash.error).toHaveBeenCalledWith('User not found.');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('returns an already verified session user to the dashboard', async () => {
      const { controller, flash, sessionManager, userService } = makeHarness();
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
      userService.findOne.mockResolvedValue(user({ email_verified: true }));
      const res = response();

      await controller.resendEmailVerification(request(), res);

      expect(flash.info).toHaveBeenCalledWith(
        'Your email is already verified.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('resends verification for an authenticated unverified user', async () => {
      const {
        authService,
        controller,
        flash,
        notificationService,
        sessionManager,
        userService,
      } = makeHarness();
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
      const unverifiedUser = user({ email_verified: false, locale: 'fr' });
      userService.findOne.mockResolvedValue(unverifiedUser);
      const res = response();

      await controller.resendEmailVerification(request(), res);

      expect(authService.generateEmailVerificationToken).toHaveBeenCalledWith(
        unverifiedUser._id
      );
      expect(notificationService.sendVerification).toHaveBeenCalledWith(
        {
          email: 'alice@example.test',
          username: 'Alice',
          locale: 'fr',
        },
        'https://id.example.test/auth/verify-email?token=verification-token'
      );
      expect(flash.success).toHaveBeenCalledWith(
        'Verification email has been sent. Please check your inbox.'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it('uses the username when resending verification for a sparse profile', async () => {
      const { controller, notificationService, sessionManager, userService } =
        makeHarness();
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
      userService.findOne.mockResolvedValue(
        user({ email_verified: false, given_name: undefined })
      );

      await controller.resendEmailVerification(request(), response());

      expect(notificationService.sendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice' }),
        expect.any(String)
      );
    });

    it('contains authenticated verification resend failures', async () => {
      const { controller, flash, sessionManager } = makeHarness();
      sessionManager.isAuthenticated.mockRejectedValue(
        new Error('session store offline')
      );
      const res = response();

      await controller.resendEmailVerification(request(), res);

      expect(flash.error).toHaveBeenCalledWith(
        'An error occurred while resending the verification email. Please try again later.'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification?status=pending'
      );
    });

    it.each([undefined, '', ['verification-token']])(
      'rejects malformed email verification token %j',
      async token => {
        const { authService, controller, flash } = makeHarness();
        const res = response();

        await controller.verifyEmail(request({ query: { token } }), res);

        expect(flash.error).toHaveBeenCalledWith('Invalid verification token.');
        expect(authService.verifyEmail).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/email-verification');
      }
    );

    it('redirects a verified public user to login through the success page', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.verifyEmail.mockResolvedValue(
        user({
          email: 'alice+test@example.test',
          given_name: '',
        })
      );
      sessionManager.isAuthenticated.mockResolvedValue(false);
      const res = response();

      await controller.verifyEmail(
        request({ query: { token: 'verification-token' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification/success?email=alice%2Btest%40example.test&name=alice&next=/auth/login'
      );
    });

    it('encodes an empty email for a verified public user without contact data', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.verifyEmail.mockResolvedValue(
        user({ email: undefined, given_name: undefined })
      );
      sessionManager.isAuthenticated.mockResolvedValue(false);
      const res = response();

      await controller.verifyEmail(
        request({ query: { token: 'verification-token' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification/success?email=&name=alice&next=/auth/login'
      );
    });

    it('updates the active authenticated account after email verification', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      const verifiedUser = user();
      authService.verifyEmail.mockResolvedValue(verifiedUser);
      sessionManager.isAuthenticated.mockResolvedValue(true);
      const active = { id: 'user-1', username: 'alice', email_verified: false };
      const authenticatedUsers = { active, others: [] as unknown[] };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue(authenticatedUsers);
      const req = request({ query: { token: 'verification-token' } });
      const res = response();

      await controller.verifyEmail(req, res);

      expect(active.email_verified).toBe(true);
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'authenticatedUsers',
        authenticatedUsers
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/email-verification/success?email=alice%40example.test&name=Alice&next=/accounts/dashboard'
      );
    });

    it('continues when the active verified account has no session account list', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.verifyEmail.mockResolvedValue(user());
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({
        id: 'user-1',
        username: 'alice',
        email_verified: false,
      });
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      const res = response();

      await controller.verifyEmail(
        request({ query: { token: 'verification-token' } }),
        res
      );

      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('next=/accounts/dashboard')
      );
    });

    it('continues when an unrelated active account has no session account list', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.verifyEmail.mockResolvedValue(user());
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({
        id: 'active-user',
        username: 'active',
      });
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);

      await controller.verifyEmail(
        request({ query: { token: 'verification-token' } }),
        response()
      );

      expect(sessionManager.set).not.toHaveBeenCalled();
    });

    it.each([
      [{ id: 'user-1', username: 'alice' }, 'id'],
      [{ id: 'other-id', username: 'alice' }, 'username'],
    ])(
      'updates another authenticated account matched by %s',
      async (otherAccount, _match) => {
        const { authService, controller, sessionManager } = makeHarness();
        authService.verifyEmail.mockResolvedValue(user());
        sessionManager.isAuthenticated.mockResolvedValue(true);
        sessionManager.getActiveUser.mockReturnValue({
          id: 'active-user',
          username: 'active',
        });
        const authenticatedUsers = {
          active: { id: 'active-user' },
          others: [{ ...otherAccount, email_verified: false }],
        };
        sessionManager.getAuthenticatedUsers.mockReturnValue(
          authenticatedUsers
        );
        const req = request({ query: { token: 'verification-token' } });
        const res = response();

        await controller.verifyEmail(req, res);

        expect(authenticatedUsers.others[0]?.email_verified).toBe(true);
        expect(sessionManager.set).toHaveBeenCalledWith(
          req,
          'authenticatedUsers',
          authenticatedUsers
        );
      }
    );

    it('continues when no alternate session account matches the verified user', async () => {
      const { authService, controller, sessionManager } = makeHarness();
      authService.verifyEmail.mockResolvedValue(user());
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({
        id: 'active-user',
        username: 'active',
      });
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: { id: 'active-user' },
        others: [{ id: 'other-user', username: 'other' }],
      });

      await controller.verifyEmail(
        request({ query: { token: 'verification-token' } }),
        response()
      );

      expect(sessionManager.set).not.toHaveBeenCalled();
    });

    it.each([
      [
        new Error('Invalid or expired token'),
        'Your verification link has expired or is invalid. Please request a new one.',
      ],
      [
        new Error('database offline'),
        'An error occurred during email verification. Please try again later.',
      ],
      [
        'database offline',
        'An error occurred during email verification. Please try again later.',
      ],
    ])(
      'maps email verification failure %j to a safe message',
      async (failure, expectedMessage) => {
        const { authService, controller, flash } = makeHarness();
        authService.verifyEmail.mockRejectedValue(failure);
        const res = response();

        await controller.verifyEmail(
          request({ query: { token: 'verification-token' } }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(expectedMessage);
        expect(res.redirect).toHaveBeenCalledWith('/auth/email-verification');
      }
    );
  });

  describe('account recovery', () => {
    it('renders account recovery with only login-capable custom identifiers', () => {
      const { controller, userService } = makeHarness();
      const loginField = {
        slot: 1,
        name: 'Member ID',
        usable_for_login: true,
      };
      userService.getCustomIdentifierFields.mockReturnValue([
        loginField,
        { slot: 2, name: 'Internal ID', usable_for_login: false },
      ]);
      const res = response();

      controller.accountRecovery(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/account-recovery', {
        title: 'auth.account_recovery_page.title - Parako',
        error: null,
        success: null,
        identifier: null,
        authentication: { customIdentifiers: [loginField] },
      });
    });

    it.each([undefined, '', '   ', [], {}, 42])(
      'rejects malformed recovery identifier %j before lookup',
      async identifier => {
        const { controller, userService } = makeHarness();
        const res = response();

        await controller.processAccountRecovery(
          request({ body: { identifier } }),
          res
        );

        expect(userService.findByEmail).not.toHaveBeenCalled();
        expect(userService.findByPhoneNumber).not.toHaveBeenCalled();
        expect(userService.findByUsername).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/account-recovery', {
          title: 'auth.account_recovery_page.title - Parako',
          error: 'Please enter your email, phone, or username',
          success: null,
          identifier: undefined,
          authentication: { customIdentifiers: [] },
        });
      }
    );

    it('does not reveal whether an existing account has recovery methods', async () => {
      const unknownHarness = makeHarness();
      unknownHarness.userService.findByEmail.mockResolvedValue(null);
      unknownHarness.userService.findByUsername.mockResolvedValue(null);
      const unknownResponse = response();

      await unknownHarness.controller.processAccountRecovery(
        request({ body: { identifier: 'alice@example.test' } }),
        unknownResponse
      );

      const existingHarness = makeHarness();
      existingHarness.userService.findByEmail.mockResolvedValue(user());
      existingHarness.recoveryService.getAvailableMethods.mockResolvedValue([]);
      const existingResponse = response();

      await existingHarness.controller.processAccountRecovery(
        request({ body: { identifier: 'alice@example.test' } }),
        existingResponse
      );

      const expectedRender = [
        'auth/account-recovery',
        {
          title: 'auth.account_recovery_page.title - Parako',
          error:
            'If an account exists with this identifier, recovery options will be shown.',
          success: null,
          identifier: 'alice@example.test',
          authentication: { customIdentifiers: [] },
        },
      ];
      expect(unknownResponse.render).toHaveBeenCalledWith(...expectedRender);
      expect(existingResponse.render).toHaveBeenCalledWith(...expectedRender);
    });

    it('stores sorted recovery methods and a masked email for an email lookup', async () => {
      const { controller, oidcUtils, recoveryService, session, userService } =
        makeHarness();
      const foundUser = user({ email: 'a@example.test' });
      oidcUtils.detectIdentifierType.mockReturnValue('email');
      userService.findByEmail.mockResolvedValue(foundUser);
      recoveryService.getAvailableMethods.mockResolvedValue([
        { method: 'sms', available: true, details: { phone: '+229***' } },
        { method: 'secondary_email', available: false },
        { method: 'security_questions', available: true },
        { method: 'backup_codes', available: true },
      ]);
      const res = response();

      await controller.processAccountRecovery(
        request({ body: { identifier: '  a@example.test  ' } }),
        res
      );

      expect(oidcUtils.detectIdentifierType).toHaveBeenCalledWith(
        'a@example.test'
      );
      expect(userService.findByEmail).toHaveBeenCalledWith('a@example.test');
      expect(userService.findByUsername).not.toHaveBeenCalled();
      expect(recoveryService.getAvailableMethods).toHaveBeenCalledWith(
        'user-1'
      );
      expect(session.get('recoveryAttempt')).toEqual({
        userId: 'user-1',
        username: 'alice',
        maskedIdentifier: 'a***@example.test',
        availableMethods: [
          { method: 'backup_codes', available: true },
          { method: 'security_questions', available: true },
          { method: 'sms', available: true, details: { phone: '+229***' } },
        ],
        timestamp: expect.any(Number),
      });
      expect(res.redirect).toHaveBeenCalledWith('/auth/recovery/method-select');
    });

    it('normalizes a phone lookup and falls back to masking the username', async () => {
      const { controller, oidcUtils, recoveryService, session, userService } =
        makeHarness();
      oidcUtils.detectIdentifierType.mockReturnValue('phone');
      userService.findByPhoneNumber.mockResolvedValue(
        user({ email: undefined, username: 'b' })
      );
      recoveryService.getAvailableMethods.mockResolvedValue([
        { method: 'sms', available: true },
      ]);
      const res = response();

      await controller.processAccountRecovery(
        request({ body: { identifier: ' (+229) 00-00.00 ' } }),
        res
      );

      expect(userService.findByPhoneNumber).toHaveBeenCalledWith('+229000000');
      expect(session.get('recoveryAttempt')).toEqual(
        expect.objectContaining({
          username: 'b',
          maskedIdentifier: 'b***',
        })
      );
    });

    it('falls back from username to case-aware custom identifier lookups', async () => {
      const { controller, oidcUtils, recoveryService, userService } =
        makeHarness();
      oidcUtils.detectIdentifierType.mockReturnValue('username');
      userService.findByUsername.mockResolvedValue(null);
      userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          usable_for_login: true,
          case_sensitive: false,
        },
        {
          slot: 2,
          name: 'Case ID',
          usable_for_login: true,
          case_sensitive: true,
        },
        {
          slot: 3,
          name: 'Internal ID',
          usable_for_login: false,
          case_sensitive: false,
        },
      ]);
      userService.findByCustomIdentifier
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(user());
      recoveryService.getAvailableMethods.mockResolvedValue([
        { method: 'backup_codes', available: true },
      ]);
      const res = response();

      await controller.processAccountRecovery(
        request({ body: { identifier: '  Member-ABC  ' } }),
        res
      );

      expect(userService.findByUsername).toHaveBeenCalledWith('Member-ABC');
      expect(userService.findByCustomIdentifier).toHaveBeenNthCalledWith(
        1,
        1,
        'member-abc'
      );
      expect(userService.findByCustomIdentifier).toHaveBeenNthCalledWith(
        2,
        2,
        'Member-ABC'
      );
      expect(userService.findByCustomIdentifier).toHaveBeenCalledTimes(2);
      expect(res.redirect).toHaveBeenCalledWith('/auth/recovery/method-select');
    });

    it('uses an empty masked identifier when the recovered account has no display identifier', async () => {
      const { controller, recoveryService, session, userService } =
        makeHarness();
      userService.findByEmail.mockResolvedValue(
        user({ email: undefined, username: undefined })
      );
      recoveryService.getAvailableMethods.mockResolvedValue([
        { method: 'backup_codes', available: true },
      ]);
      const res = response();

      await controller.processAccountRecovery(
        request({ body: { identifier: 'alice@example.test' } }),
        res
      );

      expect(session.get('recoveryAttempt')).toEqual(
        expect.objectContaining({ maskedIdentifier: '' })
      );
    });

    it('contains account-recovery dependency failures', async () => {
      const { controller, logger, userService } = makeHarness();
      const loginField = {
        slot: 1,
        name: 'Member ID',
        usable_for_login: true,
      };
      userService.getCustomIdentifierFields.mockReturnValue([
        loginField,
        { slot: 2, name: 'Internal ID', usable_for_login: false },
      ]);
      userService.findByEmail.mockRejectedValue(
        new Error('user store offline')
      );
      const res = response();

      await controller.processAccountRecovery(
        request({ body: { identifier: 'alice@example.test' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'process_account_recovery_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/account-recovery', {
        title: 'auth.account_recovery_page.title - Parako',
        error: 'An error occurred. Please try again.',
        success: null,
        identifier: undefined,
        authentication: { customIdentifiers: [loginField] },
      });
    });

    it.each([undefined, { userId: 'user-1' }])(
      'redirects method selection without a complete recovery attempt %j',
      async attempt => {
        const { controller, session } = makeHarness();
        if (attempt) session.set('recoveryAttempt', attempt);
        const res = response();

        await controller.recoveryMethodSelect(request(), res);

        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
        expect(res.render).not.toHaveBeenCalled();
      }
    );

    it('renders the recovery methods stored in the session', async () => {
      const { controller, session } = makeHarness();
      const attempt = recoveryAttempt();
      session.set('recoveryAttempt', attempt);
      const res = response();

      await controller.recoveryMethodSelect(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/recovery-method-select', {
        title: 'auth.recovery_method_select.title - Parako',
        maskedIdentifier: 'al***@example.test',
        availableMethods: attempt.availableMethods,
        error: null,
      });
    });

    it('redirects method processing without a complete recovery attempt', async () => {
      const { controller } = makeHarness();
      const res = response();

      await controller.processRecoveryMethodSelect(
        request({ body: { method: 'backup_codes' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it.each([undefined, '', 'secondary_email', 'sms'])(
      'rejects unavailable recovery method %j',
      async method => {
        const { controller, session, sessionManager } = makeHarness();
        const attempt = recoveryAttempt({
          availableMethods: [
            { method: 'backup_codes', available: true },
            { method: 'sms', available: false },
          ],
        });
        session.set('recoveryAttempt', attempt);
        const res = response();

        await controller.processRecoveryMethodSelect(
          request({ body: { method } }),
          res
        );

        expect(sessionManager.set).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/recovery-method-select', {
          title: 'auth.recovery_method_select.title - Parako',
          maskedIdentifier: 'al***@example.test',
          availableMethods: attempt.availableMethods,
          error: 'Selected recovery method is not available',
        });
      }
    );

    it.each([
      ['backup_codes', '/auth/recovery/backup-codes'],
      ['secondary_email', '/auth/recovery/secondary-email'],
      ['security_questions', '/auth/recovery/security-questions'],
      ['sms', '/auth/recovery/sms'],
    ])(
      'stores %s selection and redirects to its recovery flow',
      async (method, expectedRedirect) => {
        const { controller, session, sessionManager } = makeHarness();
        const selected = {
          method,
          available: true,
          details: { channel: method },
        };
        const attempt = recoveryAttempt({ availableMethods: [selected] });
        session.set('recoveryAttempt', attempt);
        const req = request({ body: { method } });
        const res = response();

        await controller.processRecoveryMethodSelect(req, res);

        expect(sessionManager.set).toHaveBeenCalledWith(
          req,
          'recoveryAttempt',
          {
            ...attempt,
            method,
            methodDetails: selected.details,
          }
        );
        expect(res.redirect).toHaveBeenCalledWith(expectedRedirect);
      }
    );

    it('rejects an unsupported recovery method without mutating the attempt', async () => {
      const { controller, session, sessionManager } = makeHarness();
      const attempt = recoveryAttempt({
        availableMethods: [{ method: 'voice', available: true }],
      });
      session.set('recoveryAttempt', attempt);
      const res = response();

      await controller.processRecoveryMethodSelect(
        request({ body: { method: 'voice' } }),
        res
      );

      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/recovery-method-select', {
        title: 'auth.recovery_method_select.title - Parako',
        maskedIdentifier: 'al***@example.test',
        availableMethods: attempt.availableMethods,
        error: 'Invalid recovery method selected',
      });
    });

    it('rejects a non-string recovery method that matches malformed session data', async () => {
      const { controller, session, sessionManager } = makeHarness();
      const malformedMethod = { value: 'sms' };
      const attempt = recoveryAttempt({
        availableMethods: [
          { method: malformedMethod as never, available: true },
        ],
      });
      session.set('recoveryAttempt', attempt);
      const res = response();

      await controller.processRecoveryMethodSelect(
        request({ body: { method: malformedMethod } }),
        res
      );

      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-method-select',
        expect.objectContaining({ error: 'Invalid recovery method selected' })
      );
    });

    it('falls back safely when the user store remains unavailable during security-question error handling', async () => {
      const { controller, session, userService } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockRejectedValue(new Error('user store offline'));
      const res = response();

      await expect(
        controller.processRecoverySecurityQuestions(request(), res)
      ).resolves.toBeUndefined();

      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it.each([undefined, recoveryAttempt({ method: 'sms' })])(
      'redirects an invalid security-question recovery attempt %j',
      async attempt => {
        const { controller, session, userService } = makeHarness();
        if (attempt) session.set('recoveryAttempt', attempt);
        const res = response();

        await controller.recoverySecurityQuestions(request(), res);

        expect(userService.findById).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
      }
    );

    it.each([null, user({ recovery: undefined })])(
      'redirects security-question recovery when user data is incomplete %j',
      async foundUser => {
        const { controller, session, userService } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'security_questions' })
        );
        userService.findById.mockResolvedValue(foundUser);
        const res = response();

        await controller.recoverySecurityQuestions(request(), res);

        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
      }
    );

    it('renders only public security-question fields and lockout status', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = securityQuestionsUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.checkSecurityQuestionsLockout.mockReturnValue({
        locked: true,
        minutesRemaining: 4,
        remainingAttempts: 0,
      });
      const res = response();

      await controller.recoverySecurityQuestions(request(), res);

      expect(recoveryUtils.checkSecurityQuestionsLockout).toHaveBeenCalledWith(
        foundUser
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-security-questions',
        {
          title: 'auth.recovery_security_questions.title - Parako',
          questions: [
            { id: 'question-1', question_key: 'first_pet' },
            { id: 'question-2', question_key: 'birth_city' },
          ],
          lockout: {
            locked: true,
            minutesRemaining: 4,
            remainingAttempts: 0,
          },
          error: null,
        }
      );
    });

    it('redirects security-question processing without the selected method', async () => {
      const { controller, recoveryService, session } = makeHarness();
      session.set('recoveryAttempt', recoveryAttempt({ method: 'sms' }));
      const res = response();

      await controller.processRecoverySecurityQuestions(request(), res);

      expect(recoveryService.verifySecurityQuestions).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it('redirects security-question processing when the user data disappeared', async () => {
      const { controller, recoveryService, session, userService } =
        makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockResolvedValue(null);
      const res = response();

      await controller.processRecoverySecurityQuestions(request(), res);

      expect(recoveryService.verifySecurityQuestions).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it('maps submitted security-question arrays and renders a failed verification', async () => {
      const {
        clientDeviceInfoManager,
        controller,
        recoveryService,
        recoveryUtils,
        session,
        userService,
      } = makeHarness();
      const foundUser = securityQuestionsUser();
      const updatedUser = securityQuestionsUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById
        .mockResolvedValueOnce(foundUser)
        .mockResolvedValueOnce(updatedUser);
      recoveryService.verifySecurityQuestions.mockResolvedValue({
        success: false,
        error: 'Answers do not match',
      });
      recoveryUtils.checkSecurityQuestionsLockout.mockReturnValue({
        locked: false,
        minutesRemaining: 0,
        remainingAttempts: 1,
      });
      const res = response();

      await controller.processRecoverySecurityQuestions(
        request({
          body: {
            questionIds: ['question-1', 'question-2', 'question-3'],
            answers: ['Milo', '', 'ignored-without-question'],
          },
        }),
        res
      );

      expect(
        clientDeviceInfoManager.getClientInfoFromRequest
      ).toHaveBeenCalled();
      expect(recoveryService.verifySecurityQuestions).toHaveBeenCalledWith(
        foundUser,
        new Map([['question-1', 'Milo']]),
        { ip: '127.0.0.1', userAgent: 'vitest' }
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-security-questions',
        expect.objectContaining({
          error: 'Answers do not match',
          lockout: {
            locked: false,
            minutesRemaining: 0,
            remainingAttempts: 1,
          },
        })
      );
    });

    it('uses safe defaults after a failed security-question verification when the user disappears', async () => {
      const { controller, recoveryService, session, userService } =
        makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById
        .mockResolvedValueOnce(securityQuestionsUser())
        .mockResolvedValueOnce(null);
      recoveryService.verifySecurityQuestions.mockResolvedValue({
        success: false,
      });
      const res = response();

      await controller.processRecoverySecurityQuestions(
        request({ body: { questionIds: {}, answers: {} } }),
        res
      );

      expect(recoveryService.verifySecurityQuestions).toHaveBeenCalledWith(
        expect.anything(),
        new Map(),
        expect.anything()
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-security-questions',
        expect.objectContaining({
          error: 'Incorrect answers. Please try again.',
          lockout: {
            locked: false,
            minutesRemaining: undefined,
            remainingAttempts: 0,
          },
        })
      );
    });

    it('authenticates the recovered user after correct security answers', async () => {
      const {
        controller,
        flash,
        recoveryService,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      const foundUser = securityQuestionsUser({
        is_admin: true,
        zoneinfo: undefined,
        locale: undefined,
      });
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryService.verifySecurityQuestions.mockResolvedValue({
        success: true,
      });
      const req = request();
      const res = response();

      await controller.processRecoverySecurityQuestions(req, res);

      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'recoveryAttempt'
      );
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: 'user-1',
          username: 'alice',
          is_admin: true,
          zoneinfo: 'UTC',
          locale: 'en',
          last_used: expect.any(Number),
        }),
      });
      expect(flash.success).toHaveBeenCalledWith(
        'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('stores a boolean non-admin state after successful security-question recovery', async () => {
      const {
        controller,
        recoveryService,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockResolvedValue(
        securityQuestionsUser({ is_admin: undefined })
      );
      recoveryService.verifySecurityQuestions.mockResolvedValue({
        success: true,
      });

      await controller.processRecoverySecurityQuestions(request(), response());

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({ is_admin: false }),
        }
      );
    });

    it('re-renders the questions when verification throws but the user can be reloaded', async () => {
      const { controller, recoveryService, session, userService } =
        makeHarness();
      const foundUser = securityQuestionsUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryService.verifySecurityQuestions.mockRejectedValue(
        new Error('verification store offline')
      );
      const res = response();

      await controller.processRecoverySecurityQuestions(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-security-questions',
        {
          title: 'auth.recovery_security_questions.title - Parako',
          questions: [
            { id: 'question-1', question_key: 'first_pet' },
            { id: 'question-2', question_key: 'birth_city' },
          ],
          lockout: { locked: false, remainingAttempts: 0 },
          error: 'An error occurred. Please try again.',
        }
      );
    });

    it('redirects when the user reload lacks questions after a verification failure', async () => {
      const { controller, recoveryService, session, userService } =
        makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'security_questions' })
      );
      userService.findById
        .mockResolvedValueOnce(securityQuestionsUser())
        .mockResolvedValueOnce(user({ recovery: undefined }));
      recoveryService.verifySecurityQuestions.mockRejectedValue(
        new Error('verification store offline')
      );
      const res = response();

      await controller.processRecoverySecurityQuestions(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it('redirects when security-question processing fails without a recovery attempt', async () => {
      const { clientDeviceInfoManager, controller } = makeHarness();
      clientDeviceInfoManager.getClientInfoFromRequest.mockImplementation(
        () => {
          throw new Error('device parser failed');
        }
      );
      const res = response();

      await controller.processRecoverySecurityQuestions(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it.each([undefined, recoveryAttempt({ method: 'backup_codes' })])(
      'redirects an invalid SMS recovery attempt %j',
      async attempt => {
        const { controller, session } = makeHarness();
        if (attempt) session.set('recoveryAttempt', attempt);
        const res = response();

        await controller.recoverySms(request(), res);

        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
      }
    );

    it.each([
      [undefined, '***'],
      [{ maskedPhone: '+229 *** 00' }, '+229 *** 00'],
    ])(
      'renders SMS recovery with method details %j',
      async (methodDetails, maskedPhone) => {
        const { controller, session } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'sms', methodDetails })
        );
        const res = response();

        await controller.recoverySms(request(), res);

        expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
          title: 'auth.recovery_sms.title - Parako',
          maskedPhone,
          codeSent: false,
          retryAfter: null,
          error: null,
          success: null,
        });
      }
    );

    it('redirects SMS processing without the selected method', async () => {
      const { controller, session, userService } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      const res = response();

      await controller.processRecoverySms(
        request({ body: { action: 'send_code' } }),
        res
      );

      expect(userService.findById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it('rejects unsupported SMS recovery actions', async () => {
      const { controller, session } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'sms', methodDetails: undefined })
      );
      const res = response();

      await controller.processRecoverySms(
        request({ body: { action: 'verify_code' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
        title: 'auth.recovery_sms.title - Parako',
        maskedPhone: '***',
        codeSent: false,
        retryAfter: null,
        error: 'Invalid action',
        success: null,
      });
    });

    it.each([null, user({ phone_number: undefined })])(
      'rejects SMS recovery without a usable phone %j',
      async foundUser => {
        const { controller, session, smsService, userService } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({
            method: 'sms',
            methodDetails: { maskedPhone: '+229***' },
          })
        );
        userService.findById.mockResolvedValue(foundUser);
        const res = response();

        await controller.processRecoverySms(
          request({ body: { action: 'send_code' } }),
          res
        );

        expect(smsService.sendRecoveryCode).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
          title: 'auth.recovery_sms.title - Parako',
          maskedPhone: '+229***',
          codeSent: false,
          retryAfter: null,
          error: 'Phone number not available for this account',
          success: null,
        });
      }
    );

    it.each([
      [
        { success: false, retryAfter: 30, error: 'Rate limited' },
        30,
        'Rate limited',
      ],
      [{ success: false }, null, 'Failed to send SMS. Please try again.'],
    ])(
      'renders SMS delivery failure %j',
      async (smsResult, retryAfter, expectedError) => {
        const { controller, recoveryUtils, session, smsService, userService } =
          makeHarness();
        session.set('recoveryAttempt', recoveryAttempt({ method: 'sms' }));
        userService.findById.mockResolvedValue(user());
        recoveryUtils.generateSmsVerificationCode.mockReturnValue({
          code: '123456',
          hash: 'hashed-code',
          expiresAt: new Date('2026-08-07T17:00:00.000Z'),
        });
        smsService.sendRecoveryCode.mockResolvedValue(smsResult);
        const res = response();

        await controller.processRecoverySms(
          request({ body: { action: 'send_code' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
          title: 'auth.recovery_sms.title - Parako',
          maskedPhone: '***',
          codeSent: false,
          retryAfter,
          error: expectedError,
          success: null,
        });
      }
    );

    it('contains SMS recovery dependency failures behind a generic response', async () => {
      const { controller, logger, session, userService } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({
          method: 'sms',
          methodDetails: { maskedPhone: '+229***' },
        })
      );
      const failure = new Error('user store unavailable');
      userService.findById.mockRejectedValue(failure);
      const res = response();

      await expect(
        controller.processRecoverySms(
          request({ body: { action: 'send_code' } }),
          res
        )
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_sms_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
        title: 'auth.recovery_sms.title - Parako',
        maskedPhone: '+229***',
        codeSent: false,
        retryAfter: null,
        error: 'An error occurred. Please try again.',
        success: null,
      });
    });

    it.each([
      [undefined, { enabled: false, methods: [], phone: '', verified: false }],
      [
        {
          enabled: true,
          methods: ['sms'],
          sms: { phone_number: '+22900000000', verified: true },
        },
        {
          enabled: true,
          methods: ['sms'],
          phone: '+22900000000',
          verified: true,
        },
      ],
    ])(
      'persists SMS challenge with recovery defaults for %j',
      async (existingRecovery, expected) => {
        const {
          clientDeviceInfoManager,
          controller,
          recoveryUtils,
          session,
          sessionManager,
          smsService,
          userService,
        } = makeHarness();
        const expiresAt = new Date('2026-08-07T17:00:00.000Z');
        const foundUser = user({ recovery: existingRecovery });
        const attempt = recoveryAttempt({
          method: 'sms',
          methodDetails: { maskedPhone: '+229***' },
        });
        session.set('recoveryAttempt', attempt);
        userService.findById.mockResolvedValue(foundUser);
        recoveryUtils.generateSmsVerificationCode.mockReturnValue({
          code: '123456',
          hash: 'hashed-code',
          expiresAt,
        });
        smsService.sendRecoveryCode.mockResolvedValue({ success: true });
        const req = request({ body: { action: 'send_code' } });
        const res = response();

        await controller.processRecoverySms(req, res);

        expect(smsService.sendRecoveryCode).toHaveBeenCalledWith(
          '+22900000000',
          '123456',
          '127.0.0.1'
        );
        expect(
          clientDeviceInfoManager.getClientInfoFromRequest
        ).toHaveBeenCalledWith(req);
        expect(userService.updateById).toHaveBeenCalledWith('user-1', {
          recovery: {
            ...(existingRecovery || {}),
            enabled: expected.enabled,
            methods: expected.methods,
            sms: {
              ...(existingRecovery?.sms || {}),
              phone_number: expected.phone,
              verified: expected.verified,
              verification_code: 'hashed-code',
              verification_expires: expiresAt,
            },
          },
        });
        expect(sessionManager.set).toHaveBeenCalledWith(
          req,
          'recoveryAttempt',
          {
            ...attempt,
            smsSent: true,
            smsExpiresAt: '2026-08-07T17:00:00.000Z',
          }
        );
        expect(res.render).toHaveBeenCalledWith('auth/recovery-sms', {
          title: 'auth.recovery_sms.title - Parako',
          maskedPhone: '+229***',
          codeSent: true,
          retryAfter: null,
          error: null,
          success: 'Verification code sent successfully',
        });
      }
    );

    it.each(['show', 'process'])(
      'binds the %s backup-code flow to the selected recovery method',
      async operation => {
        const { clientDeviceInfoManager, controller, session } = makeHarness();
        session.set('recoveryAttempt', recoveryAttempt({ method: 'sms' }));
        const req = request({ body: { code: 'backup-code' } });
        const res = response();

        if (operation === 'show') {
          controller.recoveryBackupCodes(req, res);
        } else {
          await controller.processRecoveryBackupCodes(req, res);
        }

        expect(
          clientDeviceInfoManager.getClientInfoFromRequest
        ).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
        expect(res.render).not.toHaveBeenCalled();
      }
    );

    it('renders the selected backup-code recovery flow', () => {
      const { controller, session } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      const res = response();

      controller.recoveryBackupCodes(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: null,
      });
    });

    it.each([undefined, '', [], {}, 123])(
      'rejects malformed backup code %j before dependencies',
      async code => {
        const {
          clientDeviceInfoManager,
          controller,
          recoveryUtils,
          session,
          userService,
        } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'backup_codes' })
        );
        const res = response();

        await controller.processRecoveryBackupCodes(
          request({ body: { code } }),
          res
        );

        expect(
          clientDeviceInfoManager.getClientInfoFromRequest
        ).not.toHaveBeenCalled();
        expect(userService.findById).not.toHaveBeenCalled();
        expect(recoveryUtils.verifyUserBackupCode).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
          title: 'auth.recovery_backup_codes.title - Parako',
          username: 'alice',
          error: 'Backup code is required',
        });
      }
    );

    it.each([
      null,
      user({ _id: 'user-1', recovery: undefined }),
      user({ _id: 'user-1', recovery: { enabled: true } }),
    ])('rejects backup recovery without stored codes %j', async foundUser => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      const res = response();

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'backup-code' } }),
        res
      );

      expect(recoveryUtils.checkRecoveryLockout).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'No backup codes found for this account',
      });
    });

    it('blocks backup-code verification while recovery is locked', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = backupCodesUser();
      const lockedUntil = new Date('2026-08-07T18:00:00.000Z');
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.checkRecoveryLockout.mockReturnValue({
        locked: true,
        lockedUntil,
        minutesRemaining: 17,
      });
      const req = request({ body: { code: 'backup-code' } });
      const res = response();

      await controller.processRecoveryBackupCodes(req, res);

      expect(recoveryUtils.verifyUserBackupCode).not.toHaveBeenCalled();
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'recovery_attempt_blocked',
        foundUser,
        'Recovery attempt blocked due to lockout',
        expect.objectContaining({
          metadata: {
            method: 'backup_codes',
            lockedUntil,
            minutesRemaining: 17,
          },
        })
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'Too many failed attempts. Please try again in 17 minutes.',
      });
    });

    it('records an invalid backup code and reports the remaining attempts', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = backupCodesUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({ valid: false });
      recoveryUtils.recordFailedRecoveryAttempt.mockReturnValue({
        failedAttempts: 3,
        locked: false,
      });
      const req = request({ body: { code: '  invalid-code  ' } });
      const res = response();

      await controller.processRecoveryBackupCodes(req, res);

      expect(recoveryUtils.verifyUserBackupCode).toHaveBeenCalledWith(
        foundUser,
        'invalid-code'
      );
      expect(userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: {
          ...foundUser.recovery,
          lockout: foundUser.recovery!.lockout,
        },
      });
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'recovery_attempt_failed',
        foundUser,
        'Failed backup code recovery attempt',
        expect.objectContaining({
          metadata: {
            method: 'backup_codes',
            error: 'Invalid backup code',
            failedAttempts: 3,
            locked: false,
          },
        })
      );
      expect(activityMocks.warning).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'Invalid backup code (2 attempts remaining)',
      });
    });

    it('preserves a custom invalid-code error before the warning threshold', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = backupCodesUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: false,
        error: 'Backup code already used',
      });
      recoveryUtils.recordFailedRecoveryAttempt.mockReturnValue({
        failedAttempts: 1,
        locked: false,
      });
      const res = response();

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'invalid-code' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'Backup code already used',
      });
    });

    it('records and reports a backup-code lockout transition', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = backupCodesUser();
      const now = Date.parse('2026-08-07T17:00:00.000Z');
      const lockedUntil = new Date(now + 4 * 60 * 1000);
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: false,
        error: 'Incorrect backup code',
      });
      recoveryUtils.recordFailedRecoveryAttempt.mockReturnValue({
        failedAttempts: 5,
        locked: true,
        lockedUntil,
      });
      const req = request({ body: { code: 'invalid-code' } });
      const res = response();

      try {
        await controller.processRecoveryBackupCodes(req, res);
      } finally {
        nowSpy.mockRestore();
      }

      expect(activityMocks.warning).toHaveBeenCalledWith(
        'recovery_lockout_triggered',
        foundUser,
        'User locked out due to too many failed recovery attempts',
        expect.objectContaining({
          metadata: {
            method: 'backup_codes',
            failedAttempts: 5,
            lockedUntil,
          },
        })
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'Too many failed attempts. Please try again in 4 minutes.',
      });
    });

    it('rejects a valid backup-code result without the matched stored code', async () => {
      const {
        clientDeviceInfoManager,
        controller,
        logger,
        recoveryUtils,
        session,
        userService,
      } = makeHarness();
      const foundUser = backupCodesUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({ valid: true });
      const res = response();

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'backup-code' } }),
        res
      );

      expect(
        clientDeviceInfoManager.getClientInfoFromRequest
      ).not.toHaveBeenCalled();
      expect(userService.updateById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'No matched code returned from verification',
        { username: 'alice', userId: 'user-1' }
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'Verification failed. Please try again.',
      });
    });

    it.each([
      [
        ['hash-one', 'hash-two', 'hash-three', 'hash-four'],
        ['hash-one', 'hash-three', 'hash-four'],
        false,
      ],
      [
        ['hash-one', 'hash-two', 'hash-three'],
        ['hash-one', 'hash-three'],
        true,
      ],
    ])(
      'consumes a backup code and authenticates with remaining codes %j',
      async (codes, remainingCodes, expectsWarning) => {
        const {
          controller,
          flash,
          notificationService,
          recoveryUtils,
          session,
          sessionManager,
          userService,
        } = makeHarness();
        const foundUser = backupCodesUser({
          locale: undefined,
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes,
              generated_at: new Date('2026-08-01T00:00:00.000Z'),
            },
            lockout: { failed_attempts: 2 },
          },
        });
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'backup_codes' })
        );
        userService.findById.mockResolvedValue(foundUser);
        recoveryUtils.verifyUserBackupCode.mockResolvedValue({
          valid: true,
          matchedCode: 'hash-two',
        });
        recoveryUtils.clearRecoveryLockout.mockImplementation(target => {
          target.recovery.lockout = { failed_attempts: 0 };
        });
        recoveryUtils.setLastRecoveredAt.mockImplementation(target => {
          target.recovery.last_recovered_at = new Date(
            '2026-08-07T17:00:00.000Z'
          );
        });
        const req = request({ body: { code: 'plain-backup-code' } });
        const res = response();

        await controller.processRecoveryBackupCodes(req, res);

        expect(userService.updateById).toHaveBeenCalledWith('user-1', {
          recovery: {
            ...foundUser.recovery,
            backup_codes: {
              ...foundUser.recovery!.backup_codes,
              codes: remainingCodes,
            },
            lockout: { failed_attempts: 0 },
            last_recovered_at: new Date('2026-08-07T17:00:00.000Z'),
          },
        });
        expect(activityMocks.success).toHaveBeenCalledWith(
          'account_recovery_successful',
          foundUser,
          'User successfully recovered account using backup code',
          expect.objectContaining({ actor: foundUser })
        );
        expect(notificationService.sendSecurityAlert).toHaveBeenCalledWith(
          { email: 'alice@example.test', username: 'alice' },
          'account_recovered',
          {
            method: 'backup_codes',
            timestamp: expect.any(String),
            ip: '127.0.0.1',
            user_agent: 'vitest',
          }
        );
        if (expectsWarning) {
          expect(
            notificationService.sendBackupCodeWarning
          ).toHaveBeenCalledWith(
            {
              email: 'alice@example.test',
              username: 'alice',
              locale: undefined,
            },
            2,
            'https://id.example.test/accounts/settings#recovery'
          );
        } else {
          expect(
            notificationService.sendBackupCodeWarning
          ).not.toHaveBeenCalled();
        }
        expect(sessionManager.remove).toHaveBeenCalledWith(
          req,
          'recoveryAttempt'
        );
        expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
          currentActiveLoggedUser: expect.objectContaining({
            id: 'user-1',
            username: 'alice',
            full_name: 'Alice Doe',
            is_admin: false,
            zoneinfo: 'UTC',
            locale: 'en',
          }),
        });
        expect(flash.success).toHaveBeenCalledWith(
          'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
        );
        expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('contains backup-code notification delivery failures', async () => {
      const {
        controller,
        logger,
        notificationService,
        recoveryUtils,
        session,
        userService,
      } = makeHarness();
      const foundUser = backupCodesUser({
        recovery: {
          enabled: true,
          methods: ['backup_codes'],
          backup_codes: {
            codes: ['hash-one', 'hash-two', 'hash-three'],
            generated_at: new Date('2026-08-01T00:00:00.000Z'),
          },
          lockout: { failed_attempts: 0 },
        },
      });
      const securityFailure = new Error('security email unavailable');
      const warningFailure = new Error('warning email unavailable');
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: true,
        matchedCode: 'hash-two',
      });
      notificationService.sendSecurityAlert.mockRejectedValue(securityFailure);
      notificationService.sendBackupCodeWarning.mockRejectedValue(
        warningFailure
      );

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'backup-code' } }),
        response()
      );

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to send recovery notification email',
          { userId: 'user-1', error: securityFailure }
        );
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to send backup code warning email',
          {
            userId: 'user-1',
            remainingCodes: 2,
            error: warningFailure,
          }
        );
      });
    });

    it('renders a generic backup-code error with the recovery username', async () => {
      const { controller, logger, session, userService } = makeHarness();
      const failure = new Error('user store unavailable');
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'backup_codes' })
      );
      userService.findById.mockRejectedValue(failure);
      const res = response();

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'backup-code' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_backup_codes_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'alice',
        error: 'An error occurred. Please try again.',
      });
    });

    it('uses an anonymous fallback when recovery state disappears after failure', async () => {
      const { controller, sessionManager, userService } = makeHarness();
      sessionManager.get
        .mockReturnValueOnce(recoveryAttempt({ method: 'backup_codes' }))
        .mockReturnValueOnce(undefined);
      userService.findById.mockRejectedValue(
        new Error('user store unavailable')
      );
      const res = response();

      await controller.processRecoveryBackupCodes(
        request({ body: { code: 'backup-code' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    });

    it('contains a failing backup-code error fallback', async () => {
      const { controller, logger, sessionManager } = makeHarness();
      const failure = new Error('session store unavailable');
      sessionManager.get.mockImplementation(() => {
        throw failure;
      });
      const res = response();

      await expect(
        controller.processRecoveryBackupCodes(
          request({ body: { code: 'backup-code' } }),
          res
        )
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_backup_codes_failed',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_backup_codes_error_fallback_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-backup-codes', {
        title: 'auth.recovery_backup_codes.title - Parako',
        username: 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    });

    it.each(['show', 'process'])(
      'binds the %s secondary-email flow to the selected recovery method',
      async operation => {
        const { controller, session, userService } = makeHarness();
        session.set('recoveryAttempt', recoveryAttempt({ method: 'sms' }));
        const req = request({ body: { email: 'secondary@example.test' } });
        const res = response();

        if (operation === 'show') {
          controller.recoverySecondaryEmail(req, res);
        } else {
          await controller.processRecoverySecondaryEmail(req, res);
        }

        expect(userService.findById).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
        expect(res.render).not.toHaveBeenCalled();
      }
    );

    it('renders the selected secondary-email recovery flow', () => {
      const { controller, session } = makeHarness();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      const res = response();

      controller.recoverySecondaryEmail(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'alice',
        error: null,
      });
    });

    it.each([undefined, '', [], {}, 123])(
      'rejects malformed secondary email %j before dependencies',
      async email => {
        const { authService, controller, session, userService } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'secondary_email' })
        );
        const res = response();

        await controller.processRecoverySecondaryEmail(
          request({ body: { email } }),
          res
        );

        expect(authService.isValidEmailAddress).not.toHaveBeenCalled();
        expect(userService.findById).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith(
          'auth/recovery-secondary-email',
          {
            title: 'auth.recovery_secondary_email.title - Parako',
            username: 'alice',
            error: 'Valid email address is required',
          }
        );
      }
    );

    it.each(['not-an-email', 'alice@'])(
      'rejects validator-invalid secondary email %s',
      async email => {
        const { authService, controller, session, userService } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'secondary_email' })
        );
        authService.isValidEmailAddress.mockReturnValue(false);
        const res = response();

        await controller.processRecoverySecondaryEmail(
          request({ body: { email } }),
          res
        );

        expect(authService.isValidEmailAddress).toHaveBeenCalledWith(email);
        expect(userService.findById).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith(
          'auth/recovery-secondary-email',
          expect.objectContaining({
            error: 'Valid email address is required',
          })
        );
      }
    );

    it.each([
      null,
      user({ _id: 'user-1', recovery: undefined }),
      user({ _id: 'user-1', recovery: { enabled: true } }),
    ])(
      'rejects secondary-email recovery without a configured address %j',
      async foundUser => {
        const { controller, session, userService } = makeHarness();
        session.set(
          'recoveryAttempt',
          recoveryAttempt({ method: 'secondary_email' })
        );
        userService.findById.mockResolvedValue(foundUser);
        const res = response();

        await controller.processRecoverySecondaryEmail(
          request({ body: { email: 'secondary@example.test' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith(
          'auth/recovery-secondary-email',
          {
            title: 'auth.recovery_secondary_email.title - Parako',
            username: 'alice',
            error: 'No secondary email found for this account',
          }
        );
      }
    );

    it('rejects a secondary email that does not match the account', async () => {
      const { controller, notificationService, session, userService } =
        makeHarness();
      const foundUser = secondaryEmailUser();
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      userService.findById.mockResolvedValue(foundUser);
      const req = request({ body: { email: 'other@example.test' } });
      const res = response();

      await controller.processRecoverySecondaryEmail(req, res);

      expect(notificationService.sendTemplatedEmail).not.toHaveBeenCalled();
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'recovery_attempt_failed',
        foundUser,
        'Failed secondary email recovery attempt - email mismatch',
        expect.objectContaining({
          metadata: {
            method: 'secondary_email',
            error:
              'Email address does not match the registered secondary email',
          },
        })
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'alice',
        error: 'Email address does not match the registered secondary email',
      });
    });

    it('rejects an unverified secondary email', async () => {
      const { controller, notificationService, session, userService } =
        makeHarness();
      const foundUser = secondaryEmailUser({
        recovery: {
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: {
            email: 'secondary@example.test',
            verified: false,
          },
        },
      });
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      userService.findById.mockResolvedValue(foundUser);
      const res = response();

      await controller.processRecoverySecondaryEmail(
        request({ body: { email: 'secondary@example.test' } }),
        res
      );

      expect(notificationService.sendTemplatedEmail).not.toHaveBeenCalled();
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'recovery_attempt_failed',
        foundUser,
        'Failed secondary email recovery attempt - email not verified',
        expect.objectContaining({
          metadata: {
            method: 'secondary_email',
            error: 'Secondary email is not verified',
          },
        })
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'alice',
        error: 'Secondary email is not verified. Please contact support.',
      });
    });

    it('issues a secondary-email verification challenge with normalized input', async () => {
      const {
        authService,
        controller,
        notificationService,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      const foundUser = secondaryEmailUser();
      const now = Date.parse('2026-08-07T17:00:00.000Z');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      userService.findById.mockResolvedValue(foundUser);
      const req = request({
        body: { email: '  SECONDARY@Example.Test  ' },
      });
      const res = response();

      try {
        await controller.processRecoverySecondaryEmail(req, res);
      } finally {
        nowSpy.mockRestore();
      }

      expect(authService.isValidEmailAddress).toHaveBeenCalledWith(
        'SECONDARY@Example.Test'
      );
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'secondaryEmailVerification',
        {
          code: expect.stringMatching(/^\d{6}$/),
          expiresAt: new Date('2026-08-07T17:15:00.000Z'),
          userId: 'user-1',
        }
      );
      const verification = session.get('secondaryEmailVerification') as {
        code: string;
      };
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'SECONDARY@Example.Test',
        'Account Recovery Verification Code - Parako',
        'email/mail.njk',
        {
          title: 'Account Recovery Verification Code',
          content: expect.stringContaining(verification.code),
          username: 'Alice Doe',
        }
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/recovery/verify-code');
    });

    it('removes an undelivered secondary-email verification challenge', async () => {
      const {
        controller,
        logger,
        notificationService,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      const foundUser = secondaryEmailUser({
        given_name: undefined,
        family_name: undefined,
      });
      const failure = new Error('email transport unavailable');
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      userService.findById.mockResolvedValue(foundUser);
      notificationService.sendTemplatedEmail.mockRejectedValue(failure);
      const req = request({ body: { email: 'secondary@example.test' } });
      const res = response();

      await controller.processRecoverySecondaryEmail(req, res);

      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'secondary@example.test',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({
          content: expect.stringContaining('Hello alice,'),
          username: '',
        })
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'secondaryEmailVerification'
      );
      expect(session.has('secondaryEmailVerification')).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send recovery verification email',
        {
          username: 'alice',
          email: 'secondary@example.test',
          error: failure,
        }
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'alice',
        error: 'Failed to send verification email. Please try again.',
      });
    });

    it('renders a generic secondary-email error with the recovery username', async () => {
      const { controller, logger, session, userService } = makeHarness();
      const failure = new Error('user store unavailable');
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      userService.findById.mockRejectedValue(failure);
      const res = response();

      await controller.processRecoverySecondaryEmail(
        request({ body: { email: 'secondary@example.test' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_secondary_email_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'alice',
        error: 'An error occurred. Please try again.',
      });
    });

    it('uses an anonymous secondary-email fallback when recovery state disappears', async () => {
      const { controller, sessionManager, userService } = makeHarness();
      sessionManager.get
        .mockReturnValueOnce(recoveryAttempt({ method: 'secondary_email' }))
        .mockReturnValueOnce(undefined);
      userService.findById.mockRejectedValue(
        new Error('user store unavailable')
      );
      const res = response();

      await controller.processRecoverySecondaryEmail(
        request({ body: { email: 'secondary@example.test' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    });

    it('contains a failing secondary-email error fallback', async () => {
      const { controller, logger, sessionManager } = makeHarness();
      const failure = new Error('session store unavailable');
      sessionManager.get.mockImplementation(() => {
        throw failure;
      });
      const res = response();

      await expect(
        controller.processRecoverySecondaryEmail(
          request({ body: { email: 'secondary@example.test' } }),
          res
        )
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_secondary_email_failed',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_secondary_email_error_fallback_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-secondary-email', {
        title: 'auth.recovery_secondary_email.title - Parako',
        username: 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    });

    it('redirects verification-code pages without a pending challenge', () => {
      const { controller } = makeHarness();
      const res = response();

      controller.recoveryVerifyCode(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
      expect(res.render).not.toHaveBeenCalled();
    });

    it('renders a pending secondary-email verification challenge', () => {
      const { controller, session } = makeHarness();
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2026-08-07T18:00:00.000Z'),
        userId: 'user-1',
      });
      const res = response();

      controller.recoveryVerifyCode(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: null,
      });
    });

    it('redirects verification-code processing without a pending challenge', async () => {
      const { clientDeviceInfoManager, controller, userService } =
        makeHarness();
      const res = response();

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '123456' } }),
        res
      );

      expect(
        clientDeviceInfoManager.getClientInfoFromRequest
      ).not.toHaveBeenCalled();
      expect(userService.findById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/account-recovery');
    });

    it.each([undefined, '', '   ', [], {}, 123])(
      'rejects malformed recovery verification code %j before dependencies',
      async code => {
        const { clientDeviceInfoManager, controller, session, userService } =
          makeHarness();
        session.set('secondaryEmailVerification', {
          code: '123456',
          expiresAt: new Date('2026-08-07T18:00:00.000Z'),
          userId: 'user-1',
        });
        const res = response();

        await controller.processRecoveryVerifyCode(
          request({ body: { code } }),
          res
        );

        expect(
          clientDeviceInfoManager.getClientInfoFromRequest
        ).not.toHaveBeenCalled();
        expect(userService.findById).not.toHaveBeenCalled();
        expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
          title: 'auth.recovery_verify_code.title - Parako',
          error: 'Verification code is required',
        });
      }
    );

    it.each([
      [new Date('2000-01-01T00:00:00.000Z'), secondaryEmailUser()],
      ['2000-01-01T00:00:00.000Z', null],
      ['not-a-date', null],
    ])(
      'expires a recovery verification challenge with expiry %j',
      async (expiresAt, foundUser) => {
        const {
          clientDeviceInfoManager,
          controller,
          session,
          sessionManager,
          userService,
        } = makeHarness();
        session.set('secondaryEmailVerification', {
          code: '123456',
          expiresAt,
          userId: 'user-1',
        });
        userService.findById.mockResolvedValue(foundUser);
        const req = request({ body: { code: '123456' } });
        const res = response();

        await controller.processRecoveryVerifyCode(req, res);

        expect(
          clientDeviceInfoManager.getClientInfoFromRequest
        ).not.toHaveBeenCalled();
        expect(sessionManager.remove).toHaveBeenCalledWith(
          req,
          'secondaryEmailVerification'
        );
        if (foundUser) {
          expect(activityMocks.failed).toHaveBeenCalledWith(
            'recovery_attempt_failed',
            foundUser,
            'Recovery verification code expired',
            expect.objectContaining({
              metadata: {
                method: 'secondary_email_verification',
                error: 'Verification code expired',
              },
            })
          );
        } else {
          expect(activityMocks.failed).not.toHaveBeenCalled();
        }
        expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
          title: 'auth.recovery_verify_code.title - Parako',
          error: 'Verification code has expired. Please try again.',
        });
      }
    );

    it('expires a recovery challenge even when its audit lookup fails', async () => {
      const { controller, logger, session, sessionManager, userService } =
        makeHarness();
      const failure = new Error('user store unavailable');
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: '2000-01-01T00:00:00.000Z',
        userId: 'user-1',
      });
      userService.findById.mockRejectedValue(failure);
      const req = request({ body: { code: '123456' } });
      const res = response();

      await controller.processRecoveryVerifyCode(req, res);

      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'secondaryEmailVerification'
      );
      expect(session.has('secondaryEmailVerification')).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'recovery_verify_code_expired_user_lookup_failed',
        userId: 'user-1',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: 'Verification code has expired. Please try again.',
      });
    });

    it('blocks verification-code attempts while recovery is locked', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = secondaryEmailUser();
      const lockedUntil = new Date('2026-08-07T18:00:00.000Z');
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.checkRecoveryLockout.mockReturnValue({
        locked: true,
        lockedUntil,
        minutesRemaining: 12,
      });
      const req = request({ body: { code: '000000' } });
      const res = response();

      await controller.processRecoveryVerifyCode(req, res);

      expect(recoveryUtils.recordFailedRecoveryAttempt).not.toHaveBeenCalled();
      expect(activityMocks.failed).toHaveBeenCalledWith(
        'recovery_attempt_blocked',
        foundUser,
        'Recovery attempt blocked due to lockout',
        expect.objectContaining({
          metadata: {
            method: 'secondary_email_verification',
            lockedUntil,
            minutesRemaining: 12,
          },
        })
      );
      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: 'Too many failed attempts. Please try again in 12 minutes.',
      });
    });

    it('rejects an invalid verification code when its user no longer exists', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(null);
      const res = response();

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '000000' } }),
        res
      );

      expect(recoveryUtils.checkRecoveryLockout).not.toHaveBeenCalled();
      expect(recoveryUtils.recordFailedRecoveryAttempt).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: 'Invalid verification code',
      });
    });

    it.each([
      [1, false, undefined, 'Invalid verification code'],
      [3, false, undefined, 'Invalid verification code (2 attempts remaining)'],
      [
        5,
        true,
        new Date('2026-08-07T17:04:00.000Z'),
        'Too many failed attempts. Please try again in 4 minutes.',
      ],
    ])(
      'records an invalid verification code at attempt %i',
      async (failedAttempts, locked, lockedUntil, expectedError) => {
        const { controller, recoveryUtils, session, userService } =
          makeHarness();
        const foundUser = secondaryEmailUser();
        const now = Date.parse('2026-08-07T17:00:00.000Z');
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
        session.set('secondaryEmailVerification', {
          code: '123456',
          expiresAt: new Date('2999-01-01T00:00:00.000Z'),
          userId: 'user-1',
        });
        userService.findById.mockResolvedValue(foundUser);
        recoveryUtils.recordFailedRecoveryAttempt.mockReturnValue({
          failedAttempts,
          locked,
          lockedUntil,
        });
        const req = request({ body: { code: ' 000000 ' } });
        const res = response();

        try {
          await controller.processRecoveryVerifyCode(req, res);
        } finally {
          nowSpy.mockRestore();
        }

        expect(userService.updateById).toHaveBeenCalledWith('user-1', {
          recovery: {
            ...foundUser.recovery,
            enabled: true,
            methods: ['secondary_email'],
            lockout: foundUser.recovery!.lockout,
          },
        });
        expect(activityMocks.failed).toHaveBeenCalledWith(
          'recovery_attempt_failed',
          foundUser,
          'Invalid recovery verification code',
          expect.objectContaining({
            metadata: {
              method: 'secondary_email_verification',
              error: 'Invalid verification code',
              failedAttempts,
              locked,
            },
          })
        );
        if (locked) {
          expect(activityMocks.warning).toHaveBeenCalledWith(
            'recovery_lockout_triggered',
            foundUser,
            'User locked out due to too many failed recovery attempts',
            expect.objectContaining({
              metadata: {
                method: 'secondary_email_verification',
                failedAttempts,
                lockedUntil,
              },
            })
          );
        } else {
          expect(activityMocks.warning).not.toHaveBeenCalled();
        }
        expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
          title: 'auth.recovery_verify_code.title - Parako',
          error: expectedError,
        });
      }
    );

    it('records an invalid code for a legacy user without recovery metadata', async () => {
      const { controller, recoveryUtils, session, userService } = makeHarness();
      const foundUser = user({ _id: 'user-1', recovery: undefined });
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.recordFailedRecoveryAttempt.mockReturnValue({
        failedAttempts: 1,
        locked: false,
      });

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '000000' } }),
        response()
      );

      expect(userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: {
          enabled: false,
          methods: [],
          lockout: undefined,
        },
      });
    });

    it('rejects a valid verification code when its user no longer exists', async () => {
      const { clientDeviceInfoManager, controller, session, userService } =
        makeHarness();
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(null);
      const res = response();

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '123456' } }),
        res
      );

      expect(userService.findById).toHaveBeenCalledTimes(2);
      expect(
        clientDeviceInfoManager.getClientInfoFromRequest
      ).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: 'User not found',
      });
    });

    it('completes secondary-email recovery and clears all one-time state', async () => {
      const {
        controller,
        flash,
        notificationService,
        recoveryUtils,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      const foundUser = secondaryEmailUser({
        recovery: {
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: {
            email: 'secondary@example.test',
            verified: true,
          },
          lockout: { failed_attempts: 2 },
        },
      });
      session.set(
        'recoveryAttempt',
        recoveryAttempt({ method: 'secondary_email' })
      );
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(foundUser);
      recoveryUtils.clearRecoveryLockout.mockImplementation(target => {
        target.recovery.lockout = { failed_attempts: 0 };
      });
      recoveryUtils.setLastRecoveredAt.mockImplementation(target => {
        target.recovery.last_recovered_at = new Date(
          '2026-08-07T17:00:00.000Z'
        );
      });
      const req = request({ body: { code: ' 123456 ' } });
      const res = response();

      await controller.processRecoveryVerifyCode(req, res);

      expect(userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: {
          ...foundUser.recovery,
          lockout: { failed_attempts: 0 },
          last_recovered_at: new Date('2026-08-07T17:00:00.000Z'),
        },
      });
      expect(activityMocks.success).toHaveBeenCalledWith(
        'account_recovery_successful',
        foundUser,
        'User successfully recovered account using secondary email',
        expect.objectContaining({ actor: foundUser })
      );
      expect(notificationService.sendSecurityAlert).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'alice' },
        'account_recovered',
        {
          method: 'secondary_email',
          timestamp: expect.any(String),
          ip: '127.0.0.1',
          user_agent: 'vitest',
        }
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'secondaryEmailVerification'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'recoveryAttempt'
      );
      expect(session.has('secondaryEmailVerification')).toBe(false);
      expect(session.has('recoveryAttempt')).toBe(false);
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: 'user-1',
          username: 'alice',
          full_name: 'Alice Doe',
          is_admin: false,
          zoneinfo: 'UTC',
          locale: 'en',
        }),
      });
      expect(flash.success).toHaveBeenCalledWith(
        'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('authenticates a recovered user without recovery metadata', async () => {
      const {
        controller,
        recoveryUtils,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      const foundUser = user({
        _id: 'user-1',
        name: undefined,
        recovery: undefined,
        is_admin: true,
        zoneinfo: 'Africa/Porto-Novo',
        locale: 'fr',
      });
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(foundUser);
      const req = request({ body: { code: '123456' } });
      const res = response();

      await controller.processRecoveryVerifyCode(req, res);

      expect(recoveryUtils.clearRecoveryLockout).toHaveBeenCalledWith(
        foundUser
      );
      expect(recoveryUtils.setLastRecoveredAt).toHaveBeenCalledWith(foundUser);
      expect(userService.updateById).not.toHaveBeenCalled();
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: 'user-1',
          full_name: undefined,
          is_admin: true,
          zoneinfo: 'Africa/Porto-Novo',
          locale: 'fr',
        }),
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('contains the secondary-email recovery alert failure', async () => {
      const { controller, logger, notificationService, session, userService } =
        makeHarness();
      const foundUser = secondaryEmailUser();
      const failure = new Error('security email unavailable');
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockResolvedValue(foundUser);
      notificationService.sendSecurityAlert.mockRejectedValue(failure);

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '123456' } }),
        response()
      );

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to send recovery notification email',
          { userId: 'user-1', error: failure }
        );
      });
    });

    it('contains verification-code dependency failures', async () => {
      const { controller, logger, session, userService } = makeHarness();
      const failure = new Error('user store unavailable');
      session.set('secondaryEmailVerification', {
        code: '123456',
        expiresAt: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user-1',
      });
      userService.findById.mockRejectedValue(failure);
      const res = response();

      await controller.processRecoveryVerifyCode(
        request({ body: { code: '123456' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'process_recovery_verify_code_failed',
      });
      expect(res.render).toHaveBeenCalledWith('auth/recovery-verify-code', {
        title: 'auth.recovery_verify_code.title - Parako',
        error: 'An error occurred. Please try again.',
      });
    });
  });

  describe('email verification success', () => {
    it('renders safe defaults without optional query values', () => {
      const { controller } = makeHarness();
      const res = response();

      controller.emailVerificationSuccess(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/email-verification-success',
        {
          title: 'Email Verified - Parako',
          email: '',
          accountName: '',
          accountInitials: '',
          showExtraInfo: false,
          showSecondaryAction: false,
          nextUrl: '/auth/login',
        }
      );
    });

    it('derives display state from explicit success query values', () => {
      const { controller } = makeHarness();
      const res = response();

      controller.emailVerificationSuccess(
        request({
          query: {
            email: 'alice@example.test',
            name: 'alice doe smith',
            info: 'true',
            secondary: 'true',
            next: '/accounts/dashboard',
          },
        }),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'auth/email-verification-success',
        {
          title: 'Email Verified - Parako',
          email: 'alice@example.test',
          accountName: 'alice doe smith',
          accountInitials: 'AD',
          showExtraInfo: true,
          showSecondaryAction: true,
          nextUrl: '/accounts/dashboard',
        }
      );
    });
  });

  describe('logout', () => {
    it.each([
      [
        'https://rp.example.test/signed-out',
        'https://rp.example.test/signed-out',
      ],
      [['invalid'], undefined],
    ])(
      'delegates a no-session redirect target %j to redirect authority',
      async (redirectUri, expectedTarget) => {
        const { controller, redirectAuthority, redirectChain } = makeHarness();

        await controller.logout(
          request({ query: { redirect_uri: redirectUri } }),
          response()
        );

        expect(redirectAuthority.redirect).toHaveBeenCalledOnce();
        expect(redirectChain.to).toHaveBeenCalledWith(expectedTarget);
        expect(redirectChain.or).toHaveBeenCalledWith('/auth/login');
      }
    );

    it('renders a single-account logout confirmation', async () => {
      const { controller, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.test',
        full_name: 'Alice Doe',
        given_name: 'Alice',
        family_name: 'Doe',
        picture: '/alice.png',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      const res = response();

      await controller.logout(request(), res);

      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Sign Out - Parako',
        confirmed: false,
        sessionInfo: {
          name: 'Alice Doe',
          email: 'alice@example.test',
          initials: 'AD',
        },
        accounts: null,
        hasMultipleAccounts: false,
        redirectUri: '/auth/login',
        cancelUrl: '/accounts/dashboard',
      });
    });

    it('renders normalized account choices for a multi-account session', async () => {
      const { controller, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        email: '',
        full_name: '',
        given_name: '',
        family_name: '',
        picture: '',
      };
      const other = {
        id: 'user-2',
        username: '',
        email: undefined,
        full_name: 'Bob Example',
        given_name: '',
        family_name: '',
        picture: undefined,
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [other],
      });
      const res = response();

      await controller.logout(
        request({ query: { cancel_url: '/custom-cancel' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Sign Out - Parako',
        confirmed: false,
        sessionInfo: { name: 'alice', email: '', initials: 'AL' },
        accounts: [
          {
            id: 'user-1',
            name: 'alice',
            email: '',
            avatar: '',
            initials: 'AL',
            is_active: true,
          },
          {
            id: 'user-2',
            name: 'Bob Example',
            email: '',
            avatar: '',
            initials: 'U',
            is_active: false,
          },
        ],
        hasMultipleAccounts: true,
        redirectUri: '/auth/login',
        cancelUrl: '/custom-cancel',
      });
    });

    it('derives initials from account profile names in multi-account choices', async () => {
      const { controller, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        given_name: 'Alice',
        family_name: 'Doe',
      };
      const other = {
        id: 'user-2',
        username: 'bob',
        given_name: 'Bob',
        family_name: 'Smith',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [other],
      });
      const res = response();

      await controller.logout(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({
          accounts: [
            expect.objectContaining({ id: 'user-1', initials: 'AD' }),
            expect.objectContaining({ id: 'user-2', initials: 'BS' }),
          ],
        })
      );
    });

    it('logs out every authenticated account and reports the single-account count', async () => {
      const { controller, oidcAdapter, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.test',
        full_name: 'Alice Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      const req = request({
        method: 'POST',
        body: { type: 'all', redirect_uri: '/signed-out' },
      });
      const res = response();

      await controller.logout(req, res);

      expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
      expect(sessionManager.destroy).toHaveBeenCalledWith(req);
      expect(oidcAdapter.session.findByAccountId).toHaveBeenCalledWith('alice');
      expect(oidcAdapter.grant.deleteGrantsByAccountId).toHaveBeenCalledWith(
        'alice'
      );
      expect(res.set).toHaveBeenCalledWith({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'all',
        accountCount: 1,
        redirectUri: '/signed-out',
      });
    });

    it('continues clearing other OIDC accounts when one account cleanup fails', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      const other = { id: 'user-2', username: 'bob' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [other],
      });
      oidcAdapter.session.findByAccountId
        .mockRejectedValueOnce(new Error('session store unavailable'))
        .mockResolvedValueOnce([{ _id: 'session-bob' }]);
      const res = response();

      await controller.logout(
        request({ method: 'POST', body: { type: 'all' } }),
        res
      );

      expect(oidcAdapter.session.findByAccountId).toHaveBeenNthCalledWith(
        1,
        'alice'
      );
      expect(oidcAdapter.session.findByAccountId).toHaveBeenNthCalledWith(
        2,
        'bob'
      );
      expect(oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith([
        'session-bob',
      ]);
      expect(oidcAdapter.grant.deleteGrantsByAccountId).toHaveBeenCalledWith(
        'bob'
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: alice',
        { error: expect.any(Error) }
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ accountCount: 2 })
      );
    });

    it('logs out all accounts when the session has no active-account slot', async () => {
      const { controller, oidcAdapter, sessionManager } = makeHarness();
      const first = { id: 'user-1', username: 'alice' };
      const second = { id: 'user-2', username: 'bob' };
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: null,
        others: [first, second],
      });
      const res = response();

      await controller.logout(
        request({ method: 'POST', body: { type: 'all' } }),
        res
      );

      expect(oidcAdapter.session.findByAccountId).toHaveBeenCalledTimes(2);
      expect(oidcAdapter.session.findByAccountId).toHaveBeenNthCalledWith(
        1,
        'alice'
      );
      expect(oidcAdapter.session.findByAccountId).toHaveBeenNthCalledWith(
        2,
        'bob'
      );
      expect(activityMocks.info).toHaveBeenCalledTimes(2);
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ accountCount: 2 })
      );
    });

    it('completes all-account logout when session metadata has an empty username', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: '' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      const res = response();

      await controller.logout(
        request({ method: 'POST', body: { type: 'all' } }),
        res
      );

      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: ',
        { error: expect.objectContaining({ message: 'accountId is required' }) }
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ confirmed: true, accountCount: 1 })
      );
    });

    it('uses the selected sole account username for OIDC cleanup', async () => {
      const { controller, oidcAdapter, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        full_name: 'Alice Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      const req = request({
        method: 'POST',
        body: { type: 'single', account_id: 'user-1' },
      });
      const res = response();

      await controller.logout(req, res);

      expect(oidcAdapter.session.findByAccountId).toHaveBeenCalledWith('alice');
      expect(activityMocks.info).toHaveBeenCalledWith(
        'logout_single',
        null,
        'User logged out from only account',
        {
          actor: { username: 'alice', actor_type: 'user' },
          target: { target_type: 'session' },
        }
      );
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'single',
        accountName: 'Alice Doe',
        redirectUri: '/auth/login',
      });
    });

    it('logs out a sole account stored outside the active-account slot', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const other = {
        id: 'user-2',
        username: 'bob',
        full_name: 'Bob Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(other);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: null,
        others: [other],
      });
      oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('OIDC store unavailable')
      );
      const res = response();

      await controller.logout(
        request({
          method: 'POST',
          body: { type: 'single', account_id: 'user-2' },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: bob',
        { error: expect.any(Error) }
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ accountName: 'Bob Doe' })
      );
    });

    it('does not destroy the active session for a stale selected account', async () => {
      const { controller, flash, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      const stale = {
        id: 'user-2',
        username: 'bob',
        full_name: 'Bob Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [stale] })
        .mockReturnValueOnce({ active, others: [] });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(false);
      const req = request({
        method: 'POST',
        body: { type: 'single', account_id: 'user-2' },
      });

      await controller.logout(req, response());

      expect(sessionManager.clearAuthenticationData).not.toHaveBeenCalled();
      expect(sessionManager.destroy).not.toHaveBeenCalled();
      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(sessionManager.removeAuthenticatedUser).toHaveBeenCalledWith(
        req,
        'user-2'
      );
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to sign out from the selected account.'
      );
    });

    it('rejects an unknown selected account without clearing the session', async () => {
      const { controller, flash, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      const other = { id: 'user-2', username: 'bob' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [other],
      });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(false);
      const req = request({
        method: 'POST',
        body: { type: 'single', account_id: 'unknown-user' },
      });

      await controller.logout(req, response());

      expect(sessionManager.removeAuthenticatedUser).toHaveBeenCalledWith(
        req,
        'unknown-user'
      );
      expect(sessionManager.clearAuthenticationData).not.toHaveBeenCalled();
      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to sign out from the selected account.'
      );
    });

    it('removes a selected account and cleans OIDC state by username', async () => {
      const { controller, flash, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      const other = {
        id: 'user-2',
        username: 'bob',
        full_name: 'Bob Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active: null, others: [active] });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(true);
      const req = request({
        method: 'POST',
        body: { type: 'single', account_id: 'user-2' },
      });
      const res = response();

      await controller.logout(req, res);

      expect(sessionManager.removeAuthenticatedUser).toHaveBeenCalledWith(
        req,
        'user-2'
      );
      expect(oidcAdapter.session.findByAccountId).toHaveBeenCalledWith('bob');
      expect(flash.success).toHaveBeenCalledWith(
        'Signed out from Bob Doe successfully.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('finishes selected-account logout when no authenticated accounts remain', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      const other = {
        id: 'user-2',
        username: 'bob',
        full_name: 'Bob Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce(undefined);
      sessionManager.removeAuthenticatedUser.mockResolvedValue(true);
      oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('OIDC store unavailable')
      );
      const res = response();

      await controller.logout(
        request({
          method: 'POST',
          body: { type: 'single', account_id: 'user-2' },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: bob',
        { error: expect.any(Error) }
      );
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'single',
        accountName: 'Bob Doe',
        redirectUri: '/auth/login',
      });
    });

    it.each([
      ['/custom-cancel', '/custom-cancel'],
      [['invalid'], undefined],
    ])(
      'validates cancel target %j after selected-account removal fails',
      async (cancelUrl, expectedTarget) => {
        const { controller, flash, redirectChain, sessionManager } =
          makeHarness();
        const active = { id: 'user-1', username: 'alice' };
        const other = { id: 'user-2', username: 'bob' };
        sessionManager.getActiveUser.mockReturnValue(active);
        sessionManager.getAuthenticatedUsers.mockReturnValue({
          active,
          others: [other],
        });
        sessionManager.removeAuthenticatedUser.mockResolvedValue(false);

        await controller.logout(
          request({
            method: 'POST',
            query: { cancel_url: cancelUrl },
            body: { type: 'single', account_id: 'user-2' },
          }),
          response()
        );

        expect(flash.error).toHaveBeenCalledWith(
          'Failed to sign out from the selected account.'
        );
        expect(redirectChain.to).toHaveBeenCalledWith(expectedTarget);
        expect(redirectChain.or).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('logs out the active sole account across OIDC adapter result shapes', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        full_name: 'Alice Doe',
      };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      oidcAdapter.session.findByAccountId.mockResolvedValue([
        { _id: 'session-1' },
        { jti: 'session-2' },
      ]);
      oidcAdapter.session.deleteSessionsByIds.mockResolvedValue(undefined);
      oidcAdapter.grant.deleteGrantsByAccountId.mockResolvedValue({
        deletedCount: 2,
      });
      oidcAdapter.accessToken.deleteByAccountId.mockResolvedValue(undefined);
      oidcAdapter.refreshToken.deleteByAccountId.mockResolvedValue({
        deletedCount: 3,
      });
      oidcAdapter.interaction.deleteByAccountId.mockResolvedValue({
        deletedCount: 4,
      });
      const req = request({ method: 'POST' });
      const res = response();

      await controller.logout(req, res);

      expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
      expect(sessionManager.destroy).toHaveBeenCalledWith(req);
      expect(oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith([
        'session-1',
        'session-2',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        'Successfully completed OIDC logout for user: alice',
        {
          sessions: 0,
          grants: 2,
          accessTokens: 0,
          refreshTokens: 3,
          interactions: 4,
        }
      );
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'single',
        accountName: 'Alice Doe',
        redirectUri: '/auth/login',
      });
    });

    it('finishes sole-account logout when OIDC cleanup fails', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('OIDC store unavailable')
      );
      const res = response();

      await controller.logout(request({ method: 'POST' }), res);

      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: alice',
        { error: expect.any(Error) }
      );
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ confirmed: true, accountName: 'alice' })
      );
    });

    it('does not invoke OIDC cleanup without an active username', async () => {
      const { controller, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      const res = response();

      await controller.logout(request({ method: 'POST' }), res);

      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ accountName: undefined })
      );
    });

    it('removes the active account and redirects when another account remains', async () => {
      const { controller, flash, oidcAdapter, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        full_name: 'Alice Doe',
      };
      const other = { id: 'user-2', username: 'bob' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active: other, others: [] });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(true);
      const req = request({ method: 'POST' });
      const res = response();

      await controller.logout(req, res);

      expect(sessionManager.removeAuthenticatedUser).toHaveBeenCalledWith(
        req,
        'user-1'
      );
      expect(oidcAdapter.session.findByAccountId).toHaveBeenCalledWith('alice');
      expect(flash.success).toHaveBeenCalledWith(
        'Signed out from your account successfully.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('renders completion after the active account is the last one removed', async () => {
      const { controller, logger, oidcAdapter, sessionManager } = makeHarness();
      const active = {
        id: 'user-1',
        username: 'alice',
        full_name: 'Alice Doe',
      };
      const other = { id: 'user-2', username: 'bob' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active: null, others: [] });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(true);
      oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('OIDC store unavailable')
      );
      const res = response();

      await controller.logout(request({ method: 'POST' }), res);

      expect(logger.error).toHaveBeenCalledWith(
        'Error clearing OIDC data for account: alice',
        { error: expect.any(Error) }
      );
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'single',
        accountName: 'Alice Doe',
        redirectUri: '/auth/login',
      });
    });

    it.each([
      ['/custom-cancel', '/custom-cancel'],
      [['invalid'], undefined],
    ])(
      'validates cancel target %j when active-account removal fails',
      async (cancelUrl, expectedTarget) => {
        const { controller, flash, redirectChain, sessionManager } =
          makeHarness();
        const active = { id: 'user-1', username: 'alice' };
        const other = { id: 'user-2', username: 'bob' };
        sessionManager.getActiveUser.mockReturnValue(active);
        sessionManager.getAuthenticatedUsers.mockReturnValue({
          active,
          others: [other],
        });
        sessionManager.removeAuthenticatedUser.mockResolvedValue(false);

        await controller.logout(
          request({ method: 'POST', query: { cancel_url: cancelUrl } }),
          response()
        );

        expect(flash.error).toHaveBeenCalledWith('Failed to sign out.');
        expect(redirectChain.to).toHaveBeenCalledWith(expectedTarget);
        expect(redirectChain.or).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('completes a confirmed all-account logout without session account metadata', async () => {
      const { controller, oidcAdapter, sessionManager } = makeHarness();
      const req = request({ method: 'POST', body: { type: 'all' } });
      const res = response();

      await controller.logout(req, res);

      expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
      expect(sessionManager.destroy).toHaveBeenCalledWith(req);
      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'auth/logout',
        expect.objectContaining({ logoutType: 'all', accountCount: 0 })
      );
    });

    it('removes an active account without invoking OIDC when username is absent', async () => {
      const { controller, flash, oidcAdapter, sessionManager } = makeHarness();
      const active = { id: 'user-1' };
      const other = { id: 'user-2', username: 'bob' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers
        .mockReturnValueOnce({ active, others: [other] })
        .mockReturnValueOnce({ active: other, others: [] });
      sessionManager.removeAuthenticatedUser.mockResolvedValue(true);

      await controller.logout(request({ method: 'POST' }), response());

      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(flash.success).toHaveBeenCalledWith(
        'Signed out from your account successfully.'
      );
    });

    it('renders a stable completion page when local session destruction fails', async () => {
      const { controller, logger, sessionManager } = makeHarness();
      const active = { id: 'user-1', username: 'alice' };
      sessionManager.getActiveUser.mockReturnValue(active);
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active,
        others: [],
      });
      sessionManager.destroy.mockRejectedValue(
        new Error('session unavailable')
      );
      const res = response();

      await controller.logout(request({ method: 'POST' }), res);

      expect(logger.error).toHaveBeenCalledWith('Error during logout', {
        error: expect.any(Error),
        logoutType: 'single',
        accountId: undefined,
      });
      expect(res.render).toHaveBeenCalledWith('auth/logout', {
        title: 'Signed Out - Parako',
        confirmed: true,
        logoutType: 'single',
        redirectUri: '/auth/login',
      });
    });
  });

  describe('social login', () => {
    it('does not store a non-string continue target', async () => {
      const { controller, redirectAuthority, socialLoginManager } =
        makeHarness();
      const req = request({
        params: { provider: 'github' },
        query: { continue: ['https://rp.example.test/callback'] },
      });
      const res = response();

      await controller.socialLogin(req, res);

      expect(redirectAuthority.storeIntent).not.toHaveBeenCalled();
      expect(socialLoginManager.getAuthorizationUrl).toHaveBeenCalledWith(
        'github',
        req
      );
      expect(res.redirect).toHaveBeenCalledWith('https://github.test/auth');
    });

    it('rejects an unavailable provider before building an authorization URL', async () => {
      const { controller, flash, socialLoginManager } = makeHarness();
      socialLoginManager.isProviderAvailable.mockReturnValue(false);
      const res = response();

      await controller.socialLogin(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('github login is not available');
      expect(socialLoginManager.getAuthorizationUrl).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      [
        { continue: 'https://rp.example.test/continue' },
        'https://rp.example.test/continue',
      ],
      [
        { redirectTo: 'https://rp.example.test/redirect' },
        'https://rp.example.test/redirect',
      ],
      [
        {
          continue: ['invalid'],
          redirectTo: 'https://rp.example.test/fallback',
        },
        'https://rp.example.test/fallback',
      ],
    ])(
      'stores a valid social-login intent from query %j',
      async (query, target) => {
        const { controller, redirectAuthority } = makeHarness();
        const req = request({ params: { provider: 'github' }, query });

        await controller.socialLogin(req, response());

        expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
          req,
          target,
          'social_login'
        );
      }
    );

    it('handles authorization URL generation failures', async () => {
      const { controller, flash, logger, socialLoginManager } = makeHarness();
      socialLoginManager.getAuthorizationUrl.mockRejectedValue(
        new Error('provider unavailable')
      );
      const res = response();

      await controller.socialLogin(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_login_initiation_failed',
        provider: 'github',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to initiate social login'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });

  describe('social registration', () => {
    it('does not store a non-string continue target', async () => {
      const { controller, redirectAuthority } = makeHarness();
      const req = request({
        params: { provider: 'github' },
        query: { continue: ['https://rp.example.test/callback'] },
      });

      await controller.socialRegister(req, response());

      expect(redirectAuthority.storeIntent).not.toHaveBeenCalled();
    });

    it('rejects an unknown provider before storing redirect intent', async () => {
      const {
        controller,
        redirectAuthority,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      socialLoginManager.isProviderAvailable.mockReturnValue(true);
      const res = response();

      await controller.socialRegister(
        request({
          params: { provider: 'unknown' },
          query: { continue: 'https://rp.example.test/callback' },
        }),
        res
      );

      expect(redirectAuthority.storeIntent).not.toHaveBeenCalled();
      expect(sessionManager.set).not.toHaveBeenCalledWith(
        expect.anything(),
        'socialRegister',
        expect.anything()
      );
      expect(socialLoginManager.getAuthorizationUrl).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('rejects an unavailable provider before mutating registration state', async () => {
      const { controller, flash, sessionManager, socialLoginManager } =
        makeHarness();
      socialLoginManager.isProviderAvailable.mockReturnValue(false);
      const res = response();

      await controller.socialRegister(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'github registration is not available'
      );
      expect(sessionManager.set).not.toHaveBeenCalledWith(
        expect.anything(),
        'socialRegister',
        expect.anything()
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it.each([
      'google',
      'github',
      'facebook',
      'linkedin',
      'twitter',
      'microsoft',
      'apple',
    ])('stores a registration intent for known provider %s', async provider => {
      const {
        controller,
        redirectAuthority,
        session,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      const existingIntent = {
        google: { intent: 'register', timestamp: 1 },
      };
      session.set('socialRegister', existingIntent);
      const req = request({
        params: { provider },
        query: { redirectTo: 'https://rp.example.test/callback' },
      });
      const res = response();

      await controller.socialRegister(req, res);

      expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
        req,
        'https://rp.example.test/callback',
        'social_register'
      );
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'socialRegister',
        expect.objectContaining({
          [provider]: {
            intent: 'register',
            timestamp: expect.any(Number),
          },
        })
      );
      expect(socialLoginManager.getAuthorizationUrl).toHaveBeenCalledWith(
        provider,
        req
      );
      expect(res.redirect).toHaveBeenCalledWith('https://github.test/auth');
    });

    it('prefers a valid continue target for social registration', async () => {
      const { controller, redirectAuthority } = makeHarness();
      const req = request({
        params: { provider: 'github' },
        query: {
          continue: 'https://rp.example.test/continue',
          redirectTo: 'https://rp.example.test/fallback',
        },
      });

      await controller.socialRegister(req, response());

      expect(redirectAuthority.storeIntent).toHaveBeenCalledWith(
        req,
        'https://rp.example.test/continue',
        'social_register'
      );
    });

    it('handles social registration authorization failures', async () => {
      const { controller, flash, logger, socialLoginManager } = makeHarness();
      socialLoginManager.getAuthorizationUrl.mockRejectedValue(
        new Error('provider unavailable')
      );
      const res = response();

      await controller.socialRegister(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_register_initiation_failed',
        provider: 'github',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to initiate social registration'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });
  });

  describe('social callback', () => {
    it.each([
      [{ code: 'code-1', state: 'state-1' }, '?code=code-1&state=state-1'],
      [{}, ''],
    ])(
      'delegates a fresh OIDC social context with query %j',
      async (query, querySuffix) => {
        const { controller, session, socialLoginManager } = makeHarness();
        const now = Date.now();
        session.set('oidcSocialContext', {
          uid: 'interaction-1',
          client_id: 'client-1',
          timestamp: now - 5 * 60 * 1000,
        });
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' }, query }),
          res
        );

        expect(socialLoginManager.handleCallback).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          `/oidc/v1/social/github/callback${querySuffix}`
        );
      }
    );

    it('removes an expired OIDC context before regular provider handling', async () => {
      const { controller, flash, session, sessionManager, socialLoginManager } =
        makeHarness();
      session.set('oidcSocialContext', {
        uid: 'interaction-1',
        client_id: 'client-1',
        timestamp: Date.now() - 10 * 60 * 1000 - 1,
      });
      socialLoginManager.isProviderAvailable.mockReturnValue(false);
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'oidcSocialContext'
      );
      expect(flash.error).toHaveBeenCalledWith('github is not available');
      expect(socialLoginManager.handleCallback).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('rejects an unavailable provider without OIDC context', async () => {
      const { controller, flash, socialLoginManager } = makeHarness();
      socialLoginManager.isProviderAvailable.mockReturnValue(false);
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('github is not available');
      expect(socialLoginManager.handleCallback).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      ['provider message', 'Provider denied access', 'Provider denied access'],
      ['fallback message', undefined, 'Social authentication failed'],
    ])(
      'renders a failed social authentication with %s',
      async (_label, error, expectedError) => {
        const { controller, socialLoginManager } = makeHarness();
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: false,
          error,
        });
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
          title: 'Social Authentication Error - Parako',
          provider: 'github',
          error: expectedError,
          redirectUrl: '/auth/login',
        });
      }
    );

    it.each([
      [true, 'Link this account', 'Link this account'],
      [true, undefined, 'Please log in first to link your social account'],
      [
        false,
        'Sensitive provider detail',
        'Authentication failed. Please try again.',
      ],
    ])(
      'renders linking-required feedback when helpful errors are %s',
      async (showHelpfulErrors, error, expectedError) => {
        const { config, controller, socialLoginManager } = makeHarness();
        config.features.social_providers.behavior.options.show_helpful_errors =
          showHelpfulErrors;
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
          error,
        });
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
          title: 'Login Required - Parako',
          provider: 'github',
          error: expectedError,
          redirectUrl: '/auth/login',
        });
      }
    );

    it.each([
      ['explicit registration intent', 'register'],
      ['registration-allowed policy', 'allow_registration'],
    ])(
      'routes linking-required callbacks into social registration for %s',
      async (_label, mode) => {
        const { config, controller, session, socialLoginManager } =
          makeHarness();
        if (mode === 'register') {
          session.set('socialRegister', {
            github: { intent: 'register', timestamp: Date.now() },
          });
        } else {
          config.features.social_providers.behavior.no_user_account =
            'allow_registration';
        }
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
        });
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
          title: 'Social Registration Error - Parako',
          provider: 'github',
          error: 'Failed to retrieve user information from social provider',
          redirectUrl: '/auth/register',
        });
      }
    );

    it('renders an integrity error when a successful callback has no user', async () => {
      const { controller, socialLoginManager } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({ success: true });
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
        title: 'User Not Found - Parako',
        provider: 'github',
        error: 'User not found after social authentication',
        redirectUrl: '/auth/login',
      });
    });

    it('ignores malformed query redirects when creating pending social MFA state', async () => {
      const {
        controller,
        mfaUtils,
        redirectAuthority,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      const socialUser = user();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: socialUser,
      });
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.needsMethodSelection.mockReturnValue(true);
      redirectAuthority.getIntent.mockImplementation((_req, key: string) =>
        key === 'social_login' ? '/stored-social-intent' : undefined
      );
      const req = request({
        params: { provider: 'github' },
        query: { continue: ['invalid'] },
      });
      const res = response();

      await controller.socialCallback(req, res);

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'pendingSocialMfaUser',
        expect.objectContaining({
          username: 'alice',
          provider: 'github',
          continue_url: '/stored-social-intent',
        })
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/select');
    });

    it('stores a boolean non-admin state for social MFA users without roles', async () => {
      const { controller, mfaUtils, sessionManager, socialLoginManager } =
        makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user({ roles: undefined }),
      });
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.needsMethodSelection.mockReturnValue(true);
      const req = request({ params: { provider: 'github' } });

      await controller.socialCallback(req, response());

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'pendingSocialMfaUser',
        expect.objectContaining({ roles: ['user'], is_admin: false })
      );
    });

    it('sends email MFA and redirects to verification', async () => {
      const {
        controller,
        mfaUtils,
        notificationService,
        socialLoginManager,
        userService,
      } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.getPreferredMethod.mockReturnValue('email');
      const res = response();

      await controller.socialCallback(
        request({
          params: { provider: 'github' },
          query: { continue: '/after-mfa' },
        }),
        res
      );

      expect(userService.setEmailOtp).toHaveBeenCalledWith(
        'alice',
        '123456',
        600
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        'alice@example.test',
        'Your Parako login code',
        'email/mail.njk',
        expect.objectContaining({
          title: 'Your Parako login code',
          username: 'Alice Doe',
        })
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/mfa/verify');
    });

    it('normalizes absent social-user fields during email MFA', async () => {
      const {
        controller,
        mfaUtils,
        notificationService,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user({
          _id: undefined,
          email: undefined,
          email_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
        }),
      });
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.getPreferredMethod.mockReturnValue('email');
      const req = request({ params: { provider: 'github' } });

      await controller.socialCallback(req, response());

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'pendingSocialMfaUser',
        expect.objectContaining({
          id: '',
          email_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
        })
      );
      expect(notificationService.sendTemplatedEmail).toHaveBeenCalledWith(
        '',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({ username: '' })
      );
    });

    it('returns to login when social email MFA delivery fails', async () => {
      const {
        controller,
        flash,
        mfaUtils,
        notificationService,
        socialLoginManager,
      } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      mfaUtils.isMfaEnabled.mockReturnValue(true);
      mfaUtils.getPreferredMethod.mockReturnValue('email');
      notificationService.sendTemplatedEmail.mockRejectedValue(
        new Error('mail unavailable')
      );
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Failed to send verification code. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each([
      [
        'webauthn',
        ['admin'],
        { redirectTo: '/after-webauthn' },
        '/auth/mfa/webauthn',
      ],
      ['totp', ['superadmin'], {}, '/auth/mfa/verify'],
    ])(
      'routes %s social MFA and preserves boolean admin state',
      async (method, roles, query, expectedRedirect) => {
        const { controller, mfaUtils, sessionManager, socialLoginManager } =
          makeHarness();
        socialLoginManager.handleCallback.mockResolvedValue({
          success: true,
          user: user({ roles }),
        });
        mfaUtils.isMfaEnabled.mockReturnValue(true);
        mfaUtils.getPreferredMethod.mockReturnValue(method);
        const req = request({ params: { provider: 'github' }, query });
        const res = response();

        await controller.socialCallback(req, res);

        expect(sessionManager.set).toHaveBeenCalledWith(
          req,
          'pendingSocialMfaUser',
          expect.objectContaining({ is_admin: true, mfa_method: method })
        );
        expect(res.redirect).toHaveBeenCalledWith(expectedRedirect);
      }
    );

    it('stores a boolean non-admin state after normal social login', async () => {
      const { controller, sessionManager, socialLoginManager } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user({ roles: undefined }),
      });
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          roles: ['user'],
          is_admin: false,
        }),
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('normalizes absent social-user fields after normal login', async () => {
      const { controller, sessionManager, socialLoginManager } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user({
          _id: undefined,
          email_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
        }),
      });
      const req = request({ params: { provider: 'github' } });

      await controller.socialCallback(req, response());

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: '',
          email_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
        }),
      });
    });

    it('ignores malformed query redirects after normal social login', async () => {
      const {
        controller,
        redirectAuthority,
        redirectChain,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      redirectAuthority.getIntent.mockImplementation(
        (_req, key: string, consume: boolean) =>
          key === 'social_login' && !consume ? '/stored-intent' : undefined
      );
      const req = request({
        params: { provider: 'github' },
        query: { continue: ['invalid'] },
      });

      await controller.socialCallback(req, response());

      expect(sessionManager.addAuthenticatedUser).not.toHaveBeenCalled();
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        req,
        expect.anything()
      );
      expect(redirectChain.to).toHaveBeenCalledWith('/stored-intent');
    });

    it('adds a social account for an explicit add-account intent', async () => {
      const { controller, session, sessionManager, socialLoginManager } =
        makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      session.set('addAccountIntent', {
        addingAccount: true,
        returnUrl: '/accounts/custom-return',
      });
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ username: 'alice' }),
        true
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'social_account_added',
        expect.anything(),
        'Social account (github) added to session',
        expect.anything()
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'addAccountIntent'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/custom-return');
    });

    it.each([
      ['max_limit_reached', 'Maximum number of accounts per session reached.'],
      ['already_exists', 'This account is already signed in.'],
    ])(
      'reports add-account failure %s and uses the dashboard fallback',
      async (reason, message) => {
        const {
          controller,
          flash,
          session,
          sessionManager,
          socialLoginManager,
        } = makeHarness();
        socialLoginManager.handleCallback.mockResolvedValue({
          success: true,
          user: user(),
        });
        session.set('addAccountIntent', { addingAccount: true });
        sessionManager.addAuthenticatedUser.mockReturnValue({
          success: false,
          reason,
        });
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(flash.info).toHaveBeenCalledWith(message);
        expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
      }
    );

    it('adds a social account for a direct continuation target', async () => {
      const { controller, redirectChain, sessionManager, socialLoginManager } =
        makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      const req = request({
        params: { provider: 'github' },
        query: { redirectTo: '/oidc/continue' },
      });

      await controller.socialCallback(req, response());

      expect(sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
        req,
        expect.anything(),
        true
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'social_account_added_from_oidc',
        expect.anything(),
        'Social account (github) added from OIDC flow',
        expect.anything()
      );
      expect(redirectChain.to).toHaveBeenCalledWith('/oidc/continue');
    });

    it.each([
      ['max_limit_reached', 'Maximum number of accounts per session reached.'],
      ['already_exists', 'This account is already signed in.'],
    ])(
      'reports continuation account failure %s despite regeneration failure',
      async (reason, message) => {
        const {
          controller,
          flash,
          logger,
          sessionManager,
          socialLoginManager,
        } = makeHarness();
        socialLoginManager.handleCallback.mockResolvedValue({
          success: true,
          user: user(),
        });
        sessionManager.regenerate.mockRejectedValue(
          new Error('session unavailable')
        );
        sessionManager.addAuthenticatedUser.mockReturnValue({
          success: false,
          reason,
        });

        await controller.socialCallback(
          request({
            params: { provider: 'github' },
            query: { continue: '/oidc/continue' },
          }),
          response()
        );

        expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'Failed to regenerate session during social login',
          provider: 'github',
        });
        expect(flash.info).toHaveBeenCalledWith(message);
      }
    );

    it('authenticates and redirects through a stored social-registration intent', async () => {
      const {
        controller,
        logger,
        redirectAuthority,
        redirectChain,
        sessionManager,
        socialLoginManager,
      } = makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user({ email: undefined, roles: ['admin'] }),
      });
      redirectAuthority.getIntent.mockImplementation(
        (_req, key: string, consume: boolean) =>
          key === 'social_register' && !consume
            ? '/stored-registration-intent'
            : undefined
      );
      sessionManager.regenerate.mockRejectedValue(
        new Error('session unavailable')
      );
      const req = request({ params: { provider: 'github' } });

      await controller.socialCallback(req, response());

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session during social login',
        provider: 'github',
      });
      expect(redirectAuthority.getIntent).toHaveBeenCalledWith(
        req,
        'social_login',
        true
      );
      expect(redirectAuthority.getIntent).toHaveBeenCalledWith(
        req,
        'social_register',
        true
      );
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({ is_admin: true }),
      });
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        '/stored-registration-intent',
        { email: '', status: 'authenticated', provider: 'github' }
      );
      expect(redirectChain.to).toHaveBeenCalledWith(
        '/stored-registration-intent'
      );
    });

    it('finishes ordinary social login when session regeneration fails', async () => {
      const { controller, logger, sessionManager, socialLoginManager } =
        makeHarness();
      socialLoginManager.handleCallback.mockResolvedValue({
        success: true,
        user: user(),
      });
      sessionManager.regenerate.mockRejectedValue(
        new Error('session unavailable')
      );
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session during social login',
        provider: 'github',
      });
      expect(sessionManager.setAuthenticated).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('renders a stable error page for unexpected callback failures', async () => {
      const { controller, logger, socialLoginManager } = makeHarness();
      socialLoginManager.handleCallback.mockRejectedValue(
        new Error('callback failed')
      );
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_callback_failed',
        provider: 'github',
      });
      expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
        title: 'Social Authentication Error - Parako',
        provider: 'github',
        error: 'An unexpected error occurred during social authentication',
        redirectUrl: '/auth/login',
      });
    });

    it('prompts for missing social registration contact information', async () => {
      const { controller, session, sessionManager, socialLoginManager } =
        makeHarness();
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: { given_name: 'Alice' },
        tokens: { access_token: 'provider-token' },
      });
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'socialRegistrationPending',
        expect.objectContaining({
          provider: 'github',
          providerData: { given_name: 'Alice' },
          tokens: { access_token: 'provider-token' },
          timestamp: expect.any(Number),
        })
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('rejects social registration without required contact information', async () => {
      const { config, controller, session, socialLoginManager } = makeHarness();
      config.features.social_providers.behavior.missing_contact_info =
        'reject_login';
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: {},
      });
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
        title: 'Social Registration Error - Parako',
        provider: 'github',
        error:
          'github account must have an email address or phone number to register',
        redirectUrl: '/auth/register',
      });
    });

    it('fails closed for an unsupported social missing-contact policy', async () => {
      const { config, controller, session, socialLoginManager, userService } =
        makeHarness();
      config.features.social_providers.behavior.missing_contact_info =
        'unsupported' as never;
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: {},
      });
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(
        userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
        title: 'Social Registration Error - Parako',
        provider: 'github',
        error:
          'github account must have an email address or phone number to register',
        redirectUrl: '/auth/register',
      });
    });

    it.each([
      [
        true,
        'An account with email existing@example.test already exists. Please log in first, then link your github account.',
      ],
      [false, 'Account already exists with this email address.'],
    ])(
      'renders duplicate social account feedback when helpful errors are %s',
      async (showHelpfulErrors, expectedError) => {
        const { config, controller, session, socialLoginManager, userService } =
          makeHarness();
        config.features.social_providers.behavior.options.show_helpful_errors =
          showHelpfulErrors;
        session.set('socialRegister', {
          github: { intent: 'register', timestamp: Date.now() },
        });
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
          providerData: { email: 'existing@example.test' },
        });
        userService.findByEmailIncludingDisabled.mockResolvedValue(user());
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
          title: 'Account Already Exists - Parako',
          provider: 'github',
          error: expectedError,
          redirectUrl: '/auth/login',
        });
      }
    );

    it.each([
      [
        true,
        'An account with phone number +22997000000 already exists. Please log in first, then link your github account.',
      ],
      [false, 'Account already exists with this phone number.'],
    ])(
      'rejects a duplicate social phone when helpful errors are %s',
      async (showHelpfulErrors, expectedError) => {
        const { config, controller, session, socialLoginManager, userService } =
          makeHarness();
        config.features.social_providers.behavior.options.show_helpful_errors =
          showHelpfulErrors;
        session.set('socialRegister', {
          github: { intent: 'register', timestamp: Date.now() },
        });
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
          providerData: {
            email: 'new@example.test',
            phone_number: '+22997000000',
          },
        });
        userService.findByPhoneNumberIncludingDisabled.mockResolvedValue(
          user({ phone_number: '+22997000000' })
        );
        const res = response();

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          res
        );

        expect(userService.findByEmailIncludingDisabled).toHaveBeenCalledWith(
          'new@example.test'
        );
        expect(
          userService.findByPhoneNumberIncludingDisabled
        ).toHaveBeenCalledWith('+22997000000');
        expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
          title: 'Account Already Exists - Parako',
          provider: 'github',
          error: expectedError,
          redirectUrl: '/auth/login',
        });
      }
    );

    it('creates a disabled social account and starts password setup', async () => {
      const {
        controller,
        session,
        sessionManager,
        socialLoginManager,
        userService,
      } = makeHarness();
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      const providerData = {
        email: 'new@example.test',
        given_name: 'New',
        family_name: 'User',
        picture: '/new.png',
        email_verified: true,
      };
      const tokens = { access_token: 'provider-token' };
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData,
        tokens,
      });
      const newUser = user({
        _id: 'new-user',
        username: 'new-user',
        email: 'new@example.test',
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(newUser);
      socialLoginManager.linkToUser.mockResolvedValue({
        _id: 'integration-1',
      });
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(userService.createUserWithGeneratedUsername).toHaveBeenCalledWith({
        email: 'new@example.test',
        given_name: 'New',
        family_name: 'User',
        picture: '/new.png',
        email_verified: false,
        auth_provider: 'github',
        register_with: 'github',
        account_enabled: false,
      });
      expect(socialLoginManager.linkToUser).toHaveBeenCalledWith(
        'github',
        'new-user',
        providerData,
        tokens
      );
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'socialPasswordSetup',
        expect.objectContaining({
          userId: 'new-user',
          provider: 'github',
          integrationId: 'integration-1',
        })
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/password-setup?provider=github'
      );
    });

    it('preserves and checks a phone-only social registration contact', async () => {
      const { controller, session, socialLoginManager, userService } =
        makeHarness();
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      const providerData = { phone_number: '+22997000000' };
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData,
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(
        user({ _id: 'new-user', email: undefined })
      );
      socialLoginManager.linkToUser.mockResolvedValue({
        _id: 'integration-1',
      });

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        response()
      );

      expect(userService.findByEmailIncludingDisabled).not.toHaveBeenCalled();
      expect(
        userService.findByPhoneNumberIncludingDisabled
      ).toHaveBeenCalledWith('+22997000000');
      expect(userService.createUserWithGeneratedUsername).toHaveBeenCalledWith(
        expect.objectContaining({
          phone_number: '+22997000000',
          account_enabled: false,
        })
      );
    });

    it('renders registration failure when social integration creation fails', async () => {
      const { controller, session, socialLoginManager, userService } =
        makeHarness();
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: { email: 'new@example.test' },
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(
        user({ _id: 'new-user' })
      );
      socialLoginManager.linkToUser.mockRejectedValue(
        new Error('integration unavailable')
      );
      const res = response();

      await controller.socialCallback(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/social-callback', {
        title: 'Social Registration Error - Parako',
        provider: 'github',
        error: 'Registration failed. Please try again or contact support.',
        redirectUrl: '/auth/register',
      });
    });

    it('stores a boolean non-admin state after passwordless social registration', async () => {
      const {
        config,
        controller,
        session,
        sessionManager,
        socialLoginManager,
        userService,
      } = makeHarness();
      config.features.social_providers.behavior.require_password_on_registration = false;
      config.features.social_providers.behavior.options.auto_verify_email = true;
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: {
          email: 'new@example.test',
          email_verified: true,
        },
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(
        user({
          _id: undefined,
          username: 'new-user',
          email: 'new@example.test',
          email_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: undefined,
        })
      );
      socialLoginManager.linkToUser.mockResolvedValue({
        _id: 'integration-1',
      });
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await controller.socialCallback(req, res);

      expect(userService.createUserWithGeneratedUsername).toHaveBeenCalledWith(
        expect.objectContaining({
          email_verified: true,
          account_enabled: true,
        })
      );
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: '',
          email_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
          roles: ['user'],
          is_admin: false,
        }),
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it.each([false, undefined] as const)(
      'does not verify a social email when the provider verification claim is %s',
      async emailVerified => {
        const { config, controller, session, socialLoginManager, userService } =
          makeHarness();
        config.features.social_providers.behavior.require_password_on_registration = false;
        config.features.social_providers.behavior.options.auto_verify_email = true;
        session.set('socialRegister', {
          github: { intent: 'register', timestamp: Date.now() },
        });
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
          providerData: {
            email: 'new@example.test',
            email_verified: emailVerified,
          },
        });
        userService.createUserWithGeneratedUsername.mockResolvedValue(
          user({ _id: 'new-user', email: 'new@example.test' })
        );
        socialLoginManager.linkToUser.mockResolvedValue({
          _id: 'integration-1',
        });

        await controller.socialCallback(
          request({ params: { provider: 'github' } }),
          response()
        );

        expect(
          userService.createUserWithGeneratedUsername
        ).toHaveBeenCalledWith(
          expect.objectContaining({ email_verified: false })
        );
      }
    );

    it.each([
      ['continue', '/after-registration'],
      ['redirectTo', '/after-oidc-registration'],
    ])(
      'honors the %s query after passwordless social registration',
      async (queryKey, target) => {
        const {
          config,
          controller,
          logger,
          redirectChain,
          session,
          sessionManager,
          socialLoginManager,
          userService,
        } = makeHarness();
        config.features.social_providers.behavior.require_password_on_registration = false;
        session.set('socialRegister', {
          github: { intent: 'register', timestamp: Date.now() },
        });
        socialLoginManager.handleCallback.mockResolvedValue({
          success: false,
          requiresLinking: true,
          providerData: { email: 'new@example.test' },
        });
        userService.createUserWithGeneratedUsername.mockResolvedValue(
          user({ _id: 'new-user', email: 'new@example.test' })
        );
        socialLoginManager.linkToUser.mockResolvedValue({
          _id: 'integration-1',
        });
        sessionManager.regenerate.mockRejectedValue(
          new Error('session unavailable')
        );
        const req = request({
          params: { provider: 'github' },
          query: { [queryKey]: target },
        });

        await controller.socialCallback(req, response());

        expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'Failed to regenerate session during social registration',
          provider: 'github',
        });
        expect(redirectChain.to).toHaveBeenCalledWith(target);
      }
    );

    it('ignores malformed query redirects after social registration', async () => {
      const {
        config,
        controller,
        redirectAuthority,
        redirectChain,
        session,
        socialLoginManager,
        userService,
      } = makeHarness();
      config.features.social_providers.behavior.require_password_on_registration = false;
      session.set('socialRegister', {
        github: { intent: 'register', timestamp: Date.now() },
      });
      socialLoginManager.handleCallback.mockResolvedValue({
        success: false,
        requiresLinking: true,
        providerData: { email: 'new@example.test' },
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(
        user({ _id: 'new-user', email: undefined })
      );
      socialLoginManager.linkToUser.mockResolvedValue({
        _id: 'integration-1',
      });
      redirectAuthority.getIntent.mockImplementation(
        (_req, key: string, consume: boolean) =>
          key === 'social_register' && !consume
            ? '/stored-registration-intent'
            : undefined
      );

      await controller.socialCallback(
        request({
          params: { provider: 'github' },
          query: { continue: ['invalid'] },
        }),
        response()
      );

      expect(redirectChain.to).toHaveBeenCalledWith(
        '/stored-registration-intent'
      );
      expect(redirectAuthority.buildRedirectUrl).toHaveBeenCalledWith(
        '/stored-registration-intent',
        { email: '', status: 'registered', provider: 'github' }
      );
    });
  });

  describe('social password setup', () => {
    it('rejects a page request whose provider does not match the setup session', async () => {
      const { controller, flash, session } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      const res = response();

      await controller.socialPasswordSetup(
        request({ query: { provider: 'google' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid social password setup session'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
      expect(res.render).not.toHaveBeenCalled();
    });

    it('removes an expired password-setup session before redirecting', async () => {
      const { controller, flash, session, sessionManager } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now() - 30 * 60 * 1000 - 1,
      });
      const req = request({ query: { provider: 'github' } });
      const res = response();

      await controller.socialPasswordSetup(req, res);

      expect(flash.error).toHaveBeenCalledWith(
        'Social password setup session has expired'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialPasswordSetup'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('renders the password-setup page with the configured policy', async () => {
      const { controller, session, userService } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      const res = response();

      await controller.socialPasswordSetup(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(userService.getPasswordPolicy).toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('auth/social-password-setup', {
        title: 'Complete Registration - Parako',
        provider: 'github',
        passwordPolicy: { min_length: 12 },
      });
    });

    it('redirects safely when loading the password policy fails', async () => {
      const { controller, flash, logger, session, userService } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      userService.getPasswordPolicy.mockImplementation(() => {
        throw new Error('policy unavailable');
      });
      const res = response();

      await controller.socialPasswordSetup(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_password_setup_page_failed',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to load password setup page'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('rejects a password submission whose provider does not match the setup session', async () => {
      const { controller, flash, passwordUtils, session, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialPasswordSetup(
        request({
          body: {
            password: 'ValidPassword1!',
            confirmPassword: 'ValidPassword1!',
          },
          query: { provider: 'google' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid social password setup session'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
      expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('removes an expired password submission session before redirecting', async () => {
      const { controller, flash, session, sessionManager, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now() - 30 * 60 * 1000 - 1,
      });
      const req = request({
        body: {
          password: 'ValidPassword1!',
          confirmPassword: 'ValidPassword1!',
        },
        query: { provider: 'github' },
      });
      const res = response();

      await controller.processSocialPasswordSetup(req, res);

      expect(flash.error).toHaveBeenCalledWith(
        'Social password setup session has expired'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialPasswordSetup'
      );
      expect(userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('rejects non-string password values before validation or hashing', async () => {
      const { controller, flash, passwordUtils, session, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      const malformedPassword: unknown[] = [];
      const res = response();

      await controller.processSocialPasswordSetup(
        request({
          body: {
            password: malformedPassword,
            confirmPassword: malformedPassword,
          },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Password and confirmation are required'
      );
      expect(userService.validatePassword).not.toHaveBeenCalled();
      expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/password-setup?provider=github'
      );
    });

    it.each([
      [
        { password: 'ValidPassword1!', confirmPassword: 'DifferentPassword1!' },
        'Password and confirmation do not match',
      ],
      [
        { password: 'weak', confirmPassword: 'weak' },
        'Password requirements not met: too short, missing uppercase',
      ],
    ])('rejects an invalid password submission %#', async (body, message) => {
      const { controller, flash, passwordUtils, session, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      if (body.password === 'weak') {
        userService.validatePassword.mockReturnValue({
          isValid: false,
          messages: ['too short', 'missing uppercase'],
        });
      }
      const res = response();

      await controller.processSocialPasswordSetup(
        request({ body, query: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(message);
      expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/password-setup?provider=github'
      );
    });

    it('reports a missing user after clearing completed setup state', async () => {
      const { controller, flash, session, sessionManager, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'missing-user',
        provider: 'github',
        timestamp: Date.now(),
      });
      const req = request({
        body: {
          password: 'ValidPassword1!',
          confirmPassword: 'ValidPassword1!',
        },
        query: { provider: 'github' },
      });
      const res = response();

      await controller.processSocialPasswordSetup(req, res);

      expect(userService.findById).toHaveBeenCalledWith('missing-user');
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialPasswordSetup'
      );
      expect(flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('uses safe account defaults after completing password setup', async () => {
      const { controller, session, sessionManager, userService } =
        makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      userService.findById.mockResolvedValue(
        user({ roles: undefined, email_verified: false })
      );
      const req = request({
        body: {
          password: 'ValidPassword1!',
          confirmPassword: 'ValidPassword1!',
        },
        query: { provider: 'github' },
      });

      await controller.processSocialPasswordSetup(req, response());

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: 'user-1',
          roles: ['user'],
          is_admin: false,
        }),
      });
    });

    it('reports a stable error when account activation fails', async () => {
      const { controller, flash, logger, session, userService } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      userService.updateById.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await controller.processSocialPasswordSetup(
        request({
          body: {
            password: 'ValidPassword1!',
            confirmPassword: 'ValidPassword1!',
          },
          query: { provider: 'github' },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_password_setup_failed',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to complete password setup'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('activates a social superadmin and establishes an authenticated session', async () => {
      const {
        controller,
        flash,
        logger,
        passwordUtils,
        session,
        sessionManager,
        userService,
      } = makeHarness();
      session.set('socialPasswordSetup', {
        userId: 'user-1',
        provider: 'github',
        timestamp: Date.now(),
      });
      userService.findById.mockResolvedValue(
        user({
          _id: undefined,
          email_verified: undefined,
          given_name: undefined,
          family_name: undefined,
          picture: undefined,
          roles: ['superadmin'],
        })
      );
      sessionManager.regenerate.mockRejectedValue(
        new Error('session unavailable')
      );
      const req = request({
        body: {
          password: 'ValidPassword1!',
          confirmPassword: 'ValidPassword1!',
        },
        query: { provider: 'github' },
      });
      const res = response();

      await controller.processSocialPasswordSetup(req, res);

      expect(userService.validatePassword).toHaveBeenCalledWith(
        'ValidPassword1!'
      );
      expect(passwordUtils.hashPassword).toHaveBeenCalledWith(
        'ValidPassword1!'
      );
      expect(userService.updateById).toHaveBeenCalledWith('user-1', {
        password: 'hashed-password',
        account_enabled: true,
      });
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialPasswordSetup'
      );
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to regenerate session during social password setup',
        provider: 'github',
      });
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: expect.objectContaining({
          id: '',
          email_verified: false,
          given_name: '',
          family_name: '',
          full_name: '',
          picture: '',
          roles: ['superadmin'],
          is_admin: true,
        }),
      });
      expect(activityMocks.success).toHaveBeenCalledWith(
        'social_registration_completed',
        expect.anything(),
        'User completed social registration with github and set password',
        expect.anything()
      );
      expect(flash.success).toHaveBeenCalledWith(
        'Registration completed successfully! Welcome to Parako'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });
  });

  describe('social contact information', () => {
    it('rejects a page request whose provider does not match the pending session', async () => {
      const { controller, flash, session } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.socialContactInfo(
        request({ query: { provider: 'google' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid social contact info session'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
      expect(res.render).not.toHaveBeenCalled();
    });

    it('removes expired contact state before redirecting from the page', async () => {
      const { controller, flash, session, sessionManager } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now() - 30 * 60 * 1000 - 1,
      });
      const req = request({ query: { provider: 'github' } });
      const res = response();

      await controller.socialContactInfo(req, res);

      expect(flash.error).toHaveBeenCalledWith(
        'Social contact info session has expired'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialRegistrationPending'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('renders pending provider data with configured contact channels', async () => {
      const { config, controller, session } = makeHarness();
      const providerData = { given_name: 'Alice' };
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData,
        timestamp: Date.now(),
      });
      const res = response();

      await controller.socialContactInfo(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('auth/social-contact-info', {
        title: 'Complete Registration - Parako',
        provider: 'github',
        providerData,
        isLogin: false,
        contactChannels: config.security.authentication.signup.contact_channels,
      });
    });

    it('renders safe contact-channel defaults when configuration is absent', async () => {
      const { config, controller, session } = makeHarness();
      config.security.authentication.signup.contact_channels =
        undefined as never;
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.socialContactInfo(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'auth/social-contact-info',
        expect.objectContaining({
          contactChannels: {
            email: { enabled: true, required: true },
            phone: { enabled: false, required: false },
            require_at_least_one: true,
          },
        })
      );
    });

    it('redirects safely when loading pending contact state fails', async () => {
      const { controller, flash, logger, sessionManager } = makeHarness();
      sessionManager.get.mockImplementationOnce(() => {
        throw new Error('session unavailable');
      });
      const res = response();

      await controller.socialContactInfo(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_contact_info_page_failed',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to load contact info page'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('rejects a contact submission whose provider does not match the pending session', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { email: 'new@example.test' },
          query: { provider: 'google' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Invalid social contact info session'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
      expect(userService.findByEmailIncludingDisabled).not.toHaveBeenCalled();
    });

    it('removes expired contact state before processing a submission', async () => {
      const { controller, flash, session, sessionManager, userService } =
        makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now() - 30 * 60 * 1000 - 1,
      });
      const req = request({
        body: { email: 'new@example.test' },
        query: { provider: 'github' },
      });
      const res = response();

      await controller.processSocialContactInfo(req, res);

      expect(flash.error).toHaveBeenCalledWith(
        'Social contact info session has expired'
      );
      expect(sessionManager.remove).toHaveBeenCalledWith(
        req,
        'socialRegistrationPending'
      );
      expect(userService.findByEmailIncludingDisabled).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });

    it('enforces a configured required email on contact submission', async () => {
      const { config, controller, flash, session, userService } = makeHarness();
      config.security.authentication.signup.contact_channels.email.required = true;
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { phone_number: '+22997000000' },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Email is required');
      expect(
        userService.findByPhoneNumberIncludingDisabled
      ).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('requires email under fallback contact-channel configuration', async () => {
      const { config, controller, flash, session } = makeHarness();
      config.security.authentication.signup.contact_channels =
        undefined as never;
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { phone_number: '+22997000000' },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Email is required');
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('enforces a configured required phone on contact submission', async () => {
      const { config, controller, flash, session, userService } = makeHarness();
      config.security.authentication.signup.contact_channels.phone.required = true;
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { email: 'new@example.test' },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith('Phone number is required');
      expect(userService.findByEmailIncludingDisabled).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('requires at least one submitted contact', async () => {
      const { controller, flash, session } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({ query: { provider: 'github' } }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Email address or phone number is required'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('rejects a non-string email before duplicate lookup', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { email: ['new@example.test'] },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Please enter a valid email address'
      );
      expect(userService.findByEmailIncludingDisabled).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('rejects a non-string phone number before duplicate lookup', async () => {
      const { controller, flash, session, userService } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { phone_number: ['+22997000000'] },
          query: { provider: 'github' },
        }),
        res
      );

      expect(flash.error).toHaveBeenCalledWith(
        'Please enter a valid phone number'
      );
      expect(
        userService.findByPhoneNumberIncludingDisabled
      ).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/social/contact-info?provider=github'
      );
    });

    it('normalizes social contacts before duplicate checks and registration', async () => {
      const { config, controller, session, socialLoginManager, userService } =
        makeHarness();
      config.features.social_providers.behavior.require_password_on_registration = false;
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: { given_name: 'Alice' },
        tokens: { access_token: 'provider-token' },
        timestamp: Date.now(),
      });
      userService.createUserWithGeneratedUsername.mockResolvedValue(
        user({ _id: 'new-user', email: 'new@example.test' })
      );
      socialLoginManager.linkToUser.mockResolvedValue({
        _id: 'integration-1',
      });

      await controller.processSocialContactInfo(
        request({
          body: {
            email: '  New@Example.TEST  ',
            phone_number: '+229 97-00-00-00',
          },
          query: { provider: 'github' },
        }),
        response()
      );

      expect(userService.findByEmailIncludingDisabled).toHaveBeenCalledWith(
        'new@example.test'
      );
      expect(
        userService.findByPhoneNumberIncludingDisabled
      ).toHaveBeenCalledWith('+22997000000');
      expect(userService.createUserWithGeneratedUsername).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.test',
          phone_number: '+22997000000',
        })
      );
    });

    it.each([
      [
        { email: `${'a'.repeat(248)}@example.test` },
        'Email address is too long',
        'email-length',
      ],
      [
        { email: 'not-an-email' },
        'Please enter a valid email address',
        'email',
      ],
      [
        { email: 'existing@example.test' },
        'An account with this email address already exists. Please use a different email or log in with your existing account.',
        'email-duplicate',
      ],
      [
        { phone_number: `+${'1'.repeat(20)}` },
        'Phone number is too long',
        'phone-length',
      ],
      [{ phone_number: '+000' }, 'Please enter a valid phone number', 'phone'],
      [
        { phone_number: '+22997000000' },
        'An account with this phone number already exists. Please use a different phone number or log in with your existing account.',
        'phone-duplicate',
      ],
    ])(
      'rejects invalid or duplicate contact case %s',
      async (body, message, kind) => {
        const { controller, flash, session, userService } = makeHarness();
        session.set('socialRegistrationPending', {
          provider: 'github',
          providerData: {},
          timestamp: Date.now(),
        });
        if (kind === 'email-duplicate') {
          userService.findByEmailIncludingDisabled.mockResolvedValue(user());
        }
        if (kind === 'phone-duplicate') {
          userService.findByPhoneNumberIncludingDisabled.mockResolvedValue(
            user()
          );
        }
        const res = response();

        await controller.processSocialContactInfo(
          request({ body, query: { provider: 'github' } }),
          res
        );

        expect(flash.error).toHaveBeenCalledWith(message);
        expect(res.redirect).toHaveBeenCalledWith(
          '/auth/social/contact-info?provider=github'
        );
      }
    );

    it.each([
      [
        { email: 'new@example.test' },
        { phone_number: '+22997000000' },
        { email: 'new@example.test', phone_number: '+22997000000' },
      ],
      [
        { phone_number: '+22997000000' },
        { email: 'provider@example.test' },
        { email: 'provider@example.test', phone_number: '+22997000000' },
      ],
    ])(
      'preserves provider contact data when only one contact is submitted %#',
      async (body, providerData, expectedContacts) => {
        const { controller, session, socialLoginManager, userService } =
          makeHarness();
        session.set('socialRegistrationPending', {
          provider: 'github',
          providerData,
          timestamp: Date.now(),
        });
        userService.createUserWithGeneratedUsername.mockResolvedValue(
          user({ _id: 'new-user', email: 'new@example.test' })
        );
        socialLoginManager.linkToUser.mockResolvedValue({
          _id: 'integration-1',
        });

        await controller.processSocialContactInfo(
          request({ body, query: { provider: 'github' } }),
          response()
        );

        expect(
          userService.createUserWithGeneratedUsername
        ).toHaveBeenCalledWith(expect.objectContaining(expectedContacts));
      }
    );

    it('reports a stable error when contact lookup fails', async () => {
      const { controller, flash, logger, session, userService } = makeHarness();
      session.set('socialRegistrationPending', {
        provider: 'github',
        providerData: {},
        timestamp: Date.now(),
      });
      userService.findByEmailIncludingDisabled.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await controller.processSocialContactInfo(
        request({
          body: { email: 'new@example.test' },
          query: { provider: 'github' },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'social_contact_info_failed',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to complete contact information'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/register');
    });
  });
});
