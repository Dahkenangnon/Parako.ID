import { describe, expect, it } from 'vitest';
import { findDisallowedLicenses } from '../../../scripts/check-production-licenses.mjs';

describe('production artifact license policy', () => {
  it('rejects strong-copyleft and unknown dependency licenses', () => {
    const violations = findDisallowedLicenses({
      MIT: [{ name: 'safe', versions: ['1.0.0'] }],
      'AGPL-3.0-or-later': [{ name: 'copyleft', versions: ['2.0.0'] }],
      Unknown: [{ name: 'unclassified', versions: ['3.0.0'] }],
    });

    expect(violations).toEqual([
      {
        license: 'AGPL-3.0-or-later',
        name: 'copyleft',
        versions: ['2.0.0'],
      },
      {
        license: 'Unknown',
        name: 'unclassified',
        versions: ['3.0.0'],
      },
    ]);
  });

  it('allows permissive and weak-copyleft licenses carried with notices', () => {
    expect(
      findDisallowedLicenses({
        MIT: [{ name: 'mit-package', versions: ['1.0.0'] }],
        'Apache-2.0': [{ name: 'apache-package', versions: ['1.0.0'] }],
        'EPL-2.0': [{ name: 'epl-package', versions: ['1.0.0'] }],
      })
    ).toEqual([]);
  });
});
