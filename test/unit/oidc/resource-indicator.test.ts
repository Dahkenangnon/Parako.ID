import { describe, expect, it, vi } from 'vitest';
import { errors } from 'oidc-provider';

import {
  ALL_MANAGEMENT_API_SCOPES,
  MANAGEMENT_API_RESOURCE_URI,
} from '../../../src/api/v1/scopes.js';
import ResourceIndicator from '../../../src/oidc/specs/feature/resource-indicator.js';

const staticResourceClient = {
  audience: 'https://api.example',
  client_id: 'resource-server',
  client_name: 'Example API',
  grant_types: ['client_credentials'],
  scope: 'api:read api:write',
};

function createResourceIndicators({
  clients = [staticResourceClient],
  dbClients = [],
  dbError,
  enabled = true,
  isInitialized = false,
  staticError,
}: {
  clients?: unknown[];
  dbClients?: unknown[];
  dbError?: unknown;
  enabled?: boolean;
  isInitialized?: boolean;
  staticError?: unknown;
} = {}) {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
  const clientRegistryManager = {
    getOidcProviderClients: vi.fn().mockReturnValue(clients),
  };
  if (staticError !== undefined) {
    clientRegistryManager.getOidcProviderClients.mockImplementation(() => {
      throw staticError;
    });
  }
  const oidcAdapterBridge = {
    client: { findAllClients: vi.fn().mockResolvedValue(dbClients) },
    isInitialized,
  };
  if (dbError !== undefined) {
    oidcAdapterBridge.client.findAllClients.mockRejectedValue(dbError);
  }
  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      features: { oidc: { resource_indicators: { enabled } } },
    }),
  };

  return {
    clientRegistryManager,
    logger,
    oidcAdapterBridge,
    resourceIndicators: ResourceIndicator(
      configManager as never,
      clientRegistryManager as never,
      logger as never,
      oidcAdapterBridge as never
    ),
  };
}

describe('OIDC resource indicators', () => {
  it.each([true, false])(
    'exposes the configured enabled state (%s)',
    enabled => {
      const { resourceIndicators } = createResourceIndicators({ enabled });

      expect(resourceIndicators.enabled).toBe(enabled);
    }
  );

  it('registers the management API and only eligible static resource servers', () => {
    const { resourceIndicators } = createResourceIndicators({
      clients: [
        {
          accessTokenFormat: 'opaque',
          audience: 'https://service.example',
          client_id: 'service-api',
          grant_types: ['client_credentials', 'authorization_code'],
          scope: 'service:read profile',
        },
        {
          client_id: 'headless-api',
          grant_types: ['client_credentials'],
        },
        {
          audience: 'https://ignored.example',
          client_id: 'no-client-credentials',
          grant_types: ['authorization_code'],
          scope: 'api:read',
        },
        {
          audience: 'https://also-ignored.example',
          client_id: 'user-facing-without-api-scopes',
          grant_types: ['client_credentials', 'authorization_code'],
          scope: 'openid profile',
        },
        {
          audience: 'https://service.example',
          client_id: 'duplicate-audience',
          grant_types: ['client_credentials'],
          scope: 'api:write',
        },
      ],
    });

    expect(resourceIndicators.getResourceServersList()).toEqual({
      [MANAGEMENT_API_RESOURCE_URI]: {
        accessTokenFormat: 'jwt',
        audience: MANAGEMENT_API_RESOURCE_URI,
        scope: ALL_MANAGEMENT_API_SCOPES,
      },
      'https://service.example': {
        accessTokenFormat: 'opaque',
        audience: 'https://service.example',
        scope: 'service:read profile',
      },
      'urn:resource:headless-api': {
        accessTokenFormat: 'jwt',
        audience: 'urn:resource:headless-api',
        scope: 'api:read',
      },
    });
  });

  it.each([
    [new Error('registry unavailable'), 'registry unavailable'],
    ['registry unavailable', 'registry unavailable'],
  ])(
    'keeps the management API available when static discovery fails (%s)',
    (staticError, expectedMessage) => {
      const { logger, resourceIndicators } = createResourceIndicators({
        staticError,
      });

      expect(resourceIndicators.getResourceServersList()).toEqual({
        [MANAGEMENT_API_RESOURCE_URI]: {
          accessTokenFormat: 'jwt',
          audience: MANAGEMENT_API_RESOURCE_URI,
          scope: ALL_MANAGEMENT_API_SCOPES,
        },
      });
      expect(logger.error).toHaveBeenCalledWith(
        `[RESOURCE SERVER] Error building resource servers list: ${expectedMessage}`
      );
    }
  );

  it('does not query dynamic clients before the OIDC adapter is initialized', async () => {
    const { oidcAdapterBridge, resourceIndicators } =
      createResourceIndicators();

    await resourceIndicators.loadDbClients();

    expect(oidcAdapterBridge.client.findAllClients).not.toHaveBeenCalled();
  });

  it('adds eligible dynamic clients without replacing static resource definitions', async () => {
    const { resourceIndicators } = createResourceIndicators({
      dbClients: [
        {
          audience: 'https://api.example',
          client_id: 'duplicate-static-resource',
          grant_types: ['client_credentials'],
          scope: 'api:replacement',
        },
        {
          audience: 'https://reports.example',
          client_id: 'reports-api',
          grant_types: ['client_credentials'],
          scope: 'resource:reports',
        },
      ],
      isInitialized: true,
    });

    await resourceIndicators.loadDbClients();

    const resources = resourceIndicators.getResourceServersList();
    expect(resources['https://api.example']?.scope).toBe('api:read api:write');
    expect(resources['https://reports.example']).toEqual({
      accessTokenFormat: 'jwt',
      audience: 'https://reports.example',
      scope: 'resource:reports',
    });
  });

  it.each([
    [new Error('database unavailable'), 'database unavailable'],
    ['database unavailable', 'database unavailable'],
  ])(
    'keeps static resources when dynamic discovery fails (%s)',
    async (dbError, expectedMessage) => {
      const { logger, resourceIndicators } = createResourceIndicators({
        dbError,
        isInitialized: true,
      });

      await resourceIndicators.loadDbClients();

      expect(
        resourceIndicators.getResourceServersList()['https://api.example']
      ).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        `[RESOURCE SERVER] Error loading DB clients: ${expectedMessage}`
      );
    }
  );

  it('rebuilds static resources and reloads dynamic resources on refresh', async () => {
    const { clientRegistryManager, oidcAdapterBridge, resourceIndicators } =
      createResourceIndicators({ isInitialized: true });
    clientRegistryManager.getOidcProviderClients.mockReturnValue([
      {
        audience: 'https://new-api.example',
        client_id: 'new-api',
        grant_types: ['client_credentials'],
        scope: 'api:new',
      },
    ]);
    oidcAdapterBridge.client.findAllClients.mockResolvedValue([
      {
        audience: 'https://dynamic.example',
        client_id: 'dynamic-api',
        grant_types: ['client_credentials'],
        scope: 'parako:dynamic',
      },
    ]);

    await resourceIndicators.refreshResourceServersList();

    const resources = resourceIndicators.getResourceServersList();
    expect(resources['https://api.example']).toBeUndefined();
    expect(resources['https://new-api.example']?.scope).toBe('api:new');
    expect(resources['https://dynamic.example']?.scope).toBe('parako:dynamic');
    expect(resources[MANAGEMENT_API_RESOURCE_URI]).toBeDefined();
  });

  it.each([
    [['https://one.example', 'https://two.example'], 'https://one.example'],
    ['https://one.example', 'https://one.example'],
    [undefined, undefined],
  ])('selects the first requested resource from %j', (resource, expected) => {
    const { resourceIndicators } = createResourceIndicators();

    expect(
      resourceIndicators.defaultResource(
        { oidc: { params: { resource } } } as never,
        {} as never
      )
    ).toBe(expected);
  });

  it('reuses resources already recorded on a grant', async () => {
    const { resourceIndicators } = createResourceIndicators();

    await expect(
      resourceIndicators.useGrantedResource({} as never, {} as never)
    ).resolves.toBe(true);
  });

  it.each(['', 'https://unknown.example'])(
    'rejects an unknown resource server (%j)',
    resourceIndicator => {
      const { resourceIndicators } = createResourceIndicators();

      expect(() =>
        resourceIndicators.getResourceServerInfo(
          {} as never,
          resourceIndicator,
          {} as never
        )
      ).toThrow(errors.InvalidRequest);
    }
  );

  it.each([undefined, 'https://api.example', ['https://other.example']])(
    'rejects a client without an exact allowedResources entry (%j)',
    allowedResources => {
      const { resourceIndicators } = createResourceIndicators();

      expect(() =>
        resourceIndicators.getResourceServerInfo(
          {} as never,
          'https://api.example',
          { allowedResources, resourcesScopes: 'api:read' } as never
        )
      ).toThrow(errors.InvalidClientMetadata);
    }
  );

  it.each([undefined, '', ['api:read']])(
    'rejects missing or non-string resourcesScopes metadata (%j)',
    resourcesScopes => {
      const { resourceIndicators } = createResourceIndicators();

      expect(() =>
        resourceIndicators.getResourceServerInfo(
          {} as never,
          'https://api.example',
          {
            allowedResources: ['https://api.example'],
            resourcesScopes,
          } as never
        )
      ).toThrow(errors.InvalidClientMetadata);
    }
  );

  it('matches complete scope tokens rather than substrings', () => {
    const { resourceIndicators } = createResourceIndicators({
      clients: [
        {
          audience: 'https://api.example',
          client_id: 'resource-server',
          grant_types: ['client_credentials'],
          scope: 'api:reader api:write',
        },
      ],
    });

    const resourceInfo = resourceIndicators.getResourceServerInfo(
      {} as never,
      'https://api.example',
      {
        allowedResources: ['https://api.example'],
        resourcesScopes: 'api:read  api:write',
      } as never
    );

    expect(resourceInfo.scope).toBe('api:write');
  });

  it('does not let one client narrow the shared resource definition for another client', () => {
    const { resourceIndicators } = createResourceIndicators();

    const readInfo = resourceIndicators.getResourceServerInfo(
      {} as never,
      'https://api.example',
      {
        allowedResources: ['https://api.example'],
        resourcesScopes: 'api:read',
      } as never
    );
    const writeInfo = resourceIndicators.getResourceServerInfo(
      {} as never,
      'https://api.example',
      {
        allowedResources: ['https://api.example'],
        resourcesScopes: 'api:write',
      } as never
    );

    expect(readInfo.scope).toBe('api:read');
    expect(writeInfo.scope).toBe('api:write');
    expect(
      resourceIndicators.getResourceServersList()['https://api.example']?.scope
    ).toBe('api:read api:write');
  });

  it('returns resource-list snapshots that cannot mutate the canonical definitions', () => {
    const { resourceIndicators } = createResourceIndicators();
    const snapshot = resourceIndicators.getResourceServersList();

    snapshot['https://api.example']!.scope = 'attacker:scope';
    delete snapshot['https://api.example'];

    expect(
      resourceIndicators.getResourceServersList()['https://api.example']?.scope
    ).toBe('api:read api:write');
  });
});
