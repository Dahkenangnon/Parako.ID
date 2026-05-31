import { describe, it, expect } from 'vitest';

const { extractSectionFromText } =
  await import('../../../scripts/extract-changelog.mjs');

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
