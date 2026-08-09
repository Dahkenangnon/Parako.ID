import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { MfaUtils } from '../../../src/utils/mfa.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IUser } from '../../../src/types/user.js';

const otpMocks = vi.hoisted(() => ({
  generateSecret: vi.fn(),
  generateURI: vi.fn(),
  verifySync: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock('otplib', () => ({
  generateSecret: otpMocks.generateSecret,
  generateURI: otpMocks.generateURI,
  verifySync: otpMocks.verifySync,
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: otpMocks.toDataURL },
}));

function createMfaUtils(
  configManager: IConfigManager = {} as IConfigManager
): MfaUtils {
  const logger = { error: vi.fn() } as unknown as ILogger;
  return new MfaUtils(configManager, logger);
}

function userWithMfa(mfa?: IUser['mfa']): IUser {
  return { mfa } as unknown as IUser;
}

describe('MfaUtils', () => {
  beforeEach(() => {
    otpMocks.generateSecret.mockReset().mockReturnValue('TOTP-SECRET');
    otpMocks.generateURI
      .mockReset()
      .mockReturnValue('otpauth://totp/Parako.ID:alice');
    otpMocks.verifySync.mockReset().mockReturnValue({ valid: true });
    otpMocks.toDataURL
      .mockReset()
      .mockResolvedValue('data:image/png;base64,qr');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3601])(
    'rejects invalid email OTP TTL %s',
    ttlSeconds => {
      const mfa = createMfaUtils();

      expect(() => mfa.generateEmailOtp(ttlSeconds)).toThrow(
        'Failed to generate email OTP'
      );
    }
  );

  it('fails closed when the stored email OTP expiry is invalid', () => {
    const mfa = createMfaUtils();
    const { code, hash } = mfa.generateEmailOtp();

    expect(mfa.verifyEmailOtp(code, hash, new Date(Number.NaN))).toEqual({
      valid: false,
      error: 'Email OTP expiry is invalid',
    });
  });

  it('reads MFA configuration from one consistent config snapshot', () => {
    const config = getDefaultFullConfig();
    const getConfig = vi.fn(() => config);
    const mfa = createMfaUtils({ getConfig } as unknown as IConfigManager);

    expect(mfa.getMfaConfig()).toEqual({
      enabled: config.security.authentication.multi_factor.enabled,
      methods: {
        totp: {
          enabled: config.security.authentication.multi_factor.totp.enabled,
          issuer: config.security.authentication.multi_factor.totp.issuer_name,
        },
        sms: {
          enabled: config.security.authentication.multi_factor.sms.enabled,
        },
        email: {
          enabled: config.security.authentication.multi_factor.email.enabled,
        },
        webauthn: {
          enabled: config.security.authentication.multi_factor.webauthn.enabled,
        },
      },
    });
    expect(getConfig).toHaveBeenCalledOnce();
  });

  it('does not truncate malformed email addresses while masking', () => {
    const mfa = createMfaUtils();

    expect(mfa.maskEmail('alice@example.com@unexpected')).toBe(
      'alice@example.com@unexpected'
    );
  });

  it.each([
    ['   ', 'SECRET', 'Parako.ID'],
    ['alice@example.com', '   ', 'Parako.ID'],
    ['alice@example.com', 'SECRET', '   '],
  ])(
    'rejects whitespace-only TOTP URI inputs',
    (accountName, secret, issuer) => {
      const mfa = createMfaUtils();

      expect(() => mfa.generateTotpUri(accountName, secret, issuer)).toThrow(
        'Failed to generate TOTP URI'
      );
    }
  );

  it('generates TOTP setup material through the OTP and QR boundaries', async () => {
    const mfa = createMfaUtils();

    await expect(
      mfa.setupTotp('alice@example.com', 'Parako.ID')
    ).resolves.toEqual({
      secret: 'TOTP-SECRET',
      qrCode: {
        otpauth: 'otpauth://totp/Parako.ID:alice',
        qrDataUri: 'data:image/png;base64,qr',
      },
    });
    expect(otpMocks.generateSecret).toHaveBeenCalledOnce();
    expect(otpMocks.generateURI).toHaveBeenCalledWith({
      issuer: 'Parako.ID',
      label: 'alice@example.com',
      secret: 'TOTP-SECRET',
    });
    expect(otpMocks.toDataURL).toHaveBeenCalledWith(
      'otpauth://totp/Parako.ID:alice'
    );
  });

  it.each([
    [
      'secret generation',
      otpMocks.generateSecret,
      'Failed to generate TOTP secret',
    ],
    ['URI generation', otpMocks.generateURI, 'Failed to generate TOTP URI'],
  ])('normalizes %s boundary failures', (_label, boundary, message) => {
    boundary.mockImplementationOnce(() => {
      throw new Error('boundary failure');
    });
    const mfa = createMfaUtils();

    if (boundary === otpMocks.generateSecret) {
      expect(() => mfa.generateTotpSecret()).toThrow(message);
    } else {
      expect(() =>
        mfa.generateTotpUri('alice@example.com', 'SECRET', 'Parako.ID')
      ).toThrow(message);
    }
  });

  it('normalizes QR generation and setup failures', async () => {
    const mfa = createMfaUtils();

    await expect(mfa.generateQrCode('')).rejects.toThrow(
      'Failed to generate QR code'
    );

    otpMocks.toDataURL.mockRejectedValueOnce(new Error('QR unavailable'));
    await expect(mfa.generateQrCode('otpauth://valid')).rejects.toThrow(
      'Failed to generate QR code'
    );

    otpMocks.toDataURL.mockRejectedValueOnce(new Error('QR unavailable'));
    await expect(
      mfa.setupTotp('alice@example.com', 'Parako.ID')
    ).rejects.toThrow('Failed to setup MFA');
  });

  it.each([
    ['', 'SECRET', 'Code and secret are required'],
    ['123456', '', 'Code and secret are required'],
    ['12345', 'SECRET', 'Code must be exactly 6 digits'],
    ['12345a', 'SECRET', 'Code must be exactly 6 digits'],
  ])('rejects unusable TOTP verification input', (code, secret, error) => {
    const mfa = createMfaUtils();

    expect(mfa.verifyTotpCode(code, secret)).toEqual({ valid: false, error });
    expect(otpMocks.verifySync).not.toHaveBeenCalled();
  });

  it('sanitizes and verifies TOTP codes through the OTP boundary', () => {
    otpMocks.verifySync.mockReturnValueOnce({ valid: false });
    const mfa = createMfaUtils();

    expect(mfa.verifyTotpCode(' 123 456 ', 'SECRET')).toEqual({
      valid: false,
    });
    expect(otpMocks.verifySync).toHaveBeenCalledWith({
      secret: 'SECRET',
      token: '123456',
    });
  });

  it('fails closed when the OTP verifier throws', () => {
    otpMocks.verifySync.mockImplementationOnce(() => {
      throw new Error('verifier unavailable');
    });
    const mfa = createMfaUtils();

    expect(mfa.verifyTotpCode('123456', 'SECRET')).toEqual({
      valid: false,
      error: 'TOTP verification failed',
    });
  });

  it.each([
    ['', { valid: false, error: 'TOTP code is required' }],
    [
      123456 as unknown as string,
      { valid: false, error: 'TOTP code is required' },
    ],
    ['12a 456', { valid: false, error: 'TOTP code must be exactly 6 digits' }],
    [' 123 456 ', { valid: true, sanitized: '123456' }],
  ])('validates and sanitizes TOTP code format', (code, expected) => {
    expect(createMfaUtils().validateTotpCodeFormat(code)).toEqual(expected);
  });

  it('generates a six-digit email OTP with a deterministic expiry and digest', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const mfa = createMfaUtils();

    const result = mfa.generateEmailOtp(120);

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt).toEqual(new Date('2026-08-01T12:02:00.000Z'));
  });

  it.each([
    ['', 'hash', 'Code and stored hash are required'],
    ['123456', '', 'Code and stored hash are required'],
  ])('rejects incomplete email OTP verification input', (code, hash, error) => {
    const expiresAt = new Date(Date.now() + 60_000);

    expect(createMfaUtils().verifyEmailOtp(code, hash, expiresAt)).toEqual({
      valid: false,
      error,
    });
  });

  it('rejects expired email OTPs before comparing their digest', () => {
    const { code, hash } = createMfaUtils().generateEmailOtp();

    expect(
      createMfaUtils().verifyEmailOtp(code, hash, new Date(Date.now() - 1))
    ).toEqual({ valid: false, error: 'Email OTP has expired' });
  });

  it('compares trimmed email OTPs in constant-time-compatible buffers', () => {
    const mfa = createMfaUtils();
    const { code, hash, expiresAt } = mfa.generateEmailOtp();

    expect(mfa.verifyEmailOtp(` ${code} `, hash, expiresAt)).toEqual({
      valid: true,
    });
    expect(mfa.verifyEmailOtp('000000', hash, expiresAt)).toEqual({
      valid: false,
    });
    expect(mfa.verifyEmailOtp(code, 'short-hash', expiresAt)).toEqual({
      valid: false,
    });
  });

  it('fails closed for runtime-invalid email OTP values', () => {
    const mfa = createMfaUtils();

    expect(
      mfa.verifyEmailOtp(
        { trim: null } as unknown as string,
        'hash',
        new Date(Date.now() + 60_000)
      )
    ).toEqual({ valid: false, error: 'Email OTP verification failed' });
  });

  it('derives enabled and pending MFA states from the user record', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const enabled = userWithMfa({
      enabled: true,
      methods: {
        totp: { enabled: true, secret: 'SECRET' },
        email: { enabled: true },
        webauthn: { enabled: true, credentials: [{} as never] },
      },
      email_otp: {
        hash: 'hash',
        expires: new Date('2026-08-01T12:01:00.000Z'),
      },
    });
    const pending = userWithMfa({
      enabled: false,
      methods: {
        totp: { enabled: false, secret: 'PENDING' },
        email: { enabled: false },
      },
      email_otp: {
        hash: 'hash',
        expires: new Date('2026-08-01T12:01:00.000Z'),
      },
    });
    const mfa = createMfaUtils();

    expect(mfa.isMfaEnabled(enabled)).toBe(true);
    expect(mfa.isTotpEnabled(enabled)).toBe(true);
    expect(mfa.isEmailMfaEnabled(enabled)).toBe(true);
    expect(mfa.isWebAuthnEnabled(enabled)).toBe(true);
    expect(mfa.isTotpPendingSetup(pending)).toBe(true);
    expect(mfa.isEmailMfaPendingSetup(pending)).toBe(true);
    expect(mfa.isMfaEnabled(userWithMfa())).toBe(false);
    expect(mfa.isTotpEnabled(userWithMfa())).toBe(false);
    expect(mfa.isEmailMfaEnabled(userWithMfa())).toBe(false);
    expect(mfa.isWebAuthnEnabled(userWithMfa())).toBe(false);
    expect(
      mfa.isWebAuthnEnabled(
        userWithMfa({
          enabled: true,
          methods: { webauthn: { enabled: true } },
        })
      )
    ).toBe(false);
  });

  it('returns enabled methods, selection state, and a valid preference', () => {
    const user = userWithMfa({
      enabled: true,
      methods: {
        totp: { enabled: true, secret: 'SECRET' },
        email: { enabled: true },
        webauthn: { enabled: true, credentials: [{} as never] },
      },
      preferred_method: 'email',
    });
    const mfa = createMfaUtils();

    expect(mfa.getEnabledMethods(user)).toEqual(['totp', 'email', 'webauthn']);
    expect(mfa.needsMethodSelection(user)).toBe(true);
    expect(mfa.getEnabledMethodsObject(user)).toEqual({
      totp: true,
      email: true,
      webauthn: true,
    });
    expect(mfa.getPreferredMethod(user)).toBe('email');

    user.mfa!.preferred_method = undefined;
    expect(mfa.getPreferredMethod(user)).toBe('totp');
    expect(mfa.getPreferredMethod(userWithMfa())).toBeNull();
  });

  it('returns no enabled methods when the master toggle or methods are absent', () => {
    const mfa = createMfaUtils();

    expect(mfa.getEnabledMethods(userWithMfa())).toEqual([]);
    expect(
      mfa.getEnabledMethods(userWithMfa({ enabled: false, methods: {} }))
    ).toEqual([]);
    expect(
      mfa.getEnabledMethods(
        userWithMfa({
          enabled: true,
          methods: {
            totp: { enabled: true },
            email: { enabled: false },
            webauthn: { enabled: true },
          },
        })
      )
    ).toEqual([]);
    expect(mfa.needsMethodSelection(userWithMfa())).toBe(false);
    expect(mfa.getEnabledMethodsObject(userWithMfa())).toEqual({
      totp: false,
      email: false,
      webauthn: false,
    });
  });

  it('builds method-scoped MFA persistence updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const mfa = createMfaUtils();

    expect(mfa.getEnableMethodUpdate('totp', { secret: 'SECRET' })).toEqual({
      'mfa.enabled': true,
      'mfa.methods.totp.enabled': true,
      'mfa.methods.totp.verified_at': new Date('2026-08-01T12:00:00.000Z'),
      'mfa.methods.totp.secret': 'SECRET',
    });
    expect(mfa.getEnableMethodUpdate('email')).toEqual({
      'mfa.enabled': true,
      'mfa.methods.email.enabled': true,
      'mfa.methods.email.verified_at': new Date('2026-08-01T12:00:00.000Z'),
    });
    expect(mfa.getDisableMethodUpdate('totp')).toEqual({
      'mfa.methods.totp.enabled': false,
      'mfa.methods.totp.secret': undefined,
    });
    expect(mfa.getDisableMethodUpdate('email')).toEqual({
      'mfa.methods.email.enabled': false,
    });
  });

  it('detects remaining methods and builds a complete MFA disable update', () => {
    const user = userWithMfa({
      enabled: true,
      methods: {
        totp: { enabled: true, secret: 'SECRET' },
        email: { enabled: true },
      },
    });
    const mfa = createMfaUtils();

    expect(mfa.hasAnyMethodEnabled(user)).toBe(true);
    expect(mfa.hasAnyMethodEnabled(user, 'totp')).toBe(true);
    expect(mfa.hasAnyMethodEnabled(user, 'email')).toBe(true);
    expect(mfa.hasAnyMethodEnabled(userWithMfa())).toBe(false);
    expect(mfa.getDisableAllMfaUpdate()).toEqual({
      'mfa.enabled': false,
      'mfa.methods.totp.enabled': false,
      'mfa.methods.totp.secret': undefined,
      'mfa.methods.email.enabled': false,
      'mfa.methods.webauthn.enabled': false,
      'mfa.preferred_method': undefined,
    });
  });

  it('returns the stored TOTP secret when present', () => {
    const mfa = createMfaUtils();

    expect(mfa.getUserTotpSecret(userWithMfa())).toBeUndefined();
    expect(
      mfa.getUserTotpSecret(
        userWithMfa({
          enabled: false,
          methods: { totp: { enabled: false, secret: 'plaintext-secret' } },
        })
      )
    ).toBe('plaintext-secret');
  });

  it('masks valid email addresses and phone numbers without exposing prefixes', () => {
    const mfa = createMfaUtils();

    expect(mfa.maskEmail('')).toBe('');
    expect(mfa.maskEmail('alice@example.com')).toBe('a****@example.com');
    expect(mfa.maskEmail('a@example.com')).toBe('a@example.com');
    expect(mfa.maskEmail('not-an-email')).toBe('not-an-email');
    expect(mfa.maskPhoneNumber('+1 (555) 123-4567')).toBe('*******4567');
    expect(mfa.maskPhoneNumber('123')).toBe('123');
    expect(mfa.maskPhoneNumber('call-me')).toBe('call-me');
  });

  it('projects supported and available methods from configuration', () => {
    const config = getDefaultFullConfig();
    const methods = config.security.authentication.multi_factor;
    methods.totp.enabled = true;
    methods.sms.enabled = false;
    methods.email.enabled = true;
    methods.webauthn.enabled = true;
    const mfa = createMfaUtils({
      getConfig: vi.fn(() => config),
    } as unknown as IConfigManager);

    expect(mfa.isMethodSupported('totp')).toBe(true);
    expect(mfa.isMethodSupported('sms')).toBe(false);
    expect(mfa.isMethodSupported('email')).toBe(true);
    expect(mfa.isMethodSupported('webauthn')).toBe(true);
    expect(mfa.isMethodSupported('unknown' as never)).toBe(false);
    expect(mfa.getAvailableMethods()).toEqual(['totp', 'email', 'webauthn']);

    methods.totp.enabled = false;
    methods.sms.enabled = true;
    methods.email.enabled = false;
    methods.webauthn.enabled = false;
    expect(mfa.getAvailableMethods()).toEqual(['sms']);
  });
});
