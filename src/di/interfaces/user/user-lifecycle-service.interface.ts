import { type IUser } from '../../../types/user.js';

/**
 * Interface for user account lifecycle operations
 * Handles account state transitions (soft delete, restore, anonymize, etc.)
 */
export interface IUserLifecycleService {
  softDelete(userId: string): Promise<IUser>;
  restore(userId: string): Promise<IUser>;
  anonymize(userId: string): Promise<IUser>;
  activate(userId: string): Promise<IUser>;
  deactivate(userId: string): Promise<IUser>;
}
