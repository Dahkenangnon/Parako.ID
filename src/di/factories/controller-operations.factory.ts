import { Redis } from 'ioredis';

import type { ILogger } from '../interfaces/logger.interface.js';
import type { IAuthService } from '../interfaces/auth-service.interface.js';
import type { IUserService } from '../interfaces/user-service.interface.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IRecoveryUtils } from '../interfaces/recovery-utils.interface.js';
import type { IMfaUtils } from '../interfaces/mfa-utils.interface.js';
import type { ISocialLoginManager } from '../interfaces/social-login-manager.interface.js';
import type { ISocialIntegrationService } from '../interfaces/social-integration-service.interface.js';
import type { IUploadMiddleware } from '../interfaces/upload-middleware.interface.js';
import type { IEmailService } from '../interfaces/email-service.interface.js';
import type { ISettingsService } from '../interfaces/settings-service.interface.js';
import type { IOIDCAdapterBridge } from '../interfaces/oidc-adapter-bridge.interface.js';
import { EmailVerificationService } from '../../services/email-verification.service.js';
import { PasswordRecoveryService } from '../../services/password-recovery.service.js';
import {
  PhoneVerificationService,
  type PhoneVerificationServiceDependencies,
} from '../../services/phone-verification.service.js';
import { AccountProfileService } from '../../services/account-profile.service.js';
import { AccountPasswordChangeService } from '../../services/account-password-change.service.js';
import { AccountSettingsPageService } from '../../services/account-settings-page.service.js';
import {
  AccountSessionService,
  type AccountSessionServiceDependencies,
} from '../../services/account-session.service.js';
import { BrandingSettingsService } from '../../services/admin/branding-settings.service.js';
import { ConfigurationTransferService } from '../../services/admin/configuration-transfer.service.js';
import { ConfigurationVersionService } from '../../services/admin/configuration-version.service.js';
import { SecuritySettingsService } from '../../services/admin/security-settings.service.js';
import { ConfigurationHealthService } from '../../services/admin/configuration-health.service.js';
import { TestEmailService } from '../../services/admin/test-email.service.js';
import { SecretRevealService } from '../../services/admin/secret-reveal.service.js';
import { checkPasswordBreach } from '../../utils/password-breach.js';
import { buildExternalApplicationUrl } from '../../utils/external-application-url.js';

export interface AuthControllerOperationModules {
  emailVerification: EmailVerificationService;
  passwordRecovery: PasswordRecoveryService;
  phoneVerification: PhoneVerificationService;
}

export function createAuthControllerOperationModules(dependencies: {
  logger: ILogger;
  authService: IAuthService;
  userService: IUserService;
  notificationService: INotificationService;
  configManager: IConfigManager;
  oidcAdapter: IOIDCAdapterBridge;
  smsService: Pick<
    PhoneVerificationServiceDependencies,
    'sendVerificationCode'
  >;
}): AuthControllerOperationModules {
  const {
    logger,
    authService,
    userService,
    notificationService,
    configManager,
    oidcAdapter,
    smsService,
  } = dependencies;

  return {
    emailVerification: new EmailVerificationService({
      isValidEmailAddress: email => authService.isValidEmailAddress(email),
      findUserByEmail: email => userService.findByEmail(email),
      findUserById: userId => userService.findById(userId),
      generateVerificationToken: async userId => {
        const { verificationToken } =
          await authService.generateEmailVerificationToken(userId);
        return verificationToken;
      },
      verifyEmail: token => authService.verifyEmail(token),
      buildVerificationUrl: token => {
        const config = configManager.getConfig();
        return buildExternalApplicationUrl(
          config,
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.verify_email}`,
          { token }
        );
      },
      sendVerification: async (recipient, verificationUrl) => {
        await notificationService.sendVerification(recipient, verificationUrl);
      },
      info: (message, context) => logger.info(message, context),
      error: (message, context) => logger.error(message, context),
    }),
    passwordRecovery: new PasswordRecoveryService({
      isValidEmailAddress: email => authService.isValidEmailAddress(email),
      getPasswordPolicy: () => userService.getPasswordPolicy(),
      validatePassword: password => userService.validatePassword(password),
      resetPassword: (token, password) =>
        authService.resetPassword(token, password),
      generatePasswordResetToken: email =>
        authService.generatePasswordResetToken(email),
      buildResetUrl: resetToken => {
        const config = configManager.getConfig();
        return buildExternalApplicationUrl(
          config,
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.reset_password}`,
          { token: resetToken }
        );
      },
      sendPasswordReset: (recipient, resetUrl) =>
        notificationService.sendPasswordReset(recipient, resetUrl),
      revokeSessions: username =>
        oidcAdapter.session.revokeAllSessionsExcept(username, ''),
      sendResetNotification: (recipient, subject, template, locals) =>
        notificationService.sendTemplatedEmail(
          recipient,
          subject,
          template,
          locals
        ),
      applicationTitle: () => configManager.getConfig().application.title,
      formatResetTime: () => new Date().toLocaleString(),
      info: (message, context) => logger.info(message, context),
      error: (error, context) => logger.error(error as Error, context),
    }),
    phoneVerification: new PhoneVerificationService({
      phoneVerificationRequired: () =>
        configManager.getConfig().security.authentication.signup
          .require_phone_verification,
      generateChallenge: userId =>
        authService.generatePhoneVerificationChallenge(userId),
      renewChallenge: (verificationToken, deliver) =>
        authService.renewPhoneVerificationChallenge(verificationToken, deliver),
      verifyPhone: (verificationToken, code) =>
        authService.verifyPhone(verificationToken, code),
      sendVerificationCode: (phone, code, ip) =>
        smsService.sendVerificationCode(phone, code, ip),
      warn: (message, context) => logger.warn(message, context),
    }),
  };
}

export interface AccountControllerOperationModules {
  settingsPage: AccountSettingsPageService;
  profile: AccountProfileService<Express.Multer.File>;
  passwordChange: AccountPasswordChangeService;
  sessions: AccountSessionService;
}

export function createAccountControllerOperationModules(dependencies: {
  logger: ILogger;
  userService: IUserService;
  recoveryUtils: IRecoveryUtils;
  socialIntegrationService: ISocialIntegrationService;
  socialLoginManager: ISocialLoginManager;
  mfaUtils: IMfaUtils;
  configManager: IConfigManager;
  uploadMiddleware: IUploadMiddleware;
  sessionManager: Pick<
    AccountSessionServiceDependencies,
    'findExpressSessionsForUser' | 'revokeExpressSession'
  >;
}): AccountControllerOperationModules {
  const {
    logger,
    userService,
    recoveryUtils,
    socialIntegrationService,
    socialLoginManager,
    mfaUtils,
    configManager,
    uploadMiddleware,
    sessionManager,
  } = dependencies;

  return {
    settingsPage: new AccountSettingsPageService({
      findUserByUsername: username => userService.findByUsername(username),
      getCustomIdentifierFields: () => userService.getCustomIdentifierFields(),
      resolvePictureUrl: async picture => {
        if (!picture) return '';
        const resolved = await uploadMiddleware.getFileUrl(picture);
        return typeof resolved === 'string' ? resolved : picture;
      },
      findSocialIntegrations: userId =>
        socialIntegrationService.findByUser(userId),
      getAvailableSocialProviders: () =>
        socialLoginManager.getAvailableProviders(),
      isSocialProviderAvailable: provider =>
        socialLoginManager.isProviderAvailable(provider),
      getPasswordPolicy: () => userService.getPasswordPolicy(),
      getMfaConfig: () => mfaUtils.getMfaConfig(),
      getRecoveryConfig: () => recoveryUtils.getRecoveryConfig(),
      getNotificationConfig: () => configManager.getConfig().notifications,
    }),
    profile: new AccountProfileService({
      findUserById: userId => userService.findById(userId),
      getCustomIdentifierFields: () => userService.getCustomIdentifierFields(),
      getCustomIdentifier: (user, slot) =>
        userService.getCustomIdentifier(user, slot),
      isCustomIdentifierAvailable: (slot, value, excludeUserId) =>
        userService.isCustomIdentifierAvailable(slot, value, excludeUserId),
      setCustomIdentifier: (userId, slot, value) =>
        userService.setCustomIdentifier(userId, slot, value),
      removeCustomIdentifier: (userId, slot) =>
        userService.removeCustomIdentifier(userId, slot),
      updateProfile: (userId, profile) =>
        userService.updateProfile(userId, profile),
      removeAvatar: async userId => {
        await userService.removeAvatar(userId);
      },
      updateNotificationPreferences: (userId, preferences) =>
        userService.updateNotificationPreferences(userId, preferences),
      storeAvatar: file => uploadMiddleware.storeFile(file, 'avatars'),
      deleteAvatar: storageKey => uploadMiddleware.deleteFile(storageKey),
      reportAvatarCleanupFailure: (error, storageKey) =>
        logger.error(error as Error, {
          context: 'profile_avatar_cleanup_failed',
          storageKey,
        }),
    }),
    passwordChange: new AccountPasswordChangeService({
      findUserByUsername: username => userService.findByUsername(username),
      checkRecoveryCooldown: user => recoveryUtils.checkRecoveryCooldown(user),
      findLinkedProviders: userId =>
        socialIntegrationService.findByUser(userId),
      validatePassword: password => userService.validatePassword(password),
      checkPasswordBreach: (password, timeoutMs) =>
        checkPasswordBreach(password, timeoutMs),
      changePassword: async (userId, data) => {
        await userService.changePassword(userId, data);
      },
      warnBreachCheckFailure: error =>
        logger.warn(
          'Password breach check failed during password change (allowing change)',
          { error: error instanceof Error ? error.message : String(error) }
        ),
    }),
    sessions: new AccountSessionService({
      findExpressSessionsForUser: username =>
        sessionManager.findExpressSessionsForUser(username),
      revokeExpressSession: sessionId =>
        sessionManager.revokeExpressSession(sessionId),
      warn: message => logger.warn(message),
    }),
  };
}

export interface AdminSettingsControllerOperationModules {
  branding: BrandingSettingsService<Express.Multer.File>;
  configurationTransfer: ConfigurationTransferService;
  configurationVersion: ConfigurationVersionService;
  security: SecuritySettingsService;
  configurationHealth: ConfigurationHealthService;
  testEmail: TestEmailService;
  secretReveal: SecretRevealService;
}

export function createAdminSettingsControllerOperationModules(dependencies: {
  configManager: IConfigManager;
  emailService: IEmailService;
  settingsService: ISettingsService;
  uploadMiddleware: IUploadMiddleware;
  logger: ILogger;
}): AdminSettingsControllerOperationModules {
  const {
    configManager,
    emailService,
    settingsService,
    uploadMiddleware,
    logger,
  } = dependencies;

  return {
    branding: new BrandingSettingsService({
      getBranding: () => configManager.getPlatformConfig().branding,
      updateBranding: async branding => {
        await configManager.update({ branding });
      },
      storeFile: (file, category) => uploadMiddleware.storeFile(file, category),
      getFileUrl: storageKey => uploadMiddleware.getFileUrl(storageKey),
      deleteFile: storageKey => uploadMiddleware.deleteFile(storageKey),
      logCleanupFailure: (error, context, storageKey) =>
        logger.error(error as Error, { context, storageKey }),
    }),
    configurationTransfer: new ConfigurationTransferService({
      getCurrentConfig: () => configManager.getPlatformConfig(),
      updateConfig: async config => {
        await configManager.update(config);
      },
      reloadConfig: async () => {
        await configManager.reload();
      },
      generateConfigDiff: (current, imported) =>
        settingsService.generateConfigDiff(current, imported),
      analyzeConfigImpact: diff => settingsService.analyzeConfigImpact(diff),
    }),
    configurationVersion: new ConfigurationVersionService({
      findVersion: versionId => settingsService.findOne(versionId),
      getCurrentVersion: async () => {
        const current = await settingsService.getMainConfiguration();
        return current?.version || 'unknown';
      },
      saveVersion: async (config, modifiedBy, reason) => {
        await settingsService.saveMainConfiguration(config, modifiedBy, reason);
      },
      reloadConfig: async () => {
        await configManager.reload();
      },
    }),
    security: new SecuritySettingsService({
      getCurrentConfig: () => configManager.getPlatformConfig(),
      updateSecurity: async security => {
        await configManager.update({ security });
      },
    }),
    configurationHealth: new ConfigurationHealthService({
      isConfigLoaded: () => configManager.isLoaded(),
      getConfig: () => configManager.getPlatformConfig(),
      probeDatabase: async () => {
        await settingsService.findMany({}, { limit: 1 });
      },
      probeSmtp: () => emailService.connectToEmailServer(),
      createRedisClient: (uri, options) => new Redis(uri, options),
      fetchIssuer: (url, init) => fetch(url, init),
      isUsingFileConfig: () => configManager.isUsingFileConfig(),
      warn: (message, context) => {
        if (context === undefined) logger.warn(message);
        else logger.warn(message, context);
      },
      now: () => Date.now(),
    }),
    testEmail: new TestEmailService({
      getDeploymentUrl: () => configManager.getPlatformConfig().deployment?.url,
      initialize: () => emailService.initialize(),
      sendEmail: (recipient, subject, text, html) =>
        emailService.sendEmail(recipient, subject, text, html),
      now: () => new Date(),
    }),
    secretReveal: new SecretRevealService({
      loadDecryptedConfiguration: () =>
        settingsService.loadAndDecryptConfiguration(),
    }),
  };
}
