import { describe, expect, it } from 'vitest';

import {
  createStagedCheckPlan,
  parseStagedFiles,
} from '../../../scripts/testing/check-staged-files.ts';

describe('staged-file checks', () => {
  it('parses NUL-delimited paths without treating spaces as separators', () => {
    expect(parseStagedFiles('src/app.ts\0docs/release notes.md\0')).toEqual([
      'src/app.ts',
      'docs/release notes.md',
    ]);
  });

  it('checks whitespace, lints code, and formats every supported staged file', () => {
    expect(
      createStagedCheckPlan([
        'src/app.ts',
        'scripts/release.mjs',
        'docs/deployment.md',
        'public/logo.svg',
      ])
    ).toEqual([
      {
        command: 'git',
        args: ['diff', '--cached', '--check'],
      },
      {
        command: 'pnpm',
        args: [
          'exec',
          'eslint',
          '--max-warnings',
          '0',
          '--',
          'src/app.ts',
          'scripts/release.mjs',
        ],
      },
      {
        command: 'pnpm',
        args: [
          'exec',
          'prettier',
          '--check',
          '--ignore-unknown',
          '--',
          'src/app.ts',
          'scripts/release.mjs',
          'docs/deployment.md',
          'public/logo.svg',
        ],
      },
    ]);
  });

  it('does not invoke file tools when the index has no staged files', () => {
    expect(createStagedCheckPlan([])).toEqual([
      {
        command: 'git',
        args: ['diff', '--cached', '--check'],
      },
    ]);
  });
});
