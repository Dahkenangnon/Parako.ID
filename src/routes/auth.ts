import express, { type Request, type Response, Router } from 'express';
import { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import { IAuthController } from '../di/interfaces/auth-controller.interface.js';
import { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { ISocialTier1CompletionService } from '../services/social-tier1-completion.service.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { type SocialProvider } from '../types/social-integration.js';
import type { OIDCSocialContext } from '../types/session-data.js';
// Centralized rate limiters with dev/prod awareness
import {
  loginLimiter,
  loginBruteForceByIdentifierAndIp,
  loginBruteForceByIp,
  registerLimiter,
  mfaVerifyLimiter,
  socialLoginLimiter,
  recoveryLimiter,
  forgotPasswordLimiter,
} from '../utils/rate-limiter.js';
import { rootLogger } from '../observability/logs/logger.js';
import {
  validateHtmlParams,
  validateHtmlQuery,
} from '../middlewares/validate-html.middleware.js';
import { authQueryParamsSchema } from '../validators/auth/query-params.js';
import { logoutQuerySchema } from '../validators/auth/logout.js';
import { oauthCallbackQuerySchema } from '../validators/auth/oauth-callback.js';
import {
  socialProviderParamSchema,
  socialRefQuerySchema,
} from '../validators/auth/social.js';
import { asyncHandler } from '../middlewares/async-handler.js';

export const authRoutes = (
  avatarUpload: IUploadMiddleware,
  configManager: IConfigManager,
  securityMiddleware: ISecurityMiddleware,
  uIMiddleware: IUIMiddleware,
  authController: IAuthController,
  tier1CompletionService: ISocialTier1CompletionService,
  sessionManager: ISessionManager,
  logger: ILogger
): Router => {
  const router = express.Router();
  const config = configManager.getConfig();
  const routes = config.deployment.routes.auth_routes;
  const htmlDeps = { sessionManager, logger };
  const validateAuthQuery = validateHtmlQuery(authQueryParamsSchema, htmlDeps);
  const validateLogoutQuery = validateHtmlQuery(logoutQuerySchema, htmlDeps);
  const validateOauthCallbackQuery = validateHtmlQuery(
    oauthCallbackQuerySchema,
    htmlDeps
  );
  const validateSocialProviderParams = validateHtmlParams(
    socialProviderParamSchema,
    htmlDeps,
    '/auth/login'
  );
  const validateSocialRefQuery = validateHtmlQuery(
    socialRefQuerySchema,
    htmlDeps
  );

  router.get(
    routes.login,
    validateAuthQuery,
    asyncHandler('auth.login.form', authController.login)
  );
  router.post(
    routes.login,
    loginLimiter,
    loginBruteForceByIp,
    loginBruteForceByIdentifierAndIp,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.login.process', authController.processLogin)
  );
  router.get(
    routes.register,
    validateAuthQuery,
    asyncHandler('auth.register.form', authController.register)
  );
  router.post(
    routes.register,
    registerLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.register.process', authController.processRegister)
  );
  router.get(
    routes.forgot_password,
    validateAuthQuery,
    asyncHandler('auth.forgot_password.form', authController.forgotPassword)
  );
  router.post(
    routes.forgot_password,
    forgotPasswordLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.forgot_password.process',
      authController.processForgotPassword
    )
  );
  router.get(
    routes.reset_password,
    validateAuthQuery,
    asyncHandler('auth.reset_password.form', authController.resetPassword)
  );
  router.post(
    routes.reset_password,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.reset_password.process',
      authController.processResetPassword
    )
  );

  router.get(
    routes.email_verification,
    validateAuthQuery,
    asyncHandler(
      'auth.email_verification.form',
      authController.emailVerification
    )
  );
  router.post(
    `${routes.email_verification}/request`,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.email_verification.request',
      authController.requestEmailVerification
    )
  );
  router.post(
    `${routes.email_verification}/resend`,
    securityMiddleware.requireAuth,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.email_verification.resend',
      authController.resendEmailVerification
    )
  );
  router.get(
    routes.verify_email,
    validateAuthQuery,
    asyncHandler('auth.verify_email', authController.verifyEmail)
  );
  router.get(
    routes.email_verification_success,
    asyncHandler(
      'auth.email_verification.success',
      authController.emailVerificationSuccess
    )
  );
  router.get(
    routes.phone_verification,
    validateAuthQuery,
    asyncHandler(
      'auth.phone_verification.form',
      authController.phoneVerification
    )
  );
  router.post(
    routes.phone_verification,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.phone_verification.process',
      authController.processPhoneVerification
    )
  );
  router.post(
    `${routes.phone_verification}/resend`,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.phone_verification.resend',
      authController.resendPhoneVerification
    )
  );

  // Multi-factor authentication routes
  router.get(
    routes.account_select,
    validateAuthQuery,
    asyncHandler('auth.account_select.form', authController.accountSelect)
  );
  router.get(
    routes.continue,
    validateAuthQuery,
    asyncHandler(
      'auth.continue_with_account',
      authController.continueWithAccount
    )
  );
  router.get(
    routes.multi_factor,
    validateAuthQuery,
    asyncHandler('auth.multi_factor', authController.multiFactor)
  );
  router.get(
    routes.mfa_verify,
    validateAuthQuery,
    asyncHandler('auth.mfa_verify.form', authController.mfaVerify)
  );
  router.post(
    routes.mfa_verify,
    mfaVerifyLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.mfa_verify.process', authController.processMfaVerify)
  );
  router.post(
    routes.mfa_resend,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.mfa.resend_code', authController.resendMfaCode)
  );

  // MFA method selection (for multi-method MFA)
  router.get(
    routes.mfa_select,
    validateAuthQuery,
    asyncHandler('auth.mfa_select.form', authController.mfaSelect)
  );
  router.post(
    routes.mfa_select,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.mfa_select.process', authController.processMfaSelect)
  );

  // WebAuthn MFA verification
  router.get(
    routes.mfa_webauthn,
    validateAuthQuery,
    asyncHandler('auth.mfa_webauthn.form', authController.mfaWebAuthn)
  );
  router.post(
    `${routes.mfa_webauthn}/options`,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.mfa_webauthn.options', authController.mfaWebAuthnOptions)
  );
  router.post(
    `${routes.mfa_webauthn}/verify`,
    mfaVerifyLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.mfa_webauthn.verify', authController.processMfaWebAuthn)
  );

  router.get(
    routes.logout,
    validateLogoutQuery,
    asyncHandler('auth.logout.form', authController.logout)
  );
  router.post(
    routes.logout,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.logout.process', authController.logout)
  );

  // Social login/register initiation - Rate limited to prevent abuse
  router.get(
    '/social/:provider/login',
    socialLoginLimiter,
    validateSocialProviderParams,
    validateAuthQuery,
    asyncHandler('auth.social.login', authController.socialLogin)
  );
  router.get(
    '/social/:provider/register',
    socialLoginLimiter,
    validateSocialProviderParams,
    validateAuthQuery,
    asyncHandler('auth.social.register', authController.socialRegister)
  );

  // Social callback (handles both login and register) - Rate limited
  router.get(
    '/social/:provider/callback',
    socialLoginLimiter,
    validateSocialProviderParams,
    validateOauthCallbackQuery,
    asyncHandler('auth.social.callback', authController.socialCallback)
  );

  // Tier 1 social completion — receives ref from _ops gateway redirect
  router.get(
    '/social/:provider/complete',
    socialLoginLimiter,
    validateSocialProviderParams,
    validateSocialRefQuery,
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
  router.get(
    routes.social_password_setup,
    asyncHandler(
      'auth.social.password_setup.form',
      authController.socialPasswordSetup
    )
  );
  router.post(
    routes.social_password_setup,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.social.password_setup.process',
      authController.processSocialPasswordSetup
    )
  );
  router.get(
    routes.social_contact_info,
    asyncHandler(
      'auth.social.contact_info.form',
      authController.socialContactInfo
    )
  );
  router.post(
    routes.social_contact_info,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.social.contact_info.process',
      authController.processSocialContactInfo
    )
  );

  router.get(
    routes.account_recovery,
    asyncHandler('auth.recovery.entry.form', authController.accountRecovery)
  );
  router.post(
    routes.account_recovery,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.entry.process',
      authController.processAccountRecovery
    )
  );

  router.get(
    routes.recovery_method_select,
    asyncHandler(
      'auth.recovery.method_select.form',
      authController.recoveryMethodSelect
    )
  );
  router.post(
    routes.recovery_method_select,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.method_select.process',
      authController.processRecoveryMethodSelect
    )
  );

  router.get(
    routes.recovery_backup_codes,
    asyncHandler(
      'auth.recovery.backup_codes.form',
      authController.recoveryBackupCodes
    )
  );
  router.post(
    routes.recovery_backup_codes,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.backup_codes.process',
      authController.processRecoveryBackupCodes
    )
  );

  router.get(
    routes.recovery_secondary_email,
    asyncHandler(
      'auth.recovery.secondary_email.form',
      authController.recoverySecondaryEmail
    )
  );
  router.post(
    routes.recovery_secondary_email,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.secondary_email.process',
      authController.processRecoverySecondaryEmail
    )
  );

  // Security questions recovery
  router.get(
    routes.recovery_security_questions,
    asyncHandler(
      'auth.recovery.security_questions.form',
      authController.recoverySecurityQuestions
    )
  );
  router.post(
    routes.recovery_security_questions,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.security_questions.process',
      authController.processRecoverySecurityQuestions
    )
  );

  // SMS recovery
  router.get(
    routes.recovery_sms,
    asyncHandler('auth.recovery.sms.form', authController.recoverySms)
  );
  router.post(
    routes.recovery_sms,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler('auth.recovery.sms.process', authController.processRecoverySms)
  );

  router.get(
    routes.recovery_verify_code,
    asyncHandler(
      'auth.recovery.verify_code.form',
      authController.recoveryVerifyCode
    )
  );
  router.post(
    routes.recovery_verify_code,
    recoveryLimiter,
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'auth.recovery.verify_code.process',
      authController.processRecoveryVerifyCode
    )
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
