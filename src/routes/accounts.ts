import express, { Router } from 'express';
import { IAccountController } from '../di/interfaces/account-controller.interface.js';
import { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { ILocalsMiddleware } from '../di/interfaces/locals-middleware.interface.js';
import { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import { changePasswordLimiter } from '../utils/rate-limiter.js';
import { asyncHandler } from '../middlewares/async-handler.js';

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

  router.get(
    routes.dashboard,
    localsMiddleware.setActivePage('my-account'),
    asyncHandler('account.dashboard', accountController.myAccount)
  );

  router.get(
    routes.settings,
    asyncHandler('account.settings.redirect', accountController.settings)
  );

  router.get(
    routes.settings_profile,
    localsMiddleware.setActivePage('settings-profile'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.settings.profile', accountController.settingsProfile)
  );
  router.get(
    routes.settings_preferences,
    localsMiddleware.setActivePage('settings-preferences'),
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.settings.preferences',
      accountController.settingsPreferences
    )
  );
  router.get(
    routes.settings_notifications,
    localsMiddleware.setActivePage('settings-notifications'),
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.settings.notifications',
      accountController.settingsNotifications
    )
  );
  router.get(
    routes.settings_security,
    localsMiddleware.setActivePage('settings-security'),
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.settings.security',
      accountController.settingsSecurity
    )
  );
  router.get(
    routes.settings_recovery,
    localsMiddleware.setActivePage('settings-recovery'),
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.settings.recovery',
      accountController.settingsRecovery
    )
  );
  router.get(
    routes.settings_social,
    localsMiddleware.setActivePage('settings-social'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.settings.social', accountController.settingsSocial)
  );

  router.get(
    routes.apps,
    localsMiddleware.setActivePage('apps'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.apps.list', accountController.apps)
  );

  router.get(
    routes.sessions,
    localsMiddleware.setActivePage('sessions'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.sessions.list', accountController.sessions)
  );

  router.post(
    routes.update_profile,
    avatarUpload.avatarUpload.single('avatar'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.profile.update', accountController.updateProfile)
  );

  router.post(
    routes.change_password,
    changePasswordLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.password.change', accountController.changePassword)
  );
  router.delete(
    routes.remove_avatar,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.avatar.remove', accountController.removeAvatar)
  );

  // Multi-factor authentication
  router.post(
    routes.enable_mfa,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.mfa.enable', accountController.enableMfa)
  );
  router.post(
    routes.disable_mfa,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.mfa.disable', accountController.disableMfa)
  );
  router.get(
    routes.setup_mfa,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.mfa.setup.form', accountController.setupMfaPage)
  );
  router.post(
    routes.setup_mfa,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.mfa.setup.verify', accountController.verifySetupMfa)
  );

  // WebAuthn/Passkeys management
  router.get(
    routes.passkeys,
    localsMiddleware.setActivePage('passkeys'),
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.passkeys.list', accountController.passkeysPage)
  );
  router.get(
    routes.setup_webauthn,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.passkeys.setup', accountController.setupWebAuthnPage)
  );

  router.post(
    routes.switch_account,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.switch', accountController.switchAccount)
  );
  router.post(
    routes.add_account,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.add', accountController.addAccount)
  );
  router.delete(
    routes.remove_account,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.remove', accountController.removeAccount)
  );
  router.get(
    routes.account_switcher_data,
    asyncHandler(
      'account.switcher_data',
      accountController.getAccountSwitcherData
    )
  );

  router.post(
    routes.revoke_app,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.apps.revoke', accountController.revokeApp)
  );
  router.post(
    routes.revoke_all_apps,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.apps.revoke_all', accountController.revokeAllApps)
  );

  router.post(
    routes.logout_session,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.sessions.logout_one', accountController.logoutSession)
  );
  router.post(
    routes.logout_all_other_sessions,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.sessions.logout_all',
      accountController.logoutAllOtherSessions
    )
  );

  router.get(
    '/social/:provider/link',
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.social.link', accountController.linkSocialAccount)
  );
  router.post(
    '/social/:provider/unlink',
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.social.unlink', accountController.unlinkSocialAccount)
  );

  router.post(
    routes.resend_email_verification,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.email.resend_verification',
      accountController.resendEmailVerification
    )
  );

  router.post(
    routes.enable_recovery,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.recovery.enable', accountController.enableRecovery)
  );
  router.post(
    routes.disable_recovery,
    securityMiddleware.validateCsrfToken,
    asyncHandler('account.recovery.disable', accountController.disableRecovery)
  );
  router.get(
    routes.recovery_codes,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.codes.show',
      accountController.showRecoveryCodes
    )
  );
  router.get(
    routes.verify_recovery_email,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.email.verify',
      accountController.verifyRecoveryEmail
    )
  );
  router.post(
    routes.regenerate_backup_codes,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.codes.regenerate',
      accountController.regenerateBackupCodes
    )
  );
  router.get(
    routes.recovery_setup,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.setup.show',
      accountController.showRecoverySetup
    )
  );

  // Security questions setup
  router.get(
    routes.security_questions_setup,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.security_questions.show',
      accountController.showSecurityQuestionsSetup
    )
  );
  router.post(
    routes.security_questions_setup,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.recovery.security_questions.save',
      accountController.saveSecurityQuestions
    )
  );

  router.post(
    routes.update_notification_preferences,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'account.notifications.update_preferences',
      accountController.updateNotificationPreferences
    )
  );

  return router;
};
