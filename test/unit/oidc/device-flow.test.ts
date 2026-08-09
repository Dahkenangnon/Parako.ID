import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getParsedUserAgent } = vi.hoisted(() => ({
  getParsedUserAgent: vi.fn(),
}));

vi.mock('ua-parser-js', () => ({
  UAParser: vi.fn(function MockUAParser() {
    return { getResult: getParsedUserAgent };
  }),
}));

vi.mock('cheerio', async importOriginal => {
  const actual = await importOriginal<typeof import('cheerio')>();
  return { ...actual, load: vi.fn(actual.load) };
});

import * as cheerio from 'cheerio';

import DeviceFlow from '../../../src/oidc/specs/feature/device-flow.js';

function createFeature() {
  return DeviceFlow(
    {
      getConfig: () => ({
        features: {
          oidc: {
            device_flow: {
              enabled: true,
              charset: 'base-20',
              mask: '****-****',
            },
          },
        },
      }),
    } as never,
    {
      views: {
        auth: {
          oidc: {
            device_flow_code_input: 'auth/oidc/device-flow-code-input',
            device_flow_confirm_code: 'auth/oidc/device-flow-confirm-code',
            device_flow_success: 'auth/oidc/device-flow-success',
          },
        },
      },
    } as never,
    { getLocale: vi.fn().mockReturnValue('en') } as never
  );
}

describe('OIDC device flow', () => {
  beforeEach(() => {
    getParsedUserAgent.mockReset();
    getParsedUserAgent.mockReturnValue({
      browser: {},
      device: {},
      os: {},
    });
  });

  it('exposes the configured device-code policy', () => {
    const feature = createFeature();

    expect(feature).toMatchObject({
      enabled: true,
      charset: 'base-20',
      mask: '****-****',
    });
  });

  it.each([
    ['', 'None'],
    ['curl/8', 'curl/8'],
  ])(
    'describes the short user agent %j as a programmatic client',
    (userAgent, expectedUserAgent) => {
      const feature = createFeature();
      const context = {
        get: vi.fn().mockReturnValue(userAgent),
        ip: '192.0.2.10',
        session: { id: 'session-1' },
      };

      expect(feature.deviceInfo(context as never)).toMatchObject({
        ip: '192.0.2.10',
        ua: expectedUserAgent,
        deviceType: 'CLI / Script',
        browser: 'None (programmatic)',
        browserVersion: '',
        os: 'Unknown',
        osVersion: '',
        location: 'Unknown Location',
        sessionId: 'session-1',
      });
    }
  );

  it('returns normalized metadata for a parsed browser device', () => {
    getParsedUserAgent.mockReturnValue({
      browser: { name: 'Mobile Browser', version: '12.3' },
      device: { type: 'mobile' },
      os: { name: 'Mobile OS', version: '9.1' },
    });
    const feature = createFeature();
    const context = {
      get: vi.fn((header: string) =>
        header === 'user-agent' ? 'A realistic browser user agent' : ''
      ),
      ip: '198.51.100.8',
      session: { id: 'session-2' },
    };

    expect(feature.deviceInfo(context as never)).toMatchObject({
      ip: '198.51.100.8',
      ua: 'A realistic browser user agent',
      deviceType: 'Mobile',
      browser: 'Mobile Browser',
      browserVersion: '12.3',
      os: 'Mobile OS',
      osVersion: '9.1',
      sessionId: 'session-2',
    });
  });

  it.each([
    ['Vendor Smart TV Browser', {}, 'Smart TV'],
    ['Network Printer Canon Browser', {}, 'Printer'],
    ['Arduino IoT Controller', {}, 'IoT Device'],
    ['Desktop Browser Signature', { name: 'Linux' }, 'Desktop'],
    ['Unrecognized Agent Signature', {}, 'Unknown Device'],
  ])(
    'classifies %s by its observable signature',
    (userAgent, os, expectedDeviceType) => {
      getParsedUserAgent.mockReturnValue({
        browser: {},
        device: {},
        os,
      });
      const feature = createFeature();
      const context = {
        get: vi.fn((header: string) =>
          header === 'user-agent' ? userAgent : ''
        ),
      };

      expect(feature.deviceInfo(context as never).deviceType).toBe(
        expectedDeviceType
      );
    }
  );

  it.each([
    ['Koa request IP', '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.0.2.1'],
    ['forwarded IP', '', '198.51.100.1', '203.0.113.1', '198.51.100.1'],
    ['real IP', '', '', '203.0.113.1', '203.0.113.1'],
    ['missing IP', '', '', '', 'Unknown'],
  ])(
    'uses %s when describing a device request',
    (_label, koaIp, forwardedIp, realIp, expectedIp) => {
      const feature = createFeature();
      const context = {
        ip: koaIp,
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return forwardedIp;
          if (header === 'x-real-ip') return realIp;
          return '';
        }),
      };

      expect(feature.deviceInfo(context as never)).toMatchObject({
        ip: expectedIp,
        sessionId: 'Unknown',
      });
    }
  );

  it.each([
    [{ clientName: 'Named RP', clientId: 'client-1' }, 'Named RP'],
    [{ clientId: 'client-1' }, 'client-1'],
    [undefined, 'Application'],
  ])(
    'renders a successful authorization for %s',
    async (client, expectedClientName) => {
      const feature = createFeature();
      const context = {
        oidc: client ? { client } : undefined,
        render: vi.fn(),
      };

      await feature.successSource(context as never);

      expect(context.render).toHaveBeenCalledWith(
        'auth/oidc/device-flow-success',
        {
          clientName: expectedClientName,
          locale: 'en',
          title: 'Authorization Successful',
        }
      );
    }
  );

  it.each([
    [{ clientId: 'client-2' }, 'client-2'],
    [{}, 'Application'],
  ])(
    'uses the confirmation client fallback for %s',
    async (client, expectedClientName) => {
      const feature = createFeature();
      const context = { render: vi.fn() };

      await feature.userCodeConfirmSource(
        context as never,
        '<form></form>',
        client as never,
        {},
        'ABCD-EFGH'
      );

      expect(context.render).toHaveBeenCalledWith(
        'auth/oidc/device-flow-confirm-code',
        expect.objectContaining({ clientName: expectedClientName })
      );
    }
  );

  it('renders provider form details on the device-code entry page', async () => {
    const feature = createFeature();
    const context = { render: vi.fn() };
    const form = [
      '<form id="device-code" action="/oidc/device" method="get">',
      '<input name="xsrf" value="csrf-token">',
      '</form>',
    ].join('');

    await feature.userCodeInputSource(context as never, form, {}, undefined);

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/device-flow-code-input',
      {
        form,
        error: null,
        warning: null,
        userCode: '',
        locale: 'en',
        title: 'Device Verification',
        formId: 'device-code',
        formAction: '/oidc/device',
        formMethod: 'get',
        xsrfToken: 'csrf-token',
        deviceCodeMask: '****-****',
        deviceCodeCharset: 'base-20',
      }
    );
  });

  it('uses safe form defaults when provider HTML omits attributes', async () => {
    const feature = createFeature();
    const context = { render: vi.fn() };

    await feature.userCodeInputSource(
      context as never,
      '<form><input name="xsrf"></form>',
      {},
      undefined
    );

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/device-flow-code-input',
      expect.objectContaining({
        formId: 'op.deviceInputForm',
        formAction: '',
        formMethod: 'post',
        xsrfToken: '',
      })
    );
  });

  it('falls back to extracting provider form details when the HTML parser fails', async () => {
    vi.mocked(cheerio.load).mockImplementationOnce(() => {
      throw new Error('parser unavailable');
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const feature = createFeature();
    const context = { render: vi.fn() };
    const form = [
      '<form id="fallback-form" action="/oidc/fallback" method="put">',
      '<input name="xsrf" value="fallback-token">',
      '</form>',
    ].join('');

    await feature.userCodeInputSource(context as never, form, {}, undefined);

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/device-flow-code-input',
      expect.objectContaining({
        formId: 'fallback-form',
        formAction: '/oidc/fallback',
        formMethod: 'put',
        xsrfToken: 'fallback-token',
      })
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Error parsing form with cheerio, falling back to regex:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('keeps safe defaults when both form parsers receive incomplete HTML', async () => {
    vi.mocked(cheerio.load).mockImplementationOnce(() => {
      throw new Error('parser unavailable');
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const feature = createFeature();
    const context = { render: vi.fn() };

    await feature.userCodeInputSource(
      context as never,
      '<form><input></form>',
      {},
      undefined
    );

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/device-flow-code-input',
      expect.objectContaining({
        formId: 'op.deviceInputForm',
        formAction: '',
        formMethod: 'post',
        xsrfToken: '',
      })
    );
    consoleError.mockRestore();
  });

  it.each([
    [
      { userCode: 'BAD-CODE' },
      'The code you entered is incorrect. Please try again.',
      null,
      'BAD-CODE',
    ],
    [
      { name: 'NoCodeError' },
      'The code you entered is incorrect. Please try again.',
      null,
      '',
    ],
    [
      { name: 'AbortedError' },
      null,
      'The sign-in request was interrupted.',
      '',
    ],
    [
      { name: 'UnexpectedError' },
      'There was an error processing your request. Please try again.',
      null,
      '',
    ],
  ])(
    'renders the device-code error state for %s',
    async (failure, expectedError, expectedWarning, expectedUserCode) => {
      const feature = createFeature();
      const context = { render: vi.fn() };

      await feature.userCodeInputSource(
        context as never,
        '<form></form>',
        {},
        failure
      );

      expect(context.render).toHaveBeenCalledWith(
        'auth/oidc/device-flow-code-input',
        expect.objectContaining({
          error: expectedError,
          warning: expectedWarning,
          userCode: expectedUserCode,
        })
      );
    }
  );

  it('renders the confirmation details and safely formats device timestamps', async () => {
    const feature = createFeature();
    const context = { render: vi.fn() };
    const deviceInfo = { timestamp: '2026-08-05T12:00:00.000Z' };

    await feature.userCodeConfirmSource(
      context as never,
      '<form></form>',
      { clientName: 'Example RP' } as never,
      deviceInfo,
      'ABCD-EFGH'
    );

    const viewData = context.render.mock.calls[0][1];
    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/device-flow-confirm-code',
      expect.objectContaining({
        form: '<form></form>',
        clientName: 'Example RP',
        deviceInfo,
        userCode: 'ABCD-EFGH',
        locale: 'en',
        title: 'Confirm Device',
      })
    );
    expect(viewData.formatTime(deviceInfo.timestamp)).not.toBe('Unknown');
    expect(viewData.formatTime('not-a-date')).toBe('Unknown');
    expect(viewData.formatTime(Symbol('invalid') as never)).toBe('Unknown');
  });
});
