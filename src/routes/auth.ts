import express, { type Request, type Response, Router } from 'express';
import { param, query } from 'express-validator';
import { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import { IAuthController } from '../di/interfaces/auth-controller.interface.js';
import { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { ISocialTier1CompletionService } from '../services/social-tier1-completion.service.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { type SocialProvider } from '../types/social-integration.js';
import type { OIDCSocialContext } from '../types/session-data.js';
// Centralized rate limiters with dev/prod awareness
import {
  loginLimiter,
  registerLimiter,
  mfaVerifyLimiter,
  socialLoginLimiter,
  recoveryLimiter,
  forgotPasswordLimiter,
} from '../utils/rate-limiter.js';
import { rootLogger } from '../observability/logs/logger.js';
import {
  authQueryValidators,
  logoutValidators,
  oauthCallbackValidators,
  handleValidationErrors,
} from '../middlewares/validation.middleware.js';

/** Valid social providers for route param validation. */
const VALID_SOCIAL_PROVIDERS = [
  'google',
  'github',
  'facebook',
  'linkedin',
  'microsoft',
  'apple',
  'twitter',
];

const router = express.Router();

/**
 * Register auth routes with the DI injectable services
 */
export const authRoutes = (
  avatarUpload: IUploadMiddleware,
  configManager: IConfigManager,
  securityMiddleware: ISecurityMiddleware,
  uIMiddleware: IUIMiddleware,
  authController: IAuthController,
  tier1CompletionService: ISocialTier1CompletionService,
  sessionManager: ISessionManager
): Router => {
  const config = configManager.getConfig();
  const routes = config.deployment.routes.auth_routes;

  router.get(
    routes.login,
    authQueryValidators,
    handleValidationErrors,
    authController.login
  );
  router.post(
    routes.login,
    loginLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processLogin
  );
  router.get(
    routes.register,
    authQueryValidators,
    handleValidationErrors,
    authController.register
  );
  router.post(
    routes.register,
    registerLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRegister
  );
  router.get(
    routes.forgot_password,
    authQueryValidators,
    handleValidationErrors,
    authController.forgotPassword
  );
  router.post(
    routes.forgot_password,
    forgotPasswordLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processForgotPassword
  );
  router.get(
    routes.reset_password,
    authQueryValidators,
    handleValidationErrors,
    authController.resetPassword
  );
  router.post(
    routes.reset_password,
    securityMiddleware.validateCsrfToken,
    authController.processResetPassword
  );

  router.get(
    routes.email_verification,
    authQueryValidators,
    handleValidationErrors,
    authController.emailVerification
  );
  router.post(
    `${routes.email_verification}/request`,
    securityMiddleware.validateCsrfToken,
    authController.requestEmailVerification
  );
  router.post(
    `${routes.email_verification}/resend`,
    securityMiddleware.requireAuth,
    securityMiddleware.validateCsrfToken,
    authController.resendEmailVerification
  );
  router.get(
    routes.verify_email,
    authQueryValidators,
    handleValidationErrors,
    authController.verifyEmail
  );
  router.get(
    routes.email_verification_success,
    authController.emailVerificationSuccess
  );

  // Multi-factor authentication routes
  router.get(
    routes.account_select,
    authQueryValidators,
    handleValidationErrors,
    authController.accountSelect
  );
  router.get(
    routes.continue,
    authQueryValidators,
    handleValidationErrors,
    authController.continueWithAccount
  );
  router.get(
    routes.multi_factor,
    authQueryValidators,
    handleValidationErrors,
    authController.multiFactor
  );
  router.get(
    routes.mfa_verify,
    authQueryValidators,
    handleValidationErrors,
    authController.mfaVerify
  );
  router.post(
    routes.mfa_verify,
    mfaVerifyLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processMfaVerify
  );
  router.post(
    routes.mfa_resend,
    securityMiddleware.validateCsrfToken,
    authController.resendMfaCode
  );

  // MFA method selection (for multi-method MFA)
  router.get(
    routes.mfa_select,
    authQueryValidators,
    handleValidationErrors,
    authController.mfaSelect
  );
  router.post(
    routes.mfa_select,
    securityMiddleware.validateCsrfToken,
    authController.processMfaSelect
  );

  // WebAuthn MFA verification
  router.get(
    routes.mfa_webauthn,
    authQueryValidators,
    handleValidationErrors,
    authController.mfaWebAuthn
  );
  router.post(
    `${routes.mfa_webauthn}/options`,
    securityMiddleware.validateCsrfToken,
    authController.mfaWebAuthnOptions
  );
  router.post(
    `${routes.mfa_webauthn}/verify`,
    mfaVerifyLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processMfaWebAuthn
  );

  router.get(
    routes.logout,
    logoutValidators,
    handleValidationErrors,
    authController.logout
  );
  router.post(
    routes.logout,
    securityMiddleware.validateCsrfToken,
    authController.logout
  );

  // Social login/register initiation - Rate limited to prevent abuse
  router.get(
    '/social/:provider/login',
    socialLoginLimiter,
    authQueryValidators,
    handleValidationErrors,
    authController.socialLogin
  );
  router.get(
    '/social/:provider/register',
    socialLoginLimiter,
    authQueryValidators,
    handleValidationErrors,
    authController.socialRegister
  );

  // Social callback (handles both login and register) - Rate limited
  router.get(
    '/social/:provider/callback',
    socialLoginLimiter,
    oauthCallbackValidators,
    handleValidationErrors,
    authController.socialCallback
  );

  // Tier 1 social completion — receives ref from _ops gateway redirect
  router.get(
    '/social/:provider/complete',
    socialLoginLimiter,
    param('provider')
      .isIn(VALID_SOCIAL_PROVIDERS)
      .withMessage('Unknown provider'),
    query('ref').isUUID(4).withMessage('Invalid ref parameter'),
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const provider = req.params.provider as SocialProvider;
        const ref = req.query.ref as string;

        const result = await tier1CompletionService.complete(
          ref,
          provider,
          req
        );

        if (!result.success) {
          return res.status(400).render('auth/oidc/error.njk', {
            title: 'Authentication Failed',
            error: 'Social login could not be completed. Please try again.',
            redirectUrl: '/auth/login',
          });
        }

        // but we read the redirect path now for clarity)
        const oidcContext = sessionManager.get<OIDCSocialContext>(
          req,
          'oidcSocialContext'
        );
        const oidcPath = configManager.getConfig().oidc.path;

        // Regenerate session to prevent fixation.
        // sessionManager.regenerate() preserves all session data (tenant
        // context, locale, OIDC context, etc.) unlike raw req.session.regenerate()
        await sessionManager.regenerate(req);

        if (result.user) {
          sessionManager.setAuthenticated(req, {
            currentActiveLoggedUser: result.user,
          });
        }

        if (oidcContext?.uid) {
          return res.redirect(`${oidcPath}/interaction/${oidcContext.uid}`);
        }

        // Non-OIDC flow — redirect to dashboard
        return res.redirect('/');
      } catch (error) {
        rootLogger.error(
          { err: error, flow: 'tier1-social-completion' },
          'Tier 1 social completion error'
        );
        return res.status(500).render('auth/oidc/error.njk', {
          title: 'Server Error',
          error: 'An unexpected error occurred. Please try again.',
          redirectUrl: '/auth/login',
        });
      }
    }
  );

  // Social registration completion routes
  router.get(routes.social_password_setup, authController.socialPasswordSetup);
  router.post(
    routes.social_password_setup,
    securityMiddleware.validateCsrfToken,
    authController.processSocialPasswordSetup
  );
  router.get(routes.social_contact_info, authController.socialContactInfo);
  router.post(
    routes.social_contact_info,
    securityMiddleware.validateCsrfToken,
    authController.processSocialContactInfo
  );

  router.get(routes.account_recovery, authController.accountRecovery);
  router.post(
    routes.account_recovery,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processAccountRecovery
  );

  router.get(
    routes.recovery_method_select,
    authController.recoveryMethodSelect
  );
  router.post(
    routes.recovery_method_select,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoveryMethodSelect
  );

  router.get(routes.recovery_backup_codes, authController.recoveryBackupCodes);
  router.post(
    routes.recovery_backup_codes,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoveryBackupCodes
  );

  router.get(
    routes.recovery_secondary_email,
    authController.recoverySecondaryEmail
  );
  router.post(
    routes.recovery_secondary_email,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoverySecondaryEmail
  );

  // Security questions recovery
  router.get(
    routes.recovery_security_questions,
    authController.recoverySecurityQuestions
  );
  router.post(
    routes.recovery_security_questions,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoverySecurityQuestions
  );

  // SMS recovery
  router.get(routes.recovery_sms, authController.recoverySms);
  router.post(
    routes.recovery_sms,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoverySms
  );

  router.get(routes.recovery_verify_code, authController.recoveryVerifyCode);
  router.post(
    routes.recovery_verify_code,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    authController.processRecoveryVerifyCode
  );

  // Theme & Locale routes
  // User preferences (available to both authenticated and non-authenticated users)
  router.post(
    config.deployment.routes.auth_routes.update_theme,
    securityMiddleware.validateCsrfToken,
    uIMiddleware.updateTheme
  );
  router.post(
    config.deployment.routes.auth_routes.update_locale,
    securityMiddleware.validateCsrfToken,
    uIMiddleware.updateLocale
  );
  router.post(
    config.deployment.routes.auth_routes.update_sidebar,
    securityMiddleware.validateCsrfToken,
    uIMiddleware.updateSidebar
  );
  router.post(
    config.deployment.routes.auth_routes.update_timezone,
    securityMiddleware.validateCsrfToken,
    uIMiddleware.updateTimezone
  );

  return router;
};
