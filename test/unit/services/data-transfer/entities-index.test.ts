import { describe, expect, it } from 'vitest';

import { createActivityEntityConfig } from '../../../../src/services/data-transfer/entities/activities.entity.js';
import {
  ENTITY_IDS,
  getEntityConfigFactory,
} from '../../../../src/services/data-transfer/entities/index.js';
import { createOidcClientEntityConfig } from '../../../../src/services/data-transfer/entities/oidc-clients.entity.js';
import { createUserEntityConfig } from '../../../../src/services/data-transfer/entities/users.entity.js';

describe('data-transfer entity registry', () => {
  it('lists every supported entity ID in stable registration order', () => {
    expect(ENTITY_IDS).toEqual(['users', 'oidc-clients', 'activities']);
  });

  it('exposes an immutable supported-entity registry', () => {
    expect(Object.isFrozen(ENTITY_IDS)).toBe(true);
  });

  it.each([
    ['users', createUserEntityConfig],
    ['oidc-clients', createOidcClientEntityConfig],
    ['activities', createActivityEntityConfig],
  ] as const)(
    'routes %s to its entity configuration factory',
    (id, factory) => {
      expect(getEntityConfigFactory(id)).toBe(factory);
    }
  );

  it('returns null for unsupported and prototype-like entity IDs', () => {
    expect(getEntityConfigFactory('unknown')).toBeNull();
    expect(getEntityConfigFactory('__proto__')).toBeNull();
  });
});
