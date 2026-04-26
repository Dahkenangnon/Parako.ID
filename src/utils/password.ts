import * as argon2 from 'argon2';
import { injectable } from 'inversify';
import { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';

/**
 * Interface for password verification result
 */
export interface PasswordVerificationResult {
  valid: boolean;
  needsUpgrade: boolean;
}

/**
 * Argon2id password hashing utility.
 *
 * OWASP-recommended parameters:
 * - argon2id variant (hybrid: side-channel resistant + memory-hard)
 * - 19 MiB memory cost
 * - 2 iterations
 * - 1 degree of parallelism
 *
 * Output is a PHC-format string (self-describing, includes salt):
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 */
@injectable()
export class PasswordUtils implements IPasswordUtils {
  private static readonly ARGON2_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  async hashPassword(password: string): Promise<string> {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }

    return argon2.hash(password, PasswordUtils.ARGON2_OPTIONS);
  }

  async verifyPassword(
    password: string,
    storedHash: string
  ): Promise<PasswordVerificationResult> {
    const valid = await argon2.verify(storedHash, password);
    const needsUpgrade = valid
      ? argon2.needsRehash(storedHash, PasswordUtils.ARGON2_OPTIONS)
      : false;

    return { valid, needsUpgrade };
  }

  async rehashIfNeeded(
    password: string,
    storedHash: string
  ): Promise<string | null> {
    const result = await this.verifyPassword(password, storedHash);

    if (!result.valid) return null;
    if (!result.needsUpgrade) return null;

    return this.hashPassword(password);
  }
}

export default PasswordUtils;
