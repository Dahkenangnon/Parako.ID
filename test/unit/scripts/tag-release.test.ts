import { describe, expect, it, vi } from 'vitest';

import {
  isStableTag,
  main,
  normalizeCommandOutput,
  ReleaseTagError,
  releaseExists,
  remoteTagExists,
  run,
  runEntrypoint,
  succeeds,
} from '../../../scripts/tag-release.mjs';

function createWorkflowFixture(
  commandOverrides: Record<string, string | null | Error> = {},
  fileOverrides: Record<string, string> = {}
) {
  const outcomes: Record<string, string | null | Error> = {
    'git status --porcelain': '',
    'git rev-parse --abbrev-ref HEAD': 'main',
    'git fetch --quiet origin main --tags': null,
    'git rev-parse HEAD': 'abc123',
    'git rev-parse origin/main': 'abc123',
    'git show-ref --verify --quiet refs/tags/v1.2.3': new Error('tag absent'),
    'git ls-remote --exit-code --tags origin refs/tags/v1.2.3 refs/tags/v1.2.3^{}':
      Object.assign(new Error('tag absent'), { status: 2 }),
    'gh auth status': null,
    'gh api repos/Dahkenangnon/Parako.ID/releases/tags/v1.2.3': Object.assign(
      new Error('release absent'),
      {
        stdout: 'HTTP 404: Not Found',
      }
    ),
    ...commandOverrides,
  };
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ version: '1.2.3' }),
    'CHANGELOG.md': '# Changelog\n\n## [1.2.3] - 2026-08-08\n',
    ...fileOverrides,
  };
  const execute = vi.fn((file: string, args: string[]) => {
    const command = `${file} ${args.join(' ')}`;
    if (!(command in outcomes))
      throw new Error(`Unexpected command: ${command}`);
    const outcome = outcomes[command];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const readFile = vi.fn((path: string) => files[path]);
  const stdout = { write: vi.fn() };

  return { execute, readFile, stdout };
}

describe('normalizeCommandOutput', () => {
  it('treats inherited stdio output as empty instead of throwing', () => {
    expect(normalizeCommandOutput(null)).toBe('');
    expect(normalizeCommandOutput('  value  ')).toBe('value');
  });
});

describe('isStableTag', () => {
  it('accepts stable semantic release tags', () => {
    expect(isStableTag('v0.3.0')).toBe(true);
    expect(isStableTag('v12.34.56')).toBe(true);
  });

  it('rejects branches, abbreviated SHAs, prereleases, and leading zeroes', () => {
    expect(isStableTag('main')).toBe(false);
    expect(isStableTag('0123456')).toBe(false);
    expect(isStableTag('v0.3.0-rc.1')).toBe(false);
    expect(isStableTag('v01.3.0')).toBe(false);
  });
});

describe('command execution', () => {
  it('normalizes output from an injected command executor', () => {
    const execute = vi.fn(() => '  output\n');

    expect(run('git', ['status'], { cwd: '/tmp/repository' }, execute)).toBe(
      'output'
    );
    expect(execute).toHaveBeenCalledWith('git', ['status'], {
      cwd: '/tmp/repository',
      encoding: 'utf8',
    });
  });

  it('reports whether an injected command succeeds', () => {
    expect(
      succeeds(
        'gh',
        ['auth', 'status'],
        vi.fn(() => null)
      )
    ).toBe(true);
    expect(
      succeeds(
        'gh',
        ['auth', 'status'],
        vi.fn(() => {
          throw new Error('not authenticated');
        })
      )
    ).toBe(false);
  });
});

describe('published artifact checks', () => {
  it('distinguishes an existing remote tag from an absent tag', () => {
    const existing = vi.fn(() => 'abc123\trefs/tags/v1.2.3');
    expect(remoteTagExists('v1.2.3', existing)).toBe(true);

    const absent = vi.fn(() => {
      throw Object.assign(new Error('not found'), { status: 2 });
    });
    expect(remoteTagExists('v1.2.3', absent)).toBe(false);
  });

  it('propagates failures that do not mean an absent remote tag', () => {
    const failure = new Error('network failure');
    expect(() =>
      remoteTagExists(
        'v1.2.3',
        vi.fn(() => {
          throw failure;
        })
      )
    ).toThrow(failure);
  });

  it('distinguishes an existing GitHub release from a missing release', () => {
    expect(
      releaseExists(
        'v1.2.3',
        vi.fn(() => '{}')
      )
    ).toBe(true);

    for (const diagnostic of [
      { stdout: 'HTTP 404: Not Found' },
      { stderr: 'release not found' },
    ]) {
      expect(
        releaseExists(
          'v1.2.3',
          vi.fn(() => {
            throw Object.assign(new Error('missing'), diagnostic);
          })
        )
      ).toBe(false);
    }
  });

  it('propagates failures that do not mean a missing GitHub release', () => {
    const failure = new Error('GitHub unavailable');
    expect(() =>
      releaseExists(
        'v1.2.3',
        vi.fn(() => {
          throw failure;
        })
      )
    ).toThrow(failure);
  });
});

describe('release tag workflow', () => {
  it('validates a releasable tag without publishing in check mode', () => {
    const execute = vi.fn((file: string, args: string[]) => {
      const command = `${file} ${args.join(' ')}`;
      const outputs: Record<string, string | null> = {
        'git status --porcelain': '',
        'git rev-parse --abbrev-ref HEAD': 'main',
        'git fetch --quiet origin main --tags': null,
        'git rev-parse HEAD': 'abc123',
        'git rev-parse origin/main': 'abc123',
        'gh auth status': null,
      };

      if (command === 'git show-ref --verify --quiet refs/tags/v1.2.3') {
        throw new Error('tag absent');
      }
      if (command.startsWith('git ls-remote --exit-code --tags origin')) {
        throw Object.assign(new Error('tag absent'), { status: 2 });
      }
      if (
        command === 'gh api repos/Dahkenangnon/Parako.ID/releases/tags/v1.2.3'
      ) {
        throw Object.assign(new Error('release absent'), {
          stdout: 'HTTP 404: Not Found',
        });
      }
      if (!(command in outputs))
        throw new Error(`Unexpected command: ${command}`);
      return outputs[command];
    });
    const readFile = vi.fn((path: string) =>
      path === 'package.json'
        ? JSON.stringify({ version: '1.2.3' })
        : '# Changelog\n\n## [1.2.3] - 2026-08-08\n'
    );
    const stdout = { write: vi.fn() };

    expect(
      main({
        argv: ['v1.2.3', '--check'],
        execute,
        readFile,
        stdout,
      })
    ).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(
      'Tag checks passed for v1.2.3 at abc123. Re-run with --push after all protected checks pass.\n'
    );
    expect(execute).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['tag']),
      expect.anything()
    );
  });

  it.each([
    { argv: [], message: 'usage:' },
    { argv: ['v1.2.3-rc.1'], message: 'usage:' },
    { argv: ['v1.2.3', '--unknown'], message: 'usage:' },
  ])('rejects invalid arguments: $argv', ({ argv, message }) => {
    const fixture = createWorkflowFixture();
    expect(() => main({ argv, ...fixture })).toThrow(message);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each<{
    commands: Record<string, string | null | Error>;
    files: Record<string, string>;
    message: string;
  }>([
    {
      commands: { 'git status --porcelain': ' M package.json' },
      files: {},
      message: 'working tree must be clean',
    },
    {
      commands: { 'git rev-parse --abbrev-ref HEAD': 'dev' },
      files: {},
      message: 'tags may be created only from main',
    },
    {
      commands: { 'git rev-parse origin/main': 'def456' },
      files: {},
      message: 'HEAD abc123 does not equal origin/main def456',
    },
    {
      commands: {},
      files: { 'package.json': JSON.stringify({ version: '9.9.9' }) },
      message: 'tag v1.2.3 does not match package.json version 9.9.9',
    },
    {
      commands: {},
      files: { 'CHANGELOG.md': '# Changelog\n' },
      message: 'CHANGELOG.md has no 1.2.3 release section',
    },
    {
      commands: {
        'git show-ref --verify --quiet refs/tags/v1.2.3': null,
      },
      files: {},
      message: 'local tag v1.2.3 already exists',
    },
    {
      commands: {
        'git ls-remote --exit-code --tags origin refs/tags/v1.2.3 refs/tags/v1.2.3^{}':
          'abc123\trefs/tags/v1.2.3',
      },
      files: {},
      message: 'remote tag v1.2.3 already exists',
    },
    {
      commands: {
        'git ls-remote --exit-code --tags origin refs/tags/v1.2.3 refs/tags/v1.2.3^{}':
          Object.assign(new Error('network unavailable'), { status: 1 }),
      },
      files: {},
      message: 'could not verify that remote tag v1.2.3 is absent',
    },
    {
      commands: { 'gh auth status': new Error('not authenticated') },
      files: {},
      message:
        'GitHub CLI authentication is required to verify release absence',
    },
    {
      commands: {
        'gh api repos/Dahkenangnon/Parako.ID/releases/tags/v1.2.3': '{}',
      },
      files: {},
      message: 'GitHub Release v1.2.3 already exists',
    },
    {
      commands: {
        'gh api repos/Dahkenangnon/Parako.ID/releases/tags/v1.2.3': new Error(
          'network unavailable'
        ),
      },
      files: {},
      message: 'could not verify that GitHub Release v1.2.3 is absent',
    },
  ])('refuses unsafe publication: $message', ({ commands, files, message }) => {
    const fixture = createWorkflowFixture(commands, files);
    expect(() => main({ argv: ['v1.2.3'], ...fixture })).toThrow(message);
  });

  it('creates and pushes the immutable tag only after every guard passes', () => {
    const fixture = createWorkflowFixture({
      'git tag -a v1.2.3 -m release: v1.2.3': null,
      'git push origin refs/tags/v1.2.3': null,
    });

    expect(main({ argv: ['v1.2.3', '--push'], ...fixture })).toBe(0);
    expect(fixture.execute).toHaveBeenCalledWith(
      'git',
      ['tag', '-a', 'v1.2.3', '-m', 'release: v1.2.3'],
      { stdio: 'inherit' }
    );
    expect(fixture.execute).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'refs/tags/v1.2.3'],
      { stdio: 'inherit' }
    );
    expect(fixture.stdout.write).toHaveBeenCalledWith(
      'Pushed immutable tag v1.2.3. The tag-only release workflow now owns publication.\n'
    );
  });

  it('keeps explicit check mode non-publishing even when push is also present', () => {
    const fixture = createWorkflowFixture();
    expect(main({ argv: ['v1.2.3', '--push', '--check'], ...fixture })).toBe(0);
    expect(fixture.execute).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['tag']),
      expect.anything()
    );
  });
});

describe('release tag CLI entrypoint', () => {
  it('does nothing when the module is imported', () => {
    const executeMain = vi.fn();
    expect(runEntrypoint({ isEntrypoint: false, executeMain })).toBe(0);
    expect(executeMain).not.toHaveBeenCalled();
  });

  it('returns the workflow status for a successful direct invocation', () => {
    expect(
      runEntrypoint({ isEntrypoint: true, executeMain: vi.fn(() => 0) })
    ).toBe(0);
  });

  it('prints guarded failures and marks the process unsuccessful', () => {
    const stderr = { write: vi.fn() };
    const processObject = { exitCode: undefined as number | undefined };

    expect(
      runEntrypoint({
        isEntrypoint: true,
        executeMain: vi.fn(() => {
          throw new ReleaseTagError('working tree must be clean');
        }),
        stderr,
        processObject,
      })
    ).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      'Release tag check failed: working tree must be clean\n'
    );
    expect(processObject.exitCode).toBe(1);
  });

  it('does not hide unexpected implementation failures', () => {
    const failure = new TypeError('unexpected failure');
    expect(() =>
      runEntrypoint({
        isEntrypoint: true,
        executeMain: vi.fn(() => {
          throw failure;
        }),
      })
    ).toThrow(failure);
  });
});
