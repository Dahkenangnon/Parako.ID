import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

import ClientDeviceInfoManager, {
  type ClientDetails,
  type DeviceMatchConfig,
} from '../../../src/utils/client-info.js';

function createHarness(
  options: {
    csrfToken?: string | null;
    config?: Record<string, unknown>;
  } = {}
) {
  const sessionManager = {
    get: vi
      .fn()
      .mockReturnValue(
        Object.hasOwn(options, 'csrfToken') ? options.csrfToken : 'csrf-token'
      ),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const configManager = {
    getConfig: vi.fn().mockReturnValue(options.config ?? {}),
  };

  const manager = new ClientDeviceInfoManager(
    sessionManager as never,
    logger as never,
    configManager as never
  );

  return { manager, sessionManager, logger, configManager };
}

function createManager() {
  return createHarness().manager;
}

function createRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    body: {},
    headers: {},
    session: { id: 'session-id' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: vi.fn().mockReturnValue(false) },
    ...overrides,
  } as unknown as Request;
}

function createDevice(overrides: Partial<ClientDetails> = {}): ClientDetails {
  return {
    ip: '203.0.113.10',
    user_agent: 'Example Browser',
    browser: { name: 'Example', version: '1' },
    os: { name: 'ExampleOS', version: '1' },
    device: { type: 'desktop' },
    language: 'en',
    timezone_guess: 'UTC',
    fingerprint: 'fingerprint-1',
    fingerprint_js_id: 'visitor-1',
    ...overrides,
  };
}

const matchConfig: DeviceMatchConfig = {
  min_confidence_score: 70,
  ip_similarity_threshold: 0.8,
  user_agent_similarity_threshold: 0.7,
  browser_os_similarity_threshold: 0.8,
  fingerprint_similarity_threshold: 0.9,
  max_time_difference_hours: 24,
  suspicious_regions: [],
  vpn_proxy_ranges: ['10.0.0.0/8'],
};

describe('ClientDeviceInfoManager', () => {
  it('accepts and normalizes the browser device-info payload', () => {
    const manager = createManager();
    const request = {
      body: {
        _deviceInfo: JSON.stringify({
          visitorId: 'browser-fingerprint',
          visitorIdSource: 'fingerprintjs',
        }),
      },
      session: { id: 'session-id' },
      ip: '127.0.0.1',
    } as unknown as Request;

    expect(manager.extractDeviceInfoFromRequest(request)).toEqual(
      expect.objectContaining({
        visitor_id: 'browser-fingerprint',
        visitor_id_source: 'fingerprintjs',
      })
    );
  });

  describe('extractDeviceInfoFromRequest', () => {
    it('requires a valid session CSRF token before reading the body', () => {
      const { manager, logger } = createHarness({ csrfToken: null });
      const request = createRequest({
        body: { _deviceInfo: JSON.stringify({ visitor_id: 'visitor' }) },
      });

      expect(manager.extractDeviceInfoFromRequest(request)).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No CSRF token found in session for device info extraction',
        expect.objectContaining({ sessionId: 'session-id', ip: '127.0.0.1' })
      );
    });

    it.each([undefined, null, 'not-an-object', 42])(
      'returns null for a non-object body: %j',
      body => {
        expect(
          createManager().extractDeviceInfoFromRequest(createRequest({ body }))
        ).toBeNull();
      }
    );

    it('returns null when the device field is absent or empty', () => {
      const { manager, logger } = createHarness();

      expect(manager.extractDeviceInfoFromRequest(createRequest())).toBeNull();
      expect(
        manager.extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: '' } })
        )
      ).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No device info field found in request body',
        expect.objectContaining({ fieldName: '_deviceInfo' })
      );
    });

    it('rejects non-string device data', () => {
      const { manager, logger } = createHarness();

      expect(
        manager.extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: { visitor_id: 'visitor' } } })
        )
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid device data format in request',
        expect.objectContaining({ dataType: 'object' })
      );
    });

    it('accepts base64 JSON and preserves canonical snake_case fields', () => {
      const { manager, logger } = createHarness();
      const encoded = Buffer.from(
        JSON.stringify({
          visitor_id: 'canonical',
          visitorId: 'legacy',
          visitor_id_source: 'fallback',
          visitorIdSource: 'fingerprintjs',
        })
      ).toString('base64');

      expect(
        manager.extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: encoded } })
        )
      ).toEqual({
        visitor_id: 'canonical',
        visitor_id_source: 'fallback',
      });
      expect(logger.debug).toHaveBeenCalledWith(
        'Device info extracted successfully',
        expect.objectContaining({ encoding: 'base64' })
      );
    });

    it('logs both parser failures for malformed encoded data', () => {
      const { manager, logger } = createHarness();

      expect(
        manager.extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: 'not-json-or-base64' } })
        )
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to parse device data from request',
        expect.objectContaining({
          jsonError: expect.any(String),
          base64Error: expect.any(String),
        })
      );
    });

    it.each([
      [{}, 'visitorId is required and must be a non-empty string'],
      [
        { visitor_id: 'x'.repeat(101) },
        'visitorId must be 100 characters or less',
      ],
      [
        { visitor_id: 'v', visitor_id_source: 'other' },
        'visitorIdSource must be either "fingerprintjs" or "fallback"',
      ],
      [
        { visitor_id: 'v', user_agent: 1 },
        'userAgent must be a string if provided',
      ],
      [
        { visitor_id: 'v', user_agent: 'x'.repeat(501) },
        'userAgent must be 500 characters or less',
      ],
      [
        { visitor_id: 'v', platform: 1 },
        'platform must be a string if provided',
      ],
      [
        { visitor_id: 'v', platform: 'x'.repeat(101) },
        'platform must be 100 characters or less',
      ],
      [
        { visitor_id: 'v', language: 1 },
        'language must be a string if provided',
      ],
      [
        { visitor_id: 'v', language: 'x'.repeat(11) },
        'language must be 10 characters or less',
      ],
      [
        { visitor_id: 'v', timezone: 1 },
        'timezone must be a string if provided',
      ],
      [
        { visitor_id: 'v', timezone: 'x'.repeat(51) },
        'timezone must be 50 characters or less',
      ],
      [
        { visitor_id: 'v', screen: null },
        'screen must be an object if provided',
      ],
      [
        { visitor_id: 'v', screen: { width: -1 } },
        'screen.width must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { width: 'wide' } },
        'screen.width must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { width: 10001 } },
        'screen.width must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { height: 10001 } },
        'screen.height must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { height: 'tall' } },
        'screen.height must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { height: -1 } },
        'screen.height must be a number between 0 and 10000',
      ],
      [
        { visitor_id: 'v', screen: { pixel_ratio: 'high' } },
        'screen.pixel_ratio must be a number between 0 and 10',
      ],
      [
        { visitor_id: 'v', screen: { pixel_ratio: -1 } },
        'screen.pixel_ratio must be a number between 0 and 10',
      ],
      [
        { visitor_id: 'v', screen: { pixel_ratio: 11 } },
        'screen.pixel_ratio must be a number between 0 and 10',
      ],
      [
        { visitor_id: 'v', hardware_concurrency: 129 },
        'hardwareConcurrency must be a number between 0 and 128',
      ],
      [
        { visitor_id: 'v', hardware_concurrency: 'many' },
        'hardwareConcurrency must be a number between 0 and 128',
      ],
      [
        { visitor_id: 'v', hardware_concurrency: -1 },
        'hardwareConcurrency must be a number between 0 and 128',
      ],
      [
        { visitor_id: 'v', memory: -1 },
        'memory must be a number between 0 and 1024 or null',
      ],
      [
        { visitor_id: 'v', memory: 'large' },
        'memory must be a number between 0 and 1024 or null',
      ],
      [
        { visitor_id: 'v', memory: 1025 },
        'memory must be a number between 0 and 1024 or null',
      ],
    ])('rejects invalid device structures: %s', (payload, expectedError) => {
      const { manager, logger } = createHarness();

      expect(
        manager.extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: JSON.stringify(payload) } })
        )
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid device info structure',
        expect.objectContaining({
          validationErrors: expect.arrayContaining([expectedError]),
        })
      );
    });

    it('accepts all validation boundaries and nullable memory', () => {
      const payload = {
        visitor_id: 'x'.repeat(100),
        visitor_id_source: 'fingerprintjs',
        user_agent: 'x'.repeat(500),
        platform: 'x'.repeat(100),
        language: 'x'.repeat(10),
        timezone: 'x'.repeat(50),
        screen: { width: 0, height: 10000, pixel_ratio: 10 },
        hardware_concurrency: 128,
        memory: null,
      };

      expect(
        createManager().extractDeviceInfoFromRequest(
          createRequest({ body: { _deviceInfo: JSON.stringify(payload) } })
        )
      ).toEqual(payload);
    });

    it.each([new Error('session unavailable'), 'session unavailable'])(
      'contains unexpected dependency failures and reports diagnostics: %s',
      failure => {
        const { manager, sessionManager, logger } = createHarness();
        sessionManager.get.mockImplementation(() => {
          throw failure;
        });

        expect(
          manager.extractDeviceInfoFromRequest(createRequest())
        ).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          'Unexpected error extracting device info from request',
          expect.objectContaining({
            error:
              failure instanceof Error
                ? 'session unavailable'
                : 'Unknown error',
            stack: failure instanceof Error ? expect.any(String) : undefined,
          })
        );
      }
    );
  });

  describe('hasDeviceInfoInRequest', () => {
    it('requires CSRF and a truthy device field', () => {
      const withoutCsrf = createHarness({ csrfToken: null }).manager;
      expect(
        withoutCsrf.hasDeviceInfoInRequest(
          createRequest({ body: { _deviceInfo: 'payload' } })
        )
      ).toBe(false);

      const manager = createManager();
      expect(manager.hasDeviceInfoInRequest(createRequest())).toBe(false);
      expect(
        manager.hasDeviceInfoInRequest(
          createRequest({ body: { _deviceInfo: '' } })
        )
      ).toBe(false);
      expect(
        manager.hasDeviceInfoInRequest(
          createRequest({ body: { _deviceInfo: 'payload' } })
        )
      ).toBe(true);
    });

    it.each([new Error('session unavailable'), 'session unavailable'])(
      'contains session lookup failures: %s',
      failure => {
        const { manager, sessionManager, logger } = createHarness();
        sessionManager.get.mockImplementation(() => {
          throw failure;
        });

        expect(manager.hasDeviceInfoInRequest(createRequest())).toBe(false);
        expect(logger.debug).toHaveBeenCalledWith(
          'Error checking for device info in request',
          expect.objectContaining({
            error:
              failure instanceof Error
                ? 'session unavailable'
                : 'Unknown error',
          })
        );
      }
    );
  });

  describe('getClientInfo', () => {
    it('uses trusted forwarded headers and sanitizes client device values', () => {
      const { manager } = createHarness({
        config: {
          security: {
            protection: { trusted_proxies: ['127.0.0.0/8'] },
          },
        },
      });
      const request = createRequest({
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0',
          'accept-language': ' fr-FR ,en;q=0.9',
          'x-forwarded-for': '203.0.113.20, 127.0.0.1',
        },
      });

      const details = manager.getClientInfo(request, {
        visitor_id: '  visitor-id  ',
        platform: '  Linux  ',
        timezone: '  Africa/Porto-Novo  ',
        screen: { width: 20_000, height: -1, pixel_ratio: 20 },
        hardware_concurrency: 200,
        memory: -10,
      });

      expect(details).toEqual(
        expect.objectContaining({
          ip: '203.0.113.20',
          language: 'fr-FR',
          timezone_guess: 'Africa/Porto-Novo',
          fingerprint_js_id: 'visitor-id',
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
      );
      expect(details.browser.name).toBe('Chrome');
      expect(details.os.name).toBe('Windows');
      expect(details.device.type).toBe('desktop');
    });

    it('keeps fingerprints stable across networks and changes them for device data', () => {
      const manager = createManager();
      const payload = {
        visitor_id: 'visitor',
        platform: 'Linux',
        timezone: 'UTC',
        screen: { width: 1920, height: 1080, pixel_ratio: 2 },
        hardware_concurrency: 8,
        memory: 16,
      };
      const first = manager.getClientInfo(
        createRequest({ socket: { remoteAddress: '192.0.2.1' } }),
        payload
      );
      const second = manager.getClientInfo(
        createRequest({ socket: { remoteAddress: '198.51.100.1' } }),
        payload
      );
      const changed = manager.getClientInfo(
        createRequest({ socket: { remoteAddress: '198.51.100.1' } }),
        { ...payload, platform: 'Other' }
      );

      expect(first.fingerprint).toBe(second.fingerprint);
      expect(changed.fingerprint).not.toBe(first.fingerprint);
    });

    it('uses Express trust-proxy settings when no explicit ranges exist', () => {
      const manager = createManager();
      const trustedBoolean = createRequest({
        app: { get: vi.fn().mockReturnValue(true) },
        headers: { 'x-forwarded-for': '198.51.100.5' },
      });
      const trustedHop = createRequest({
        app: { get: vi.fn().mockReturnValue(1) },
        headers: { 'x-real-ip': '198.51.100.6' },
      });

      expect(manager.getClientInfo(trustedBoolean).ip).toBe('198.51.100.5');
      expect(manager.getClientInfo(trustedHop).ip).toBe('198.51.100.6');
    });

    it('ignores forwarding headers from untrusted sources', () => {
      const { manager, logger } = createHarness();
      const request = createRequest({
        app: { get: vi.fn().mockReturnValue(0) },
        socket: { remoteAddress: '192.0.2.5' },
        headers: {
          'x-forwarded-for': '198.51.100.5',
          'x-real-ip': '198.51.100.6',
        },
      });

      expect(manager.getClientInfo(request).ip).toBe('192.0.2.5');
      expect(logger.warn).toHaveBeenCalledWith(
        'Ignoring forwarded IP headers from untrusted source',
        expect.objectContaining({ directIP: '192.0.2.5' })
      );
    });

    it('requires an explicit trusted-proxy range to match the direct peer', () => {
      const { manager, logger } = createHarness({
        config: {
          security: {
            protection: { trusted_proxies: ['10.0.0.0/8'] },
          },
        },
      });
      const request = createRequest({
        socket: { remoteAddress: '192.0.2.5' },
        headers: { 'x-forwarded-for': '198.51.100.5' },
      });

      expect(manager.getClientInfo(request).ip).toBe('192.0.2.5');
      expect(logger.warn).toHaveBeenCalledWith(
        'Ignoring forwarded IP headers from untrusted source',
        expect.objectContaining({ trustedProxiesConfigured: 1 })
      );
    });

    it('falls through unknown forwarded values to X-Real-IP', () => {
      const manager = createManager();
      const request = createRequest({
        app: { get: vi.fn().mockReturnValue(true) },
        headers: {
          'x-forwarded-for': 'unknown, 127.0.0.1',
          'x-real-ip': ' 198.51.100.7 ',
        },
      });

      expect(manager.getClientInfo(request).ip).toBe('198.51.100.7');
    });

    it('falls back to the direct peer for an empty forwarded chain', () => {
      const manager = createManager();
      const request = createRequest({
        app: { get: vi.fn().mockReturnValue(true) },
        socket: { remoteAddress: '192.0.2.9' },
        headers: { 'x-forwarded-for': '   ' },
      });

      expect(manager.getClientInfo(request).ip).toBe('192.0.2.9');
    });

    it('supports requests with no resolved peer address or metadata headers', () => {
      const details = createManager().getClientInfo(
        createRequest({
          socket: { remoteAddress: undefined },
          ip: undefined,
          headers: {},
        }),
        {
          visitor_id: '',
          screen: { width: 0, height: 0, pixel_ratio: 0 },
          hardware_concurrency: 0,
          memory: 0,
        }
      );

      expect(details).toEqual(
        expect.objectContaining({
          ip: 'unknown',
          user_agent: 'Unknown',
          language: 'en',
          timezone_guess: undefined,
          fingerprint_js_id: undefined,
        })
      );
    });

    it('falls back to request IP/default metadata when generation fails', () => {
      const { manager, configManager, logger } = createHarness();
      configManager.getConfig.mockImplementation(() => {
        throw new Error('configuration unavailable');
      });
      const request = createRequest({
        ip: '192.0.2.20',
        socket: { remoteAddress: undefined },
        headers: { 'user-agent': 'Fallback Agent' },
      });

      expect(manager.getClientInfo(request, { visitor_id: 'visitor' })).toEqual(
        {
          ip: '192.0.2.20',
          user_agent: 'Fallback Agent',
          browser: {},
          os: {},
          device: {},
          language: 'en',
          timezone_guess: 'UTC',
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          fingerprint_js_id: 'visitor',
        }
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error generating client info',
        expect.objectContaining({ error: 'configuration unavailable' })
      );
    });

    it('uses fallback placeholders when request metadata is unavailable', () => {
      const { manager, configManager } = createHarness();
      configManager.getConfig.mockImplementation(() => {
        throw 'configuration unavailable';
      });
      const request = createRequest({ ip: '', headers: {} });

      expect(manager.getClientInfo(request, { visitor_id: '' })).toEqual(
        expect.objectContaining({
          ip: 'unknown',
          user_agent: 'Unknown',
          fingerprint_js_id: undefined,
        })
      );
    });
  });

  describe('getClientInfoFromRequest', () => {
    it('combines extracted browser data with server request data', () => {
      const manager = createManager();
      const request = createRequest({
        body: {
          _deviceInfo: JSON.stringify({
            visitor_id: 'visitor',
            timezone: 'UTC',
          }),
        },
      });

      expect(manager.getClientInfoFromRequest(request)).toEqual(
        expect.objectContaining({
          fingerprint_js_id: 'visitor',
          timezone_guess: 'UTC',
        })
      );
    });

    it('falls back safely when extraction has no usable payload', () => {
      expect(createManager().getClientInfoFromRequest(createRequest())).toEqual(
        expect.objectContaining({ fingerprint_js_id: undefined })
      );
    });

    it('contains logging failures and returns safe client details', () => {
      const { manager, logger } = createHarness();
      logger.debug.mockImplementation(() => {
        throw new Error('logger unavailable');
      });

      expect(manager.getClientInfoFromRequest(createRequest())).toEqual(
        expect.objectContaining({
          ip: '127.0.0.1',
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error generating client info from request',
        expect.objectContaining({ error: 'logger unavailable' })
      );
    });
  });

  describe('trusted proxy address matching', () => {
    it('matches exact IPv4 addresses and IPv4-mapped addresses', () => {
      const manager = createManager();

      expect(manager.isIPInRange('192.0.2.10', '192.0.2.10')).toBe(true);
      expect(manager.isIPInRange('::ffff:192.0.2.10', '192.0.2.10')).toBe(true);
      expect(manager.isIPInRange('192.0.2.11', '192.0.2.10')).toBe(false);
    });

    it('honours IPv4 CIDR boundaries', () => {
      const manager = createManager();

      expect(manager.isIPInRange('192.168.1.255', '192.168.1.0/24')).toBe(true);
      expect(manager.isIPInRange('192.168.2.0', '192.168.1.0/24')).toBe(false);
      expect(manager.isIPInRange('203.0.113.7', '0.0.0.0/0')).toBe(true);
      expect(manager.isIPInRange('203.0.113.7', '203.0.113.7/32')).toBe(true);
    });

    it('rejects malformed IPv4 addresses and invalid prefixes', () => {
      const manager = createManager();

      expect(manager.isIPInRange('192.168.1foo.7', '192.168.1.0/24')).toBe(
        false
      );
      expect(manager.isIPInRange('192.168.1.7', '192.168.1.0/33')).toBe(false);
      expect(manager.isIPInRange('192.168.1.7', '192.168.1.0/-1')).toBe(false);
      expect(
        manager.isIPInRange('192.168.1.7', '192.168.1.0/not-a-prefix')
      ).toBe(false);
      expect(manager.isIPInRange('192.168.1.7', '192.168.1.0/')).toBe(false);
      expect(manager.isIPInRange('192.168.1.7', '192.168.1.0/24/extra')).toBe(
        false
      );
      expect(manager.isIPInRange('192.168.1.7', 'invalid/24')).toBe(false);
      expect(manager.isIPInRange('invalid', '192.168.1.0/24')).toBe(false);
      expect(manager.isIPInRange('192.168.1.7', '2001:db8::/32')).toBe(false);
      expect(manager.isIPInRange('invalid', 'invalid')).toBe(false);
    });

    it('supports IPv6 CIDR ranges without treating unrelated hosts as exact matches', () => {
      const manager = createManager();

      expect(manager.isIPInRange('2001:db8::1234', '2001:db8::/32')).toBe(true);
      expect(manager.isIPInRange('2001:db9::1', '2001:db8::/32')).toBe(false);
      expect(manager.isIPInRange('2001:db8::1', '2001:db8::1/129')).toBe(false);
    });
  });

  describe('similarity calculations', () => {
    it('calculates normalized string edit similarity', () => {
      const manager = createManager();

      expect(manager.calculateStringSimilarity('', 'value')).toBe(0);
      expect(manager.calculateStringSimilarity('same', 'same')).toBe(1);
      expect(
        manager.calculateStringSimilarity('kitten', 'sitting')
      ).toBeCloseTo(4 / 7);
      expect(manager.calculateStringSimilarity('abc', 'ab')).toBeCloseTo(2 / 3);
    });

    it('calculates IPv4 similarity by matching octets', () => {
      const manager = createManager();

      expect(manager.calculateIPSimilarity('', '192.0.2.1')).toBe(0);
      expect(manager.calculateIPSimilarity('192.0.2.1', '192.0.2.1')).toBe(1);
      expect(manager.calculateIPSimilarity('192.0.2.1', '192.0.3.9')).toBe(0.5);
      expect(manager.calculateIPSimilarity('2001:db8::1', '2001:db8::2')).toBe(
        0
      );
    });

    it('averages only available browser, OS, and device fields', () => {
      const manager = createManager();
      const empty = createDevice({ browser: {}, os: {}, device: {} });

      expect(manager.calculateBrowserOSSimilarity(empty, empty)).toBe(0);
      expect(
        manager.calculateBrowserOSSimilarity(
          createDevice(),
          createDevice({ device: { type: 'mobile' } })
        )
      ).toBeCloseTo(2 / 3);
      expect(
        manager.calculateBrowserOSSimilarity(
          createDevice({ browser: {} }),
          createDevice({ browser: {} })
        )
      ).toBe(1);
    });

    it('weights stable fingerprints above network and user-agent similarity', () => {
      const manager = createManager();
      const known = createDevice();

      expect(manager.calculateDeviceSimilarity(known, known, matchConfig)).toBe(
        1
      );
      expect(
        manager.calculateDeviceSimilarity(
          createDevice({
            fingerprint: 'other-fingerprint',
            fingerprint_js_id: 'other-visitor',
          }),
          known,
          matchConfig
        )
      ).toBeCloseTo(0.3);
      expect(
        manager.calculateDeviceSimilarity(
          createDevice({ fingerprint: '', fingerprint_js_id: undefined }),
          createDevice({ fingerprint: '', fingerprint_js_id: undefined }),
          matchConfig
        )
      ).toBe(1);
    });

    it('detects configured suspicious IP ranges', () => {
      const manager = createManager();

      expect(manager.isSuspiciousIP('10.2.3.4', matchConfig)).toBe(true);
      expect(manager.isSuspiciousIP('203.0.113.10', matchConfig)).toBe(false);
    });
  });

  describe('device risk and matching', () => {
    it('returns each risk tier at its threshold', () => {
      const manager = createManager();
      const known = createDevice();

      expect(manager.determineRiskLevel(known, [known], matchConfig)).toBe(
        'low'
      );
      expect(manager.determineRiskLevel(known, [], matchConfig)).toBe('medium');
      expect(
        manager.determineRiskLevel(
          createDevice({ ip: '10.0.0.1', fingerprint: 'new' }),
          [known],
          matchConfig
        )
      ).toBe('high');

      const diverseHistory = Array.from({ length: 8 }, (_, index) =>
        createDevice({
          fingerprint: `fingerprint-${index}`,
          timezone_guess: 'UTC',
        })
      );
      expect(
        manager.determineRiskLevel(
          createDevice({
            ip: '10.0.0.1',
            fingerprint: 'fingerprint-0',
            timezone_guess: 'Pacific/Auckland',
          }),
          diverseHistory,
          matchConfig
        )
      ).toBe('critical');
    });

    it('does not increase risk for absent timezones or a stable device history', () => {
      const manager = createManager();
      const stableHistory = Array.from({ length: 5 }, () =>
        createDevice({ timezone_guess: undefined })
      );

      expect(
        manager.determineRiskLevel(
          createDevice({ timezone_guess: 'UTC' }),
          stableHistory,
          matchConfig
        )
      ).toBe('low');
      expect(
        manager.determineRiskLevel(
          createDevice({ timezone_guess: undefined }),
          [createDevice()],
          matchConfig
        )
      ).toBe('low');
    });

    it('marks a first login as a new device requiring 2FA', () => {
      expect(createManager().evaluateDeviceMatch(createDevice(), [])).toEqual({
        is_new_device: true,
        requires_2fa: true,
        is_suspicious: false,
        confidence_score: 0,
        reason: 'First login - no previous devices found',
        risk_level: 'medium',
      });
    });

    it('selects the best known device match', () => {
      const manager = createManager();
      const newDevice = createDevice();
      const weaker = createDevice({
        fingerprint: 'other',
        fingerprint_js_id: 'other',
      });

      expect(
        manager.evaluateDeviceMatch(
          newDevice,
          [weaker, newDevice, newDevice],
          matchConfig
        )
      ).toEqual(
        expect.objectContaining({
          is_new_device: false,
          requires_2fa: false,
          is_suspicious: false,
          confidence_score: 100,
          reason: 'Known device matched (confidence: 100%)',
          matched_device: newDevice,
          risk_level: 'low',
        })
      );
    });

    it('requires 2FA for a low-confidence new device', () => {
      const manager = createManager();
      const result = manager.evaluateDeviceMatch(
        createDevice({
          ip: '198.51.100.25',
          user_agent: 'Different',
          browser: { name: 'Other' },
          os: { name: 'OtherOS' },
          device: { type: 'mobile' },
          fingerprint: 'new',
          fingerprint_js_id: 'new',
        }),
        [createDevice()],
        matchConfig
      );

      expect(result).toEqual(
        expect.objectContaining({
          is_new_device: true,
          requires_2fa: true,
          is_suspicious: false,
          reason: expect.stringMatching(/^New device detected/),
        })
      );
    });

    it('flags a known device when device-level risk is high', () => {
      const manager = createManager();
      const oldDevice = createDevice({ timezone_guess: 'UTC' });
      const newDevice = createDevice({
        ip: '10.0.0.5',
        timezone_guess: 'Pacific/Auckland',
      });

      const result = manager.evaluateDeviceMatch(
        newDevice,
        [oldDevice],
        matchConfig
      );
      expect(result).toEqual(
        expect.objectContaining({
          is_new_device: false,
          requires_2fa: true,
          is_suspicious: true,
          risk_level: 'high',
          reason: 'Suspicious activity detected (high risk level)',
        })
      );
    });

    it('evaluates a device directly from a request and logs the result', () => {
      const { manager, logger } = createHarness();
      const result = manager.evaluateDeviceMatchFromRequest(
        createRequest(),
        []
      );

      expect(result.is_new_device).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        'Device match evaluation completed',
        expect.objectContaining({ old_devices_count: 0 })
      );
    });

    it.each([new Error('logger unavailable'), 'logger unavailable'])(
      'fails closed when request-based evaluation throws: %s',
      failure => {
        const { manager, logger } = createHarness();
        logger.debug.mockImplementation(() => {
          throw failure;
        });

        expect(
          manager.evaluateDeviceMatchFromRequest(createRequest(), [])
        ).toEqual({
          is_new_device: true,
          requires_2fa: true,
          is_suspicious: false,
          confidence_score: 0,
          reason:
            'Error occurred during device evaluation - defaulting to new device',
          risk_level: 'medium',
        });
        expect(logger.error).toHaveBeenCalledWith(
          'Error evaluating device match from request',
          expect.objectContaining({
            error:
              failure instanceof Error ? 'logger unavailable' : 'Unknown error',
          })
        );
      }
    );
  });
});
