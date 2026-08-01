import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

import ClientDeviceInfoManager from '../../../src/utils/client-info.js';

function createManager() {
  const sessionManager = {
    get: vi.fn().mockReturnValue('csrf-token'),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return new ClientDeviceInfoManager(
    sessionManager as never,
    logger as never,
    {} as never
  );
}

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
});
