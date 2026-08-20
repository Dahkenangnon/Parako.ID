import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSettingsPageService } from '../../../src/services/account-settings-page.service.js';
import type { SessionUserAccount } from '../../../src/types/session-data.js';
import type { ISocialIntegration } from '../../../src/types/social-integration.js';
import type { IUser } from '../../../src/types/user.js';

const sessionUser: SessionUserAccount = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  picture: 'avatars/alice.png',
};

const user = {
  _id: 'user-1',
  username: 'alice',
  password: 'password-hash',
  phone_number: '+22900000000',
  phone_number_verified: true,
  notification_preferences: { preferred_channel: 'email' },
  recovery: { enabled: true },
  mfa: { enabled: true },
  custom_identifier_1: 'member-1',
} as IUser;

const googleIntegration = {
  _id: 'integration-1',
  user_id: 'user-1',
  method: 'google',
  provider_sub: 'google-1',
  provider_data: { sub: 'google-1' },
  is_active: true,
} as ISocialIntegration;

describe('AccountSettingsPageService', () => {
  const dependencies = {
    findUserByUsername: vi.fn().mockResolvedValue(user),
    getCustomIdentifierFields: vi.fn().mockReturnValue([]),
    resolvePictureUrl: vi.fn().mockResolvedValue('/media/avatars/alice.png'),
    findSocialIntegrations: vi.fn().mockResolvedValue([]),
    getAvailableSocialProviders: vi.fn().mockReturnValue([]),
    isSocialProviderAvailable: vi.fn().mockReturnValue(true),
    getPasswordPolicy: vi.fn().mockReturnValue({ minLength: 12 }),
    getMfaConfig: vi.fn().mockReturnValue({ enabled: true }),
    getRecoveryConfig: vi.fn().mockReturnValue({ enabled: true }),
    getNotificationConfig: vi
      .fn()
      .mockReturnValue({ defaults: { allow_user_preferences: true } }),
  };
  let service: AccountSettingsPageService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.findUserByUsername.mockResolvedValue(user);
    dependencies.getCustomIdentifierFields.mockReturnValue([]);
    dependencies.resolvePictureUrl.mockResolvedValue(
      '/media/avatars/alice.png'
    );
    dependencies.findSocialIntegrations.mockResolvedValue([]);
    dependencies.getAvailableSocialProviders.mockReturnValue([]);
    dependencies.isSocialProviderAvailable.mockReturnValue(true);
    service = new AccountSettingsPageService(dependencies as never);
  });

  it('reports a missing persisted account before resolving page assets', async () => {
    dependencies.findUserByUsername.mockResolvedValue(undefined);

    await expect(service.load('profile', sessionUser)).resolves.toEqual({
      status: 'user_not_found',
    });
    expect(dependencies.resolvePictureUrl).not.toHaveBeenCalled();
  });

  it('loads preferences from the authenticated session without a persistence lookup', async () => {
    const result = await service.load('preferences', sessionUser);

    expect(dependencies.findUserByUsername).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ready',
      model: {
        page: 'preferences',
        locals: {
          title: 'Account Settings - Preferences',
          pageUser: {
            ...sessionUser,
            picture: '/media/avatars/alice.png',
          },
        },
      },
    });
  });

  it('filters administrator-only identifiers from the profile model', async () => {
    dependencies.getCustomIdentifierFields.mockReturnValue([
      { slot: 1, name: 'Member', edit_policy: 'full' },
      { slot: 2, name: 'Internal', edit_policy: 'admin_only' },
    ]);

    const result = await service.load('profile', sessionUser);

    expect(result).toMatchObject({
      status: 'ready',
      model: {
        page: 'profile',
        locals: {
          pageUser: {
            custom_identifier_1: 'member-1',
            picture: '/media/avatars/alice.png',
          },
          customIdentifierFields: [
            { slot: 1, name: 'Member', edit_policy: 'full' },
          ],
        },
      },
    });
  });

  it('loads persisted notification and recovery preferences', async () => {
    const result = await service.load('notifications', sessionUser);

    expect(result).toMatchObject({
      status: 'ready',
      model: {
        page: 'notifications',
        locals: {
          pageUser: {
            phone_number: '+22900000000',
            phone_number_verified: true,
            notification_preferences: { preferred_channel: 'email' },
            recovery: { enabled: true },
          },
          notificationConfig: {
            defaults: { allow_user_preferences: true },
          },
        },
      },
    });
  });

  it('derives passwordless security state from linked providers', async () => {
    dependencies.findUserByUsername.mockResolvedValue({
      ...user,
      password: '   ',
    });
    dependencies.findSocialIntegrations.mockResolvedValue([googleIntegration]);

    const result = await service.load('security', sessionUser);

    expect(result).toMatchObject({
      status: 'ready',
      model: {
        page: 'security',
        locals: {
          mfaConfig: { enabled: true },
          passwordPolicy: { minLength: 12 },
          hasPassword: false,
          isSpecialPasswordCase: true,
        },
      },
    });
  });

  it('loads recovery state and its current policy', async () => {
    const result = await service.load('recovery', sessionUser);

    expect(result).toMatchObject({
      status: 'ready',
      model: {
        page: 'recovery',
        locals: {
          pageUser: { recovery: { enabled: true } },
          recoveryConfig: { enabled: true },
        },
      },
    });
  });

  it('maps linked providers and prevents removing the only sign-in method', async () => {
    dependencies.findUserByUsername.mockResolvedValue({
      ...user,
      password: '',
    });
    dependencies.findSocialIntegrations.mockResolvedValue([googleIntegration]);
    dependencies.getAvailableSocialProviders.mockReturnValue([
      'google',
      'github',
    ]);
    dependencies.isSocialProviderAvailable.mockImplementation(
      provider => provider === 'google'
    );

    const result = await service.load('social', sessionUser);

    expect(result).toMatchObject({
      status: 'ready',
      model: {
        page: 'social',
        locals: {
          hasPassword: false,
          socialProviders: [
            {
              provider: 'google',
              isLinked: true,
              integration: googleIntegration,
              isAvailable: true,
              canUnlink: false,
            },
            {
              provider: 'github',
              isLinked: false,
              integration: null,
              isAvailable: false,
              canUnlink: true,
            },
          ],
        },
      },
    });
  });
});
