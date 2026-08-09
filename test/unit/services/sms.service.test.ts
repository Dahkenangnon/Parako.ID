import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const twilio = vi.hoisted(() => ({
  createClient: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock('twilio', () => ({ default: twilio.createClient }));

import { SmsService } from '../../../src/services/sms.service.js';
import type { ISmsProvider } from '../../../src/di/interfaces/sms-provider.interface.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');

function smsConfig(overrides: Record<string, unknown> = {}) {
  return {
    notifications: {
      channels: {
        sms: {
          enabled: true,
          provider: 'twilio',
          api_key: 'AC-account',
          api_secret: 'auth-token',
          from_number: '+14155550100',
          ...overrides,
        },
      },
    },
    branding: { companyName: 'Parako' },
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeProvider(overrides: Partial<ISmsProvider> = {}): ISmsProvider {
  return {
    sendSms: vi.fn().mockResolvedValue({
      success: true,
      messageId: 'message-1',
    }),
    validatePhoneNumber: vi.fn().mockReturnValue({ valid: true }),
    getProviderName: vi.fn().mockReturnValue('fake'),
    isConfigured: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeService(config: unknown = smsConfig()) {
  const configManager = { getConfig: vi.fn(() => config) };
  const logger = makeLogger();
  const service = new SmsService(configManager as any, logger as any);
  return { configManager, logger, service };
}

function setProvider(service: SmsService, provider: ISmsProvider | null) {
  (service as any).provider = provider;
}

describe('SmsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    twilio.createMessage.mockReset();
    twilio.createMessage.mockResolvedValue({ sid: 'SM-123' });
    twilio.createClient.mockReset();
    twilio.createClient.mockReturnValue({
      messages: { create: twilio.createMessage },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('provider initialization', () => {
    it('stays unavailable and logs when SMS is disabled', () => {
      const { service, logger } = makeService(
        smsConfig({ enabled: false, provider: undefined })
      );

      expect(service.isAvailable()).toBe(false);
      expect(service.getProviderName()).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'SMS service disabled in configuration'
      );
    });

    it('stays unavailable when no provider is configured', () => {
      const { service, logger } = makeService(
        smsConfig({ provider: undefined })
      );

      expect(service.isAvailable()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'SMS enabled but no provider configured'
      );
    });

    it('rejects unsupported providers without crashing startup', () => {
      const { service, logger } = makeService(
        smsConfig({ provider: 'unsupported' })
      );

      expect(service.isAvailable()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "Unknown SMS provider: unsupported. Only 'twilio' is supported."
      );
    });

    it('reports a fully configured Twilio provider', () => {
      const { service } = makeService();

      expect(service.isAvailable()).toBe(true);
      expect(service.getProviderName()).toBe('twilio');
    });

    it('reports an incomplete or whitespace-only Twilio provider as unavailable', () => {
      const { service } = makeService(
        smsConfig({ api_key: '  ', api_secret: '', from_number: '  ' })
      );

      expect(service.isAvailable()).toBe(false);
      expect(service.getProviderName()).toBe('twilio');
    });

    it('contains malformed provider configuration and logs the failure', () => {
      const logger = makeLogger();
      const brokenSmsConfig = {
        enabled: true,
        provider: 'twilio',
        get api_key(): string {
          throw new Error('secret unavailable');
        },
      };
      const configManager = {
        getConfig: vi.fn(() => ({
          notifications: { channels: { sms: brokenSmsConfig } },
        })),
      };

      const service = new SmsService(configManager as any, logger as any);

      expect(service.isAvailable()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize SMS provider',
        expect.objectContaining({
          provider: 'twilio',
          error: expect.objectContaining({ message: 'secret unavailable' }),
        })
      );
    });

    it('contains configuration-provider failures during startup', () => {
      const logger = makeLogger();
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };

      expect(
        () => new SmsService(configManager as any, logger as any)
      ).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize SMS provider',
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'configuration unavailable',
          }),
        })
      );
    });
  });

  describe('rate-limit lifecycle', () => {
    it('does not retain expired cache entries during scheduled cleanup', async () => {
      const { service } = makeService();
      const cache = (service as any).rateLimitCache as Map<string, any>;
      cache.set('expired', {
        count: 1,
        resetAt: new Date(NOW.getTime() - 1),
      });
      cache.set('current', {
        count: 1,
        resetAt: new Date(NOW.getTime() + 10 * 60 * 1000),
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(cache.has('expired')).toBe(false);
      expect(cache.has('current')).toBe(true);
    });

    it('allows repeated sends when no rate limits are configured', async () => {
      const { service } = makeService();
      const provider = makeProvider();
      setProvider(service, provider);

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toMatchObject({ success: true });
      await expect(
        service.sendVerificationCode('+14155552671', '654321')
      ).resolves.toMatchObject({ success: true });
      expect(provider.sendSms).toHaveBeenCalledTimes(2);
    });

    it('enforces the configured cooldown and returns its retry delay', async () => {
      const { service, logger } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 3,
            per_ip_per_day: 10,
            cooldown_seconds: 60,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendVerificationCode('+14155552671', '123456');
      const result = await service.sendVerificationCode(
        '+14155552671',
        '654321'
      );

      expect(result).toEqual({
        success: false,
        error: 'Too many SMS requests. Please try again later.',
        retryAfter: 60,
      });
      expect(provider.sendSms).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        'SMS cooldown active for phone',
        { phone: '+14155552671', retryAfter: 60 }
      );
    });

    it('uses canonical E.164 numbers so formatting cannot bypass cooldowns', async () => {
      const { service } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 3,
            per_ip_per_day: 10,
            cooldown_seconds: 60,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);

      await expect(
        service.sendVerificationCode('+1 (415) 555-2671', '123456')
      ).resolves.toMatchObject({ success: true });
      await expect(
        service.sendVerificationCode('+14155552671', '654321')
      ).resolves.toEqual({
        success: false,
        error: 'Too many SMS requests. Please try again later.',
        retryAfter: 60,
      });
      expect(provider.sendSms).toHaveBeenCalledOnce();
      expect(provider.sendSms).toHaveBeenCalledWith(
        '+14155552671',
        expect.any(String)
      );
    });

    it('enforces the per-phone hourly limit after cooldowns expire', async () => {
      const { service, logger } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 2,
            per_ip_per_day: 10,
            cooldown_seconds: 1,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendVerificationCode('+14155552671', '111111');
      vi.setSystemTime(new Date(NOW.getTime() + 2_000));
      await service.sendVerificationCode('+14155552671', '222222');
      vi.setSystemTime(new Date(NOW.getTime() + 4_000));

      const result = await service.sendVerificationCode(
        '+14155552671',
        '333333'
      );

      expect(result).toEqual({
        success: false,
        error: 'Too many SMS requests. Please try again later.',
        retryAfter: 3596,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'SMS rate limit exceeded for phone',
        { phone: '+14155552671', count: 2 }
      );
    });

    it('enforces the per-IP daily limit independently of phone numbers', async () => {
      const { service, logger } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 3,
            per_ip_per_day: 1,
            cooldown_seconds: 1,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendRecoveryCode('+14155552671', '111111', '192.0.2.1');
      vi.setSystemTime(new Date(NOW.getTime() + 2_000));

      const result = await service.sendRecoveryCode(
        '+14155552672',
        '222222',
        '192.0.2.1'
      );

      expect(result.retryAfter).toBe(86_398);
      expect(logger.warn).toHaveBeenCalledWith(
        'SMS rate limit exceeded for IP',
        { ip: '192.0.2.1', count: 1 }
      );
    });

    it('increments a live IP window while it remains below its limit', async () => {
      const { service } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 3,
            per_ip_per_day: 2,
            cooldown_seconds: 1,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendRecoveryCode('+14155552671', '111111', '192.0.2.1');
      vi.setSystemTime(new Date(NOW.getTime() + 2_000));
      await expect(
        service.sendRecoveryCode('+14155552672', '222222', '192.0.2.1')
      ).resolves.toMatchObject({ success: true });

      const cache = (service as any).rateLimitCache as Map<string, any>;
      expect(cache.get('ip:192.0.2.1').count).toBe(2);
      expect(provider.sendSms).toHaveBeenCalledTimes(2);
    });

    it('resets expired phone, IP, and cooldown windows', async () => {
      const { service } = makeService(
        smsConfig({
          rate_limits: {
            per_phone_per_hour: 1,
            per_ip_per_day: 1,
            cooldown_seconds: 1,
          },
        })
      );
      const provider = makeProvider();
      setProvider(service, provider);
      const cache = (service as any).rateLimitCache as Map<string, any>;
      const expired = new Date(NOW.getTime() - 1);
      cache.set('phone:+14155552671', { count: 99, resetAt: expired });
      cache.set('ip:192.0.2.1', { count: 99, resetAt: expired });
      cache.set('cooldown:+14155552671', { count: 1, resetAt: expired });

      await expect(
        service.sendVerificationCode('+14155552671', '123456', '192.0.2.1')
      ).resolves.toMatchObject({ success: true });
      expect(cache.get('phone:+14155552671').count).toBe(1);
      expect(cache.get('ip:192.0.2.1').count).toBe(1);
    });

    it('uses schema defaults when individual rate-limit fields are absent', async () => {
      const { service } = makeService(smsConfig({ rate_limits: {} }));
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendVerificationCode('+14155552671', '111111', '192.0.2.1');
      const cooldown = await service.sendVerificationCode(
        '+14155552671',
        '222222',
        '192.0.2.2'
      );

      expect(cooldown.retryAfter).toBe(60);

      const cache = (service as any).rateLimitCache as Map<string, any>;
      cache.delete('cooldown:+14155552671');
      cache.set('phone:+14155552671', {
        count: 3,
        resetAt: new Date(NOW.getTime() + 60_000),
      });
      const phoneLimited = await service.sendVerificationCode(
        '+14155552671',
        '333333'
      );
      expect(phoneLimited.retryAfter).toBe(60);

      cache.delete('phone:+14155552672');
      cache.set('ip:192.0.2.3', {
        count: 10,
        resetAt: new Date(NOW.getTime() + 60_000),
      });
      const ipLimited = await service.sendVerificationCode(
        '+14155552672',
        '444444',
        '192.0.2.3'
      );
      expect(ipLimited.retryAfter).toBe(60);
    });
  });

  describe('verification messages', () => {
    it('returns a configuration error when no provider exists', async () => {
      const { service } = makeService(smsConfig({ enabled: false }));

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toEqual({
        success: false,
        error: 'SMS service not configured',
      });
    });

    it('sends the branded verification message and maps provider output', async () => {
      const { service } = makeService();
      const provider = makeProvider({
        sendSms: vi.fn().mockResolvedValue({
          success: false,
          error: 'carrier rejected message',
          messageId: 'SM-failed',
        }),
      });
      setProvider(service, provider);

      const result = await service.sendVerificationCode(
        '+14155552671',
        '123456'
      );

      expect(provider.sendSms).toHaveBeenCalledWith(
        '+14155552671',
        'Your Parako verification code is: 123456. This code expires in 15 minutes.'
      );
      expect(result).toEqual({
        success: false,
        error: 'carrier rejected message',
        messageId: 'SM-failed',
      });
    });

    it('uses the generic application name when branding is absent', async () => {
      const config = smsConfig();
      delete (config as any).branding;
      const { service } = makeService(config);
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendVerificationCode('+14155552671', '123456');

      expect(provider.sendSms).toHaveBeenCalledWith(
        '+14155552671',
        expect.stringContaining('Your Application verification code')
      );
    });

    it('contains provider exceptions and logs their context', async () => {
      const { service, logger } = makeService();
      const failure = new Error('provider offline');
      setProvider(
        service,
        makeProvider({ sendSms: vi.fn().mockRejectedValue(failure) })
      );

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toEqual({ success: false, error: 'Failed to send SMS' });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send verification SMS',
        { phone: '+14155552671', error: failure }
      );
    });

    it('contains configuration failures while preparing a send', async () => {
      const configManager = {
        getConfig: vi
          .fn()
          .mockReturnValueOnce(smsConfig())
          .mockImplementation(() => {
            throw new Error('configuration unavailable');
          }),
      };
      const logger = makeLogger();
      const service = new SmsService(configManager as any, logger as any);
      setProvider(service, makeProvider());

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toEqual({ success: false, error: 'Failed to send SMS' });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send verification SMS',
        expect.objectContaining({ phone: '+14155552671' })
      );
    });
  });

  describe('recovery messages', () => {
    it('returns a configuration error when no provider exists', async () => {
      const { service } = makeService(smsConfig({ enabled: false }));

      await expect(
        service.sendRecoveryCode('+14155552671', '123456')
      ).resolves.toEqual({
        success: false,
        error: 'SMS service not configured',
      });
    });

    it('sends the branded recovery message and maps provider output', async () => {
      const { service } = makeService();
      const provider = makeProvider();
      setProvider(service, provider);

      const result = await service.sendRecoveryCode('+14155552671', '123456');

      expect(provider.sendSms).toHaveBeenCalledWith(
        '+14155552671',
        "Your Parako account recovery code is: 123456. This code expires in 15 minutes. If you didn't request this, please ignore."
      );
      expect(result).toEqual({
        success: true,
        error: undefined,
        messageId: 'message-1',
      });
    });

    it('uses the generic application name when branding is absent', async () => {
      const config = smsConfig();
      delete (config as any).branding;
      const { service } = makeService(config);
      const provider = makeProvider();
      setProvider(service, provider);

      await service.sendRecoveryCode('+14155552671', '123456');

      expect(provider.sendSms).toHaveBeenCalledWith(
        '+14155552671',
        expect.stringContaining('Your Application account recovery code')
      );
    });

    it('contains provider exceptions and logs their context', async () => {
      const { service, logger } = makeService();
      const failure = 'provider offline';
      setProvider(
        service,
        makeProvider({ sendSms: vi.fn().mockRejectedValue(failure) })
      );

      await expect(
        service.sendRecoveryCode('+14155552671', '123456')
      ).resolves.toEqual({ success: false, error: 'Failed to send SMS' });
      expect(logger.error).toHaveBeenCalledWith('Failed to send recovery SMS', {
        phone: '+14155552671',
        error: failure,
      });
    });

    it('contains configuration failures while preparing a send', async () => {
      const configManager = {
        getConfig: vi
          .fn()
          .mockReturnValueOnce(smsConfig())
          .mockImplementation(() => {
            throw new Error('configuration unavailable');
          }),
      };
      const logger = makeLogger();
      const service = new SmsService(configManager as any, logger as any);
      setProvider(service, makeProvider());

      await expect(
        service.sendRecoveryCode('+14155552671', '123456')
      ).resolves.toEqual({ success: false, error: 'Failed to send SMS' });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send recovery SMS',
        expect.objectContaining({ phone: '+14155552671' })
      );
    });
  });

  describe('phone-number validation', () => {
    it.each([
      ['verification', (service: SmsService) => service.sendVerificationCode],
      ['recovery', (service: SmsService) => service.sendRecoveryCode],
    ] as const)(
      'rejects an invalid number before %s provider delivery',
      async (_kind, selectSend) => {
        const { service } = makeService();
        const provider = makeProvider();
        setProvider(service, provider);

        const send = selectSend(service).bind(service);
        await expect(send('+123', '123456')).resolves.toEqual({
          success: false,
          error:
            'Invalid phone number format. Please include country code (e.g., +1 for US).',
        });
        expect(provider.sendSms).not.toHaveBeenCalled();
      }
    );

    it('formats valid international numbers as E.164', () => {
      const { service } = makeService();

      expect(service.validatePhoneNumber('+1 415 555 2671')).toEqual({
        valid: true,
        formatted: '+14155552671',
        countryCode: 'US',
      });
    });

    it('uses the supplied default country for national numbers', () => {
      const { service } = makeService();

      expect(service.validatePhoneNumber('415-555-2671', 'US')).toEqual({
        valid: true,
        formatted: '+14155552671',
        countryCode: 'US',
      });
    });

    it('returns a validation error for a well-formed but invalid number', () => {
      const { service } = makeService();

      expect(service.validatePhoneNumber('+123')).toEqual({
        valid: false,
        error:
          'Invalid phone number format. Please include country code (e.g., +1 for US).',
      });
    });

    it('returns a parse error instead of throwing for malformed input', () => {
      const { service } = makeService();

      expect(service.validatePhoneNumber(null as any)).toEqual({
        valid: false,
        error:
          'Could not parse phone number. Please use international format (e.g., +14155552671).',
      });
    });
  });

  describe('Twilio provider behavior through the service', () => {
    it('does not load Twilio when its credentials are incomplete', async () => {
      const { service } = makeService(smsConfig({ api_secret: undefined }));

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toEqual({
        success: false,
        error: 'Twilio not properly configured',
        messageId: undefined,
      });
      expect(twilio.createClient).not.toHaveBeenCalled();
    });

    it('lazy-loads and reuses one Twilio client', async () => {
      const { service, logger } = makeService();

      await service.sendVerificationCode('+14155552671', '123456');
      await service.sendRecoveryCode('+14155552672', '654321');

      expect(twilio.createClient).toHaveBeenCalledOnce();
      expect(twilio.createClient).toHaveBeenCalledWith(
        'AC-account',
        'auth-token'
      );
      expect(twilio.createMessage).toHaveBeenCalledTimes(2);
      expect(twilio.createMessage).toHaveBeenNthCalledWith(1, {
        body: expect.stringContaining('verification code is: 123456'),
        to: '+14155552671',
        from: '+14155550100',
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Twilio SMS provider initialized'
      );
      expect(logger.info).toHaveBeenCalledWith('SMS sent via Twilio', {
        messageId: 'SM-123',
        to: '+14155552671',
      });
    });

    it('shares one in-flight client initialization across concurrent sends', async () => {
      const { service } = makeService();

      const first = service.sendVerificationCode('+14155552671', '123456');
      const second = service.sendVerificationCode('+14155552672', '654321');

      await expect(Promise.all([first, second])).resolves.toEqual([
        { success: true, error: undefined, messageId: 'SM-123' },
        { success: true, error: undefined, messageId: 'SM-123' },
      ]);
      expect(twilio.createClient).toHaveBeenCalledOnce();
    });

    it('maps typed Twilio errors without throwing', async () => {
      const failure = {
        code: 21_611,
        message: 'invalid destination',
        status: 400,
        moreInfo: 'https://www.twilio.com/docs/errors/21611',
      };
      twilio.createMessage.mockRejectedValue(failure);
      const { service, logger } = makeService();

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toEqual({
        success: false,
        error: 'invalid destination',
        messageId: undefined,
      });
      expect(logger.error).toHaveBeenCalledWith('Twilio send error', failure);
    });

    it('uses a safe fallback for untyped Twilio errors', async () => {
      twilio.createMessage.mockRejectedValue('network failure');
      const { service } = makeService();

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toMatchObject({
        success: false,
        error: 'Failed to send SMS via Twilio',
      });
    });

    it('retries client initialization after a transient failure', async () => {
      twilio.createClient
        .mockImplementationOnce(() => {
          throw new Error('temporary SDK failure');
        })
        .mockReturnValueOnce({ messages: { create: twilio.createMessage } });
      const { service } = makeService();

      await expect(
        service.sendVerificationCode('+14155552671', '123456')
      ).resolves.toMatchObject({
        success: false,
        error: 'temporary SDK failure',
      });
      await expect(
        service.sendVerificationCode('+14155552672', '654321')
      ).resolves.toMatchObject({ success: true, messageId: 'SM-123' });
      expect(twilio.createClient).toHaveBeenCalledTimes(2);
    });

    it('validates and normalizes numbers through the provider contract', () => {
      const { service } = makeService();
      const provider = (service as any).provider as ISmsProvider;

      expect(provider.validatePhoneNumber('+1 (415) 555-2671')).toEqual({
        valid: true,
        formatted: '+14155552671',
      });
      expect(provider.validatePhoneNumber('4155552671')).toEqual({
        valid: false,
        error:
          'Invalid phone number. Please use international format (e.g., +1234567890)',
      });
    });
  });
});
