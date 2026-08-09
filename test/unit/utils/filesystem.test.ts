import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemUtils } from '../../../src/utils/filesystem.js';

describe('FileSystemUtils', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parako-filesystem-'));
  });

  afterEach(async () => {
    delete process.env.PARAKO_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses PARAKO_ROOT consistently for runtime and database paths', () => {
    const configuredRoot = path.join(tempDir, 'configured-root');
    process.env.PARAKO_ROOT = configuredRoot;

    const fileSystem = new FileSystemUtils();

    expect(fileSystem.rootDir).toBe(configuredRoot);
    expect(fileSystem.getProjectDir()).toBe(configuredRoot);
    expect(fileSystem.getEnvFilePath()).toBe(path.join(configuredRoot, '.env'));
  });

  it('returns false when removing a directory that does not exist', async () => {
    const fileSystem = new FileSystemUtils();

    await expect(
      fileSystem.removeDir(path.join(tempDir, 'missing'), true)
    ).resolves.toBe(false);
  });

  it('rejects createDir when the target is an existing regular file', async () => {
    const target = path.join(tempDir, 'not-a-directory');
    await fs.writeFile(target, 'content');
    const fileSystem = new FileSystemUtils();

    await expect(fileSystem.createDir(target)).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  it('resolves project paths and reads the project package manifest', async () => {
    const fileSystem = new FileSystemUtils();

    expect(fileSystem.rootDir).toBe(fileSystem.getProjectDir());
    expect(fileSystem.getEnvFilePath()).toBe(
      path.join(fileSystem.rootDir, '.env')
    );
    expect(fileSystem.getLogDir()).toBe(path.join(fileSystem.rootDir, 'logs'));
    await expect(fileSystem.getPackageJson()).resolves.toMatchObject({
      name: expect.any(String),
    });
    expect(fileSystem.join('runtime', 'logs', 'app.log')).toBe(
      path.join('runtime', 'logs', 'app.log')
    );
  });

  it('falls back to the working directory when no package manifest is found', async () => {
    const statSync = vi.fn(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    vi.resetModules();
    vi.doMock('node:fs', async importOriginal => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, statSync };
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { FileSystemUtils: IsolatedFileSystemUtils } =
        await import('../../../src/utils/filesystem.js');
      const fileSystem = new IsolatedFileSystemUtils();

      expect(fileSystem.rootDir).toBe(process.cwd());
      expect(statSync).toHaveBeenCalledTimes(10);
      expect(consoleWarn).toHaveBeenCalledWith(
        'Could not locate package.json, using process.cwd() as project root',
        expect.objectContaining({
          context: 'failed_to_get_package_json',
          fallbackTo: process.cwd(),
        })
      );
    } finally {
      consoleWarn.mockRestore();
      vi.doUnmock('node:fs');
    }
  });

  it('creates, saves, reads, detects, and removes files', async () => {
    const fileSystem = new FileSystemUtils();
    const nestedDir = path.join(tempDir, 'nested', 'files');
    const filePath = path.join(nestedDir, 'sample.txt');

    await expect(fileSystem.createDir(nestedDir)).resolves.toBeUndefined();
    await expect(fileSystem.fileExists(filePath)).resolves.toBe(false);
    await expect(
      fileSystem.saveFile(filePath, Buffer.from('hello'))
    ).resolves.toBe(true);
    await expect(fileSystem.fileExists(filePath)).resolves.toBe(true);
    await expect(fileSystem.readFile(filePath)).resolves.toBe('hello');
    expect(fileSystem.readFileSync(filePath)).toBe('hello');
    await expect(fileSystem.removeFile(filePath)).resolves.toBe(true);
    await expect(fileSystem.removeFile(filePath)).resolves.toBe(false);
  });

  it('removes existing empty and recursive directories', async () => {
    const fileSystem = new FileSystemUtils();
    const emptyDir = path.join(tempDir, 'empty');
    const treeDir = path.join(tempDir, 'tree');

    await fs.mkdir(emptyDir);
    await fs.mkdir(path.join(treeDir, 'child'), { recursive: true });
    await fs.writeFile(path.join(treeDir, 'child', 'sample.txt'), 'content');

    await expect(fileSystem.removeDir(emptyDir)).resolves.toBe(true);
    await expect(fileSystem.removeDir(treeDir, true)).resolves.toBe(true);
    await expect(fileSystem.fileExists(emptyDir)).resolves.toBe(false);
    await expect(fileSystem.fileExists(treeDir)).resolves.toBe(false);
  });

  it('propagates filesystem errors that are not missing-path results', async () => {
    const fileSystem = new FileSystemUtils();
    const nonEmptyDir = path.join(tempDir, 'non-empty');
    await fs.mkdir(nonEmptyDir);
    await fs.writeFile(path.join(nonEmptyDir, 'sample.txt'), 'content');

    await expect(fileSystem.removeFile(nonEmptyDir)).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM)$/),
    });
    await expect(fileSystem.removeDir(nonEmptyDir)).rejects.toMatchObject({
      code: expect.stringMatching(/^(ENOTEMPTY|EEXIST)$/),
    });
    await expect(
      fileSystem.readFile(path.join(tempDir, 'missing'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() =>
      fileSystem.readFileSync(path.join(tempDir, 'missing'))
    ).toThrow();
    await expect(fileSystem.saveFile(nonEmptyDir, 'content')).rejects.toThrow();
  });

  it('ensures directories synchronously and reports invalid paths', async () => {
    const fileSystem = new FileSystemUtils();
    const nestedDir = path.join(tempDir, 'sync', 'nested');
    const blockingFile = path.join(tempDir, 'blocking-file');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    expect(fileSystem.ensureDir(nestedDir)).toBe(true);
    await expect(fs.stat(nestedDir)).resolves.toMatchObject({});

    await fs.writeFile(blockingFile, 'content');
    expect(fileSystem.ensureDir(path.join(blockingFile, 'child'))).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
      context: 'failed_to_ensure_dir',
      dirPath: path.join(blockingFile, 'child'),
    });
    consoleError.mockRestore();
  });
});
