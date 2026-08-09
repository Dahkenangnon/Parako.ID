import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  existsSync: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    progress: vi.fn(),
    success: vi.fn(),
    title: vi.fn(),
    warning: vi.fn(),
  },
  unlinkSync: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: dependencies.existsSync,
      unlinkSync: dependencies.unlinkSync,
    },
  };
});
vi.mock('../../../scripts/manage/shared/logger.js', () => ({
  log: dependencies.log,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  executeCommand: dependencies.executeCommand,
}));

import { uninstallServices } from '../../../scripts/manage/systemd/uninstall.js';
import { restartServices } from '../../../scripts/manage/systemd/restart.js';
import { showStatus } from '../../../scripts/manage/systemd/status.js';

describe('systemd service operations', () => {
  beforeEach(() => {
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    dependencies.executeCommand.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    dependencies.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('rejects a traversal service name before stopping or deleting anything', async () => {
    await expect(uninstallServices('../../outside/parako')).rejects.toThrow(
      'Service name must start with a letter/digit'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
    expect(dependencies.unlinkSync).not.toHaveBeenCalled();
  });

  it('rejects an invalid restart service name before calling systemctl', async () => {
    await expect(restartServices('../outside')).rejects.toThrow(
      'Service name must start with a letter/digit'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
  });

  it('rejects an empty service name before calling systemctl', async () => {
    await expect(restartServices('')).rejects.toThrow(
      'Service name is required'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
  });

  it('rejects an invalid status service name before calling systemctl', async () => {
    await expect(showStatus('../outside')).rejects.toThrow(
      'Service name must start with a letter/digit'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
  });

  it('shows app and worker status output in deterministic order', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.executeCommand
      .mockResolvedValueOnce({
        success: true,
        stdout: 'app status',
        stderr: '',
        code: 0,
      })
      .mockResolvedValueOnce({
        success: true,
        stdout: 'worker status',
        stderr: '',
        code: 0,
      });

    await showStatus('parako-id');

    expect(dependencies.executeCommand.mock.calls).toEqual([
      ['systemctl', ['status', 'parako-id']],
      ['systemctl', ['status', 'parako-id-worker']],
    ]);
    expect(dependencies.log.title.mock.calls).toEqual([
      ['parako-id'],
      ['parako-id-worker'],
    ]);
    expect(consoleLog.mock.calls).toEqual([['app status'], ['worker status']]);
  });

  it('warns and renders stderr when a service status command fails', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    dependencies.executeCommand
      .mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: 'unit not found',
        code: 4,
      })
      .mockResolvedValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        code: 0,
      });

    await showStatus('parako-id');

    expect(dependencies.log.warning).toHaveBeenCalledOnce();
    expect(dependencies.log.warning).toHaveBeenCalledWith(
      'Service parako-id may not be installed or running'
    );
    expect(consoleLog).toHaveBeenCalledWith('unit not found');
  });

  it('rejects non-root restart without calling systemctl', async () => {
    vi.mocked(process.getuid!).mockReturnValue(1000);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(restartServices('parako-id')).rejects.toThrow(
      'Restart requires root privileges'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
  });

  it('aborts before the worker when the main service restart fails', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    dependencies.executeCommand.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'main failed',
      code: 1,
    });

    await expect(restartServices('parako-id')).rejects.toThrow(
      'Failed to restart parako-id: main failed'
    );
    expect(dependencies.executeCommand).toHaveBeenCalledOnce();
  });

  it('reports a worker restart failure after the main service restarts', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
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
        stderr: 'worker failed',
        code: 1,
      });

    await expect(restartServices('parako-id')).rejects.toThrow(
      'Failed to restart parako-id-worker: worker failed'
    );
    expect(dependencies.executeCommand).toHaveBeenCalledTimes(2);
  });

  it('reports the main service exit code when restart stderr is empty', async () => {
    dependencies.executeCommand.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: '',
      code: 7,
    });

    await expect(restartServices('parako-id')).rejects.toThrow(
      'Failed to restart parako-id: exit code 7'
    );
  });

  it('reports the worker exit code when restart stderr is empty', async () => {
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
        code: 8,
      });

    await expect(restartServices('parako-id')).rejects.toThrow(
      'Failed to restart parako-id-worker: exit code 8'
    );
  });

  it('restarts the app before the worker and reports both successes', async () => {
    await restartServices('parako-id');

    expect(dependencies.executeCommand.mock.calls).toEqual([
      ['systemctl', ['restart', 'parako-id']],
      ['systemctl', ['restart', 'parako-id-worker']],
    ]);
    expect(dependencies.log.success.mock.calls).toEqual([
      ['parako-id restarted'],
      ['parako-id-worker restarted'],
    ]);
  });

  it('rejects non-root uninstall without executing any side effects', async () => {
    vi.mocked(process.getuid!).mockReturnValue(1000);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(uninstallServices('parako-id')).rejects.toThrow(
      'Uninstallation requires root privileges'
    );
    expect(dependencies.executeCommand).not.toHaveBeenCalled();
    expect(dependencies.unlinkSync).not.toHaveBeenCalled();
  });

  it('aborts uninstall before deletion when a service cannot be stopped', async () => {
    dependencies.executeCommand.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'access denied',
      exitCode: 1,
    });

    await expect(uninstallServices('parako-id')).rejects.toThrow(
      'Failed to stop parako-id-worker: access denied'
    );
    expect(dependencies.executeCommand).toHaveBeenCalledOnce();
    expect(dependencies.unlinkSync).not.toHaveBeenCalled();
  });

  it('aborts uninstall before deletion when a service cannot be disabled', async () => {
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
        stderr: 'disable failed',
        code: 1,
      });

    await expect(uninstallServices('parako-id')).rejects.toThrow(
      'Failed to disable parako-id-worker: disable failed'
    );
    expect(dependencies.unlinkSync).not.toHaveBeenCalled();
  });

  it('reports a daemon-reload failure after removing the unit files', async () => {
    dependencies.executeCommand
      .mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        code: 0,
      })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: 'reload failed',
        code: 1,
      });

    await expect(uninstallServices('parako-id')).rejects.toThrow(
      'Failed to reload systemd: reload failed'
    );
    expect(dependencies.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      operation: 'stop',
      successfulCalls: 0,
      expected: 'Failed to stop parako-id-worker: exit code 9',
    },
    {
      operation: 'disable',
      successfulCalls: 1,
      expected: 'Failed to disable parako-id-worker: exit code 9',
    },
    {
      operation: 'daemon-reload',
      successfulCalls: 4,
      expected: 'Failed to reload systemd: exit code 9',
    },
  ])(
    'reports the exit code when $operation fails without stderr',
    async ({ successfulCalls, expected }) => {
      for (let index = 0; index < successfulCalls; index += 1) {
        dependencies.executeCommand.mockResolvedValueOnce({
          success: true,
          stdout: '',
          stderr: '',
          code: 0,
        });
      }
      dependencies.executeCommand.mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: '',
        code: 9,
      });

      await expect(uninstallServices('parako-id')).rejects.toThrow(expected);
    }
  );

  it('uninstalls the worker before the app and reloads systemd once', async () => {
    await uninstallServices('parako-id');

    expect(dependencies.executeCommand.mock.calls).toEqual([
      ['systemctl', ['stop', 'parako-id-worker']],
      ['systemctl', ['disable', 'parako-id-worker']],
      ['systemctl', ['stop', 'parako-id']],
      ['systemctl', ['disable', 'parako-id']],
      ['systemctl', ['daemon-reload']],
    ]);
    expect(dependencies.unlinkSync.mock.calls).toEqual([
      ['/etc/systemd/system/parako-id-worker.service'],
      ['/etc/systemd/system/parako-id.service'],
    ]);
    expect(dependencies.log.success).toHaveBeenCalledWith(
      'Services uninstalled successfully'
    );
  });

  it('completes uninstall when unit files are already absent', async () => {
    dependencies.existsSync.mockReturnValue(false);

    await uninstallServices('parako-id');

    expect(dependencies.unlinkSync).not.toHaveBeenCalled();
    expect(dependencies.executeCommand).toHaveBeenLastCalledWith('systemctl', [
      'daemon-reload',
    ]);
  });
});
