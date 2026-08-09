import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { extractSection, extractSectionFromText, main } =
  await import('../../../scripts/extract-changelog.mjs');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const SAMPLE = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-06-01

### Features

* new thing

### Bug Fixes

* old thing fixed

## [0.1.0] - 2026-05-15

### Features

* initial
`;

const EMPTY_BODY = `# Changelog

## [Unreleased]

## [0.2.1] - 2026-06-02

## [0.2.0] - 2026-06-01

* prior body
`;

const RC = `# Changelog

## [Unreleased]

## [1.0.0-rc.1] - 2026-07-01

* first rc

## [0.9.0] - 2026-06-30

* prior
`;

describe('extractSectionFromText', () => {
  it('returns the body between the matching heading and the next H2 version heading', () => {
    expect(extractSectionFromText(SAMPLE, '0.2.0')).toBe(
      '### Features\n\n* new thing\n\n### Bug Fixes\n\n* old thing fixed'
    );
  });

  it('returns null when the version is not present', () => {
    expect(extractSectionFromText(SAMPLE, '9.9.9')).toBeNull();
  });

  it('returns an empty string when the section is followed immediately by the next H2', () => {
    expect(extractSectionFromText(EMPTY_BODY, '0.2.1')).toBe('');
  });

  it('escapes regex-significant characters in the version (rc / dots)', () => {
    expect(extractSectionFromText(RC, '1.0.0-rc.1')).toBe('* first rc');
  });

  it('does not match a partial version prefix (0.2 must not match 0.2.0)', () => {
    expect(extractSectionFromText(SAMPLE, '0.2')).toBeNull();
  });

  it('trims surrounding blank lines from the body', () => {
    const src = '# x\n\n## [1.2.3]\n\n\nbody line\n\n\n## [1.2.2]\n\nprev\n';
    expect(extractSectionFromText(src, '1.2.3')).toBe('body line');
  });

  it('handles the last section (no next H2)', () => {
    const src = '# x\n\n## [0.1.0] - 2026-01-01\n\n* lone body\n';
    expect(extractSectionFromText(src, '0.1.0')).toBe('* lone body');
  });
});

describe('extract changelog CLI', () => {
  it('returns null when the changelog file does not exist', () => {
    expect(extractSection('/missing/CHANGELOG.md', '1.2.3')).toBeNull();
  });

  it('prints usage and returns exit code 2 without a version', () => {
    const stderr = { write: vi.fn() };

    expect(main({ argv: [], stderr })).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(
      'Usage: extract-changelog.mjs <version>\n'
    );
  });

  it('reports a missing version section with exit code 1', () => {
    const stderr = { write: vi.fn() };

    expect(
      main({
        argv: ['9.9.9'],
        changelogPath: '/missing/CHANGELOG.md',
        stderr,
      })
    ).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      'No section [9.9.9] in CHANGELOG.md\n'
    );
  });

  it('prints the selected section and returns exit code 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-changelog-'));
    temporaryDirectories.push(root);
    const changelogPath = path.join(root, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, SAMPLE);
    const stdout = { write: vi.fn() };

    expect(main({ argv: ['0.2.0'], changelogPath, stdout })).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(
      '### Features\n\n* new thing\n\n### Bug Fixes\n\n* old thing fixed\n'
    );
  });

  it('runs the CLI when the module is invoked as the entrypoint', async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    process.argv = [
      process.execPath,
      path.resolve('scripts/extract-changelog.mjs'),
      '0.3.5',
    ];

    try {
      vi.resetModules();
      await import('../../../scripts/extract-changelog.mjs');

      expect(process.exitCode).toBe(0);
      expect(stdout).toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});
