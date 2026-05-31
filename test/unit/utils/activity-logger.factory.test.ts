import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';

import { activityLoggerFor } from '../../../src/utils/activity-logger.factory.js';
import type {
  IActivityService,
  ActivityOptions,
} from '../../../src/di/interfaces/activity-service.interface.js';
import type { IClientDeviceInfoManager } from '../../../src/di/interfaces/client-device-info-manager.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';

interface MockActivity {
  type: string;
  description: string;
  user: unknown;
  options: ActivityOptions;
  level: 'success' | 'failed' | 'info' | 'warning';
}

function makeActivityService(): {
  service: IActivityService;
  records: MockActivity[];
} {
  const records: MockActivity[] = [];
  const push =
    (level: MockActivity['level']) =>
    (
      type: string,
      description: string,
      user: unknown,
      options: ActivityOptions = {}
    ) =>
      records.push({ type, description, user, options, level });

  const service = {
    success: vi.fn(push('success')),
    failed: vi.fn(push('failed')),
    info: vi.fn(push('info')),
    warning: vi.fn(push('warning')),
  } as unknown as IActivityService;

  return { service, records };
}

const deviceInfo = {
  username: 'alice',
  ip: '192.0.2.1',
  user_agent: 'Mozilla/5.0',
  browser: { name: 'Firefox', version: '120' },
  os: { name: 'Linux', version: '6' },
  device: { type: 'desktop' },
  language: 'en',
  timezone_guess: 'UTC',
  fingerprint: 'fp-1',
};

function makeDeps(activeUser?: {
  id?: string;
  username?: string;
  email?: string;
}) {
  const { service, records } = makeActivityService();
  const deps = {
    activityService: service,
    sessionManager: {
      getActiveUser: vi.fn().mockReturnValue(activeUser),
    } as unknown as Pick<ISessionManager, 'getActiveUser'>,
    clientDeviceInfoManager: {
      getClientInfoFromRequest: vi.fn().mockReturnValue(deviceInfo),
    } as unknown as Pick<IClientDeviceInfoManager, 'getClientInfoFromRequest'>,
  };
  return { deps, records };
}

function makeReq(extra: Partial<Request> = {}): Request {
  return { ...extra } as Request;
}

describe('activityLoggerFor', () => {
  it('injects ip_address, user_agent, device_infos, and resolved actor', () => {
    const { deps, records } = makeDeps({
      id: 'u1',
      username: 'alice',
      email: 'a@x',
    });
    const log = activityLoggerFor(deps, makeReq(), {
      defaultActorType: 'admin',
    });

    log.success('user_disabled', { id: 'u2' }, 'Disabled user');

    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('success');
    expect(records[0].options.ip_address).toBe('192.0.2.1');
    expect(records[0].options.user_agent).toBe('Mozilla/5.0');
    expect(records[0].options.device_infos).toBe(deviceInfo);
    expect(records[0].options.actor).toMatchObject({
      id: 'u1',
      username: 'alice',
      email: 'a@x',
      actor_type: 'admin',
    });
  });

  it('attaches requestId from req when present', () => {
    const { deps, records } = makeDeps({ id: 'u1', username: 'alice' });
    const log = activityLoggerFor(
      deps,
      makeReq({
        requestId: 'req-42',
      } as Partial<Request>)
    );

    log.info('something_happened', null, 'note');

    expect(records[0].options.metadata).toMatchObject({ requestId: 'req-42' });
  });

  it('falls back to anonymous actor when no session user exists', () => {
    const { deps, records } = makeDeps(undefined);
    const log = activityLoggerFor(deps, makeReq());

    log.failed('login_failed', null, 'bad creds');

    expect(records[0].options.actor).toEqual({ actor_type: 'anonymous' });
  });

  it('caller-supplied actor wins over the session-derived actor', () => {
    const { deps, records } = makeDeps({ username: 'browser-user' });
    const log = activityLoggerFor(deps, makeReq(), {
      defaultActorType: 'user',
    });

    log.success('oidc_login', null, 'logged in', {
      actor: {
        id: 'oidc-account-id',
        username: 'end-user',
        actor_type: 'user',
      },
    });

    expect(records[0].options.actor).toEqual({
      id: 'oidc-account-id',
      username: 'end-user',
      actor_type: 'user',
    });
  });

  it('caller-supplied ip_address / user_agent / device_infos win', () => {
    const { deps, records } = makeDeps();
    const log = activityLoggerFor(deps, makeReq());

    log.success('proxied', null, '', {
      ip_address: '203.0.113.7',
      user_agent: 'CustomUA',
      device_infos: { fingerprint: 'caller-fp' },
    });

    expect(records[0].options.ip_address).toBe('203.0.113.7');
    expect(records[0].options.user_agent).toBe('CustomUA');
    expect(records[0].options.device_infos).toEqual({
      fingerprint: 'caller-fp',
    });
  });

  it('preserves caller-supplied target, client_id, related_activity_id and metadata', () => {
    const { deps, records } = makeDeps();
    const log = activityLoggerFor(
      deps,
      makeReq({
        requestId: 'req-9',
      } as Partial<Request>)
    );

    log.success('consent_granted', { id: 'acct-1' }, 'Consent granted', {
      client_id: 'rp-1',
      related_activity_id: 'parent-1',
      target: {
        target_type: 'client',
        entity_id: 'rp-1',
        entity_name: 'RP One',
      },
      metadata: { interaction_uid: 'uid-1', grantId: 'g-1' },
    });

    expect(records[0].options.client_id).toBe('rp-1');
    expect(records[0].options.related_activity_id).toBe('parent-1');
    expect(records[0].options.target).toEqual({
      target_type: 'client',
      entity_id: 'rp-1',
      entity_name: 'RP One',
    });
    expect(records[0].options.metadata).toEqual({
      interaction_uid: 'uid-1',
      grantId: 'g-1',
      requestId: 'req-9',
    });
  });

  it('caller-supplied metadata.requestId is not overwritten', () => {
    const { deps, records } = makeDeps();
    const log = activityLoggerFor(
      deps,
      makeReq({
        requestId: 'auto-req',
      } as Partial<Request>)
    );

    log.success('x', null, '', { metadata: { requestId: 'caller-req' } });

    expect(records[0].options.metadata).toEqual({ requestId: 'caller-req' });
  });

  it('all four severity levels dispatch to the matching service method', () => {
    const { deps, records } = makeDeps();
    const log = activityLoggerFor(deps, makeReq());

    log.success('a', null);
    log.failed('b', null);
    log.info('c', null);
    log.warning('d', null);

    expect(records.map(r => r.level)).toEqual([
      'success',
      'failed',
      'info',
      'warning',
    ]);
  });
});
