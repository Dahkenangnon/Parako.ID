import { describe, expect, it, vi } from 'vitest';

const runKeysCli = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../scripts/manage/keys/commands.js', () => ({ runKeysCli }));

describe('JWKS CLI executable entrypoint', () => {
  it('delegates execution to the explicit CLI runner', async () => {
    await import('../../../scripts/manage/keys.js');

    expect(runKeysCli).toHaveBeenCalledOnce();
    expect(runKeysCli).toHaveBeenCalledWith();
  });
});
