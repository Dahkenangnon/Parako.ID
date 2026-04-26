import express, { Router } from 'express';
import { IAccountController } from '../di/interfaces/account-controller.interface.js';
import { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { ILocalsMiddleware } from '../di/interfaces/locals-middleware.interface.js';
import { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import { changePasswordLimiter } from '../utils/rate-limiter.js';

/**
 * Register account routes with the DI injectable services
 */
export const accountRoutes = (
  avatarUpload: IUploadMiddleware,
  configManager: IConfigManager,
  securityMiddleware: ISecurityMiddleware,
  localsMiddleware: ILocalsMiddleware,
  uIMiddleware: IUIMiddleware,
  accountController: IAccountController
): Router => {
  const router = express.Router();
  const config = configManager.getConfig();
  const routes = config.deployment.routes.account_routes;

  router.use(securityMiddleware.requireAuth);

  router.use(localsMiddleware.setAccountLocals);

  // Account root — profile/my-account page
  router.get(
    routes.dashboard,
    localsMiddleware.setActivePage('my-account'),

    accountController.myAccount
  );

  // Settings redirect → first tab
  router.get(routes.settings, accountController.settings);

  router.get(
    routes.settings_profile,
    localsMiddleware.setActivePage('settings-profile'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsProfile
  );
  router.get(
    routes.settings_preferences,
    localsMiddleware.setActivePage('settings-preferences'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsPreferences
  );
  router.get(
    routes.settings_notifications,
    localsMiddleware.setActivePage('settings-notifications'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsNotifications
  );
  router.get(
    routes.settings_security,
    localsMiddleware.setActivePage('settings-security'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsSecurity
  );
  router.get(
    routes.settings_recovery,
    localsMiddleware.setActivePage('settings-recovery'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsRecovery
  );
  router.get(
    routes.settings_social,
    localsMiddleware.setActivePage('settings-social'),
    securityMiddleware.validateCsrfToken,
    accountController.settingsSocial
  );

  router.get(
    routes.apps,
    localsMiddleware.setActivePage('apps'),

    securityMiddleware.validateCsrfToken,
    accountController.apps
  );

  router.get(
    routes.sessions,
    localsMiddleware.setActivePage('sessions'),

    securityMiddleware.validateCsrfToken,
    accountController.sessions
  );

  router.post(
    routes.update_profile,
    avatarUpload.avatarUpload.single('avatar'),

    securityMiddleware.validateCsrfToken,
    accountController.updateProfile
  );

  router.post(
    routes.change_password,
    changePasswordLimiter,
    securityMiddleware.validateCsrfToken,
    accountController.changePassword
  );
  router.delete(
    routes.remove_avatar,

    securityMiddleware.validateCsrfToken,
    accountController.removeAvatar
  );

  // Multi-factor authentication
  router.post(
    routes.enable_mfa,

    securityMiddleware.validateCsrfToken,
    accountController.enableMfa
  );
  router.post(
    routes.disable_mfa,

    securityMiddleware.validateCsrfToken,
    accountController.disableMfa
  );
  router.get(
    routes.setup_mfa,

    securityMiddleware.validateCsrfToken,
    accountController.setupMfaPage
  );
  router.post(
    routes.setup_mfa,

    securityMiddleware.validateCsrfToken,
    accountController.verifySetupMfa
  );

  // WebAuthn/Passkeys management
  router.get(
    routes.passkeys,
    localsMiddleware.setActivePage('passkeys'),

    securityMiddleware.validateCsrfToken,
    accountController.passkeysPage
  );
  router.get(
    routes.setup_webauthn,

    securityMiddleware.validateCsrfToken,
    accountController.setupWebAuthnPage
  );

  router.post(
    routes.switch_account,

    securityMiddleware.validateCsrfToken,
    accountController.switchAccount
  );
  router.post(
    routes.add_account,

    securityMiddleware.validateCsrfToken,
    accountController.addAccount
  );
  router.delete(
    routes.remove_account,

    securityMiddleware.validateCsrfToken,
    accountController.removeAccount
  );
  router.get(
    routes.account_switcher_data,
    accountController.getAccountSwitcherData
  );

  router.post(
    routes.revoke_app,

    securityMiddleware.validateCsrfToken,
    accountController.revokeApp
  );
  router.post(
    routes.revoke_all_apps,

    securityMiddleware.validateCsrfToken,
    accountController.revokeAllApps
  );

  router.post(
    routes.logout_session,

    securityMiddleware.validateCsrfToken,
    accountController.logoutSession
  );
  router.post(
    routes.logout_all_other_sessions,

    securityMiddleware.validateCsrfToken,
    accountController.logoutAllOtherSessions
  );

  router.get(
    '/social/:provider/link',
    securityMiddleware.validateCsrfToken,
    accountController.linkSocialAccount
  );
  router.post(
    '/social/:provider/unlink',
    securityMiddleware.validateCsrfToken,
    accountController.unlinkSocialAccount
  );

  router.post(
    routes.resend_email_verification,
    securityMiddleware.validateCsrfToken,
    accountController.resendEmailVerification
  );

  router.post(
    routes.enable_recovery,
    securityMiddleware.validateCsrfToken,
    accountController.enableRecovery
  );
  router.post(
    routes.disable_recovery,
    securityMiddleware.validateCsrfToken,
    accountController.disableRecovery
  );
  router.get(
    routes.recovery_codes,
    securityMiddleware.validateCsrfToken,
    accountController.showRecoveryCodes
  );
  router.get(
    routes.verify_recovery_email,
    securityMiddleware.validateCsrfToken,
    accountController.verifyRecoveryEmail
  );
  router.post(
    routes.regenerate_backup_codes,
    securityMiddleware.validateCsrfToken,
    accountController.regenerateBackupCodes
  );
  router.get(
    routes.recovery_setup,
    securityMiddleware.validateCsrfToken,
    accountController.showRecoverySetup
  );

  // Security questions setup
  router.get(
    routes.security_questions_setup,
    securityMiddleware.validateCsrfToken,
    accountController.showSecurityQuestionsSetup
  );
  router.post(
    routes.security_questions_setup,
    securityMiddleware.validateCsrfToken,
    accountController.saveSecurityQuestions
  );

  // Notification preferences management
  router.post(
    routes.update_notification_preferences,
    securityMiddleware.validateCsrfToken,
    accountController.updateNotificationPreferences
  );

  return router;
};
