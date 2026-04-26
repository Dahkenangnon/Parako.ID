import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IWebAuthnService } from '../di/interfaces/webauthn-service.interface.js';
import type { IWebAuthnController } from '../di/interfaces/webauthn-controller.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { TYPES } from '../di/types.js';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IClientDeviceInfoManager } from '../di/interfaces/client-device-info-manager.interface.js';
import type { PendingMfaUser } from '../types/session-data.js';

// Challenge storage key in session
const WEBAUTHN_CHALLENGE_KEY = 'webauthn_challenge';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ChallengeData {
  challenge: string;
  expiresAt: number;
  type: 'registration' | 'authentication';
}

@injectable()
export class WebAuthnController implements IWebAuthnController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.WebAuthnService)
    private readonly webauthnService: IWebAuthnService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * Validation rules for registration verify
   */
  public readonly registrationVerifyValidation = [
    body('credential').isObject().withMessage('Credential is required'),
    body('friendly_name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Friendly name must be between 1 and 100 characters'),
  ];

  /**
   * Validation rules for credential rename
   */
  public readonly renameCredentialValidation = [
    param('credentialId').notEmpty().withMessage('Credential ID is required'),
    body('friendlyName')
      .trim()
      .notEmpty()
      .withMessage('Friendly name is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Friendly name must be between 1 and 100 characters'),
  ];

  /**
   * Get origin for WebAuthn operations
   */
  private getOrigin(): string {
    const config = this.configManager.getConfig();
    if (config.deployment?.url) {
      return new URL(config.deployment.url).origin;
    }
    // Fallback to rpId
    const rpId = config.security?.authentication?.multi_factor?.webauthn?.rp_id;
    return `https://${rpId}`;
  }

  /**
   * Store challenge in session
   */
  private storeChallenge(
    req: Request,
    challenge: string,
    type: 'registration' | 'authentication'
  ): void {
    const challengeData: ChallengeData = {
      challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
      type,
    };
    this.sessionManager.set(req, WEBAUTHN_CHALLENGE_KEY, challengeData);
  }

  /**
   * Get and validate challenge from session
   */
  private getChallenge(
    req: Request,
    expectedType: 'registration' | 'authentication'
  ): string | null {
    const challengeData = this.sessionManager.get(
      req,
      WEBAUTHN_CHALLENGE_KEY
    ) as ChallengeData | undefined;

    if (!challengeData) {
      return null;
    }

    if (challengeData.expiresAt < Date.now()) {
      this.sessionManager.remove(req, WEBAUTHN_CHALLENGE_KEY);
      return null;
    }

    if (challengeData.type !== expectedType) {
      return null;
    }

    return challengeData.challenge;
  }

  /**
   * Clear challenge from session
   */
  private clearChallenge(req: Request): void {
    this.sessionManager.remove(req, WEBAUTHN_CHALLENGE_KEY);
  }

  /**
   * Get authenticated user from session
   */
  private getAuthenticatedUser(
    req: Request
  ): { username: string; email?: string; name?: string } | null {
    const user = this.sessionManager.getActiveUser(req);
    if (!user) {
      return null;
    }
    return {
      username: user.username,
      email: user.email,
      name:
        user.given_name || user.family_name
          ? `${user.given_name || ''} ${user.family_name || ''}`.trim()
          : user.username,
    };
  }

  /**
   * POST /api/webauthn/register/options
   * Get registration options for a new passkey
   */
  public getRegistrationOptions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (!this.webauthnService.isEnabled()) {
        res.status(400).json({
          ok: false,
          error: 'WebAuthn is not enabled',
        });
        return;
      }

      const user = this.getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
        return;
      }

      const hasMaxCredentials =
        await this.webauthnService.hasReachedMaxCredentials(user.username);
      if (hasMaxCredentials) {
        res.status(400).json({
          ok: false,
          error: 'Maximum number of passkeys reached',
        });
        return;
      }

      const existingCredentials = await this.webauthnService.getCredentials(
        user.username
      );
      const existingIds = existingCredentials.map(c => c.credential_id);

      const options = await this.webauthnService.generateRegistrationOptions(
        user.username,
        user.email || user.username,
        user.name || user.username,
        existingIds
      );

      this.storeChallenge(req, options.challenge, 'registration');

      this.logger.info('WebAuthn registration options generated', {
        username: user.username,
      });

      res.json({
        ok: true,
        options,
      });
    } catch (error) {
      this.logger.error('Error generating WebAuthn registration options', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to generate registration options',
      });
    }
  };

  /**
   * POST /api/webauthn/register/verify
   * Verify registration and store new passkey
   */
  public verifyRegistration = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (!this.webauthnService.isEnabled()) {
        res.status(400).json({
          ok: false,
          error: 'WebAuthn is not enabled',
        });
        return;
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          ok: false,
          error: errors.array()[0].msg,
        });
        return;
      }

      const user = this.getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
        return;
      }

      const challenge = this.getChallenge(req, 'registration');
      if (!challenge) {
        res.status(400).json({
          ok: false,
          error: 'Challenge expired or not found. Please try again.',
        });
        return;
      }

      const credential = req.body.credential as RegistrationResponseJSON;
      const friendlyName = req.body.friendly_name?.trim();

      const result = await this.webauthnService.verifyRegistration(
        user.username,
        credential,
        challenge,
        this.getOrigin()
      );

      this.clearChallenge(req);

      if (!result.verified || !result.credential) {
        this.logger.warn('WebAuthn registration verification failed', {
          username: user.username,
          error: result.error,
        });

        this.activityService.failed(
          'webauthn_registration_failed',
          `WebAuthn registration failed for user ${user.username}: ${result.error || 'Unknown error'}`,
          { username: user.username },
          {
            ip_address: req.ip || 'unknown',
            user_agent: req.headers['user-agent'] || 'unknown',
            target: { target_type: 'user', entity_id: user.username },
          }
        );

        res.status(400).json({
          ok: false,
          error: result.error || 'Registration verification failed',
        });
        return;
      }

      if (friendlyName) {
        result.credential.friendly_name = friendlyName;
      } else {
        result.credential.friendly_name =
          this.webauthnService.generateDefaultCredentialName(
            req.headers['user-agent'] || '',
            credential.response.transports?.includes('internal')
              ? 'platform'
              : 'cross-platform'
          );
      }

      await this.webauthnService.addCredential(
        user.username,
        result.credential
      );

      this.activityService.success(
        'webauthn_registered',
        `Passkey "${result.credential.friendly_name}" registered for user ${user.username}`,
        { username: user.username },
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.headers['user-agent'] || 'unknown',
          target: { target_type: 'user', entity_id: user.username },
        }
      );

      this.logger.info('WebAuthn credential registered successfully', {
        username: user.username,
        credentialId: result.credential.credential_id,
        friendlyName: result.credential.friendly_name,
      });

      res.json({
        ok: true,
        credential: {
          credential_id: result.credential.credential_id,
          friendly_name: result.credential.friendly_name,
          device_type: result.credential.device_type,
          backed_up: result.credential.backed_up,
          created_at: result.credential.created_at,
        },
      });
    } catch (error) {
      this.logger.error('Error verifying WebAuthn registration', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to verify registration',
      });
    }
  };

  /**
   * GET /api/webauthn/credentials
   * List user's passkeys
   */
  public listCredentials = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const user = this.getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
        return;
      }

      const passkeys = await this.webauthnService.getPasskeyInfo(user.username);

      res.json({
        ok: true,
        credentials: passkeys,
      });
    } catch (error) {
      this.logger.error('Error listing WebAuthn credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to list credentials',
      });
    }
  };

  /**
   * DELETE /api/webauthn/credentials/:credentialId
   * Remove a passkey
   */
  public removeCredential = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const user = this.getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
        return;
      }

      const { credentialId } = req.params;
      if (!credentialId) {
        res.status(400).json({
          ok: false,
          error: 'Credential ID is required',
        });
        return;
      }

      const removed = await this.webauthnService.removeCredential(
        user.username,
        credentialId
      );

      if (!removed) {
        res.status(404).json({
          ok: false,
          error: 'Credential not found',
        });
        return;
      }

      this.activityService.success(
        'webauthn_removed',
        `Passkey removed for user ${user.username}`,
        { username: user.username },
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.headers['user-agent'] || 'unknown',
          target: { target_type: 'user', entity_id: user.username },
        }
      );

      this.logger.info('WebAuthn credential removed', {
        username: user.username,
        credentialId,
      });

      res.json({
        ok: true,
        message: 'Credential removed successfully',
      });
    } catch (error) {
      this.logger.error('Error removing WebAuthn credential', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to remove credential',
      });
    }
  };

  /**
   * PATCH /api/webauthn/credentials/:credentialId
   * Rename a passkey
   */
  public renameCredential = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          ok: false,
          error: errors.array()[0].msg,
        });
        return;
      }

      const user = this.getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
        return;
      }

      const { credentialId } = req.params;
      const { friendlyName } = req.body;

      const renamed = await this.webauthnService.renameCredential(
        user.username,
        credentialId,
        friendlyName
      );

      if (!renamed) {
        res.status(404).json({
          ok: false,
          error: 'Credential not found',
        });
        return;
      }

      this.logger.info('WebAuthn credential renamed', {
        username: user.username,
        credentialId,
        newName: friendlyName,
      });

      res.json({
        ok: true,
        message: 'Credential renamed successfully',
      });
    } catch (error) {
      this.logger.error('Error renaming WebAuthn credential', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to rename credential',
      });
    }
  };

  /**
   * POST /api/webauthn/authenticate/options
   * Get authentication options for MFA during regular login
   */
  public getAuthenticationOptions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (!this.webauthnService.isEnabled()) {
        res.status(400).json({
          ok: false,
          error: 'WebAuthn is not enabled',
        });
        return;
      }

      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        res.status(401).json({
          ok: false,
          error: 'No pending MFA verification found',
        });
        return;
      }

      if (pendingUser.mfa_method !== 'webauthn') {
        res.status(400).json({
          ok: false,
          error: 'WebAuthn MFA is not enabled for this account',
        });
        return;
      }

      const credentials = await this.webauthnService.getCredentials(
        pendingUser.username
      );

      if (credentials.length === 0) {
        res.status(400).json({
          ok: false,
          error: 'No passkeys registered for this account',
        });
        return;
      }

      const options = await this.webauthnService.generateAuthenticationOptions(
        pendingUser.username,
        credentials
      );

      this.storeChallenge(req, options.challenge, 'authentication');

      this.logger.info('WebAuthn authentication options generated', {
        username: pendingUser.username,
      });

      res.json({
        ok: true,
        options,
      });
    } catch (error) {
      this.logger.error('Error generating WebAuthn authentication options', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to generate authentication options',
      });
    }
  };

  /**
   * POST /api/webauthn/authenticate/verify
   * Verify authentication and complete MFA for regular login
   */
  public verifyAuthentication = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        res.status(401).json({
          ok: false,
          error: 'No pending MFA verification found',
        });
        return;
      }

      const challenge = this.getChallenge(req, 'authentication');
      if (!challenge) {
        res.status(400).json({
          ok: false,
          error: 'Challenge expired or not found. Please try again.',
        });
        return;
      }

      const credential = req.body.credential as AuthenticationResponseJSON;
      if (!credential) {
        res.status(400).json({
          ok: false,
          error: 'Credential is required',
        });
        return;
      }

      const storedCredentials = await this.webauthnService.getCredentials(
        pendingUser.username
      );
      const matchingCredential = storedCredentials.find(
        c => c.credential_id === credential.id
      );

      if (!matchingCredential) {
        this.logger.warn('No matching credential found for authentication', {
          username: pendingUser.username,
          credentialId: credential.id,
        });
        res.status(400).json({
          ok: false,
          error: 'WebAuthn verification failed',
        });
        return;
      }

      const result = await this.webauthnService.verifyAuthentication(
        matchingCredential,
        credential,
        challenge,
        this.getOrigin()
      );

      this.clearChallenge(req);

      if (result.verified && result.newCounter !== undefined) {
        try {
          await this.webauthnService.updateCredentialCounter(
            pendingUser.username,
            credential.id,
            result.newCounter
          );
          await this.webauthnService.updateCredentialLastUsed(
            pendingUser.username,
            credential.id
          );
        } catch (updateError) {
          this.logger.error('Error updating credential counter/lastUsed', {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
          });
          res.status(500).json({
            ok: false,
            error: 'Authentication failed. Please try again.',
          });
          return;
        }
      }

      if (!result.verified) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.logger.warn('WebAuthn MFA verification failed', {
          username: pendingUser.username,
          error: result.error,
        });

        this.activityService.failed(
          'mfa_webauthn_verification_failed',
          'WebAuthn MFA verification failed',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: pendingUser.username,
              actor_type: 'user',
            },
            target: {
              target_type: 'none',
            },
          }
        );

        res.status(400).json({
          ok: false,
          error: 'WebAuthn verification failed',
        });
        return;
      }

      // MFA verification successful - complete the login
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      const newUserAccount = {
        id: pendingUser.id,
        username: pendingUser.username,
        email: pendingUser.email,
        email_verified: pendingUser.email_verified,
        phone_number: pendingUser.phone_number || '',
        phone_number_verified: pendingUser.phone_number_verified || false,
        given_name: pendingUser.given_name,
        family_name: pendingUser.family_name,
        full_name: pendingUser.full_name,
        picture: pendingUser.picture,
        roles: pendingUser.roles,
        is_admin: pendingUser.is_admin,
        last_used: Date.now(),
      };

      const isSocialLogin =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser') !==
        null;

      this.activityService.success(
        'mfa_webauthn_verification_success',
        `WebAuthn MFA verification successful${isSocialLogin ? ' via social login' : ''}`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: pendingUser.username,
            actor_type: 'user',
          },
          target: {
            target_type: 'none',
          },
        }
      );

      // Regenerate session ID to prevent session fixation attacks after MFA
      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(
          'Failed to regenerate session after MFA verification',
          {
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }

      this.sessionManager.addAuthenticatedUser(req, newUserAccount, true);

      this.sessionManager.remove(req, 'pendingMfaUser');
      this.sessionManager.remove(req, 'pendingSocialMfaUser');

      this.logger.info('WebAuthn MFA verification successful', {
        username: pendingUser.username,
        credentialId: result.credentialId,
      });

      const config = this.configManager.getConfig();
      const continueUrl = pendingUser.continue_url;
      const redirectUrl =
        continueUrl ||
        `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`;

      res.json({
        ok: true,
        redirectUrl,
      });
    } catch (error) {
      this.logger.error('Error verifying WebAuthn authentication', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        ok: false,
        error: 'Failed to verify authentication',
      });
    }
  };
}
