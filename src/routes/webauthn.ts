import { Router } from 'express';
import type { IWebAuthnController } from '../di/interfaces/webauthn-controller.interface.js';
import type { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { asyncHandler } from '../middlewares/async-handler.js';
import {
  validateLegacyJsonBody,
  validateLegacyJsonParams,
} from '../middlewares/validate-json-legacy.middleware.js';
import { webauthnVerifyRegistrationBodySchema } from '../validators/webauthn/registration.js';
import {
  webauthnRenameCredentialBodySchema,
  webauthnRenameCredentialParamsSchema,
} from '../validators/webauthn/rename.js';

/**
 * Register WebAuthn API routes with DI injectable services
 */
export const webauthnRoutes = (
  securityMiddleware: ISecurityMiddleware,
  webauthnController: IWebAuthnController,
  logger: ILogger
): Router => {
  const router = Router();
  const jsonDeps = { logger };

  // Authentication flow (for MFA during login)
  // These routes do NOT require authentication since user is in
  // the process of authenticating via MFA

  router.post(
    '/authenticate/options',
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'webauthn.authenticate.options',
      webauthnController.getAuthenticationOptions
    )
  );

  router.post(
    '/authenticate/verify',
    securityMiddleware.validateCsrfToken,
    asyncHandler(
      'webauthn.authenticate.verify',
      webauthnController.verifyAuthentication
    )
  );

  // Registration and credential management — require authentication + CSRF
  router.use(securityMiddleware.requireAuth);
  router.use(securityMiddleware.validateCsrfToken);

  router.post(
    '/register/options',
    asyncHandler(
      'webauthn.register.options',
      webauthnController.getRegistrationOptions
    )
  );

  router.post(
    '/register/verify',
    validateLegacyJsonBody(webauthnVerifyRegistrationBodySchema, jsonDeps),
    asyncHandler(
      'webauthn.register.verify',
      webauthnController.verifyRegistration
    )
  );

  router.get(
    '/credentials',
    asyncHandler(
      'webauthn.credentials.list',
      webauthnController.listCredentials
    )
  );

  router.delete(
    '/credentials/:credentialId',
    asyncHandler(
      'webauthn.credentials.remove',
      webauthnController.removeCredential
    )
  );

  router.patch(
    '/credentials/:credentialId',
    validateLegacyJsonParams(webauthnRenameCredentialParamsSchema, jsonDeps),
    validateLegacyJsonBody(webauthnRenameCredentialBodySchema, jsonDeps),
    asyncHandler(
      'webauthn.credentials.rename',
      webauthnController.renameCredential
    )
  );

  return router;
};
