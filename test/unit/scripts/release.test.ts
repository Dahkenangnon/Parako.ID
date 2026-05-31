import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const { execFileSync } = await import('node:child_process');
const execFileSyncMock = vi.mocked(execFileSync);

const { parseSubject, generateBody, stampChangelog, previousTagFor, REMOTE } =
  await import('../../../scripts/release.mjs');

describe('parseSubject', () => {
  it('parses type with scope', () => {
    expect(parseSubject('fix(auth): close session pool on shutdown')).toEqual({
      type: 'fix',
      scope: 'auth',
      breaking: false,
      description: 'close session pool on shutdown',
    });
  });

  it('parses type without scope', () => {
    expect(parseSubject('feat: vendor fingerprintjs locally')).toEqual({
      type: 'feat',
      scope: null,
      breaking: false,
      description: 'vendor fingerprintjs locally',
    });
  });

  it('parses breaking marker', () => {
    expect(
      parseSubject('feat(oidc)!: drop legacy token introspection shape')
    ).toEqual({
      type: 'feat',
      scope: 'oidc',
      breaking: true,
      description: 'drop legacy token introspection shape',
    });
  });

  it('parses breaking marker without scope', () => {
    expect(parseSubject('refactor!: rename public API')).toEqual({
      type: 'refactor',
      scope: null,
      breaking: true,
      description: 'rename public API',
    });
  });

  it('returns null for non-conventional subjects', () => {
    expect(parseSubject('update files')).toBeNull();
    expect(parseSubject('Merge pull request #123')).toBeNull();
    expect(parseSubject('WIP: thing')).toBeNull();
  });

  it('rejects colon without space', () => {
    expect(parseSubject('fix(auth):something')).toBeNull();
  });
});

describe('generateBody', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  it('groups feat/fix/perf/refactor under fixed-order headings and drops other types', () => {
    const SHA1 = '1234567abcdef1234567abcdef1234567abcdef1';
    const SHA2 = '2345678abcdef1234567abcdef1234567abcdef2';
    const SHA3 = '3456789abcdef1234567abcdef1234567abcdef3';
    const SHA4 = '4567890abcdef1234567abcdef1234567abcdef4';
    const SHA5 = '5678901abcdef1234567abcdef1234567abcdef5';
    execFileSyncMock.mockReturnValueOnce(
      [
        `${SHA1}\tfeat(auth): add device alias`,
        `${SHA2}\tfix(oidc): await registration token policy`,
        `${SHA3}\trefactor: extract async-handler`,
        `${SHA4}\tperf(db): batch session writes`,
        `${SHA5}\tchore(deps): bump pino`,
      ].join('\n')
    );

    const body = generateBody('v0.1.0');

    expect(body).toContain('### Features');
    expect(body).toContain('### Bug Fixes');
    expect(body).toContain('### Performance');
    expect(body).toContain('### Refactor');
    expect(body).toContain(
      `add device alias ([${SHA1.slice(0, 7)}](${REMOTE}/commit/${SHA1}))`
    );
    expect(body).toContain('await registration token policy');
    expect(body).toContain('extract async-handler');
    expect(body).toContain('batch session writes');
    expect(body).not.toContain('bump pino');

    const idxFeatures = body.indexOf('### Features');
    const idxBugFixes = body.indexOf('### Bug Fixes');
    const idxPerf = body.indexOf('### Performance');
    const idxRefactor = body.indexOf('### Refactor');
    expect(idxFeatures).toBeLessThan(idxBugFixes);
    expect(idxBugFixes).toBeLessThan(idxPerf);
    expect(idxPerf).toBeLessThan(idxRefactor);
  });

  it('returns empty string when no commits match', () => {
    execFileSyncMock.mockReturnValueOnce('');
    expect(generateBody('v0.1.0')).toBe('');
  });

  it('returns empty string when all commits are non-allow-listed types', () => {
    execFileSyncMock.mockReturnValueOnce(
      [
        '1234567abcdef1234567abcdef1234567abcdef1\tchore: bump deps',
        '2345678abcdef1234567abcdef1234567abcdef2\tdocs: tweak readme',
      ].join('\n')
    );
    expect(generateBody('v0.1.0')).toBe('');
  });

  it('skips lines without tab separator', () => {
    execFileSyncMock.mockReturnValueOnce(
      [
        'malformed-no-tab',
        '1234567abcdef1234567abcdef1234567abcdef1\tfeat: real one',
      ].join('\n')
    );
    const body = generateBody('v0.1.0');
    expect(body).toContain('real one');
  });

  it('uses HEAD (not <ref>..HEAD) when fromRef is empty', () => {
    execFileSyncMock.mockReturnValueOnce('');
    generateBody('');
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain('HEAD');
    expect(args.some(a => a.includes('..HEAD'))).toBe(false);
  });

  it('uses <ref>..HEAD range when fromRef is provided', () => {
    execFileSyncMock.mockReturnValueOnce('');
    generateBody('v0.1.0');
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain('v0.1.0..HEAD');
  });
});

describe('stampChangelog', () => {
  it('inserts a new dated section above the Unreleased marker', () => {
    const src = '# Changelog\n\n## [Unreleased]\n';
    const body =
      '### Features\n\n* one ([abc1234](https://example.com/commit/abc1234))';
    const out = stampChangelog(src, '0.1.1', body);
    expect(out).toMatch(
      /## \[Unreleased\]\n\n## \[0\.1\.1\] - \d{4}-\d{2}-\d{2}\n\n### Features/
    );
    expect(out).toContain('# Changelog');
    expect(out).toContain('* one ([abc1234]');
  });

  it('inserts placeholder when body is empty', () => {
    const src = '# Changelog\n\n## [Unreleased]\n';
    const out = stampChangelog(src, '0.1.1', '');
    expect(out).toMatch(
      /## \[0\.1\.1\] - \d{4}-\d{2}-\d{2}\n\n_No user-visible changes/
    );
  });

  it('returns input unchanged when the Unreleased marker is missing', () => {
    const src = '# Changelog\n\n## [0.1.0] - 2026-01-01\n';
    expect(stampChangelog(src, '0.1.1', 'body')).toBe(src);
  });

  it('preserves content following the Unreleased marker', () => {
    const src =
      '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n### Features\n\n* prior\n';
    const out = stampChangelog(src, '0.1.1', '### Features\n\n* new');
    expect(out).toContain('## [0.1.0] - 2026-01-01');
    expect(out).toContain('* prior');
    expect(out).toContain('* new');
    expect(out.indexOf('* new')).toBeLessThan(out.indexOf('* prior'));
  });
});

describe('previousTagFor', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('returns the trimmed tag name when git describe succeeds', () => {
    execFileSyncMock.mockReturnValueOnce('v0.1.0\n');
    expect(previousTagFor('v')).toBe('v0.1.0');
  });

  it('returns empty string when git describe throws (no prior tag)', () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('No names found');
    });
    expect(previousTagFor('v')).toBe('');
  });
});
