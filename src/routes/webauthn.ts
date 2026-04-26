import { Router } from 'express';
import type { IWebAuthnController } from '../di/interfaces/webauthn-controller.interface.js';
import type { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';

/**
 * Register WebAuthn API routes with DI injectable services
 */
export const webauthnRoutes = (
  securityMiddleware: ISecurityMiddleware,
  webauthnController: IWebAuthnController
): Router => {
  const router = Router();

  // Authentication flow (for MFA during login)
  // These routes do NOT require authentication since user is in
  // the process of authenticating via MFA

  // POST /api/webauthn/authenticate/options - Get authentication options for MFA
  router.post(
    '/authenticate/options',
    securityMiddleware.validateCsrfToken,
    webauthnController.getAuthenticationOptions
  );

  // POST /api/webauthn/authenticate/verify - Verify authentication for MFA
  router.post(
    '/authenticate/verify',
    securityMiddleware.validateCsrfToken,
    webauthnController.verifyAuthentication
  );

  // Registration and credential management routes
  // These routes require full authentication

  // All subsequent routes require authentication
  router.use(securityMiddleware.requireAuth);

  // All subsequent routes require CSRF token validation
  router.use(securityMiddleware.validateCsrfToken);

  // POST /api/webauthn/register/options - Get registration options
  router.post('/register/options', webauthnController.getRegistrationOptions);

  // POST /api/webauthn/register/verify - Verify registration and store credential
  router.post(
    '/register/verify',
    webauthnController.registrationVerifyValidation,
    webauthnController.verifyRegistration
  );

  router.get('/credentials', webauthnController.listCredentials);

  router.delete(
    '/credentials/:credentialId',
    webauthnController.removeCredential
  );

  // PATCH /api/webauthn/credentials/:credentialId - Rename a passkey
  router.patch(
    '/credentials/:credentialId',
    webauthnController.renameCredentialValidation,
    webauthnController.renameCredential
  );

  return router;
};
