import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUser } from '../../../src/types/user.js';
import { AccountProfileService } from '../../../src/services/account-profile.service.js';

const user = {
  _id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  custom_identifier_1: 'member-1',
} as IUser;

describe('AccountProfileService', () => {
  const dependencies = {
    findUserById: vi.fn().mockResolvedValue(user),
    getCustomIdentifierFields: vi.fn().mockReturnValue([]),
    getCustomIdentifier: vi.fn(),
    isCustomIdentifierAvailable: vi.fn().mockResolvedValue(true),
    setCustomIdentifier: vi.fn().mockResolvedValue(undefined),
    removeCustomIdentifier: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(user),
    removeAvatar: vi.fn().mockResolvedValue(undefined),
    updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    storeAvatar: vi.fn().mockResolvedValue('avatars/new.png'),
    deleteAvatar: vi.fn().mockResolvedValue(undefined),
    reportAvatarCleanupFailure: vi.fn(),
  };
  let service: AccountProfileService<{ originalname: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.findUserById.mockResolvedValue(user);
    dependencies.getCustomIdentifierFields.mockReturnValue([]);
    dependencies.isCustomIdentifierAvailable.mockResolvedValue(true);
    dependencies.updateProfile.mockResolvedValue(user);
    dependencies.removeAvatar.mockResolvedValue(undefined);
    dependencies.updateNotificationPreferences.mockResolvedValue(undefined);
    dependencies.storeAvatar.mockResolvedValue('avatars/new.png');
    dependencies.deleteAvatar.mockResolvedValue(undefined);
    service = new AccountProfileService(dependencies);
  });

  it('normalizes notification preference input', async () => {
    await expect(
      service.updateNotificationPreferences(
        'user-1',
        {
          preferred_channel: 'sms',
          security_alerts: 'on',
          new_session_alerts: 'off',
          marketing: 'on',
        },
        true
      )
    ).resolves.toEqual({
      status: 'success',
      preferences: {
        preferred_channel: 'sms',
        security_alerts: true,
        new_session_alerts: false,
        marketing: true,
      },
    });
  });

  it('does not persist disabled notification preferences', async () => {
    await expect(
      service.updateNotificationPreferences('user-1', {}, false)
    ).resolves.toEqual({ status: 'disabled' });
    expect(dependencies.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it('falls back to automatic notification delivery for malformed input', async () => {
    await service.updateNotificationPreferences('user-1', null, true);

    expect(dependencies.updateNotificationPreferences).toHaveBeenCalledWith(
      'user-1',
      {
        preferred_channel: 'auto',
        security_alerts: false,
        new_session_alerts: false,
        marketing: false,
      }
    );
  });

  it('normalizes profile names and permits clearing the phone number', async () => {
    await service.updateProfile({
      userId: 'user-1',
      formData: { firstname: ' Alice ', lastname: ' Doe ', phone: '  ' },
    });

    expect(dependencies.updateProfile).toHaveBeenCalledWith('user-1', {
      given_name: 'Alice',
      family_name: 'Doe',
      name: 'Alice Doe',
      phone_number: '',
    });
  });

  it('rejects malformed profile fields before reading persistence', async () => {
    await expect(
      service.updateProfile({
        userId: 'user-1',
        formData: { phone: ['not', 'a', 'string'] },
      })
    ).resolves.toEqual({
      status: 'invalid',
      error: 'Invalid profile field value',
    });
    expect(dependencies.findUserById).not.toHaveBeenCalled();
  });

  it('reports a missing persisted user before applying side effects', async () => {
    dependencies.findUserById.mockResolvedValue(undefined);

    await expect(
      service.updateProfile({ userId: 'user-1', formData: {} })
    ).resolves.toEqual({ status: 'user_not_found' });
    expect(dependencies.storeAvatar).not.toHaveBeenCalled();
    expect(dependencies.updateProfile).not.toHaveBeenCalled();
  });

  it('validates and normalizes all custom identifiers before side effects', async () => {
    dependencies.getCustomIdentifierFields.mockReturnValue([
      {
        slot: 1,
        name: 'Member ID',
        edit_policy: 'full',
        validation_type: 'regex',
        pattern: '[A-Z]{2}\\d{2}',
        case_sensitive: false,
      },
      {
        slot: 2,
        name: 'Optional ID',
        edit_policy: 'full',
        validation_type: 'none',
        case_sensitive: true,
      },
    ]);

    await service.updateProfile({
      userId: 'user-1',
      formData: {
        custom_identifier_1: ' AB12 ',
        custom_identifier_2: ' ',
      },
    });

    expect(dependencies.isCustomIdentifierAvailable).toHaveBeenCalledWith(
      1,
      'ab12',
      'user-1'
    );
    expect(dependencies.setCustomIdentifier).toHaveBeenCalledWith(
      'user-1',
      1,
      'ab12'
    );
    expect(dependencies.removeCustomIdentifier).toHaveBeenCalledWith(
      'user-1',
      2
    );
  });

  it('rejects an unavailable identifier before storing an avatar', async () => {
    dependencies.getCustomIdentifierFields.mockReturnValue([
      {
        slot: 1,
        name: 'Member ID',
        edit_policy: 'full',
        validation_type: 'none',
        case_sensitive: false,
      },
    ]);
    dependencies.isCustomIdentifierAvailable.mockResolvedValue(false);

    await expect(
      service.updateProfile({
        userId: 'user-1',
        formData: { custom_identifier_1: 'Taken' },
        file: { originalname: 'avatar.png' },
      })
    ).resolves.toEqual({
      status: 'invalid',
      error: 'This Member ID is already in use',
    });
    expect(dependencies.storeAvatar).not.toHaveBeenCalled();
  });

  it('keeps the old avatar until the new profile is persisted', async () => {
    const order: string[] = [];
    dependencies.updateProfile.mockImplementation(async () => {
      order.push('profile');
      return user;
    });
    dependencies.deleteAvatar.mockImplementation(async () => {
      order.push('delete-old');
    });

    await service.updateProfile({
      userId: 'user-1',
      currentPicture: 'avatars/old.png',
      formData: {},
      file: { originalname: 'avatar.png' },
    });

    expect(order).toEqual(['profile', 'delete-old']);
    expect(dependencies.updateProfile).toHaveBeenCalledWith('user-1', {
      picture: 'avatars/new.png',
    });
  });

  it('removes an orphaned new avatar when persistence fails', async () => {
    const failure = new Error('database unavailable');
    dependencies.updateProfile.mockRejectedValue(failure);

    await expect(
      service.updateProfile({
        userId: 'user-1',
        currentPicture: 'avatars/old.png',
        formData: {},
        file: { originalname: 'avatar.png' },
      })
    ).rejects.toBe(failure);
    expect(dependencies.deleteAvatar).toHaveBeenCalledWith('avatars/new.png');
    expect(dependencies.deleteAvatar).not.toHaveBeenCalledWith(
      'avatars/old.png'
    );
  });

  it('removes the persisted avatar before deleting its storage object', async () => {
    const order: string[] = [];
    dependencies.removeAvatar.mockImplementation(async () => {
      order.push('persistence');
    });
    dependencies.deleteAvatar.mockImplementation(async () => {
      order.push('storage');
    });

    await expect(
      service.removeAvatar('user-1', 'avatars/current.png')
    ).resolves.toEqual({});

    expect(order).toEqual(['persistence', 'storage']);
    expect(dependencies.removeAvatar).toHaveBeenCalledWith('user-1');
    expect(dependencies.deleteAvatar).toHaveBeenCalledWith(
      'avatars/current.png'
    );
  });

  it('contains storage cleanup failure after avatar persistence succeeds', async () => {
    const failure = new Error('storage unavailable');
    dependencies.deleteAvatar.mockRejectedValue(failure);

    await expect(
      service.removeAvatar('user-1', 'avatars/current.png')
    ).resolves.toEqual({ cleanupError: failure });
  });

  it('does not attempt storage deletion when no avatar is recorded', async () => {
    await expect(service.removeAvatar('user-1')).resolves.toEqual({});

    expect(dependencies.removeAvatar).toHaveBeenCalledWith('user-1');
    expect(dependencies.deleteAvatar).not.toHaveBeenCalled();
  });

  it('does not hide avatar persistence failure', async () => {
    const failure = new Error('database unavailable');
    dependencies.removeAvatar.mockRejectedValue(failure);

    await expect(
      service.removeAvatar('user-1', 'avatars/current.png')
    ).rejects.toBe(failure);
    expect(dependencies.deleteAvatar).not.toHaveBeenCalled();
  });

  it('reports cleanup failures without replacing the profile result', async () => {
    const cleanupFailure = new Error('storage unavailable');
    dependencies.deleteAvatar.mockRejectedValue(cleanupFailure);

    await expect(
      service.updateProfile({
        userId: 'user-1',
        currentPicture: 'avatars/old.png',
        formData: {},
        file: { originalname: 'avatar.png' },
      })
    ).resolves.toEqual({ status: 'success', updatedUser: user });
    expect(dependencies.reportAvatarCleanupFailure).toHaveBeenCalledWith(
      cleanupFailure,
      'avatars/old.png'
    );
  });
});
