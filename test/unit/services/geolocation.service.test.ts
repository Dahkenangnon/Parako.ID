import 'reflect-metadata';
import { BootstrapEnvironment } from '../../../src/config/bootstrap-environment.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeolocationService } from '../../../src/services/geolocation.service.js';
import type { GeoLocation } from '../../../src/di/interfaces/geolocation-service.interface.js';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function geolocationConfig(
  ipinfoOverrides: Record<string, unknown> = {},
  protectionOverrides: Record<string, unknown> = {}
) {
  return {
    integrations: {
      ipinfo: {
        enabled: true,
        api_token: 'database-token',
        cache_ttl_hours: 24,
        ...ipinfoOverrides,
      },
    },
    security: {
      protection: {
        high_risk_countries: ['KP', 'IR'],
        device_matching: {
          impossible_travel_max_speed_kmh: 900,
        },
        ...protectionOverrides,
      },
    },
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
  };
}

function makeService(config: unknown = geolocationConfig()) {
  const configManager = { getConfig: vi.fn(() => config) };
  const logger = makeLogger();
  const service = new GeolocationService(
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

function providerLocation(overrides: Record<string, unknown> = {}) {
  return {
    city: 'Cotonou',
    region: 'Littoral',
    country: 'BJ',
    loc: '6.3703,2.3912',
    timezone: 'Africa/Porto-Novo',
    org: 'AS64500 Example',
    postal: '00000',
    ...overrides,
  };
}

function location(
  latitude: number | undefined,
  longitude: number | undefined,
  overrides: Partial<GeoLocation> = {}
): GeoLocation {
  return {
    ip: '192.0.2.1',
    latitude,
    longitude,
    success: true,
    timestamp: NOW.getTime(),
    ...overrides,
  };
}

describe('GeolocationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(providerLocation()))
    );
    delete process.env.IPINFO_API_TOKEN;
  });

  afterEach(() => {
    delete process.env.IPINFO_API_TOKEN;
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('availability', () => {
    it('is enabled by explicit configuration', () => {
      const { service, configManager } = makeService();

      expect(service.isEnabled()).toBe(true);
      expect(configManager.getConfig).toHaveBeenCalledOnce();
    });

    it('is disabled when configuration does not enable it', () => {
      const { service } = makeService(
        geolocationConfig({ enabled: false, api_token: undefined })
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('is disabled when the integrations section is absent', () => {
      const { service } = makeService({});

      expect(service.isEnabled()).toBe(false);
    });

    it('lets a trimmed environment token enable the service without configuration', () => {
      process.env.IPINFO_API_TOKEN = ' environment token ';
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(service.isEnabled()).toBe(true);
      expect(configManager.getConfig).not.toHaveBeenCalled();
    });

    it('contains configuration lookup failures when no environment token exists', () => {
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(service.isEnabled()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Geolocation configuration unavailable',
        { error: 'configuration unavailable' }
      );
    });
  });

  describe('provider lookup and caching', () => {
    it('returns a normalized disabled result without contacting the provider', async () => {
      const { service } = makeService(
        geolocationConfig({ enabled: false, api_token: undefined })
      );

      await expect(
        service.getLocationFromIP('::ffff:192.0.2.1')
      ).resolves.toEqual({
        ip: '192.0.2.1',
        success: false,
        error: 'Geolocation service is disabled',
        timestamp: NOW.getTime(),
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns a disabled result when the integrations section is absent', async () => {
      const { service } = makeService({});

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'Geolocation service is disabled',
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('uses the environment token and safely encodes the IP and query value', async () => {
      process.env.IPINFO_API_TOKEN = ' env token/? ';
      const { service } = makeService(geolocationConfig({ enabled: false }));

      await service.getLocationFromIP('2001:db8::1/path?query=yes');

      expect(fetch).toHaveBeenCalledWith(
        'https://ipinfo.io/2001%3Adb8%3A%3A1%2Fpath%3Fquery%3Dyes/json?token=env+token%2F%3F',
        expect.objectContaining({
          headers: { Accept: 'application/json' },
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('trims a configured token before sending it', async () => {
      const { service } = makeService(
        geolocationConfig({ api_token: ' database token ' })
      );

      await service.getLocationFromIP('192.0.2.1');

      expect(fetch).toHaveBeenCalledWith(
        'https://ipinfo.io/192.0.2.1/json?token=database+token',
        expect.any(Object)
      );
    });

    it('supports the provider basic tier without an API token', async () => {
      const { service } = makeService(
        geolocationConfig({ api_token: undefined })
      );

      await service.getLocationFromIP('192.0.2.1');

      expect(fetch).toHaveBeenCalledWith(
        'https://ipinfo.io/192.0.2.1/json',
        expect.any(Object)
      );
    });

    it('maps a provider response and caches it for the configured TTL', async () => {
      const { service, logger } = makeService(
        geolocationConfig({ cache_ttl_hours: 2 })
      );

      const first = await service.getLocationFromIP('::ffff:192.0.2.1');
      const second = await service.getLocationFromIP('192.0.2.1');

      expect(first).toEqual({
        ip: '192.0.2.1',
        city: 'Cotonou',
        region: 'Littoral',
        country: 'BJ',
        countryName: 'BJ',
        latitude: 6.3703,
        longitude: 2.3912,
        timezone: 'Africa/Porto-Novo',
        org: 'AS64500 Example',
        postal: '00000',
        success: true,
        timestamp: NOW.getTime(),
      });
      expect(second).toBe(first);
      expect(fetch).toHaveBeenCalledOnce();
      expect(logger.debug).toHaveBeenCalledWith('Geolocation cache hit', {
        ip: '192.0.2.1',
      });

      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000 + 1));
      await service.getLocationFromIP('192.0.2.1');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('uses the default 24-hour cache TTL when the field is absent', async () => {
      const { service } = makeService(
        geolocationConfig({ cache_ttl_hours: undefined })
      );

      await service.getLocationFromIP('192.0.2.1');
      vi.setSystemTime(new Date(NOW.getTime() + 24 * 60 * 60 * 1000 - 1));
      await service.getLocationFromIP('192.0.2.1');

      expect(fetch).toHaveBeenCalledOnce();
    });

    it('continues with environment settings and default TTL during a configuration outage', async () => {
      process.env.IPINFO_API_TOKEN = 'environment-token';
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({ success: true, country: 'BJ' });
      expect(logger.warn).toHaveBeenCalledWith(
        'Geolocation configuration unavailable; using environment defaults',
        { error: 'configuration unavailable' }
      );
    });

    it('returns a disabled result when configuration is unavailable without an environment token', async () => {
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'Geolocation service is disabled',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Geolocation configuration unavailable',
        { error: 'configuration unavailable' }
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      ['not-a-coordinate'],
      [',2.3912'],
      ['NaN,2.3912'],
      ['91,2.3912'],
      ['6.3703,181'],
      [42],
    ])('omits malformed provider coordinates: %j', async loc => {
      vi.mocked(fetch).mockResolvedValue(response(providerLocation({ loc })));
      const { service } = makeService();

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: true,
        latitude: undefined,
        longitude: undefined,
      });
    });

    it('normalizes malformed optional provider fields', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response(
          providerLocation({
            city: 42,
            region: null,
            country: '  bj  ',
            timezone: '',
            org: '  Example Org  ',
            postal: false,
            loc: undefined,
          })
        )
      );
      const { service } = makeService();

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        city: undefined,
        region: undefined,
        country: 'bj',
        countryName: 'bj',
        timezone: undefined,
        org: 'Example Org',
        postal: undefined,
      });
    });

    it('clears the timeout after a network rejection and returns a stable error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'));
      const { service, logger } = makeService();

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'network unavailable',
      });
      expect(clearTimeoutSpy).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith('Geolocation lookup failed', {
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

      const lookup = service.getLocationFromIP('192.0.2.1');
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(lookup).resolves.toMatchObject({
        success: false,
        error: 'request aborted',
      });
      const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
      expect(signal.aborted).toBe(true);
    });

    it('maps non-2xx responses to error results', async () => {
      vi.mocked(fetch).mockResolvedValue(
        response({}, { ok: false, status: 503 })
      );
      const { service } = makeService();

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'ipinfo.io API returned 503',
      });
    });

    it('normalizes non-Error provider rejections', async () => {
      vi.mocked(fetch).mockRejectedValue('provider unavailable');
      const { service, logger } = makeService();

      await expect(
        service.getLocationFromIP('192.0.2.1')
      ).resolves.toMatchObject({
        success: false,
        error: 'provider unavailable',
      });
      expect(logger.warn).toHaveBeenCalledWith('Geolocation lookup failed', {
        ip: '192.0.2.1',
        error: 'provider unavailable',
      });
    });
  });

  describe('distance calculation', () => {
    it('calculates distance with the Haversine formula', () => {
      const { service } = makeService();
      const cotonou = location(6.3703, 2.3912);
      const paris = location(48.8566, 2.3522);

      expect(service.calculateDistance(cotonou, paris)).toBeCloseTo(4725, -1);
      expect(service.calculateDistance(cotonou, cotonou)).toBe(0);
    });

    it.each([
      [undefined, 2],
      [6, undefined],
      [Number.NaN, 2],
      [6, Number.POSITIVE_INFINITY],
      [91, 2],
      [6, 181],
      [-91, 2],
      [6, -181],
    ])('rejects unusable coordinates: %j, %j', (latitude, longitude) => {
      const { service } = makeService();

      expect(
        service.calculateDistance(
          location(latitude, longitude),
          location(6.3703, 2.3912)
        )
      ).toBe(-1);
    });
  });

  describe('impossible travel', () => {
    const previous = location(6.3703, 2.3912);

    it('returns a low-risk result when coordinates are missing', () => {
      const { service } = makeService();

      expect(
        service.checkImpossibleTravel(previous, location(undefined, 2), 60)
      ).toEqual({
        isImpossible: false,
        distanceKm: 0,
        timeDiffMinutes: 60,
        speedKmh: 0,
        maxSpeedKmh: 900,
        riskLevel: 'low',
        explanation: 'Unable to calculate distance - missing coordinates',
      });
    });

    it.each([
      [location(6.3703, 2.3912), 60, false, 'low', 'reasonable'],
      [location(12.2, 2.3912), 60, false, 'low', 'possible but fast'],
      [location(18.0, 2.3912), 60, true, 'medium', 'suspicious'],
      [location(25.0, 2.3912), 60, true, 'high', 'exceeds'],
      [location(40.0, 2.3912), 60, true, 'critical', 'physically impossible'],
    ] as const)(
      'classifies travel speed %#',
      (current, minutes, impossible, riskLevel, explanation) => {
        const { service } = makeService();

        const result = service.checkImpossibleTravel(
          previous,
          current,
          minutes
        );

        expect(result.isImpossible).toBe(impossible);
        expect(result.riskLevel).toBe(riskLevel);
        expect(result.explanation).toContain(explanation);
        expect(result.distanceKm).toBeGreaterThanOrEqual(0);
        expect(result.speedKmh).toBeGreaterThanOrEqual(0);
      }
    );

    it('uses a positive explicit maximum speed override', () => {
      const { service } = makeService();

      const result = service.checkImpossibleTravel(
        previous,
        location(12, 2.3912),
        60,
        500
      );

      expect(result.maxSpeedKmh).toBe(500);
      expect(result.isImpossible).toBe(true);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'ignores an invalid explicit maximum speed: %s',
      maxSpeed => {
        const { service } = makeService();

        expect(
          service.checkImpossibleTravel(
            previous,
            location(12, 2.3912),
            60,
            maxSpeed
          ).maxSpeedKmh
        ).toBe(900);
      }
    );

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
      'preserves the critical decision but returns JSON-safe values for invalid elapsed time: %s',
      timeDiffMinutes => {
        const { service } = makeService();

        const result = service.checkImpossibleTravel(
          previous,
          location(40, 2.3912),
          timeDiffMinutes
        );

        expect(result).toMatchObject({
          isImpossible: true,
          timeDiffMinutes: 0,
          riskLevel: 'critical',
          explanation: 'Travel time must be greater than zero',
        });
        expect(Number.isFinite(result.speedKmh)).toBe(true);
        expect(() => JSON.stringify(result)).not.toThrow();
      }
    );

    it('treats no movement over an invalid elapsed time as low risk', () => {
      const { service } = makeService();

      expect(
        service.checkImpossibleTravel(previous, previous, 0)
      ).toMatchObject({
        isImpossible: false,
        timeDiffMinutes: 0,
        speedKmh: 0,
        riskLevel: 'low',
        explanation: 'No travel detected',
      });
    });

    it('falls back to the secure default when configuration is unavailable', () => {
      const configManager = {
        getConfig: vi.fn(() => {
          throw new Error('configuration unavailable');
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(
        service.checkImpossibleTravel(previous, location(12, 2.3912), 60)
          .maxSpeedKmh
      ).toBe(900);
      expect(logger.warn).toHaveBeenCalledWith(
        'Impossible travel configuration unavailable; using defaults',
        { error: 'configuration unavailable' }
      );
    });

    it('falls back to the secure default when the configured speed is absent', () => {
      const { service } = makeService(
        geolocationConfig(
          {},
          {
            device_matching: {
              impossible_travel_max_speed_kmh: undefined,
            },
          }
        )
      );

      expect(
        service.checkImpossibleTravel(previous, location(12, 2.3912), 60)
          .maxSpeedKmh
      ).toBe(900);
    });
  });

  describe('high-risk regions', () => {
    it('matches configured country codes case-insensitively and ignores whitespace', () => {
      const { service } = makeService(
        geolocationConfig({}, { high_risk_countries: [' kp ', 'ir', '', 42] })
      );

      expect(
        service.isHighRiskRegion(location(1, 1, { country: ' Kp ' }))
      ).toBe(true);
      expect(service.isHighRiskRegion(location(1, 1, { country: 'BJ' }))).toBe(
        false
      );
    });

    it('returns false when the location has no country', () => {
      const { service, configManager } = makeService();

      expect(service.isHighRiskRegion(location(1, 1))).toBe(false);
      expect(configManager.getConfig).not.toHaveBeenCalled();
    });

    it('uses an empty list when high-risk countries are not configured', () => {
      const { service } = makeService(
        geolocationConfig({}, { high_risk_countries: undefined })
      );

      expect(service.isHighRiskRegion(location(1, 1, { country: 'KP' }))).toBe(
        false
      );
    });

    it('returns false if high-risk configuration is unavailable', () => {
      const configManager = {
        getConfig: vi.fn(() => {
          throw 'configuration unavailable';
        }),
      };
      const logger = makeLogger();
      const service = new GeolocationService(
        configManager as any,
        logger as any,
        new BootstrapEnvironment()
      );

      expect(service.isHighRiskRegion(location(1, 1, { country: 'KP' }))).toBe(
        false
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'High-risk region configuration unavailable',
        { error: 'configuration unavailable' }
      );
    });
  });
});
