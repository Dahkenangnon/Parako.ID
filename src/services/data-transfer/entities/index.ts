import type { EntityConfigFactory } from './types.js';
import { createUserEntityConfig } from './users.entity.js';
import { createOidcClientEntityConfig } from './oidc-clients.entity.js';
import { createActivityEntityConfig } from './activities.entity.js';

const entityConfigFactories: Record<string, EntityConfigFactory> = {
  users: createUserEntityConfig,
  'oidc-clients': createOidcClientEntityConfig,
  activities: createActivityEntityConfig,
};

export const ENTITY_IDS = Object.freeze(Object.keys(entityConfigFactories));

export function getEntityConfigFactory(
  entityId: string
): EntityConfigFactory | null {
  switch (entityId) {
    case 'users':
      return createUserEntityConfig;
    case 'oidc-clients':
      return createOidcClientEntityConfig;
    case 'activities':
      return createActivityEntityConfig;
    default:
      return null;
  }
}
