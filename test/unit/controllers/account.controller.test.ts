import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const activityMocks = vi.hoisted(() => ({
  factory: vi.fn(),
  failed: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));
const passwordBreachMocks = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

vi.mock('../../../src/utils/activity-logger.factory.js', () => ({
  activityLoggerFor: activityMocks.factory,
}));
vi.mock('../../../src/utils/password-breach.js', () => ({
  checkPasswordBreach: passwordBreachMocks.check,
}));

import { AccountsController } from '../../../src/controllers/account.controller.js';

const activeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  email_verified: true,
  phone_number: '+22900000000',
  phone_number_verified: true,
  given_name: 'Alice',
  family_name: 'Doe',
  full_name: 'Alice Doe',
  picture: 'avatars/alice.png',
  roles: ['user'],
  is_admin: false,
  locale: 'fr',
  zoneinfo: 'Africa/Porto-Novo',
  ...overrides,
});

const databaseUser = (overrides: Record<string, unknown> = {}) => ({
  _id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  password: 'hash',
  phone_number: '+22900000000',
  phone_number_verified: true,
  notification_preferences: { preferred_channel: 'email' },
  recovery: { enabled: true },
  mfa: { enabled: true },
  custom_identifier_1: 'member-1',
  custom_identifier_2: undefined,
  custom_identifier_3: undefined,
  ...overrides,
});

function createHarness() {
  const flash = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  };
  const config = {
    application: { title: 'Parako' },
    oidc: { issuer: 'https://id.example.test/oidc/v1' },
    deployment: {
      url: 'https://id.example.test',
      routes: {
        auth: '/auth',
        auth_routes: { login: '/login', verify_email: '/verify-email' },
        accounts: '/accounts',
        account_routes: {
          apps: '/apps',
          dashboard: '/dashboard',
          settings_profile: '/settings/profile',
          settings_preferences: '/settings/preferences',
          settings_notifications: '/settings/notifications',
          settings_security: '/settings/security',
          settings_recovery: '/settings/recovery',
          settings_social: '/settings/social',
          sessions: '/sessions',
          setup_mfa: '/settings/mfa/setup',
          recovery_codes: '/recovery-codes',
          recovery_setup: '/recovery-setup',
          security_questions_setup: '/security-questions/setup',
          verify_recovery_email: '/verify-recovery-email',
        },
      },
    },
    notifications: { defaults: { allow_user_preferences: true } },
    security: {
      authentication: {
        password_breach_detection: {
          enabled: false,
        } as {
          enabled: boolean;
          api_timeout_ms?: number;
          check_on_password_change?: boolean;
          min_breach_count?: number;
        },
      },
    },
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const userService = {
    findById: vi.fn(),
    findByRecoveryToken: vi.fn(),
    findByUsername: vi.fn(),
    getCustomIdentifier: vi.fn(),
    getCustomIdentifierFields: vi.fn().mockReturnValue([]),
    getPasswordPolicy: vi.fn().mockReturnValue({ min_length: 12 }),
    isCustomIdentifierAvailable: vi.fn().mockResolvedValue(true),
    removeCustomIdentifier: vi.fn().mockResolvedValue(undefined),
    setCustomIdentifier: vi.fn().mockResolvedValue(undefined),
    updateNotificationPreferences: vi.fn().mockResolvedValue(databaseUser()),
    updateProfile: vi.fn().mockResolvedValue(databaseUser()),
    validatePassword: vi.fn().mockReturnValue({ isValid: true, messages: [] }),
    changePassword: vi.fn().mockResolvedValue(undefined),
    removeAvatar: vi.fn().mockResolvedValue(undefined),
    disableMfa: vi.fn().mockResolvedValue(undefined),
    enableMfaEmail: vi.fn().mockResolvedValue(undefined),
    enableMfaTotp: vi.fn().mockResolvedValue(undefined),
    initiateEmailMfaSetup: vi.fn().mockResolvedValue({ code: '123456' }),
    initiateMfaTotpSetup: vi.fn().mockResolvedValue(undefined),
    updateById: vi.fn().mockResolvedValue(databaseUser()),
    updateWithAssignment: vi.fn().mockResolvedValue(databaseUser()),
    verifyEmailMfaSetupCode: vi.fn().mockResolvedValue(true),
    verifyTotpSetupCode: vi.fn().mockResolvedValue(true),
  };
  const activity = {
    findActivitiesAroundTime: vi.fn().mockResolvedValue([]),
    getLastActivityInfoFormatted: vi.fn().mockResolvedValue('2 minutes ago'),
  };
  const authService = {
    generateEmailVerificationToken: vi
      .fn()
      .mockResolvedValue({ verificationToken: 'verification-token' }),
  };
  const notificationService = {
    sendOtp: vi.fn().mockResolvedValue(undefined),
    sendSecurityAlert: vi.fn().mockResolvedValue(undefined),
    sendTemplatedEmail: vi
      .fn()
      .mockResolvedValue({ success: true, channel: 'email' }),
    sendVerification: vi.fn().mockResolvedValue(undefined),
  };
  const viewResolver = {
    views: {
      accounts: {
        apps: 'accounts/apps',
        my_account: 'accounts/my-account',
        passkeys: 'accounts/passkeys',
        sessions: 'accounts/sessions',
        settings_profile: 'accounts/settings-profile',
        settings_preferences: 'accounts/settings-preferences',
        settings_notifications: 'accounts/settings-notifications',
        settings_security: 'accounts/settings-security',
        settings_recovery: 'accounts/settings-recovery',
        settings_social: 'accounts/settings-social',
        recovery_codes: 'accounts/recovery-codes',
        recovery_setup: 'accounts/recovery-setup',
        security_questions_setup: 'accounts/security-questions-setup',
      },
      auth: {
        recovery_codes_display: 'auth/recovery-codes-display',
        setup_mfa: 'auth/setup-mfa',
        setup_webauthn: 'auth/setup-webauthn',
      },
    },
  };
  const sessionManager = {
    flash: vi.fn().mockReturnValue(flash),
    get: vi.fn(),
    getActiveUser: vi.fn(),
    getAuthenticatedUsers: vi.fn(),
    findExpressSessionsForUser: vi.fn().mockResolvedValue([]),
    regenerate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    removeAuthenticatedUser: vi.fn().mockResolvedValue(true),
    revokeExpressSession: vi.fn().mockResolvedValue(true),
    set: vi.fn(),
    setAuthenticated: vi.fn(),
    switchUser: vi.fn().mockReturnValue({ success: true }),
  };
  const socialLoginManager = {
    getAuthorizationUrl: vi
      .fn()
      .mockResolvedValue('https://github.example.test/authorize'),
    getAvailableProviders: vi.fn().mockReturnValue([]),
    isProviderAvailable: vi.fn().mockReturnValue(true),
    unlinkFromUser: vi.fn().mockResolvedValue(undefined),
  };
  const socialIntegrationService = {
    findByUser: vi.fn().mockResolvedValue([]),
  };
  const mfaUtils = {
    generateQrCode: vi.fn().mockResolvedValue('data:image/png;base64,qr'),
    generateTotpSecret: vi.fn().mockReturnValue('totp-secret'),
    generateTotpUri: vi.fn().mockReturnValue('otpauth://totp/Parako'),
    getMfaConfig: vi.fn().mockReturnValue({ enabled: true }),
    getEnabledMethods: vi.fn().mockReturnValue(['totp']),
    getUserTotpSecret: vi.fn().mockReturnValue('totp-secret'),
    isEmailMfaPendingSetup: vi.fn().mockReturnValue(true),
    isMethodSupported: vi
      .fn()
      .mockImplementation((method: unknown) =>
        ['email', 'totp'].includes(method as string)
      ),
    isTotpPendingSetup: vi.fn().mockReturnValue(true),
    maskEmail: vi.fn().mockReturnValue('a***@example.test'),
  };
  const recoveryUtils = {
    getRecoveryConfig: vi.fn().mockReturnValue({ methods: ['email'] }),
    checkRecoveryCooldown: vi.fn().mockReturnValue({
      inCooldown: false,
      hoursRemaining: 0,
    }),
    checkSecondaryEmailDomain: vi.fn().mockReturnValue({
      sameDomain: false,
    }),
    generateBackupCodes: vi.fn().mockResolvedValue({
      codes: ['recovery-1'],
      hashedCodes: ['hashed-recovery-1'],
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      expiresAt: new Date('2027-08-05T00:00:00.000Z'),
    }),
    generateSecondaryEmailVerification: vi.fn().mockReturnValue({
      email: 'recovery@example.test',
      verificationToken: 'raw-verification-token',
      tokenHash: 'hashed-verification-token',
      expiresAt: new Date('2026-08-06T00:00:00.000Z'),
    }),
    getAvailableQuestionKeys: vi
      .fn()
      .mockReturnValue(['first_school', 'childhood_friend', 'first_job']),
    setupSecurityQuestions: vi.fn(),
    validateSecurityAnswer: vi.fn().mockReturnValue({ valid: true }),
    verifySecondaryEmailToken: vi.fn().mockReturnValue({ valid: true }),
  };
  const configManager = { getConfig: vi.fn().mockReturnValue(config) };
  const uploadMiddleware = {
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getFileUrl: vi.fn<(value: string) => string | undefined>(
      (value: string) => `/media/${value}`
    ),
    storeFile: vi.fn().mockResolvedValue('avatars/new.png'),
  };
  const oidcAdapter = {
    session: {
      findByAccountId: vi.fn().mockResolvedValue([]),
      revokeAllSessionsExcept: vi.fn().mockResolvedValue(0),
      revokeSession: vi.fn().mockResolvedValue(true),
    },
    grant: {
      destroy: vi.fn().mockResolvedValue(undefined),
      find: vi.fn(),
      findGrantsByAccountId: vi.fn().mockResolvedValue([]),
    },
    client: { findClientById: vi.fn(), find: vi.fn() },
  };
  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn().mockReturnValue({
      ip: '127.0.0.1',
      user_agent: 'vitest',
    }),
  };
  const webauthnService = {
    isEnabled: vi.fn().mockReturnValue(true),
  };
  const redirectChain = {
    or: vi.fn(),
    to: vi.fn(),
    withOptions: vi.fn(),
  };
  redirectChain.withOptions.mockReturnValue(redirectChain);
  redirectChain.to.mockReturnValue(redirectChain);
  const redirectAuthority = {
    redirect: vi.fn().mockReturnValue(redirectChain),
  };

  const controller = new (AccountsController as any)(
    logger,
    userService,
    authService,
    activity,
    notificationService,
    viewResolver,
    sessionManager,
    clientDeviceInfoManager,
    socialLoginManager,
    socialIntegrationService,
    mfaUtils,
    recoveryUtils,
    configManager,
    uploadMiddleware,
    oidcAdapter,
    redirectAuthority,
    webauthnService
  ) as AccountsController;

  return {
    activity,
    authService,
    config,
    configManager,
    clientDeviceInfoManager,
    controller,
    flash,
    logger,
    mfaUtils,
    notificationService,
    oidcAdapter,
    recoveryUtils,
    redirectAuthority,
    redirectChain,
    sessionManager,
    socialIntegrationService,
    socialLoginManager,
    uploadMiddleware,
    userService,
    viewResolver,
    webauthnService,
  };
}

function request(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    get: vi.fn().mockReturnValue('vitest'),
    ip: '127.0.0.1',
    params: {},
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as Request;
}

function response(): Response {
  return {
    json: vi.fn(),
    redirect: vi.fn(),
    render: vi.fn(),
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('AccountsController read pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passwordBreachMocks.check.mockResolvedValue({
      breached: false,
      count: 0,
    });
    activityMocks.factory.mockReturnValue({
      failed: activityMocks.failed,
      info: activityMocks.info,
      success: activityMocks.success,
    });
  });

  describe('myAccount()', () => {
    it('redirects anonymous users without reading account data', async () => {
      const { controller, oidcAdapter, sessionManager, userService } =
        createHarness();
      const res = response();

      await controller.myAccount(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(userService.findByUsername).not.toHaveBeenCalled();
      expect(oidcAdapter.session.findByAccountId).not.toHaveBeenCalled();
      expect(sessionManager.flash).not.toHaveBeenCalled();
    });

    it('redirects when the active account no longer exists', async () => {
      const { controller, flash, sessionManager, userService } =
        createHarness();
      sessionManager.getActiveUser.mockReturnValue(activeUser());
      userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await controller.myAccount(request(), res);

      expect(flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('renders counts, current account data, and localized activity', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: user,
        others: [activeUser({ id: 'user-2', username: 'bob' })],
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        { uid: 'session-1' },
        { uid: 'session-2' },
      ]);
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'client-1' } },
        { payload: { clientId: 'client-1' } },
        { payload: { clientId: 'client-2' } },
      ]);
      const res = response();

      await harness.controller.myAccount(request(), res);

      expect(
        harness.activity.getLastActivityInfoFormatted
      ).toHaveBeenCalledWith('user-1', 'alice', {
        language: 'fr',
        timezone: 'Africa/Porto-Novo',
        serverTimezone: true,
        useRelativeTime: true,
      });
      expect(res.render).toHaveBeenCalledWith('accounts/my-account', {
        title: 'My Account',
        pageUser: expect.objectContaining({
          picture: '/media/avatars/alice.png',
          activeSessions: '2 devices',
          connectedApps: '2 applications',
          phone_number: '+22900000000',
          phone_number_verified: true,
          mfa: { enabled: true },
        }),
        mfaConfig: { enabled: true },
        totalAccounts: 2,
        lastActivity: '2 minutes ago',
      });
    });

    it('uses singular zero-safe fallbacks and preserves unresolved pictures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({ locale: undefined, zoneinfo: undefined })
      );
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue(undefined);
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue(
        undefined
      );
      harness.uploadMiddleware.getFileUrl.mockReturnValue(undefined);
      const res = response();

      await harness.controller.myAccount(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/my-account',
        expect.objectContaining({
          pageUser: expect.objectContaining({
            picture: 'avatars/alice.png',
            activeSessions: '0 devices',
            connectedApps: '0 applications',
          }),
          totalAccounts: 1,
        })
      );
      expect(
        harness.activity.getLastActivityInfoFormatted
      ).toHaveBeenCalledWith(
        'user-1',
        'alice',
        expect.objectContaining({ language: 'en', timezone: 'UTC' })
      );

      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        { uid: 'only-session' },
      ]);
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'only-client' } },
      ]);
      const singularRes = response();
      await harness.controller.myAccount(request(), singularRes);
      expect(singularRes.render).toHaveBeenCalledWith(
        'accounts/my-account',
        expect.objectContaining({
          pageUser: expect.objectContaining({
            activeSessions: '1 device',
            connectedApps: '1 application',
          }),
        })
      );
    });

    it('logs dependency failures and returns to login', async () => {
      const { controller, flash, logger, sessionManager, userService } =
        createHarness();
      sessionManager.getActiveUser.mockReturnValue(activeUser());
      userService.findByUsername.mockRejectedValue(new Error('database down'));
      const res = response();

      await controller.myAccount(request(), res);

      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'my_account_page_load_failed',
      });
      expect(flash.error).toHaveBeenCalledWith(
        'Failed to load account information'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });

  it('redirects the settings root to the profile page', async () => {
    const { controller } = createHarness();
    const res = response();

    await controller.settings(request(), res);

    expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
  });

  describe('settingsProfile()', () => {
    it('guards anonymous and deleted accounts', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.settingsProfile(request(), anonymousRes);
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');

      const deleted = createHarness();
      deleted.sessionManager.getActiveUser.mockReturnValue(activeUser());
      deleted.userService.findByUsername.mockResolvedValue(null);
      const deletedRes = response();
      await deleted.controller.settingsProfile(request(), deletedRes);
      expect(deleted.flash.error).toHaveBeenCalledWith('User not found');
      expect(deletedRes.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('renders only user-visible custom identifiers', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        { slot: 1, name: 'Member', edit_policy: 'full' },
        { slot: 2, name: 'Internal', edit_policy: 'admin_only' },
        { slot: 3, name: 'Handle', edit_policy: 'set_once' },
      ]);
      const res = response();

      await harness.controller.settingsProfile(request(), res);

      expect(res.render).toHaveBeenCalledWith('accounts/settings-profile', {
        title: 'Account Settings - Profile',
        pageUser: expect.objectContaining({
          picture: '/media/avatars/alice.png',
          custom_identifier_1: 'member-1',
          custom_identifier_2: undefined,
          custom_identifier_3: undefined,
        }),
        customIdentifierFields: [
          { slot: 1, name: 'Member', edit_policy: 'full' },
          { slot: 3, name: 'Handle', edit_policy: 'set_once' },
        ],
      });
    });
  });

  describe('settingsPreferences()', () => {
    it('guards anonymous users and renders active-user preferences', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.settingsPreferences(request(), anonymousRes);
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');

      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({ picture: undefined })
      );
      const res = response();
      await harness.controller.settingsPreferences(request(), res);
      expect(harness.uploadMiddleware.getFileUrl).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('accounts/settings-preferences', {
        title: 'Account Settings - Preferences',
        pageUser: expect.objectContaining({ picture: '' }),
      });
    });
  });

  describe('settingsNotifications()', () => {
    it('renders persisted notification and recovery settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.settingsNotifications(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/settings-notifications',
        {
          title: 'Account Settings - Notifications',
          pageUser: expect.objectContaining({
            notification_preferences: { preferred_channel: 'email' },
            recovery: { enabled: true },
          }),
          notificationConfig: harness.config.notifications,
        }
      );
    });
  });

  describe('settingsSecurity()', () => {
    it('renders password and linked-provider security state', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'google' },
      ]);
      const res = response();

      await harness.controller.settingsSecurity(request(), res);

      expect(res.render).toHaveBeenCalledWith('accounts/settings-security', {
        title: 'Account Settings - Security',
        pageUser: expect.objectContaining({ mfa: { enabled: true } }),
        mfaConfig: { enabled: true },
        passwordPolicy: { min_length: 12 },
        hasPassword: true,
        isSpecialPasswordCase: false,
      });
    });

    it('identifies the single-social-provider passwordless case', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ password: '   ' })
      );
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'github' },
      ]);
      const res = response();

      await harness.controller.settingsSecurity(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/settings-security',
        expect.objectContaining({
          hasPassword: false,
          isSpecialPasswordCase: true,
        })
      );
    });
  });

  describe('settingsRecovery()', () => {
    it('renders recovery state and configuration', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.settingsRecovery(request(), res);

      expect(res.render).toHaveBeenCalledWith('accounts/settings-recovery', {
        title: 'Account Settings - Recovery',
        pageUser: expect.objectContaining({ recovery: { enabled: true } }),
        recoveryConfig: { methods: ['email'] },
      });
    });
  });

  describe('settingsSocial()', () => {
    it('maps linked, available, and unlink-safe provider state', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ password: '' })
      );
      const google = { method: 'google', provider_user_id: 'google-1' };
      harness.socialIntegrationService.findByUser.mockResolvedValue([google]);
      harness.socialLoginManager.getAvailableProviders.mockReturnValue([
        'google',
        'github',
      ]);
      harness.socialLoginManager.isProviderAvailable.mockImplementation(
        (provider: string) => provider === 'google'
      );
      const res = response();

      await harness.controller.settingsSocial(request(), res);

      expect(res.render).toHaveBeenCalledWith('accounts/settings-social', {
        title: 'Account Settings - Social Accounts',
        pageUser: expect.objectContaining({ username: 'alice' }),
        socialProviders: [
          {
            provider: 'google',
            isLinked: true,
            integration: google,
            isAvailable: true,
            canUnlink: false,
          },
          {
            provider: 'github',
            isLinked: false,
            integration: null,
            isAvailable: false,
            canUnlink: true,
          },
        ],
        hasPassword: false,
      });
    });
  });

  describe('updateNotificationPreferences()', () => {
    it('guards anonymous users and disabled preference changes', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.updateNotificationPreferences(
        request(),
        anonymousRes
      );
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');
      expect(
        anonymous.userService.updateNotificationPreferences
      ).not.toHaveBeenCalled();

      const disabled = createHarness();
      disabled.sessionManager.getActiveUser.mockReturnValue(activeUser());
      disabled.config.notifications.defaults.allow_user_preferences = false;
      const disabledRes = response();
      await disabled.controller.updateNotificationPreferences(
        request(),
        disabledRes
      );
      expect(disabled.flash.error).toHaveBeenCalledWith(
        'Notification preferences cannot be changed'
      );
      expect(disabledRes.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
      expect(
        disabled.userService.updateNotificationPreferences
      ).not.toHaveBeenCalled();
    });

    it('persists the supported channel and checkbox values', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const req = request({
        body: {
          preferred_channel: 'sms',
          security_alerts: 'on',
          new_session_alerts: 'off',
          marketing: 'on',
        },
      });
      const res = response();

      await harness.controller.updateNotificationPreferences(req, res);

      const expectedPreferences = {
        preferred_channel: 'sms',
        security_alerts: true,
        new_session_alerts: false,
        marketing: true,
      };
      expect(
        harness.userService.updateNotificationPreferences
      ).toHaveBeenCalledWith('user-1', expectedPreferences);
      expect(activityMocks.success).toHaveBeenCalledWith(
        'notification_preferences_updated',
        null,
        'User updated notification preferences',
        expect.objectContaining({
          target: {
            target_type: 'user',
            entity_data: { changes: expectedPreferences },
          },
        })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Notification preferences updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('falls back to auto for omitted or unsupported channels', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());

      await harness.controller.updateNotificationPreferences(
        request({ body: { preferred_channel: 'push' } }),
        response()
      );
      expect(
        harness.userService.updateNotificationPreferences
      ).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ preferred_channel: 'auto' })
      );

      await harness.controller.updateNotificationPreferences(
        request(),
        response()
      );
      expect(
        harness.userService.updateNotificationPreferences
      ).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ preferred_channel: 'auto' })
      );
    });

    it('logs persistence failures and returns to notification settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.updateNotificationPreferences.mockRejectedValue(
        new Error('database down')
      );
      const res = response();

      await harness.controller.updateNotificationPreferences(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'notification_preferences_update_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to update notification preferences'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });
  });

  describe('updateProfile()', () => {
    it('redirects anonymous users before reading profile input', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { firstname: { nested: 'Alice' } } }),
        res
      );

      expect(harness.userService.findById).not.toHaveBeenCalled();
      expect(harness.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('rejects structured custom identifiers before avatar side effects', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        { slot: 1, name: 'Member ID', edit_policy: 'full' },
      ]);
      const res = response();

      await harness.controller.updateProfile(
        request({
          body: { custom_identifier_1: { nested: 'not-a-string' } },
          file: { originalname: 'avatar.png' } as Express.Multer.File,
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid profile field value'
      );
      expect(harness.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(harness.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('rejects invalid identifiers before avatar side effects', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'full',
          validation_type: 'regex',
          pattern: '[A-Z]{2}\\d{2}',
          case_sensitive: false,
        },
      ]);
      const res = response();

      await harness.controller.updateProfile(
        request({
          body: { custom_identifier_1: 'invalid' },
          file: { originalname: 'avatar.png' } as Express.Multer.File,
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid Member ID format'
      );
      expect(harness.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(harness.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('uses a generic label when an unnamed identifier has invalid format', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          edit_policy: 'full',
          validation_type: 'regex',
          pattern: '[A-Z]{2}\\d{2}',
        },
      ]);
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { custom_identifier_1: 'invalid' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid identifier format'
      );
      expect(harness.userService.updateProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('normalizes whitespace-only name parts before building a display name', async () => {
      const harness = createHarness();
      const user = activeUser({ picture: undefined });
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.updateProfile.mockResolvedValue(
        databaseUser({ family_name: 'Doe', name: 'Doe' })
      );
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { firstname: '   ', lastname: ' Doe ' } }),
        res
      );

      expect(harness.userService.updateProfile).toHaveBeenCalledWith('user-1', {
        family_name: 'Doe',
        name: 'Doe',
      });
      expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            full_name: 'Doe',
          }),
        }
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Profile updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('clears the phone number when the submitted value is blank', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { phone: '   ' } }),
        res
      );

      expect(harness.userService.updateProfile).toHaveBeenCalledWith('user-1', {
        phone_number: '',
      });
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Profile updated successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('preserves case for a case-sensitive custom identifier', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'full',
          validation_type: 'regex',
          pattern: '[A-Za-z0-9]+',
          case_sensitive: true,
        },
      ]);
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { custom_identifier_1: ' Ab12 ' } }),
        res
      );

      expect(
        harness.userService.isCustomIdentifierAvailable
      ).toHaveBeenCalledWith(1, 'Ab12', 'user-1');
      expect(harness.userService.setCustomIdentifier).toHaveBeenCalledWith(
        'user-1',
        1,
        'Ab12'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Profile updated successfully'
      );
    });

    it('preserves session profile fields omitted by the persistence response', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: { ...user },
        others: [],
      });
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.updateProfile.mockResolvedValue(
        databaseUser({
          given_name: undefined,
          family_name: undefined,
          name: undefined,
          picture: undefined,
        })
      );
      const res = response();

      await harness.controller.updateProfile(request({ body: {} }), res);

      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        expect.anything(),
        'authenticatedUsers',
        expect.objectContaining({
          active: expect.objectContaining({
            given_name: 'Alice',
            family_name: 'Doe',
            full_name: 'Alice Doe',
            picture: 'avatars/alice.png',
          }),
        })
      );
    });

    it('validates all identifiers before applying profile and avatar changes', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: user,
        others: [],
      });
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'full',
          validation_type: 'regex',
          pattern: '[A-Z]{2}\\d{2}',
          case_sensitive: false,
        },
        {
          slot: 2,
          name: 'Optional ID',
          edit_policy: 'full',
          validation_type: 'none',
          case_sensitive: true,
        },
        {
          slot: 3,
          name: 'Permanent ID',
          edit_policy: 'set_once',
          validation_type: 'none',
          case_sensitive: true,
        },
      ]);
      harness.userService.getCustomIdentifier.mockImplementation(
        (_user: unknown, slot: number) => (slot === 3 ? 'existing' : undefined)
      );
      harness.userService.updateProfile.mockResolvedValue(
        databaseUser({
          given_name: 'Alice',
          family_name: 'Smith',
          name: 'Alice Smith',
          picture: 'avatars/new.png',
        })
      );
      const req = request({
        body: {
          firstname: ' Alice ',
          lastname: ' Smith ',
          phone: ' +22911111111 ',
          custom_identifier_1: ' AB12 ',
          custom_identifier_2: '   ',
          custom_identifier_3: 'replacement',
        },
        file: { originalname: 'avatar.png' } as Express.Multer.File,
      });
      const res = response();

      await harness.controller.updateProfile(req, res);

      expect(
        harness.userService.isCustomIdentifierAvailable
      ).toHaveBeenCalledWith(1, 'ab12', 'user-1');
      expect(harness.uploadMiddleware.storeFile).toHaveBeenCalledWith(
        req.file,
        'avatars'
      );
      expect(harness.uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        'avatars/alice.png'
      );
      expect(harness.userService.setCustomIdentifier).toHaveBeenCalledTimes(1);
      expect(harness.userService.setCustomIdentifier).toHaveBeenCalledWith(
        'user-1',
        1,
        'ab12'
      );
      expect(harness.userService.removeCustomIdentifier).toHaveBeenCalledWith(
        'user-1',
        2
      );
      expect(harness.userService.updateProfile).toHaveBeenCalledWith('user-1', {
        given_name: 'Alice',
        family_name: 'Smith',
        name: 'Alice Smith',
        phone_number: '+22911111111',
        picture: 'avatars/new.png',
      });
      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        req,
        'authenticatedUsers',
        expect.objectContaining({
          active: expect.objectContaining({
            full_name: 'Alice Smith',
            picture: 'avatars/new.png',
            last_used: expect.any(Number),
          }),
        })
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'profile_updated',
        expect.anything(),
        'User updated their profile',
        expect.anything()
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('ignores admin-only and omitted custom-identifier fields', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Managed ID',
          edit_policy: 'admin_only',
          validation_type: 'none',
        },
        {
          slot: 2,
          name: 'Optional ID',
          edit_policy: 'full',
          validation_type: 'none',
        },
      ]);
      const res = response();

      await harness.controller.updateProfile(
        request({
          body: { firstname: 'Alice', custom_identifier_1: 'override' },
        }),
        res
      );

      expect(harness.userService.getCustomIdentifier).not.toHaveBeenCalled();
      expect(
        harness.userService.isCustomIdentifierAvailable
      ).not.toHaveBeenCalled();
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.removeCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).toHaveBeenCalledWith('user-1', {
        given_name: 'Alice',
        name: 'Alice',
      });
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('does not remove an unset set-once identifier submitted as blank', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Permanent ID',
          edit_policy: 'set_once',
          validation_type: 'none',
          case_sensitive: true,
        },
      ]);
      harness.userService.getCustomIdentifier.mockReturnValue(undefined);

      await harness.controller.updateProfile(
        request({ body: { custom_identifier_1: '   ' } }),
        response()
      );

      expect(harness.userService.removeCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
    });

    it('stores a first avatar without trying to delete an old file', async () => {
      const harness = createHarness();
      const user = activeUser({ picture: undefined });
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: user,
        others: [],
      });
      harness.userService.findById.mockResolvedValue(databaseUser());
      const req = request({
        body: {},
        file: { originalname: 'avatar.png' } as Express.Multer.File,
      });

      await harness.controller.updateProfile(req, response());

      expect(harness.uploadMiddleware.storeFile).toHaveBeenCalledWith(
        req.file,
        'avatars'
      );
      expect(harness.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).toHaveBeenCalledWith('user-1', {
        picture: 'avatars/new.png',
      });
    });

    it('rejects duplicate custom identifiers before profile side effects', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          name: 'Member ID',
          edit_policy: 'full',
          validation_type: 'none',
          case_sensitive: false,
        },
      ]);
      harness.userService.isCustomIdentifierAvailable.mockResolvedValue(false);
      const res = response();

      await harness.controller.updateProfile(
        request({
          body: { custom_identifier_1: ' Taken-ID ' },
          file: { originalname: 'avatar.png' } as Express.Multer.File,
        }),
        res
      );

      expect(
        harness.userService.isCustomIdentifierAvailable
      ).toHaveBeenCalledWith(1, 'taken-id', 'user-1');
      expect(harness.flash.error).toHaveBeenCalledWith(
        'This Member ID is already in use'
      );
      expect(harness.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('uses a generic label when an unnamed identifier is already in use', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.getCustomIdentifierFields.mockReturnValue([
        {
          slot: 1,
          edit_policy: 'full',
          validation_type: 'regex',
          pattern: '[A-Za-z0-9-]+',
        },
      ]);
      harness.userService.isCustomIdentifierAvailable.mockResolvedValue(false);
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { custom_identifier_1: 'taken-id' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'This identifier is already in use'
      );
      expect(harness.userService.setCustomIdentifier).not.toHaveBeenCalled();
      expect(harness.userService.updateProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });

    it('rejects invalid top-level fields and missing database users before uploads', async () => {
      const invalid = createHarness();
      invalid.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const invalidRes = response();
      await invalid.controller.updateProfile(
        request({
          body: { phone: ['not', 'a', 'string'] },
          file: { originalname: 'avatar.png' } as Express.Multer.File,
        }),
        invalidRes
      );
      expect(invalid.flash.error).toHaveBeenCalledWith(
        'Invalid profile field value'
      );
      expect(invalid.uploadMiddleware.storeFile).not.toHaveBeenCalled();

      const missing = createHarness();
      missing.sessionManager.getActiveUser.mockReturnValue(activeUser());
      missing.userService.findById.mockResolvedValue(null);
      const missingRes = response();
      await missing.controller.updateProfile(
        request({
          file: { originalname: 'avatar.png' } as Express.Multer.File,
        }),
        missingRes
      );
      expect(missing.flash.error).toHaveBeenCalledWith('User not found');
      expect(missing.uploadMiddleware.storeFile).not.toHaveBeenCalled();
      expect(missingRes.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('reports profile persistence failures and returns to settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(databaseUser());
      harness.userService.updateProfile.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.updateProfile(
        request({ body: { firstname: 'Alice' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'profile_update_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to update profile. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/profile');
    });
  });

  describe('changePassword()', () => {
    it('rejects structured password fields before credential lookups', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: ['not-a-string'],
            confirmPassword: 'new-password',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid password field value'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.validatePassword).not.toHaveBeenCalled();
      expect(harness.userService.changePassword).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('guards anonymous, deleted, and recovery-cooldown accounts', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.changePassword(request(), anonymousRes);
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');

      const deleted = createHarness();
      deleted.sessionManager.getActiveUser.mockReturnValue(activeUser());
      deleted.userService.findByUsername.mockResolvedValue(null);
      const deletedRes = response();
      await deleted.controller.changePassword(
        request({
          body: {
            currentPassword: 'old',
            newPassword: 'new',
            confirmPassword: 'new',
          },
        }),
        deletedRes
      );
      expect(deleted.flash.error).toHaveBeenCalledWith('User not found');

      const cooldown = createHarness();
      cooldown.sessionManager.getActiveUser.mockReturnValue(activeUser());
      cooldown.userService.findByUsername.mockResolvedValue(databaseUser());
      cooldown.recoveryUtils.checkRecoveryCooldown.mockReturnValue({
        inCooldown: true,
        hoursRemaining: 7,
      });
      const cooldownRes = response();
      await cooldown.controller.changePassword(
        request({
          body: {
            currentPassword: 'old',
            newPassword: 'new',
            confirmPassword: 'new',
          },
        }),
        cooldownRes
      );
      expect(cooldown.flash.error).toHaveBeenCalledWith(
        'For security, password changes are restricted for 7 hour(s) after account recovery.'
      );
      expect(cooldown.userService.changePassword).not.toHaveBeenCalled();
      expect(cooldownRes.redirect).toHaveBeenCalledWith(
        '/accounts/settings/security'
      );
    });

    it('rejects missing, mismatched, and policy-invalid password submissions', async () => {
      const missing = createHarness();
      missing.sessionManager.getActiveUser.mockReturnValue(activeUser());
      missing.userService.findByUsername.mockResolvedValue(databaseUser());
      const missingRes = response();
      await missing.controller.changePassword(
        request({ body: { newPassword: 'new', confirmPassword: 'new' } }),
        missingRes
      );
      expect(missing.flash.error).toHaveBeenCalledWith(
        'All password fields are required'
      );

      const mismatched = createHarness();
      mismatched.sessionManager.getActiveUser.mockReturnValue(activeUser());
      mismatched.userService.findByUsername.mockResolvedValue(databaseUser());
      const mismatchedRes = response();
      await mismatched.controller.changePassword(
        request({
          body: {
            currentPassword: 'old',
            newPassword: 'new-one',
            confirmPassword: 'new-two',
          },
        }),
        mismatchedRes
      );
      expect(mismatched.flash.error).toHaveBeenCalledWith(
        'New password and confirmation do not match'
      );

      const invalid = createHarness();
      invalid.sessionManager.getActiveUser.mockReturnValue(activeUser());
      invalid.userService.findByUsername.mockResolvedValue(databaseUser());
      invalid.userService.validatePassword.mockReturnValue({
        isValid: false,
        messages: ['too short', 'missing number'],
      });
      const invalidRes = response();
      await invalid.controller.changePassword(
        request({
          body: {
            currentPassword: 'old',
            newPassword: 'weak',
            confirmPassword: 'weak',
          },
        }),
        invalidRes
      );
      expect(invalid.flash.error).toHaveBeenCalledWith(
        'Password requirements not met: too short, missing number'
      );
      expect(invalid.userService.changePassword).not.toHaveBeenCalled();
    });

    it('allows a passwordless single-provider account to set a password', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ password: '' })
      );
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'google' },
      ]);
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            newPassword: 'new-password',
            confirmPassword: 'new-password',
          },
        }),
        res
      );

      expect(harness.userService.changePassword).toHaveBeenCalledWith(
        'user-1',
        { currentPassword: undefined, newPassword: 'new-password' }
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('requires both new-password fields for a passwordless account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ password: '' })
      );
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'google' },
      ]);
      const res = response();

      await harness.controller.changePassword(
        request({ body: { newPassword: 'new-password' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'New password and confirmation are required'
      );
      expect(harness.userService.changePassword).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('rejects a password whose breach count meets the configured threshold', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.config.security.authentication.password_breach_detection = {
        enabled: true,
        check_on_password_change: true,
        min_breach_count: 10,
        api_timeout_ms: 1_000,
      };
      passwordBreachMocks.check.mockResolvedValue({
        breached: true,
        count: 42,
      });
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'breached-password',
            confirmPassword: 'breached-password',
          },
        }),
        res
      );

      expect(passwordBreachMocks.check).toHaveBeenCalledWith(
        'breached-password',
        1_000
      );
      expect(harness.flash.error).toHaveBeenCalledWith(
        'This password has appeared in 42 known data breaches and cannot be used. Please choose a different password.'
      );
      expect(harness.userService.changePassword).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('uses one breach as the default password rejection threshold', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.config.security.authentication.password_breach_detection = {
        enabled: true,
        check_on_password_change: true,
      };
      passwordBreachMocks.check.mockResolvedValue({
        breached: true,
        count: 1,
      });
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'breached-password',
            confirmPassword: 'breached-password',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'This password has appeared in 1 known data breach and cannot be used. Please choose a different password.'
      );
      expect(harness.userService.changePassword).not.toHaveBeenCalled();
    });

    it('surfaces breach-policy errors and does not change the password', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.config.security.authentication.password_breach_detection = {
        enabled: true,
        check_on_password_change: true,
      };
      passwordBreachMocks.check.mockRejectedValue(
        new Error('This password was found in known data breaches')
      );
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'breached-password',
            confirmPassword: 'breached-password',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'This password was found in known data breaches'
      );
      expect(harness.userService.changePassword).not.toHaveBeenCalled();
      expect(harness.logger.warn).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('allows a password change when the breach service is unavailable', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.config.security.authentication.password_breach_detection = {
        enabled: true,
        check_on_password_change: true,
      };
      passwordBreachMocks.check.mockRejectedValue(
        new Error('breach service unavailable')
      );
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'new-password',
            confirmPassword: 'new-password',
          },
        }),
        res
      );

      expect(harness.logger.warn).toHaveBeenCalledWith(
        'Password breach check failed during password change (allowing change)',
        { error: 'breach service unavailable' }
      );
      expect(harness.userService.changePassword).toHaveBeenCalledWith(
        'user-1',
        {
          currentPassword: 'old-password',
          newPassword: 'new-password',
        }
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
    });

    it('allows a breached password whose count is below the configured threshold', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.config.security.authentication.password_breach_detection = {
        enabled: true,
        check_on_password_change: true,
        min_breach_count: 10,
      };
      passwordBreachMocks.check.mockResolvedValue({
        breached: true,
        count: 9,
      });
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'low-count-password',
            confirmPassword: 'low-count-password',
          },
        }),
        res
      );

      expect(harness.userService.changePassword).toHaveBeenCalledWith(
        'user-1',
        {
          currentPassword: 'old-password',
          newPassword: 'low-count-password',
        }
      );
      expect(harness.flash.error).not.toHaveBeenCalledWith(
        expect.stringContaining('known data breaches')
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
    });

    it('changes a password, revokes other sessions, regenerates, audits, and notifies', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(2);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        { _id: 'current-express-session' },
        { _id: 'other-express-session' },
      ]);
      const req = request({
        body: {
          currentPassword: 'old-password',
          newPassword: 'new-password',
          confirmPassword: 'new-password',
        },
        session: { id: 'current-session' } as Request['session'],
        sessionID: 'current-express-session',
      });
      const res = response();

      await harness.controller.changePassword(req, res);

      expect(harness.userService.changePassword).toHaveBeenCalledWith(
        'user-1',
        {
          currentPassword: 'old-password',
          newPassword: 'new-password',
        }
      );
      expect(
        harness.oidcAdapter.session.revokeAllSessionsExcept
      ).toHaveBeenCalledWith('alice', 'current-session');
      expect(
        harness.sessionManager.findExpressSessionsForUser
      ).toHaveBeenCalledWith('alice');
      expect(
        harness.sessionManager.revokeExpressSession
      ).toHaveBeenCalledOnce();
      expect(harness.sessionManager.revokeExpressSession).toHaveBeenCalledWith(
        'other-express-session'
      );
      expect(harness.sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(activityMocks.success).toHaveBeenCalledWith(
        'password_changed',
        null,
        'User changed their password',
        expect.anything()
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'sessions_revoked_password_change',
        null,
        'Revoked 3 other sessions after password change',
        expect.anything()
      );
      expect(
        harness.notificationService.sendTemplatedEmail
      ).toHaveBeenCalledWith(
        'alice@example.test',
        'Your Parako password has been changed',
        'email/mail.njk',
        expect.objectContaining({ username: 'Alice Doe' })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('regenerates the current session without a revocation audit when no other session exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(0);
      const req = request({
        body: {
          currentPassword: 'old-password',
          newPassword: 'new-password',
          confirmPassword: 'new-password',
        },
        session: { id: 'current-session' } as Request['session'],
      });
      const res = response();

      await harness.controller.changePassword(req, res);

      expect(harness.sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(activityMocks.info).not.toHaveBeenCalledWith(
        'sessions_revoked_password_change',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
    });

    it('uses the English locale for an unsupported notification locale', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({ locale: 'unsupported-locale' })
      );
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const localeSpy = vi
        .spyOn(Date.prototype, 'toLocaleString')
        .mockReturnValue('localized timestamp');
      const res = response();

      try {
        await harness.controller.changePassword(
          request({
            body: {
              currentPassword: 'old-password',
              newPassword: 'new-password',
              confirmPassword: 'new-password',
            },
          }),
          res
        );

        expect(localeSpy).toHaveBeenCalledWith(
          'en-US',
          expect.objectContaining({
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        );
      } finally {
        localeSpy.mockRestore();
      }
    });

    it('uses the English locale when no notification locale is stored', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({ locale: undefined })
      );
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const localeSpy = vi
        .spyOn(Date.prototype, 'toLocaleString')
        .mockReturnValue('localized timestamp');
      const res = response();

      try {
        await harness.controller.changePassword(
          request({
            body: {
              currentPassword: 'old-password',
              newPassword: 'new-password',
              confirmPassword: 'new-password',
            },
          }),
          res
        );

        expect(localeSpy).toHaveBeenCalledWith(
          'en-US',
          expect.objectContaining({
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        );
      } finally {
        localeSpy.mockRestore();
      }
    });

    it('builds a safe password notification when profile and request metadata are sparse', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({
          given_name: undefined,
          family_name: undefined,
          locale: 'en',
          zoneinfo: undefined,
        })
      );
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const localeSpy = vi
        .spyOn(Date.prototype, 'toLocaleString')
        .mockReturnValue('localized timestamp');
      const res = response();

      try {
        await harness.controller.changePassword(
          request({
            body: {
              currentPassword: 'old-password',
              newPassword: 'new-password',
              confirmPassword: 'new-password',
            },
            get: vi.fn().mockReturnValue(undefined),
            ip: undefined,
            socket: {} as Request['socket'],
          }),
          res
        );

        expect(localeSpy).toHaveBeenCalledWith(
          'en-US',
          expect.objectContaining({ timeZone: 'UTC' })
        );
        expect(
          harness.notificationService.sendTemplatedEmail
        ).toHaveBeenCalledWith(
          'alice@example.test',
          'Your Parako password has been changed',
          'email/mail.njk',
          expect.objectContaining({
            content: expect.stringMatching(
              /Hello alice@example\.test,[\s\S]*IP Address:<\/strong> Unknown[\s\S]*Browser:<\/strong> Unknown/
            ),
            username: '',
          })
        );
      } finally {
        localeSpy.mockRestore();
      }
    });

    it('keeps a password changed when session revocation fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockRejectedValue(
        new Error('session store unavailable')
      );
      const req = request({
        body: {
          currentPassword: 'old-password',
          newPassword: 'new-password',
          confirmPassword: 'new-password',
        },
        session: { id: 'current-session' } as Request['session'],
      });
      const res = response();

      await harness.controller.changePassword(req, res);

      expect(harness.userService.changePassword).toHaveBeenCalled();
      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Failed to revoke sessions after password change',
        username: 'alice',
      });
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('keeps a password changed when its notification email fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendTemplatedEmail.mockRejectedValue(
        new Error('email unavailable')
      );
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'new-password',
            confirmPassword: 'new-password',
          },
        }),
        res
      );

      expect(harness.userService.changePassword).toHaveBeenCalled();
      expect(harness.logger.error).toHaveBeenCalledWith(
        'Failed to send password change notification email',
        expect.objectContaining({
          username: 'alice',
          error: expect.any(Error),
        })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Password changed successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('does not claim that a password notification was sent when delivery returns a failure result', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendTemplatedEmail.mockResolvedValue({
        success: false,
        channel: 'email',
        error: 'email server unavailable',
      });

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'new-password',
            confirmPassword: 'new-password',
          },
        }),
        response()
      );

      expect(harness.logger.info).not.toHaveBeenCalledWith(
        'Password change notification email sent',
        expect.anything()
      );
      expect(harness.logger.warn).toHaveBeenCalledWith(
        'Password change notification email was not delivered',
        {
          username: 'alice',
          email: 'alice@example.test',
          error: 'email server unavailable',
        }
      );
    });

    it('reports password persistence failures without claiming success', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.userService.changePassword.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.changePassword(
        request({
          body: {
            currentPassword: 'old-password',
            newPassword: 'new-password',
            confirmPassword: 'new-password',
          },
        }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'password_change_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to change password. Please try again.'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });
  });

  describe('removeAvatar()', () => {
    it('rejects anonymous avatar removal before persistence', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.removeAvatar(request(), res);

      expect(harness.userService.removeAvatar).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    });

    it('does not delete the stored avatar when persistence fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.removeAvatar.mockRejectedValue(
        new Error('database down')
      );
      const res = response();

      await harness.controller.removeAvatar(request(), res);

      expect(harness.userService.removeAvatar).toHaveBeenCalledWith('user-1');
      expect(harness.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      expect(harness.sessionManager.set).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to remove avatar',
      });
    });

    it('keeps the successful account update when obsolete-file cleanup fails', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: user,
        others: [],
      });
      harness.uploadMiddleware.deleteFile.mockRejectedValue(
        new Error('storage unavailable')
      );
      const req = request();
      const res = response();

      await harness.controller.removeAvatar(req, res);

      expect(harness.userService.removeAvatar).toHaveBeenCalledWith('user-1');
      expect(harness.uploadMiddleware.deleteFile).toHaveBeenCalledWith(
        'avatars/alice.png'
      );
      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        req,
        'authenticatedUsers',
        expect.objectContaining({
          active: expect.objectContaining({ picture: '' }),
        })
      );
      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'avatar_file_cleanup_failed',
        username: 'alice',
      });
      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Avatar removed successfully',
      });
    });

    it('does not request file cleanup when the account has no stored avatar', async () => {
      const harness = createHarness();
      const user = activeUser({ picture: undefined });
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: user,
        others: [],
      });
      const res = response();

      await harness.controller.removeAvatar(request(), res);

      expect(harness.userService.removeAvatar).toHaveBeenCalledWith('user-1');
      expect(harness.uploadMiddleware.deleteFile).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Avatar removed successfully',
      });
    });

    it('refreshes the legacy single-account session after avatar removal', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue(null);
      const req = request();
      const res = response();

      await harness.controller.removeAvatar(req, res);

      expect(harness.sessionManager.set).not.toHaveBeenCalled();
      expect(harness.sessionManager.setAuthenticated).toHaveBeenCalledWith(
        req,
        {
          currentActiveLoggedUser: expect.objectContaining({
            id: 'user-1',
            picture: '',
            last_used: expect.any(Number),
          }),
        }
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Avatar removed successfully',
      });
    });
  });

  describe('verifySetupMfa()', () => {
    it('checks authentication before reading an untrusted code value', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: { nested: 'value' } } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.flash.error).not.toHaveBeenCalledWith(
        'Failed to enable 2FA'
      );
      expect(harness.userService.verifyTotpSetupCode).not.toHaveBeenCalled();
    });

    it('stops verification when MFA is disabled by configuration', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.mfaUtils.getMfaConfig.mockReturnValue({ enabled: false });
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Two-factor authentication is not available.'
      );
      expect(harness.userService.verifyTotpSetupCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('rejects a structured MFA method before verifying any code', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' }, query: { method: ['email'] } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'This authentication method is not available.'
      );
      expect(
        harness.userService.verifyEmailMfaSetupCode
      ).not.toHaveBeenCalled();
      expect(harness.userService.verifyTotpSetupCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it.each([undefined, '', '   ', ['123456'], { code: '123456' }])(
      'rejects an invalid verification code without calling the service: %p',
      async code => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        const res = response();

        await harness.controller.verifySetupMfa(
          request({ body: { code }, query: { method: 'totp' } }),
          res
        );

        expect(harness.flash.error).toHaveBeenCalledWith(
          'Invalid code, please try again'
        );
        expect(res.redirect).toHaveBeenCalledWith(
          '/accounts/settings/mfa/setup'
        );
        expect(harness.userService.verifyTotpSetupCode).not.toHaveBeenCalled();
        expect(harness.userService.enableMfaTotp).not.toHaveBeenCalled();
      }
    );

    it('returns a missing email code to the email setup page', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: {}, query: { method: 'email' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid code, please try again'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/mfa/setup?method=email'
      );
      expect(
        harness.userService.verifyEmailMfaSetupCode
      ).not.toHaveBeenCalled();
    });

    it('rejects an invalid email setup code without enabling email MFA', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.verifyEmailMfaSetupCode.mockResolvedValue(false);
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' }, query: { method: 'email' } }),
        res
      );

      expect(harness.userService.verifyEmailMfaSetupCode).toHaveBeenCalledWith(
        'alice',
        '123456'
      );
      expect(harness.userService.enableMfaEmail).not.toHaveBeenCalled();
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid code, please try again'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/mfa/setup?method=email'
      );
    });

    it('rejects an invalid TOTP setup code without enabling TOTP MFA', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.verifyTotpSetupCode.mockResolvedValue(false);
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.verifyTotpSetupCode).toHaveBeenCalledWith(
        'alice',
        '654321'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.enableMfaTotp).not.toHaveBeenCalled();
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid code, please try again'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/mfa/setup');
    });

    it('does not enable TOTP when the user disappears after code verification', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.verifyTotpSetupCode).toHaveBeenCalledWith(
        'alice',
        '654321'
      );
      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(harness.userService.enableMfaTotp).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/mfa/setup');
    });

    it('does not enable TOTP when the pending setup secret is missing', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.mfaUtils.getUserTotpSecret.mockReturnValue(null);
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('TOTP secret not found');
      expect(harness.userService.enableMfaTotp).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/mfa/setup');
    });

    it('preserves existing recovery methods when email MFA creates backup codes', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const securityQuestions = {
        questions: [
          {
            id: 'question-1',
            question_key: 'first_pet',
            answer_hash: 'answer-hash',
          },
        ],
      };
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['security_questions'],
            security_questions: securityQuestions,
          },
        })
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: ' 123456 ' }, query: { method: 'email' } }),
        res
      );

      expect(harness.userService.verifyEmailMfaSetupCode).toHaveBeenCalledWith(
        'alice',
        '123456'
      );
      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: expect.objectContaining({
          enabled: true,
          methods: ['security_questions', 'backup_codes'],
          security_questions: securityQuestions,
          backup_codes: expect.objectContaining({
            codes: ['hashed-recovery-1'],
          }),
        }),
      });
      expect(res.render).toHaveBeenCalledWith(
        'auth/recovery-codes-display',
        expect.objectContaining({ backup_codes: ['recovery-1'] })
      );
    });

    it('does not regenerate existing backup codes after enabling email MFA', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: { codes: ['existing-hash'] },
          },
        })
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' }, query: { method: 'email' } }),
        res
      );

      expect(harness.userService.enableMfaEmail).toHaveBeenCalledWith('alice');
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('preserves existing recovery methods when TOTP MFA creates backup codes', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const secondaryEmail = {
        email: 'recovery@example.test',
        verified: true,
      };
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: secondaryEmail,
          },
        })
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.enableMfaTotp).toHaveBeenCalledWith(
        'alice',
        'totp-secret'
      );
      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: expect.objectContaining({
          enabled: true,
          methods: ['secondary_email', 'backup_codes'],
          secondary_email: secondaryEmail,
          backup_codes: expect.objectContaining({
            codes: ['hashed-recovery-1'],
          }),
        }),
      });
    });

    it('does not regenerate existing backup codes after enabling TOTP MFA', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: { codes: ['existing-hash'] },
          },
        })
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.enableMfaTotp).toHaveBeenCalledWith(
        'alice',
        'totp-secret'
      );
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('keeps email MFA enabled when its security notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' }, query: { method: 'email' } }),
        res
      );

      expect(harness.userService.enableMfaEmail).toHaveBeenCalledWith('alice');
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Email-based 2FA enabled successfully'
      );
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'mfa_enabled_notification_failed',
        })
      );
    });

    it('keeps TOTP MFA enabled when its security notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '654321' }, query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.enableMfaTotp).toHaveBeenCalledWith(
        'alice',
        'totp-secret'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Two-factor authentication enabled'
      );
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'mfa_enabled_notification_failed',
        })
      );
    });

    it('reports MFA verification persistence failures without claiming success', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.enableMfaEmail.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.verifySetupMfa(
        request({ body: { code: '123456' }, query: { method: 'email' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'verify_setup_mfa_error',
      });
      expect(harness.flash.error).toHaveBeenCalledWith('Failed to enable 2FA');
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });
  });

  describe('disableMfa()', () => {
    it('redirects anonymous users before disabling MFA', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.disableMfa(request(), res);

      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.disableMfa).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it.each(['', 'push', ['totp'], { method: 'email' }])(
      'rejects an explicit unsupported method without disabling all MFA: %p',
      async method => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.userService.findByUsername.mockResolvedValue(databaseUser());
        const res = response();

        await harness.controller.disableMfa(
          request({ query: { method } }),
          res
        );

        expect(harness.flash.error).toHaveBeenCalledWith(
          'This authentication method is not available.'
        );
        expect(harness.userService.disableMfa).not.toHaveBeenCalled();
        expect(
          harness.notificationService.sendSecurityAlert
        ).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          '/accounts/settings/security'
        );
      }
    );

    it('blocks changes during the post-recovery cooldown', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.checkRecoveryCooldown.mockReturnValue({
        inCooldown: true,
        hoursRemaining: 4,
      });
      const res = response();

      await harness.controller.disableMfa(
        request({ query: { method: 'totp' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'For security, MFA changes are restricted for 4 hour(s) after account recovery.'
      );
      expect(harness.userService.disableMfa).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('disables MFA when the session user has no current database record', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.disableMfa(
        request({ query: { method: 'totp' } }),
        res
      );

      expect(
        harness.recoveryUtils.checkRecoveryCooldown
      ).not.toHaveBeenCalled();
      expect(harness.userService.disableMfa).toHaveBeenCalledWith(
        'alice',
        'totp'
      );
    });

    it.each([
      ['totp', 'Authenticator App'],
      ['email', 'Email'],
      ['webauthn', 'Passkey'],
    ] as const)('disables the selected %s method', async (method, label) => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.disableMfa(request({ query: { method } }), res);

      expect(harness.userService.disableMfa).toHaveBeenCalledWith(
        'alice',
        method
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'mfa_disabled',
        null,
        `User disabled ${method} MFA`,
        expect.objectContaining({ metadata: { method } })
      );
      expect(
        harness.notificationService.sendSecurityAlert
      ).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice' }),
        'mfa_disabled',
        expect.objectContaining({ method })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        `${label} MFA disabled.`
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('disables all methods only when no method was supplied', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.disableMfa(request(), res);

      expect(harness.userService.disableMfa).toHaveBeenCalledWith(
        'alice',
        undefined
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Two-factor authentication disabled.'
      );
    });

    it('keeps MFA disabled when its security notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.disableMfa(
        request({ query: { method: 'totp' } }),
        res
      );

      expect(harness.userService.disableMfa).toHaveBeenCalledWith(
        'alice',
        'totp'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Authenticator App MFA disabled.'
      );
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'mfa_disabled_notification_failed',
        })
      );
    });

    it('reports MFA-disable persistence failures without claiming success', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.userService.disableMfa.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.disableMfa(
        request({ query: { method: 'totp' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'disable_mfa_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to disable MFA.'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });
  });

  describe('enableMfa()', () => {
    it('guards anonymous users and disabled MFA configuration', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.enableMfa(request(), anonymousRes);
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');

      const disabled = createHarness();
      disabled.sessionManager.getActiveUser.mockReturnValue(activeUser());
      disabled.mfaUtils.getMfaConfig.mockReturnValue({ enabled: false });
      const disabledRes = response();
      await disabled.controller.enableMfa(request(), disabledRes);
      expect(disabled.flash.error).toHaveBeenCalledWith(
        'Two-factor authentication is not available.'
      );
      expect(disabled.userService.initiateMfaTotpSetup).not.toHaveBeenCalled();
      expect(disabledRes.redirect).toHaveBeenCalledWith(
        '/accounts/settings/security'
      );
    });

    it('starts email enrollment and sends the verification code', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const req = request({ query: { method: 'email' } });
      const res = response();

      await harness.controller.enableMfa(req, res);

      expect(harness.userService.initiateEmailMfaSetup).toHaveBeenCalledWith(
        'alice',
        600
      );
      expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.test' }),
        '123456',
        { deviceInfo: 'vitest', ip: '127.0.0.1' }
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'email_mfa_setup_initiated',
        null,
        'User initiated email MFA setup',
        expect.anything()
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/mfa/setup?method=email'
      );
    });

    it('uses safe fallback metadata when email enrollment has no device details', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.clientDeviceInfoManager.getClientInfoFromRequest.mockReturnValue({
        user_agent: '',
        ip: '',
      });
      const res = response();

      await harness.controller.enableMfa(
        request({ query: { method: 'email' } }),
        res
      );

      expect(harness.notificationService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.test' }),
        '123456',
        { deviceInfo: 'Unknown Device', ip: 'unknown' }
      );
    });

    it('starts TOTP enrollment with a freshly generated secret', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.enableMfa(request(), res);

      expect(harness.mfaUtils.generateTotpSecret).toHaveBeenCalledOnce();
      expect(harness.userService.initiateMfaTotpSetup).toHaveBeenCalledWith(
        'alice',
        'totp-secret'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/mfa/setup');
    });

    it('reports MFA enrollment failures and returns to security settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.initiateMfaTotpSetup.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.enableMfa(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'enable_mfa_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith('Failed to enable 2FA.');
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });
  });

  describe('setupMfaPage()', () => {
    it('redirects anonymous users before reading MFA configuration', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.mfaUtils.getMfaConfig).not.toHaveBeenCalled();
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('stops setup when MFA is disabled by configuration', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.mfaUtils.getMfaConfig.mockReturnValue({ enabled: false });
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Two-factor authentication is not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('returns to security settings when the authenticated user no longer exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.userService.findByUsername).toHaveBeenCalledWith('alice');
      expect(harness.mfaUtils.isTotpPendingSetup).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('renders a pending email setup with a masked address', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.setupMfaPage(
        request({ query: { method: 'email' } }),
        res
      );

      expect(harness.mfaUtils.maskEmail).toHaveBeenCalledWith(
        'alice@example.test'
      );
      expect(res.render).toHaveBeenCalledWith('auth/setup-mfa', {
        title: 'Verify Your Email',
        method: 'email',
        maskedEmail: 'a***@example.test',
        cancelUrl: '/accounts/settings/security',
      });
      expect(res.set).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );
      expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
    });

    it('masks the active session email when the database email is absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ email: undefined })
      );
      const res = response();

      await harness.controller.setupMfaPage(
        request({ query: { method: 'email' } }),
        res
      );

      expect(harness.mfaUtils.maskEmail).toHaveBeenCalledWith(
        'alice@example.test'
      );
    });

    it('uses an empty email value when no MFA setup address is available', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({ email: undefined })
      );
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ email: undefined })
      );
      const res = response();

      await harness.controller.setupMfaPage(
        request({ query: { method: 'email' } }),
        res
      );

      expect(harness.mfaUtils.maskEmail).toHaveBeenCalledWith('');
    });

    it('does not render an email setup that is no longer pending', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.mfaUtils.isEmailMfaPendingSetup.mockReturnValue(false);
      const res = response();

      await harness.controller.setupMfaPage(
        request({ query: { method: 'email' } }),
        res
      );

      expect(harness.mfaUtils.maskEmail).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('renders a pending TOTP setup as a QR code', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.mfaUtils.generateTotpUri).toHaveBeenCalledWith(
        'alice@example.test',
        'totp-secret',
        'Parako.ID'
      );
      expect(harness.mfaUtils.generateQrCode).toHaveBeenCalledWith(
        'otpauth://totp/Parako'
      );
      expect(res.render).toHaveBeenCalledWith('auth/setup-mfa', {
        title: 'Setup 2FA',
        method: 'totp',
        qrDataUri: 'data:image/png;base64,qr',
        totpSecret: 'totp-secret',
        cancelUrl: '/accounts/settings/security',
      });
      expect(res.set).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );
      expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
    });

    it('uses the username as the TOTP label when email is absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ email: undefined })
      );
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.mfaUtils.generateTotpUri).toHaveBeenCalledWith(
        'alice',
        'totp-secret',
        'Parako.ID'
      );
    });

    it('redirects when the requested setup is no longer pending', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.mfaUtils.isTotpPendingSetup.mockReturnValue(false);
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.mfaUtils.generateQrCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('does not render a pending TOTP setup without a stored secret', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.mfaUtils.getUserTotpSecret.mockReturnValue(null);
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.mfaUtils.generateTotpUri).not.toHaveBeenCalled();
      expect(harness.mfaUtils.generateQrCode).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });

    it('logs setup-page dependency failures and returns to security settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.setupMfaPage(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'setup_mfa_page_error',
      });
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/security');
    });
  });

  describe('MFA enrollment method routing', () => {
    it.each([
      ['enableMfa', {}],
      ['setupMfaPage', { findUser: true }],
      ['verifySetupMfa', { code: '123456' }],
    ] as const)(
      '%s does not route a supported WebAuthn method into the TOTP flow',
      async (method, options) => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.mfaUtils.isMethodSupported.mockReturnValue(true);
        if ('findUser' in options) {
          harness.userService.findByUsername.mockResolvedValue(databaseUser());
        }
        const res = response();

        await harness.controller[method](
          request({
            body: 'code' in options ? { code: options.code } : {},
            query: { method: 'webauthn' },
          }),
          res
        );

        expect(harness.flash.error).toHaveBeenCalledWith(
          'This authentication method is not available.'
        );
        expect(harness.userService.initiateMfaTotpSetup).not.toHaveBeenCalled();
        expect(harness.userService.verifyTotpSetupCode).not.toHaveBeenCalled();
        expect(harness.mfaUtils.generateQrCode).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          '/accounts/settings/security'
        );
      }
    );
  });

  describe('passkey pages', () => {
    it.each(['passkeysPage', 'setupWebAuthnPage'] as const)(
      '%s guards anonymous users',
      async method => {
        const harness = createHarness();
        const res = response();

        await harness.controller[method](request(), res);

        expect(res.redirect).toHaveBeenCalledWith('/auth/login');
        expect(harness.webauthnService.isEnabled).not.toHaveBeenCalled();
      }
    );

    it.each(['passkeysPage', 'setupWebAuthnPage'] as const)(
      '%s rejects disabled MFA and WebAuthn features',
      async method => {
        const mfaDisabled = createHarness();
        mfaDisabled.sessionManager.getActiveUser.mockReturnValue(activeUser());
        mfaDisabled.mfaUtils.getMfaConfig.mockReturnValue({ enabled: false });
        const mfaRes = response();
        await mfaDisabled.controller[method](request(), mfaRes);
        expect(mfaDisabled.flash.error).toHaveBeenCalledWith(
          'Two-factor authentication is not available.'
        );
        expect(mfaDisabled.webauthnService.isEnabled).not.toHaveBeenCalled();

        const webauthnDisabled = createHarness();
        webauthnDisabled.sessionManager.getActiveUser.mockReturnValue(
          activeUser()
        );
        webauthnDisabled.webauthnService.isEnabled.mockReturnValue(false);
        const webauthnRes = response();
        await webauthnDisabled.controller[method](request(), webauthnRes);
        expect(webauthnDisabled.flash.error).toHaveBeenCalledWith(
          'Passkeys are not enabled on this server.'
        );
        expect(webauthnRes.redirect).toHaveBeenCalledWith(
          '/accounts/settings/security'
        );
      }
    );

    it('renders the passkey list and setup pages when enabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const listRes = response();
      const setupRes = response();

      await harness.controller.passkeysPage(request(), listRes);
      await harness.controller.setupWebAuthnPage(request(), setupRes);

      expect(listRes.render).toHaveBeenCalledWith('accounts/passkeys', {
        title: 'Passkeys',
      });
      expect(setupRes.render).toHaveBeenCalledWith('auth/setup-webauthn', {
        title: 'Setup Passkey',
        cancelUrl: '/accounts/settings/security',
      });
    });

    it.each([
      ['passkeysPage', 'passkeys_page_error'],
      ['setupWebAuthnPage', 'setup_webauthn_page_error'],
    ] as const)(
      '%s contains feature-configuration failures',
      async (method, context) => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.mfaUtils.getMfaConfig.mockImplementation(() => {
          throw new Error('configuration unavailable');
        });
        const res = response();

        await harness.controller[method](request(), res);

        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context,
        });
        expect(res.render).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          '/accounts/settings/security'
        );
      }
    );
  });

  describe('apps()', () => {
    it('guards anonymous users and renders an empty grant state', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();
      await anonymous.controller.apps(request(), anonymousRes);
      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');
      expect(
        anonymous.oidcAdapter.grant.findGrantsByAccountId
      ).not.toHaveBeenCalled();

      const empty = createHarness();
      empty.sessionManager.getActiveUser.mockReturnValue(activeUser());
      empty.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([]);
      const emptyRes = response();
      await empty.controller.apps(request(), emptyRes);
      expect(emptyRes.render).toHaveBeenCalledWith('accounts/apps', {
        title: 'Connected Applications',
        connectedApps: [],
      });
    });

    it('ignores corrupted grants instead of exposing invalid client IDs', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: null },
        { payload: { clientId: { unexpected: true } } },
        { payload: { clientId: '' } },
      ]);
      const res = response();

      await harness.controller.apps(request(), res);

      expect(harness.oidcAdapter.client.findClientById).not.toHaveBeenCalled();
      expect(harness.flash.error).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith('accounts/apps', {
        title: 'Connected Applications',
        connectedApps: [],
      });
    });

    it('groups grants, merges scopes, and resolves registered client metadata', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
          {
            payload: {
              clientId: 'client-1',
              iat: Date.parse('2026-08-05T11:00:00.000Z') / 1000,
              openid: { scope: 'openid profile' },
            },
          },
          {
            payload: {
              clientId: 'client-1',
              iat: Date.parse('2026-08-03T12:00:00.000Z') / 1000,
              openid: { scope: 'profile email' },
              resources: { 'https://api.example.test': 'read write' },
            },
          },
        ]);
        harness.oidcAdapter.client.findClientById.mockResolvedValue({
          client_id: 'client-1',
          client_name: 'Demo RP',
          client_uri: 'https://developer.example.test/product',
          logo_uri: 'https://developer.example.test/logo.svg',
        });
        const res = response();

        await harness.controller.apps(request(), res);

        expect(res.render).toHaveBeenCalledWith('accounts/apps', {
          title: 'Connected Applications',
          connectedApps: [
            expect.objectContaining({
              id: 'client-1',
              name: 'Demo RP',
              developer: 'developer.example.test',
              logo: 'https://developer.example.test/logo.svg',
              last_used: '1 hour ago',
              approved_on: expect.any(String),
              scopes: ['openid', 'profile', 'email', 'read', 'write'],
            }),
          ],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores blank and non-string scopes in persisted grants', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        {
          payload: {
            clientId: 'client-1',
            openid: { scope: 'openid   profile ' },
            resources: {
              valid: 'read  write ',
              blank: '   ',
              numeric: 42,
              missing: null,
            },
          },
        },
      ]);
      harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
      harness.oidcAdapter.client.find.mockResolvedValue(null);
      const res = response();

      await harness.controller.apps(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/apps',
        expect.objectContaining({
          connectedApps: [
            expect.objectContaining({
              scopes: ['openid', 'profile', 'read', 'write'],
            }),
          ],
        })
      );
    });

    it('formats approval dates in UTC when the account has no timezone', async () => {
      const dateSpy = vi
        .spyOn(Date.prototype, 'toLocaleDateString')
        .mockReturnValue('UTC approval date');
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(
          activeUser({ zoneinfo: undefined })
        );
        harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
          { payload: { clientId: 'client-1', iat: 1_786_000_000 } },
        ]);
        harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
        harness.oidcAdapter.client.find.mockResolvedValue(null);
        const res = response();

        await harness.controller.apps(request(), res);

        expect(dateSpy).toHaveBeenCalledWith('fr-FR', { timeZone: 'UTC' });
        expect(res.render).toHaveBeenCalledWith(
          'accounts/apps',
          expect.objectContaining({
            connectedApps: [
              expect.objectContaining({ approved_on: 'UTC approval date' }),
            ],
          })
        );
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('keeps the earliest approval when a later grant is processed next', async () => {
      const earliestSeconds = 1_785_000_000;
      let formattedTimestamp: number | undefined;
      const dateSpy = vi
        .spyOn(Date.prototype, 'toLocaleDateString')
        .mockImplementation(function () {
          formattedTimestamp = this.getTime();
          return 'approval date';
        });
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
          { payload: { clientId: 'client-1', iat: earliestSeconds } },
          { payload: { clientId: 'client-1', iat: earliestSeconds + 3_600 } },
        ]);
        harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
        harness.oidcAdapter.client.find.mockResolvedValue(null);

        await harness.controller.apps(request(), response());

        expect(formattedTimestamp).toBe(earliestSeconds * 1_000);
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('formats connected-application activity across relative-time boundaries', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        const nowSeconds = Date.now() / 1_000;
        harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
          { payload: { clientId: 'recently' } },
          { payload: { clientId: 'just-now', iat: nowSeconds - 30 } },
          { payload: { clientId: 'one-minute', iat: nowSeconds - 60 } },
          { payload: { clientId: 'many-minutes', iat: nowSeconds - 5 * 60 } },
          {
            payload: { clientId: 'many-hours', iat: nowSeconds - 2 * 60 * 60 },
          },
          { payload: { clientId: 'one-day', iat: nowSeconds - 24 * 60 * 60 } },
          {
            payload: {
              clientId: 'many-days',
              iat: nowSeconds - 2 * 24 * 60 * 60,
            },
          },
        ]);
        harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
        harness.oidcAdapter.client.find.mockResolvedValue(null);
        const res = response();

        await harness.controller.apps(request(), res);

        expect(res.render).toHaveBeenCalledWith(
          'accounts/apps',
          expect.objectContaining({
            connectedApps: expect.arrayContaining([
              expect.objectContaining({
                id: 'recently',
                last_used: 'Recently',
              }),
              expect.objectContaining({
                id: 'just-now',
                last_used: 'Just now',
              }),
              expect.objectContaining({
                id: 'one-minute',
                last_used: '1 minute ago',
              }),
              expect.objectContaining({
                id: 'many-minutes',
                last_used: '5 minutes ago',
              }),
              expect.objectContaining({
                id: 'many-hours',
                last_used: '2 hours ago',
              }),
              expect.objectContaining({
                id: 'one-day',
                last_used: '1 day ago',
              }),
              expect.objectContaining({
                id: 'many-days',
                last_used: '2 days ago',
              }),
            ]),
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to raw adapter metadata and contains lookup failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'raw-client' } },
        { payload: { clientId: 'missing-client' } },
      ]);
      harness.oidcAdapter.client.findClientById
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('registry unavailable'));
      harness.oidcAdapter.client.find.mockResolvedValueOnce({
        client_name: 'Raw Client',
        client_uri: 'not a URL',
      });
      const res = response();

      await harness.controller.apps(request(), res);

      expect(harness.logger.debug).toHaveBeenCalledWith('Invalid client URI', {
        clientId: 'raw-client',
        clientUri: 'not a URL',
      });
      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'get_unified_client_info_failed',
        clientId: 'missing-client',
      });
      expect(res.render).toHaveBeenCalledWith(
        'accounts/apps',
        expect.objectContaining({
          connectedApps: [
            expect.objectContaining({
              id: 'raw-client',
              name: 'Raw Client',
              developer: 'Unknown Developer',
            }),
            expect.objectContaining({
              id: 'missing-client',
              name: 'Application missing-client',
            }),
          ],
        })
      );
    });

    it('uses the client identifier when raw adapter metadata has no name', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'unnamed-client' } },
      ]);
      harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
      harness.oidcAdapter.client.find.mockResolvedValue({
        application_type: 'native',
      });
      const res = response();

      await harness.controller.apps(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/apps',
        expect.objectContaining({
          connectedApps: [
            expect.objectContaining({
              id: 'unnamed-client',
              name: 'unnamed-client',
            }),
          ],
        })
      );
    });

    it('uses generic metadata when a client is absent from both adapter lookups', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'removed-client' } },
      ]);
      harness.oidcAdapter.client.findClientById.mockResolvedValue(null);
      harness.oidcAdapter.client.find.mockResolvedValue(null);
      const res = response();

      await harness.controller.apps(request(), res);

      expect(harness.oidcAdapter.client.find).toHaveBeenCalledWith(
        'removed-client'
      );
      expect(harness.logger.error).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: 'get_unified_client_info_failed' })
      );
      expect(res.render).toHaveBeenCalledWith(
        'accounts/apps',
        expect.objectContaining({
          connectedApps: [
            expect.objectContaining({
              id: 'removed-client',
              name: 'Application removed-client',
              developer: 'Unknown Developer',
              logo: null,
            }),
          ],
        })
      );
    });

    it('uses deterministic names for unnamed registered clients', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { payload: { clientId: 'with-registered-id' } },
        { payload: { clientId: 'without-registered-id' } },
      ]);
      harness.oidcAdapter.client.findClientById
        .mockResolvedValueOnce({ client_id: 'registered-id' })
        .mockResolvedValueOnce({});
      const res = response();

      await harness.controller.apps(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/apps',
        expect.objectContaining({
          connectedApps: [
            expect.objectContaining({ name: 'registered-id' }),
            expect.objectContaining({
              name: 'Application without-registered-id',
            }),
          ],
        })
      );
    });

    it('reports grant repository failures and returns to the account dashboard', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockRejectedValue(
        new Error('grant repository unavailable')
      );
      const res = response();

      await harness.controller.apps(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'apps_load_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load connected applications'
      );
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });
  });

  describe('identifier validation', () => {
    it.each([
      {
        method: 'switchAccount',
        body: { accountId: ['user-2'] },
        assertNoMutation: (harness: ReturnType<typeof createHarness>) =>
          expect(harness.sessionManager.switchUser).not.toHaveBeenCalled(),
      },
      {
        method: 'removeAccount',
        body: { accountId: { id: 'user-2' } },
        assertNoMutation: (harness: ReturnType<typeof createHarness>) =>
          expect(
            harness.sessionManager.removeAuthenticatedUser
          ).not.toHaveBeenCalled(),
      },
      {
        method: 'revokeApp',
        body: { clientId: ['client-1'] },
        activeUser: true,
        assertNoMutation: (harness: ReturnType<typeof createHarness>) =>
          expect(
            harness.oidcAdapter.grant.findGrantsByAccountId
          ).not.toHaveBeenCalled(),
      },
      {
        method: 'logoutSession',
        body: { sessionId: { id: 'session-1' }, sessionType: 'express' },
        activeUser: true,
        assertNoMutation: (harness: ReturnType<typeof createHarness>) => {
          expect(
            harness.sessionManager.revokeExpressSession
          ).not.toHaveBeenCalled();
          expect(
            harness.oidcAdapter.session.revokeSession
          ).not.toHaveBeenCalled();
        },
      },
      {
        method: 'logoutAllOtherSessions',
        body: { currentSessionId: ['session-1'] },
        activeUser: true,
        assertNoMutation: (harness: ReturnType<typeof createHarness>) =>
          expect(
            harness.oidcAdapter.session.revokeAllSessionsExcept
          ).not.toHaveBeenCalled(),
      },
    ] as const)(
      '$method rejects a structured identifier before service calls',
      async ({ method, body, activeUser: needsUser, assertNoMutation }) => {
        const harness = createHarness();
        if (needsUser) {
          harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        }
        if (method === 'removeAccount') {
          harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
            active: activeUser(),
            others: [activeUser({ id: 'user-2', username: 'bob' })],
          });
        }
        const res = response();

        await harness.controller[method](request({ body }), res);

        assertNoMutation(harness);
      }
    );
  });

  describe('revocation persistence boundaries', () => {
    it('accepts the snake_case client identifier rendered by the account form', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        {
          _id: 'stored-grant',
          payload: { clientId: 'client-1', jti: 'grant-1' },
        },
      ]);
      harness.oidcAdapter.grant.find.mockResolvedValue({
        payload: { jti: 'grant-1' },
      });

      await harness.controller.revokeApp(
        request({ body: { client_id: 'client-1' } }),
        response()
      );

      expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledWith('grant-1');
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Application access revoked successfully'
      );
    });

    it('redirects anonymous users before loading application grants', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.revokeApp(
        request({ body: { clientId: 'client-1' } }),
        res
      );

      expect(
        harness.oidcAdapter.grant.findGrantsByAccountId
      ).not.toHaveBeenCalled();
      expect(harness.oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('reports when matching application grants cannot be revoked', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'grant-without-jti', payload: { clientId: 'client-1' } },
        {
          _id: 'already-removed-grant',
          payload: { clientId: 'client-1', jti: 'grant-2' },
        },
      ]);
      harness.oidcAdapter.grant.find.mockResolvedValue(null);
      const res = response();

      await harness.controller.revokeApp(
        request({ body: { clientId: 'client-1' } }),
        res
      );

      expect(harness.logger.warn).toHaveBeenCalledWith(
        'Grant grant-without-jti has no jti, skipping revocation'
      );
      expect(harness.oidcAdapter.grant.find).toHaveBeenCalledWith('grant-2');
      expect(harness.oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(harness.flash.error).toHaveBeenCalledWith(
        'No access found for this application'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/apps');
    });

    it('continues revoking an application after one grant operation fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'stored-1', payload: { clientId: 'client-1', jti: 'grant-1' } },
        { _id: 'stored-2', payload: { clientId: 'client-1', jti: 'grant-2' } },
      ]);
      harness.oidcAdapter.grant.find
        .mockRejectedValueOnce(new Error('grant lookup failed'))
        .mockResolvedValueOnce({ payload: { jti: 'grant-2' } });
      const res = response();

      await harness.controller.revokeApp(
        request({ body: { clientId: 'client-1' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'grant_revocation_failed',
        grantId: 'grant-1',
      });
      expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledTimes(1);
      expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledWith('grant-2');
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Application access revoked successfully'
      );
      expect(harness.flash.error).not.toHaveBeenCalledWith(
        'No access found for this application'
      );
    });

    it('contains single-application grant repository failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockRejectedValue(
        new Error('grant repository unavailable')
      );
      const res = response();

      await harness.controller.revokeApp(
        request({ body: { clientId: 'client-1' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'app_access_revocation_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to revoke application access'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/apps');
    });

    it('redirects anonymous users before revoking all application grants', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.revokeAllApps(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Authentication required'
      );
      expect(
        harness.oidcAdapter.grant.findGrantsByAccountId
      ).not.toHaveBeenCalled();
      expect(harness.oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('reports when an authenticated user has no applications to revoke', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([]);
      const res = response();

      await harness.controller.revokeAllApps(request(), res);

      expect(harness.oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(harness.flash.info).toHaveBeenCalledWith(
        'No applications to revoke'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/apps');
    });

    it('reports no revocation when every stored grant is already absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'stored-1', payload: { jti: 'grant-1' } },
      ]);
      harness.oidcAdapter.grant.find.mockResolvedValue(null);

      await harness.controller.revokeAllApps(request(), response());

      expect(harness.oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(harness.flash.info).toHaveBeenCalledWith(
        'No applications to revoke'
      );
      expect(activityMocks.success).not.toHaveBeenCalled();
    });

    it('continues revoking all applications after one grant operation fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'stored-1', payload: { jti: 'grant-1' } },
        { _id: 'stored-2', payload: { jti: 'grant-2' } },
      ]);
      harness.oidcAdapter.grant.find
        .mockRejectedValueOnce(new Error('grant lookup failed'))
        .mockResolvedValueOnce({ payload: { jti: 'grant-2' } });
      const res = response();

      await harness.controller.revokeAllApps(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'grant_revocation_failed',
        grantId: 'grant-1',
      });
      expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledTimes(1);
      expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledWith('grant-2');
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Successfully revoked access to 1 application(s)'
      );
    });

    it('contains revoke-all grant repository failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.grant.findGrantsByAccountId.mockRejectedValue(
        new Error('grant repository unavailable')
      );
      const res = response();

      await harness.controller.revokeAllApps(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'all_apps_access_revocation_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to revoke all application access'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/apps');
    });

    it('redirects anonymous users before logging out a session', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.logoutSession(
        request({ body: { sessionId: 'session-1', sessionType: 'oidc' } }),
        res
      );

      expect(
        harness.oidcAdapter.session.findByAccountId
      ).not.toHaveBeenCalled();
      expect(
        harness.sessionManager.findExpressSessionsForUser
      ).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('returns to sessions when an authenticated logout has no request body', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.logoutSession(
        request({ body: null } as Partial<Request>),
        res
      );

      expect(
        harness.oidcAdapter.session.findByAccountId
      ).not.toHaveBeenCalled();
      expect(
        harness.sessionManager.findExpressSessionsForUser
      ).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/sessions');
    });

    it('defaults an omitted session type to an owned OIDC session', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        { _id: 'stored-oidc', payload: { jti: 'oidc-1' } },
      ]);
      const res = response();

      await harness.controller.logoutSession(
        request({ body: { sessionId: 'oidc-1' } }),
        res
      );

      expect(harness.oidcAdapter.session.revokeSession).toHaveBeenCalledWith(
        'oidc-1'
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'session_logout',
        null,
        'User logged out from a session',
        expect.objectContaining({
          target: expect.objectContaining({
            entity_data: { sessionType: 'oidc' },
          }),
        })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Session logged out successfully'
      );
    });

    it('matches an owned OIDC session by its stored identifier when jti is absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        { _id: 'stored-oidc', payload: {} },
      ]);

      await harness.controller.logoutSession(
        request({ body: { sessionId: 'stored-oidc', sessionType: 'oidc' } }),
        response()
      );

      expect(harness.oidcAdapter.session.revokeSession).toHaveBeenCalledWith(
        'stored-oidc'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Session logged out successfully'
      );
    });

    it('contains single-session revocation failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('session repository unavailable')
      );
      const res = response();

      await harness.controller.logoutSession(
        request({ body: { sessionId: 'oidc-1', sessionType: 'oidc' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'session_logout_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to logout session'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/sessions');
    });

    it('redirects anonymous users before bulk session logout', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.logoutAllOtherSessions(
        request({ body: { currentSessionId: 'oidc-current' } }),
        res
      );

      expect(
        harness.oidcAdapter.session.revokeAllSessionsExcept
      ).not.toHaveBeenCalled();
      expect(
        harness.sessionManager.findExpressSessionsForUser
      ).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('reports when there are no other sessions to log out', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(0);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
      const res = response();

      await harness.controller.logoutAllOtherSessions(
        request({ body: { currentSessionId: 'oidc-current' } }),
        res
      );

      expect(harness.flash.info).toHaveBeenCalledWith(
        'No other sessions to logout'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/sessions');
    });

    it('keeps OIDC revocations when Express bulk revocation fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(2);
      harness.sessionManager.findExpressSessionsForUser.mockRejectedValue(
        new Error('express session store unavailable')
      );
      const res = response();

      await harness.controller.logoutAllOtherSessions(
        request({ body: { currentSessionId: 'oidc-current' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'express_sessions_revocation_failed',
      });
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Successfully logged out from 2 session(s)'
      );
      expect(harness.flash.error).not.toHaveBeenCalledWith(
        'Failed to logout other sessions'
      );
    });

    it('contains bulk OIDC session revocation failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockRejectedValue(
        new Error('oidc session store unavailable')
      );
      const res = response();

      await harness.controller.logoutAllOtherSessions(
        request({ body: { currentSessionId: 'oidc-current' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'all_other_sessions_logout_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to logout other sessions'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/sessions');
    });

    it('rejects an explicit invalid session type without defaulting to OIDC', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.logoutSession(
        request({
          body: { sessionId: 'session-1', sessionType: ['express'] },
        }),
        res
      );

      expect(
        harness.sessionManager.revokeExpressSession
      ).not.toHaveBeenCalled();
      expect(harness.oidcAdapter.session.revokeSession).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/sessions');
    });

    it.each(['express', 'oidc'] as const)(
      'does not revoke an unowned %s session',
      async sessionType => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
          { _id: 'owned-express', session: {} },
        ]);
        harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
          { _id: 'owned-oidc', payload: { jti: 'owned-oidc' } },
        ]);
        const res = response();

        await harness.controller.logoutSession(
          request({
            body: { sessionId: 'foreign-session', sessionType },
          }),
          res
        );

        expect(
          harness.sessionManager.revokeExpressSession
        ).not.toHaveBeenCalled();
        expect(
          harness.oidcAdapter.session.revokeSession
        ).not.toHaveBeenCalled();
        expect(harness.flash.error).toHaveBeenCalledWith(
          'Session not found or already expired'
        );
      }
    );

    it.each(['express', 'oidc'] as const)(
      'revokes an owned %s session',
      async sessionType => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
          { _id: 'session-1', session: {} },
        ]);
        harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
          { _id: 'stored-oidc', payload: { jti: 'session-1' } },
        ]);
        const res = response();

        await harness.controller.logoutSession(
          request({ body: { sessionId: 'session-1', sessionType } }),
          res
        );

        if (sessionType === 'express') {
          expect(
            harness.sessionManager.revokeExpressSession
          ).toHaveBeenCalledWith('session-1');
        } else {
          expect(
            harness.oidcAdapter.session.revokeSession
          ).toHaveBeenCalledWith('session-1');
        }
        expect(harness.flash.success).toHaveBeenCalledWith(
          'Session logged out successfully'
        );
      }
    );

    it('skips malformed and current Express records when logging out other sessions', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(1);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        null,
        { _id: { invalid: true }, session: {} },
        { _id: 'current-express', session: {} },
        { _id: 'other-express', session: {} },
      ]);
      const res = response();

      await harness.controller.logoutAllOtherSessions(
        request({
          body: { currentSessionId: 'current-oidc' },
          sessionID: 'current-express',
        } as Partial<Request>),
        res
      );

      expect(harness.sessionManager.revokeExpressSession).toHaveBeenCalledTimes(
        1
      );
      expect(harness.sessionManager.revokeExpressSession).toHaveBeenCalledWith(
        'other-express'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Successfully logged out from 2 session(s)'
      );
    });

    it('does not count an Express session the store failed to revoke', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.revokeAllSessionsExcept.mockResolvedValue(0);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        { _id: 'other-express', session: {} },
      ]);
      harness.sessionManager.revokeExpressSession.mockResolvedValue(false);

      await harness.controller.logoutAllOtherSessions(
        request({
          body: { currentSessionId: 'current-oidc' },
          sessionID: 'current-express',
        } as Partial<Request>),
        response()
      );

      expect(harness.flash.info).toHaveBeenCalledWith(
        'No other sessions to logout'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
    });

    it.each(['revokeApp', 'revokeAllApps'] as const)(
      '%s skips malformed grants and still revokes valid grants',
      async method => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
          { _id: 'corrupt-grant', payload: null },
          {
            _id: 'valid-grant',
            payload: { clientId: 'client-1', jti: 'grant-1' },
          },
        ]);
        harness.oidcAdapter.grant.find.mockResolvedValue({
          payload: { jti: 'grant-1' },
        });
        const res = response();

        await harness.controller[method](
          request({ body: { clientId: 'client-1' } }),
          res
        );

        expect(harness.oidcAdapter.grant.destroy).toHaveBeenCalledWith(
          'grant-1'
        );
        expect(harness.flash.success).toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/accounts/apps');
      }
    );
  });

  describe('sessions()', () => {
    it('guards anonymous users and renders an empty authenticated state', async () => {
      const anonymous = createHarness();
      const anonymousRes = response();

      await anonymous.controller.sessions(request(), anonymousRes);

      expect(anonymousRes.redirect).toHaveBeenCalledWith('/auth/login');
      expect(
        anonymous.oidcAdapter.session.findByAccountId
      ).not.toHaveBeenCalled();

      const empty = createHarness();
      empty.sessionManager.getActiveUser.mockReturnValue(activeUser());
      empty.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
      empty.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
      const emptyRes = response();

      await empty.controller.sessions(request(), emptyRes);

      expect(emptyRes.render).toHaveBeenCalledWith('accounts/sessions', {
        title: 'Active Sessions',
        currentSession: null,
        otherSessions: [],
      });
    });

    it.each([
      ['Brave/1.0 Linux', 'Brave on Linux'],
      ['OPR/100.0 Android Linux', 'Opera on Android'],
      ['Firefox/140.0 Windows NT 6.3', 'Firefox on Windows 8.1'],
      ['Chrome/151.0 Windows NT 6.2', 'Chrome on Windows 8'],
      ['MSIE 11.0 Windows NT 6.1', 'Internet Explorer on Windows 7'],
      ['CustomBrowser/1.0 Windows NT 5.1', 'Unknown on Windows'],
      ['Safari/605.1 Mac OS X iPhone', 'Safari on iOS'],
      ['Safari/605.1 Mac OS X iPad', 'Safari on iPadOS'],
      ['Safari/605.1 Mac OS X', 'Safari on macOS'],
      ['Safari/605.1 X11', 'Safari on Linux'],
      ['Safari/605.1 iPhone', 'Safari on iOS'],
      ['Safari/605.1 iPad', 'Safari on iPadOS'],
      ['CustomBrowser/1.0', 'Unknown on Unknown'],
    ] as const)(
      'normalizes the %s user agent as %s',
      async (userAgent, expectedDevice) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
        try {
          const harness = createHarness();
          harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
          harness.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
          harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
            {
              _id: 'express-current',
              session: {
                authTime: '2026-08-05T12:00:00.000Z',
                lastActivity: '2026-08-05T12:00:00.000Z',
                userAgent,
                ipAddress: '127.0.0.1',
              },
            },
          ]);
          const res = response();

          await harness.controller.sessions(
            request({ sessionID: 'express-current' } as Partial<Request>),
            res
          );

          expect(res.render).toHaveBeenCalledWith(
            'accounts/sessions',
            expect.objectContaining({
              currentSession: expect.objectContaining({
                device: expectedDevice,
                lastActive: 'Just now',
              }),
            })
          );
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([
      [60_000, '1 minute ago'],
      [2 * 60_000, '2 minutes ago'],
      [60 * 60_000, '1 hour ago'],
      [2 * 60 * 60_000, '2 hours ago'],
      [24 * 60 * 60_000, '1 day ago'],
      [2 * 24 * 60 * 60_000, '2 days ago'],
    ] as const)(
      'formats a session last active %s milliseconds ago as %s',
      async (elapsedMs, expectedLabel) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
        try {
          const harness = createHarness();
          harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
          harness.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
          harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
            {
              _id: 'express-current',
              session: {
                authTime: '2026-08-05T12:00:00.000Z',
                lastActivity: new Date(Date.now() - elapsedMs).toISOString(),
                userAgent: 'Chrome/151.0 Linux',
              },
            },
          ]);
          const res = response();

          await harness.controller.sessions(
            request({ sessionID: 'express-current' } as Partial<Request>),
            res
          );

          expect(res.render).toHaveBeenCalledWith(
            'accounts/sessions',
            expect.objectContaining({
              currentSession: expect.objectContaining({
                lastActive: expectedLabel,
              }),
            })
          );
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it('formats session dates in UTC when the account has no timezone', async () => {
      const dateSpy = vi
        .spyOn(Date.prototype, 'toLocaleString')
        .mockReturnValue('UTC session date');
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(
          activeUser({ zoneinfo: undefined })
        );
        harness.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
        harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
          {
            _id: 'express-current',
            session: { authTime: '2026-08-05T12:00:00.000Z' },
          },
        ]);
        const res = response();

        await harness.controller.sessions(
          request({ sessionID: 'express-current' } as Partial<Request>),
          res
        );

        expect(dateSpy).toHaveBeenCalledWith('fr-FR', {
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        expect(res.render).toHaveBeenCalledWith(
          'accounts/sessions',
          expect.objectContaining({
            currentSession: expect.objectContaining({
              startTime: 'UTC session date',
            }),
          })
        );
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('skips malformed persisted sessions and still renders valid sessions', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        { _id: 'corrupt-oidc', payload: null },
      ]);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        null,
        { _id: 'empty-express', session: null },
        {
          _id: 'express-1',
          session: {
            authTime: '2026-08-05T03:00:00.000Z',
            lastActivity: '2026-08-05T03:05:00.000Z',
            userAgent:
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Chrome/151 Safari/537.36',
            ipAddress: '127.0.0.1',
          },
        },
      ]);
      const res = response();

      await harness.controller.sessions(
        request({ sessionID: 'express-1' } as Partial<Request>),
        res
      );

      expect(res.render).toHaveBeenCalledWith('accounts/sessions', {
        title: 'Active Sessions',
        currentSession: expect.objectContaining({
          id: 'express-1',
          sessionType: 'express',
          device: 'Chrome on Linux',
          isCurrentSession: true,
        }),
        otherSessions: [],
      });
      expect(harness.flash.error).not.toHaveBeenCalled();
    });

    it('skips invalid Express identifiers and defaults missing optional metadata', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
        harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
          { _id: { invalid: true }, session: {} },
          {
            _id: 'defaulted-express',
            session: {
              _metadata: { browser: { name: 'Firefox' } },
            },
          },
        ]);
        const res = response();

        await harness.controller.sessions(
          request({ sessionID: 'defaulted-express' } as Partial<Request>),
          res
        );

        expect(harness.logger.warn).toHaveBeenCalledWith(
          'Skipping Express session without an identifier'
        );
        expect(res.render).toHaveBeenCalledWith('accounts/sessions', {
          title: 'Active Sessions',
          currentSession: expect.objectContaining({
            id: 'defaulted-express',
            device: 'Firefox on Unknown',
            location: 'Unknown',
            ip: 'Unknown',
            lastActive: 'Just now',
          }),
          otherSessions: [],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses an unknown device when Express metadata and user agent are absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([]);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        { _id: 'express-current', session: {} },
      ]);
      const res = response();

      await harness.controller.sessions(
        request({ sessionID: 'express-current' } as Partial<Request>),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'accounts/sessions',
        expect.objectContaining({
          currentSession: expect.objectContaining({
            device: 'Unknown on Unknown',
          }),
        })
      );
    });

    it('combines OIDC and Express sessions with activity and client metadata', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        {
          _id: 'stored-oidc',
          payload: {
            jti: 'oidc-1',
            loginTs: Date.parse('2026-08-05T02:00:00.000Z') / 1000,
            authorizations: { 'client-1': {} },
            amr: ['pwd'],
            acr: 'urn:parako:loa:1',
          },
        },
      ]);
      harness.activity.findActivitiesAroundTime.mockResolvedValue([
        {
          timestamp: new Date('2026-08-05T02:04:00.000Z'),
          user_agent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
          ip_address: '198.51.100.40',
        },
        {
          timestamp: new Date('2026-08-05T02:00:01.000Z'),
          user_agent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
          ip_address: '203.0.113.8',
        },
      ]);
      harness.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'client-1',
        client_name: 'Demo RP',
        client_uri: 'https://rp.example.test',
        logo_uri: 'https://rp.example.test/logo.png',
      });
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([
        {
          _id: 'express-current',
          session: {
            authTime: '2026-08-05T03:00:00.000Z',
            lastActivity: '2026-08-05T03:05:00.000Z',
            _metadata: {
              browser: { name: 'Firefox' },
              os: { name: 'Linux' },
              createdIp: '198.51.100.9',
            },
          },
        },
      ]);
      const res = response();

      await harness.controller.sessions(
        request({ sessionID: 'express-current' } as Partial<Request>),
        res
      );

      expect(res.render).toHaveBeenCalledWith('accounts/sessions', {
        title: 'Active Sessions',
        currentSession: expect.objectContaining({
          id: 'express-current',
          device: 'Firefox on Linux',
          isCurrentSession: true,
        }),
        otherSessions: [
          expect.objectContaining({
            id: 'oidc-1',
            device: 'Edge on Windows 10/11',
            ip: '203.0.113.8',
            clients: [
              {
                id: 'client-1',
                name: 'Demo RP',
                developer: 'rp.example.test',
                logo: 'https://rp.example.test/logo.png',
              },
            ],
            amr: ['pwd'],
            acr: 'urn:parako:loa:1',
          }),
        ],
      });
    });

    it('uses safe fallbacks for optional OIDC session and client metadata', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
      try {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
          {
            _id: 'stored-oidc',
            payload: {
              jti: 'oidc-only',
              loginTs: Date.now() / 1_000,
              authorizations: {
                'invalid-uri-client': {},
                'removed-client': {},
              },
              amr: 'pwd',
              acr: { invalid: true },
            },
          },
        ]);
        harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
        harness.activity.findActivitiesAroundTime.mockResolvedValue([
          {
            timestamp: new Date(),
            user_agent: '',
            ip_address: '0.0.0.0',
          },
        ]);
        harness.oidcAdapter.client.findClientById
          .mockResolvedValueOnce({
            client_id: 'invalid-uri-client',
            client_uri: 'not a URL',
          })
          .mockResolvedValueOnce(null);
        harness.oidcAdapter.client.find.mockResolvedValueOnce(null);
        const res = response();

        await harness.controller.sessions(request(), res);

        expect(harness.logger.debug).toHaveBeenCalledWith(
          'Invalid client URI',
          {
            clientId: 'invalid-uri-client',
            clientUri: 'not a URL',
          }
        );
        expect(res.render).toHaveBeenCalledWith('accounts/sessions', {
          title: 'Active Sessions',
          currentSession: expect.objectContaining({
            id: 'oidc-only',
            device: 'Unknown on Unknown',
            location: 'Unknown',
            ip: '0.0.0.0',
            clients: [
              {
                id: 'invalid-uri-client',
                name: 'invalid-uri-client',
                developer: 'Unknown Developer',
                logo: null,
              },
              {
                id: 'removed-client',
                name: 'Connected Application',
                developer: 'Unknown Developer',
                logo: null,
              },
            ],
            amr: [],
            acr: '',
            isCurrentSession: true,
          }),
          otherSessions: [],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses generic metadata for an unnamed registered session client', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        {
          _id: 'oidc-1',
          payload: {
            loginTs: Date.now() / 1_000,
            authorizations: { 'unnamed-client': {} },
          },
        },
      ]);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
      harness.oidcAdapter.client.findClientById.mockResolvedValue({});
      const res = response();

      await harness.controller.sessions(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/sessions',
        expect.objectContaining({
          currentSession: expect.objectContaining({
            clients: [
              {
                id: 'unnamed-client',
                name: 'Connected Application',
                developer: 'Unknown Developer',
                logo: null,
              },
            ],
          }),
        })
      );
    });

    it('uses safe defaults when OIDC activity IP and authorizations are absent', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        {
          _id: 'oidc-1',
          payload: { loginTs: Date.now() / 1_000 },
        },
      ]);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
      harness.activity.findActivitiesAroundTime.mockResolvedValue([
        {
          timestamp: new Date(),
          user_agent: 'Chrome/151.0 Linux',
          ip_address: '',
        },
      ]);
      const res = response();

      await harness.controller.sessions(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/sessions',
        expect.objectContaining({
          currentSession: expect.objectContaining({
            ip: 'Unknown',
            location: 'Unknown',
            clients: [],
          }),
        })
      );
    });

    it('reports session repository failures and returns to the account dashboard', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockRejectedValue(
        new Error('session repository unavailable')
      );
      const res = response();

      await harness.controller.sessions(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'sessions_load_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load active sessions'
      );
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('contains unexpected client-info resolver failures per OIDC session', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.oidcAdapter.session.findByAccountId.mockResolvedValue([
        {
          _id: 'oidc-1',
          payload: {
            jti: 'oidc-1',
            loginTs: Date.now() / 1_000,
            authorizations: { 'client-1': {} },
          },
        },
      ]);
      harness.sessionManager.findExpressSessionsForUser.mockResolvedValue([]);
      (harness.controller as any).getUnifiedClientInfo = vi
        .fn()
        .mockRejectedValue(new Error('client resolver unavailable'));
      const res = response();

      await harness.controller.sessions(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'client_info_load_failed',
        clientId: 'client-1',
      });
      expect(res.render).toHaveBeenCalledWith(
        'accounts/sessions',
        expect.objectContaining({
          currentSession: expect.objectContaining({
            clients: [
              {
                id: 'client-1',
                name: 'Connected Application',
                developer: 'Unknown Developer',
                logo: null,
              },
            ],
          }),
        })
      );
    });
  });

  describe('account switching', () => {
    it('records add-account intent before redirecting to login', () => {
      const harness = createHarness();
      const req = request({
        headers: { referer: '/accounts/apps' },
      } as Partial<Request>);
      const res = response();

      harness.controller.addAccount(req, res);

      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        req,
        'addAccountIntent',
        {
          addingAccount: true,
          returnUrl: '/accounts/apps',
          timestamp: expect.any(Number),
        }
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/login?intent=add-account'
      );
    });

    it('returns a newly added account to the dashboard when no referrer exists', () => {
      const harness = createHarness();
      const req = request({ headers: {} } as Partial<Request>);

      harness.controller.addAccount(req, response());

      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        req,
        'addAccountIntent',
        expect.objectContaining({ returnUrl: '/accounts/dashboard' })
      );
    });

    it('reports add-account intent failures and returns to the dashboard', () => {
      const harness = createHarness();
      harness.sessionManager.set.mockImplementation(() => {
        throw new Error('session store unavailable');
      });
      const res = response();

      harness.controller.addAccount(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'add_account_initiation_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to initiate account addition. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('applies local redirect policy after a successful account switch', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const req = request({
        body: { accountId: 'user-2', redirect: '/accounts/apps' },
        headers: {},
      } as Partial<Request>);
      const res = response();

      await harness.controller.switchAccount(req, res);

      expect(harness.sessionManager.switchUser).toHaveBeenCalledWith(
        req,
        'user-2'
      );
      expect(harness.redirectAuthority.redirect).toHaveBeenCalledWith(res);
      expect(harness.redirectChain.to).toHaveBeenCalledWith('/accounts/apps');
      expect(harness.redirectChain.or).toHaveBeenCalledWith(
        '/accounts/dashboard'
      );

      const options = harness.redirectChain.withOptions.mock.calls[0]?.[0] as {
        allowLocal: boolean;
        requireHttps: boolean;
        customValidator: (url: string) => boolean;
      };
      expect(options.allowLocal).toBe(true);
      expect(options.requireHttps).toBe(false);
      expect(options.customValidator('/accounts/apps')).toBe(true);
      expect(options.customValidator('https://attacker.example.test')).toBe(
        false
      );
    });

    it('still applies redirect policy when a successful switch has no active account', async () => {
      const harness = createHarness();
      const req = request({
        body: { accountId: 'user-2' },
        headers: {},
      } as Partial<Request>);
      const res = response();

      await harness.controller.switchAccount(req, res);

      expect(activityMocks.success).not.toHaveBeenCalled();
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(harness.redirectAuthority.redirect).toHaveBeenCalledWith(res);
    });

    it.each([
      [
        activeUser({ full_name: '', given_name: 'Alice', family_name: 'Doe' }),
        'Alice Doe',
      ],
      [activeUser({ full_name: '', given_name: '', family_name: '' }), 'alice'],
    ])(
      'uses the next available switch display name',
      async (user, expected) => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(user);

        await harness.controller.switchAccount(
          request({
            body: { accountId: 'user-2' },
            headers: {},
          } as Partial<Request>),
          response()
        );

        expect(harness.flash.success).toHaveBeenCalledWith(
          `Switched to account: ${expected}`
        );
      }
    );

    it('returns a switched account to the referrer when no redirect is posted', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const req = request({
        body: { accountId: 'user-2' },
        headers: { referer: '/accounts/sessions' },
      } as Partial<Request>);

      await harness.controller.switchAccount(req, response());

      expect(harness.redirectChain.to).toHaveBeenCalledWith(
        '/accounts/sessions'
      );
    });

    it('projects active and secondary accounts for the switcher', () => {
      const harness = createHarness();
      (
        harness.config.security.authentication as Record<string, unknown>
      ).session_management = {
        multiple_accounts: { enabled: true },
      };
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser({ is_admin: true }),
        others: [
          activeUser({
            id: 'user-2',
            username: 'zoe',
            email: undefined,
            given_name: undefined,
            family_name: undefined,
            full_name: undefined,
            picture: undefined,
          }),
        ],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [
          expect.objectContaining({
            id: 'user-1',
            username: 'alice',
            displayName: 'Alice Doe',
            initials: 'AD',
            isActive: true,
            is_admin: true,
          }),
          expect.objectContaining({
            id: 'user-2',
            username: 'zoe',
            email: '',
            displayName: 'zoe',
            initials: 'ZO',
            picture: '',
            isActive: false,
            is_admin: false,
          }),
        ],
        totalAccounts: 2,
      });
    });

    it('uses a neutral initial when the active account has no name or username', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser({
          username: '',
          given_name: undefined,
          family_name: undefined,
          full_name: undefined,
        }),
        others: [],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [expect.objectContaining({ initials: 'U' })],
        totalAccounts: 1,
      });
    });

    it('uses username and empty media fields for a sparse active account', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser({
          email: undefined,
          given_name: undefined,
          family_name: undefined,
          full_name: undefined,
          picture: undefined,
        }),
        others: [],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [
          expect.objectContaining({
            email: '',
            picture: '',
            displayName: 'alice',
            initials: 'AL',
          }),
        ],
        totalAccounts: 1,
      });
    });

    it('derives secondary account initials from the given and family names', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [
          activeUser({
            id: 'user-2',
            username: 'zoe',
            given_name: 'Zoé',
            family_name: 'Martin',
          }),
        ],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [
          expect.objectContaining({ id: 'user-1' }),
          expect.objectContaining({ id: 'user-2', initials: 'ZM' }),
        ],
        totalAccounts: 2,
      });
    });

    it('uses a neutral initial for an unnamed secondary account', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [
          activeUser({
            id: 'user-2',
            username: '',
            given_name: undefined,
            family_name: undefined,
            full_name: undefined,
          }),
        ],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [
          expect.objectContaining({ id: 'user-1' }),
          expect.objectContaining({
            id: 'user-2',
            displayName: '',
            initials: 'U',
          }),
        ],
        totalAccounts: 2,
      });
    });

    it('omits secondary accounts when multiple accounts are disabled', () => {
      const harness = createHarness();
      (
        harness.config.security.authentication as Record<string, unknown>
      ).session_management = {
        multiple_accounts: { enabled: false },
      };
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [activeUser({ id: 'user-2', username: 'bob' })],
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        accounts: [expect.objectContaining({ id: 'user-1', isActive: true })],
        totalAccounts: 1,
      });
    });

    it('returns an authentication error when no account session exists', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Not authenticated',
      });
    });

    it('logs switcher dependency failures and returns a server error', () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockImplementation(() => {
        throw new Error('session store unavailable');
      });
      const res = response();

      harness.controller.getAccountSwitcherData(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'account_switcher_data_load_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to get account data',
      });
    });

    it('rejects linking an unavailable social provider', async () => {
      const harness = createHarness();
      harness.socialLoginManager.isProviderAvailable.mockReturnValue(false);
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await harness.controller.linkSocialAccount(req, res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'github is not available'
      );
      expect(harness.sessionManager.set).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('records the linking intent and redirects to the social provider', async () => {
      const harness = createHarness();
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await harness.controller.linkSocialAccount(req, res);

      expect(harness.sessionManager.set).toHaveBeenCalledWith(
        req,
        'linkSocialAccountIntent',
        {
          provider: 'github',
          returnUrl: '/accounts/settings/social',
        }
      );
      expect(
        harness.socialLoginManager.getAuthorizationUrl
      ).toHaveBeenCalledWith('github', req);
      expect(res.redirect).toHaveBeenCalledWith(
        'https://github.example.test/authorize'
      );
    });

    it('reports a social authorization failure and returns to settings', async () => {
      const harness = createHarness();
      harness.socialLoginManager.getAuthorizationUrl.mockRejectedValue(
        new Error('provider unavailable')
      );
      const res = response();

      await harness.controller.linkSocialAccount(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'link_social_account_failed',
        provider: 'github',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to initiate social account linking'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('does not unlink a social provider without an active account', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.unlinkSocialAccount(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'User not found in session'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.socialLoginManager.unlinkFromUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('does not unlink a social provider for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.unlinkSocialAccount(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(
        harness.socialIntegrationService.findByUser
      ).not.toHaveBeenCalled();
      expect(harness.socialLoginManager.unlinkFromUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('prevents unlinking the only sign-in method without a password', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ password: '   ' })
      );
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'github' },
      ]);
      const res = response();

      await harness.controller.unlinkSocialAccount(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'You must set a password before unlinking your only social account. Please change your password first to ensure you can always access your account.'
      );
      expect(harness.socialLoginManager.unlinkFromUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('unlinks an account when another sign-in method remains', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.socialIntegrationService.findByUser.mockResolvedValue([
        { method: 'github' },
      ]);
      const req = request({ params: { provider: 'github' } });
      const res = response();

      await harness.controller.unlinkSocialAccount(req, res);

      expect(harness.socialLoginManager.unlinkFromUser).toHaveBeenCalledWith(
        'github',
        'user-1'
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'social_account_unlinked',
        null,
        'User unlinked github account',
        expect.objectContaining({
          actor: expect.objectContaining({ username: 'alice' }),
          target: expect.objectContaining({ entity_name: 'github' }),
        })
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'github account unlinked successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('reports unlink failures without claiming success', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.socialLoginManager.unlinkFromUser.mockRejectedValue(
        new Error('provider store unavailable')
      );
      const res = response();

      await harness.controller.unlinkSocialAccount(
        request({ params: { provider: 'github' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'unlink_social_account_failed',
        provider: 'github',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to unlink social account'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/social');
    });

    it('encodes the account identifier in the reauthentication redirect', async () => {
      const harness = createHarness();
      harness.sessionManager.switchUser.mockReturnValue({
        success: false,
        reason: 'reauth_required',
      });
      const res = response();

      await harness.controller.switchAccount(
        request({ body: { accountId: 'user+two&intent=add-account' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/login?switch_to=user%2Btwo%26intent%3Dadd-account'
      );
    });

    it('audits and reports an unavailable account switch', async () => {
      const harness = createHarness();
      harness.sessionManager.switchUser.mockReturnValue({
        success: false,
        reason: 'not_found',
      });
      const res = response();

      await harness.controller.switchAccount(
        request({ body: { accountId: 'user-2' } }),
        res
      );

      expect(activityMocks.failed).toHaveBeenCalledWith(
        'account_switch_failed',
        null,
        'Failed to switch to account',
        expect.objectContaining({
          target: expect.objectContaining({ entity_id: 'user-2' }),
        })
      );
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Unable to switch to the selected account. Account may no longer be available.'
      );
      expect(harness.redirectAuthority.redirect).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('contains account-switch session-store failures', async () => {
      const harness = createHarness();
      harness.sessionManager.switchUser.mockImplementation(() => {
        throw new Error('session store unavailable');
      });
      const res = response();

      await harness.controller.switchAccount(
        request({ body: { accountId: 'user-2' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'account_switch_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to switch accounts. Please try again.'
      );
      expect(harness.redirectAuthority.redirect).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/dashboard');
    });

    it('rejects account removal when no authenticated-users session exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      const res = response();

      await harness.controller.removeAccount(
        request({ body: { accountId: 'user-2' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'No authenticated users found',
      });
      expect(
        harness.sessionManager.removeAuthenticatedUser
      ).not.toHaveBeenCalled();
    });

    it('prevents removing the only authenticated account', async () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [],
      });
      const res = response();

      await harness.controller.removeAccount(
        request({ body: { accountId: 'user-1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Cannot remove the only account. Please logout instead.',
      });
      expect(
        harness.sessionManager.removeAuthenticatedUser
      ).not.toHaveBeenCalled();
    });

    it('returns not found when the selected account cannot be removed', async () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [activeUser({ id: 'user-2', username: 'bob' })],
      });
      harness.sessionManager.removeAuthenticatedUser.mockResolvedValue(false);
      const req = request({ body: { accountId: 'missing-user' } });
      const res = response();

      await harness.controller.removeAccount(req, res);

      expect(
        harness.sessionManager.removeAuthenticatedUser
      ).toHaveBeenCalledWith(req, 'missing-user');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Account not found or cannot be removed',
      });
    });

    it('removes a selected account from a multi-account session', async () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [activeUser({ id: 'user-2', username: 'bob' })],
      });
      const req = request({ body: { accountId: 'user-2' } });
      const res = response();

      await harness.controller.removeAccount(req, res);

      expect(
        harness.sessionManager.removeAuthenticatedUser
      ).toHaveBeenCalledWith(req, 'user-2');
      expect(harness.logger.info).toHaveBeenCalledWith(
        'Account removed from session: user-2'
      );
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Account removed successfully',
      });
    });

    it('contains account-removal session-store failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: activeUser(),
        others: [activeUser({ id: 'user-2', username: 'bob' })],
      });
      harness.sessionManager.removeAuthenticatedUser.mockRejectedValue(
        new Error('session store unavailable')
      );
      const res = response();

      await harness.controller.removeAccount(
        request({ body: { accountId: 'user-2' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'account_removal_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to remove account. Please try again.',
      });
    });
  });

  describe('account recovery', () => {
    it('requires authentication before enabling account recovery', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.enableRecovery(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.recoveryUtils.getRecoveryConfig).not.toHaveBeenCalled();
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
    });

    it('does not enable recovery when the feature is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: false,
        methods: {},
      });
      const res = response();

      await harness.controller.enableRecovery(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Account recovery is not available.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
    });

    it('does not render an empty one-time recovery-code list', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.sessionManager.get.mockReturnValue([]);
      const res = response();

      await harness.controller.showRecoveryCodes(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'No backup codes available. Codes can only be viewed once for security reasons.'
      );
      expect(harness.sessionManager.remove).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('requires authentication before showing recovery codes', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.showRecoveryCodes(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.sessionManager.get).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
    });

    it('renders recovery codes once with no-store response headers', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.sessionManager.get.mockReturnValue(['code-one', 'code-two']);
      const res = response();

      await harness.controller.showRecoveryCodes(request(), res);

      expect(harness.sessionManager.remove).toHaveBeenCalledWith(
        expect.anything(),
        'recoveryBackupCodes'
      );
      expect(res.set).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );
      expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(res.render).toHaveBeenCalledWith('accounts/recovery-codes', {
        title: 'Account Recovery Codes',
        backup_codes: ['code-one', 'code-two'],
        pageUser: {
          ...user,
          picture: '/media/avatars/alice.png',
        },
      });
    });

    it('contains recovery-code session failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.sessionManager.get.mockImplementation(() => {
        throw new Error('session store unavailable');
      });
      const res = response();

      await harness.controller.showRecoveryCodes(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'show_recovery_codes_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load recovery codes'
      );
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('handles a missing request body without escaping the controller', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await expect(
        harness.controller.enableRecovery(
          request({ body: undefined as unknown as Request['body'] }),
          res
        )
      ).resolves.toBeUndefined();

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to enable account recovery'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects a structured unified recovery email before side effects', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: { address: 'recovery@example.test' },
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Valid email address is required'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-setup');
    });

    it('rejects an invalid unified recovery email before side effects', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'not-an-email',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Valid email address is required'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-setup');
    });

    it('returns an invalid explicit unified email to recovery setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {},
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'unified' },
          body: { email: 'not-an-email' },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Valid email address is required'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-setup');
    });

    it('returns an invalid secondary email to recovery settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { secondary_email: { enabled: true } },
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'not-an-email' },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Valid email address is required'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('returns unified recovery setup to the setup page when the account was deleted', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.enableRecovery(
        request({ body: { source: 'recovery_setup' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-setup');
    });

    it('returns explicit unified recovery to settings when the account was deleted', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.enableRecovery(
        request({ query: { method: 'unified' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('completes unified recovery when its security notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Recovery setup completed! Backup codes generated and verification email sent to your secondary email address.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-codes');
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'secondary_email_added_notification_failed',
        })
      );
    });

    it('warns when unified recovery uses the primary email domain', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.recoveryUtils.checkSecondaryEmailDomain.mockReturnValue({
        sameDomain: true,
        warning: 'Use an email address on a different domain when possible.',
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        res
      );

      expect(harness.flash.warning).toHaveBeenCalledWith(
        'Use an email address on a different domain when possible.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-codes');
    });

    it('uses the username in unified recovery email content when profile identity is sparse', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({
          email: undefined,
          given_name: undefined,
          family_name: undefined,
        })
      );
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        response()
      );

      expect(
        harness.recoveryUtils.checkSecondaryEmailDomain
      ).toHaveBeenCalledWith('', 'recovery@example.test');
      expect(
        harness.notificationService.sendTemplatedEmail
      ).toHaveBeenCalledWith(
        'recovery@example.test',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({
          content: expect.stringContaining('<p>Hello alice,</p>'),
          username: 'alice',
        })
      );
    });

    it('uses the tenant issuer origin in recovery verification links', async () => {
      const harness = createHarness();
      harness.configManager.getConfig.mockReturnValue({
        ...harness.configManager.getConfig(),
        oidc: { issuer: 'https://acme.id.example.test/oidc/v1' },
      });
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        response()
      );

      expect(
        harness.notificationService.sendTemplatedEmail
      ).toHaveBeenCalledWith(
        'recovery@example.test',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({
          content: expect.stringContaining(
            'href="https://acme.id.example.test/accounts/verify-recovery-email?token=raw-verification-token"'
          ),
        })
      );
    });

    it('keeps unified recovery enabled when email delivery fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendTemplatedEmail.mockRejectedValue(
        new Error('email provider unavailable')
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.logger.error).toHaveBeenCalledWith(
        'Failed to send recovery email verification',
        expect.objectContaining({
          username: 'alice',
          email: 'recovery@example.test',
          error: expect.any(Error),
        })
      );
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Recovery setup completed, but failed to send verification email. You can set up secondary email later in settings.'
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Recovery setup completed! Backup codes generated. Please check your email settings if verification email was not received.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-codes');
    });

    it('normalizes an explicit secondary recovery email before verification', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes', 'not-a-recovery-method'],
          },
        })
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: '  recovery@example.test  ' },
        }),
        res
      );

      expect(
        harness.recoveryUtils.generateSecondaryEmailVerification
      ).toHaveBeenCalledWith('recovery@example.test');
      expect(harness.userService.updateById).toHaveBeenCalledTimes(1);
      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual([
        'backup_codes',
        'secondary_email',
      ]);
    });

    it('creates secondary-email recovery when no recovery record exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { secondary_email: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ recovery: undefined })
      );

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        response()
      );

      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: expect.objectContaining({
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: expect.objectContaining({
            email: 'recovery@example.test',
            verified: false,
          }),
        }),
      });
    });

    it('does not duplicate secondary-email recovery during repeated setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { secondary_email: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
          },
        })
      );

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        response()
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['secondary_email']);
    });

    it('uses the username in explicit recovery email content when profile identity is sparse', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(
        activeUser({
          email: undefined,
          given_name: undefined,
          family_name: undefined,
        })
      );
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { secondary_email: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        response()
      );

      expect(
        harness.notificationService.sendTemplatedEmail
      ).toHaveBeenCalledWith(
        'recovery@example.test',
        expect.any(String),
        'email/mail.njk',
        expect.objectContaining({
          content: expect.stringContaining('<p>Hello alice,</p>'),
          username: 'alice',
        })
      );
    });

    it('keeps secondary email enabled when its security notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Verification email sent to your secondary email address'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'secondary_email_added_notification_failed',
        })
      );
    });

    it('does not enable secondary-email recovery when that method is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          secondary_email: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Secondary email recovery is not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('requires a non-empty secondary recovery email', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          secondary_email: { enabled: true },
        },
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: '' },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Valid email address is required'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not enable secondary-email recovery for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(
        harness.recoveryUtils.generateSecondaryEmailVerification
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('keeps secondary-email recovery enabled when verification delivery fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.notificationService.sendTemplatedEmail.mockRejectedValue(
        new Error('email provider unavailable')
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          query: { method: 'secondary_email' },
          body: { email: 'recovery@example.test' },
        }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.logger.error).toHaveBeenCalledWith(
        'Failed to send recovery email verification',
        expect.objectContaining({
          username: 'alice',
          email: 'recovery@example.test',
          error: expect.any(Error),
        })
      );
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to send verification email. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects an unsupported recovery enablement method', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {},
      });
      const res = response();

      await harness.controller.enableRecovery(
        request({ query: { method: 'unsupported' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid recovery method'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-setup');
    });

    it('removes one-time recovery-email credentials after verification', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          id: 'user-1',
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_token: 'hashed-verification-token',
              verification_expires: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        })
      );
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, any>;
      expect(recoveryUpdate.secondary_email.verified).toBe(true);
      expect(recoveryUpdate.secondary_email).not.toHaveProperty(
        'verification_token'
      );
      expect(recoveryUpdate.secondary_email).not.toHaveProperty(
        'verification_expires'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('keeps recovery email verified when its security notification fails', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          id: 'user-1',
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_token: 'hashed-verification-token',
              verification_expires: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        })
      );
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Recovery email verified successfully'
      );
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'secondary_email_verified_notification_failed',
        })
      );
    });

    it('contains recovery-email verification persistence failures', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          id: 'user-1',
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_token: 'hashed-verification-token',
              verification_expires: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        })
      );
      harness.userService.updateById.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'verify_recovery_email_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to verify recovery email'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects a structured recovery-email token before lookup', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: ['untrusted-token'] } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid verification link'
      );
      expect(harness.userService.findByRecoveryToken).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects a recovery-email token that no longer resolves to an account', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(null);
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'unknown-verification-token' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid or expired verification link'
      );
      expect(
        harness.recoveryUtils.verifySecondaryEmailToken
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects verification when the account has no secondary recovery email', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
          },
        })
      );
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'stale-verification-token' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid or expired verification link'
      );
      expect(
        harness.recoveryUtils.verifySecondaryEmailToken
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('rejects verification when the stored recovery token is missing', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_expires: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        })
      );
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid verification link'
      );
      expect(
        harness.recoveryUtils.verifySecondaryEmailToken
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not verify a recovery email when its token has expired', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_token: 'hashed-verification-token',
              verification_expires: new Date('2026-08-05T00:00:00.000Z'),
            },
          },
        })
      );
      harness.recoveryUtils.verifySecondaryEmailToken.mockReturnValue({
        valid: false,
        error: 'Verification token has expired',
      });
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Verification token has expired'
      );
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('uses a safe default when recovery-token verification has no error message', async () => {
      const harness = createHarness();
      harness.userService.findByRecoveryToken.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: false,
              verification_token: 'hashed-verification-token',
              verification_expires: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        })
      );
      harness.recoveryUtils.verifySecondaryEmailToken.mockReturnValue({
        valid: false,
      });
      const res = response();

      await harness.controller.verifyRecoveryEmail(
        request({ query: { token: 'raw-verification-token' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Invalid verification link'
      );
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('keeps regenerated backup codes consistent with enabled methods', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email', 'not-a-recovery-method'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: true,
            },
          },
        })
      );
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual([
        'secondary_email',
        'backup_codes',
      ]);
      expect(recoveryUpdate).toHaveProperty('backup_codes');
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-codes');
    });

    it('requires authentication before regenerating backup codes', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.recoveryUtils.getRecoveryConfig).not.toHaveBeenCalled();
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
    });

    it('does not regenerate backup codes when that recovery method is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Backup codes are not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not regenerate backup codes for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Account recovery is not enabled'
      );
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('contains backup-code regeneration persistence failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: { enabled: true, methods: ['backup_codes'] },
        })
      );
      harness.userService.updateById.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'regenerate_backup_codes_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to regenerate backup codes'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(harness.sessionManager.set).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('keeps regenerated backup codes when their notification fails', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: { enabled: true, methods: ['backup_codes'] },
        })
      );
      harness.notificationService.sendSecurityAlert.mockRejectedValue(
        new Error('notification unavailable')
      );
      const res = response();

      await harness.controller.regenerateBackupCodes(request(), res);

      expect(harness.userService.updateById).toHaveBeenCalled();
      expect(harness.flash.success).toHaveBeenCalledWith(
        'New backup codes generated'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/recovery-codes');
      await vi.waitFor(() =>
        expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'backup_codes_regenerated_notification_failed',
        })
      );
    });

    it('authenticates before inspecting security-question page configuration', async () => {
      const harness = createHarness();
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: false,
        methods: {
          security_questions: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.flash.error).not.toHaveBeenCalled();
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
    });

    it('does not show security-question setup when that method is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Security questions are not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not show security-question setup for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(
        harness.recoveryUtils.getAvailableQuestionKeys
      ).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('contains security-question setup page dependency failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.getAvailableQuestionKeys.mockImplementation(() => {
        throw new Error('recovery configuration unavailable');
      });
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'show_security_questions_setup_error',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load security questions setup page'
      );
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('authenticates before inspecting security-question write configuration', async () => {
      const harness = createHarness();
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: false,
        methods: {
          security_questions: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(request(), res);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.flash.error).not.toHaveBeenCalled();
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
    });

    it('does not save security questions when that method is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Security questions are not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(
        harness.recoveryUtils.setupSecurityQuestions
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not save security questions for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.saveSecurityQuestions(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(
        harness.recoveryUtils.setupSecurityQuestions
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('requires at least three complete security-question answers', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Please answer at least 3 security questions'
      );
      expect(
        harness.recoveryUtils.setupSecurityQuestions
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it('rejects a security answer that does not meet policy', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.validateSecurityAnswer.mockReturnValueOnce({
        valid: false,
        error: 'Security answers must contain at least four characters',
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'x',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Security answers must contain at least four characters'
      );
      expect(
        harness.recoveryUtils.setupSecurityQuestions
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it('uses a safe default when security-answer validation has no error message', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.validateSecurityAnswer.mockReturnValueOnce({
        valid: false,
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith('Invalid answer');
      expect(
        harness.recoveryUtils.setupSecurityQuestions
      ).not.toHaveBeenCalled();
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it('does not persist security questions when secure setup rejects them', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: false,
        error: 'Security questions must be unique',
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Security questions must be unique'
      );
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it('uses a safe default when secure question setup has no error message', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: false,
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to setup security questions'
      );
      expect(harness.userService.updateWithAssignment).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it('renders no existing security questions when recovery is not configured', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ recovery: undefined })
      );
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/security-questions-setup',
        expect.objectContaining({
          existingQuestions: [],
          requiredCount: 3,
        })
      );
    });

    it('skips malformed persisted security questions when rendering setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['security_questions'],
            security_questions: {
              questions: [
                null,
                {
                  id: 'question-1',
                  question_key: 'first_school',
                  answer_hash: 'hashed-answer',
                },
              ],
            },
          },
        })
      );
      const res = response();

      await harness.controller.showSecurityQuestionsSetup(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        'accounts/security-questions-setup',
        expect.objectContaining({
          existingQuestions: [
            {
              id: 'question-1',
              question_key: 'first_school',
            },
          ],
          requiredCount: 3,
        })
      );
      expect(harness.flash.error).not.toHaveBeenCalled();
    });

    it('validates, hashes, and persists three security questions', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes', 'security_questions'],
          },
        })
      );
      const setupAt = new Date('2026-08-06T00:00:00.000Z');
      const storedQuestions = [
        {
          id: 'question-1',
          question_key: 'first_school',
          answer_hash: 'hash-1',
        },
        {
          id: 'question-2',
          question_key: 'childhood_friend',
          answer_hash: 'hash-2',
        },
        {
          id: 'question-3',
          question_key: 'first_job',
          answer_hash: 'hash-3',
        },
      ];
      harness.recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: true,
        questions: storedQuestions,
        setup_at: setupAt,
      });
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.recoveryUtils.setupSecurityQuestions).toHaveBeenCalledWith(
        [
          {
            question_key: 'first_school',
            answer: 'Porto-Novo Academy',
          },
          {
            question_key: 'childhood_friend',
            answer: 'Afi and Kossi',
          },
          { question_key: 'first_job', answer: 'Community library' },
        ]
      );
      expect(harness.userService.updateWithAssignment).toHaveBeenCalledWith(
        'user-1',
        {
          recovery: expect.objectContaining({
            enabled: true,
            methods: ['backup_codes', 'security_questions'],
            security_questions: {
              questions: storedQuestions,
              setup_at: setupAt,
            },
          }),
        }
      );
      expect(activityMocks.success).toHaveBeenCalledWith(
        'security_questions_setup',
        expect.anything(),
        'Security questions configured successfully',
        expect.anything()
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('contains security-question persistence failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          security_questions: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(databaseUser());
      harness.recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: true,
        questions: [
          {
            id: 'question-1',
            question_key: 'first_school',
            answer_hash: 'hash-1',
          },
          {
            id: 'question-2',
            question_key: 'childhood_friend',
            answer_hash: 'hash-2',
          },
          {
            id: 'question-3',
            question_key: 'first_job',
            answer_hash: 'hash-3',
          },
        ],
      });
      harness.userService.updateWithAssignment.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.saveSecurityQuestions(
        request({
          body: {
            question_1: 'first_school',
            answer_1: 'Porto-Novo Academy',
            question_2: 'childhood_friend',
            answer_2: 'Afi and Kossi',
            question_3: 'first_job',
            answer_3: 'Community library',
          },
        }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'save_security_questions_error',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to save security questions. Please try again.'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/security-questions/setup'
      );
    });

    it.each([
      ['a scalar', 'sms', ['security_questions']],
      [
        'unknown array entries',
        ['backup_codes', 'not-a-recovery-method'],
        ['backup_codes', 'security_questions'],
      ],
    ])(
      'does not persist %s from malformed recovery methods',
      async (_case, persistedMethods, expectedMethods) => {
        const harness = createHarness();
        harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
        harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
          enabled: true,
          methods: {
            security_questions: { enabled: true },
          },
        });
        harness.userService.findByUsername.mockResolvedValue(
          databaseUser({
            recovery: {
              enabled: true,
              methods: persistedMethods,
            },
          })
        );
        harness.recoveryUtils.setupSecurityQuestions.mockResolvedValue({
          valid: true,
          questions: [
            {
              id: 'question-1',
              question_key: 'first_school',
              answer_hash: 'hash-1',
            },
          ],
        });
        const res = response();

        await harness.controller.saveSecurityQuestions(
          request({
            body: {
              question_1: 'first_school',
              answer_1: 'Porto-Novo Academy',
              question_2: 'childhood_friend',
              answer_2: 'Afi and Kossi',
              question_3: 'first_job',
              answer_3: 'Community library',
            },
          }),
          res
        );

        const recoveryUpdate =
          harness.userService.updateWithAssignment.mock.calls[0]?.[1]?.recovery;
        expect(recoveryUpdate.methods).toEqual(expectedMethods);
      }
    );

    it('does not mutate loaded recovery methods when unified persistence fails', async () => {
      const harness = createHarness();
      const persistedMethods = ['backup_codes'];
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: persistedMethods,
          },
        })
      );
      harness.userService.updateById.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        res
      );

      expect(persistedMethods).toEqual(['backup_codes']);
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to enable account recovery'
      );
    });

    it('normalizes malformed recovery methods during unified setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: 'sms',
          },
        })
      );
      const res = response();

      await harness.controller.enableRecovery(
        request({ body: { source: 'recovery_setup' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['backup_codes']);
    });

    it('creates unified recovery when the account has no recovery record', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { backup_codes: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ recovery: undefined })
      );

      await harness.controller.enableRecovery(
        request({ body: { source: 'recovery_setup' } }),
        response()
      );

      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: expect.objectContaining({
          enabled: true,
          methods: ['backup_codes'],
        }),
      });
    });

    it('does not duplicate recovery methods during repeated unified setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes', 'secondary_email'],
          },
        })
      );

      await harness.controller.enableRecovery(
        request({
          body: {
            source: 'recovery_setup',
            email: 'recovery@example.test',
          },
        }),
        response()
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual([
        'backup_codes',
        'secondary_email',
      ]);
    });

    it('normalizes recovery methods when enabling backup codes', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
          secondary_email: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email', 'not-a-recovery-method'],
          },
        })
      );
      const res = response();

      await harness.controller.enableRecovery(request(), res);

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual([
        'secondary_email',
        'backup_codes',
      ]);
    });

    it('creates backup-code recovery when no recovery record exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { backup_codes: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ recovery: undefined })
      );

      await harness.controller.enableRecovery(request(), response());

      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: expect.objectContaining({
          enabled: true,
          methods: ['backup_codes'],
        }),
      });
    });

    it('does not duplicate backup-code recovery during repeated setup', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: { backup_codes: { enabled: true } },
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
          },
        })
      );

      await harness.controller.enableRecovery(request(), response());

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['backup_codes']);
    });

    it('does not generate backup codes when that recovery method is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: false },
        },
      });
      const res = response();

      await harness.controller.enableRecovery(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Backup codes are not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not generate backup codes for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
        methods: {
          backup_codes: { enabled: true },
        },
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.enableRecovery(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(harness.recoveryUtils.generateBackupCodes).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('requires authentication before disabling a recovery method', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'backup_codes' } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
    });

    it('rejects a structured recovery method before disabling anything', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: ['backup_codes'] } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Recovery method not specified'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not disable a recovery method when no recovery configuration exists', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ recovery: undefined })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'backup_codes' } }),
        res
      );

      expect(harness.flash.error).toHaveBeenCalledWith(
        'No recovery configuration found'
      );
      expect(harness.userService.updateById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('contains recovery-method persistence failures', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes: ['hashed-code'],
              generated_at: new Date('2026-08-05T00:00:00.000Z'),
              expires_at: new Date('2027-08-05T00:00:00.000Z'),
            },
          },
        })
      );
      harness.userService.updateById.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'backup_codes' } }),
        res
      );

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'disable_recovery_failed',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to disable recovery method'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('removes persisted SMS recovery data when SMS recovery is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['sms', 'backup_codes'],
            sms: {
              phone_number: '+22901020304',
              verified: true,
              verification_code: '123456',
            },
            backup_codes: {
              codes: ['hashed-code'],
              generated_at: new Date('2026-08-01T00:00:00.000Z'),
            },
          },
        })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'sms' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['backup_codes']);
      expect(recoveryUpdate).not.toHaveProperty('sms');
      expect(recoveryUpdate).toHaveProperty('backup_codes');
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not keep recovery enabled through an unknown persisted method', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['sms', 'not-a-recovery-method'],
            sms: {
              phone_number: '+22901020304',
              verified: true,
            },
          },
        })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'sms' } }),
        res
      );

      expect(harness.userService.updateById).toHaveBeenCalledWith('user-1', {
        recovery: {
          enabled: false,
          methods: [],
        },
      });
    });

    it('removes persisted backup codes when backup-code recovery is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes', 'secondary_email'],
            backup_codes: {
              codes: ['hashed-code'],
              generated_at: new Date('2026-08-01T00:00:00.000Z'),
            },
            secondary_email: {
              email: 'recovery@example.test',
              verified: true,
            },
          },
        })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'backup_codes' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['secondary_email']);
      expect(recoveryUpdate).not.toHaveProperty('backup_codes');
      expect(recoveryUpdate).toHaveProperty('secondary_email');
    });

    it('removes persisted secondary-email data when secondary-email recovery is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email', 'security_questions'],
            secondary_email: {
              email: 'recovery@example.test',
              verified: true,
            },
            security_questions: {
              questions: [
                {
                  question: 'First school?',
                  answer_hash: 'hashed-answer',
                },
              ],
            },
          },
        })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'secondary_email' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['security_questions']);
      expect(recoveryUpdate).not.toHaveProperty('secondary_email');
      expect(recoveryUpdate).toHaveProperty('security_questions');
    });

    it('removes persisted security questions when question recovery is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({
          recovery: {
            enabled: true,
            methods: ['security_questions', 'sms'],
            security_questions: {
              questions: [
                {
                  question: 'First school?',
                  answer_hash: 'hashed-answer',
                },
              ],
            },
            sms: {
              phone_number: '+22901020304',
              verified: true,
            },
          },
        })
      );
      const res = response();

      await harness.controller.disableRecovery(
        request({ query: { method: 'security_questions' } }),
        res
      );

      const recoveryUpdate = harness.userService.updateById.mock.calls[0]?.[1]
        ?.recovery as Record<string, unknown>;
      expect(recoveryUpdate.methods).toEqual(['sms']);
      expect(recoveryUpdate).not.toHaveProperty('security_questions');
      expect(recoveryUpdate).toHaveProperty('sms');
    });

    it('does not resend verification without an active account', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.resendEmailVerification(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'User not found in session'
      );
      expect(harness.userService.findById).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('does not resend verification for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(null);
      const res = response();

      await harness.controller.resendEmailVerification(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('does not resend verification for an already verified email', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(
        databaseUser({ email_verified: true })
      );
      const res = response();

      await harness.controller.resendEmailVerification(request(), res);

      expect(harness.flash.info).toHaveBeenCalledWith(
        'Your email is already verified'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('resends email verification and records the request', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(
        databaseUser({
          email_verified: false,
          given_name: 'Alice',
        })
      );
      const req = request();
      const res = response();

      await harness.controller.resendEmailVerification(req, res);

      expect(
        harness.authService.generateEmailVerificationToken
      ).toHaveBeenCalledWith('user-1');
      expect(harness.notificationService.sendVerification).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'Alice' },
        'https://id.example.test/auth/verify-email?token=verification-token'
      );
      expect(activityMocks.info).toHaveBeenCalledWith(
        'email_verification_resent',
        expect.objectContaining({ _id: 'user-1' }),
        'User requested email verification resend',
        expect.any(Object)
      );
      expect(harness.flash.success).toHaveBeenCalledWith(
        'Verification email has been sent. Please check your inbox.'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('uses the username when resending verification for a sparse profile', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(
        databaseUser({
          email_verified: false,
          given_name: undefined,
        })
      );

      await harness.controller.resendEmailVerification(request(), response());

      expect(harness.notificationService.sendVerification).toHaveBeenCalledWith(
        { email: 'alice@example.test', username: 'alice' },
        'https://id.example.test/auth/verify-email?token=verification-token'
      );
    });

    it('reports verification resend failures without claiming delivery', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findById.mockResolvedValue(
        databaseUser({ email_verified: false })
      );
      harness.authService.generateEmailVerificationToken.mockRejectedValue(
        new Error('token store unavailable')
      );
      const res = response();

      await harness.controller.resendEmailVerification(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'resend_email_verification_failed',
      });
      expect(
        harness.notificationService.sendVerification
      ).not.toHaveBeenCalled();
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to send verification email. Please try again later.'
      );
      expect(harness.flash.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/accounts/settings/notifications'
      );
    });

    it('requires authentication before showing recovery setup', async () => {
      const harness = createHarness();
      const res = response();

      await harness.controller.showRecoverySetup(request(), res);

      expect(harness.recoveryUtils.getRecoveryConfig).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('does not show recovery setup when recovery is disabled', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: false,
      });
      const res = response();

      await harness.controller.showRecoverySetup(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith(
        'Account recovery is not available.'
      );
      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('does not show recovery setup for a deleted account', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
      });
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller.showRecoverySetup(request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });

    it('renders recovery setup with persisted MFA state', async () => {
      const harness = createHarness();
      const user = activeUser();
      harness.sessionManager.getActiveUser.mockReturnValue(user);
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
      });
      harness.userService.findByUsername.mockResolvedValue(
        databaseUser({ mfa: { enabled: true, methods: ['totp'] } })
      );
      const res = response();

      await harness.controller.showRecoverySetup(request(), res);

      expect(harness.mfaUtils.getEnabledMethods).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice' })
      );
      expect(res.render).toHaveBeenCalledWith('accounts/recovery-setup', {
        title: 'Set Up Account Recovery',
        pageUser: {
          ...user,
          picture: '/media/avatars/alice.png',
          mfa: { enabled: true, methods: ['totp'] },
        },
      });
    });

    it('reports recovery-setup dependency failures and returns to settings', async () => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.recoveryUtils.getRecoveryConfig.mockReturnValue({
        enabled: true,
      });
      harness.userService.findByUsername.mockRejectedValue(
        new Error('database unavailable')
      );
      const res = response();

      await harness.controller.showRecoverySetup(request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'show_recovery_setup_error',
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load recovery setup page'
      );
      expect(res.redirect).toHaveBeenCalledWith('/accounts/settings/recovery');
    });
  });

  it.each([
    ['settingsProfile', 'settings_profile_page_load_failed'],
    ['settingsPreferences', 'settings_preferences_page_load_failed'],
    ['settingsNotifications', 'settings_notifications_page_load_failed'],
    ['settingsSecurity', 'settings_security_page_load_failed'],
    ['settingsRecovery', 'settings_recovery_page_load_failed'],
    ['settingsSocial', 'settings_social_page_load_failed'],
  ] as const)(
    '%s logs dependency failures and redirects to login',
    async (method, context) => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockImplementation(() => {
        throw new Error('session unavailable');
      });
      const res = response();

      await harness.controller[method](request(), res);

      expect(harness.logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context,
      });
      expect(harness.flash.error).toHaveBeenCalledWith(
        'Failed to load settings'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    }
  );

  it.each([
    'settingsNotifications',
    'settingsSecurity',
    'settingsRecovery',
    'settingsSocial',
  ] as const)(
    '%s redirects anonymous users before database access',
    async method => {
      const harness = createHarness();
      const res = response();

      await harness.controller[method](request(), res);

      expect(harness.userService.findByUsername).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    }
  );

  it.each([
    'settingsNotifications',
    'settingsSecurity',
    'settingsRecovery',
    'settingsSocial',
  ] as const)(
    '%s redirects when the database user is missing',
    async method => {
      const harness = createHarness();
      harness.sessionManager.getActiveUser.mockReturnValue(activeUser());
      harness.userService.findByUsername.mockResolvedValue(null);
      const res = response();

      await harness.controller[method](request(), res);

      expect(harness.flash.error).toHaveBeenCalledWith('User not found');
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    }
  );
});
