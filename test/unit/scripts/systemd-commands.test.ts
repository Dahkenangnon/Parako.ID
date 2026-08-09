import process from 'node:process';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemdConfig } from '../../../scripts/manage/systemd/types.js';

const dependencies = vi.hoisted(() => ({
  existsSync: vi.fn(),
  generateUnitFiles: vi.fn(),
  installServices: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    title: vi.fn(),
  },
  mkdirSync: vi.fn(),
  resolveConfig: vi.fn(),
  restartServices: vi.fn(),
  showLogs: vi.fn(),
  showStatus: vi.fn(),
  showSubcommandHelp: vi.fn(),
  uninstallServices: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: dependencies.existsSync,
      mkdirSync: dependencies.mkdirSync,
      writeFileSync: dependencies.writeFileSync,
    },
  };
});
vi.mock('../../../scripts/manage/shared/logger.js', () => ({
  log: dependencies.log,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  getPackageInfo: () => ({ version: '1.2.3' }),
  showSubcommandHelp: dependencies.showSubcommandHelp,
}));
vi.mock('../../../scripts/manage/systemd/generate.js', () => ({
  generateUnitFiles: dependencies.generateUnitFiles,
  resolveConfig: dependencies.resolveConfig,
}));
vi.mock('../../../scripts/manage/systemd/install.js', () => ({
  installServices: dependencies.installServices,
}));
vi.mock('../../../scripts/manage/systemd/logs.js', () => ({
  showLogs: dependencies.showLogs,
}));
vi.mock('../../../scripts/manage/systemd/restart.js', () => ({
  restartServices: dependencies.restartServices,
}));
vi.mock('../../../scripts/manage/systemd/status.js', () => ({
  showStatus: dependencies.showStatus,
}));
vi.mock('../../../scripts/manage/systemd/uninstall.js', () => ({
  uninstallServices: dependencies.uninstallServices,
}));

import { setupCommands } from '../../../scripts/manage/systemd/commands.js';

const config: SystemdConfig = {
  envFile: '/srv/parako/runtime/.env',
  nodePath: '/usr/bin/node',
  runtimeDirectory: '/srv/parako/runtime',
  serviceName: 'parako-id',
  user: 'parako',
  workingDirectory: '/srv/parako',
};

function buildProgram(): Command {
  const program = new Command();
  program.name('systemd');
  setupCommands(program);
  return program;
}

describe('systemd command dispatch', () => {
  beforeEach(() => {
    dependencies.existsSync.mockReturnValue(true);
    dependencies.resolveConfig.mockResolvedValue(config);
    dependencies.generateUnitFiles.mockReturnValue({
      app: 'app unit',
      worker: 'worker unit',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('refuses output overwrite without force and writes nothing', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(
      buildProgram().parseAsync(['generate', '--output', '/tmp/units'], {
        from: 'user',
      })
    ).rejects.toThrow('Refusing to overwrite');
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('shows the enhanced help profile when no subcommand is supplied', async () => {
    await buildProgram().parseAsync([], { from: 'user' });

    expect(dependencies.showSubcommandHelp).toHaveBeenCalledOnce();
    expect(dependencies.showSubcommandHelp.mock.calls[0]?.[0]).toMatchObject({
      name: 'SYSTEMD SERVICE MANAGER',
      version: '1.2.3',
    });
  });

  it('appends the enhanced help profile to Commander help output', () => {
    (buildProgram() as unknown as { emit(event: string): void }).emit('--help');

    expect(dependencies.showSubcommandHelp).toHaveBeenCalledOnce();
  });

  it('prints both generated units when no output directory is supplied', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await buildProgram().parseAsync(['generate'], { from: 'user' });

    expect(dependencies.resolveConfig).toHaveBeenCalledWith({});
    expect(dependencies.generateUnitFiles).toHaveBeenCalledWith(config);
    expect(dependencies.log.title.mock.calls).toEqual([
      ['parako-id.service'],
      ['parako-id-worker.service'],
    ]);
    expect(consoleLog.mock.calls).toEqual([['app unit'], ['worker unit']]);
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates a missing output directory and writes both units', async () => {
    dependencies.existsSync.mockReturnValue(false);

    await buildProgram().parseAsync(
      ['generate', '--output', '/tmp/parako-units'],
      { from: 'user' }
    );

    expect(dependencies.mkdirSync).toHaveBeenCalledWith('/tmp/parako-units', {
      recursive: true,
    });
    expect(dependencies.writeFileSync.mock.calls).toEqual([
      ['/tmp/parako-units/parako-id.service', 'app unit', 'utf-8'],
      ['/tmp/parako-units/parako-id-worker.service', 'worker unit', 'utf-8'],
    ]);
  });

  it('overwrites existing output units only with force', async () => {
    await buildProgram().parseAsync(
      ['generate', '--output', '/tmp/parako-units', '--force'],
      { from: 'user' }
    );

    expect(dependencies.mkdirSync).not.toHaveBeenCalled();
    expect(dependencies.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it.each([
    { args: ['install'], expectedOptions: {}, force: false },
    {
      args: ['install', '--force'],
      expectedOptions: { force: true },
      force: true,
    },
  ])(
    'dispatches install with force=$force',
    async ({ args, expectedOptions, force }) => {
      await buildProgram().parseAsync(args, { from: 'user' });

      expect(dependencies.resolveConfig).toHaveBeenCalledWith(expectedOptions);
      expect(dependencies.installServices).toHaveBeenCalledWith(
        { app: 'app unit', worker: 'worker unit' },
        'parako-id',
        config,
        { force }
      );
    }
  );

  it('dispatches service operations with the default name', async () => {
    await buildProgram().parseAsync(['uninstall'], { from: 'user' });
    await buildProgram().parseAsync(['status'], { from: 'user' });
    await buildProgram().parseAsync(['restart'], { from: 'user' });

    expect(dependencies.uninstallServices).toHaveBeenCalledWith('parako-id');
    expect(dependencies.showStatus).toHaveBeenCalledWith('parako-id');
    expect(dependencies.restartServices).toHaveBeenCalledWith('parako-id');
  });

  it('dispatches service operations with an explicit valid name', async () => {
    await buildProgram().parseAsync(['uninstall', '--name', 'custom-id'], {
      from: 'user',
    });
    await buildProgram().parseAsync(['status', '--name', 'custom-id'], {
      from: 'user',
    });
    await buildProgram().parseAsync(['restart', '--name', 'custom-id'], {
      from: 'user',
    });

    expect(dependencies.uninstallServices).toHaveBeenCalledWith('custom-id');
    expect(dependencies.showStatus).toHaveBeenCalledWith('custom-id');
    expect(dependencies.restartServices).toHaveBeenCalledWith('custom-id');
  });

  it('follows both default service logs by default', async () => {
    await buildProgram().parseAsync(['logs'], { from: 'user' });

    expect(dependencies.showLogs).toHaveBeenCalledWith('parako-id', {
      follow: true,
      since: undefined,
      worker: false,
    });
  });

  it('dispatches worker-only historical logs without follow mode', async () => {
    await buildProgram().parseAsync(
      [
        'logs',
        '--name',
        'custom-id',
        '--worker',
        '--since',
        '1 hour ago',
        '--no-follow',
      ],
      { from: 'user' }
    );

    expect(dependencies.showLogs).toHaveBeenCalledWith('custom-id', {
      follow: false,
      since: '1 hour ago',
      worker: true,
    });
  });
});
