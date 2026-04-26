import { injectable, inject } from 'inversify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorSelectionCriteria,
} from '@simplewebauthn/server';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IWebAuthnService } from '../di/interfaces/webauthn-service.interface.js';
import type {
  WebAuthnCredential,
  WebAuthnConfig,
  WebAuthnRegistrationResult,
  WebAuthnAuthenticationResult,
  PasskeyInfo,
  AuthenticatorTransportType,
} from '../types/webauthn.js';

@injectable()
export class WebAuthnService implements IWebAuthnService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager
  ) {}

  public getConfig(): WebAuthnConfig {
    const config = this.configManager.getConfig();
    const webauthn = config.security?.authentication?.multi_factor?.webauthn;

    return {
      enabled: webauthn?.enabled ?? false,
      rpName: webauthn?.rp_name ?? 'OIDC Provider',
      rpId: webauthn?.rp_id ?? 'localhost',
      timeout: webauthn?.timeout ?? 60000,
      attestation: webauthn?.attestation ?? 'none',
      userVerification: webauthn?.user_verification ?? 'preferred',
      authenticatorAttachment: webauthn?.authenticator_attachment,
      residentKey: webauthn?.resident_key ?? 'preferred',
      maxCredentialsPerUser: webauthn?.max_credentials_per_user ?? 10,
    };
  }

  public isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  public async generateRegistrationOptions(
    userId: string,
    userName: string,
    userDisplayName: string,
    existingCredentialIds?: string[]
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const config = this.getConfig();

    this.logger.info('Generating WebAuthn registration options', {
      userId,
      userName,
    });

    const excludeCredentials = (existingCredentialIds ?? []).map(id => ({
      id,
      type: 'public-key' as const,
    }));

    const authenticatorSelection: AuthenticatorSelectionCriteria = {
      residentKey: config.residentKey,
      userVerification: config.userVerification,
      requireResidentKey: config.residentKey === 'required',
    };

    // Only set authenticatorAttachment if it's explicitly specified (not null/undefined)
    // When not set, the browser will show all available options
    if (config.authenticatorAttachment) {
      authenticatorSelection.authenticatorAttachment =
        config.authenticatorAttachment;
    }

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName,
      userDisplayName,
      attestationType: config.attestation as 'none' | 'direct' | 'enterprise',
      excludeCredentials,
      authenticatorSelection,
      timeout: config.timeout,
    });

    return options;
  }

  public async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    expectedChallenge: string,
    expectedOrigin: string
  ): Promise<WebAuthnRegistrationResult> {
    const config = this.getConfig();

    this.logger.info('Verifying WebAuthn registration', { userId });

    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: config.rpId,
        requireUserVerification: config.userVerification === 'required',
      });

      if (!verification.verified || !verification.registrationInfo) {
        this.logger.warn('WebAuthn registration verification failed', {
          userId,
          verified: verification.verified,
        });
        return { verified: false, error: 'Registration verification failed' };
      }

      const { credential, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;

      const webauthnCredential: WebAuthnCredential = {
        credential_id: credential.id,
        credential_public_key: Buffer.from(credential.publicKey).toString(
          'base64url'
        ),
        counter: credential.counter,
        transports: response.response
          .transports as AuthenticatorTransportType[],
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        created_at: new Date(),
        friendly_name: 'New Passkey',
      };

      this.logger.info('WebAuthn registration verified successfully', {
        userId,
        credentialId: credential.id,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });

      return { verified: true, credential: webauthnCredential };
    } catch (error) {
      this.logger.error('WebAuthn registration verification error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  public async generateAuthenticationOptions(
    userId: string,
    credentials: WebAuthnCredential[]
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const config = this.getConfig();

    this.logger.info('Generating WebAuthn authentication options', {
      userId,
      credentialCount: credentials.length,
    });

    const allowCredentials = credentials.map(cred => ({
      id: cred.credential_id,
      type: 'public-key' as const,
      transports: cred.transports,
    }));

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials,
      userVerification: config.userVerification,
      timeout: config.timeout,
    });

    return options;
  }

  public async verifyAuthentication(
    credential: WebAuthnCredential,
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    expectedOrigin: string
  ): Promise<WebAuthnAuthenticationResult> {
    const config = this.getConfig();

    this.logger.info('Verifying WebAuthn authentication', {
      credentialId: credential.credential_id,
    });

    try {
      const publicKey = Buffer.from(
        credential.credential_public_key,
        'base64url'
      );

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: config.rpId,
        credential: {
          id: credential.credential_id,
          publicKey,
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: config.userVerification === 'required',
      });

      if (!verification.verified) {
        this.logger.warn('WebAuthn authentication verification failed', {
          credentialId: credential.credential_id,
        });
        return {
          verified: false,
          error: 'Authentication verification failed',
        };
      }

      this.logger.info('WebAuthn authentication verified successfully', {
        credentialId: credential.credential_id,
        newCounter: verification.authenticationInfo.newCounter,
      });

      return {
        verified: true,
        credentialId: credential.credential_id,
        newCounter: verification.authenticationInfo.newCounter,
      };
    } catch (error) {
      this.logger.error('WebAuthn authentication verification error', {
        credentialId: credential.credential_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  public async addCredential(
    username: string,
    credential: WebAuthnCredential
  ): Promise<void> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];

    const config = this.getConfig();
    if (existingCreds.length >= config.maxCredentialsPerUser) {
      throw new Error(
        `Maximum number of passkeys (${config.maxCredentialsPerUser}) reached`
      );
    }

    if (existingCreds.some(c => c.credential_id === credential.credential_id)) {
      throw new Error('Credential already exists');
    }

    const updatedCreds = [...existingCreds, credential];

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: true,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            ...user.mfa?.methods?.webauthn,
            enabled: true,
            credentials: updatedCreds,
            verified_at: user.mfa?.methods?.webauthn?.verified_at ?? new Date(),
          },
        },
      },
    });

    this.logger.info('WebAuthn credential added', {
      username,
      credentialId: credential.credential_id,
      totalCredentials: updatedCreds.length,
    });
  }

  public async removeCredential(
    username: string,
    credentialId: string
  ): Promise<boolean> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];
    const updatedCreds = existingCreds.filter(
      c => c.credential_id !== credentialId
    );

    if (updatedCreds.length === existingCreds.length) {
      return false; // Credential not found
    }

    const hasOtherMethods =
      !!(user.mfa?.methods?.totp?.enabled && user.mfa?.methods?.totp?.secret) ||
      !!user.mfa?.methods?.email?.enabled;

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: hasOtherMethods || updatedCreds.length > 0,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            enabled: updatedCreds.length > 0,
            credentials: updatedCreds,
            verified_at: user.mfa?.methods?.webauthn?.verified_at,
          },
        },
      },
    });

    this.logger.info('WebAuthn credential removed', {
      username,
      credentialId,
      remainingCredentials: updatedCreds.length,
    });

    return true;
  }

  public async renameCredential(
    username: string,
    credentialId: string,
    newName: string
  ): Promise<boolean> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];
    let found = false;

    const updatedCreds = existingCreds.map(c => {
      if (c.credential_id === credentialId) {
        found = true;
        return { ...c, friendly_name: newName.trim() };
      }
      return c;
    });

    if (!found) {
      return false;
    }

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: user.mfa?.enabled ?? false,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            ...user.mfa?.methods?.webauthn,
            enabled: user.mfa?.methods?.webauthn?.enabled ?? false,
            credentials: updatedCreds,
          },
        },
      },
    });

    this.logger.info('WebAuthn credential renamed', {
      username,
      credentialId,
      newName,
    });

    return true;
  }

  public async getCredentials(username: string): Promise<WebAuthnCredential[]> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      return [];
    }
    return (
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? []
    );
  }

  public async getPasskeyInfo(username: string): Promise<PasskeyInfo[]> {
    const credentials = await this.getCredentials(username);
    return credentials.map(c => ({
      credential_id: c.credential_id,
      friendly_name: c.friendly_name,
      device_type: c.device_type,
      backed_up: c.backed_up,
      created_at: c.created_at,
      last_used_at: c.last_used_at,
      transports: c.transports,
    }));
  }

  public async updateCredentialCounter(
    username: string,
    credentialId: string,
    newCounter: number
  ): Promise<void> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];
    const updatedCreds = existingCreds.map(c => {
      if (c.credential_id === credentialId) {
        return { ...c, counter: newCounter };
      }
      return c;
    });

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: user.mfa?.enabled ?? false,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            ...user.mfa?.methods?.webauthn,
            enabled: user.mfa?.methods?.webauthn?.enabled ?? false,
            credentials: updatedCreds,
          },
        },
      },
    });
  }

  public async updateCredentialLastUsed(
    username: string,
    credentialId: string
  ): Promise<void> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];
    const updatedCreds = existingCreds.map(c => {
      if (c.credential_id === credentialId) {
        return { ...c, last_used_at: new Date() };
      }
      return c;
    });

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: user.mfa?.enabled ?? false,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            ...user.mfa?.methods?.webauthn,
            enabled: user.mfa?.methods?.webauthn?.enabled ?? false,
            credentials: updatedCreds,
          },
        },
      },
    });
  }

  public async findCredentialById(
    credentialId: string
  ): Promise<{ username: string; credential: WebAuthnCredential } | null> {
    // Used for discoverable credentials (passwordless login)
    const users = await this.userService.findMany({
      'mfa.methods.webauthn.credentials.credential_id': credentialId,
    });

    for (const user of users) {
      const credentials =
        (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ??
        [];
      const credential = credentials.find(
        c => c.credential_id === credentialId
      );
      if (credential) {
        return { username: user.username, credential };
      }
    }

    return null;
  }

  public async hasReachedMaxCredentials(username: string): Promise<boolean> {
    const credentials = await this.getCredentials(username);
    const config = this.getConfig();
    return credentials.length >= config.maxCredentialsPerUser;
  }

  public async enableWebAuthnMfa(username: string): Promise<void> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const existingCreds =
      (user.mfa?.methods?.webauthn?.credentials as WebAuthnCredential[]) ?? [];
    if (existingCreds.length === 0) {
      throw new Error(
        'Cannot enable WebAuthn MFA without any registered credentials'
      );
    }

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: true,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            ...user.mfa?.methods?.webauthn,
            enabled: true,
            verified_at: user.mfa?.methods?.webauthn?.verified_at ?? new Date(),
          },
        },
      },
    });

    this.logger.info('WebAuthn MFA enabled', { username });
  }

  public async disableWebAuthnMfa(username: string): Promise<void> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const hasOtherMethods =
      !!(user.mfa?.methods?.totp?.enabled && user.mfa?.methods?.totp?.secret) ||
      !!user.mfa?.methods?.email?.enabled;

    await this.userService.updateById(user._id as string, {
      mfa: {
        ...user.mfa,
        enabled: hasOtherMethods,
        methods: {
          ...user.mfa?.methods,
          webauthn: {
            enabled: false,
            credentials: [],
            verified_at: undefined,
          },
        },
      },
    });

    this.logger.info('WebAuthn MFA disabled', { username });
  }

  public generateDefaultCredentialName(
    userAgent: string,
    authenticatorAttachment?: 'platform' | 'cross-platform'
  ): string {
    if (authenticatorAttachment === 'cross-platform') {
      return 'Security Key';
    }

    const ua = userAgent.toLowerCase();

    if (ua.includes('macintosh') || ua.includes('mac os')) {
      if (ua.includes('iphone') || ua.includes('ipad')) {
        return 'iPhone/iPad';
      }
      return 'Mac Touch ID';
    }

    if (ua.includes('windows')) {
      return 'Windows Hello';
    }

    if (ua.includes('android')) {
      return 'Android Device';
    }

    if (ua.includes('linux')) {
      return 'Linux Device';
    }

    if (ua.includes('iphone')) {
      return 'iPhone';
    }

    if (ua.includes('ipad')) {
      return 'iPad';
    }

    return 'Passkey';
  }
}
