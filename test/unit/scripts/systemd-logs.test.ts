import { EventEmitter } from 'node:events';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: dependencies.spawn,
}));

import { showLogs } from '../../../scripts/manage/systemd/logs.js';

class FakeChild extends EventEmitter {
  kill = vi.fn();
}

describe('systemd log streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('rejects an invalid service name before spawning journalctl', async () => {
    await expect(showLogs('../outside')).rejects.toThrow(
      'Service name must start with a letter/digit'
    );
    expect(dependencies.spawn).not.toHaveBeenCalled();
  });

  it('removes signal-forwarding listeners after journalctl exits', async () => {
    const child = new FakeChild();
    dependencies.spawn.mockReturnValue(child);
    const originalSigintListeners = new Set(process.listeners('SIGINT'));
    const originalSigtermListeners = new Set(process.listeners('SIGTERM'));

    try {
      const completion = showLogs('parako-id');

      expect(process.listenerCount('SIGINT')).toBe(
        originalSigintListeners.size + 1
      );
      expect(process.listenerCount('SIGTERM')).toBe(
        originalSigtermListeners.size + 1
      );

      const forward = process
        .listeners('SIGINT')
        .find(listener => !originalSigintListeners.has(listener));
      expect(forward).toBeDefined();
      forward?.('SIGINT');
      forward?.('SIGTERM');
      expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGTERM']]);

      child.emit('exit', 0);
      await completion;

      expect(process.listenerCount('SIGINT')).toBe(
        originalSigintListeners.size
      );
      expect(process.listenerCount('SIGTERM')).toBe(
        originalSigtermListeners.size
      );
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!originalSigintListeners.has(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.listeners('SIGTERM')) {
        if (!originalSigtermListeners.has(listener)) {
          process.removeListener('SIGTERM', listener);
        }
      }
    }
  });

  it('follows app and worker logs by default and accepts signal termination', async () => {
    const child = new FakeChild();
    dependencies.spawn.mockReturnValue(child);

    const completion = showLogs('parako-id');

    expect(dependencies.spawn).toHaveBeenCalledWith(
      'journalctl',
      ['-u', 'parako-id', '-u', 'parako-id-worker', '-f'],
      { stdio: 'inherit' }
    );

    child.emit('exit', null);
    await completion;
  });

  it('supports worker-only historical logs without follow mode', async () => {
    const child = new FakeChild();
    dependencies.spawn.mockReturnValue(child);

    const completion = showLogs('parako-id', {
      follow: false,
      since: '1 hour ago',
      worker: true,
    });

    expect(dependencies.spawn).toHaveBeenCalledWith(
      'journalctl',
      ['-u', 'parako-id-worker', '--since', '1 hour ago'],
      { stdio: 'inherit' }
    );

    child.emit('exit', 0);
    await completion;
  });

  it('rejects spawn errors and removes every lifecycle listener', async () => {
    const child = new FakeChild();
    dependencies.spawn.mockReturnValue(child);
    const sigintCount = process.listenerCount('SIGINT');
    const sigtermCount = process.listenerCount('SIGTERM');

    const completion = showLogs('parako-id');
    child.emit('error', new Error('journal unavailable'));

    await expect(completion).rejects.toThrow('journal unavailable');
    expect(process.listenerCount('SIGINT')).toBe(sigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermCount);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('rejects when journalctl exits with a nonzero code', async () => {
    const child = new FakeChild();
    dependencies.spawn.mockReturnValue(child);

    const completion = showLogs('parako-id');
    child.emit('exit', 3);

    await expect(completion).rejects.toThrow('journalctl exited with code 3');
  });
});
