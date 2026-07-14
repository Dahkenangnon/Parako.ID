import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMainModule } from '../../../scripts/manage/shared/entrypoint.js';

describe('management CLI entrypoint detection', () => {
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
});
