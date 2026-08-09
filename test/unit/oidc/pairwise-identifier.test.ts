import { describe, expect, it, vi } from 'vitest';

import PairwiseIdentifier from '../../../src/oidc/specs/pairwise-identifier.js';

function createIdentifier() {
  const logger = { error: vi.fn(), warn: vi.fn() };
  const identifier = PairwiseIdentifier(
    {
      getConfig: () => ({
        oidc: { secrets: { pairwise_salt: 'test-pairwise-salt' } },
      }),
    } as never,
    logger as never
  );

  return { identifier, logger };
}

describe('OIDC pairwise subject identifier', () => {
  it('returns a stable SHA-256 identifier for the same account and sector', async () => {
    const { identifier, logger } = createIdentifier();
    const client = { sectorIdentifier: 'https://rp.example' };

    const first = await identifier({} as never, 'account-123', client as never);
    const second = await identifier(
      {} as never,
      'account-123',
      client as never
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('isolates the same account between client sectors', async () => {
    const { identifier } = createIdentifier();

    const first = await identifier({} as never, 'account-123', {
      sectorIdentifier: 'https://first-rp.example',
    } as never);
    const second = await identifier({} as never, 'account-123', {
      sectorIdentifier: 'https://second-rp.example',
    } as never);

    expect(second).not.toBe(first);
  });

  it('isolates different accounts within one client sector', async () => {
    const { identifier } = createIdentifier();
    const client = { sectorIdentifier: 'https://rp.example' };

    const first = await identifier({} as never, 'account-123', client as never);
    const second = await identifier(
      {} as never,
      'account-456',
      client as never
    );

    expect(second).not.toBe(first);
  });

  it.each([
    ['', { sectorIdentifier: 'https://rp.example' }, 'Invalid accountId'],
    [42, { sectorIdentifier: 'https://rp.example' }, 'Invalid accountId'],
    ['account-123', null, 'Invalid client'],
    ['account-123', {}, 'Invalid client'],
  ])(
    'logs invalid input and returns a deterministic fallback',
    async (accountId, client, errorMessage) => {
      const { identifier, logger } = createIdentifier();

      const first = await identifier(
        {} as never,
        accountId as never,
        client as never
      );
      const second = await identifier(
        {} as never,
        accountId as never,
        client as never
      );

      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(second).toBe(first);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: expect.stringContaining(errorMessage),
      });
    }
  );

  it('bounds its memoization cache and reports capacity pressure', async () => {
    const { identifier, logger } = createIdentifier();
    const client = { sectorIdentifier: 'https://rp.example' };

    await Promise.all(
      Array.from({ length: 1_001 }, (_, index) =>
        identifier({} as never, `account-${index}`, client as never)
      )
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Pairwise identifier memoization cache reached capacity'
    );
  });
});
