import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => {
  const promptResponses: Array<Record<string, unknown>> = [];
  const promptQuestions: unknown[] = [];
  const prompt = vi.fn(async (questions: unknown) => {
    promptQuestions.push(questions);
    return promptResponses.shift() ?? {};
  });
  const log = {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
  const fs = {
    readFileSync: vi.fn(() => '{"name":"parako.id"}'),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  const children: any[] = [];
  const spawn = vi.fn(() => children.shift());
  return {
    promptResponses,
    promptQuestions,
    prompt,
    log,
    fs,
    children,
    spawn,
  };
});

vi.mock('inquirer', () => ({ default: { prompt: io.prompt } }));
vi.mock('../../../scripts/manage/shared/logger.js', () => ({ log: io.log }));
vi.mock('../../../scripts/manage/shared/file.js', () => ({
  default: '/app',
  rootDir: '/app',
}));
vi.mock('node:fs', () => ({ default: io.fs, ...io.fs }));
vi.mock('node:child_process', () => ({ spawn: io.spawn }));

import {
  assertInteractiveTty,
  cleanOldBackups,
  collectArrayItems,
  createBackup,
  executeCommand,
  updateArrayField,
} from '../../../scripts/manage/shared/utils.js';

function createStream() {
  const listeners = new Map<string, (value: unknown) => void>();
  return {
    on: vi.fn((event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener);
    }),
    emit(event: string, value: unknown) {
      listeners.get(event)?.(value);
    },
  };
}

function createChild(options: { stdout?: boolean; stderr?: boolean } = {}) {
  const listeners = new Map<string, (value: any) => void>();
  const child = {
    stdout: options.stdout === false ? null : createStream(),
    stderr: options.stderr === false ? null : createStream(),
    on: vi.fn((event: string, listener: (value: any) => void) => {
      listeners.set(event, listener);
    }),
    emit(event: string, value: any) {
      listeners.get(event)?.(value);
    },
  };
  return child;
}

describe('shared management CLI I/O utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io.promptResponses.length = 0;
    io.promptQuestions.length = 0;
    io.children.length = 0;
    io.fs.existsSync.mockReturnValue(true);
    io.fs.readdirSync.mockReturnValue([]);
    io.fs.statSync.mockReturnValue({ mtime: new Date(0) });
  });

  it('requires a TTY for interactive commands', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    expect(() => assertInteractiveTty('client add')).toThrow(
      'Refusing to start interactive prompt for "client add"'
    );
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    expect(() => assertInteractiveTty('client add')).not.toThrow();

    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor);
    }
  });

  it('executes commands without a shell and captures stdout and stderr', async () => {
    const child = createChild();
    io.children.push(child);
    const resultPromise = executeCommand('systemctl', ['status', 'parako-id']);
    child.stdout!.emit('data', Buffer.from('active'));
    child.stderr!.emit('data', Buffer.from('warning'));
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      code: 0,
      stdout: 'active',
      stderr: 'warning',
      success: true,
    });
    expect(io.spawn).toHaveBeenCalledWith(
      'systemctl',
      ['status', 'parako-id'],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: false }
    );
  });

  it('handles missing streams and nonzero command exits', async () => {
    const child = createChild({ stdout: false, stderr: false });
    io.children.push(child);
    const resultPromise = executeCommand('false');
    child.emit('close', 2);

    await expect(resultPromise).resolves.toEqual({
      code: 2,
      stdout: '',
      stderr: '',
      success: false,
    });
  });

  it('does not report signal-terminated commands as exit code zero', async () => {
    const child = createChild();
    io.children.push(child);
    const resultPromise = executeCommand('systemctl');
    child.emit('close', null);

    await expect(resultPromise).resolves.toEqual({
      code: -1,
      stdout: '',
      stderr: '',
      success: false,
    });
  });

  it('returns spawn errors with any stderr already emitted', async () => {
    const child = createChild();
    io.children.push(child);
    const resultPromise = executeCommand('missing-command');
    child.stderr!.emit('data', Buffer.from('prefix: '));
    child.emit('error', new Error('ENOENT'));

    await expect(resultPromise).resolves.toEqual({
      code: -1,
      stdout: '',
      stderr: 'prefix: ENOENT',
      success: false,
    });
  });

  it('collects validated array items until the user submits an empty value', async () => {
    const validator = vi.fn(() => true);
    io.promptResponses.push({ item: 'one' }, { item: 'two' }, { item: '' });

    await expect(collectArrayItems('URI', validator)).resolves.toEqual([
      'one',
      'two',
    ]);
    expect(io.log.success).toHaveBeenNthCalledWith(1, 'Added: one');
    const firstQuestion = (io.promptQuestions[0] as any[])[0];
    expect(firstQuestion.validate('')).toBe(true);
    expect(firstQuestion.validate('value')).toBe(true);
    expect(validator).toHaveBeenCalledWith('value');
  });

  it('accepts collected items without an optional validator', async () => {
    io.promptResponses.push({ item: 'one' }, { item: '' });
    await expect(collectArrayItems('item')).resolves.toEqual(['one']);
    const question = (io.promptQuestions[0] as any[])[0];
    expect(question.validate('one')).toBe(true);
  });

  it('handles empty arrays when the user declines or provides no new values', async () => {
    io.promptResponses.push({ addNew: false });
    await expect(
      updateArrayField([], 'URI', 'redirect URIs')
    ).resolves.toBeNull();
    expect(io.log.info).toHaveBeenCalledWith(
      'No existing redirect URIs found.'
    );

    io.promptResponses.push({ addNew: true }, { item: '' });
    await expect(
      updateArrayField([], 'URI', 'redirect URIs')
    ).resolves.toBeNull();

    io.promptResponses.push(
      { addNew: true },
      { item: 'https://new.example/cb' },
      { item: '' }
    );
    await expect(updateArrayField([], 'URI', 'redirect URIs')).resolves.toEqual(
      ['https://new.example/cb']
    );
  });

  it('adds and deduplicates values in an existing array', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    io.promptResponses.push(
      { action: 'add' },
      { item: 'https://new.example/cb' },
      { item: 'https://old.example/cb' },
      { item: '' }
    );

    await expect(
      updateArrayField(['https://old.example/cb'], 'URI', 'redirect URIs')
    ).resolves.toEqual(['https://old.example/cb', 'https://new.example/cb']);
    expect(io.log.success).toHaveBeenCalledWith('Added 2 new uri(s)');
  });

  it('returns null when add or cancel makes no changes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    io.promptResponses.push({ action: 'cancel' });
    await expect(
      updateArrayField(['one'], 'Item', 'items')
    ).resolves.toBeNull();

    io.promptResponses.push({ action: 'add' }, { item: '' });
    await expect(
      updateArrayField(['one'], 'Item', 'items')
    ).resolves.toBeNull();
  });

  it('removes selected values and exposes checkbox validation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    io.promptResponses.push({ action: 'remove' }, { itemsToRemove: ['two'] });

    await expect(
      updateArrayField(['one', 'two'], 'Item', 'items')
    ).resolves.toEqual(['one']);
    const removeQuestion = (io.promptQuestions[1] as any[])[0];
    expect(removeQuestion.validate([])).toContain('Please select at least one');
    expect(removeQuestion.validate(['one'])).toBe(true);
    expect(io.log.success).toHaveBeenCalledWith('Removed 1 item(s)');
  });

  it('replaces values only after confirmation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    io.promptResponses.push(
      { action: 'replace' },
      { confirmReplace: true },
      { item: 'replacement' },
      { item: '' }
    );
    await expect(updateArrayField(['old'], 'Item', 'items')).resolves.toEqual([
      'replacement',
    ]);

    io.promptResponses.push({ action: 'replace' }, { confirmReplace: false });
    await expect(
      updateArrayField(['old'], 'Item', 'items')
    ).resolves.toBeNull();
  });

  it('creates the backup directory when needed and returns timestamped paths', async () => {
    io.fs.existsSync.mockReturnValue(false);

    await expect(createBackup('upgrade')).resolves.toMatch(
      /^\/app\/runtime\/config-backups\/backup-.*-upgrade\.json$/
    );
    expect(io.fs.mkdirSync).toHaveBeenCalledWith(
      '/app/runtime/config-backups',
      { recursive: true }
    );

    io.fs.existsSync.mockReturnValue(true);
    await expect(createBackup()).resolves.toMatch(/-manual\.json$/);
  });

  it('skips cleanup when the backup directory does not exist', async () => {
    io.fs.existsSync.mockReturnValue(false);
    await cleanOldBackups();
    expect(io.fs.readdirSync).not.toHaveBeenCalled();
  });

  it('keeps every backup when the retention limit is not exceeded', async () => {
    io.fs.readdirSync.mockReturnValue(['one.json', 'two.json']);
    await cleanOldBackups();
    expect(io.fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('keeps ten newest JSON backups and reports cleanup failures', async () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `backup-${index}.json`
    );
    io.fs.readdirSync.mockReturnValue([...files, 'README.txt']);
    io.fs.statSync.mockImplementation((filePath: unknown) => {
      const index = Number(String(filePath).match(/backup-(\d+)/)?.[1] ?? 0);
      return { mtime: new Date(index * 1000) };
    });
    io.fs.unlinkSync.mockImplementation((filePath: unknown) => {
      if (String(filePath).endsWith('backup-0.json')) {
        throw new Error('permission denied');
      }
    });

    await cleanOldBackups();

    expect(io.fs.unlinkSync).toHaveBeenCalledWith(
      '/app/runtime/config-backups/backup-1.json'
    );
    expect(io.fs.unlinkSync).toHaveBeenCalledWith(
      '/app/runtime/config-backups/backup-0.json'
    );
    expect(io.log.info).toHaveBeenCalledWith(
      'Cleaned old backup: backup-1.json'
    );
    expect(io.log.warning).toHaveBeenCalledWith(
      'Failed to clean backup backup-0.json: permission denied'
    );
  });
});
