import type { Request, Response, RequestHandler } from 'express';

/**
 * Interface for WebAuthn Controller
 * Handles API endpoints for passkey registration, authentication, and management
 */
export interface IWebAuthnController {
  // Authentication flow (for MFA during login)

  /**
   * Get authentication options for WebAuthn MFA
   * POST /api/webauthn/authenticate/options
   */
  getAuthenticationOptions(req: Request, res: Response): Promise<void>;

  /**
   * Verify authentication and complete MFA
   * POST /api/webauthn/authenticate/verify
   */
  verifyAuthentication(req: Request, res: Response): Promise<void>;

  /**
   * Get registration options for a new passkey
   * POST /api/webauthn/register/options
   */
  getRegistrationOptions(req: Request, res: Response): Promise<void>;

  /**
   * Validation middleware for registration verify
   */
  registrationVerifyValidation: RequestHandler[];

  /**
   * Verify registration and store new passkey
   * POST /api/webauthn/register/verify
   */
  verifyRegistration(req: Request, res: Response): Promise<void>;

  /**
   * List user's passkeys
   * GET /api/webauthn/credentials
   */
  listCredentials(req: Request, res: Response): Promise<void>;

  /**
   * Remove a passkey
   * DELETE /api/webauthn/credentials/:credentialId
   */
  removeCredential(req: Request, res: Response): Promise<void>;

  /**
   * Validation middleware for rename credential
   */
  renameCredentialValidation: RequestHandler[];

  /**
   * Rename a passkey
   * PATCH /api/webauthn/credentials/:credentialId
   */
  renameCredential(req: Request, res: Response): Promise<void>;
}
