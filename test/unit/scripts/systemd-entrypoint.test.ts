import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  isMain: false,
  parse: vi.fn(),
  parseAsync: vi.fn(),
  setupCommands: vi.fn(),
}));

vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => dependencies.isMain,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  getPackageInfo: () => ({ version: '1.2.3' }),
}));
vi.mock('../../../scripts/manage/systemd/commands.js', () => ({
  setupCommands: dependencies.setupCommands,
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

    parse(argv?: readonly string[]): void {
      dependencies.parse(argv);
    }

    parseAsync(argv?: readonly string[]): Promise<void> {
      return dependencies.parseAsync(argv);
    }
  },
}));

import {
  buildProgram,
  runSystemdCli,
  runSystemdEntrypoint,
} from '../../../scripts/manage/systemd.js';

describe('systemd CLI entrypoint', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    dependencies.isMain = false;
    dependencies.parse.mockReset();
    dependencies.parseAsync.mockReset();
    dependencies.parseAsync.mockResolvedValue(undefined);
    dependencies.setupCommands.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('is import-safe when loaded as a module', async () => {
    await import('../../../scripts/manage/systemd.js');

    expect(dependencies.parse).not.toHaveBeenCalled();
    expect(dependencies.parseAsync).not.toHaveBeenCalled();
  });

  it('builds the configured program and parses the supplied argv asynchronously', async () => {
    const argv = ['node', 'systemd', 'status'];

    const program = buildProgram();
    expect(dependencies.setupCommands).toHaveBeenCalledWith(program);

    await runSystemdCli(argv);
    expect(dependencies.parseAsync).toHaveBeenCalledWith(argv);
  });

  it('reports Error failures and marks the process unsuccessful', async () => {
    dependencies.parseAsync.mockRejectedValue(new Error('restart failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runSystemdEntrypoint();
    expect(consoleError).toHaveBeenCalledWith(
      'Systemd command failed: restart failed'
    );

    expect(dependencies.parseAsync).toHaveBeenCalledWith(process.argv);
    expect(process.exitCode).toBe(1);
  });

  it('formats non-Error failures safely', async () => {
    dependencies.parseAsync.mockRejectedValue('unavailable');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runSystemdEntrypoint();
    expect(consoleError).toHaveBeenCalledWith(
      'Systemd command failed: unavailable'
    );
  });

  it('runs automatically when evaluated as the process entrypoint', async () => {
    dependencies.isMain = true;
    vi.resetModules();

    // This import intentionally verifies the ESM entrypoint side effect.
    await import('../../../scripts/manage/systemd.js');

    await vi.waitFor(() =>
      expect(dependencies.parseAsync).toHaveBeenCalledWith(process.argv)
    );
  });
});
