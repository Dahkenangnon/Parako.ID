import type { PasswordChangeData } from '../di/interfaces/user/user-credentials-service.interface.js';
import type { PasswordValidationResult } from '../di/interfaces/user/user-credentials-service.interface.js';
import type { IUser } from '../types/user.js';

interface PasswordBreachPolicy {
  enabled?: boolean;
  check_on_password_change?: boolean;
  api_timeout_ms?: number;
  min_breach_count?: number;
}

interface RecoveryCooldown {
  inCooldown: boolean;
  hoursRemaining?: number;
}

interface BreachResult {
  breached: boolean;
  count: number;
}

export interface AccountPasswordChangeDependencies {
  findUserByUsername(username: string): Promise<IUser | undefined>;
  checkRecoveryCooldown(user: IUser): RecoveryCooldown;
  findLinkedProviders(userId: string): Promise<unknown[]>;
  validatePassword(password: string): PasswordValidationResult;
  checkPasswordBreach(
    password: string,
    timeoutMs?: number
  ): Promise<BreachResult>;
  changePassword(userId: string, data: PasswordChangeData): Promise<void>;
  warnBreachCheckFailure(error: unknown): void;
}

export interface AccountPasswordChangeInput {
  userId: string;
  username: string;
  formData: unknown;
  breachPolicy?: PasswordBreachPolicy;
}

export type AccountPasswordChangeResult =
  | { status: 'invalid'; error: string }
  | { status: 'user_not_found' }
  | { status: 'success' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export class AccountPasswordChangeService {
  constructor(
    private readonly dependencies: AccountPasswordChangeDependencies
  ) {}

  async change(
    input: AccountPasswordChangeInput
  ): Promise<AccountPasswordChangeResult> {
    const form = asRecord(input.formData);
    if (!form)
      return { status: 'invalid', error: 'Invalid password field value' };

    const { currentPassword, newPassword, confirmPassword } = form;
    if (
      (currentPassword !== undefined && typeof currentPassword !== 'string') ||
      (newPassword !== undefined && typeof newPassword !== 'string') ||
      (confirmPassword !== undefined && typeof confirmPassword !== 'string')
    ) {
      return { status: 'invalid', error: 'Invalid password field value' };
    }

    const user = await this.dependencies.findUserByUsername(input.username);
    if (!user) return { status: 'user_not_found' };

    const cooldown = this.dependencies.checkRecoveryCooldown(user);
    if (cooldown.inCooldown) {
      return {
        status: 'invalid',
        error: `For security, password changes are restricted for ${cooldown.hoursRemaining} hour(s) after account recovery.`,
      };
    }

    const hasPassword = Boolean(user.password?.trim());
    const linkedProviders = await this.dependencies.findLinkedProviders(
      input.userId
    );
    const canSetInitialPassword = !hasPassword && linkedProviders.length > 0;

    if (canSetInitialPassword) {
      if (!newPassword || !confirmPassword) {
        return {
          status: 'invalid',
          error: 'New password and confirmation are required',
        };
      }
    } else if (!currentPassword || !newPassword || !confirmPassword) {
      return { status: 'invalid', error: 'All password fields are required' };
    }

    if (newPassword !== confirmPassword) {
      return {
        status: 'invalid',
        error: 'New password and confirmation do not match',
      };
    }

    const validation = this.dependencies.validatePassword(newPassword);
    if (!validation.isValid) {
      return {
        status: 'invalid',
        error: `Password requirements not met: ${validation.messages.join(', ')}`,
      };
    }

    const breachError = await this.checkBreachPolicy(
      newPassword,
      input.breachPolicy
    );
    if (breachError) return { status: 'invalid', error: breachError };

    await this.dependencies.changePassword(input.userId, {
      currentPassword: canSetInitialPassword ? undefined : currentPassword,
      newPassword,
    });
    return { status: 'success' };
  }

  private async checkBreachPolicy(
    password: string,
    policy: PasswordBreachPolicy | undefined
  ): Promise<string | null> {
    if (!policy?.enabled || !policy.check_on_password_change) return null;

    try {
      const result = await this.dependencies.checkPasswordBreach(
        password,
        policy.api_timeout_ms
      );
      if (result.breached && result.count >= (policy.min_breach_count ?? 1)) {
        return `This password has appeared in ${result.count} known data ${result.count === 1 ? 'breach' : 'breaches'} and cannot be used. Please choose a different password.`;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('data breaches')) {
        return error.message;
      }
      this.dependencies.warnBreachCheckFailure(error);
    }
    return null;
  }
}
