import type { IUser } from '../types/user.js';

interface VerificationRecipient {
  email: string;
  username: string;
  locale?: string;
}

export interface EmailVerificationDependencies {
  isValidEmailAddress(email: string): boolean;
  findUserByEmail(email: string): Promise<IUser | undefined>;
  findUserById(userId: string): Promise<IUser | undefined>;
  generateVerificationToken(userId: string): Promise<string>;
  verifyEmail(token: string): Promise<IUser>;
  buildVerificationUrl(token: string): string;
  sendVerification(
    recipient: VerificationRecipient,
    verificationUrl: string
  ): Promise<void>;
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

export type PublicVerificationRequestResult =
  { status: 'invalid' } | { status: 'accepted' };

export type AuthenticatedVerificationResendResult =
  | { status: 'user_not_found' }
  | { status: 'email_missing' }
  | { status: 'already_verified' }
  | { status: 'sent' };

export type VerifyEmailResult =
  { status: 'invalid_token' } | { status: 'verified'; user: IUser };

export class EmailVerificationService {
  constructor(private readonly dependencies: EmailVerificationDependencies) {}

  async request(email: unknown): Promise<PublicVerificationRequestResult> {
    if (
      typeof email !== 'string' ||
      !email ||
      !this.dependencies.isValidEmailAddress(email)
    ) {
      return { status: 'invalid' };
    }

    try {
      const user = await this.dependencies.findUserByEmail(email);
      if (user && !user.email_verified) {
        await this.sendForUser(user);
        this.dependencies.info('Verification email sent', { email });
      } else if (user) {
        this.dependencies.info(
          'Email verification requested for an already verified user',
          { email }
        );
      } else {
        this.dependencies.info(
          'Email verification requested for non-existent user',
          { email }
        );
      }
    } catch (error) {
      this.dependencies.error('Error sending verification email', {
        email,
        error,
      });
    }

    return { status: 'accepted' };
  }

  async resend(userId: string): Promise<AuthenticatedVerificationResendResult> {
    const user = await this.dependencies.findUserById(userId);
    if (!user) return { status: 'user_not_found' };
    if (!user.email) return { status: 'email_missing' };
    if (user.email_verified) return { status: 'already_verified' };

    await this.sendForUser(user);
    this.dependencies.info('Verification email resent', {
      userId: user._id,
      email: user.email,
    });
    return { status: 'sent' };
  }

  async verify(token: unknown): Promise<VerifyEmailResult> {
    if (!token || typeof token !== 'string') {
      return { status: 'invalid_token' };
    }

    const user = await this.dependencies.verifyEmail(token);
    this.dependencies.info('Email verified successfully', {
      userId: user._id,
      email: user.email,
    });
    return { status: 'verified', user };
  }

  private async sendForUser(user: IUser): Promise<void> {
    if (!user.email) {
      throw new Error(
        'Cannot send email verification without an email address'
      );
    }

    const userId = String(user._id ?? user.id ?? '');
    const verificationToken =
      await this.dependencies.generateVerificationToken(userId);
    await this.dependencies.sendVerification(
      {
        email: user.email,
        username: user.given_name || user.username,
        locale: user.locale,
      },
      this.dependencies.buildVerificationUrl(verificationToken)
    );
  }
}
