import { beforeEach, describe, expect, it, vi } from 'vitest';

const postgresql = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = postgresql.connect;
    end = postgresql.end;
    query = postgresql.query;
  },
}));

import {
  MongoFixtureStore,
  PostgresqlFixtureStore,
} from '../../../e2e/support/fixture-store.mjs';

describe('MongoFixtureStore activity availability controls', () => {
  it('recovers when a queued audit write recreates activities before the failing view is installed', async () => {
    const namespaceExists = Object.assign(new Error('namespace exists'), {
      code: 48,
    });
    const rename = vi.fn().mockResolvedValue(undefined);
    const drop = vi.fn().mockResolvedValue(true);
    const createCollection = vi
      .fn()
      .mockRejectedValueOnce(namespaceExists)
      .mockResolvedValueOnce(undefined);
    const database = {
      collection: vi.fn(() => ({ drop, rename })),
      createCollection,
      listCollections: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([{ name: 'activities' }]),
      })),
    };
    const store = new MongoFixtureStore(database, 'default');

    await expect(store.setActivityStorageAvailability(false)).resolves.toBe(
      true
    );

    expect(rename).toHaveBeenCalledWith('activities_unavailable');
    expect(drop).toHaveBeenCalledOnce();
    expect(createCollection).toHaveBeenCalledTimes(2);
  });
});

describe('PostgresqlFixtureStore expiry controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postgresql.connect.mockResolvedValue(undefined);
    postgresql.end.mockResolvedValue(undefined);
    postgresql.query.mockResolvedValue({ rowCount: 1 });
  });

  it.each([
    [
      'identity token',
      () => store.expireIdentityToken(email, 'password-reset'),
    ],
    ['email MFA code', () => store.expireMfaEmailCode(email)],
    ['SMS recovery code', () => store.expireRecoverySmsCode(email)],
  ])('expires a %s using the database clock', async (_label, expire) => {
    await expect(expire()).resolves.toBe(true);

    const updateCall = postgresql.query.mock.calls.find(([statement]) =>
      String(statement).includes('UPDATE')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toContain("CURRENT_TIMESTAMP - INTERVAL '1 day'");
    expect(updateCall?.[1]).toEqual([email, 'default']);
  });

  it('expires an application session through a tenant-scoped delete', async () => {
    await expect(
      store.expireApplicationSession('session-fixture-id')
    ).resolves.toBe(true);

    const deleteCall = postgresql.query.mock.calls.find(([statement]) =>
      String(statement).includes('DELETE FROM sessions')
    );
    expect(deleteCall).toEqual([
      expect.stringContaining('tenant_id = $2'),
      ['session-fixture-id', 'default'],
    ]);
  });
});

const email = 'expiry-control@example.test';
const store = new PostgresqlFixtureStore(
  'postgresql://fixture:fixture@127.0.0.1/parako_e2e' // gitleaks:allow -- non-routable unit-test fixture
);
