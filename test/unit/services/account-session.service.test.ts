import { describe, expect, it, vi } from 'vitest';

import { AccountSessionService } from '../../../src/services/account-session.service.js';

function createHarness() {
  const dependencies = {
    findExpressSessionsForUser: vi
      .fn()
      .mockResolvedValue([
        { _id: 'current' },
        { _id: 'other-1' },
        { _id: '' },
        null,
        { _id: 'other-2' },
      ]),
    revokeExpressSession: vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
    warn: vi.fn(),
  };
  return {
    dependencies,
    service: new AccountSessionService(dependencies),
  };
}

describe('AccountSessionService', () => {
  it('revokes owned Express sessions except the current session', async () => {
    const { dependencies, service } = createHarness();

    await expect(
      service.revokeOtherExpressSessions('alice', 'current')
    ).resolves.toBe(1);
    expect(dependencies.findExpressSessionsForUser).toHaveBeenCalledWith(
      'alice'
    );
    expect(dependencies.revokeExpressSession.mock.calls).toEqual([
      ['other-1'],
      ['other-2'],
    ]);
    expect(dependencies.warn).toHaveBeenCalledTimes(2);
  });

  it('revokes every valid session when no current ID is available', async () => {
    const { dependencies, service } = createHarness();
    dependencies.findExpressSessionsForUser.mockResolvedValue([
      { _id: 'session-1' },
      { _id: 'session-2' },
    ]);
    dependencies.revokeExpressSession.mockReset();
    dependencies.revokeExpressSession.mockResolvedValue(true);

    await expect(
      service.revokeOtherExpressSessions('alice', undefined)
    ).resolves.toBe(2);
  });

  it('does not hide session-store failures', async () => {
    const { dependencies, service } = createHarness();
    const failure = new Error('session store unavailable');
    dependencies.findExpressSessionsForUser.mockRejectedValue(failure);

    await expect(
      service.revokeOtherExpressSessions('alice', 'current')
    ).rejects.toBe(failure);
  });
});
