import { Request, Response } from 'express';

/**
 * Interface for AccountController - handles account-related operations
 */
export interface IAccountController {
  myAccount(req: Request, res: Response): Promise<void>;
  settings(req: Request, res: Response): Promise<void>;
  settingsProfile(req: Request, res: Response): Promise<void>;
  settingsPreferences(req: Request, res: Response): Promise<void>;
  settingsNotifications(req: Request, res: Response): Promise<void>;
  settingsSecurity(req: Request, res: Response): Promise<void>;
  settingsRecovery(req: Request, res: Response): Promise<void>;
  settingsSocial(req: Request, res: Response): Promise<void>;

  updateProfile(req: Request, res: Response): Promise<void>;
  changePassword(req: Request, res: Response): Promise<void>;
  removeAvatar(req: Request, res: Response): Promise<void>;

  // MFA management
  enableMfa(req: Request, res: Response): Promise<void>;
  disableMfa(req: Request, res: Response): Promise<void>;
  setupMfaPage(req: Request, res: Response): Promise<void>;
  verifySetupMfa(req: Request, res: Response): Promise<void>;

  // WebAuthn/Passkeys management
  passkeysPage(req: Request, res: Response): Promise<void>;
  setupWebAuthnPage(req: Request, res: Response): Promise<void>;

  apps(req: Request, res: Response): Promise<void>;
  sessions(req: Request, res: Response): Promise<void>;
  revokeApp(req: Request, res: Response): Promise<void>;
  revokeAllApps(req: Request, res: Response): Promise<void>;
  logoutSession(req: Request, res: Response): Promise<void>;
  logoutAllOtherSessions(req: Request, res: Response): Promise<void>;

  switchAccount(req: Request, res: Response): Promise<void>;
  addAccount(req: Request, res: Response): void;
  removeAccount(req: Request, res: Response): Promise<void>;
  getAccountSwitcherData(req: Request, res: Response): void;

  linkSocialAccount(req: Request, res: Response): Promise<void>;
  unlinkSocialAccount(req: Request, res: Response): Promise<void>;

  enableRecovery(req: Request, res: Response): Promise<void>;
  disableRecovery(req: Request, res: Response): Promise<void>;
  showRecoveryCodes(req: Request, res: Response): Promise<void>;
  verifyRecoveryEmail(req: Request, res: Response): Promise<void>;
  regenerateBackupCodes(req: Request, res: Response): Promise<void>;
  showRecoverySetup(req: Request, res: Response): Promise<void>;

  // Security questions
  showSecurityQuestionsSetup(req: Request, res: Response): Promise<void>;
  saveSecurityQuestions(req: Request, res: Response): Promise<void>;

  resendEmailVerification(req: Request, res: Response): Promise<void>;

  updateNotificationPreferences(req: Request, res: Response): Promise<void>;
}
