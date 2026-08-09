import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMainModule } from '../../../scripts/manage/shared/entrypoint.js';

describe('management CLI entrypoint detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes an entrypoint invoked through the current release symlink', () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'parako-entrypoint-')
    );
    try {
      const release = path.join(fixture, 'releases', 'v1');
      const target = path.join(release, 'database.js');
      const current = path.join(fixture, 'current');
      fs.mkdirSync(release, { recursive: true });
      fs.writeFileSync(target, '');
      fs.symlinkSync(release, current, 'dir');

      expect(
        isMainModule(
          pathToFileURL(target).href,
          path.join(current, 'database.js')
        )
      ).toBe(true);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a different entrypoint', () => {
    expect(isMainModule(import.meta.url, process.execPath)).toBe(false);
  });

  it('rejects an invocation without an entrypoint path', () => {
    expect(isMainModule(import.meta.url, '')).toBe(false);
  });

  it('uses the process entrypoint when no override is provided', () => {
    const originalEntry = process.argv[1];
    process.argv[1] = fileURLToPath(import.meta.url);

    try {
      expect(isMainModule(import.meta.url)).toBe(true);
    } finally {
      process.argv[1] = originalEntry;
    }
  });

  it('falls back to normalized paths when realpath resolution fails', () => {
    vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw new Error('unavailable');
    });

    const moduleUrl = pathToFileURL('/tmp/parako-cli.js').href;
    expect(isMainModule(moduleUrl, '/tmp/parako-cli.js')).toBe(true);
    expect(isMainModule(moduleUrl, '/tmp/another-cli.js')).toBe(false);
  });
});
