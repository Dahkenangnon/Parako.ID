import { describe, expect, it } from 'vitest';
import {
  buildActivationUrl,
  hashActivationToken,
  selectReissuableAdmin,
} from '../../../scripts/manage/admin.js';

describe('administrator activation helpers', () => {
  it('stores a deterministic hash rather than the bearer token', () => {
    const token = 'a'.repeat(64);
    expect(hashActivationToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashActivationToken(token)).not.toBe(token);
  });

  it('builds the activation on the standard single-use reset route', () => {
    const url = new URL(
      buildActivationUrl('https://id.example.com/base', 'secret-token')
    );
    expect(url.origin).toBe('https://id.example.com');
    expect(url.pathname).toBe('/auth/reset-password');
    expect(url.searchParams.get('token')).toBe('secret-token');
  });

  it('refuses bootstrap when any activated administrator exists', () => {
    expect(() =>
      selectReissuableAdmin(
        [
          { email: 'pending@example.com', password: null },
          { email: 'active@example.com', password: 'argon2-hash' },
        ],
        'pending@example.com'
      )
    ).toThrow('activated administrator already exists');
  });

  it('only reissues the same sole pending activation', () => {
    const pending = { email: 'admin@example.com', password: null };
    expect(selectReissuableAdmin([pending], 'admin@example.com')).toBe(pending);
    expect(() => selectReissuableAdmin([pending], 'other@example.com')).toThrow(
      'pending administrator activation'
    );
  });
});
