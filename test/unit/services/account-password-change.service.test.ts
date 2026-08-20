import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUser } from '../../../src/types/user.js';
import { AccountPasswordChangeService } from '../../../src/services/account-password-change.service.js';

const user = {
  _id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  password: 'password-hash',
} as IUser;

const validForm = {
  currentPassword: 'old-password',
  newPassword: 'new-password',
  confirmPassword: 'new-password',
};

describe('AccountPasswordChangeService', () => {
  const dependencies = {
    findUserByUsername: vi.fn().mockResolvedValue(user),
    checkRecoveryCooldown: vi
      .fn()
      .mockReturnValue({ inCooldown: false, hoursRemaining: 0 }),
    findLinkedProviders: vi.fn().mockResolvedValue([]),
    validatePassword: vi.fn().mockReturnValue({ isValid: true, messages: [] }),
    checkPasswordBreach: vi
      .fn()
      .mockResolvedValue({ breached: false, count: 0 }),
    changePassword: vi.fn().mockResolvedValue(undefined),
    warnBreachCheckFailure: vi.fn(),
  };
  let service: AccountPasswordChangeService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.findUserByUsername.mockResolvedValue(user);
    dependencies.checkRecoveryCooldown.mockReturnValue({
      inCooldown: false,
      hoursRemaining: 0,
    });
    dependencies.findLinkedProviders.mockResolvedValue([]);
    dependencies.validatePassword.mockReturnValue({
      isValid: true,
      messages: [],
    });
    dependencies.checkPasswordBreach.mockResolvedValue({
      breached: false,
      count: 0,
    });
    dependencies.changePassword.mockResolvedValue(undefined);
    service = new AccountPasswordChangeService(dependencies);
  });

  it('rejects malformed form fields before account lookup', async () => {
    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: { ...validForm, newPassword: ['invalid'] },
      })
    ).resolves.toEqual({
      status: 'invalid',
      error: 'Invalid password field value',
    });
    expect(dependencies.findUserByUsername).not.toHaveBeenCalled();
  });

  it('reports a missing persisted account', async () => {
    dependencies.findUserByUsername.mockResolvedValue(undefined);

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
      })
    ).resolves.toEqual({ status: 'user_not_found' });
  });

  it('enforces the recovery cooldown', async () => {
    dependencies.checkRecoveryCooldown.mockReturnValue({
      inCooldown: true,
      hoursRemaining: 7,
    });

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
      })
    ).resolves.toEqual({
      status: 'invalid',
      error:
        'For security, password changes are restricted for 7 hour(s) after account recovery.',
    });
    expect(dependencies.changePassword).not.toHaveBeenCalled();
  });

  it.each([
    [
      { newPassword: 'new', confirmPassword: 'new' },
      'All password fields are required',
    ],
    [
      { ...validForm, confirmPassword: 'different' },
      'New password and confirmation do not match',
    ],
  ])('rejects incomplete password input %#', async (formData, error) => {
    await expect(
      service.change({ userId: 'user-1', username: 'alice', formData })
    ).resolves.toEqual({ status: 'invalid', error });
    expect(dependencies.changePassword).not.toHaveBeenCalled();
  });

  it('reports password policy failures', async () => {
    dependencies.validatePassword.mockReturnValue({
      isValid: false,
      messages: ['too short', 'missing number'],
    });

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
      })
    ).resolves.toEqual({
      status: 'invalid',
      error: 'Password requirements not met: too short, missing number',
    });
  });

  it('allows any passwordless social account to establish a password', async () => {
    dependencies.findUserByUsername.mockResolvedValue({
      ...user,
      password: '',
    });
    dependencies.findLinkedProviders.mockResolvedValue([
      { method: 'google' },
      { method: 'github' },
    ]);

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: {
          newPassword: 'new-password',
          confirmPassword: 'new-password',
        },
      })
    ).resolves.toEqual({ status: 'success' });
    expect(dependencies.changePassword).toHaveBeenCalledWith('user-1', {
      currentPassword: undefined,
      newPassword: 'new-password',
    });
  });

  it('blocks breached passwords at the configured threshold', async () => {
    dependencies.checkPasswordBreach.mockResolvedValue({
      breached: true,
      count: 42,
    });

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
        breachPolicy: {
          enabled: true,
          check_on_password_change: true,
          min_breach_count: 10,
          api_timeout_ms: 1_000,
        },
      })
    ).resolves.toEqual({
      status: 'invalid',
      error:
        'This password has appeared in 42 known data breaches and cannot be used. Please choose a different password.',
    });
    expect(dependencies.checkPasswordBreach).toHaveBeenCalledWith(
      'new-password',
      1_000
    );
  });

  it('uses the singular breach message at the default threshold', async () => {
    dependencies.checkPasswordBreach.mockResolvedValue({
      breached: true,
      count: 1,
    });

    const result = await service.change({
      userId: 'user-1',
      username: 'alice',
      formData: validForm,
      breachPolicy: { enabled: true, check_on_password_change: true },
    });

    expect(result).toEqual({
      status: 'invalid',
      error:
        'This password has appeared in 1 known data breach and cannot be used. Please choose a different password.',
    });
  });

  it('surfaces deliberate breach-policy errors', async () => {
    dependencies.checkPasswordBreach.mockRejectedValue(
      new Error('This password was found in known data breaches')
    );

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
        breachPolicy: { enabled: true, check_on_password_change: true },
      })
    ).resolves.toEqual({
      status: 'invalid',
      error: 'This password was found in known data breaches',
    });
    expect(dependencies.warnBreachCheckFailure).not.toHaveBeenCalled();
  });

  it('allows the change when an optional breach service fails', async () => {
    const failure = new Error('breach service unavailable');
    dependencies.checkPasswordBreach.mockRejectedValue(failure);

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
        breachPolicy: { enabled: true, check_on_password_change: true },
      })
    ).resolves.toEqual({ status: 'success' });
    expect(dependencies.warnBreachCheckFailure).toHaveBeenCalledWith(failure);
    expect(dependencies.changePassword).toHaveBeenCalled();
  });

  it('does not hide password persistence failures', async () => {
    const failure = new Error('database unavailable');
    dependencies.changePassword.mockRejectedValue(failure);

    await expect(
      service.change({
        userId: 'user-1',
        username: 'alice',
        formData: validForm,
      })
    ).rejects.toBe(failure);
  });
});
