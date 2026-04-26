import type { Request, Response, NextFunction } from 'express';
import type { Provider } from 'oidc-provider';

/**
 * Interface for OIDC WebAuthn MFA Handler
 * Handles WebAuthn authentication during OIDC MFA verification flow
 */
export interface IOIDCWebAuthnMfaHandler {
  /**
   * Get WebAuthn authentication options
   * POST /interaction/:uid/webauthn/options
   */
  getOptions(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;

  /**
   * Verify WebAuthn authentication assertion
   * POST /interaction/:uid/webauthn/verify
   */
  verify(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
}
