import { describe, expect, it, vi } from 'vitest';

import type { PhoneVerificationChallenge } from '../../../src/di/interfaces/auth-service.interface.js';
import { PhoneVerificationService } from '../../../src/services/phone-verification.service.js';

function createHarness(options: { deliverySucceeds?: boolean } = {}) {
  const challenge = {
    user: {
      _id: 'user-1',
      phone_number: '+22997000000',
      phone_number_verified: false,
    },
    verificationToken: 'verification-token',
    code: '123456',
    expiresAt: new Date(1_800_000_000_000),
  } as PhoneVerificationChallenge;
  const dependencies = {
    phoneVerificationRequired: vi.fn(() => true),
    generateChallenge: vi.fn(async () => challenge),
    renewChallenge: vi.fn(
      async (
        _token: string,
        deliver: (replacement: PhoneVerificationChallenge) => Promise<boolean>
      ) => {
        if (!(await deliver(challenge))) {
          throw new Error('delivery failed');
        }
        return challenge;
      }
    ),
    verifyPhone: vi.fn(async () => challenge.user),
    sendVerificationCode: vi.fn(async () => ({
      success: options.deliverySucceeds ?? true,
      error:
        options.deliverySucceeds === false ? 'provider unavailable' : undefined,
    })),
    warn: vi.fn(),
  };

  return {
    challenge,
    dependencies,
    service: new PhoneVerificationService(dependencies),
  };
}

describe('PhoneVerificationService', () => {
  it('starts a challenge and reports successful delivery', async () => {
    const { challenge, dependencies, service } = createHarness();

    await expect(service.start('user-1', '203.0.113.5')).resolves.toEqual({
      challenge,
      delivered: true,
    });
    expect(dependencies.sendVerificationCode).toHaveBeenCalledWith(
      '+22997000000',
      '123456',
      '203.0.113.5'
    );
  });

  it('contains provider delivery failure and records non-secret context', async () => {
    const { challenge, dependencies, service } = createHarness({
      deliverySucceeds: false,
    });

    await expect(service.start('user-1')).resolves.toEqual({
      challenge,
      delivered: false,
    });
    expect(dependencies.warn).toHaveBeenCalledWith(
      'Phone verification SMS delivery failed',
      { userId: 'user-1', error: 'provider unavailable' }
    );
  });

  it('uses the same delivery capability when renewing a challenge', async () => {
    const { challenge, dependencies, service } = createHarness();

    await expect(
      service.renew('old-verification-token', '203.0.113.8')
    ).resolves.toBe(challenge);
    expect(dependencies.renewChallenge).toHaveBeenCalledWith(
      'old-verification-token',
      expect.any(Function)
    );
    expect(dependencies.sendVerificationCode).toHaveBeenCalledWith(
      '+22997000000',
      '123456',
      '203.0.113.8'
    );
  });

  it('owns the configured verification requirement and verification delegation', async () => {
    const { challenge, dependencies, service } = createHarness();

    expect(
      service.requiresVerification({
        phone_number: '+22997000000',
        phone_number_verified: false,
      })
    ).toBe(true);
    expect(
      service.requiresVerification({
        phone_number: '+22997000000',
        phone_number_verified: true,
      })
    ).toBe(false);
    expect(service.requiresVerification({ phone_number_verified: false })).toBe(
      false
    );

    await expect(service.verify('verification-token', '123456')).resolves.toBe(
      challenge.user
    );
    expect(dependencies.verifyPhone).toHaveBeenCalledWith(
      'verification-token',
      '123456'
    );
  });
});
