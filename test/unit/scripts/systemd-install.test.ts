import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemdConfig } from '../../../scripts/manage/systemd/types.js';

const dependencies = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  existsSync: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: dependencies.existsSync,
      readFileSync: dependencies.readFileSync,
      statSync: dependencies.statSync,
      writeFileSync: dependencies.writeFileSync,
    },
  };
});
vi.mock('../../../scripts/manage/shared/logger.js', () => ({
  log: dependencies.log,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  executeCommand: dependencies.executeCommand,
}));

import { installServices } from '../../../scripts/manage/systemd/install.js';

const config: SystemdConfig = {
  envFile: '/srv/parako/runtime/.env',
  nodePath: '/usr/bin/node',
  runtimeDirectory: '/srv/parako/runtime',
  serviceName: 'parako-id',
  user: 'parako',
  workingDirectory: '/srv/parako',
};

describe('systemd service installation', () => {
  beforeEach(() => {
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    dependencies.executeCommand.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      code: 0,
    });
    dependencies.existsSync.mockReturnValue(true);
    dependencies.statSync.mockReturnValue({ isDirectory: () => true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('rejects a traversal service name before any root side effect', async () => {
    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        '../../outside',
        config
      )
    ).rejects.toThrow('Service name must start with a letter/digit');
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects non-root installation without executing side effects', async () => {
    vi.mocked(process.getuid!).mockReturnValue(1000);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Installation requires root privileges');
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects installation when the configured service user is missing', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.executeCommand.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'no such user',
      code: 1,
    });

    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Service user "parako" does not exist');
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects installation when the working directory is missing', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.existsSync.mockReturnValueOnce(false);

    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Working directory "/srv/parako" does not exist');
    expect(dependencies.statSync).not.toHaveBeenCalled();
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects installation when the working path is not a directory', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.statSync.mockReturnValue({ isDirectory: () => false });

    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        'parako-id',
        config
      )
    ).rejects.toThrow('"/srv/parako" is not a directory');
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects installation when the runtime directory is missing', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(
      installServices(
        { app: '[Unit]\n', worker: '[Unit]\n' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Runtime directory "/srv/parako/runtime" does not exist');
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('warns about a missing env file but installs new unit files', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    await installServices(
      { app: 'app unit', worker: 'worker unit' },
      'parako-id',
      config
    );

    expect(dependencies.log.warning).toHaveBeenCalledWith(
      'Environment file "/srv/parako/runtime/.env" does not exist. The service will fail to start until it is created.'
    );
    expect(dependencies.writeFileSync.mock.calls).toEqual([
      ['/etc/systemd/system/parako-id.service', 'app unit', 'utf-8'],
      ['/etc/systemd/system/parako-id-worker.service', 'worker unit', 'utf-8'],
    ]);
    expect(dependencies.executeCommand).toHaveBeenLastCalledWith('systemctl', [
      'daemon-reload',
    ]);
  });

  it('skips writes and daemon reload when both unit files are unchanged', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.readFileSync
      .mockReturnValueOnce('app unit')
      .mockReturnValueOnce('worker unit');

    await installServices(
      { app: 'app unit', worker: 'worker unit' },
      'parako-id',
      config
    );

    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
    expect(dependencies.executeCommand.mock.calls).toEqual([
      ['id', ['-u', 'parako']],
    ]);
    expect(dependencies.log.info).toHaveBeenCalledWith(
      'Nothing changed — skipping daemon-reload.'
    );
  });

  it('refuses to overwrite a differing unit file without force', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.readFileSync.mockReturnValueOnce('old app unit');

    await expect(
      installServices(
        { app: 'new app unit', worker: 'worker unit' },
        'parako-id',
        config
      )
    ).rejects.toThrow(
      'Refusing to overwrite /etc/systemd/system/parako-id.service'
    );
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
    expect(dependencies.executeCommand).toHaveBeenCalledOnce();
  });

  it.each([
    {
      existing: 'shared\nremoved',
      incoming: 'shared',
      expectedDiffLine: '- removed',
    },
    {
      existing: 'shared',
      incoming: 'shared\nadded',
      expectedDiffLine: '+ added',
    },
  ])(
    'renders a useful diff when a trailing unit line changes',
    async ({ existing, incoming, expectedDiffLine }) => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      dependencies.readFileSync.mockReturnValueOnce(existing);

      await expect(
        installServices(
          { app: incoming, worker: 'worker unit' },
          'parako-id',
          config
        )
      ).rejects.toThrow('Refusing to overwrite');

      expect(consoleLog.mock.calls.flat().join('\n')).toContain(
        expectedDiffLine
      );
    }
  );

  it('overwrites differing unit files only when force is explicit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.readFileSync
      .mockReturnValueOnce('old app unit')
      .mockReturnValueOnce('old worker unit');

    await installServices(
      { app: 'new app unit', worker: 'new worker unit' },
      'parako-id',
      config,
      { force: true }
    );

    expect(dependencies.log.warning.mock.calls).toEqual([
      ['Overwriting /etc/systemd/system/parako-id.service (--force).'],
      ['Overwriting /etc/systemd/system/parako-id-worker.service (--force).'],
    ]);
    expect(dependencies.writeFileSync.mock.calls).toEqual([
      ['/etc/systemd/system/parako-id.service', 'new app unit', 'utf-8'],
      [
        '/etc/systemd/system/parako-id-worker.service',
        'new worker unit',
        'utf-8',
      ],
    ]);
    expect(dependencies.executeCommand).toHaveBeenLastCalledWith('systemctl', [
      'daemon-reload',
    ]);
  });

  it('propagates a daemon-reload failure after writing new units', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    dependencies.executeCommand
      .mockResolvedValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        code: 0,
      })
      .mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: 'reload denied',
        code: 1,
      });

    await expect(
      installServices(
        { app: 'app unit', worker: 'worker unit' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Failed to reload systemd: reload denied');
    expect(dependencies.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('reports the daemon-reload exit code when stderr is empty', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    dependencies.executeCommand
      .mockResolvedValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        code: 0,
      })
      .mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: '',
        code: 5,
      });

    await expect(
      installServices(
        { app: 'app unit', worker: 'worker unit' },
        'parako-id',
        config
      )
    ).rejects.toThrow('Failed to reload systemd: exit code 5');
  });
});
