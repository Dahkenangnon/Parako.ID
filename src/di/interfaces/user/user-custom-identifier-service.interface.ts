import { type IUser } from '../../../types/user.js';

/**
 * Edit policy for custom identifier fields
 */
export type CustomIdentifierEditPolicy =
  | 'admin_only'
  | 'set_once'
  | 'editable'
  | 'full';

/**
 * Custom identifier field configuration
 */
export interface CustomIdentifierFieldConfig {
  slot: 1 | 2 | 3;
  key: string;
  name: string;
  hint_for_user: string;
  validation_type: 'none' | 'regex' | 'charset_mask';
  pattern?: string;
  charset?: string;
  mask?: string;
  min_length?: number;
  max_length?: number;
  case_sensitive: boolean;
  required_for_registration: boolean;
  edit_policy: CustomIdentifierEditPolicy;
  usable_for_login: boolean;
}

/**
 * Interface for custom identifier operations
 * Handles custom identifier field management and lookup
 */
export interface IUserCustomIdentifierService {
  // User creation with generated username
  createUserWithGeneratedUsername(userData: Partial<IUser>): Promise<IUser>;

  generateUniqueUsername(): Promise<string>;

  getCustomIdentifierFields(): CustomIdentifierFieldConfig[];
  getCustomIdentifierFieldByKey(
    key: string
  ): CustomIdentifierFieldConfig | undefined;
  getCustomIdentifierFieldBySlot(
    slot: 1 | 2 | 3
  ): CustomIdentifierFieldConfig | undefined;
  setCustomIdentifier(
    userId: string,
    slot: 1 | 2 | 3,
    value: string
  ): Promise<IUser>;
  getCustomIdentifier(user: IUser, slot: 1 | 2 | 3): string | undefined;
  removeCustomIdentifier(userId: string, slot: 1 | 2 | 3): Promise<IUser>;
  isCustomIdentifierAvailable(
    slot: 1 | 2 | 3,
    value: string,
    excludeUserId?: string
  ): Promise<boolean>;
  findByCustomIdentifier(
    slot: 1 | 2 | 3,
    value: string
  ): Promise<IUser | undefined>;
}
