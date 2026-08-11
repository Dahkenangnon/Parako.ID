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

import { PostgresqlFixtureStore } from '../../../e2e/support/fixture-store.mjs';

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
});

const email = 'expiry-control@example.test';
const store = new PostgresqlFixtureStore(
  'postgresql://fixture:fixture@127.0.0.1/parako_e2e' // gitleaks:allow -- non-routable unit-test fixture
);
