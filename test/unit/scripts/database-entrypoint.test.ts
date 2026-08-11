import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entrypoint = vi.hoisted(() => ({
  isMain: false,
  parseAsync: vi.fn(),
}));

vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => entrypoint.isMain,
}));

import { runDatabaseCli } from '../../../scripts/manage/database.js';
vi.mock('mongodb', () => ({ MongoClient: vi.fn() }));
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

    option(): this {
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

describe('database CLI process entrypoint', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    entrypoint.isMain = false;
    entrypoint.parseAsync.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('reports Error failures and sets an unsuccessful exit code', async () => {
    entrypoint.parseAsync.mockRejectedValue(new Error('migration failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runDatabaseCli();
    expect(consoleError).toHaveBeenCalledWith(
      'Database command failed: migration failed'
    );

    expect(entrypoint.parseAsync).toHaveBeenCalledWith(process.argv);
    expect(process.exitCode).toBe(1);
  });

  it('formats non-Error failures safely', async () => {
    entrypoint.parseAsync.mockRejectedValue('unavailable');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runDatabaseCli();
    expect(consoleError).toHaveBeenCalledWith(
      'Database command failed: unavailable'
    );
  });

  it('runs automatically when evaluated as the process entrypoint', async () => {
    entrypoint.isMain = true;
    vi.resetModules();

    // This import intentionally verifies the ESM entrypoint side effect.
    await import('../../../scripts/manage/database.js');

    await vi.waitFor(() => expect(entrypoint.parseAsync).toHaveBeenCalled());
  });
});
