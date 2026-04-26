import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCWebAuthnMfaHandler } from '../../../di/interfaces/oidc-webauthn-mfa-handler.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { IWebAuthnService } from '../../../di/interfaces/webauthn-service.interface.js';
import type { IMfaUtils } from '../../../di/interfaces/mfa-utils.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

// Challenge storage key in session for OIDC WebAuthn MFA
const WEBAUTHN_OIDC_CHALLENGE_KEY = 'webauthn_oidc_mfa_challenge';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface OidcWebAuthnChallengeData {
  challenge: string;
  uid: string;
  accountId: string;
  expiresAt: number;
}

/**
 * OIDC WebAuthn MFA Handler
 * Handles WebAuthn authentication during OIDC MFA verification flow
 */
@injectable()
export class OIDCWebAuthnMfaHandler implements IOIDCWebAuthnMfaHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.WebAuthnService)
    private readonly webauthnService: IWebAuthnService,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

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
    uid: string,
    accountId: string
  ): void {
    const challengeData: OidcWebAuthnChallengeData = {
      challenge,
      uid,
      accountId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    };
    this.sessionManager.set(req, WEBAUTHN_OIDC_CHALLENGE_KEY, challengeData);
  }

  /**
   * Get and validate challenge from session
   */
  private getChallenge(
    req: Request,
    uid: string,
    accountId: string
  ): string | null {
    const challengeData = this.sessionManager.get(
      req,
      WEBAUTHN_OIDC_CHALLENGE_KEY
    ) as OidcWebAuthnChallengeData | undefined;

    if (!challengeData) {
      return null;
    }

    if (challengeData.expiresAt < Date.now()) {
      this.sessionManager.remove(req, WEBAUTHN_OIDC_CHALLENGE_KEY);
      return null;
    }

    if (challengeData.uid !== uid || challengeData.accountId !== accountId) {
      this.logger.warn('WebAuthn challenge mismatch', {
        expectedUid: uid,
        challengeUid: challengeData.uid,
        expectedAccountId: accountId,
        challengeAccountId: challengeData.accountId,
      });
      return null;
    }

    return challengeData.challenge;
  }

  /**
   * Clear challenge from session
   */
  private clearChallenge(req: Request): void {
    this.sessionManager.remove(req, WEBAUTHN_OIDC_CHALLENGE_KEY);
  }

  /**
   * POST /interaction/:uid/webauthn/options handler
   * Returns WebAuthn authentication options for the OIDC MFA flow
   */
  getOptions = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const { uid } = req.params;
      const interactionDetails = await provider.interactionDetails(req, res);
      const { session, params } = interactionDetails;

      if (!session?.accountId) {
        this.logger.error('WebAuthn options route without valid session');
        res.status(401).json({
          ok: false,
          error: 'Session expired. Please login again.',
        });
        return;
      }

      if (!this.webauthnService.isEnabled()) {
        res.status(400).json({
          ok: false,
          error: 'WebAuthn is not enabled',
        });
        return;
      }

      const userDoc = await this.userService.findByUsername(session.accountId);
      if (!userDoc) {
        this.logger.warn('User not found for WebAuthn MFA', {
          accountId: session.accountId,
        });
        res.status(400).json({
          ok: false,
          error: 'User not found',
        });
        return;
      }

      if (!this.mfaUtils.isWebAuthnEnabled(userDoc)) {
        this.logger.warn('WebAuthn MFA not enabled for user', {
          accountId: session.accountId,
          mfaEnabled: userDoc.mfa?.enabled,
          webauthnEnabled: userDoc.mfa?.methods?.webauthn?.enabled,
        });
        res.status(400).json({
          ok: false,
          error: 'WebAuthn MFA is not enabled for this account',
        });
        return;
      }

      const credentials = await this.webauthnService.getCredentials(
        session.accountId
      );
      if (credentials.length === 0) {
        res.status(400).json({
          ok: false,
          error: 'No passkeys registered for this account',
        });
        return;
      }

      const options = await this.webauthnService.generateAuthenticationOptions(
        session.accountId,
        credentials
      );

      this.storeChallenge(req, options.challenge, uid, session.accountId);

      this.logger.info('WebAuthn OIDC MFA options generated', {
        uid,
        accountId: session.accountId,
        clientId: params.client_id,
      });

      res.json({
        ok: true,
        options,
      });
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error generating WebAuthn OIDC MFA options',
      });
      next(err);
    }
  };

  /**
   * POST /interaction/:uid/webauthn/verify handler
   * Verifies WebAuthn authentication and completes the OIDC MFA flow
   */
  verify = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const { uid } = req.params;
      const interactionDetails = await provider.interactionDetails(req, res);
      const { session, params } = interactionDetails;

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      if (!session?.accountId) {
        this.logger.error('WebAuthn verify route without valid session');
        res.status(401).json({
          ok: false,
          error: 'Session expired. Please login again.',
        });
        return;
      }

      const challenge = this.getChallenge(req, uid, session.accountId);
      if (!challenge) {
        this.logger.warn('WebAuthn challenge expired or not found', {
          uid,
          accountId: session.accountId,
        });
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
        session.accountId
      );
      const matchingCredential = storedCredentials.find(
        c => c.credential_id === credential.id
      );

      if (!matchingCredential) {
        this.logger.warn('No matching credential found for authentication', {
          uid,
          accountId: session.accountId,
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
            session.accountId,
            credential.id,
            result.newCounter
          );
          await this.webauthnService.updateCredentialLastUsed(
            session.accountId,
            credential.id
          );
        } catch (updateError) {
          this.logger.error(updateError as Error, {
            context: 'Error updating credential counter/lastUsed',
          });
          res.status(500).json({
            ok: false,
            error: 'Authentication failed. Please try again.',
          });
          return;
        }
      }

      if (!result.verified) {
        this.logger.warn('WebAuthn OIDC MFA verification failed', {
          uid,
          accountId: session.accountId,
          error: result.error,
        });

        try {
          this.activityService.failed(
            'oidc.mfa.webauthn.verification',
            'WebAuthn MFA verification failed',
            null,
            {
              ip_address: req.ip,
              user_agent: req.headers['user-agent'] as string,
              client_id: params.client_id as string,
              device_infos: deviceInfos as ClientDeviceInfos,
              actor: {
                username: session.accountId,
                actor_type: 'user',
              },
              target: {
                target_type: 'none',
              },
            }
          );
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'Error logging failed WebAuthn MFA activity',
          });
        }

        res.status(400).json({
          ok: false,
          error: 'WebAuthn verification failed',
        });
        return;
      }

      const userDoc = await this.userService.findByUsername(session.accountId);

      try {
        this.activityService.success(
          'oidc.mfa.webauthn.verification',
          'WebAuthn MFA verification successful',
          userDoc,
          {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] as string,
            client_id: params.client_id as string,
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: userDoc,
            target: {
              target_type: 'none',
            },
            metadata: {
              credentialId: result.credentialId,
            },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging successful WebAuthn MFA activity',
        });
      }

      const existingAmr = session.amr || ['pwd'];
      const updatedAmr = existingAmr.includes('hwk')
        ? existingAmr
        : [...existingAmr, 'hwk'];

      await provider.interactionFinished(
        req,
        res,
        {
          login: {
            accountId: session.accountId,
            acr: 'urn:mfa:webauthn',
            amr: updatedAmr,
          },
          ts: Math.floor(Date.now() / 1000),
        },
        { mergeWithLastSubmission: true }
      );

      this.logger.info('WebAuthn MFA verified and OIDC interaction completed', {
        uid,
        accountId: session.accountId,
        credentialId: result.credentialId,
      });
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in WebAuthn OIDC MFA verify handler',
      });
      next(err);
    }
  };
}
