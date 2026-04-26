import { type IUser } from '../../../types/user.js';

/**
 * Profile update data structure
 */
export interface ProfileUpdateData {
  given_name?: string;
  family_name?: string;
  name?: string;
  phone_number?: string;
  picture?: string;
  locale?: string;
  country?: string;
  zoneinfo?: string;
  city?: string;
  address?: string;
  street_address?: string;
  region?: string;
  postal_code?: string;
  theme?: 'light' | 'dark';
  sidebar_expanded?: boolean;
}

/**
 * Notification preferences structure
 */
export interface NotificationPreferences {
  preferred_channel: 'email' | 'sms' | 'auto';
  security_alerts: boolean;
  new_session_alerts: boolean;
  marketing: boolean;
}

/**
 * Interface for user profile management
 * Handles profile updates, avatar, and notification preferences
 */
export interface IUserProfileService {
  updateUserLastLoginDate(id: string, username: string): Promise<IUser>;
  updateProfile(userId: string, profileData: ProfileUpdateData): Promise<IUser>;
  updateNotificationPreferences(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<IUser>;
  updateWithAssignment(
    id: string,
    data: Partial<IUser>,
    options?: {
      populate?: string | Array<string>;
      session?: unknown;
    }
  ): Promise<IUser | null>;

  updateAvatar(userId: string, avatarPath: string): Promise<IUser>;
  removeAvatar(userId: string): Promise<IUser>;
}
