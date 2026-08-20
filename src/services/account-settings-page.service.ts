import type { RuntimeConfig } from '../config/types.js';
import type {
  CustomIdentifierFieldConfig,
  PasswordPolicy,
} from '../di/interfaces/user-service.interface.js';
import type { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import type { IRecoveryUtils } from '../di/interfaces/recovery-utils.interface.js';
import type { SessionUserAccount } from '../types/session-data.js';
import type {
  ISocialIntegration,
  SocialProvider,
} from '../types/social-integration.js';
import type { IUser } from '../types/user.js';

export type AccountSettingsPage =
  | 'profile'
  | 'preferences'
  | 'notifications'
  | 'security'
  | 'recovery'
  | 'social';

type MfaConfig = ReturnType<IMfaUtils['getMfaConfig']>;
type RecoveryConfig = ReturnType<IRecoveryUtils['getRecoveryConfig']>;
type NotificationConfig = RuntimeConfig['notifications'];
type ResolvedSessionUser = Omit<SessionUserAccount, 'picture'> & {
  picture: string;
};

export interface AccountSettingsPageDependencies {
  findUserByUsername(username: string): Promise<IUser | undefined>;
  getCustomIdentifierFields(): CustomIdentifierFieldConfig[];
  resolvePictureUrl(picture: string | null | undefined): Promise<string>;
  findSocialIntegrations(userId: string): Promise<ISocialIntegration[]>;
  getAvailableSocialProviders(): SocialProvider[];
  isSocialProviderAvailable(provider: SocialProvider): boolean;
  getPasswordPolicy(): PasswordPolicy;
  getMfaConfig(): MfaConfig;
  getRecoveryConfig(): RecoveryConfig;
  getNotificationConfig(): NotificationConfig;
}

interface ProfilePageModel {
  page: 'profile';
  locals: {
    title: 'Account Settings - Profile';
    pageUser: ResolvedSessionUser &
      Pick<
        IUser,
        'custom_identifier_1' | 'custom_identifier_2' | 'custom_identifier_3'
      >;
    customIdentifierFields: CustomIdentifierFieldConfig[];
  };
}

interface PreferencesPageModel {
  page: 'preferences';
  locals: {
    title: 'Account Settings - Preferences';
    pageUser: ResolvedSessionUser;
  };
}

interface NotificationsPageModel {
  page: 'notifications';
  locals: {
    title: 'Account Settings - Notifications';
    pageUser: ResolvedSessionUser &
      Pick<
        IUser,
        | 'phone_number'
        | 'phone_number_verified'
        | 'notification_preferences'
        | 'recovery'
      >;
    notificationConfig: NotificationConfig;
  };
}

interface SecurityPageModel {
  page: 'security';
  locals: {
    title: 'Account Settings - Security';
    pageUser: ResolvedSessionUser & Pick<IUser, 'mfa'>;
    mfaConfig: MfaConfig;
    passwordPolicy: PasswordPolicy;
    hasPassword: boolean;
    isSpecialPasswordCase: boolean;
  };
}

interface RecoveryPageModel {
  page: 'recovery';
  locals: {
    title: 'Account Settings - Recovery';
    pageUser: ResolvedSessionUser & Pick<IUser, 'recovery'>;
    recoveryConfig: RecoveryConfig;
  };
}

export interface SocialProviderPageState {
  provider: SocialProvider;
  isLinked: boolean;
  integration: ISocialIntegration | null;
  isAvailable: boolean;
  canUnlink: boolean;
}

interface SocialPageModel {
  page: 'social';
  locals: {
    title: 'Account Settings - Social Accounts';
    pageUser: ResolvedSessionUser;
    socialProviders: SocialProviderPageState[];
    hasPassword: boolean;
  };
}

export type AccountSettingsPageModel =
  | ProfilePageModel
  | PreferencesPageModel
  | NotificationsPageModel
  | SecurityPageModel
  | RecoveryPageModel
  | SocialPageModel;

export type AccountSettingsPageResult =
  | { status: 'user_not_found' }
  | { status: 'ready'; model: AccountSettingsPageModel };

export class AccountSettingsPageService {
  constructor(private readonly dependencies: AccountSettingsPageDependencies) {}

  public async load(
    page: AccountSettingsPage,
    sessionUser: SessionUserAccount
  ): Promise<AccountSettingsPageResult> {
    if (page === 'preferences') {
      return {
        status: 'ready',
        model: {
          page,
          locals: {
            title: 'Account Settings - Preferences',
            pageUser: await this.resolveSessionUser(sessionUser),
          },
        },
      };
    }

    const user = await this.dependencies.findUserByUsername(
      sessionUser.username
    );
    if (!user) {
      return { status: 'user_not_found' };
    }

    switch (page) {
      case 'profile':
        return this.profile(sessionUser, user);
      case 'notifications':
        return this.notifications(sessionUser, user);
      case 'security':
        return this.security(sessionUser, user);
      case 'recovery':
        return this.recovery(sessionUser, user);
      case 'social':
        return this.social(sessionUser, user);
    }
  }

  private async resolveSessionUser(
    sessionUser: SessionUserAccount
  ): Promise<ResolvedSessionUser> {
    return {
      ...sessionUser,
      picture: await this.dependencies.resolvePictureUrl(sessionUser.picture),
    };
  }

  private async profile(
    sessionUser: SessionUserAccount,
    user: IUser
  ): Promise<AccountSettingsPageResult> {
    return {
      status: 'ready',
      model: {
        page: 'profile',
        locals: {
          title: 'Account Settings - Profile',
          pageUser: {
            ...(await this.resolveSessionUser(sessionUser)),
            custom_identifier_1: user.custom_identifier_1,
            custom_identifier_2: user.custom_identifier_2,
            custom_identifier_3: user.custom_identifier_3,
          },
          customIdentifierFields: this.dependencies
            .getCustomIdentifierFields()
            .filter(field => field.edit_policy !== 'admin_only'),
        },
      },
    };
  }

  private async notifications(
    sessionUser: SessionUserAccount,
    user: IUser
  ): Promise<AccountSettingsPageResult> {
    return {
      status: 'ready',
      model: {
        page: 'notifications',
        locals: {
          title: 'Account Settings - Notifications',
          pageUser: {
            ...(await this.resolveSessionUser(sessionUser)),
            phone_number: user.phone_number,
            phone_number_verified: user.phone_number_verified,
            notification_preferences: user.notification_preferences,
            recovery: user.recovery,
          },
          notificationConfig: this.dependencies.getNotificationConfig(),
        },
      },
    };
  }

  private async security(
    sessionUser: SessionUserAccount,
    user: IUser
  ): Promise<AccountSettingsPageResult> {
    const integrations = await this.dependencies.findSocialIntegrations(
      sessionUser.id
    );
    const linkedProviders = new Set(
      integrations.map(integration => integration.method)
    );
    const hasPassword = Boolean(user.password?.trim());

    return {
      status: 'ready',
      model: {
        page: 'security',
        locals: {
          title: 'Account Settings - Security',
          pageUser: {
            ...(await this.resolveSessionUser(sessionUser)),
            mfa: user.mfa,
          },
          mfaConfig: this.dependencies.getMfaConfig(),
          passwordPolicy: this.dependencies.getPasswordPolicy(),
          hasPassword,
          isSpecialPasswordCase: !hasPassword && linkedProviders.size === 1,
        },
      },
    };
  }

  private async recovery(
    sessionUser: SessionUserAccount,
    user: IUser
  ): Promise<AccountSettingsPageResult> {
    return {
      status: 'ready',
      model: {
        page: 'recovery',
        locals: {
          title: 'Account Settings - Recovery',
          pageUser: {
            ...(await this.resolveSessionUser(sessionUser)),
            recovery: user.recovery,
          },
          recoveryConfig: this.dependencies.getRecoveryConfig(),
        },
      },
    };
  }

  private async social(
    sessionUser: SessionUserAccount,
    user: IUser
  ): Promise<AccountSettingsPageResult> {
    const integrations = await this.dependencies.findSocialIntegrations(
      sessionUser.id
    );
    const availableProviders = this.dependencies.getAvailableSocialProviders();
    const linkedProviders = new Set(
      integrations.map(integration => integration.method)
    );
    const hasPassword = Boolean(user.password?.trim());

    return {
      status: 'ready',
      model: {
        page: 'social',
        locals: {
          title: 'Account Settings - Social Accounts',
          pageUser: await this.resolveSessionUser(sessionUser),
          socialProviders: availableProviders.map(provider => ({
            provider,
            isLinked: linkedProviders.has(provider),
            integration:
              integrations.find(
                integration => integration.method === provider
              ) ?? null,
            isAvailable: this.dependencies.isSocialProviderAvailable(provider),
            canUnlink: !(
              linkedProviders.size === 1 &&
              linkedProviders.has(provider) &&
              !hasPassword
            ),
          })),
          hasPassword,
        },
      },
    };
  }
}
