import { describe, expect, it } from 'vitest';

import { TenantStatusValues } from '../../../src/types/tenant.js';

describe('tenant status values', () => {
  it('publishes the immutable canonical tenant lifecycle statuses', () => {
    expect(TenantStatusValues).toEqual(['active', 'suspended', 'archived']);
    expect(Object.isFrozen(TenantStatusValues)).toBe(true);
  });
});
