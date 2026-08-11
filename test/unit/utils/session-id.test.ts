import { describe, expect, it } from 'vitest';
import {
  createTenantSessionId,
  tenantIdFromSessionId,
} from '../../../src/utils/session-id.js';

describe('tenant-aware Express session IDs', () => {
  it('round-trips regular and system tenant identifiers', () => {
    expect(
      tenantIdFromSessionId(createTenantSessionId('tenant-a', 'random-id'))
    ).toBe('tenant-a');
    expect(
      tenantIdFromSessionId(createTenantSessionId('_platforms', 'random-id'))
    ).toBe('_platforms');
  });

  it('maps legacy and malformed identifiers to the default tenant', () => {
    expect(tenantIdFromSessionId('legacy-random-id')).toBe('default');
    expect(tenantIdFromSessionId('INVALID.random-id')).toBe('default');
    expect(tenantIdFromSessionId('.random-id')).toBe('default');
  });

  it('rejects invalid tenant or random identifier components', () => {
    expect(() => createTenantSessionId('INVALID', 'random-id')).toThrow(
      /invalid tenant/i
    );
    expect(() => createTenantSessionId('tenant-a', '')).toThrow(
      /random component/i
    );
  });
});
