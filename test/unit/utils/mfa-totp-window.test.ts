import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSecret, generateSync } from 'otplib';
import { MfaUtils } from '../../../src/utils/mfa.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';

describe('MfaUtils TOTP verification window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a code generated immediately before the current period', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-15T08:00:29.000Z'));

    const secret = generateSecret();
    const token = generateSync({ secret });

    vi.setSystemTime(new Date('2027-01-15T08:00:31.000Z'));

    const mfa = new MfaUtils(
      {} as IConfigManager,
      { error: vi.fn() } as unknown as ILogger
    );

    expect(mfa.verifyTotpCode(token, secret)).toEqual({ valid: true });
  });
});
