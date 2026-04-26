import { Request, Response } from 'express';

/**
 * Interface for AuthController - handles authentication-related operations
 */
export interface IAuthController {
  login(req: Request, res: Response): void;
  processLogin(req: Request, res: Response): Promise<void>;

  register(req: Request, res: Response): void;
  processRegister(req: Request, res: Response): Promise<void>;

  resetPassword(req: Request, res: Response): void;
  processResetPassword(req: Request, res: Response): Promise<void>;
  forgotPassword(req: Request, res: Response): void;
  processForgotPassword(req: Request, res: Response): Promise<void>;

  // Account selection and management
  accountSelect(req: Request, res: Response): void;
  continueWithAccount(req: Request, res: Response): Promise<void>;

  // Multi-factor authentication
  multiFactor(req: Request, res: Response): void;
  mfaVerify(req: Request, res: Response): void;
  processMfaVerify(req: Request, res: Response): Promise<void>;
  resendMfaCode(req: Request, res: Response): Promise<void>;

  // MFA method selection (multi-method MFA)
  mfaSelect(req: Request, res: Response): void;
  processMfaSelect(req: Request, res: Response): Promise<void>;

  // WebAuthn MFA
  mfaWebAuthn(req: Request, res: Response): void;
  mfaWebAuthnOptions(req: Request, res: Response): Promise<void>;
  processMfaWebAuthn(req: Request, res: Response): Promise<void>;

  emailVerification(req: Request, res: Response): void;
  requestEmailVerification(req: Request, res: Response): Promise<void>;
  resendEmailVerification(req: Request, res: Response): Promise<void>;
  verifyEmail(req: Request, res: Response): Promise<void>;
  emailVerificationSuccess(req: Request, res: Response): void;

  accountRecovery(req: Request, res: Response): void;
  processAccountRecovery(req: Request, res: Response): Promise<void>;
  recoveryMethodSelect(req: Request, res: Response): Promise<void>;
  processRecoveryMethodSelect(req: Request, res: Response): Promise<void>;
  recoveryBackupCodes(req: Request, res: Response): void;
  processRecoveryBackupCodes(req: Request, res: Response): Promise<void>;
  recoverySecondaryEmail(req: Request, res: Response): void;
  processRecoverySecondaryEmail(req: Request, res: Response): Promise<void>;
  recoverySecurityQuestions(req: Request, res: Response): Promise<void>;
  processRecoverySecurityQuestions(req: Request, res: Response): Promise<void>;
  recoverySms(req: Request, res: Response): Promise<void>;
  processRecoverySms(req: Request, res: Response): Promise<void>;
  recoveryVerifyCode(req: Request, res: Response): void;
  processRecoveryVerifyCode(req: Request, res: Response): Promise<void>;

  logout(req: Request, res: Response): Promise<void>;

  // Social login/registration
  socialLogin(req: Request, res: Response): Promise<void>;
  socialRegister(req: Request, res: Response): Promise<void>;
  socialCallback(req: Request, res: Response): Promise<void>;
  socialPasswordSetup(req: Request, res: Response): Promise<void>;
  processSocialPasswordSetup(req: Request, res: Response): Promise<void>;
  socialContactInfo(req: Request, res: Response): Promise<void>;
  processSocialContactInfo(req: Request, res: Response): Promise<void>;
}
