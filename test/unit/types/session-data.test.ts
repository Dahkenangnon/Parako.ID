import type { SessionData as ExpressSessionData } from 'express-session';
import { describe, expect, it } from 'vitest';

import type {
  SessionData as ParakoSessionData,
  SessionMetadata,
} from '../../../src/types/session-data.js';

type ExpressParakoFields = Pick<ExpressSessionData, keyof ParakoSessionData>;
type ContractsMatch = ParakoSessionData extends ExpressParakoFields
  ? ExpressParakoFields extends ParakoSessionData
    ? true
    : false
  : false;

const contractsMatch: ContractsMatch = true;

describe('session data contract', () => {
  it('keeps the Express augmentation aligned with the framework-neutral contract', () => {
    expect(contractsMatch).toBe(true);
  });

  it('round-trips every canonical session field through JSON serialization', () => {
    const metadata: SessionMetadata = {
      created_at: '2026-08-16T00:00:00.000Z',
      createdFrom: 'login',
      createdIp: '192.0.2.10',
      userAgent: 'test-agent',
      browser: { name: 'Browser', version: '1' },
      os: { name: 'OS', version: '1' },
      device: { type: 'desktop', vendor: 'Vendor', model: 'Model' },
    };
    const session = {
      authenticatedUsers: {
        active: {
          id: 'user-1',
          username: 'alice',
          email: 'alice@example.test',
          email_verified: true,
          phone_number: '+15555550100',
          phone_number_verified: true,
          given_name: 'Alice',
          family_name: 'Example',
          full_name: 'Alice Example',
          picture: 'https://example.test/alice.png',
          roles: ['user'],
          is_admin: false,
          last_used: 1,
          zoneinfo: 'UTC',
          locale: 'en',
        },
        others: [],
      },
      isAuthenticated: true,
      accountId: 'alice',
      authTime: 1,
      lastActivity: 2,
      created: 3,
      createdFrom: 'login',
      ipAddress: '192.0.2.10',
      userAgent: 'test-agent',
      deviceId: 'device-1',
      csrfToken: 'csrf-token',
      flash: {
        success: [
          {
            type: 'success',
            message: 'Saved',
            title: 'Success',
            dismissible: true,
            timeout: 1000,
          },
        ],
        error: [],
        info: [],
        warning: [],
      },
      _metadata: metadata,
      user: { email: 'alice@example.test' },
    } satisfies ParakoSessionData;

    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
});
