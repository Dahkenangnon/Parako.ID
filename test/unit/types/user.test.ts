import { describe, expect, it } from 'vitest';

import {
  AuthProviderValues,
  RegisterWithValues,
} from '../../../src/types/user.js';

describe('user authentication values', () => {
  it('publishes immutable canonical registration and authentication providers', () => {
    expect(RegisterWithValues).toEqual([
      'email',
      'phone_number',
      'custom_identifier_1',
      'custom_identifier_2',
      'custom_identifier_3',
      'github',
      'google',
      'facebook',
      'microsoft',
      'linkedin',
      'okta',
      'twitter',
      'apple',
    ]);
    expect(AuthProviderValues).toEqual([
      'local',
      'oauth',
      'ldap',
      'github',
      'google',
      'facebook',
      'microsoft',
      'linkedin',
      'okta',
      'twitter',
      'apple',
    ]);
    expect(Object.isFrozen(RegisterWithValues)).toBe(true);
    expect(Object.isFrozen(AuthProviderValues)).toBe(true);
  });
});
