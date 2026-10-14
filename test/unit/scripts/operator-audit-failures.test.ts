import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => {
  const auditHandle = {
    close: vi.fn(),
    writeFile: vi.fn(),
  };
  const lockHandle = {
    close: vi.fn(),
    writeFile: vi.fn(),
  };
  return {
    auditHandle,
    chmod: vi.fn(),
    lockHandle,
    mkdir: vi.fn(),
    open: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  chmod: files.chmod,
  mkdir: files.mkdir,
  open: files.open,
  stat: files.stat,
  unlink: files.unlink,
}));

import { writeOperatorAudit } from '../../../scripts/manage/shared/operator-audit.js';

const existsError = () =>
  Object.assign(new Error('lock exists'), { code: 'EEXIST' });
const missingError = () =>
  Object.assign(new Error('missing'), { code: 'ENOENT' });
const deniedError = () =>
  Object.assign(new Error('denied'), { code: 'EACCES' });

describe('operator audit failure handling', () => {
  const getuidDescriptor = Object.getOwnPropertyDescriptor(process, 'getuid');

  beforeEach(() => {
    files.auditHandle.close.mockResolvedValue(undefined);
    files.auditHandle.writeFile.mockResolvedValue(undefined);
    files.lockHandle.close.mockResolvedValue(undefined);
    files.lockHandle.writeFile.mockResolvedValue(undefined);
    files.chmod.mockResolvedValue(undefined);
    files.mkdir.mockResolvedValue(undefined);
    files.open.mockImplementation(async (filePath: string) =>
      filePath.endsWith('.lock') ? files.lockHandle : files.auditHandle
    );
    files.stat.mockResolvedValue(undefined);
    files.unlink.mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (getuidDescriptor) {
      Object.defineProperty(process, 'getuid', getuidDescriptor);
    }
  });

  it.each([
    ['', 'Authorized recovery operation', 'Audit action'],
    ['x'.repeat(101), 'Authorized recovery operation', 'Audit action'],
    ['security.recovery', '', 'Audit reason'],
    ['security.recovery', 'x'.repeat(501), 'Audit reason'],
  ])('rejects invalid audit text %#', async (action, reason, message) => {
    await expect(
      writeOperatorAudit('/project', { action, status: 'failed', reason })
    ).rejects.toThrow(message);

    expect(files.auditHandle.writeFile).not.toHaveBeenCalled();
    expect(files.unlink).toHaveBeenCalledWith(
      '/project/runtime/logs/.operator-audit.lock'
    );
  });

  it('records a null user id when the runtime does not expose getuid', async () => {
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      value: undefined,
    });

    await writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'success',
      reason: 'Authorized recovery operation',
    });

    const serialized = files.auditHandle.writeFile.mock.calls[0]?.[0] as string;
    expect(JSON.parse(serialized).actor.uid).toBeNull();
  });

  it('propagates an unexpected lock creation error', async () => {
    files.open.mockRejectedValueOnce(deniedError());

    await expect(
      writeOperatorAudit('/project', {
        action: 'security.recovery',
        status: 'failed',
        reason: 'Authorized recovery operation',
      })
    ).rejects.toThrow('denied');
  });

  it('removes a stale lock before retrying acquisition', async () => {
    files.open.mockRejectedValueOnce(existsError());
    files.stat.mockResolvedValueOnce({ mtimeMs: Date.now() - 31_000 });

    await writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'success',
      reason: 'Authorized recovery operation',
    });

    expect(files.open).toHaveBeenCalledTimes(3);
    expect(files.unlink).toHaveBeenCalledTimes(2);
  });

  it('retries when a competing process already removed a stale lock', async () => {
    files.open.mockRejectedValueOnce(existsError());
    files.stat.mockResolvedValueOnce({ mtimeMs: Date.now() - 31_000 });
    files.unlink.mockRejectedValueOnce(missingError());

    await expect(
      writeOperatorAudit('/project', {
        action: 'security.recovery',
        status: 'success',
        reason: 'Authorized recovery operation',
      })
    ).resolves.toBeUndefined();
  });

  it('propagates an unexpected stale-lock cleanup error', async () => {
    files.open.mockRejectedValueOnce(existsError());
    files.stat.mockResolvedValueOnce({ mtimeMs: Date.now() - 31_000 });
    files.unlink.mockRejectedValueOnce(deniedError());

    await expect(
      writeOperatorAudit('/project', {
        action: 'security.recovery',
        status: 'failed',
        reason: 'Authorized recovery operation',
      })
    ).rejects.toThrow('denied');
  });

  it('waits for an active lock before retrying', async () => {
    files.open.mockRejectedValueOnce(existsError());
    files.stat.mockResolvedValueOnce({ mtimeMs: Date.now() });

    await writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'success',
      reason: 'Authorized recovery operation',
    });

    expect(files.open).toHaveBeenCalledTimes(3);
  });

  it('retries when a competing lock disappears before it can be inspected', async () => {
    files.open.mockRejectedValueOnce(existsError());
    files.stat.mockRejectedValueOnce(missingError());

    await writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'success',
      reason: 'Authorized recovery operation',
    });

    expect(files.open).toHaveBeenCalledTimes(3);
  });

  it('times out when another process retains the lock', async () => {
    vi.useFakeTimers();
    files.open.mockRejectedValue(existsError());
    files.stat.mockResolvedValue({ mtimeMs: Date.now() });

    const operation = writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'failed',
      reason: 'Authorized recovery operation',
    });
    const assertion = expect(operation).rejects.toThrow(
      'Timed out while waiting for the operator audit log lock'
    );
    await vi.runAllTimersAsync();
    await assertion;
  });

  it.each([
    [missingError(), false],
    [deniedError(), true],
  ])('handles lock-release failures safely %#', async (failure, rejects) => {
    files.unlink.mockRejectedValueOnce(failure);
    const operation = writeOperatorAudit('/project', {
      action: 'security.recovery',
      status: 'success',
      reason: 'Authorized recovery operation',
    });

    if (rejects) {
      await expect(operation).rejects.toThrow('denied');
    } else {
      await expect(operation).resolves.toBeUndefined();
    }
  });

  it('closes the audit file and releases the lock after a write failure', async () => {
    files.auditHandle.writeFile.mockRejectedValueOnce(
      new Error('write failed')
    );

    await expect(
      writeOperatorAudit('/project', {
        action: 'security.recovery',
        status: 'failed',
        reason: 'Authorized recovery operation',
      })
    ).rejects.toThrow('write failed');

    expect(files.auditHandle.close).toHaveBeenCalledOnce();
    expect(files.unlink).toHaveBeenCalledOnce();
  });
});
