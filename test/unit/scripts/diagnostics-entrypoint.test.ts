import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entrypoint = vi.hoisted(() => ({
  parseAsync: vi.fn(),
}));

vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => false,
}));

import { runDiagnosticsCli } from '../../../scripts/manage/diagnostics.js';
vi.mock('../../../scripts/manage/database.js', () => ({
  findProjectRoot: vi.fn(),
  loadRuntimeEnvironment: vi.fn(),
}));
vi.mock('../../../src/jobs/redis.js', () => ({
  checkRedisAvailability: vi.fn(),
}));
vi.mock('commander', () => ({
  Command: class {
    name(): this {
      return this;
    }

    description(): this {
      return this;
    }

    version(): this {
      return this;
    }

    command(): this {
      return this;
    }

    action(): this {
      return this;
    }

    parseAsync(argv: string[]): Promise<void> {
      return entrypoint.parseAsync(argv);
    }
  },
}));

describe('diagnostics CLI process entrypoint', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    entrypoint.parseAsync.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('reports command errors and marks the process unsuccessful', async () => {
    entrypoint.parseAsync.mockRejectedValue(new Error('Redis failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runDiagnosticsCli();
    expect(consoleError).toHaveBeenCalledWith(
      'Diagnostic failed: Redis failed'
    );

    expect(entrypoint.parseAsync).toHaveBeenCalledWith(process.argv);
    expect(process.exitCode).toBe(1);
  });

  it('formats non-Error command failures safely', async () => {
    entrypoint.parseAsync.mockRejectedValue('unavailable');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runDiagnosticsCli();
    expect(consoleError).toHaveBeenCalledWith('Diagnostic failed: unavailable');
  });
});
