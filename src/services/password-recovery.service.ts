import type {
  PasswordPolicy,
  PasswordValidationResult,
} from '../di/interfaces/user-service.interface.js';
import type { IUser } from '../types/user.js';

export interface PasswordRecoveryDependencies {
  isValidEmailAddress(email: string): boolean;
  getPasswordPolicy(): PasswordPolicy;
  validatePassword(password: string): PasswordValidationResult;
  resetPassword(token: string, password: string): Promise<IUser>;
  generatePasswordResetToken(
    email: string
  ): Promise<{ user: IUser; resetToken: string }>;
  buildResetUrl(resetToken: string): string;
  sendPasswordReset(
    recipient: { email: string; username: string; locale?: string },
    resetUrl: string
  ): Promise<unknown>;
  revokeSessions(username: string): Promise<number>;
  sendResetNotification(
    recipient: string,
    subject: string,
    template: string,
    locals: Record<string, unknown>
  ): Promise<unknown>;
  applicationTitle(): string;
  formatResetTime(): string;
  info(message: string, context?: Record<string, unknown>): void;
  error(error: unknown, context: Record<string, unknown>): void;
}

export type ResetSubmissionResult =
  | { status: 'missing_token' }
  | { status: 'passwords_do_not_match'; token: string }
  | { status: 'invalid_password'; token: string; messages: string[] }
  | { status: 'success'; user: IUser };

export type PasswordResetRequestResult =
  { status: 'invalid_email' } | { status: 'accepted' };

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class PasswordRecoveryService {
  constructor(private readonly dependencies: PasswordRecoveryDependencies) {}

  public resetPage(
    token: unknown
  ):
    | { status: 'missing_token' }
    | { status: 'ready'; token: string; passwordPolicy: PasswordPolicy } {
    const normalizedToken = nonEmptyString(token);
    if (!normalizedToken) {
      return { status: 'missing_token' };
    }

    return {
      status: 'ready',
      token: normalizedToken,
      passwordPolicy: this.dependencies.getPasswordPolicy(),
    };
  }

  public async submitReset(input: unknown): Promise<ResetSubmissionResult> {
    const form = asRecord(input);
    const token = nonEmptyString(form.token);
    if (!token) {
      return { status: 'missing_token' };
    }

    const password =
      typeof form.password === 'string' ? form.password : undefined;
    const confirmPassword =
      typeof form['confirm-password'] === 'string'
        ? form['confirm-password']
        : undefined;

    if (password === undefined || confirmPassword === undefined) {
      return {
        status: 'invalid_password',
        token,
        messages: ['Invalid password value'],
      };
    }

    if (password !== confirmPassword) {
      return { status: 'passwords_do_not_match', token };
    }

    const passwordValidation = this.dependencies.validatePassword(password);
    if (!passwordValidation.isValid) {
      return {
        status: 'invalid_password',
        token,
        messages: passwordValidation.messages,
      };
    }

    const user = await this.dependencies.resetPassword(token, password);
    this.dependencies.info('Password reset successfully', {
      username: user.username,
      id: user._id,
    });

    await this.revokeSessions(user);
    await this.notifyReset(user);

    return { status: 'success', user };
  }

  public async requestReset(
    emailValue: unknown
  ): Promise<PasswordResetRequestResult> {
    if (
      typeof emailValue !== 'string' ||
      !emailValue ||
      !this.dependencies.isValidEmailAddress(emailValue)
    ) {
      return { status: 'invalid_email' };
    }

    try {
      const { user, resetToken } =
        await this.dependencies.generatePasswordResetToken(emailValue);
      await this.dependencies.sendPasswordReset(
        {
          email: emailValue,
          username: user.given_name || user.username,
          locale: user.locale,
        },
        this.dependencies.buildResetUrl(resetToken)
      );
      this.dependencies.info('Password reset email sent', {
        email: emailValue,
      });
    } catch (error) {
      // A request for an unknown account must be indistinguishable from delivery.
      this.dependencies.error(error, {
        email: emailValue,
        context: 'password_reset_token_generation_failed',
      });
    }

    return { status: 'accepted' };
  }

  private async revokeSessions(user: IUser): Promise<void> {
    try {
      const revokedCount = await this.dependencies.revokeSessions(
        user.username
      );
      if (revokedCount > 0) {
        this.dependencies.info('Revoked sessions after password reset', {
          username: user.username,
          revokedCount,
        });
      }
    } catch (error) {
      this.dependencies.error(error, {
        context: 'session_revocation_after_reset_failed',
        username: user.username,
      });
    }
  }

  private async notifyReset(user: IUser): Promise<void> {
    const applicationTitle = this.dependencies.applicationTitle();

    try {
      await this.dependencies.sendResetNotification(
        user.email ?? '',
        `Your ${applicationTitle} password has been reset`,
        'email/mail.njk',
        {
          title: `Your ${applicationTitle} password has been reset`,
          content: `
              <p>Hello ${user.given_name || user.username},</p>
              <p>Your password has been successfully reset. If you did not request this change, please contact support immediately.</p>
              <p><strong>Account:</strong> ${user.email}</p>
              <p><strong>Reset time:</strong> ${this.dependencies.formatResetTime()}</p>
              <p>For security reasons, we recommend logging in and changing your password if you did not initiate this reset or Contact us immediately.</p>
            `,
          username: `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        }
      );
      this.dependencies.info('Password reset notification email sent', {
        username: user.username,
        email: user.email,
      });
    } catch (error) {
      this.dependencies.error(error, {
        username: user.username,
        email: user.email,
        context: 'password_reset_notification_failed',
      });
    }
  }
}
