import 'reflect-metadata';
import { BootstrapEnvironment } from '../../../src/config/bootstrap-environment.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPReputationService } from '../../../src/services/ip-reputation.service.js';
import type { IPReputationResult } from '../../../src/di/interfaces/ip-reputation-service.interface.js';

const NOW = new Date('2026-08-02T08:00:00.000Z');

function reputationConfig(overrides: Record<string, unknown> = {}) {
  return {
    integrations: {
      ipqualityscore: {
        enabled: true,
        api_key: 'database-key',
        fraud_score_threshold: 75,
        cache_ttl_hours: 6,
        ...overrides,
      },
    },
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService(config: unknown = reputationConfig()) {
  const configManager = { getConfig: vi.fn(() => config) };
  const logger = makeLogger();
  const service = new IPReputationService(
    configManager as any,
    logger as any,
    new BootstrapEnvironment()
  );
  return { configManager, logger, service };
}

function response(
  data: Record<string, unknown>,
  options: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(data),
  } as any;
}

function cleanData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    fraud_score: 10,
    vpn: false,
    proxy: false,
    tor: false,
    is_crawler: false,
    recent_abuse: false,
    host: '',
    mobile: false,
    ISP: 'Example ISP',
    ASN: 64500,
    organization: 'Example Org',
    country_code: 'BJ',
    ...overrides,
  };
}

function reputationResult(
  overrides: Partial<IPReputationResult> = {}
): IPReputationResult {
  return {
    ip: '192.0.2.1',
    success: true,
    fraudScore: 10,
    isVPN: false,
    isProxy: false,
    isTor: false,
    isCrawler: false,
    isBlocklisted: false,
    isDatacenter: false,
    isMobile: false,
    timestamp: NOW.getTime(),
    riskLevel: 'low',
    ...overrides,
  };
}

describe('IPReputationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cleanData())));
    delete process.env.IPQUALITYSCORE_API_KEY;
  });

  afterEach(() => {
    delete process.env.IPQUALITYSCORE_API_KEY;
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('availability', () => {
    it('is enabled by explicit configuration with a trimmed database key', () => {
      const { service, configManager } = makeService(
        reputationConfig({ api_key: ' database-key ' })
      );

      expect(service.isEnabled()).toBe(true);
      expect(configManager.getConfig).toHaveBeenCalledOnce();
    });

    it('is disabled when configuration is disabled even if it contains a key', () => {
      const { service } = makeService(reputationConfig({ enabled: false }));
      expect(service.isEnabled()).toBe(false);
    });

    it.each([undefined, '', '   '])(
      'is disabled when the database key is unusable: %s',
      apiKey => {
        const { service } = makeService(reputationConfig({ api_key: apiKey }));
        expect(service.isEnabled()).toBe(false);
      }
    );

    it('lets a trimmed environment key implicitly enable the service', () => {
      process.env.IPQUALITYSCORE_API_KEY = ' environment-key ';
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('database configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new IPReputationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(service.isEnabled()).toBe(true);
      expect(configManager.getConfig).not.toHaveBeenCalled();
    });

    it('contains configuration lookup failures when no environment key exists', () => {
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('database configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new IPReputationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(service.isEnabled()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'IP reputation configuration unavailable',
        { error: 'database configuration unavailable' }
      );
    });
  });

  describe('lookup lifecycle', () => {
    it('returns a normalized disabled result without calling the provider', async () => {
      const { service } = makeService(reputationConfig({ enabled: false }));

      await expect(
        service.checkIPReputation('::ffff:192.0.2.1')
      ).resolves.toEqual({
        ip: '192.0.2.1',
        success: false,
        fraudScore: 0,
        isVPN: false,
        isProxy: false,
        isTor: false,
        isCrawler: false,
        isBlocklisted: false,
        isDatacenter: false,
        isMobile: false,
        error: 'IP reputation service is disabled',
        timestamp: NOW.getTime(),
        riskLevel: 'low',
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('uses the environment key before the database key and safely encodes URL segments', async () => {
      process.env.IPQUALITYSCORE_API_KEY = ' env key/? ';
      const { service } = makeService(reputationConfig({ enabled: false }));

      await service.checkIPReputation('2001:db8::1/path?query=yes');

      expect(fetch).toHaveBeenCalledWith(
        'https://www.ipqualityscore.com/api/json/ip/env%20key%2F%3F/2001%3Adb8%3A%3A1%2Fpath%3Fquery%3Dyes?strictness=1&allow_public_access_points=true&lighter_penalties=true',
        expect.objectContaining({
          headers: { Accept: 'application/json' },
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('maps a successful provider response and caches it for the configured TTL', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response(
          cleanData({
            fraud_score: 92,
            vpn: true,
            proxy: true,
            tor: true,
            is_crawler: true,
            recent_abuse: false,
            host: 'hosting.example',
            mobile: true,
          })
        )
      );
      const { service, logger } = makeService();

      const first = await service.checkIPReputation('192.0.2.1');
      const second = await service.checkIPReputation('192.0.2.1');

      expect(first).toEqual({
        ip: '192.0.2.1',
        success: true,
        fraudScore: 92,
        isVPN: true,
        isProxy: true,
        isTor: true,
        isCrawler: true,
        isBlocklisted: true,
        isDatacenter: true,
        isMobile: true,
        isp: 'Example ISP',
        asn: 64500,
        organization: 'Example Org',
        countryCode: 'BJ',
        recentAbuse: false,
        timestamp: NOW.getTime(),
        riskLevel: 'critical',
      });
      expect(second).toBe(first);
      expect(fetch).toHaveBeenCalledOnce();
      expect(logger.debug).toHaveBeenCalledWith('IP reputation cache hit', {
        ip: '192.0.2.1',
      });

      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 60 * 1000 + 1));
      await service.checkIPReputation('192.0.2.1');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('uses the default six-hour cache TTL when the field is absent', async () => {
      const { service } = makeService(
        reputationConfig({ cache_ttl_hours: undefined })
      );

      await service.checkIPReputation('192.0.2.1');
      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 60 * 1000 - 1));
      await service.checkIPReputation('192.0.2.1');

      expect(fetch).toHaveBeenCalledOnce();
    });

    it('returns an error when configuration loses its API key between checks', async () => {
      const configManager = {
        getConfig: vi
          .fn()
          .mockReturnValueOnce(reputationConfig())
          .mockReturnValueOnce(reputationConfig({ api_key: undefined })),
      };
      const logger = makeLogger();
      const service = new IPReputationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'API key not configured',
        riskLevel: 'low',
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('clears the timeout after a network rejection and returns a stable error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'));
      const { service, logger } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'network unavailable',
      });
      expect(clearTimeoutSpy).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith('IP reputation lookup failed', {
        ip: '192.0.2.1',
        error: 'network unavailable',
      });
    });

    it('aborts a provider request after five seconds', async () => {
      vi.mocked(fetch).mockImplementation(
        async (_url, options) =>
          new Promise((_resolve, reject) => {
            (options?.signal as AbortSignal).addEventListener('abort', () =>
              reject(new Error('request aborted'))
            );
          })
      );
      const { service } = makeService();

      const lookup = service.checkIPReputation('192.0.2.1');
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(lookup).resolves.toMatchObject({
        success: false,
        error: 'request aborted',
      });
      const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
      expect(signal?.aborted).toBe(true);
    });

    it('maps non-2xx responses to error results', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response({}, { ok: false, status: 503 })
      );
      const { service } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'IPQualityScore API returned 503',
      });
    });

    it.each([
      [{ success: false, message: 'quota exceeded' }, 'quota exceeded'],
      [{ success: false }, 'IPQualityScore API request failed'],
    ])('maps provider-declared failure %#', async (data, error) => {
      vi.mocked(fetch).mockResolvedValue(response(data));
      const { service } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({ success: false, error });
    });

    it('normalizes invalid external fraud scores and nullable host data', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response(cleanData({ fraud_score: 'not-a-number', host: null }))
      );
      const { service } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: true,
        fraudScore: 0,
        isDatacenter: false,
        riskLevel: 'low',
      });
    });

    it('clamps out-of-range external fraud scores to the documented range', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response(cleanData({ fraud_score: 150 }))
      );
      const { service } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: true,
        fraudScore: 100,
        riskLevel: 'critical',
      });
    });

    it('normalizes non-Error provider rejections', async () => {
      vi.mocked(fetch).mockRejectedValue('network unavailable');
      const { service, logger } = makeService();

      await expect(
        service.checkIPReputation('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'network unavailable',
      });
      expect(logger.warn).toHaveBeenCalledWith('IP reputation lookup failed', {
        ip: '192.0.2.1',
        error: 'network unavailable',
      });
    });
  });

  describe('risk classification', () => {
    it.each([
      [89, { recent_abuse: true }, 'critical'],
      [75, {}, 'high'],
      [10, { tor: true }, 'high'],
      [50, {}, 'medium'],
      [10, { vpn: true }, 'medium'],
      [10, { proxy: true }, 'medium'],
      [49, {}, 'low'],
    ] as const)(
      'classifies score %i with signals %# as %s',
      async (fraudScore, signals, riskLevel) => {
        vi.mocked(fetch).mockResolvedValue(
          response(cleanData({ fraud_score: fraudScore, ...signals }))
        );
        const { service } = makeService();

        await expect(
          service.checkIPReputation(`192.0.2.${fraudScore}`)
        ).resolves.toMatchObject({ riskLevel });
      }
    );
  });

  describe('decision helpers', () => {
    it.each([
      [{ isVPN: true }, true],
      [{ isProxy: true }, true],
      [{ isTor: true }, true],
      [{}, false],
    ])(
      'derives likely VPN from result signals %#',
      async (signals, expected) => {
        const { service } = makeService();
        vi.spyOn(service, 'checkIPReputation').mockResolvedValue(
          reputationResult(signals)
        );
        await expect(service.isLikelyVPN('192.0.2.1')).resolves.toBe(expected);
      }
    );

    it('returns the provider fraud score', async () => {
      const { service } = makeService();
      vi.spyOn(service, 'checkIPReputation').mockResolvedValue(
        reputationResult({ fraudScore: 42 })
      );
      await expect(service.getFraudScore('192.0.2.1')).resolves.toBe(42);
    });

    it.each([
      [{ fraudScore: 80 }, true],
      [{ fraudScore: 10, isBlocklisted: true }, true],
      [{ fraudScore: 10 }, false],
    ])('applies the configured block decision %#', async (result, expected) => {
      const { service } = makeService(
        reputationConfig({ fraud_score_threshold: 75 })
      );
      vi.spyOn(service, 'checkIPReputation').mockResolvedValue(
        reputationResult(result)
      );
      await expect(service.shouldBlock('192.0.2.1')).resolves.toBe(expected);
    });

    it('uses the default block threshold when configuration omits it', async () => {
      const { service } = makeService(
        reputationConfig({ fraud_score_threshold: undefined })
      );
      vi.spyOn(service, 'checkIPReputation').mockResolvedValue(
        reputationResult({ fraudScore: 75 })
      );
      await expect(service.shouldBlock('192.0.2.1')).resolves.toBe(true);
    });
  });
});
