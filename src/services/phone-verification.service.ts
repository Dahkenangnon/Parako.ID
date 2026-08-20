import type { PhoneVerificationChallenge } from '../di/interfaces/auth-service.interface.js';
import type { IUser } from '../types/user.js';

export interface PhoneVerificationServiceDependencies {
  phoneVerificationRequired(): boolean;
  generateChallenge(userId: string): Promise<PhoneVerificationChallenge>;
  renewChallenge(
    verificationToken: string,
    deliver: (challenge: PhoneVerificationChallenge) => Promise<boolean>
  ): Promise<PhoneVerificationChallenge>;
  verifyPhone(verificationToken: string, code: string): Promise<IUser>;
  sendVerificationCode(
    phone: string,
    code: string,
    ip?: string
  ): Promise<{ success: boolean; error?: string }>;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface StartedPhoneVerification {
  challenge: PhoneVerificationChallenge;
  delivered: boolean;
}

export class PhoneVerificationService {
  constructor(
    private readonly dependencies: PhoneVerificationServiceDependencies
  ) {}

  public requiresVerification(user: {
    phone_number?: string;
    phone_number_verified?: boolean;
  }): boolean {
    return Boolean(
      this.dependencies.phoneVerificationRequired() &&
      user.phone_number &&
      !user.phone_number_verified
    );
  }

  public async start(
    userId: string,
    ip?: string
  ): Promise<StartedPhoneVerification> {
    const challenge = await this.dependencies.generateChallenge(userId);
    return {
      challenge,
      delivered: await this.deliver(challenge, ip),
    };
  }

  public renew(
    verificationToken: string,
    ip?: string
  ): Promise<PhoneVerificationChallenge> {
    return this.dependencies.renewChallenge(verificationToken, challenge =>
      this.deliver(challenge, ip)
    );
  }

  public verify(verificationToken: string, code: string): Promise<IUser> {
    return this.dependencies.verifyPhone(verificationToken, code);
  }

  private async deliver(
    challenge: PhoneVerificationChallenge,
    ip?: string
  ): Promise<boolean> {
    const phoneNumber = challenge.user.phone_number;
    if (!phoneNumber) {
      this.dependencies.warn('Phone verification SMS delivery failed', {
        userId: String(challenge.user._id ?? challenge.user.id ?? ''),
        error: 'User has no phone number',
      });
      return false;
    }

    const result = await this.dependencies.sendVerificationCode(
      phoneNumber,
      challenge.code,
      ip
    );
    if (!result.success) {
      this.dependencies.warn('Phone verification SMS delivery failed', {
        userId: String(challenge.user._id ?? challenge.user.id ?? ''),
        error: result.error,
      });
    }
    return result.success;
  }
}
