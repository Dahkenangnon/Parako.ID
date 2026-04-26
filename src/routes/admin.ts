import express, { Router } from 'express';
import { body } from 'express-validator';
import { IAdminHomeController } from '../di/interfaces/admin-home-controller.interface.js';
import { IAdminUsersController } from '../di/interfaces/admin-users-controller.interface.js';
import { IAdminActivitiesController } from '../di/interfaces/admin-activities-controller.interface.js';
import { IAdminOidcClientController } from '../di/interfaces/admin-oidc-client-controller.interface.js';
import { IAdminSessionsController } from '../di/interfaces/admin-sessions-controller.interface.js';
import { IAdminUserGrantsController } from '../di/interfaces/admin-user-grants-controller.interface.js';
import { IAdminSettingsController } from '../di/interfaces/admin-settings-controller.interface.js';
import { IAdminJwksController } from '../di/interfaces/admin-jwks-controller.interface.js';
import type { IAdminConfigurationController } from '../di/interfaces/admin-configuration-controller.interface.js';
import type { IAdminDataTransferController } from '../di/interfaces/admin-data-transfer-controller.interface.js';
import type { PlatformAdminController } from '../controllers/admin/platform.controller.js';
import { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { ILocalsMiddleware } from '../di/interfaces/locals-middleware.interface.js';
import { IConfigValidationMiddleware } from '../di/interfaces/config-validation-middleware.interface.js';
import { ISessionManager } from '../di/interfaces/session-manager.interface.js';
// Centralized rate limiters with dev/prod awareness
import {
  configUpdateLimiter,
  testEmailLimiter,
  revealSecretLimiter,
} from '../utils/rate-limiter.js';
import {
  adminUserValidators,
  adminSessionValidators,
  adminActivityValidators,
  adminGrantValidators,
  adminOidcClientValidators,
  userActivityValidators,
  oidcClientSourceValidator,
  createValidationErrorsHandlerForViews,
} from '../middlewares/validation.middleware.js';

/**
 * Register admin routes with the DI injectable services
 */
export const adminRoutes = (
  adminHomeController: IAdminHomeController,
  adminUsersController: IAdminUsersController,
  adminActivitiesController: IAdminActivitiesController,
  adminOidcClientController: IAdminOidcClientController,
  adminSessionsController: IAdminSessionsController,
  adminUserGrantsController: IAdminUserGrantsController,
  adminSettingsController: IAdminSettingsController,
  adminJwksController: IAdminJwksController,
  adminConfigurationController: IAdminConfigurationController,
  adminDataTransferController: IAdminDataTransferController,
  uploadMiddleware: IUploadMiddleware,
  securityMiddleware: ISecurityMiddleware,
  localsMiddleware: ILocalsMiddleware,
  configValidationMiddleware: IConfigValidationMiddleware,
  sessionManager: ISessionManager,
  platformAdminController?: PlatformAdminController
): Router => {
  const router = express.Router();

  const handleValidationErrorsForViews =
    createValidationErrorsHandlerForViews(sessionManager);

  /**
   * Admin Routes
   * All admin routes require admin authentication
   */

  router.use(securityMiddleware.requireAdmin);

  // Apply CSRF token generation to all admin routes
  router.use(securityMiddleware.generateCsrfToken);

  router.use(localsMiddleware.setAccountLocals);

  router.get(
    '/',
    localsMiddleware.setActivePage('dashboard'),
    adminHomeController.dashboard
  );
  router.get(
    '/dashboard',
    localsMiddleware.setActivePage('dashboard'),
    adminHomeController.dashboard
  );

  router.post(
    '/update-theme',
    securityMiddleware.validateCsrfToken,
    adminHomeController.updateTheme
  );

  // User Management Routes
  // List users with search, filter, and pagination
  router.get(
    '/users',
    localsMiddleware.setActivePage('users'),
    adminUserValidators,
    handleValidationErrorsForViews,
    adminUsersController.list
  );

  router.get(
    '/users/new',
    localsMiddleware.setActivePage('users-new'),
    adminUsersController.create
  );

  router.post(
    '/users/new',
    securityMiddleware.validateCsrfToken,
    [
      body('email').isEmail().withMessage('Valid email is required'),
      body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters'),
      body('given_name').notEmpty().withMessage('First name is required'),
      body('family_name').notEmpty().withMessage('Last name is required'),
    ],
    adminUsersController.store
  );

  router.get(
    '/users/:id',
    localsMiddleware.setActivePage('users'),
    adminUsersController.show
  );

  router.get(
    '/users/:id/edit',
    localsMiddleware.setActivePage('users'),
    adminUsersController.edit
  );

  router.post(
    '/users/:id/edit',
    securityMiddleware.validateCsrfToken,
    [
      body('email').isEmail().withMessage('Valid email is required'),
      body('given_name').notEmpty().withMessage('First name is required'),
      body('family_name').notEmpty().withMessage('Last name is required'),
    ],
    adminUsersController.update
  );

  router.post(
    '/users/:id/enable',
    securityMiddleware.validateCsrfToken,
    adminUsersController.enable
  );
  router.post(
    '/users/:id/disable',
    securityMiddleware.validateCsrfToken,
    adminUsersController.disable
  );
  router.delete(
    '/users/:id',
    securityMiddleware.validateCsrfToken,
    adminUsersController.destroy
  );

  router.get(
    '/users/:id/activities',
    userActivityValidators,
    handleValidationErrorsForViews,
    adminUsersController.activities
  );

  // OIDC Clients Management
  router.get(
    '/oidc-clients',
    localsMiddleware.setActivePage('oidc-clients'),
    adminOidcClientValidators,
    handleValidationErrorsForViews,
    adminOidcClientController.list
  );
  router.get(
    '/oidc-clients/create',
    localsMiddleware.setActivePage('oidc-clients'),
    adminOidcClientController.create
  );
  router.post(
    '/oidc-clients',
    securityMiddleware.validateCsrfToken,
    [
      body('client_name').notEmpty().withMessage('Client name is required'),
      body('application_type')
        .isIn(['web', 'spa', 'native'])
        .withMessage('Valid application type is required'),
    ],
    adminOidcClientController.store
  );
  router.get(
    '/oidc-clients/view/:id',
    localsMiddleware.setActivePage('oidc-clients'),
    oidcClientSourceValidator,
    handleValidationErrorsForViews,
    adminOidcClientController.show
  );
  router.get(
    '/oidc-clients/edit/:id',
    localsMiddleware.setActivePage('oidc-clients'),
    oidcClientSourceValidator,
    handleValidationErrorsForViews,
    adminOidcClientController.edit
  );
  router.post(
    '/oidc-clients/edit/:id',
    securityMiddleware.validateCsrfToken,
    [
      body('client_name').notEmpty().withMessage('Client name is required'),
      body('application_type')
        .isIn(['web', 'spa', 'native'])
        .withMessage('Valid application type is required'),
    ],
    adminOidcClientController.update
  );
  router.post(
    '/oidc-clients/activate/:id',
    securityMiddleware.validateCsrfToken,
    adminOidcClientController.activate
  );
  router.post(
    '/oidc-clients/deactivate/:id',
    securityMiddleware.validateCsrfToken,
    adminOidcClientController.deactivate
  );
  router.post(
    '/oidc-clients/regenerate-secret/:id',
    securityMiddleware.validateCsrfToken,
    adminOidcClientController.regenerateSecret
  );
  router.post(
    '/oidc-clients/delete/:id',
    securityMiddleware.validateCsrfToken,
    adminOidcClientController.destroy
  );
  router.get('/oidc-clients/statistics', adminOidcClientController.statistics);
  router.get('/oidc-clients/search', adminOidcClientController.search);
  router.post(
    '/oidc-clients/:id/reveal-secret',
    securityMiddleware.validateCsrfToken,
    revealSecretLimiter,
    adminOidcClientController.revealSecret
  );

  // JWKS Key Management
  router.get(
    '/jwks',
    localsMiddleware.setActivePage('jwks'),
    adminJwksController.list
  );
  router.get(
    '/jwks/:kid',
    localsMiddleware.setActivePage('jwks'),
    adminJwksController.show
  );
  router.post(
    '/jwks/rotate',
    securityMiddleware.validateCsrfToken,
    adminJwksController.rotate
  );
  router.post(
    '/jwks/retire-expired',
    securityMiddleware.validateCsrfToken,
    adminJwksController.retireExpired
  );

  // User Activities
  router.get(
    '/activities',
    localsMiddleware.setActivePage('activities'),
    adminActivityValidators,
    handleValidationErrorsForViews,
    adminActivitiesController.list
  );
  router.post(
    '/activities/clear-old',
    securityMiddleware.validateCsrfToken,
    adminActivitiesController.clearOldActivities
  );
  router.get(
    '/activities/:id',
    localsMiddleware.setActivePage('activities'),
    adminActivitiesController.show
  );

  // User Sessions Management
  router.get(
    '/sessions',
    localsMiddleware.setActivePage('sessions'),
    adminSessionValidators,
    handleValidationErrorsForViews,
    adminSessionsController.list
  );
  router.get(
    '/sessions/stats',
    localsMiddleware.setActivePage('sessions'),
    adminSessionsController.getStats
  );
  router.get(
    '/sessions/:id',
    localsMiddleware.setActivePage('sessions'),
    adminSessionsController.show
  );
  router.post(
    '/sessions/revoke-user/:username',
    securityMiddleware.validateCsrfToken,
    adminSessionsController.revokeUserSessions
  );
  router.post(
    '/sessions/:id/revoke',
    securityMiddleware.validateCsrfToken,
    adminSessionsController.revokeSession
  );

  // User Grants Management
  router.get(
    '/user-grants',
    localsMiddleware.setActivePage('user-grants'),
    adminGrantValidators,
    handleValidationErrorsForViews,
    adminUserGrantsController.list
  );
  router.get(
    '/user-grants/stats',
    localsMiddleware.setActivePage('user-grants'),
    adminUserGrantsController.getStats
  );
  router.get(
    '/user-grants/:id',
    localsMiddleware.setActivePage('user-grants'),
    adminUserGrantsController.show
  );
  router.post(
    '/user-grants/:id/revoke',
    securityMiddleware.validateCsrfToken,
    adminUserGrantsController.revokeGrant
  );
  router.post(
    '/user-grants/revoke-user/:username',
    securityMiddleware.validateCsrfToken,
    adminUserGrantsController.revokeUserGrants
  );
  router.post(
    '/user-grants/revoke-client/:clientId',
    securityMiddleware.validateCsrfToken,
    adminUserGrantsController.revokeClientGrants
  );

  // Data Transfer Routes (unified import/export hub)
  router.get(
    '/data-transfer',
    localsMiddleware.setActivePage('data-transfer'),
    adminDataTransferController.overview
  );
  router.get(
    '/data-transfer/:entityId',
    localsMiddleware.setActivePage('data-transfer'),
    adminDataTransferController.entityPage
  );
  router.post(
    '/data-transfer/:entityId/import',
    express.json({ limit: '10mb' }),
    securityMiddleware.validateCsrfToken,
    adminDataTransferController.startImport
  );
  router.get(
    '/data-transfer/:entityId/import/template',
    adminDataTransferController.downloadTemplate
  );
  router.get(
    '/data-transfer/:entityId/import/:jobId/progress',
    adminDataTransferController.importProgress
  );
  router.get(
    '/data-transfer/:entityId/import/:jobId/status',
    adminDataTransferController.importStatus
  );
  router.get(
    '/data-transfer/:entityId/export',
    adminDataTransferController.exportData
  );

  // Tenant Management (platform-only, HTML views)
  if (platformAdminController) {
    router.get(
      '/tenants',
      securityMiddleware.requirePlatformTenant,
      localsMiddleware.setActivePage('tenants'),
      platformAdminController.listTenantsPage
    );
    router.get(
      '/tenants/new',
      securityMiddleware.requirePlatformTenant,
      localsMiddleware.setActivePage('tenants'),
      platformAdminController.createTenantPage
    );
    router.post(
      '/tenants/new',
      securityMiddleware.requirePlatformTenant,
      securityMiddleware.validateCsrfToken,
      platformAdminController.storeTenant
    );
    router.get(
      '/tenants/:slug',
      securityMiddleware.requirePlatformTenant,
      localsMiddleware.setActivePage('tenants'),
      platformAdminController.showTenantPage
    );
    router.get(
      '/tenants/:slug/edit',
      securityMiddleware.requirePlatformTenant,
      localsMiddleware.setActivePage('tenants'),
      platformAdminController.editTenantPage
    );
    router.post(
      '/tenants/:slug/edit',
      securityMiddleware.requirePlatformTenant,
      securityMiddleware.validateCsrfToken,
      platformAdminController.updateTenant
    );
    router.post(
      '/tenants/:slug/status',
      securityMiddleware.requirePlatformTenant,
      securityMiddleware.validateCsrfToken,
      platformAdminController.updateTenantStatus
    );
  }

  // Settings Management Routes (platform-only)
  router.use('/settings', securityMiddleware.requirePlatformTenant);
  router.get(
    '/settings',
    localsMiddleware.setActivePage('settings'),
    adminSettingsController.overview
  );
  router.get('/settings/stats', adminSettingsController.stats);
  router.get('/settings/health', adminSettingsController.healthCheck);
  router.get('/settings/export', adminSettingsController.exportConfig);
  router.get(
    '/settings/import',
    localsMiddleware.setActivePage('settings-import'),
    adminSettingsController.importPage
  );
  router.post(
    '/settings/reload',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.reload
  );

  // Application Settings
  router.get(
    '/settings/application',
    localsMiddleware.setActivePage('settings-application'),
    adminSettingsController.application
  );
  router.post(
    '/settings/application',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.application
  );

  // Branding Settings
  router.get(
    '/settings/branding',
    localsMiddleware.setActivePage('settings-branding'),
    adminSettingsController.branding
  );
  router.post(
    '/settings/branding',
    // Use .any() to accept all file fields, then filter for 'logo'
    (req, res, next) => {
      uploadMiddleware.logoUpload.any()(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_COUNT') {
            // Use multer without file handling to parse the text fields
            uploadMiddleware.logoUpload.none()(req, res, (parseErr: any) => {
              if (parseErr) {
                return next(parseErr);
              }
              next();
            });
            return;
          }
          return next(err);
        }
        // If files were uploaded via .any(), find the 'logo' file and set it as req.file
        const files = (req as any).files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          const logoFile = files.find(f => f.fieldname === 'logo');
          if (logoFile) {
            (req as any).file = logoFile;
          }
        }
        next();
      });
    },
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.branding
  );
  router.delete(
    '/settings/branding/remove-logo',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.removeLogo
  );
  router.post(
    '/settings/branding/reset-colors',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.resetColors
  );
  router.post(
    '/settings/branding/reset-fonts',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.resetFonts
  );

  // Dark mode logo upload
  router.post(
    '/settings/branding/logo-dark',
    uploadMiddleware.logoUpload.single('logoDark'),
    securityMiddleware.validateCsrfToken,
    adminSettingsController.uploadLogoDark
  );
  router.delete(
    '/settings/branding/remove-logo-dark',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.removeLogoDark
  );

  // Icon logo (light) upload
  router.post(
    '/settings/branding/logo-icon',
    uploadMiddleware.logoUpload.single('logoIcon'),
    securityMiddleware.validateCsrfToken,
    adminSettingsController.uploadLogoIcon
  );
  router.delete(
    '/settings/branding/remove-logo-icon',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.removeLogoIcon
  );

  // Icon logo (dark) upload
  router.post(
    '/settings/branding/logo-icon-dark',
    uploadMiddleware.logoUpload.single('logoIconDark'),
    securityMiddleware.validateCsrfToken,
    adminSettingsController.uploadLogoIconDark
  );
  router.delete(
    '/settings/branding/remove-logo-icon-dark',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.removeLogoIconDark
  );

  router.post(
    '/settings/branding/favicon',
    uploadMiddleware.faviconUpload.single('favicon'),
    securityMiddleware.validateCsrfToken,
    adminSettingsController.uploadFavicon
  );
  router.delete(
    '/settings/branding/remove-favicon',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.removeFavicon
  );

  // Deployment Settings
  router.get(
    '/settings/deployment',
    localsMiddleware.setActivePage('settings-deployment'),
    adminSettingsController.deployment
  );
  router.post(
    '/settings/deployment',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.deployment
  );

  // Security Settings sub-pages
  router.get(
    '/settings/security',
    localsMiddleware.setActivePage('settings-security'),
    adminSettingsController.securityAuthentication
  );
  router.post(
    '/settings/security',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.securityAuthentication
  );

  router.get(
    '/settings/security/mfa',
    localsMiddleware.setActivePage('settings-security'),
    adminSettingsController.securityMfa
  );
  router.post(
    '/settings/security/mfa',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.securityMfa
  );

  router.get(
    '/settings/security/sessions',
    localsMiddleware.setActivePage('settings-security'),
    adminSettingsController.securitySessions
  );
  router.post(
    '/settings/security/sessions',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.securitySessions
  );

  router.get(
    '/settings/security/protection',
    localsMiddleware.setActivePage('settings-security'),
    adminSettingsController.securityProtection
  );
  router.post(
    '/settings/security/protection',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.securityProtection
  );

  router.get(
    '/settings/security/secrets',
    localsMiddleware.setActivePage('settings-security'),
    adminSettingsController.securitySecrets
  );
  router.post(
    '/settings/security/secrets',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.securitySecrets
  );

  // Features Settings
  router.get(
    '/settings/features',
    localsMiddleware.setActivePage('settings-features'),
    adminSettingsController.features
  );
  router.post(
    '/settings/features',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminSettingsController.features
  );

  // OIDC Settings
  router.get(
    '/settings/oidc',
    localsMiddleware.setActivePage('settings-oidc'),
    adminSettingsController.oidc
  );
  router.post(
    '/settings/oidc',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    configValidationMiddleware.validateConfigUpdate('oidc'),
    adminSettingsController.oidc
  );

  // Integrations Settings
  router.get(
    '/settings/integrations',
    localsMiddleware.setActivePage('settings-integrations'),
    adminSettingsController.integrations
  );
  router.post(
    '/settings/integrations',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    configValidationMiddleware.validateConfigUpdate('integrations'),
    adminSettingsController.integrations
  );

  // Test Email Route - Rate limited to prevent abuse
  router.post(
    '/settings/integrations/test-email',
    securityMiddleware.validateCsrfToken,
    testEmailLimiter,
    adminSettingsController.testEmail
  );

  router.post(
    '/settings/reveal-secret',
    securityMiddleware.validateCsrfToken,
    revealSecretLimiter,
    adminSettingsController.revealSecret
  );

  // Configuration Rollback Route
  router.post(
    '/settings/rollback',
    securityMiddleware.validateCsrfToken,
    adminSettingsController.rollback
  );

  // Configuration Import Routes
  // Note: These routes need larger body size limit for config JSON
  router.post(
    '/settings/import/preview',
    express.json({ limit: '1mb' }), // Allow up to 1MB for config imports
    securityMiddleware.validateCsrfToken,
    adminSettingsController.importConfigPreview
  );

  router.post(
    '/settings/import/apply',
    express.json({ limit: '1mb' }), // Allow up to 1MB for config imports
    securityMiddleware.validateCsrfToken,
    adminSettingsController.applyImport
  );

  // ── Tenant Configuration (per-tenant overrides) ────────────────────────────

  router.get(
    '/configuration',
    localsMiddleware.setActivePage('configuration'),
    adminConfigurationController.overview
  );

  // ── Specific routes MUST come BEFORE the parameterized /:section route ────

  // Branding: logo upload/remove routes
  router.post(
    '/configuration/branding',
    (req, res, next) => {
      uploadMiddleware.logoUpload.any()(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_COUNT') {
            uploadMiddleware.logoUpload.none()(req, res, (parseErr: any) => {
              if (parseErr) return next(parseErr);
              next();
            });
            return;
          }
          return next(err);
        }
        const files = (req as any).files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          const logoFile = files.find(f => f.fieldname === 'logo');
          if (logoFile) (req as any).file = logoFile;
        }
        next();
      });
    },
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    (req, _res, next) => {
      req.params.section = 'branding';
      next();
    },
    adminConfigurationController.updateSection
  );
  router.delete(
    '/configuration/branding/remove-logo',
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.removeLogo
  );
  router.post(
    '/configuration/branding/logo-dark',
    uploadMiddleware.logoUpload.single('logoDark'),
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.uploadLogoDark
  );
  router.delete(
    '/configuration/branding/remove-logo-dark',
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.removeLogoDark
  );
  router.post(
    '/configuration/branding/logo-icon',
    uploadMiddleware.logoUpload.single('logoIcon'),
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.uploadLogoIcon
  );
  router.delete(
    '/configuration/branding/remove-logo-icon',
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.removeLogoIcon
  );
  router.post(
    '/configuration/branding/logo-icon-dark',
    uploadMiddleware.logoUpload.single('logoIconDark'),
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.uploadLogoIconDark
  );
  router.delete(
    '/configuration/branding/remove-logo-icon-dark',
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.removeLogoIconDark
  );
  router.post(
    '/configuration/branding/favicon',
    uploadMiddleware.faviconUpload.single('favicon'),
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.uploadFavicon
  );
  router.delete(
    '/configuration/branding/remove-favicon',
    securityMiddleware.validateCsrfToken,
    adminConfigurationController.removeFavicon
  );
  router.post(
    '/configuration/branding/reset-colors',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminConfigurationController.resetColors
  );
  router.post(
    '/configuration/branding/reset-fonts',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminConfigurationController.resetFonts
  );

  // Integrations: test email and reveal secret
  router.post(
    '/configuration/integrations/test-email',
    securityMiddleware.validateCsrfToken,
    testEmailLimiter,
    adminConfigurationController.testEmail
  );
  router.post(
    '/configuration/reveal-secret',
    securityMiddleware.validateCsrfToken,
    revealSecretLimiter,
    adminConfigurationController.revealSecret
  );

  // Per-section reset (reverts section to defaults)
  router.post(
    '/configuration/:section/reset',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminConfigurationController.resetSection
  );

  // ── Parameterized routes (MUST come AFTER specific routes) ────────────────

  router.get('/configuration/:section', adminConfigurationController.section);
  router.post(
    '/configuration/:section',
    securityMiddleware.validateCsrfToken,
    configUpdateLimiter,
    adminConfigurationController.updateSection
  );

  return router;
};
