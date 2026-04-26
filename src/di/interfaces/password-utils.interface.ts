import { PasswordVerificationResult } from '../../utils/password.js';

/**
 * Interface for password utils service
 * Defines the contract for Argon2id password hashing and verification
 */
export interface IPasswordUtils {
  /**
   * Hash a password using Argon2id
   * Returns a PHC-format string ready to store in DB
   * @param password - Password to hash
   * @returns Hashed password string
   */
  hashPassword(password: string): Promise<string>;

  /**
   * Verify a password against a stored Argon2id hash
   * @param password - Password to verify
   * @param storedHash - Stored PHC-format hash string
   * @returns { valid, needsUpgrade }
   */
  verifyPassword(
    password: string,
    storedHash: string
  ): Promise<PasswordVerificationResult>;

  /**
   * Rehash a password if the stored hash uses outdated parameters
   * @param password - Password to rehash
   * @param storedHash - Current stored hash string
   * @returns New hash string, or null if invalid password or no upgrade needed
   */
  rehashIfNeeded(password: string, storedHash: string): Promise<string | null>;
}
