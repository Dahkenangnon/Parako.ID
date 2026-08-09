import { afterEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  action: undefined as (() => unknown) | undefined,
  generateKeys: vi.fn(),
  generateKeysInteractive: vi.fn(),
  parseAsync: vi.fn(),
}));

vi.mock('../../../scripts/manage/keys/index.js', () => ({
  generateKeys: dependencies.generateKeys,
  generateKeysInteractive: dependencies.generateKeysInteractive,
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

    alias(): this {
      return this;
    }

    action(callback: () => unknown): this {
      dependencies.action = callback;
      return this;
    }

    parseAsync(argv: string[]): Promise<void> {
      return dependencies.parseAsync(argv);
    }
  },
}));

describe('JWKS command module', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    dependencies.action = undefined;
    process.exitCode = originalExitCode;
  });

  it('is safe to import without executing commands or installing process handlers', async () => {
    const processOn = vi.spyOn(process, 'on');

    await import('../../../scripts/manage/keys/commands.js');

    expect(processOn).not.toHaveBeenCalled();
    expect(dependencies.parseAsync).not.toHaveBeenCalled();
    expect(dependencies.generateKeys).not.toHaveBeenCalled();
    expect(dependencies.generateKeysInteractive).not.toHaveBeenCalled();
  });

  it('registers generate and delegates it to the key generator', async () => {
    const { buildKeysProgram } =
      await import('../../../scripts/manage/keys/commands.js');

    buildKeysProgram();
    await dependencies.action?.();

    expect(dependencies.generateKeys).toHaveBeenCalledWith(true);
  });

  it('runs interactive generation when no subcommand is provided', async () => {
    const { runKeysCli } =
      await import('../../../scripts/manage/keys/commands.js');

    await runKeysCli(['node', 'keys']);

    expect(dependencies.generateKeysInteractive).toHaveBeenCalledOnce();
    expect(dependencies.parseAsync).not.toHaveBeenCalled();
  });

  it('parses an explicit subcommand asynchronously', async () => {
    const { runKeysCli } =
      await import('../../../scripts/manage/keys/commands.js');
    const argv = ['node', 'keys', 'generate'];
    dependencies.parseAsync.mockResolvedValue(undefined);

    await runKeysCli(argv);

    expect(dependencies.parseAsync).toHaveBeenCalledWith(argv);
  });

  it.each([
    [
      { code: 'commander.unknownCommand', message: 'unknown foo' },
      'Unknown command: unknown foo',
      'Run with --help to see available commands',
    ],
    [
      { code: 'commander.missingArgument', message: 'missing value' },
      'Missing argument: missing value',
      'Run with --help to see command usage',
    ],
    [
      new Error('generation failed'),
      'Failed to generate keys: generation failed',
    ],
    ['unavailable', 'Failed to generate keys: unavailable'],
    [{}, 'Failed to generate keys: Unknown error'],
  ])(
    'reports command failure %# without terminating abruptly',
    async (...args) => {
      const [failure, expectedError, expectedHelp] = args as [
        unknown,
        string,
        string | undefined,
      ];
      const { runKeysCli } =
        await import('../../../scripts/manage/keys/commands.js');
      dependencies.parseAsync.mockRejectedValue(failure);
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = undefined;

      await runKeysCli(['node', 'keys', 'generate']);

      expect(consoleError.mock.calls.flat().join('\n')).toContain(
        expectedError
      );
      if (expectedHelp) {
        expect(consoleLog.mock.calls.flat().join('\n')).toContain(expectedHelp);
      } else {
        expect(consoleLog).not.toHaveBeenCalled();
      }
      expect(process.exitCode).toBe(1);
    }
  );
});
