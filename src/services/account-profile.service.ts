import type {
  NotificationPreferences,
  ProfileUpdateData,
} from '../di/interfaces/user/user-profile-service.interface.js';
import type { CustomIdentifierEditPolicy } from '../di/interfaces/user/user-custom-identifier-service.interface.js';
import type { IUser } from '../types/user.js';
import {
  validateIdentifier,
  type CustomIdentifierValidationConfig,
} from '../utils/custom-identifier-validation.js';

type UnknownRecord = Record<string, unknown>;

export interface ProfileIdentifierField extends CustomIdentifierValidationConfig {
  slot: 1 | 2 | 3;
  name?: string;
  edit_policy: CustomIdentifierEditPolicy;
  case_sensitive?: boolean;
}

export interface AccountProfileDependencies<TFile> {
  findUserById(userId: string): Promise<IUser | undefined>;
  getCustomIdentifierFields(): ProfileIdentifierField[];
  getCustomIdentifier(user: IUser, slot: 1 | 2 | 3): string | undefined;
  isCustomIdentifierAvailable(
    slot: 1 | 2 | 3,
    value: string,
    excludeUserId: string
  ): Promise<boolean>;
  setCustomIdentifier(
    userId: string,
    slot: 1 | 2 | 3,
    value: string
  ): Promise<unknown>;
  removeCustomIdentifier(userId: string, slot: 1 | 2 | 3): Promise<unknown>;
  updateProfile(userId: string, profile: ProfileUpdateData): Promise<IUser>;
  removeAvatar(userId: string): Promise<void>;
  updateNotificationPreferences(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<unknown>;
  storeAvatar(file: TFile): Promise<string>;
  deleteAvatar(storageKey: string): Promise<void>;
  reportAvatarCleanupFailure(error: unknown, storageKey: string): void;
}

export type NotificationPreferencesUpdateResult =
  | { status: 'disabled' }
  | { status: 'success'; preferences: NotificationPreferences };

export interface AvatarRemovalResult {
  cleanupError?: unknown;
}

export type ProfileUpdateResult =
  | { status: 'invalid'; error: string }
  | { status: 'user_not_found' }
  | { status: 'success'; updatedUser: IUser };

export interface ProfileUpdateInput<TFile> {
  userId: string;
  currentPicture?: string | null;
  formData: unknown;
  file?: TFile;
}

interface IdentifierChange {
  slot: 1 | 2 | 3;
  value: string | null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function buildProfileData(form: UnknownRecord): ProfileUpdateData | null {
  const { firstname, lastname, phone } = form;
  if (
    (firstname !== undefined && typeof firstname !== 'string') ||
    (lastname !== undefined && typeof lastname !== 'string') ||
    (phone !== undefined && typeof phone !== 'string')
  ) {
    return null;
  }

  const profile: ProfileUpdateData = {};
  const trimmedFirstname = firstname?.trim();
  const trimmedLastname = lastname?.trim();

  if (trimmedFirstname) profile.given_name = trimmedFirstname;
  if (trimmedLastname) profile.family_name = trimmedLastname;
  if (trimmedFirstname && trimmedLastname) {
    profile.name = `${trimmedFirstname} ${trimmedLastname}`;
  } else if (trimmedFirstname) {
    profile.name = trimmedFirstname;
  } else if (trimmedLastname) {
    profile.name = trimmedLastname;
  }
  if (phone !== undefined) profile.phone_number = phone.trim() || '';

  return profile;
}

export class AccountProfileService<TFile> {
  constructor(
    private readonly dependencies: AccountProfileDependencies<TFile>
  ) {}

  async updateNotificationPreferences(
    userId: string,
    formData: unknown,
    allowed: boolean
  ): Promise<NotificationPreferencesUpdateResult> {
    if (!allowed) return { status: 'disabled' };

    const form = asRecord(formData) || {};
    const preferredChannel = form.preferred_channel;
    const preferences: NotificationPreferences = {
      preferred_channel:
        preferredChannel === 'email' || preferredChannel === 'sms'
          ? preferredChannel
          : 'auto',
      security_alerts: form.security_alerts === 'on',
      new_session_alerts: form.new_session_alerts === 'on',
      marketing: form.marketing === 'on',
    };

    await this.dependencies.updateNotificationPreferences(userId, preferences);
    return { status: 'success', preferences };
  }

  async removeAvatar(
    userId: string,
    currentPicture?: string | null
  ): Promise<AvatarRemovalResult> {
    await this.dependencies.removeAvatar(userId);
    if (!currentPicture) return {};

    try {
      await this.dependencies.deleteAvatar(currentPicture);
      return {};
    } catch (cleanupError) {
      return { cleanupError };
    }
  }

  async updateProfile(
    input: ProfileUpdateInput<TFile>
  ): Promise<ProfileUpdateResult> {
    const form = asRecord(input.formData);
    if (!form)
      return { status: 'invalid', error: 'Invalid profile field value' };

    const profile = buildProfileData(form);
    if (!profile) {
      return { status: 'invalid', error: 'Invalid profile field value' };
    }

    const user = await this.dependencies.findUserById(input.userId);
    if (!user) return { status: 'user_not_found' };

    const identifierResult = await this.prepareIdentifierChanges(
      form,
      user,
      input.userId
    );
    if ('error' in identifierResult) {
      return { status: 'invalid', error: identifierResult.error };
    }

    let uploadedStorageKey: string | undefined;
    let profilePersisted = false;
    try {
      if (input.file) {
        uploadedStorageKey = await this.dependencies.storeAvatar(input.file);
        profile.picture = uploadedStorageKey;
      }

      await this.applyIdentifierChanges(input.userId, identifierResult.changes);
      const updatedUser = await this.dependencies.updateProfile(
        input.userId,
        profile
      );
      profilePersisted = true;

      if (uploadedStorageKey && input.currentPicture) {
        try {
          await this.dependencies.deleteAvatar(input.currentPicture);
        } catch (error) {
          this.dependencies.reportAvatarCleanupFailure(
            error,
            input.currentPicture
          );
        }
      }

      return { status: 'success', updatedUser };
    } catch (error) {
      if (uploadedStorageKey && !profilePersisted) {
        try {
          await this.dependencies.deleteAvatar(uploadedStorageKey);
        } catch (cleanupError) {
          this.dependencies.reportAvatarCleanupFailure(
            cleanupError,
            uploadedStorageKey
          );
        }
      }
      throw error;
    }
  }

  private async prepareIdentifierChanges(
    form: UnknownRecord,
    user: IUser,
    userId: string
  ): Promise<{ changes: IdentifierChange[] } | { error: string }> {
    const changes: IdentifierChange[] = [];
    for (const field of this.dependencies.getCustomIdentifierFields()) {
      if (field.edit_policy === 'admin_only') continue;

      const formValue = form[`custom_identifier_${field.slot}`];
      if (formValue === undefined) continue;
      if (typeof formValue !== 'string') {
        return { error: 'Invalid profile field value' };
      }

      const trimmedValue = formValue.trim();
      const currentValue = this.dependencies.getCustomIdentifier(
        user,
        field.slot
      );
      if (field.edit_policy === 'set_once' && currentValue) continue;

      if (trimmedValue) {
        if (!validateIdentifier(trimmedValue, field)) {
          return { error: `Invalid ${field.name || 'identifier'} format` };
        }

        const normalizedValue = field.case_sensitive
          ? trimmedValue
          : trimmedValue.toLowerCase();
        const available = await this.dependencies.isCustomIdentifierAvailable(
          field.slot,
          normalizedValue,
          userId
        );
        if (!available) {
          return {
            error: `This ${field.name || 'identifier'} is already in use`,
          };
        }
        changes.push({ slot: field.slot, value: normalizedValue });
      } else if (field.edit_policy === 'full') {
        changes.push({ slot: field.slot, value: null });
      }
    }
    return { changes };
  }

  private async applyIdentifierChanges(
    userId: string,
    changes: IdentifierChange[]
  ): Promise<void> {
    for (const change of changes) {
      if (change.value === null) {
        await this.dependencies.removeCustomIdentifier(userId, change.slot);
      } else {
        await this.dependencies.setCustomIdentifier(
          userId,
          change.slot,
          change.value
        );
      }
    }
  }
}
