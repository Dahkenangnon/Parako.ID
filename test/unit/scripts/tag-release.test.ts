import { describe, expect, it } from 'vitest';

import {
  isStableTag,
  normalizeCommandOutput,
} from '../../../scripts/tag-release.mjs';

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
