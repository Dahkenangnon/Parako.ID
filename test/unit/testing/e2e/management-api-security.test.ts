import { describe, expect, it } from 'vitest';

import { MANAGEMENT_API_SECURED_OPERATIONS } from '../../../e2e/support/management-api-security.js';

describe('Management API security E2E manifest', () => {
  it('defines each secured method and path exactly once with a Parako scope', () => {
    const operationKeys = MANAGEMENT_API_SECURED_OPERATIONS.map(
      ([, method, path]) => `${method} ${path}`
    );

    expect(MANAGEMENT_API_SECURED_OPERATIONS).toHaveLength(41);
    expect(new Set(operationKeys).size).toBe(operationKeys.length);
    for (const [, method, path, scope] of MANAGEMENT_API_SECURED_OPERATIONS) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(method);
      expect(path).toMatch(/^\//);
      expect(scope).toMatch(
        /^parako:[a-z-]+:(read|write|delete|revoke|rotate)$/
      );
    }
  });
});
