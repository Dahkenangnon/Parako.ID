import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  addClientInteractive: vi.fn().mockResolvedValue(undefined),
  isMainModule: vi.fn(() => false),
  listCommand: vi.fn().mockResolvedValue(undefined),
  setupCommands: vi.fn(),
  showSubcommandHelp: vi.fn(),
}));

vi.mock('../../../scripts/manage/client/index.js', () => ({
  addClientInteractive: dependencies.addClientInteractive,
  setupCommands: dependencies.setupCommands,
}));
vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: dependencies.isMainModule,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  getPackageInfo: () => ({ version: '1.2.3' }),
  showSubcommandHelp: dependencies.showSubcommandHelp,
}));

import {
  buildClientProgram,
  runClientCli,
} from '../../../scripts/manage/client.js';

describe('OIDC client CLI module lifecycle', () => {
  beforeEach(() => {
    dependencies.isMainModule.mockReturnValue(false);
    dependencies.setupCommands.mockImplementation((program: Command) => {
      program.command('list').action(dependencies.listCommand);
      program.command('show <id>').action(() => undefined);
      program.command('fail <kind>').action((kind: string) => {
        if (kind === 'primitive') throw 'primitive failure';
        if (kind === 'fallback') throw {};
        throw { code: kind, message: `${kind} failure` };
      });
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('can be imported without executing commands or installing process handlers', async () => {
    const processOn = vi.spyOn(process, 'on');
    const originalArgv = process.argv;
    process.argv = ['node', 'client'];

    try {
      await import('../../../scripts/manage/client.js');
      await Promise.resolve();
    } finally {
      process.argv = originalArgv;
    }

    expect(dependencies.addClientInteractive).not.toHaveBeenCalled();
    expect(processOn).not.toHaveBeenCalled();
  });

  it('builds a versioned program whose extended help names only supported commands', () => {
    const program = buildClientProgram();

    expect(program.name()).toBe('client');
    expect(program.version()).toBe('1.2.3');
    expect(program.commands.map(command => command.name())).toEqual([
      'list',
      'show',
      'fail',
    ]);

    (program as unknown as { emit(event: string): void }).emit('--help');
    expect(dependencies.showSubcommandHelp).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '1.2.3',
        quickStart: expect.arrayContaining([
          expect.objectContaining({ command: 'pnpm client add' }),
          expect.objectContaining({ command: 'pnpm client list' }),
        ]),
        examples: [
          expect.objectContaining({ command: 'pnpm client add' }),
          expect.objectContaining({ command: 'pnpm client list' }),
        ],
      })
    );
  });

  it('runs interactive creation only when no subcommand was provided', async () => {
    await runClientCli(['node', 'client']);

    expect(dependencies.addClientInteractive).toHaveBeenCalledOnce();
    expect(dependencies.setupCommands).not.toHaveBeenCalled();
  });

  it('dispatches supported subcommands asynchronously', async () => {
    await runClientCli(['node', 'client', 'list']);

    expect(dependencies.listCommand).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it.each(['commander.helpDisplayed', 'commander.help', 'commander.version'])(
    'treats %s as a successful terminal outcome',
    async code => {
      await runClientCli(['node', 'client', 'fail', code]);

      expect(process.exitCode).toBeUndefined();
    }
  );

  it('reports unknown commands with a help hint', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});

    await runClientCli(['node', 'client', 'unknown']);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown command')
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      'Run with --help to see available commands'
    );
    expect(process.exitCode).toBe(1);
  });

  it('reports missing required arguments with a usage hint', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});

    await runClientCli(['node', 'client', 'show']);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Missing argument')
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      'Run with --help to see command usage'
    );
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['object errors without messages', 'fallback', 'Unknown error'],
    ['primitive failures', 'primitive', 'primitive failure'],
  ])(
    'reports %s through the generic CLI boundary',
    async (_name, kind, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await runClientCli(['node', 'client', 'fail', kind]);

      expect(consoleError).toHaveBeenCalledWith(`CLI error: ${message}`);
      expect(process.exitCode).toBe(1);
    }
  );

  it('executes through the explicit runner with the process argument vector', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'client'];

    try {
      await runClientCli();
      expect(dependencies.addClientInteractive).toHaveBeenCalledOnce();
    } finally {
      process.argv = originalArgv;
    }
  });
});
